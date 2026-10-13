import type { JobScopes, ProductionRole } from "../../contracts/production-catalog.js";
import { productionRoleCodes } from "../../contracts/production-catalog.js";
import type { FeedbackSchema, JobPeople, JobPersonShare, JobStatusRef, JobSummary, ProductionTask, TaskKind } from "../../contracts/production-jobs.js";
import { AppError } from "../../lib/app-error.js";
import { toIso, toNullableIso, type QuerySql } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { toColor, toUserRef, type UserRefJson } from "../work/mappers.js";
import { userJsonSql } from "../work/tasks.repo.js";
import { actsAsJobLeader, productionRolesOf } from "./access.js";
import { cachedConfig } from "./catalog-cache.js";
import { cursorTextSql } from "./cursor.js";
import { leadsForView, lineAllowed, loadJobScopes, ownJobsSql } from "./job-permissions.js";
import { allowedTransitions, finishedStatusIds, statusById, type TaskRelation, type Workflow } from "./workflow.js";
import type { z } from "zod";

/** Shared reads for production jobs and tasks (SPEC Phase 2). */

/** Statuses + transitions of the organization (cached per organization, PERF-14 — see catalog-cache.ts). */
export const loadWorkflowModel = (sql: QuerySql, organizationId: string): Promise<Workflow> =>
  cachedConfig("workflow", organizationId, () => readWorkflowModel(sql, organizationId));

const readWorkflowModel = async (sql: QuerySql, organizationId: string): Promise<Workflow> => {
  const [statuses, transitions] = await Promise.all([
    sql<
      {
        id: string;
        code: string;
        name: string;
        sort_order: number;
        counts_done: boolean;
        counts_checked: boolean;
        is_terminal: boolean;
        is_initial: boolean;
        set_by_roles: string[];
        active: boolean;
      }[]
    >`
      SELECT id, code, name, sort_order, counts_done, counts_checked, is_terminal, is_initial, set_by_roles, active
      FROM production.statuses WHERE organization_id = ${organizationId} ORDER BY sort_order
    `,
    sql<{ from_status_id: string; to_status_id: string; actors: string[]; requires_note: boolean }[]>`
      SELECT from_status_id, to_status_id, actors, requires_note
      FROM production.status_transitions WHERE organization_id = ${organizationId}
    `
  ]);
  const known = new Set<string>(productionRoleCodes);
  return {
    statuses: statuses.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      sortOrder: row.sort_order,
      countsDone: row.counts_done,
      countsChecked: row.counts_checked,
      isTerminal: row.is_terminal,
      isInitial: row.is_initial,
      setByRoles: row.set_by_roles.filter((role): role is ProductionRole => known.has(role)),
      active: row.active
    })),
    transitions: transitions.map((row) => ({
      fromStatusId: row.from_status_id,
      toStatusId: row.to_status_id,
      actors: row.actors as Workflow["transitions"][number]["actors"],
      requiresNote: row.requires_note
    }))
  };
};

/** Production roles of the given users (superadmins count as ADMIN). */
export const loadMemberRoles = async (sql: QuerySql, organizationId: string, userIds: string[]) => {
  const unique = [...new Set(userIds)];
  const result = new Map<string, Set<ProductionRole>>();
  if (unique.length === 0) {
    return result;
  }
  const rows = await sql<{ user_id: string; roles: string[] | null; superadmin: boolean }[]>`
    SELECT om.user_id,
      (SELECT array_agg(ur.role_code) FROM production.user_roles ur WHERE ur.organization_id = om.organization_id AND ur.user_id = om.user_id) AS roles,
      EXISTS (SELECT 1 FROM public.roles r WHERE r.id = om.role_id AND r.key = 'superadmin') AS superadmin
    FROM public.organization_memberships om
    JOIN public.app_users au ON au.id = om.user_id AND au.deleted_at IS NULL
    WHERE om.organization_id = ${organizationId} AND om.user_id = ANY(${unique}::uuid[])
      AND om.deleted_at IS NULL AND om.status = 'active'
  `;
  const known = new Set<string>(productionRoleCodes);
  for (const row of rows) {
    const roles = new Set((row.roles ?? []).filter((role): role is ProductionRole => known.has(role)));
    if (row.superadmin) {
      roles.add("ADMIN");
    }
    result.set(row.user_id, roles);
  }
  return result;
};

