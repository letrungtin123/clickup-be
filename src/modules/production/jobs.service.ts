import type { z } from "zod";

import type {
  CreateFeedbackRequestSchema,
  CreateJobRequest,
  JobDetail,
  JobPage,
  JobQuery,
  ReassignFeedbackRequestSchema,
  UpdateJobRequest
} from "../../contracts/production-jobs.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { decodeCursor, encodeCursor, escapeLike, type QuerySql } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { assertProductionMember, assertProductionRole, hasProductionRole, isProductionAdmin } from "./access.js";
import { resolveCustomValues, setEntityTags } from "./custom-fields.js";
import {
  jobSelectSql,
  loadMemberRoles,
  loadWorkflowModel,
  relationOf,
  selectFeedbacks,
  selectTasks,
  taskSelectSql,
  toFeedback,
  toJobSummary,
  toProductionTask,
  type JobRow,
  type TaskRow
} from "./jobs.repo.js";
import { enqueueProductionEvents, feedbackEvent } from "./notifications.js";
import { insertTasks, loadJobForTasks, moveTask, publishProductionChange, settleJob } from "./tasks.service.js";
import { allowedTransitions, statusByCode, statusById, type Workflow } from "./workflow.js";

type In<T extends z.ZodTypeAny> = z.infer<T>;
const jobNotFound = () => new AppError("JOB_NOT_FOUND", "Không tìm thấy job.", 404);

const isAccountOrAdmin = (context: AccessContext) => isProductionAdmin(context) || hasProductionRole(context, "ACCOUNT");

/** Account / Leader / Admin see every job; others only jobs where they work or check a task. */
const canSeeAllJobs = (context: AccessContext) => isProductionAdmin(context) || hasProductionRole(context, "ACCOUNT", "LEADER");

/** 404 unless the caller may see the job (all-jobs roles, its leader, or someone working/checking in it). */
export const assertJobVisible = async (sql: QuerySql, context: AccessContext, jobId: string) => {
  if (canSeeAllJobs(context)) {
    return;
  }
  const rows = await sql`
    SELECT 1 FROM production.jobs j
    WHERE j.organization_id = ${context.organization.id} AND j.id = ${jobId}
      AND (j.leader_id = ${context.user.id} OR EXISTS (
        SELECT 1 FROM production.tasks t WHERE t.organization_id = j.organization_id AND t.job_id = j.id
          AND (t.assignee_id = ${context.user.id} OR t.qc_id = ${context.user.id})))
  `;
  if (rows.length === 0) {
    throw jobNotFound();
  }
};

const assertLeader = async (sql: QuerySql, organizationId: string, leaderId: string) => {
  const roles = (await loadMemberRoles(sql, organizationId, [leaderId])).get(leaderId);
  if (!roles?.has("LEADER")) {
    throw new AppError("LEADER_INVALID", "Người phụ trách job phải có vai trò Leader.", 400);
  }
};

const assertProject = async (sql: QuerySql, organizationId: string, projectId: string) => {
  const rows = await sql`SELECT 1 FROM production.projects WHERE organization_id = ${organizationId} AND id = ${projectId} AND active`;
  if (rows.length === 0) {
    throw new AppError("PROJECT_NOT_FOUND", "Dự án không tồn tại hoặc đã ngừng.", 400);
  }
};

// Reads ---------------------------------------------------------------------------------------------------

