import type { z } from "zod";

import type {
  CloseFeedbackRequestSchema,
  CreateFeedbackRequestSchema,
  CreateJobRequest,
  DeleteJobResult,
  JobDetail,
  JobFacets,
  JobPage,
  JobPoints,
  JobPersonTotals,
  JobOptions,
  JobOptionsQuery,
  JobQuery,
  ReassignFeedbackRequestSchema,
  UpdateJobRequest,
  UpdateJobStatusRequest
} from "../../contracts/production-jobs.js";
import type { JobScopes } from "../../contracts/production-catalog.js";
import { jobLeaderBoundFields, noLeaderFilter } from "../../contracts/production-jobs.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { decodeCursor, encodeCursor, escapeLike, invalidCursor, toIso, type QuerySql } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { visibleUserIdSql } from "../access/test-accounts.js";
import { actsAsJobLeader, assertProductionMember, assertProductionRole, isProductionAdmin, productionRolesOf } from "./access.js";
import { loadSettings } from "./catalog.service.js";
import { cursorInstantSql, decodeTimeCursor, encodeTimeCursor, isUuid, isValidCursorInstant } from "./cursor.js";
import { anyTagSql, customFieldFilterSql, resolveCustomFieldFilters, resolveCustomValues, setEntityTags } from "./custom-fields.js";
import { syncJobChat } from "./job-chat.service.js";
import {
  forbidden,
  jobStatusChangeAllowed,
  jobViewAllowed,
  jobViewSql,
  leadsForView,
  loadJobScopes,
  wholeJobAllowed,
  workEntryAllowed
} from "./job-permissions.js";
import { jobStatusLogValue, loadJobStatus } from "./job-statuses.service.js";
import {
  assertJobVisible,
  isSubtaskRow,
  jobSelectSql,
  lineFinishStatusIds,
  loadMemberRoles,
  loadWorkflowModel,
  notSubtaskSql,
  relationOf,
  selectFeedbacks,
  selectTasks,
  taskSelectSql,
  toFeedback,
  toJobStatusRef,
  toJobSummary,
  toProductionTasks,
  withSubtasksAfterLines,
  type JobRow,
  type TaskRow
} from "./jobs.repo.js";
import { enqueueProductionEvents, feedbackEvent, jobLeaderAssignedEvent, jobStatusChangedEvent } from "./notifications.js";
import { publishProductionChange } from "./realtime.js";
import { loadJobPoints, pointsViewer, sumPoints } from "./task-points.js";
import { insertTasks, loadJobForTasks, moveTasks, releaseParkedTasks, settleJob, softDeleteTasks, syncJobTotalImages } from "./tasks.service.js";
import {
  allowedTransitions,
  jobLinesReady,
  jobNotReadyMessage,
  statusByCode,
  statusById,
  systemOnlyTargetCodes,
  systemOnlyTargetMessage
} from "./workflow.js";

export { assertJobVisible };

type In<T extends z.ZodTypeAny> = z.infer<T>;
const jobNotFound = () => new AppError("JOB_NOT_FOUND", "Không tìm thấy job.", 404);

/**
 * PD-045: the separate client-feedback feature ("Ghi feedback", "Giao lại", "Đóng feedback") is retired — it was never
 * used; the owner handles client feedback with the job status "Feedback" and "Chia task" for the redo lines. Its
 * endpoints refuse with 409 FEEDBACK_RETIRED (404 for non-members, like every production route) before reading the body;
 * existing feedback rows are still read (job detail `feedbacks`). The service code below the guard is kept, unreachable.
 */
export const refuseRetiredFeedback = (context: AccessContext) => {
  assertProductionMember(context);
  throw new AppError(
    "FEEDBACK_RETIRED",
    "Tính năng ghi feedback đã bỏ — đổi trạng thái job sang “Feedback” và Chia task cho phần sửa.",
    409
  );
};

/**
 * PD-045: whether a job may take `status`. A status with requiresAllChecked ("Đã xong") needs at least one live line and
 * every live line finished (jobLinesReady: "Đã check" or later, a Checking line Done; subtasks follow their line) —
 * otherwise 409 JOB_NOT_READY "Còn N task chưa check: #…" / "Job chưa có task nào.". `jobId` null: a job
 * being created (no line yet). Callers hold the job's row lock, so no line moves in between.
 */
const assertJobStatusAllowed = async (
  tx: QuerySql,
  organizationId: string,
  jobId: string | null,
  status: { requiresAllChecked: boolean }
) => {
  if (!status.requiresAllChecked) {
    return;
  }
  const lines = jobId
    ? await tx<{ id: string; number: string | number; status_id: string; done_at: Date | null; is_checking: boolean }[]>`
        SELECT t.id, t.number, t.status_id, t.done_at, pr.is_qc AS is_checking
        FROM production.tasks t
        JOIN production.processes pr ON pr.organization_id = t.organization_id AND pr.id = t.process_id
        WHERE t.organization_id = ${organizationId} AND t.job_id = ${jobId} AND t.deleted_at IS NULL AND ${notSubtaskSql(tx)}
      `
    : [];
  const workflow = await loadWorkflowModel(tx, organizationId);
  const readiness = jobLinesReady(
    workflow,
    lines.map((line) => ({ id: line.id, number: Number(line.number), statusId: line.status_id, isChecking: line.is_checking, doneAt: line.done_at }))
  );
  if (!readiness.ready) {
    throw new AppError("JOB_NOT_READY", jobNotReadyMessage(readiness)!, 409);
  }
};

/**
 * PD-073: every job must have a Leader — 400 JOB_LEADER_REQUIRED for a new job without one, and for an edit that would
 * leave a job without one (jobLeaderNeeded says when).
 */
const jobLeaderRequired = (message = "Chọn Leader cho job.") => new AppError("JOB_LEADER_REQUIRED", message, 400);

/** A named leader must hold LEADER (null passes: the callers decide whether one is required, PD-073). */
const assertLeader = async (sql: QuerySql, organizationId: string, leaderId: string | null) => {
  if (!leaderId) {
    return;
  }
  const roles = (await loadMemberRoles(sql, organizationId, [leaderId])).get(leaderId);
  if (!roles?.has("LEADER")) {
    throw new AppError("LEADER_INVALID", "Người phụ trách job phải có vai trò Leader.", 400);
  }
};

/** Ngày giao of a job (its deadline) is on or after its Ngày nhận. */
const assertJobDates = (receivedAt: Date, deadline: Date) => {
  if (deadline < receivedAt) {
    throw new AppError("JOB_DATES_INVALID", "Ngày giao phải từ Ngày nhận trở đi.", 400);
  }
};

const assertProject = async (sql: QuerySql, organizationId: string, projectId: string) => {
  const rows = await sql`SELECT 1 FROM production.projects WHERE organization_id = ${organizationId} AND id = ${projectId} AND active`;
  if (rows.length === 0) {
    throw new AppError("PROJECT_NOT_FOUND", "Dự án không tồn tại hoặc đã ngừng.", 400);
  }
};