// Tasks -----------------------------------------------------------------------------------------------

export type TaskRow = {
  id: string;
  number: string | number;
  job_id: string;
  job_code: string;
  /** null: the job has no leader (PD-035). */
  job_leader_id: string | null;
  project_id: string;
  project_code: string;
  project_name: string;
  assignee_id: string;
  assignee: UserRefJson;
  qc_id: string | null;
  qc: UserRefJson | null;
  process_id: string;
  process_name: string;
  process_is_qc: boolean;
  shift_id: string;
  shift_name: string;
  pay_mode: "POINTS" | "MONEY_IF_KPI";
  requires_ot_hours: boolean;
  qty_assigned: number;
  qty_done: number | null;
  error_qty: number | null;
  ot_hours: string | null;
  assigned_at: Date;
  deadline: Date;
  done_at: Date | null;
  checked_at: Date | null;
  status_id: string;
  status_code: string;
  status_name: string;
  status_color: string;
  kind: TaskKind;
  parent_task_id: string | null;
  feedback_id: string | null;
  note: string | null;
  /** "Link chia việc" (PD-040). */
  work_link: string | null;
  is_late: boolean;
  qc_fail_count: number;
  custom_values: Record<string, unknown>;
  tag_ids: string[] | null;
  created_at: Date;
  updated_at: Date;
  /** Entered a finished status (Complete or later): no longer open work (BUG-PR-08). */
  closed_at: Date | null;
  /** deadline at full precision (keyset cursor of "Task của tôi"). */
  deadline_cursor: string;
  job_archived: boolean;
  /** The job has client feedback that is not resolved yet. */
  job_open_feedback: boolean;
};

export const taskSelectSql = (sql: QuerySql) => sql`
  SELECT t.id, t.number, t.job_id, j.code AS job_code, j.leader_id AS job_leader_id,
    t.closed_at, (j.archived_at IS NOT NULL) AS job_archived, ${cursorTextSql(sql, "t.deadline")} AS deadline_cursor,
    EXISTS (
      SELECT 1 FROM production.feedbacks f WHERE f.organization_id = t.organization_id AND f.job_id = t.job_id AND f.status <> 'RESOLVED'
    ) AS job_open_feedback,
    p.id AS project_id, p.code AS project_code, p.name AS project_name,
    t.assignee_id, (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = t.assignee_id) AS assignee,
    t.qc_id, (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = t.qc_id) AS qc,
    pr.id AS process_id, pr.name AS process_name, pr.is_qc AS process_is_qc,
    sh.id AS shift_id, sh.name AS shift_name, sh.pay_mode, sh.requires_ot_hours,
    t.qty_assigned, t.qty_done, t.error_qty, t.ot_hours::text, t.assigned_at, t.deadline, t.done_at, t.checked_at,
    st.id AS status_id, st.code AS status_code, st.name AS status_name, st.color AS status_color,
    t.kind, t.parent_task_id, t.feedback_id, t.note, t.work_link, t.is_late, t.qc_fail_count, t.custom_values,
    (SELECT array_agg(et.tag_id ORDER BY et.created_at) FROM production.entity_tags et
      WHERE et.organization_id = t.organization_id AND et.entity = 'TASK' AND et.entity_id = t.id) AS tag_ids,
    t.created_at, t.updated_at
  -- Deleted lines (PD-036) are kept for audit only: no read through this select ever shows them.
  FROM (SELECT * FROM production.tasks WHERE deleted_at IS NULL) t
  JOIN production.jobs j ON j.organization_id = t.organization_id AND j.id = t.job_id
  JOIN production.projects p ON p.organization_id = t.organization_id AND p.id = j.project_id
  JOIN production.processes pr ON pr.organization_id = t.organization_id AND pr.id = t.process_id
  JOIN production.shifts sh ON sh.organization_id = t.organization_id AND sh.id = t.shift_id
  JOIN production.statuses st ON st.organization_id = t.organization_id AND st.id = t.status_id
`;