export const listJobs = async (context: AccessContext, query: JobQuery): Promise<JobPage> => {
  assertProductionRole(context, "ACCOUNT", "LEADER");
  const sql = getSql();
  const organizationId = context.organization.id;
  const cursor = decodeCursor(query.cursor, 2);
  if (query.cursor && !cursor) {
    throw new AppError("INVALID_CURSOR", "Con trỏ phân trang không hợp lệ.", 400);
  }
  const like = query.q ? `%${escapeLike(query.q.toLowerCase())}%` : null;
  const rows = await sql<JobRow[]>`
    ${jobSelectSql(sql)}
    WHERE j.organization_id = ${organizationId}
      ${query.includeArchived ? sql`` : sql`AND j.archived_at IS NULL`}
      ${query.projectId ? sql`AND j.project_id = ${query.projectId}` : sql``}
      ${query.statusId ? sql`AND j.status_id = ${query.statusId}` : sql``}
      ${query.leaderId ? sql`AND j.leader_id = ${query.leaderId}` : sql``}
      ${query.deadlineFrom ? sql`AND j.deadline >= ${query.deadlineFrom}::timestamptz` : sql``}
      ${query.deadlineTo ? sql`AND j.deadline < ${query.deadlineTo}::timestamptz` : sql``}
      ${query.late ? sql`AND coalesce(agg.late_task_count, 0) > 0` : sql``}
      ${
        query.tagId
          ? sql`AND EXISTS (SELECT 1 FROM production.entity_tags et WHERE et.organization_id = j.organization_id AND et.entity = 'JOB' AND et.entity_id = j.id AND et.tag_id = ${query.tagId})`
          : sql``
      }
      ${like ? sql`AND public.immutable_unaccent(lower(j.code || ' ' || coalesce(j.name, ''))) LIKE public.immutable_unaccent(${like})` : sql``}
      ${cursor ? sql`AND (j.created_at, j.id) < (${String(cursor[0])}::timestamptz, ${String(cursor[1])}::uuid)` : sql``}
    ORDER BY j.created_at DESC, j.id DESC
    LIMIT ${query.limit + 1}
  `;
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toJobSummary),
    pageInfo: { hasMore: rows.length > query.limit, nextCursor: rows.length > query.limit && last ? encodeCursor([last.created_at.toISOString(), last.id]) : null }
  };
};