// Job history ---------------------------------------------------------------------------------------------

type JobEditRow = {
  code: string;
  name: string | null;
  project_id: string;
  leader_id: string | null;
  received_at: Date;
  deadline: Date;
  total_images: number;
  total_images_manual: boolean;
  drive_link: string | null;
  custom_values: Record<string, unknown>;
  archived_at: Date | null;
};

/** Assignees of the job's live lines (the "own" rules of PD-036). */
const jobAssignees = async (sql: QuerySql, organizationId: string, jobId: string) =>
  (
    await sql<{ assignee_id: string }[]>`
      SELECT assignee_id FROM production.tasks WHERE organization_id = ${organizationId} AND job_id = ${jobId} AND deleted_at IS NULL
    `
  ).map((row) => row.assignee_id);

const jobEditColumns = (sql: QuerySql) =>
  sql`code, name, project_id, leader_id, received_at, deadline, total_images, total_images_manual, drive_link, custom_values, archived_at`;

const jobTagIds = async (sql: QuerySql, organizationId: string, jobId: string) =>
  (
    await sql<{ tag_id: string }[]>`
      SELECT tag_id FROM production.entity_tags WHERE organization_id = ${organizationId} AND entity = 'JOB' AND entity_id = ${jobId}
    `
  ).map((row) => row.tag_id);

/**
 * What a job edit changed, as the from / to values of its history row (only the changed fields): code, name,
 * projectId, receivedAt / deadline (ISO), leaderId (null = no leader), totalImages, totalImagesManual, driveLink,
 * customValues, tagIds (sorted), archived.
 * Null when nothing changed. Pure (unit tested).
 */
export const jobEditChanges = (
  before: JobEditRow,
  after: JobEditRow,
  tags: { before: readonly string[]; after: readonly string[] } | null
): { from: Record<string, unknown>; to: Record<string, unknown> } | null => {
  const from: Record<string, unknown> = {};
  const to: Record<string, unknown> = {};
  const track = (key: string, previous: unknown, next: unknown) => {
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      from[key] = previous;
      to[key] = next;
    }
  };
  const sortedValues = (values: Record<string, unknown>) => Object.fromEntries(Object.entries(values).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  track("code", before.code, after.code);
  track("name", before.name, after.name);
  track("projectId", before.project_id, after.project_id);
  track("receivedAt", new Date(before.received_at).toISOString(), new Date(after.received_at).toISOString());
  track("deadline", new Date(before.deadline).toISOString(), new Date(after.deadline).toISOString());
  track("leaderId", before.leader_id, after.leader_id);
  track("totalImages", before.total_images, after.total_images);
  track("totalImagesManual", before.total_images_manual, after.total_images_manual);
  track("driveLink", before.drive_link, after.drive_link);
  track("customValues", sortedValues(before.custom_values), sortedValues(after.custom_values));
  if (tags) {
    track("tagIds", [...new Set(tags.before)].sort(), [...new Set(tags.after)].sort());
  }
  track("archived", before.archived_at !== null, after.archived_at !== null);
  return Object.keys(to).length > 0 ? { from, to } : null;
};

// Reads ---------------------------------------------------------------------------------------------------

/**
 * Job-row filters of GET /production/jobs (everything but the keyset cursor), on `j`. The person filter is
 * optional so the per-person totals can reach the tasks through the assignee index instead. Jobs created by a
 * temporary QA test account are left out for a viewer who is not one (PD-063).
 */
const jobListFilterSql = (
  sql: QuerySql,
  context: AccessContext,
  scopes: JobScopes,
  query: JobQuery,
  plans: Awaited<ReturnType<typeof resolveCustomFieldFilters>>,
  {
    person,
    project = true,
    leader = true
  }: {
    person: boolean;
    /** false: ignore `projectId` (the facets' project counts, PD-067). */
    project?: boolean;
    /** false: ignore `leaderId` (the facets' "Tất cả" / "Tôi quản lý" counts, PD-073). */
    leader?: boolean;
  }
) => {
  const like = query.q ? `%${escapeLike(query.q.toLowerCase())}%` : null;
  return sql`
    j.organization_id = ${context.organization.id} AND j.deleted_at IS NULL
    AND ${visibleUserIdSql(sql, context, sql`j.created_by`)}
    ${scopes.view === "all" ? sql`` : sql`AND ${jobViewSql(sql, context, scopes)}`}
    ${query.includeArchived ? sql`` : sql`AND j.archived_at IS NULL`}
    ${project && query.projectId ? sql`AND j.project_id = ${query.projectId}` : sql``}
    ${query.jobStatusId?.length ? sql`AND j.job_status_id = ANY(${query.jobStatusId}::uuid[])` : sql``}
    ${!leader ? sql`` : query.leaderId === noLeaderFilter ? sql`AND j.leader_id IS NULL` : query.leaderId ? sql`AND j.leader_id = ${query.leaderId}` : sql``}
    ${
      // "Mọi nhân viên": works on at least one task (assignee only; QC-only jobs do not count).
      person && query.personId
        ? sql`AND EXISTS (
            SELECT 1 FROM production.tasks t WHERE t.organization_id = j.organization_id AND t.job_id = j.id
              AND t.assignee_id = ${query.personId} AND t.deleted_at IS NULL)`
        : sql``
    }
    ${query.deadlineFrom ? sql`AND j.deadline >= ${query.deadlineFrom}::timestamptz` : sql``}
    ${query.deadlineTo ? sql`AND j.deadline < ${query.deadlineTo}::timestamptz` : sql``}
    ${
      query.late
        ? sql`AND EXISTS (
            SELECT 1 FROM production.tasks t WHERE t.organization_id = j.organization_id AND t.job_id = j.id
              AND t.is_late AND t.done_at IS NULL AND t.closed_at IS NULL AND t.deleted_at IS NULL AND ${notSubtaskSql(sql)})`
        : sql``
    }
    ${query.tagId?.length ? sql`AND ${anyTagSql(sql, "JOB", "j.id", "j.organization_id", query.tagId)}` : sql``}
    ${plans.length > 0 ? sql`AND ${customFieldFilterSql(sql, "j.custom_values", plans)}` : sql``}
    ${like ? sql`AND public.immutable_unaccent(lower(j.code || ' ' || coalesce(j.name, ''))) LIKE public.immutable_unaccent(${like})` : sql``}
  `;
};

/**
 * The person's numbers over every job matching the filters (per-person view summary): their own tasks of those
 * jobs, reached through production_tasks_assignee_idx.
 */