/** Rows in the order of `ids` (callers rely on it: created tasks come back in input-line order). */
export const selectTasks = async (sql: QuerySql, organizationId: string, ids: string[]) => {
  if (ids.length === 0) {
    return [] as TaskRow[];
  }
  const rows = await sql<TaskRow[]>`${taskSelectSql(sql)} WHERE t.organization_id = ${organizationId} AND t.id = ANY(${ids}::uuid[])`;
  const position = new Map(ids.map((id, index) => [id, index]));
  return rows.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
};

export const loadTask = async (sql: QuerySql, organizationId: string, taskId: string) => {
  const row = (await selectTasks(sql, organizationId, [taskId]))[0];
  if (!row) {
    throw new AppError("TASK_NOT_FOUND", "Không tìm thấy task.", 404);
  }
  return row;
};

export const relationOf = (
  context: AccessContext,
  task: Pick<TaskRow, "assignee_id" | "qc_id" | "job_leader_id"> & Partial<Pick<TaskRow, "job_archived" | "job_open_feedback">>
): TaskRelation => ({
  roles: productionRolesOf(context),
  isAssignee: task.assignee_id === context.user.id,
  isQc: task.qc_id === context.user.id,
  // SEC2-04: leading the job counts only while the caller still holds LEADER (or ADMIN); a job without a leader is
  // led by every Leader / Admin (PD-035).
  isJobLeader: actsAsJobLeader(context, task.job_leader_id),
  jobHasOpenFeedback: task.job_open_feedback ?? false,
  jobArchived: task.job_archived ?? false
});

const taskNotFound = () => new AppError("TASK_NOT_FOUND", "Không tìm thấy task.", 404);

/**
 * 404 unless the caller may see the job (PD-036 "view"): "all", or "own" when a live line of it is theirs (assignee
 * or QC) or they lead it — a leader who lost the LEADER role no longer counts (SEC2-04). With "all" nothing is read:
 * callers load the job themselves (a missing or deleted job is a 404 there). Returns the caller's scopes for the
 * checks that follow.
 */
export const assertJobVisible = async (sql: QuerySql, context: AccessContext, jobId: string, scopes?: JobScopes): Promise<JobScopes> => {
  const mine = scopes ?? (await loadJobScopes(sql, context));
  if (mine.view === "all") {
    return mine;
  }
  const rows =
    mine.view === "none"
      ? []
      : await sql`
          SELECT 1 FROM production.jobs j
          WHERE j.organization_id = ${context.organization.id} AND j.id = ${jobId} AND j.deleted_at IS NULL
            AND ${ownJobsSql(sql, context)}
        `;
  if (rows.length === 0) {
    throw new AppError("JOB_NOT_FOUND", "Không tìm thấy job.", 404);
  }
  return mine;
};

/**
 * 404 unless the caller may see the task: its assignee and its QC always (it is their work — "Việc của tôi", the QC
 * queue and the workflow need it); anyone else through the job's view scope (assertJobVisible). Returns the scopes.
 */
export const assertTaskVisible = async (
  sql: QuerySql,
  context: AccessContext,
  task: Pick<TaskRow, "assignee_id" | "qc_id" | "job_id" | "job_leader_id">,
  scopes?: JobScopes
): Promise<JobScopes> => {
  const mine = scopes ?? (await loadJobScopes(sql, context));
  if (task.assignee_id === context.user.id || task.qc_id === context.user.id || mine.view === "all") {
    return mine;
  }
  if (mine.view === "own") {
    if (leadsForView(context, task.job_leader_id)) {
      return mine;
    }
    const rows = await sql`
      SELECT 1 FROM production.jobs j
      WHERE j.organization_id = ${context.organization.id} AND j.id = ${task.job_id} AND j.deleted_at IS NULL AND ${ownJobsSql(sql, context)}
    `;
    if (rows.length > 0) {
      return mine;
    }
  }
  throw taskNotFound();
};