const bulkActions = (workflow: Workflow, context: AccessContext, tasks: TaskRow[]) => {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    for (const option of allowedTransitions(workflow, task.status_id, relationOf(context, task))) {
      const target = statusById(workflow, option.toStatusId);
      // Bulk moves never need per-task input: no notes (QC fail, overrides) and no Done quantities.
      if (!target || option.override || option.requiresNote || target.countsDone) {
        continue;
      }
      counts.set(target.id, (counts.get(target.id) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([toStatusId, taskCount]) => ({ toStatusId, name: statusById(workflow, toStatusId)!.name, taskCount }))
    .sort((a, b) => statusById(workflow, a.toStatusId)!.sortOrder - statusById(workflow, b.toStatusId)!.sortOrder);
};

export const getJobDetail = async (context: AccessContext, jobId: string, sql: QuerySql = getSql()): Promise<JobDetail> => {
  assertProductionMember(context);
  const organizationId = context.organization.id;
  const row = (await sql<JobRow[]>`${jobSelectSql(sql)} WHERE j.organization_id = ${organizationId} AND j.id = ${jobId}`)[0];
  if (!row) {
    throw jobNotFound();
  }
  const [taskRows, feedbackRows, workflow] = await Promise.all([
    sql<TaskRow[]>`${taskSelectSql(sql)} WHERE t.organization_id = ${organizationId} AND t.job_id = ${jobId} ORDER BY t.created_at, t.number`,
    selectFeedbacks(sql, organizationId, jobId),
    loadWorkflowModel(sql, organizationId)
  ]);
  const involved = taskRows.some((task) => task.assignee_id === context.user.id || task.qc_id === context.user.id);
  const isLeader = row.leader_id === context.user.id;
  if (!canSeeAllJobs(context) && !involved && !isLeader) {
    throw jobNotFound();
  }
  const archived = row.archived_at !== null;
  const manage = isLeader || isProductionAdmin(context);
  return {
    ...toJobSummary(row),
    tasks: taskRows.map((task) => toProductionTask(task, workflow, relationOf(context, task))),
    feedbacks: feedbackRows.map(toFeedback),
    capabilities: {
      canEdit: !archived && (manage || isAccountOrAdmin(context)),
      canSplit: !archived && manage,
      canFeedback: !archived && isAccountOrAdmin(context) && taskRows.some((task) => task.status_code === "DELIVERING"),
      canArchive: isAccountOrAdmin(context),
      bulkActions: archived ? [] : bulkActions(workflow, context, taskRows)
    }
  };
};

// Writes --------------------------------------------------------------------------------------------------

export const createJob = async (context: AccessContext, input: CreateJobRequest) => {
  assertProductionRole(context, "ACCOUNT", "LEADER");
  const organizationId = context.organization.id;
  const sql = getSql();
  const leaderId = input.leaderId ?? (hasProductionRole(context, "LEADER") ? context.user.id : null);
  if (!leaderId) {
    throw new AppError("LEADER_REQUIRED", "Chọn Leader phụ trách job.", 400);
  }
  const jobId = await sql.begin(async (tx) => {
    await assertProject(tx, organizationId, input.projectId);
    await assertLeader(tx, organizationId, leaderId);
    const customValues = await resolveCustomValues(tx, organizationId, "JOB", input.customValues, { enforceRequired: true });
    const created = (
      await tx<{ id: string }[]>`
        INSERT INTO production.jobs (organization_id, project_id, code, name, leader_id, deadline, total_images, drive_link, custom_values, created_by)
        VALUES (${organizationId}, ${input.projectId}, ${input.code}, ${input.name?.trim() || null}, ${leaderId}, ${new Date(input.deadline)},
          ${input.totalImages}, ${input.driveLink?.trim() || null}, ${tx.json(customValues)}, ${context.user.id})
        RETURNING id
      `
    )[0]!;
    if (input.tagIds?.length) {
      await setEntityTags(tx, organizationId, "JOB", created.id, input.tagIds);
    }
    return created.id;
  });
  publishProductionChange(organizationId, jobId, [], "job", context.user.id);
  return await getJobDetail(context, jobId);
};

export const updateJob = async (context: AccessContext, jobId: string, input: UpdateJobRequest) => {
  assertProductionMember(context);
  const organizationId = context.organization.id;
  const sql = getSql();
  await sql.begin(async (tx) => {
    const job = (
      await tx<{ leader_id: string; custom_values: Record<string, unknown>; archived_at: Date | null }[]>`
        SELECT leader_id, custom_values, archived_at FROM production.jobs WHERE organization_id = ${organizationId} AND id = ${jobId} FOR UPDATE
      `
    )[0];
    if (!job) {
      throw jobNotFound();
    }
    const accountOrAdmin = isAccountOrAdmin(context);
    const isLeader = job.leader_id === context.user.id;
    if (!accountOrAdmin && !isLeader) {
      throw hasProductionRole(context, "LEADER") ? new AppError("FORBIDDEN", "Chỉ Account, Quản trị hoặc Leader của job được sửa job.", 403) : jobNotFound();
    }
    if ((input.leaderId !== undefined && input.leaderId !== job.leader_id) || input.archived !== undefined) {
      if (!accountOrAdmin) {
        throw new AppError("FORBIDDEN", "Chỉ Account hoặc Quản trị được đổi Leader hoặc lưu trữ job.", 403);
      }
    }
    if (job.archived_at && input.archived !== false) {
      throw new AppError("JOB_ARCHIVED", "Job đã lưu trữ — khôi phục trước khi sửa.", 409);
    }
    if (input.projectId) {
      await assertProject(tx, organizationId, input.projectId);
    }
    if (input.leaderId && input.leaderId !== job.leader_id) {
      await assertLeader(tx, organizationId, input.leaderId);
    }
    const customValues =
      input.customValues !== undefined
        ? await resolveCustomValues(tx, organizationId, "JOB", input.customValues, { existing: job.custom_values as never, enforceRequired: true })
        : null;
    await tx`
      UPDATE production.jobs SET
        project_id = coalesce(${input.projectId ?? null}::uuid, project_id),
        code = coalesce(${input.code ?? null}, code),
        name = CASE WHEN ${input.name !== undefined} THEN ${input.name?.trim() || null} ELSE name END,
        leader_id = coalesce(${input.leaderId ?? null}::uuid, leader_id),
        deadline = coalesce(${input.deadline ? new Date(input.deadline) : null}::timestamptz, deadline),
        total_images = coalesce(${input.totalImages ?? null}::int, total_images),
        drive_link = CASE WHEN ${input.driveLink !== undefined} THEN ${input.driveLink?.trim() || null} ELSE drive_link END,
        custom_values = coalesce(${customValues ? tx.json(customValues) : null}::jsonb, custom_values),
        archived_at = CASE WHEN ${input.archived === undefined} THEN archived_at WHEN ${input.archived === true} THEN coalesce(archived_at, now()) ELSE NULL END,
        updated_at = now()
      WHERE organization_id = ${organizationId} AND id = ${jobId}
    `;
    if (input.tagIds) {
      await setEntityTags(tx, organizationId, "JOB", jobId, input.tagIds);
    }
  });
  publishProductionChange(organizationId, jobId, [], "job", context.user.id);
  return await getJobDetail(context, jobId);
};

/** Job-level move (e.g. Complete → Delivering → Delivered): every task the caller may move to that status. */
export const transitionJob = async (context: AccessContext, jobId: string, input: { toStatusId: string; note?: string | undefined }) => {
  assertProductionMember(context);
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
    const ids = (
      await tx<{ id: string }[]>`SELECT id FROM production.tasks WHERE organization_id = ${organizationId} AND job_id = ${jobId} ORDER BY created_at FOR UPDATE`
    ).map((row) => row.id);
    const movedIds: string[] = [];
    for (const task of await selectTasks(tx, organizationId, ids)) {
      const option = allowedTransitions(workflow, task.status_id, relationOf(context, task)).find((item) => item.toStatusId === target.id);
      if (!option || option.override || option.requiresNote) {
        continue;
      }
      await moveTask(tx, organizationId, workflow, task, target, context.user.id, input.note?.trim() || null);
      movedIds.push(task.id);
    }
    if (movedIds.length === 0) {
      throw new AppError("NOTHING_TO_MOVE", `Không có task nào bạn chuyển được sang "${target.name}".`, 409);
    }
    await settleJob(tx, organizationId, workflow, jobId);
    return movedIds;
  });
  publishProductionChange(organizationId, jobId, moved, "tasks", context.user.id);
  return { moved: moved.length, job: await getJobDetail(context, jobId) };
};