const personTotals = async (sql: QuerySql, organizationId: string, personId: string, filters: ReturnType<typeof jobListFilterSql>): Promise<JobPersonTotals> => {
  const row = (
    await sql<{ job_count: number; task_count: number; qty_assigned: number; qty_done: number; qty_checked: number }[]>`
      SELECT count(DISTINCT t.job_id)::int AS job_count, count(*) FILTER (WHERE ${notSubtaskSql(sql)})::int AS task_count,
        coalesce(sum(t.qty_assigned), 0)::int AS qty_assigned,
        coalesce(sum(coalesce(t.qty_done, 0)) FILTER (WHERE t.done_at IS NOT NULL), 0)::int AS qty_done,
        coalesce(sum(coalesce(t.qty_done, 0)) FILTER (WHERE t.checked_at IS NOT NULL OR (tp.is_qc AND t.done_at IS NOT NULL)), 0)::int AS qty_checked
      FROM production.tasks t
      JOIN production.jobs j ON j.organization_id = t.organization_id AND j.id = t.job_id
      JOIN production.processes tp ON tp.organization_id = t.organization_id AND tp.id = t.process_id
      WHERE t.organization_id = ${organizationId} AND t.assignee_id = ${personId} AND t.deleted_at IS NULL AND ${filters}
    `
  )[0];
  return {
    personId,
    jobCount: row?.job_count ?? 0,
    taskCount: row?.task_count ?? 0,
    qtyAssigned: row?.qty_assigned ?? 0,
    qtyDone: row?.qty_done ?? 0,
    qtyChecked: row?.qty_checked ?? 0
  };
};

/**
 * GET /production/jobs. PERF-01: the page of job ids is selected first — straight from
 * (organization_id, created_at DESC, id DESC) for active jobs, filters applied on the job row — and only
 * those jobs are aggregated, instead of aggregating every job before sorting and limiting. Keyset on
 * created_at at full precision (BUG-PR-05). The "view" scope of the job permission matrix (PD-036) decides which jobs:
 * "all" every job, "own" the jobs with a line of mine (or that I lead), "none" → 403. Whoever may see a job sees all
 * its lines (PD-014), so the "Người làm" summary of each row is never narrowed here. Deleted jobs never show.
 *
 * Per-person view (`personId`, PD-034): jobs where the person is an assignee; each row carries the person's
 * share (processes, assigned / done / checked of their own tasks) and the first page their totals over every
 * matching job.
 *
 * `sort=received` (PD-067, the List view grouped by month of "Ngày nhận"): newest Ngày nhận first, then newest created,
 * keyset on (received_at, created_at, id) at full precision — a three-part cursor the "created" order refuses (and
 * vice versa).
 */
export const listJobs = async (context: AccessContext, query: JobQuery): Promise<JobPage> => {
  assertProductionMember(context);
  const sql = getSql();
  const organizationId = context.organization.id;
  const scopes = await loadJobScopes(sql, context);
  if (scopes.view === "none") {
    throw forbidden("Bạn không có quyền xem danh sách job.");
  }
  const byReceived = query.sort === "received";
  const createdCursor = byReceived ? null : decodeTimeCursor(query.cursor);
  const receivedCursor = byReceived ? decodeReceivedCursor(query.cursor) : null;
  const firstPage = !createdCursor && !receivedCursor;
  const [plans, workflow] = await Promise.all([
    resolveCustomFieldFilters(sql, organizationId, "JOB", query.cf),
    loadWorkflowModel(sql, organizationId)
  ]);
  // A fresh fragment per use (the page and the outer select).
  const order = () => (byReceived ? sql`j.received_at DESC, j.created_at DESC, j.id DESC` : sql`j.created_at DESC, j.id DESC`);
  const after = receivedCursor
    ? sql`AND (j.received_at, j.created_at, j.id) < (${cursorInstantSql(sql, receivedCursor.received)}, ${cursorInstantSql(sql, receivedCursor.created)}, ${receivedCursor.id}::uuid)`
    : createdCursor
      ? sql`AND (j.created_at, j.id) < (${cursorInstantSql(sql, createdCursor.at)}, ${createdCursor.id}::uuid)`
      : sql``;
  const [rows, totals] = await Promise.all([
    sql<JobRow[]>`
      WITH page AS MATERIALIZED (
        SELECT j.id FROM production.jobs j
        WHERE ${jobListFilterSql(sql, context, scopes, query, plans, { person: true })}
          ${after}
        ORDER BY ${order()}
        LIMIT ${query.limit + 1}
      )
      ${jobSelectSql(sql, lineFinishStatusIds(workflow), query.personId)}
      WHERE j.organization_id = ${organizationId} AND j.id IN (SELECT id FROM page)
      ORDER BY ${order()}
    `,
    query.personId && firstPage
      ? personTotals(sql, organizationId, query.personId, jobListFilterSql(sql, context, scopes, query, plans, { person: false }))
      : Promise.resolve(null)
  ]);
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > query.limit && last
      ? byReceived
        ? encodeCursor([last.received_cursor, last.created_cursor, last.id])
        : encodeTimeCursor(last.created_cursor, last.id)
      : null;
  // PD-070 "Điểm" of each job of the page (the person's rows in the per-person view), batched for the page.
  const points =
    page.length === 0
      ? new Map<string, JobPoints>()
      : await loadJobPoints(sql, organizationId, await pointsViewer(context, sql), page.map((row) => row.id), query.personId);
  return {
    items: page.map((row) => ({ ...toJobSummary(row), pointsOfficial: points.get(row.id) ?? null })),
    pageInfo: { hasMore: rows.length > query.limit, nextCursor },
    personTotals: totals
  };
};

/** The (received_at, created_at, id) cursor of `sort=received`; null without one, 400 INVALID_CURSOR when malformed. */
const decodeReceivedCursor = (cursor: string | undefined) => {
  if (!cursor) {
    return null;
  }
  const [received, created, id] = decodeCursor(cursor, 3) ?? [];
  if (
    typeof received !== "string" ||
    typeof created !== "string" ||
    typeof id !== "string" ||
    !isValidCursorInstant(received) ||
    !isValidCursorInstant(created) ||
    !isUuid(id)
  ) {
    throw invalidCursor();
  }
  return { received, created, id };
};

/**
 * GET /production/jobs/facets (PD-067): the counts of the job List view — jobs per month of "Ngày nhận" (organization
 * timezone, every filter applied) and per project (every filter but the project one; the filtered project is kept with
 * 0). PD-073, for a caller holding LEADER only: the "Tất cả" / "Tôi quản lý" tab counts — every filter but the leader
 * one, `mine` = led by the caller (one count with a FILTER clause). Same filters and visibility as listJobs (view scope,
 * PD-063 test accounts, per-person view); one grouped query each over the organization's job rows.
 */