/** The caller's access to tasks, for their capabilities (toProductionTask). */
export type TaskAccess = { scopes: JobScopes; userId: string };

export const jobArchivedError = () => new AppError("JOB_ARCHIVED", "Job đã lưu trữ — khôi phục trước khi thay đổi.", 409);

/** Per-caller extras of a task card (PLAN §7 "Task của tôi": điểm từng task, xem note QC). */
export type TaskExtras = Pick<ProductionTask, "myCredits" | "lastQcFail">;
const noExtras: TaskExtras = { myCredits: [], lastQcFail: null };

/**
 * The caller's recorded points (score ledger per role and pay mode, adjustments included) and the latest QC fail
 * (note, time, QC) of each task — two queries for a whole page of tasks.
 */
export const loadTaskExtras = async (sql: QuerySql, organizationId: string, userId: string, rows: readonly TaskRow[]) => {
  const result = new Map<string, TaskExtras>();
  if (rows.length === 0) {
    return result;
  }
  const ids = rows.map((row) => row.id);
  const failed = rows.filter((row) => row.qc_fail_count > 0).map((row) => row.id);
  const [credits, fails] = await Promise.all([
    sql<{ task_id: string; role: "WORKER" | "QC"; pay_mode: "POINTS" | "MONEY_IF_KPI"; credits: string; qty: number }[]>`
      SELECT task_id, role, pay_mode, sum(credits)::text AS credits, sum(qty)::int AS qty
      FROM production.score_entries
      WHERE organization_id = ${organizationId} AND user_id = ${userId} AND task_id = ANY(${ids}::uuid[])
      GROUP BY task_id, role, pay_mode
      ORDER BY task_id, role
    `,
    failed.length === 0
      ? Promise.resolve([])
      : sql<{ task_id: string; note: string | null; created_at: Date; by_user: UserRefJson | null }[]>`
          SELECT DISTINCT ON (l.task_id) l.task_id, l.note, l.created_at,
            (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = l.user_id) AS by_user
          FROM production.task_logs l
          WHERE l.organization_id = ${organizationId} AND l.task_id = ANY(${failed}::uuid[])
            AND l.action = 'STATUS' AND l.to_value @> '{"qcFail": true}'::jsonb
          ORDER BY l.task_id, l.created_at DESC, l.id DESC
        `
  ]);
  const extrasOf = (taskId: string) => {
    const entry = result.get(taskId) ?? { myCredits: [], lastQcFail: null };
    result.set(taskId, entry);
    return entry;
  };
  for (const row of credits) {
    extrasOf(row.task_id).myCredits.push({ role: row.role, credits: Number(row.credits), qty: row.qty, payMode: row.pay_mode });
  }
  for (const row of fails) {
    extrasOf(row.task_id).lastQcFail = { note: row.note, at: toIso(row.created_at), by: toUserRef(row.by_user) };
  }
  return result;
};

/** Task rows → API tasks for the caller, with the card extras (loadTaskExtras) and their capabilities. */
export const toProductionTasks = async (sql: QuerySql, context: AccessContext, workflow: Workflow, rows: readonly TaskRow[], scopes?: JobScopes) => {
  const [extras, mine] = await Promise.all([
    loadTaskExtras(sql, context.organization.id, context.user.id, rows),
    scopes ? Promise.resolve(scopes) : loadJobScopes(sql, context)
  ]);
  const access: TaskAccess = { scopes: mine, userId: context.user.id };
  return rows.map((row) => toProductionTask(row, workflow, relationOf(context, row), access, extras.get(row.id)));
};

