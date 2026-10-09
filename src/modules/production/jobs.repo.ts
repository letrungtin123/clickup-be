import type { ProductionRole } from "../../contracts/production-catalog.js";
import { productionRoleCodes } from "../../contracts/production-catalog.js";
import type { FeedbackSchema, JobSummary, ProductionTask, TaskKind } from "../../contracts/production-jobs.js";
import { AppError } from "../../lib/app-error.js";
import { toIso, toNullableIso, type QuerySql } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { toColor, toUserRef, type UserRefJson } from "../work/mappers.js";
import { userJsonSql } from "../work/tasks.repo.js";
import { productionRolesOf } from "./access.js";
import { cachedConfig } from "./catalog-cache.js";
import { cursorTextSql } from "./cursor.js";
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
  job_leader_id: string;
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
    t.qty_assigned, t.qty_done, t.ot_hours::text, t.assigned_at, t.deadline, t.done_at, t.checked_at,
    st.id AS status_id, st.code AS status_code, st.name AS status_name, st.color AS status_color,
    t.kind, t.parent_task_id, t.feedback_id, t.note, t.is_late, t.qc_fail_count, t.custom_values,
    (SELECT array_agg(et.tag_id ORDER BY et.created_at) FROM production.entity_tags et
      WHERE et.organization_id = t.organization_id AND et.entity = 'TASK' AND et.entity_id = t.id) AS tag_ids,
    t.created_at, t.updated_at
  FROM production.tasks t
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
  isJobLeader: task.job_leader_id === context.user.id,
  jobHasOpenFeedback: task.job_open_feedback ?? false,
  jobArchived: task.job_archived ?? false
});

/** Who may see a task: its assignee, QC, the job leader, Account/Leader/Admin roles. */
export const canViewTask = (relation: TaskRelation) =>
  relation.isAssignee || relation.isQc || relation.isJobLeader || ["ACCOUNT", "LEADER", "ADMIN"].some((role) => relation.roles.has(role as ProductionRole));

export const canManageTask = (relation: TaskRelation) => relation.isJobLeader || relation.roles.has("ADMIN");

/** Account / Leader / Admin see every job (PD-014); others only jobs where they lead, work or check. */
export const canSeeAllJobs = (context: AccessContext) => {
  const roles = productionRolesOf(context);
  return roles.has("ADMIN") || roles.has("ACCOUNT") || roles.has("LEADER");
};

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
    throw new AppError("JOB_NOT_FOUND", "Không tìm thấy job.", 404);
  }
};

export const jobArchivedError = () => new AppError("JOB_ARCHIVED", "Job đã lưu trữ — khôi phục trước khi thay đổi.", 409);

export const toProductionTask = (row: TaskRow, workflow: Workflow, relation: TaskRelation): ProductionTask => {
  // Archived jobs are read-only (BUG-PR-04).
  const manage = canManageTask(relation) && !row.job_archived;
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
    isLate: row.is_late,
    jobArchived: row.job_archived,
    qcFailCount: row.qc_fail_count,
    customValues: row.custom_values as ProductionTask["customValues"],
    tagIds: row.tag_ids ?? [],
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
      canEdit: manage,
      canAssign: manage && row.checked_at === null,
      canEditQty: manage && row.done_at !== null
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
  leader_id: string;
  leader: UserRefJson;
  deadline: Date;
  total_images: number;
  drive_link: string | null;
  channel_id: string | null;
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
  custom_values: Record<string, unknown>;
  tag_ids: string[] | null;
  created_by: UserRefJson | null;
  created_at: Date;
  /** created_at at full (microsecond) precision, UTC — the list's keyset cursor (BUG-PR-05 / PR-16). */
  created_cursor: string;
  archived_at: Date | null;
};

export const jobSelectSql = (sql: QuerySql) => sql`
  SELECT j.id, j.number, j.code, j.name, p.id AS project_id, p.code AS project_code, p.name AS project_name, c.name AS client_name,
    ${cursorTextSql(sql, "j.created_at")} AS created_cursor,
    j.leader_id, (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = j.leader_id) AS leader,
    j.deadline, j.total_images, j.drive_link, j.channel_id,
    st.id AS status_id, st.code AS status_code, st.name AS status_name, st.color AS status_color,
    coalesce(agg.qty_assigned, 0)::int AS qty_assigned, coalesce(agg.qty_done, 0)::int AS qty_done,
    coalesce(agg.qty_checked, 0)::int AS qty_checked, coalesce(agg.task_count, 0)::int AS task_count,
    coalesce(agg.late_task_count, 0)::int AS late_task_count,
    (SELECT count(*)::int FROM production.feedbacks f WHERE f.organization_id = j.organization_id AND f.job_id = j.id AND f.status <> 'RESOLVED') AS open_feedback_count,
    j.custom_values,
    (SELECT array_agg(et.tag_id ORDER BY et.created_at) FROM production.entity_tags et
      WHERE et.organization_id = j.organization_id AND et.entity = 'JOB' AND et.entity_id = j.id) AS tag_ids,
    (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = j.created_by) AS created_by,
    j.created_at, j.archived_at
  FROM production.jobs j
  JOIN production.projects p ON p.organization_id = j.organization_id AND p.id = j.project_id
  LEFT JOIN production.clients c ON c.organization_id = j.organization_id AND c.id = p.client_id
  LEFT JOIN production.statuses st ON st.organization_id = j.organization_id AND st.id = j.status_id
  LEFT JOIN LATERAL (
    -- Image totals compare with total_images, so feedback redo tasks (FB_*) are not counted.
    SELECT sum(t.qty_assigned) FILTER (WHERE t.kind = 'NORMAL') AS qty_assigned,
      sum(coalesce(t.qty_done, 0)) FILTER (WHERE t.done_at IS NOT NULL AND t.kind = 'NORMAL') AS qty_done,
      sum(coalesce(t.qty_done, 0)) FILTER (WHERE t.checked_at IS NOT NULL AND t.kind = 'NORMAL') AS qty_checked,
      count(*) AS task_count,
      count(*) FILTER (WHERE t.is_late AND t.done_at IS NULL AND t.closed_at IS NULL) AS late_task_count
    FROM production.tasks t WHERE t.organization_id = j.organization_id AND t.job_id = j.id
  ) agg ON true
`;

export const toJobSummary = (row: JobRow): JobSummary => ({
  id: row.id,
  number: Number(row.number),
  code: row.code,
  name: row.name,
  project: { id: row.project_id, code: row.project_code, name: row.project_name, clientName: row.client_name },
  leader: toUserRef(row.leader)!,
  deadline: toIso(row.deadline),
  totalImages: row.total_images,
  driveLink: row.drive_link,
  channelId: row.channel_id,
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
    (SELECT array_agg(t.id ORDER BY t.created_at) FROM production.tasks t WHERE t.organization_id = f.organization_id AND t.feedback_id = f.id) AS task_ids
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