export const getJobFacets = async (context: AccessContext, query: JobQuery): Promise<JobFacets> => {
  assertProductionMember(context);
  const sql = getSql();
  const organizationId = context.organization.id;
  const scopes = await loadJobScopes(sql, context);
  if (scopes.view === "none") {
    throw forbidden("Bạn không có quyền xem danh sách job.");
  }
  const [plans, settings] = await Promise.all([
    resolveCustomFieldFilters(sql, organizationId, "JOB", query.cf),
    loadSettings(sql, organizationId)
  ]);
  // The tabs are a Leader's view: holding LEADER itself (the organization superadmin holds every role), not ADMIN.
  const leaderTabs = productionRolesOf(context).has("LEADER");
  const [months, projects, tabs] = await Promise.all([
    sql<{ month: string; count: number }[]>`
      SELECT to_char(j.received_at AT TIME ZONE ${settings.timezone}::text, 'YYYY-MM') AS month, count(*)::int AS count
      FROM production.jobs j
      WHERE ${jobListFilterSql(sql, context, scopes, query, plans, { person: true })}
      GROUP BY 1
      ORDER BY 1 DESC
    `,
    sql<{ project_id: string; code: string; name: string; active: boolean; count: number }[]>`
      WITH counts AS (
        SELECT j.project_id, count(*)::int AS count
        FROM production.jobs j
        WHERE ${jobListFilterSql(sql, context, scopes, query, plans, { person: true, project: false })}
        GROUP BY j.project_id
      )
      SELECT p.id AS project_id, p.code, p.name, p.active, coalesce(c.count, 0)::int AS count
      FROM production.projects p
      LEFT JOIN counts c ON c.project_id = p.id
      WHERE p.organization_id = ${organizationId}
        AND (c.project_id IS NOT NULL ${query.projectId ? sql`OR p.id = ${query.projectId}` : sql``})
      ORDER BY lower(p.code), p.code, p.id
    `,
    leaderTabs
      ? sql<{ all_count: number; mine_count: number }[]>`
          SELECT count(*)::int AS all_count, count(*) FILTER (WHERE j.leader_id = ${context.user.id})::int AS mine_count
          FROM production.jobs j
          WHERE ${jobListFilterSql(sql, context, scopes, query, plans, { person: true, leader: false })}
        `
      : Promise.resolve(null)
  ]);
  const tabCounts = tabs?.[0];
  return {
    months: months.map((row) => ({ month: row.month, count: row.count })),
    projects: projects.map((row) => ({ projectId: row.project_id, code: row.code, name: row.name, active: row.active, count: row.count })),
    leaderTabs: tabs ? { all: tabCounts?.all_count ?? 0, mine: tabCounts?.mine_count ?? 0 } : null
  };
};

/**
 * GET /production/jobs/:jobId. PD-045: the job's only status is the manual chip (`jobStatus`, with `uncheckedTaskCount`
 * for a requiresAllChecked status), so `bulkActions` is always empty (the line workflow stops at "Đã check"), and the
 * retired feedback feature is never offered (`canFeedback` / `canCloseFeedback` false; existing `feedbacks` still read).
 */
export const getJobDetail = async (context: AccessContext, jobId: string, sql: QuerySql = getSql()): Promise<JobDetail> => {
  assertProductionMember(context);
  const organizationId = context.organization.id;
  // Cached per organization (PERF-14): the job row needs its finished-line statuses (uncheckedTaskCount).
  const workflow = await loadWorkflowModel(sql, organizationId);
  const row = (
    await sql<JobRow[]>`
      ${jobSelectSql(sql, lineFinishStatusIds(workflow))} WHERE j.organization_id = ${organizationId} AND j.id = ${jobId} AND j.deleted_at IS NULL
    `
  )[0];
  if (!row) {
    throw jobNotFound();
  }
  const [rows, feedbackRows, scopes] = await Promise.all([
    sql<TaskRow[]>`${taskSelectSql(sql)} WHERE t.organization_id = ${organizationId} AND t.job_id = ${jobId} ORDER BY t.created_at, t.number`,
    selectFeedbacks(sql, organizationId, jobId),
    loadJobScopes(sql, context)
  ]);
  // Every row, each line followed by its subtasks (PD-044; the FE nests them by parentTaskId).
  const taskRows = withSubtasksAfterLines(rows);
  const me = context.user.id;
  const involved = taskRows.some((task) => task.assignee_id === me || task.qc_id === me);
  const leads = leadsForView(context, row.leader_id);
  // SEC2-04: leadership counts only while the caller still holds LEADER (or ADMIN).
  if (!jobViewAllowed(scopes.view, { involved, leads })) {
    throw jobNotFound();
  }
  const archived = row.archived_at !== null;
  const assignees = taskRows.map((task) => task.assignee_id);
  const canEdit = !archived && wholeJobAllowed(scopes.update, assignees, me);
  const tasks = await toProductionTasks(sql, context, workflow, taskRows, scopes);
  return {
    ...toJobSummary(row),
    // PD-070: the job's "Điểm" = its rows' points (lines and subtasks, each row once).
    pointsOfficial: sumPoints(tasks.map((task) => task.points)),
    tasks,
    feedbacks: feedbackRows.map(toFeedback),
    capabilities: {
      canEdit,
      canChangeLeader: canEdit && scopes.update === "all",
      canSplit: !archived && scopes.create !== "none",
      splitOwnOnly: scopes.create === "own",
      canDelete: !archived && wholeJobAllowed(scopes.delete, assignees, me),
      // Retired with the separate feedback feature (PD-045).
      canFeedback: false,
      canCloseFeedback: false,
      canArchive: scopes.update === "all",
      canChangeStatus: !archived && jobStatusChangeAllowed(scopes.update, { assignee: assignees.includes(me), leads }),
      // PD-045: no job-level line moves any more ("Complete cả gói" is gone); the job's status is the manual chip.
      bulkActions: []
    }
  };
};

// Writes --------------------------------------------------------------------------------------------------

/**
 * POST /production/jobs — a job without lines ("create: all", PD-036; "Nhập công việc" adds lines to existing jobs only,
 * PD-038). PD-045: a new job has no line yet, so a status with requiresAllChecked ("Đã xong") is refused (409
 * JOB_NOT_READY "Job chưa có task nào."). PD-073: the Leader is required (400 JOB_LEADER_REQUIRED "Chọn Leader cho
 * job."); they must hold LEADER (400 LEADER_INVALID).
 */
export const createJob = async (context: AccessContext, input: CreateJobRequest) => {
  assertProductionMember(context);
  const organizationId = context.organization.id;
  const sql = getSql();
  if ((await loadJobScopes(sql, context)).create !== "all") {
    throw forbidden("Bạn không có quyền tạo job — hãy dùng \"Nhập Task\" để nhập task của mình.");
  }
  // PD-073: every job has a Leader (PD-035 had it optional). Tổng tấm left empty follows the lines (0 until the job is split).
  const leaderId = input.leaderId ?? null;
  if (!leaderId) {
    throw jobLeaderRequired();
  }
  const receivedAt = new Date(input.receivedAt);
  const deadline = new Date(input.deadline);
  assertJobDates(receivedAt, deadline);
  const manualTotal = input.totalImages !== undefined && input.totalImages !== null;
  const jobId = await sql.begin(async (tx) => {
    await assertProject(tx, organizationId, input.projectId);
    await assertLeader(tx, organizationId, leaderId);
    const customValues = await resolveCustomValues(tx, organizationId, "JOB", input.customValues, { enforceRequired: true });
    // PD-038: the chosen "Trạng thái", otherwise the first status by position (filled by the jobs_default_job_status trigger).
    const jobStatus = input.jobStatusId ? await loadJobStatus(tx, organizationId, input.jobStatusId) : null;
    if (jobStatus) {
      await assertJobStatusAllowed(tx, organizationId, null, jobStatus);
    }
    const created = (
      await tx<{ id: string }[]>`
        INSERT INTO production.jobs (organization_id, project_id, code, name, leader_id, received_at, deadline, total_images, total_images_manual,
          drive_link, custom_values, job_status_id, created_by)
        VALUES (${organizationId}, ${input.projectId}, ${input.code}, ${input.name?.trim() || null}, ${leaderId}, ${receivedAt}, ${deadline},
          ${manualTotal ? input.totalImages! : 0}, ${manualTotal}, ${input.driveLink?.trim() || null}, ${tx.json(customValues)},
          ${jobStatus?.id ?? null}::uuid, ${context.user.id})
        RETURNING id
      `
    )[0]!;
    if (input.tagIds?.length) {
      await setEntityTags(tx, organizationId, "JOB", created.id, input.tagIds);
    }
    // The Leader is told the job is theirs (never when they created it themselves: the actor is never notified).
    if (leaderId) {
      await enqueueProductionEvents(tx, [jobLeaderAssignedEvent(organizationId, created.id, context.user.id, leaderId)]);
    }
    return created.id;
  });
  publishProductionChange(organizationId, jobId, [], "job", context.user.id);
  return await getJobDetail(context, jobId);
};