/**
 * What the caller may do with a line besides workflow moves (PD-036 matrix; archived jobs are read-only, BUG-PR-04):
 * edit its fields ("update" all / own line), change its QC (same, until Checked), give it to someone else (update
 * "all", before Done), correct its Done quantity (update "all", after Done — it changes scores) and delete it.
 */
export const taskCapabilities = (row: Pick<TaskRow, "assignee_id" | "job_archived" | "done_at" | "checked_at">, access: TaskAccess) => {
  const live = !row.job_archived;
  const mine = row.assignee_id === access.userId;
  const canEdit = live && lineAllowed(access.scopes.update, mine);
  return {
    canEdit,
    canAssign: canEdit && row.checked_at === null,
    canChangeAssignee: canEdit && access.scopes.update === "all" && row.done_at === null,
    canEditQty: live && access.scopes.update === "all" && row.done_at !== null,
    canDelete: live && lineAllowed(access.scopes.delete, mine)
  };
};

export const toProductionTask = (row: TaskRow, workflow: Workflow, relation: TaskRelation, access: TaskAccess, extras: TaskExtras = noExtras): ProductionTask => {
  const doneStatusIds = new Set(workflow.statuses.filter((status) => status.countsDone).map((status) => status.id));
  return {
    id: row.id,
    number: Number(row.number),
    jobId: row.job_id,
    jobCode: row.job_code,
    project: { id: row.project_id, code: row.project_code, name: row.project_name },
    assignee: toUserRef(row.assignee)!,
    qc: toUserRef(row.qc),
    process: { id: row.process_id, name: row.process_name, isQc: row.process_is_qc },
    shift: { id: row.shift_id, name: row.shift_name, payMode: row.pay_mode, requiresOtHours: row.requires_ot_hours },
    qtyAssigned: row.qty_assigned,
    qtyDone: row.qty_done,
    errorQty: row.error_qty,
    otHours: row.ot_hours === null ? null : Number(row.ot_hours),
    assignedAt: toIso(row.assigned_at),
    deadline: toIso(row.deadline),
    doneAt: toNullableIso(row.done_at),
    checkedAt: toNullableIso(row.checked_at),
    status: { id: row.status_id, code: row.status_code, name: row.status_name, color: toColor(row.status_color) },
    kind: row.kind,
    parentTaskId: row.parent_task_id,
    feedbackId: row.feedback_id,
    note: row.note,
    workLink: row.work_link,
    isLate: row.is_late,
    jobArchived: row.job_archived,
    qcFailCount: row.qc_fail_count,
    customValues: row.custom_values as ProductionTask["customValues"],
    tagIds: row.tag_ids ?? [],
    myCredits: extras.myCredits,
    lastQcFail: extras.lastQcFail,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    capabilities: {
      transitions: allowedTransitions(workflow, row.status_id, relation).map((option) => {
        // Quantity / OT hours are asked only at the first Done (they are locked afterwards, PD-014).
        const entersDone = doneStatusIds.has(option.toStatusId) && !doneStatusIds.has(row.status_id) && row.done_at === null;
        return {
          ...option,
          asksQty: entersDone,
          asksOtHours: entersDone && row.requires_ot_hours
        };
      }),
      ...taskCapabilities(row, access)
    }
  };
};

/** Statuses that count as "finished" for personal boards: from COMPLETE onwards (workflow.ts). */
export { finishedStatusIds, statusById };

// Jobs ------------------------------------------------------------------------------------------------

