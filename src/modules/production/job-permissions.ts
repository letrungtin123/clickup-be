import {
  effectiveJobScopes,
  jobPermissionRoles,
  type JobPermissionMatrix,
  type JobPermissionScope,
  type JobScopes,
  type ProductionRole
} from "../../contracts/production-catalog.js";
import { AppError } from "../../lib/app-error.js";
import type { QuerySql } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { hasProductionRole, leadsJob, productionRolesOf } from "./access.js";
import { loadSettings } from "./catalog.service.js";

/**
 * Job permission matrix (PD-036): CRUD of jobs and their lines by production role × action (view / create / update /
 * delete) with a scope none / own / all, configured in "Cấu hình → Phân quyền Job" (setting `job_permissions`). A user's
 * scope is the most permissive over their roles; ADMIN is always "all". Workflow moves are not part of it (PD-014).
 * The pure rules below are unit tested; services load the scopes with `loadJobScopes` and call them.
 */

/** The caller's scopes (settings are cached per organization). */
export const loadJobScopes = async (sql: QuerySql, context: AccessContext): Promise<JobScopes> =>
  effectiveJobScopes(productionRolesOf(context), (await loadSettings(sql, context.organization.id)).jobPermissions);

/** Roles whose `action` scope is "all" (ADMIN always), e.g. who sees every job. */
export const rolesWithAll = (matrix: JobPermissionMatrix, action: keyof JobScopes): ProductionRole[] => [
  "ADMIN",
  ...jobPermissionRoles.filter((role) => matrix[role][action] === "all")
];

/** May see a job: "all", or "own" when I work on / check one of its lines or lead it. */
export const jobViewAllowed = (scope: JobPermissionScope, relation: { involved: boolean; leads: boolean }) =>
  scope === "all" || (scope === "own" && (relation.involved || relation.leads));

/** A line: "all", or "own" when it is assigned to me. */
export const lineAllowed = (scope: JobPermissionScope, mine: boolean) => scope === "all" || (scope === "own" && mine);

/** A job's own fields, or the whole job: "all", or "own" when it has lines and every one of them is mine. */
export const wholeJobAllowed = (scope: JobPermissionScope, assigneeIds: readonly string[], me: string) =>
  scope === "all" || (scope === "own" && assigneeIds.length > 0 && assigneeIds.every((id) => id === me));

/**
 * The manual job status (PD-038): "update: all", or "own" when I am the assignee of at least one live line of the job,
 * or its leader (explicit leadership while holding LEADER / ADMIN, like "own" view). ADMIN's scope is always "all".
 */
export const jobStatusChangeAllowed = (scope: JobPermissionScope, relation: { assignee: boolean; leads: boolean }) =>
  scope === "all" || (scope === "own" && (relation.assignee || relation.leads));

/**
 * PD-044 "Số lượng giao" of a line (before Done) is the Leader's number: changed directly by the job's Leader (`leads`,
 * actsAsJobLeader) or "update: all", and by its worker only on a line they entered themselves; otherwise the worker sends
 * a request the Leader approves (POST …/qty-requests). A subtask's quantity moves between it and its line, so its worker,
 * the Leader or "update: all" may change it.
 */
export const qtyAssignedEditAllowed = (input: {
  leads: boolean;
  updateScope: JobPermissionScope;
  mine: boolean;
  createdByMe: boolean;
  subtask: boolean;
}) => input.leads || input.updateScope === "all" || (input.mine && (input.subtask || input.createdByMe));

/**
 * PD-058 filling in a quantity that is still empty ("chưa có số lượng"): its assignee directly — no request, no approval —
 * and anyone who may already change "Số lượng giao" (qtyAssignedEditAllowed). The job's Leader is notified.
 */
export const qtyFillAllowed = (input: Parameters<typeof qtyAssignedEditAllowed>[0]) => input.mine || qtyAssignedEditAllowed(input);

/**
 * PD-044 the Done quantity after Done: "update: all" at any time (scores are adjusted, unchanged), and the line's worker
 * until QC checked it ("Đã check") — a subtask has its own Done quantity.
 */
export const doneQtyEditAllowed = (input: { updateScope: JobPermissionScope; mine: boolean; done: boolean; checked: boolean }) =>
  input.done && (input.updateScope === "all" || (input.mine && !input.checked));

/**
 * PD-044 subtasks: their line's worker, the job's Leader or "update: all" split a line, and edit / delete a subtask while
 * the line is not Done (deleting one after Done needs "delete: all", see deleteProductionTask).
 */
export const subtaskManageAllowed = (input: { leads: boolean; updateScope: JobPermissionScope; mine: boolean }) =>
  input.mine || input.leads || input.updateScope === "all";

/**
 * PD-044 deleting a subtask: before its line's Done its worker, the job's Leader or the "delete" scope (all / own line);
 * after Done only "delete: all" (it reverses recorded points). PD-047: the worker deletes their own subtasks before Done
 * whatever the delete scope (STAFF has "delete: none" by default, so they never delete the lines the Leader split).
 */
export const subtaskDeleteAllowed = (input: { leads: boolean; deleteScope: JobPermissionScope; mine: boolean; done: boolean }) =>
  input.done ? input.deleteScope === "all" : input.mine || input.leads || lineAllowed(input.deleteScope, input.mine);

/** "Nhập công việc" and its job picker (GET /production/jobs/options): "create" own or all. */
export const workEntryAllowed = (scope: JobPermissionScope) => scope !== "none";

/** New lines: "all" for anyone, "own" only for myself. Returns the problems ("Task N: …"); empty = allowed. */
export const lineCreateErrors = (scope: JobPermissionScope, assigneeIds: readonly string[], me: string) => {
  if (scope === "all") {
    return [];
  }
  if (scope === "none") {
    return ["Bạn không có quyền tạo công việc."];
  }
  return assigneeIds.flatMap((id, index) => (id === me ? [] : [`Task ${index + 1}: bạn chỉ tạo được công việc của chính mình.`]));
};

export const assertLinesCreatable = (scopes: JobScopes, assigneeIds: readonly string[], me: string) => {
  const errors = lineCreateErrors(scopes.create, assigneeIds, me);
  if (errors.length > 0) {
    throw new AppError("FORBIDDEN", errors.join(" "), 403);
  }
};

export const forbidden = (message: string) => new AppError("FORBIDDEN", message, 403);

/**
 * "own" view on the job alias `j`: a live line of the job is mine (assignee or QC), or I lead it (while holding LEADER
 * or ADMIN, SEC2-04). Expects `j` = production.jobs.
 */
export const ownJobsSql = (sql: QuerySql, context: AccessContext) => sql`(
  EXISTS (
    SELECT 1 FROM production.tasks t
    WHERE t.organization_id = j.organization_id AND t.job_id = j.id AND t.deleted_at IS NULL
      AND (t.assignee_id = ${context.user.id} OR t.qc_id = ${context.user.id})
  )
  ${hasProductionRole(context, "LEADER", "ADMIN") ? sql`OR j.leader_id = ${context.user.id}` : sql``}
)`;

/** The view-scope filter of job lists on `j` (none → nothing: callers refuse "none" first). */
export const jobViewSql = (sql: QuerySql, context: AccessContext, scopes: JobScopes) =>
  scopes.view === "all" ? sql`true` : scopes.view === "own" ? ownJobsSql(sql, context) : sql`false`;

/** Whether I lead the job for "own" view (explicit leadership only; an unled job is not "mine"). */
export const leadsForView = (context: AccessContext, leaderId: string | null) => leadsJob(context, leaderId);