/**
 * PD-073: whether a PATCH would leave the job without a Leader while it edits what the job form edits: `leaderId: null`
 * (clearing it), or any of the job's own fields (jobLeaderBoundFields) on a job that has none (created before PD-073; a
 * Leader who lost the role stays named, SEC2-04). Archive / restore, tags and custom-field values alone do not count, so
 * those — and the job status (its own endpoint) — keep working on such a job. updateJob applies it to callers with
 * "update: all" only: with "own" the Leader is not theirs to choose, so their edits go through. Pure (unit tested).
 */
export const jobLeaderNeeded = (input: UpdateJobRequest, currentLeaderId: string | null) => {
  const leaderAfter = input.leaderId === undefined ? currentLeaderId : input.leaderId;
  return !leaderAfter && jobLeaderBoundFields.some((field) => input[field] !== undefined);
};

export const updateJob = async (context: AccessContext, jobId: string, input: UpdateJobRequest) => {
  assertProductionMember(context);
  const organizationId = context.organization.id;
  const sql = getSql();
  const previousLeader = await sql.begin(async (tx) => {
    const job = (
      await tx<JobEditRow[]>`
        SELECT ${jobEditColumns(tx)}
        FROM production.jobs WHERE organization_id = ${organizationId} AND id = ${jobId} AND deleted_at IS NULL FOR UPDATE
      `
    )[0];
    if (!job) {
      throw jobNotFound();
    }
    // PD-036 "update": every job, or with "own" a job whose lines are all mine; the leader and archiving need "all".
    const scopes = await assertJobVisible(tx, context, jobId);
    if (!wholeJobAllowed(scopes.update, await jobAssignees(tx, organizationId, jobId), context.user.id)) {
      throw forbidden(scopes.update === "own" ? "Bạn chỉ sửa được job mà mọi task đều của bạn." : "Bạn không có quyền sửa job.");
    }
    if (((input.leaderId !== undefined && input.leaderId !== job.leader_id) || input.archived !== undefined) && scopes.update !== "all") {
      throw forbidden("Chỉ người có quyền sửa mọi job mới đổi Leader hoặc lưu trữ / khôi phục job.");
    }
    if (job.archived_at && input.archived !== false) {
      throw new AppError("JOB_ARCHIVED", "Job đã lưu trữ — khôi phục trước khi sửa.", 409);
    }
    // PD-073: an edit of the job's own fields never leaves it without a Leader (callers who may set the Leader).
    if (scopes.update === "all" && jobLeaderNeeded(input, job.leader_id)) {
      throw jobLeaderRequired(
        input.leaderId === null ? "Job phải có Leader — chỉ đổi sang Leader khác." : "Job chưa có Leader — chọn Leader để lưu thay đổi."
      );
    }
    if (input.projectId) {
      await assertProject(tx, organizationId, input.projectId);
    }
    if (input.leaderId && input.leaderId !== job.leader_id) {
      await assertLeader(tx, organizationId, input.leaderId);
    }
    const receivedAt = input.receivedAt ? new Date(input.receivedAt) : job.received_at;
    const deadline = input.deadline ? new Date(input.deadline) : job.deadline;
    if (input.receivedAt || input.deadline) {
      assertJobDates(receivedAt, deadline);
    }
    const customValues =
      input.customValues !== undefined
        ? await resolveCustomValues(tx, organizationId, "JOB", input.customValues, { existing: job.custom_values as never, enforceRequired: true })
        : null;
    // Tổng tấm (PD-035): a number is typed (kept as is); null goes back to the sum of the lines (synced below).
    const totalSent = input.totalImages !== undefined;
    const manualTotal = totalSent ? input.totalImages !== null : job.total_images_manual;
    await tx`
      UPDATE production.jobs SET
        project_id = coalesce(${input.projectId ?? null}::uuid, project_id),
        code = coalesce(${input.code ?? null}, code),
        name = CASE WHEN ${input.name !== undefined} THEN ${input.name?.trim() || null} ELSE name END,
        leader_id = CASE WHEN ${input.leaderId !== undefined} THEN ${input.leaderId ?? null}::uuid ELSE leader_id END,
        received_at = ${receivedAt},
        deadline = ${deadline},
        total_images = CASE WHEN ${totalSent && manualTotal} THEN ${input.totalImages ?? 0}::int ELSE total_images END,
        total_images_manual = ${manualTotal},
        drive_link = CASE WHEN ${input.driveLink !== undefined} THEN ${input.driveLink?.trim() || null} ELSE drive_link END,
        custom_values = coalesce(${customValues ? tx.json(customValues) : null}::jsonb, custom_values),
        archived_at = CASE WHEN ${input.archived === undefined} THEN archived_at WHEN ${input.archived === true} THEN coalesce(archived_at, now()) ELSE NULL END,
        updated_at = now()
      WHERE organization_id = ${organizationId} AND id = ${jobId}
    `;
    if (!manualTotal) {
      await syncJobTotalImages(tx, organizationId, jobId);
    }
    const previousTags = input.tagIds ? await jobTagIds(tx, organizationId, jobId) : [];
    if (input.tagIds) {
      await setEntityTags(tx, organizationId, "JOB", jobId, input.tagIds);
    }
    // PLAN §8/§10: job edits show in the job's history (job-level task_logs row, action JOB).
    const after = (await tx<JobEditRow[]>`
      SELECT ${jobEditColumns(tx)}
      FROM production.jobs WHERE organization_id = ${organizationId} AND id = ${jobId}
    `)[0]!;
    const change = jobEditChanges(job, after, input.tagIds ? { before: previousTags, after: [...new Set(input.tagIds)] } : null);
    if (change) {
      const names = change.to.leaderId === undefined && change.to.projectId === undefined ? [] : await tx<{ kind: string; id: string; name: string }[]>`
        SELECT 'leader' AS kind, au.id, au.display_name AS name FROM public.app_users au
        WHERE ${change.to.leaderId !== undefined} AND au.id IN (${job.leader_id}::uuid, ${after.leader_id}::uuid)
        UNION ALL
        SELECT 'project', p.id, p.code FROM production.projects p
        WHERE ${change.to.projectId !== undefined} AND p.organization_id = ${organizationId} AND p.id IN (${job.project_id}::uuid, ${after.project_id}::uuid)
      `;
      const nameOf = (kind: string, id: string | null) => (id ? (names.find((row) => row.kind === kind && row.id === id)?.name ?? null) : null);
      if (change.to.leaderId !== undefined) {
        change.from.leaderName = nameOf("leader", job.leader_id);
        change.to.leaderName = nameOf("leader", after.leader_id);
      }
      if (change.to.projectId !== undefined) {
        change.from.projectCode = nameOf("project", job.project_id);
        change.to.projectCode = nameOf("project", after.project_id);
      }
      await tx`
        INSERT INTO production.task_logs (organization_id, task_id, job_id, user_id, action, from_value, to_value)
        VALUES (${organizationId}, NULL, ${jobId}, ${context.user.id}, 'JOB', ${tx.json(change.from as never)}, ${tx.json(change.to as never)})
      `;
    }
    if (after.leader_id && after.leader_id !== job.leader_id) {
      await enqueueProductionEvents(tx, [jobLeaderAssignedEvent(organizationId, jobId, context.user.id, after.leader_id)]);
    }
    return job.leader_id;
  });
  publishProductionChange(organizationId, jobId, [], "job", context.user.id, [previousLeader]);
  if (input.leaderId !== undefined && input.leaderId !== previousLeader) {
    await syncJobChat(context, jobId);
  }
  return await getJobDetail(context, jobId);
};