export type JobRow = {
  id: string;
  number: string | number;
  code: string;
  name: string | null;
  project_id: string;
  project_code: string;
  project_name: string;
  client_name: string | null;
  /** null: no leader (PD-035). */
  leader_id: string | null;
  leader: UserRefJson | null;
  received_at: Date;
  deadline: Date;
  total_images: number;
  total_images_manual: boolean;
  drive_link: string | null;
  channel_id: string | null;
  /** Manual job status (PD-038). */
  job_status_id: string;
  job_status_name: string;
  job_status_color: string;
  job_status_closed: boolean;
  /** Derived workflow status (internal, PD-014). */
  status_id: string | null;
  status_code: string | null;
  status_name: string | null;
  status_color: string | null;
  qty_assigned: number;
  qty_done: number;
  qty_checked: number;
  task_count: number;
  late_task_count: number;
  open_feedback_count: number;
  /** Distinct task assignees, most images first (null: no task). */
  workers: { user: UserRefJson; qty: number; task_count: number }[] | null;
  /** Distinct task QC people, by name (null: none). */
  qc_people: UserRefJson[] | null;
  /** The `personId` person's part of the job (job list per-person view); null otherwise. */
  person_share: { processes: string[] | null; task_count: number; qty_assigned: number; qty_done: number; qty_checked: number } | null;
  custom_values: Record<string, unknown>;
  tag_ids: string[] | null;
  created_by: UserRefJson | null;
  created_at: Date;
  /** created_at at full (microsecond) precision, UTC — the list's keyset cursor (BUG-PR-05 / PR-16). */
  created_cursor: string;
  archived_at: Date | null;
};

/**
 * Job rows (list and detail). With `personId` (job list per-person view) each row also carries that person's
 * part of the job: their own tasks' processes and quantities.
 */
export const jobSelectSql = (sql: QuerySql, personId?: string) => sql`
  SELECT j.id, j.number, j.code, j.name, p.id AS project_id, p.code AS project_code, p.name AS project_name, c.name AS client_name,
    ${cursorTextSql(sql, "j.created_at")} AS created_cursor,
    j.leader_id, (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = j.leader_id) AS leader,
    j.received_at, j.deadline, j.total_images, j.total_images_manual, j.drive_link, j.channel_id,
    js.id AS job_status_id, js.name AS job_status_name, js.color AS job_status_color, js.is_closed AS job_status_closed,
    st.id AS status_id, st.code AS status_code, st.name AS status_name, st.color AS status_color,
    coalesce(agg.qty_assigned, 0)::int AS qty_assigned, coalesce(agg.qty_done, 0)::int AS qty_done,
    coalesce(agg.qty_checked, 0)::int AS qty_checked, coalesce(agg.task_count, 0)::int AS task_count,
    coalesce(agg.late_task_count, 0)::int AS late_task_count,
    (SELECT count(*)::int FROM production.feedbacks f WHERE f.organization_id = j.organization_id AND f.job_id = j.id AND f.status <> 'RESOLVED') AS open_feedback_count,
    people.workers, people.qc_people,
    ${personId ? sql`mine.person_share` : sql`NULL::json AS person_share`},
    j.custom_values,
    (SELECT array_agg(et.tag_id ORDER BY et.created_at) FROM production.entity_tags et
      WHERE et.organization_id = j.organization_id AND et.entity = 'JOB' AND et.entity_id = j.id) AS tag_ids,
    (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = j.created_by) AS created_by,
    j.created_at, j.archived_at
  FROM production.jobs j
  JOIN production.projects p ON p.organization_id = j.organization_id AND p.id = j.project_id
  LEFT JOIN production.clients c ON c.organization_id = j.organization_id AND c.id = p.client_id
  JOIN production.job_statuses js ON js.organization_id = j.organization_id AND js.id = j.job_status_id
  LEFT JOIN production.statuses st ON st.organization_id = j.organization_id AND st.id = j.status_id
  LEFT JOIN LATERAL (
    -- Image totals compare with total_images, so feedback redo tasks (FB_*) and Checking lines (they check the same
    -- images) are not counted. Checked = lines checked by their QC, or Checking lines that are Done (PD-037).
    SELECT sum(t.qty_assigned) FILTER (WHERE t.kind = 'NORMAL' AND NOT tp.is_qc) AS qty_assigned,
      sum(coalesce(t.qty_done, 0)) FILTER (WHERE t.done_at IS NOT NULL AND t.kind = 'NORMAL' AND NOT tp.is_qc) AS qty_done,
      sum(coalesce(t.qty_done, 0)) FILTER (WHERE t.kind = 'NORMAL' AND (t.checked_at IS NOT NULL OR (tp.is_qc AND t.done_at IS NOT NULL))) AS qty_checked,
      count(*) AS task_count,
      count(*) FILTER (WHERE t.is_late AND t.done_at IS NULL AND t.closed_at IS NULL) AS late_task_count
    FROM production.tasks t
    JOIN production.processes tp ON tp.organization_id = t.organization_id AND tp.id = t.process_id
    WHERE t.organization_id = j.organization_id AND t.job_id = j.id AND t.deleted_at IS NULL
  ) agg ON true
  LEFT JOIN LATERAL (
    -- "Người làm": every task of the job (feedback redo included), like the job detail's task list (PD-014).
    -- Per job of the page, through production_tasks_job_idx (a few rows each).
    SELECT
      (SELECT json_agg(json_build_object('user', ${userJsonSql(sql)}, 'qty', w.qty, 'task_count', w.task_count) ORDER BY w.qty DESC, au.display_name, au.id)
        FROM (
          SELECT t.assignee_id, sum(t.qty_assigned)::int AS qty, count(*)::int AS task_count
          FROM production.tasks t WHERE t.organization_id = j.organization_id AND t.job_id = j.id AND t.deleted_at IS NULL
          GROUP BY t.assignee_id
        ) w
        JOIN public.app_users au ON au.id = w.assignee_id) AS workers,
      (SELECT json_agg(${userJsonSql(sql)} ORDER BY au.display_name, au.id)
        FROM (
          SELECT t.qc_id FROM production.tasks t
          WHERE t.organization_id = j.organization_id AND t.job_id = j.id AND t.qc_id IS NOT NULL AND t.deleted_at IS NULL
          GROUP BY t.qc_id
        ) q
        JOIN public.app_users au ON au.id = q.qc_id) AS qc_people
  ) people ON true
  ${personId ? personShareSql(sql, personId) : sql``}
`;