// Feedback ------------------------------------------------------------------------------------------------

/** Account records client feedback: delivering tasks park in FEEDBACK until the re-done work is checked. */
export const createFeedback = async (context: AccessContext, jobId: string, input: In<typeof CreateFeedbackRequestSchema>) => {
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
        SELECT id FROM production.tasks WHERE organization_id = ${organizationId} AND job_id = ${jobId} AND status_id = ${delivering.id}
        ORDER BY created_at FOR UPDATE
      `
    ).map((row) => row.id);
    if (ids.length === 0) {
      throw new AppError("JOB_NOT_DELIVERING", "Chỉ ghi feedback khi job đang giao khách (Delivering).", 409);
    }
    if (input.sourceTaskId) {
      const source = await tx`SELECT 1 FROM production.tasks WHERE organization_id = ${organizationId} AND job_id = ${jobId} AND id = ${input.sourceTaskId}`;
      if (source.length === 0) {
        throw new AppError("SOURCE_TASK_INVALID", "Task gốc không thuộc job này.", 400);
      }
    }
    await tx`
      INSERT INTO production.feedbacks (organization_id, job_id, source_task_id, type, note, created_by)
      VALUES (${organizationId}, ${jobId}, ${input.sourceTaskId ?? null}, ${input.type}, ${input.note}, ${context.user.id})
    `;
    for (const task of await selectTasks(tx, organizationId, ids)) {
      await moveTask(tx, organizationId, workflow, task, feedback, context.user.id, `Feedback ${input.type === "WRONG" ? "sai" : "yêu cầu thêm"}: ${input.note}`.slice(0, 5000));
    }
    await settleJob(tx, organizationId, workflow, jobId);
    await enqueueProductionEvents(tx, [
      feedbackEvent(organizationId, jobId, context.user.id, { type: input.type, note: input.note, sourceTaskId: input.sourceTaskId ?? null })
    ]);
    return ids;
  });
  publishProductionChange(organizationId, jobId, movedIds, "feedback", context.user.id);
  return await getJobDetail(context, jobId);
};

/** "Giao lại": the job leader creates FB tasks (default assignee = the original one, chosen in the form). */
export const reassignFeedback = async (context: AccessContext, feedbackId: string, input: In<typeof ReassignFeedbackRequestSchema>) => {
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
    if (job.leader_id !== context.user.id && !isProductionAdmin(context)) {
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
  const workflow = await loadWorkflowModel(sql, organizationId);
  const rows = await selectTasks(sql, organizationId, result.ids);
  return { tasks: rows.map((row) => toProductionTask(row, workflow, relationOf(context, row))), warnings: result.warnings };
};