/**
 * PATCH /production/jobs/:jobId/status — the manual job status (PD-038), separate from the line workflow (PD-014, which
 * it never touches). Allowed with "update: all", or "own" when the caller is the assignee of a live line of the job or its
 * leader (ADMIN always: its scopes are "all"); anyone else 403 (404 when they cannot see the job). Archived jobs are
 * read-only. The change is a JOB history row (who, from → to, when) and a live-sync hint.
 *
 * PD-045: a status with requiresAllChecked ("Đã xong") only when the job has a line and every live line is "Đã check"
 * (a Checking line: Done) — else 409 JOB_NOT_READY (assertJobStatusAllowed, under the job's row lock). A real change
 * enqueues `production.job.status_changed` in the same transaction (→ the job's Leader and the production Account /
 * Admin people, never the actor).
 */
export const changeJobStatus = async (context: AccessContext, jobId: string, input: UpdateJobStatusRequest) => {
  assertProductionMember(context);
  const organizationId = context.organization.id;
  const sql = getSql();
  const changed = await sql.begin(async (tx) => {
    const job = (
      await tx<{ leader_id: string | null; archived_at: Date | null; job_status_id: string; mine: boolean }[]>`
        SELECT j.leader_id, j.archived_at, j.job_status_id,
          EXISTS (
            SELECT 1 FROM production.tasks t
            WHERE t.organization_id = j.organization_id AND t.job_id = j.id AND t.deleted_at IS NULL AND t.assignee_id = ${context.user.id}
          ) AS mine
        FROM production.jobs j
        WHERE j.organization_id = ${organizationId} AND j.id = ${jobId} AND j.deleted_at IS NULL
        FOR UPDATE OF j
      `
    )[0];
    if (!job) {
      throw jobNotFound();
    }
    const scopes = await assertJobVisible(tx, context, jobId);
    if (!jobStatusChangeAllowed(scopes.update, { assignee: job.mine, leads: leadsForView(context, job.leader_id) })) {
      throw forbidden(scopes.update === "own" ? "Bạn chỉ đổi được trạng thái của job mà bạn được giao." : "Bạn không có quyền đổi trạng thái job.");
    }
    if (job.archived_at) {
      throw new AppError("JOB_ARCHIVED", "Job đã lưu trữ — khôi phục trước khi đổi trạng thái.", 409);
    }
    const target = await loadJobStatus(tx, organizationId, input.statusId);
    if (target.id === job.job_status_id) {
      return false;
    }
    await assertJobStatusAllowed(tx, organizationId, jobId, target);
    const previous = await loadJobStatus(tx, organizationId, job.job_status_id);
    await tx`
      UPDATE production.jobs SET job_status_id = ${target.id}, updated_at = now()
      WHERE organization_id = ${organizationId} AND id = ${jobId}
    `;
    await tx`
      INSERT INTO production.task_logs (organization_id, task_id, job_id, user_id, action, from_value, to_value)
      VALUES (${organizationId}, NULL, ${jobId}, ${context.user.id}, 'JOB', ${tx.json(jobStatusLogValue(previous))}, ${tx.json(jobStatusLogValue(target))})
    `;
    await enqueueProductionEvents(tx, [jobStatusChangedEvent(organizationId, jobId, context.user.id, previous, target)]);
    return true;
  });
  if (changed) {
    publishProductionChange(organizationId, jobId, [], "job", context.user.id);
  }
  return await getJobDetail(context, jobId);
};

/**
 * GET /production/jobs/options — the "Gói công việc" picker of "Nhập công việc": every job of the project that is not
 * archived or deleted (closed statuses included), open statuses first, then Ngày giao newest first. Needs "create" own or
 * all (PD-036) and answers only minimal fields, also for jobs the caller cannot open (the line they add is theirs).
 * Search: the package text (and the old free name), accents / case ignored, through production_jobs_search_idx.
 * Jobs created by a temporary QA test account are left out for a viewer who is not one (PD-063).
 */
export const listJobOptions = async (context: AccessContext, query: JobOptionsQuery): Promise<JobOptions> => {
  assertProductionMember(context);
  const sql = getSql();
  const organizationId = context.organization.id;
  if (!workEntryAllowed((await loadJobScopes(sql, context)).create)) {
    throw forbidden("Bạn không có quyền nhập công việc.");
  }
  const like = query.q ? `%${escapeLike(query.q.toLowerCase())}%` : null;
  const rows = await sql<
    {
      id: string;
      code: string;
      project_id: string;
      deadline: Date;
      job_status_id: string;
      job_status_name: string;
      job_status_color: string;
      job_status_closed: boolean;
      job_status_requires_all_checked: boolean;
    }[]
  >`
    SELECT j.id, j.code, j.project_id, j.deadline,
      js.id AS job_status_id, js.name AS job_status_name, js.color AS job_status_color, js.is_closed AS job_status_closed,
      js.requires_all_checked AS job_status_requires_all_checked
    FROM production.jobs j
    JOIN production.job_statuses js ON js.organization_id = j.organization_id AND js.id = j.job_status_id
    WHERE j.organization_id = ${organizationId} AND j.project_id = ${query.projectId}
      AND j.deleted_at IS NULL AND j.archived_at IS NULL
      AND ${visibleUserIdSql(sql, context, sql`j.created_by`)}
      ${query.statusIds?.length ? sql`AND j.job_status_id = ANY(${query.statusIds}::uuid[])` : sql``}
      ${like ? sql`AND public.immutable_unaccent(lower(j.code || ' ' || coalesce(j.name, ''))) LIKE public.immutable_unaccent(${like})` : sql``}
    ORDER BY js.is_closed, j.deadline DESC, j.id DESC
    LIMIT ${query.limit + 1}
  `;
  return {
    items: rows.slice(0, query.limit).map((row) => ({
      id: row.id,
      code: row.code,
      projectId: row.project_id,
      deadline: toIso(row.deadline),
      jobStatus: toJobStatusRef(row)
    })),
    truncated: rows.length > query.limit
  };
};