/** The person's own tasks of the job `j` (assignee only), through production_tasks_job_idx. */
const personShareSql = (sql: QuerySql, personId: string) => sql`
  LEFT JOIN LATERAL (
    SELECT json_build_object(
      'processes', (
        SELECT array_agg(pr.name ORDER BY pr.sort_order, pr.name) FROM production.processes pr
        WHERE pr.organization_id = j.organization_id
          AND pr.id IN (
            SELECT t2.process_id FROM production.tasks t2
            WHERE t2.organization_id = j.organization_id AND t2.job_id = j.id AND t2.assignee_id = ${personId} AND t2.deleted_at IS NULL
          )
      ),
      'task_count', count(*),
      'qty_assigned', coalesce(sum(t.qty_assigned), 0),
      'qty_done', coalesce(sum(coalesce(t.qty_done, 0)) FILTER (WHERE t.done_at IS NOT NULL), 0),
      'qty_checked', coalesce(sum(coalesce(t.qty_done, 0)) FILTER (WHERE t.checked_at IS NOT NULL OR (tp.is_qc AND t.done_at IS NOT NULL)), 0)
    ) AS person_share
    FROM production.tasks t
    JOIN production.processes tp ON tp.organization_id = t.organization_id AND tp.id = t.process_id
    WHERE t.organization_id = j.organization_id AND t.job_id = j.id AND t.assignee_id = ${personId} AND t.deleted_at IS NULL
  ) mine ON true
`;

export const toJobPersonShare = (share: JobRow["person_share"]): JobPersonShare | null =>
  share
    ? {
        processes: share.processes ?? [],
        taskCount: Number(share.task_count),
        qtyAssigned: Number(share.qty_assigned),
        qtyDone: Number(share.qty_done),
        qtyChecked: Number(share.qty_checked)
      }
    : null;

