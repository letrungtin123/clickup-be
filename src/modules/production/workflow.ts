import type { ProductionRole, TransitionActor } from "../../contracts/production-catalog.js";
import { AppError } from "../../lib/app-error.js";

/**
 * Production workflow rules (SPEC Phase 2 §2) as pure functions: who may move a task between two
 * statuses, what a move needs, the job status derived from its tasks, and task-line validation.
 * Services load the data and call these; unit tests cover them without a database.
 */

export type WorkflowStatus = {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  countsDone: boolean;
  countsChecked: boolean;
  isTerminal: boolean;
  isInitial: boolean;
  setByRoles: ProductionRole[];
  active: boolean;
};

export type WorkflowTransition = { fromStatusId: string; toStatusId: string; actors: TransitionActor[]; requiresNote: boolean };

export type Workflow = { statuses: WorkflowStatus[]; transitions: WorkflowTransition[] };

/** Codes the engine relies on; admins may rename them but not change or deactivate them. */
export const systemStatusCodes = ["ASSIGNED", "PROCESSING", "DONE", "WAITING_QC", "CHECKED", "COMPLETE", "DELIVERING", "FEEDBACK", "DELIVERED"] as const;
export type SystemStatusCode = (typeof systemStatusCodes)[number];

/** The caller's relation to one task. `roles` already includes ADMIN for organization superadmins. */
export type TaskRelation = {
  roles: ReadonlySet<ProductionRole>;
  isAssignee: boolean;
  isQc: boolean;
  isJobLeader: boolean;
};

export const statusById = (workflow: Workflow, id: string) => workflow.statuses.find((status) => status.id === id);

export const statusByCode = (workflow: Workflow, code: SystemStatusCode) => {
  const status = workflow.statuses.find((item) => item.code === code && item.active);
  if (!status) {
    throw new AppError("WORKFLOW_INCOMPLETE", `Thiếu trạng thái ${code} trong cấu hình quy trình.`, 409);
  }
  return status;
};

const actorMatches = (actor: TransitionActor, relation: TaskRelation) => {
  switch (actor) {
    case "ASSIGNEE":
      return relation.isAssignee;
    case "QC":
      return relation.isQc;
    case "JOB_LEADER":
      return relation.isJobLeader;
    // Role-based actors: ADMIN holds every role's rights. Relation-based ones above need the relation.
    case "ACCOUNT":
      return relation.roles.has("ACCOUNT") || relation.roles.has("ADMIN");
    case "LEADER":
      return relation.roles.has("LEADER") || relation.roles.has("ADMIN");
    case "SYSTEM":
      return false;
  }
};

const holdsSetByRole = (status: WorkflowStatus, relation: TaskRelation) =>
  status.setByRoles.length === 0 || relation.roles.has("ADMIN") || status.setByRoles.some((role) => relation.roles.has(role));

export type TransitionOption = { toStatusId: string; requiresNote: boolean; override: boolean };

/**
 * Moves the caller may make from `fromStatusId`: listed transitions whose actor matches the caller and
 * whose target status the caller's roles may set. ADMIN may additionally force any move (override,
 * reason required). SYSTEM-only transitions are never offered to people.
 */
export const allowedTransitions = (workflow: Workflow, fromStatusId: string, relation: TaskRelation): TransitionOption[] => {
  const options = new Map<string, TransitionOption>();
  for (const transition of workflow.transitions) {
    if (transition.fromStatusId !== fromStatusId) {
      continue;
    }
    const target = statusById(workflow, transition.toStatusId);
    if (!target?.active) {
      continue;
    }
    if (transition.actors.some((actor) => actorMatches(actor, relation)) && holdsSetByRole(target, relation)) {
      options.set(target.id, { toStatusId: target.id, requiresNote: transition.requiresNote, override: false });
    }
  }
  if (relation.roles.has("ADMIN")) {
    for (const status of workflow.statuses) {
      if (status.active && status.id !== fromStatusId && !options.has(status.id)) {
        options.set(status.id, { toStatusId: status.id, requiresNote: true, override: true });
      }
    }
  }
  return [...options.values()].sort(
    (a, b) => (statusById(workflow, a.toStatusId)?.sortOrder ?? 0) - (statusById(workflow, b.toStatusId)?.sortOrder ?? 0)
  );
};