/**
 * DELETE /production/jobs/:jobId (PD-036): "delete: all", or "own" when every line of the job is mine. Every line is
 * deleted like a single one (points reversed, kept for audit), then the job is hidden and its package can be used
 * again. Archived jobs are read-only (restore first).
 */
export const deleteJob = async (context: AccessContext, jobId: string): Promise<DeleteJobResult> => {
  assertProductionMember(context);
  const organizationId = context.organization.id;
  const sql = getSql();
  const result = await sql.begin(async (tx) => {
    await loadJobForTasks(tx, organizationId, jobId, true);
    const scopes = await assertJobVisible(tx, context, jobId);
    const ids = (
      await tx<{ id: string }[]>`
        SELECT id FROM production.tasks WHERE organization_id = ${organizationId} AND job_id = ${jobId} AND deleted_at IS NULL
        ORDER BY created_at FOR UPDATE
      `
    ).map((row) => row.id);
    const tasks = await selectTasks(tx, organizationId, ids);
    if (!wholeJobAllowed(scopes.delete, tasks.map((task) => task.assignee_id), context.user.id)) {
      throw forbidden(scopes.delete === "own" ? "Bạn chỉ xoá được job mà mọi task đều của bạn." : "Bạn không có quyền xoá job.");
    }
    const reversedEntries = await softDeleteTasks(tx, organizationId, context.user.id, tasks, { withJob: true });
    await tx`
      UPDATE production.jobs SET deleted_at = now(), deleted_by = ${context.user.id}, updated_at = now()
      WHERE organization_id = ${organizationId} AND id = ${jobId}
    `;
    await tx`
      INSERT INTO production.task_logs (organization_id, task_id, job_id, user_id, action, from_value, to_value)
      VALUES (${organizationId}, NULL, ${jobId}, ${context.user.id}, 'JOB', ${tx.json({ deleted: false })},
        ${tx.json({ deleted: true, deletedTasks: tasks.length, reversedEntries })})
    `;
    return { deletedTasks: tasks.length, reversedEntries, people: tasks.flatMap((task) => [task.assignee_id, task.qc_id]) };
  });
  // Everyone who saw the job through a line drops it too.
  publishProductionChange(organizationId, jobId, [], "job", context.user.id, result.people);
  return { jobId, deletedTasks: result.deletedTasks, reversedEntries: result.reversedEntries };
};

/**
 * POST /production/jobs/:jobId/transition — a job-level line move. PD-045 retired it with "Complete cả gói": the job's
 * status is the manual chip (PATCH …/status), the line workflow stops at "Đã check" and `bulkActions` is always empty.
 * Anyone but a production ADMIN (superadmins included) gets 409 JOB_TRANSITION_RETIRED. An ADMIN may still apply one
 * listed move (never an override, never one needing a note, never into a Done status or FEEDBACK) to every line it fits;
 * subtasks follow their line. With the transitions after "Đã check" deleted, nothing reaches Complete or later this way
 * (409 NOTHING_TO_MOVE) — an ADMIN moves a single line there with an override (POST …/tasks/:id/transition).
 */
export const transitionJob = async (context: AccessContext, jobId: string, input: { toStatusId: string; note?: string | undefined }) => {
  assertProductionMember(context);
  if (!isProductionAdmin(context)) {
    throw new AppError(
      "JOB_TRANSITION_RETIRED",
      "Không chuyển trạng thái cả job theo task nữa — đổi trạng thái job ở chip “Trạng thái job”; các task dừng ở Đã check.",
      409
    );
  }
  const organizationId = context.organization.id;
  const sql = getSql();
  const moved = await sql.begin(async (tx) => {
    await assertJobVisible(tx, context, jobId);
    await loadJobForTasks(tx, organizationId, jobId, true);
    const workflow = await loadWorkflowModel(tx, organizationId);
    const target = statusById(workflow, input.toStatusId);
    if (!target?.active || target.countsDone) {
      throw new AppError("TRANSITION_NOT_ALLOWED", "Không thể chuyển cả job sang trạng thái này.", 400);
    }
    if (systemOnlyTargetCodes.has(target.code)) {
      throw new AppError("TRANSITION_NOT_ALLOWED", systemOnlyTargetMessage(target.name), 400);
    }
    const ids = (
      await tx<{ id: string }[]>`
        SELECT id FROM production.tasks WHERE organization_id = ${organizationId} AND job_id = ${jobId} AND deleted_at IS NULL
        ORDER BY created_at FOR UPDATE
      `
    ).map((row) => row.id);
    const rows = await selectTasks(tx, organizationId, ids);
    const eligible = rows
      .filter((task) => !isSubtaskRow(task))
      .filter((task) => {
        const option = allowedTransitions(workflow, task.status_id, relationOf(context, task), "job").find((item) => item.toStatusId === target.id);
        return option !== undefined && !option.override && !option.requiresNote;
      });
    if (eligible.length === 0) {
      throw new AppError("NOTHING_TO_MOVE", `Không có task nào bạn chuyển được sang "${target.name}".`, 409);
    }
    // One UPDATE + one history insert for the whole job (PERF-15); subtasks move with their line.
    await moveTasks(tx, organizationId, workflow, eligible, target, context.user.id, input.note?.trim() || null);
    await settleJob(tx, organizationId, workflow, jobId);
    const movedLines = new Set(eligible.map((task) => task.id));
    return {
      lines: movedLines.size,
      taskIds: [...movedLines, ...rows.filter((task) => isSubtaskRow(task) && movedLines.has(task.parent_task_id!)).map((task) => task.id)]
    };
  });
  publishProductionChange(organizationId, jobId, moved.taskIds, "tasks", context.user.id);
  return { moved: moved.lines, job: await getJobDetail(context, jobId) };
};

// Feedback (retired, PD-045: every entry point refuses with 409 FEEDBACK_RETIRED — refuseRetiredFeedback) ---------------