/** Job people summary from the row's aggregates (empty lists before the job is split). */
export const toJobPeople = (row: Pick<JobRow, "workers" | "qc_people">): JobPeople => ({
  workers: (row.workers ?? []).map((worker) => ({ user: toUserRef(worker.user)!, qty: worker.qty, taskCount: worker.task_count })),
  qc: (row.qc_people ?? []).map((user) => toUserRef(user)!)
});

/** The manual job status columns (PD-038) of a row as the API ref. */
export const toJobStatusRef = (row: Pick<JobRow, "job_status_id" | "job_status_name" | "job_status_color" | "job_status_closed">): JobStatusRef => ({
  id: row.job_status_id,
  name: row.job_status_name,
  color: toColor(row.job_status_color),
  isClosed: row.job_status_closed
});

export const toJobSummary = (row: JobRow): JobSummary => ({
  id: row.id,
  number: Number(row.number),
  code: row.code,
  name: row.name,
  project: { id: row.project_id, code: row.project_code, name: row.project_name, clientName: row.client_name },
  leader: toUserRef(row.leader),
  receivedAt: toIso(row.received_at),
  deadline: toIso(row.deadline),
  totalImages: row.total_images,
  totalImagesManual: row.total_images_manual,
  driveLink: row.drive_link,
  channelId: row.channel_id,
  jobStatus: toJobStatusRef(row),
  status:
    row.status_id && row.status_code && row.status_name
      ? { id: row.status_id, code: row.status_code, name: row.status_name, color: toColor(row.status_color ?? "slate") }
      : null,
  qtyAssigned: row.qty_assigned,
  qtyDone: row.qty_done,
  qtyChecked: row.qty_checked,
  taskCount: row.task_count,
  lateTaskCount: row.late_task_count,
  openFeedbackCount: row.open_feedback_count,
  people: toJobPeople(row),
  personShare: toJobPersonShare(row.person_share ?? null),
  customValues: row.custom_values as JobSummary["customValues"],
  tagIds: row.tag_ids ?? [],
  createdBy: toUserRef(row.created_by),
  createdAt: toIso(row.created_at),
  archived: row.archived_at !== null
});

export type FeedbackRow = {
  id: string;
  job_id: string;
  source_task_id: string | null;
  type: "WRONG" | "EXTRA";
  note: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  created_by: UserRefJson | null;
  created_at: Date;
  resolved_at: Date | null;
  resolution: "REWORKED" | "CLOSED" | null;
  resolved_by: UserRefJson | null;
  resolution_note: string | null;
  task_ids: string[] | null;
};

export const selectFeedbacks = (sql: QuerySql, organizationId: string, jobId: string) => sql<FeedbackRow[]>`
  SELECT f.id, f.job_id, f.source_task_id, f.type, f.note, f.status, f.created_at, f.resolved_at, f.resolution, f.resolution_note,
    (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = f.created_by) AS created_by,
    (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = f.resolved_by) AS resolved_by,
    (SELECT array_agg(t.id ORDER BY t.created_at) FROM production.tasks t
      WHERE t.organization_id = f.organization_id AND t.feedback_id = f.id AND t.deleted_at IS NULL) AS task_ids
  FROM production.feedbacks f
  WHERE f.organization_id = ${organizationId} AND f.job_id = ${jobId}
  ORDER BY f.created_at DESC
`;

export const toFeedback = (row: FeedbackRow): z.infer<typeof FeedbackSchema> => ({
  id: row.id,
  jobId: row.job_id,
  sourceTaskId: row.source_task_id,
  type: row.type,
  note: row.note,
  status: row.status,
  createdBy: toUserRef(row.created_by),
  createdAt: toIso(row.created_at),
  resolvedAt: toNullableIso(row.resolved_at),
  resolution: row.resolution,
  resolvedBy: toUserRef(row.resolved_by),
  resolutionNote: row.resolution_note,
  taskIds: row.task_ids ?? []
});