/** Validates one requested move; throws 400 with a Vietnamese message when it is not allowed. */
export const assertTransition = (
  workflow: Workflow,
  fromStatusId: string,
  toStatusId: string,
  relation: TaskRelation,
  note: string | undefined
): TransitionOption => {
  const option = allowedTransitions(workflow, fromStatusId, relation).find((item) => item.toStatusId === toStatusId);
  if (!option) {
    const from = statusById(workflow, fromStatusId)?.name ?? "?";
    const to = statusById(workflow, toStatusId)?.name ?? "?";
    throw new AppError("TRANSITION_NOT_ALLOWED", `Bạn không thể chuyển task từ "${from}" sang "${to}".`, 400);
  }
  if (option.requiresNote && !note?.trim()) {
    throw new AppError("NOTE_REQUIRED", option.override ? "Quản trị cần nhập lý do khi chuyển trạng thái ngoài luồng." : "Cần nhập ghi chú cho bước chuyển này.", 400);
  }
  return option;
};

/** SYSTEM follow-up after entering a status: Done → Waiting QC as soon as a QC is assigned. */
export const systemFollowUp = (workflow: Workflow, statusId: string, hasQc: boolean): WorkflowStatus | null => {
  if (!hasQc) {
    return null;
  }
  const waiting = workflow.statuses.find((status) => status.code === "WAITING_QC" && status.active);
  if (!waiting) {
    return null;
  }
  const transition = workflow.transitions.find(
    (item) => item.fromStatusId === statusId && item.toStatusId === waiting.id && item.actors.includes("SYSTEM")
  );
  return transition ? waiting : null;
};

/**
 * Job status = FEEDBACK while client feedback is open, otherwise the least advanced status among
 * its tasks (so a job is Delivered only when every task is). No tasks yet → null ("chưa chia").
 */
export const deriveJobStatus = (workflow: Workflow, taskStatusIds: string[], hasOpenFeedback: boolean): string | null => {
  if (hasOpenFeedback) {
    return workflow.statuses.find((status) => status.code === "FEEDBACK")?.id ?? null;
  }
  let least: WorkflowStatus | undefined;
  for (const id of taskStatusIds) {
    const status = statusById(workflow, id);
    if (status && (!least || status.sortOrder < least.sortOrder)) {
      least = status;
    }
  }
  return least?.id ?? null;
};

// Task lines ------------------------------------------------------------------------------------------

export type TaskLineInput = { assigneeId: string; qcId?: string | null | undefined; processId: string; shiftId: string; qtyAssigned: number };

export type TaskLineContext = {
  callerId: string;
  memberRoles: ReadonlyMap<string, ReadonlySet<ProductionRole>>;
  processes: ReadonlyMap<string, { active: boolean; isQc: boolean; name: string }>;
  shifts: ReadonlyMap<string, { active: boolean }>;
};

/** SPEC Phase 2 §2 + PLAN §10: returns the problems of one task line (empty = valid). */
export const taskLineErrors = (line: TaskLineInput, context: TaskLineContext): string[] => {
  const errors: string[] = [];
  const assigneeRoles = context.memberRoles.get(line.assigneeId);
  if (!assigneeRoles || !(assigneeRoles.has("STAFF") || assigneeRoles.has("LEADER"))) {
    errors.push("Người làm phải có vai trò Nhân viên hoặc Leader.");
  }
  if (line.qcId) {
    const qcRoles = context.memberRoles.get(line.qcId);
    if (!qcRoles?.has("QC")) {
      errors.push("Người QC phải có vai trò QC.");
    }
    if (line.qcId === line.assigneeId) {
      errors.push("QC phải khác người làm.");
    }
  } else if (line.assigneeId === context.callerId) {
    errors.push("Leader tự giao cho mình thì phải chọn QC là người khác.");
  }
  const process = context.processes.get(line.processId);
  if (!process?.active) {
    errors.push("Quy trình không tồn tại hoặc đã ngừng.");
  } else if (process.isQc) {
    errors.push(`"${process.name}" là quy trình QC — điểm QC được ghi tự động khi Checked, không giao như task.`);
  }
  if (!context.shifts.get(line.shiftId)?.active) {
    errors.push("Ca làm không tồn tại hoặc đã ngừng.");
  }
  return errors;
};

/** Over-allocation is allowed but warned and logged (SPEC Phase 2 §2). */
export const overAllocationWarning = (totalImages: number, alreadyAssigned: number, adding: number) => {
  const total = alreadyAssigned + adding;
  return total > totalImages ? `Tổng số tấm đã giao (${total}) vượt tổng tấm của job (${totalImages}).` : null;
};