/** Account records client feedback: delivering tasks park in FEEDBACK until the re-done work is checked. */
export const createFeedback = async (context: AccessContext, jobId: string, input: In<typeof CreateFeedbackRequestSchema>) => {
  refuseRetiredFeedback(context);
  assertProductionRole(context, "ACCOUNT");
  const organizationId = context.organization.id;
  const sql = getSql();
  const movedIds = await sql.begin(async (tx) => {
    await loadJobForTasks(tx, organizationId, jobId, true);
    const workflow = await loadWorkflowModel(tx, organizationId);
    const delivering = statusByCode(workflow, "DELIVERING");
    const feedback = statusByCode(workflow, "FEEDBACK");
    const ids = (
      await tx<{ id: string }[]>`
        SELECT id FROM production.tasks
        WHERE organization_id = ${organizationId} AND job_id = ${jobId} AND status_id = ${delivering.id} AND deleted_at IS NULL
        ORDER BY created_at FOR UPDATE
      `
    ).map((row) => row.id);
    if (ids.length === 0) {
      throw new AppError("JOB_NOT_DELIVERING", "Chỉ ghi feedback khi job đang giao khách (Delivering).", 409);
    }
    if (input.sourceTaskId) {
      const source = await tx`
        SELECT 1 FROM production.tasks WHERE organization_id = ${organizationId} AND job_id = ${jobId} AND id = ${input.sourceTaskId} AND deleted_at IS NULL
      `;
      if (source.length === 0) {
        throw new AppError("SOURCE_TASK_INVALID", "Task gốc không thuộc job này.", 400);
      }
    }
    await tx`
      INSERT INTO production.feedbacks (organization_id, job_id, source_task_id, type, note, created_by)
      VALUES (${organizationId}, ${jobId}, ${input.sourceTaskId ?? null}, ${input.type}, ${input.note}, ${context.user.id})
    `;
    await moveTasks(
      tx,
      organizationId,
      workflow,
      await selectTasks(tx, organizationId, ids),
      feedback,
      context.user.id,
      `Feedback ${input.type === "WRONG" ? "sai" : "yêu cầu thêm"}: ${input.note}`.slice(0, 5000)
    );
    await settleJob(tx, organizationId, workflow, jobId);
    await enqueueProductionEvents(tx, [
      feedbackEvent(organizationId, jobId, context.user.id, { type: input.type, note: input.note, sourceTaskId: input.sourceTaskId ?? null, taskIds: ids })
    ]);
    return ids;
  });
  publishProductionChange(organizationId, jobId, movedIds, "feedback", context.user.id);
  return await getJobDetail(context, jobId);
};

/** "Giao lại": the job leader creates FB tasks (default assignee = the original one, chosen in the form). */
export const reassignFeedback = async (context: AccessContext, feedbackId: string, input: In<typeof ReassignFeedbackRequestSchema>) => {
  refuseRetiredFeedback(context);
  assertProductionMember(context);
  const organizationId = context.organization.id;
  const sql = getSql();
  const result = await sql.begin(async (tx) => {
    const feedback = (
      await tx<{ job_id: string; type: "WRONG" | "EXTRA"; status: string; source_task_id: string | null }[]>`
        SELECT job_id, type, status, source_task_id FROM production.feedbacks WHERE organization_id = ${organizationId} AND id = ${feedbackId}
      `
    )[0];
    if (!feedback) {
      throw new AppError("FEEDBACK_NOT_FOUND", "Không tìm thấy feedback.", 404);
    }
    await assertJobVisible(tx, context, feedback.job_id);
    const job = await loadJobForTasks(tx, organizationId, feedback.job_id, true);
    if (!actsAsJobLeader(context, job.leader_id) && !isProductionAdmin(context)) {
      throw new AppError("FORBIDDEN", "Chỉ Leader của job (hoặc Quản trị) được giao lại feedback.", 403);
    }
    if (feedback.status === "RESOLVED") {
      throw new AppError("FEEDBACK_RESOLVED", "Feedback này đã xử lý xong.", 409);
    }
    const workflow = await loadWorkflowModel(tx, organizationId);
    const created = await insertTasks(tx, context, workflow, job, input.tasks, {
      kind: feedback.type === "WRONG" ? "FB_WRONG" : "FB_EXTRA",
      feedbackId,
      defaultParentId: feedback.source_task_id
    });
    await tx`UPDATE production.feedbacks SET status = 'IN_PROGRESS' WHERE organization_id = ${organizationId} AND id = ${feedbackId} AND status = 'OPEN'`;
    await settleJob(tx, organizationId, workflow, feedback.job_id);
    return { jobId: feedback.job_id, ...created };
  });
  publishProductionChange(organizationId, result.jobId, result.ids, "feedback", context.user.id);
  await syncJobChat(context, result.jobId);
  const workflow = await loadWorkflowModel(sql, organizationId);
  const rows = await selectTasks(sql, organizationId, result.ids);
  return { tasks: await toProductionTasks(sql, context, workflow, rows), warnings: result.warnings };
};

/**
 * "Đóng feedback, không cần làm lại" (BUG-PR-02, Account / Admin): resolves an open feedback with a note
 * (resolution CLOSED). Once no feedback of the job is open, the tasks parked in FEEDBACK (and re-done FB
 * tasks already Checked) return to Complete so the job can be delivered again. Re-done tasks still in
 * progress keep their own flow (the Leader completes them as usual).
 */
export const closeFeedback = async (context: AccessContext, feedbackId: string, input: In<typeof CloseFeedbackRequestSchema>) => {
  refuseRetiredFeedback(context);
  assertProductionRole(context, "ACCOUNT");
  const organizationId = context.organization.id;
  const sql = getSql();
  const note = input.note.trim();
  const result = await sql.begin(async (tx) => {
    const found = (await tx<{ job_id: string }[]>`SELECT job_id FROM production.feedbacks WHERE organization_id = ${organizationId} AND id = ${feedbackId}`)[0];
    if (!found) {
      throw new AppError("FEEDBACK_NOT_FOUND", "Không tìm thấy feedback.", 404);
    }
    // Lock order: job, then its rows.
    await loadJobForTasks(tx, organizationId, found.job_id, true);
    const feedback = (
      await tx<{ status: string }[]>`SELECT status FROM production.feedbacks WHERE organization_id = ${organizationId} AND id = ${feedbackId} FOR UPDATE`
    )[0]!;
    if (feedback.status === "RESOLVED") {
      throw new AppError("FEEDBACK_RESOLVED", "Feedback này đã xử lý xong.", 409);
    }
    await tx`
      UPDATE production.feedbacks
      SET status = 'RESOLVED', resolution = 'CLOSED', resolved_at = now(), resolved_by = ${context.user.id}, resolution_note = ${note}
      WHERE organization_id = ${organizationId} AND id = ${feedbackId}
    `;
    const workflow = await loadWorkflowModel(tx, organizationId);
    const released = await releaseParkedTasks(tx, organizationId, workflow, found.job_id, context.user.id, `Đóng feedback, không cần làm lại: ${note}`.slice(0, 5000));
    await settleJob(tx, organizationId, workflow, found.job_id);
    return { jobId: found.job_id, released };
  });
  publishProductionChange(organizationId, result.jobId, result.released, "feedback", context.user.id);
  return await getJobDetail(context, result.jobId);
};
