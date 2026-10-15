import { describe, expect, it } from "vitest";

import type { ProductionRole } from "../../contracts/production-catalog.js";
import { AppError } from "../../lib/app-error.js";
import {
  allowedTransitions,
  assertDeclaredDoneQty,
  assertTransition,
  computeIsLate,
  defaultTaskDeadline,
  deriveJobStatus,
  feedbackTaskDeadline,
  isLineFinished,
  isQcFail,
  isSubtask,
  jobLinesReady,
  jobNotReadyMessage,
  lineFinishStatusIds,
  maxDeclaredDoneQty,
  overAllocationWarning,
  qcMissingMessage,
  qtyRequestProblem,
  subtaskProcessProblem,
  subtaskQtyProblem,
  systemFollowUp,
  taskLineErrors,
  type TaskRelation,
  type Workflow,
  type WorkflowStatus
} from "./workflow.js";

// The default workflow seeded by 20261009_2100_production_catalog.sql, as changed by 20261013_0120 (Done → Complete for
// lines without QC) and 20261014_0200 (PD-044: "Cần sửa lại", "Đang check", "Đã check").
const status = (code: string, sortOrder: number, setByRoles: ProductionRole[], flags: Partial<WorkflowStatus> = {}): WorkflowStatus => ({
  id: code,
  code,
  name: code,
  sortOrder,
  countsDone: false,
  countsChecked: false,
  isTerminal: false,
  isInitial: false,
  setByRoles,
  active: true,
  ...flags
});
const workflow: Workflow = {
  statuses: [
    status("ASSIGNED", 1, ["LEADER"], { isInitial: true }),
    status("REWORK", 2, ["QC"]),
    status("PROCESSING", 3, ["STAFF", "LEADER", "QC"]),
    status("DONE", 4, ["STAFF", "LEADER"], { countsDone: true }),
    status("WAITING_QC", 5, ["LEADER"]),
    status("QC_CHECKING", 6, ["QC"]),
    status("CHECKED", 7, ["QC"], { countsChecked: true }),
    status("COMPLETE", 8, ["LEADER"]),
    status("DELIVERING", 9, ["ACCOUNT"]),
    status("FEEDBACK", 10, ["ACCOUNT"]),
    status("DELIVERED", 11, ["ACCOUNT"], { isTerminal: true })
  ],
  transitions: [
    { fromStatusId: "ASSIGNED", toStatusId: "PROCESSING", actors: ["ASSIGNEE"], requiresNote: false },
    { fromStatusId: "REWORK", toStatusId: "PROCESSING", actors: ["ASSIGNEE"], requiresNote: false },
    { fromStatusId: "PROCESSING", toStatusId: "DONE", actors: ["ASSIGNEE"], requiresNote: false },
    { fromStatusId: "DONE", toStatusId: "WAITING_QC", actors: ["SYSTEM", "JOB_LEADER"], requiresNote: false },
    { fromStatusId: "DONE", toStatusId: "COMPLETE", actors: ["JOB_LEADER"], requiresNote: false },
    { fromStatusId: "WAITING_QC", toStatusId: "QC_CHECKING", actors: ["QC"], requiresNote: false },
    { fromStatusId: "WAITING_QC", toStatusId: "CHECKED", actors: ["QC"], requiresNote: false },
    { fromStatusId: "WAITING_QC", toStatusId: "REWORK", actors: ["QC"], requiresNote: true },
    { fromStatusId: "QC_CHECKING", toStatusId: "CHECKED", actors: ["QC"], requiresNote: false },
    { fromStatusId: "QC_CHECKING", toStatusId: "REWORK", actors: ["QC"], requiresNote: true },
    { fromStatusId: "CHECKED", toStatusId: "COMPLETE", actors: ["JOB_LEADER"], requiresNote: false },
    { fromStatusId: "COMPLETE", toStatusId: "DELIVERING", actors: ["ACCOUNT"], requiresNote: false },
    { fromStatusId: "DELIVERING", toStatusId: "DELIVERED", actors: ["ACCOUNT"], requiresNote: false },
    // SYSTEM only since BUG-PR-01 ("Ghi feedback" parks the tasks together with the feedback record).
    { fromStatusId: "DELIVERING", toStatusId: "FEEDBACK", actors: ["SYSTEM"], requiresNote: false },
    { fromStatusId: "FEEDBACK", toStatusId: "COMPLETE", actors: ["SYSTEM", "JOB_LEADER"], requiresNote: false }
  ]
};

const who = (roles: ProductionRole[], relation: Partial<Omit<TaskRelation, "roles">> = {}): TaskRelation => ({
  roles: new Set(roles),
  isAssignee: false,
  isQc: false,
  isJobLeader: false,
  ...relation
});
const targets = (from: string, relation: TaskRelation) => allowedTransitions(workflow, from, relation).map((option) => option.toStatusId);
/** The job's own action ("Complete cả gói", job-level moves). */
const jobTargets = (from: string, relation: TaskRelation) =>
  allowedTransitions(workflow, from, relation, "job").map((option) => option.toStatusId);
const rejects = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
};

describe("status transitions (SPEC Phase 2 §2)", () => {
  it("STAFF cannot move CHECKED → COMPLETE; only the job's leader can, and only for the whole job (PD-044)", () => {
    const staffAssignee = who(["STAFF"], { isAssignee: true });
    rejects(() => assertTransition(workflow, "CHECKED", "COMPLETE", staffAssignee, undefined), "TRANSITION_NOT_ALLOWED");
    // A leader of another job is not the job leader.
    expect(jobTargets("CHECKED", who(["LEADER"]))).toEqual([]);
    expect(jobTargets("CHECKED", who(["LEADER"], { isJobLeader: true }))).toEqual(["COMPLETE"]);
    // Not even the job's leader completes a single line: it is the job's "Complete" action.
    const jobLeader = who(["LEADER"], { isJobLeader: true });
    expect(targets("CHECKED", jobLeader)).toEqual([]);
    expect(targets("DONE", jobLeader)).toEqual(["WAITING_QC"]);
    rejects(() => assertTransition(workflow, "CHECKED", "COMPLETE", jobLeader, undefined), "TRANSITION_NOT_ALLOWED");
  });

  it("walks the happy path with the right actor at each step", () => {
    const assignee = who(["STAFF"], { isAssignee: true });
    expect(targets("ASSIGNED", assignee)).toEqual(["PROCESSING"]);
    expect(targets("PROCESSING", assignee)).toEqual(["DONE"]);
    const qc = who(["QC"], { isQc: true });
    expect(targets("WAITING_QC", qc)).toEqual(["REWORK", "QC_CHECKING", "CHECKED"]);
    expect(targets("QC_CHECKING", qc)).toEqual(["REWORK", "CHECKED"]);
    // Sent back: the worker starts again; Done goes back to Chờ QC by itself.
    expect(targets("REWORK", assignee)).toEqual(["PROCESSING"]);
    expect(targets("REWORK", qc)).toEqual([]);
    expect(jobTargets("COMPLETE", who(["ACCOUNT"]))).toEqual(["DELIVERING"]);
    expect(targets("COMPLETE", who(["ACCOUNT"]))).toEqual(["DELIVERING"]);
    expect(targets("DELIVERING", who(["ACCOUNT"]))).toEqual(["DELIVERED"]);
    // Someone else's task: nothing.
    expect(targets("ASSIGNED", who(["STAFF"]))).toEqual([]);
  });

  it("QC fail (Cần sửa lại) requires a note; the old Chờ QC → Đang làm is gone; SYSTEM-only moves are never offered", () => {
    const qc = who(["QC"], { isQc: true });
    rejects(() => assertTransition(workflow, "WAITING_QC", "REWORK", qc, "  "), "NOTE_REQUIRED");
    expect(assertTransition(workflow, "WAITING_QC", "REWORK", qc, "Da còn vết").requiresNote).toBe(true);
    expect(assertTransition(workflow, "QC_CHECKING", "REWORK", qc, "Da còn vết").requiresNote).toBe(true);
    expect(assertTransition(workflow, "WAITING_QC", "QC_CHECKING", qc, undefined).requiresNote).toBe(false);
    rejects(() => assertTransition(workflow, "WAITING_QC", "PROCESSING", qc, "x"), "TRANSITION_NOT_ALLOWED");
    expect(targets("FEEDBACK", who(["ACCOUNT", "STAFF", "QC"], { isAssignee: true, isQc: true }))).toEqual([]);
  });

  it("the target status' set_by_roles also applies (a QC-only assignee cannot mark Done)", () => {
    expect(targets("PROCESSING", who(["QC"], { isAssignee: true }))).toEqual([]);
  });

  it("ADMIN may force any move but must give a reason", () => {
    const admin = who(["ADMIN"]);
    // Every other status except FEEDBACK (system only).
    expect(targets("ASSIGNED", admin)).toHaveLength(9);
    // One line to Complete only as an override (PD-044), even when the ADMIN leads the job.
    const leadingAdmin = who(["ADMIN"], { isJobLeader: true });
    expect(allowedTransitions(workflow, "CHECKED", leadingAdmin).find((option) => option.toStatusId === "COMPLETE")).toEqual({
      toStatusId: "COMPLETE",
      requiresNote: true,
      override: true
    });
    expect(assertTransition(workflow, "CHECKED", "COMPLETE", leadingAdmin, "Khách cần gấp").override).toBe(true);
    expect(allowedTransitions(workflow, "CHECKED", leadingAdmin, "job").find((option) => option.toStatusId === "COMPLETE")?.override).toBe(false);
    rejects(() => assertTransition(workflow, "ASSIGNED", "DELIVERED", admin, undefined), "NOTE_REQUIRED");
    expect(assertTransition(workflow, "ASSIGNED", "DELIVERED", admin, "Khách nhận trực tiếp").override).toBe(true);
    // Role-based steps (Account delivers) need no reason; relation-based ones (the assignee's Done) do.
    expect(assertTransition(workflow, "COMPLETE", "DELIVERING", admin, undefined).override).toBe(false);
    expect(assertTransition(workflow, "PROCESSING", "DONE", admin, "x").override).toBe(true);
  });

  it("Done moves to Waiting QC automatically only when a QC is assigned", () => {
    expect(systemFollowUp(workflow, "DONE", true)?.code).toBe("WAITING_QC");
    expect(systemFollowUp(workflow, "DONE", false)).toBeNull();
    expect(systemFollowUp(workflow, "PROCESSING", true)).toBeNull();
  });
});

describe("audit fixes (2026-10-10)", () => {
  const account = who(["ACCOUNT"]);
  const admin = who(["ADMIN"]);
  const jobLeader = who(["LEADER"], { isJobLeader: true });

  it("BUG-PR-01: nobody moves a task into FEEDBACK — not even with a stale ACCOUNT transition row or an ADMIN override", () => {
    const stale: Workflow = {
      ...workflow,
      transitions: workflow.transitions.map((item) => (item.toStatusId === "FEEDBACK" ? { ...item, actors: ["ACCOUNT"] } : item))
    };
    expect(allowedTransitions(stale, "DELIVERING", account).map((option) => option.toStatusId)).toEqual(["DELIVERED"]);
    expect(targets("DELIVERING", admin)).not.toContain("FEEDBACK");
    expect(targets("ASSIGNED", admin)).not.toContain("FEEDBACK");
    rejects(() => assertTransition(stale, "DELIVERING", "FEEDBACK", account, undefined), "TRANSITION_NOT_ALLOWED");
    rejects(() => assertTransition(workflow, "DELIVERING", "FEEDBACK", admin, "lý do"), "TRANSITION_NOT_ALLOWED");
  });

  it("BUG-PR-02: while the job's feedback is open, tasks leave FEEDBACK only through the system", () => {
    const open = (relation: TaskRelation) => ({ ...relation, jobHasOpenFeedback: true });
    expect(targets("FEEDBACK", open(jobLeader))).toEqual([]);
    expect(targets("FEEDBACK", open(admin))).toEqual([]);
    rejects(() => assertTransition(workflow, "FEEDBACK", "COMPLETE", open(jobLeader), undefined), "FEEDBACK_OPEN");
    rejects(() => assertTransition(workflow, "FEEDBACK", "COMPLETE", open(admin), "ép"), "FEEDBACK_OPEN");
    // No open feedback (e.g. a job parked before the fix): the job leader may release it — with the job's action.
    expect(jobTargets("FEEDBACK", jobLeader)).toEqual(["COMPLETE"]);
    expect(targets("FEEDBACK", jobLeader)).toEqual([]);
    // Other tasks of the job keep their flow.
    expect(targets("ASSIGNED", open(who(["STAFF"], { isAssignee: true })))).toEqual(["PROCESSING"]);
  });

  it("BUG-PR-04: tasks of an archived job cannot move", () => {
    const archived = { ...admin, jobArchived: true };
    expect(targets("ASSIGNED", archived)).toEqual([]);
    rejects(() => assertTransition(workflow, "COMPLETE", "DELIVERING", archived, undefined), "JOB_ARCHIVED");
  });

  it("BUG-PR-07 / PD-044: back from Chờ QC or Đang check is a QC fail; an ADMIN override is not", () => {
    const code = (value: string) => workflow.statuses.find((status) => status.code === value)!;
    expect(isQcFail(code("WAITING_QC"), code("REWORK"), false)).toBe(true);
    expect(isQcFail(code("QC_CHECKING"), code("REWORK"), false)).toBe(true);
    expect(isQcFail(code("WAITING_QC"), code("REWORK"), true)).toBe(false);
    expect(isQcFail(code("QC_CHECKING"), code("PROCESSING"), true)).toBe(false);
    expect(isQcFail(code("WAITING_QC"), code("QC_CHECKING"), false)).toBe(false);
    expect(isQcFail(code("QC_CHECKING"), code("CHECKED"), false)).toBe(false);
    expect(isQcFail(code("PROCESSING"), code("ASSIGNED"), false)).toBe(false);
    expect(isQcFail(code("CHECKED"), code("REWORK"), false)).toBe(false);
    // The admin as the task's QC moves as QC (not an override): it counts.
    const adminQc = who(["ADMIN", "QC"], { isQc: true });
    expect(assertTransition(workflow, "WAITING_QC", "REWORK", adminQc, "Sai màu").override).toBe(false);
    expect(assertTransition(workflow, "WAITING_QC", "PROCESSING", admin, "Mở lại").override).toBe(true);
  });

  it("BUG-PR-08: lateness — closed without Done is not late; Done after the deadline is", () => {
    const deadline = new Date("2026-10-10T10:00:00Z");
    const now = new Date("2026-10-11T10:00:00Z");
    expect(computeIsLate({ doneAt: null, closed: false, deadline, now })).toBe(true);
    expect(computeIsLate({ doneAt: null, closed: true, deadline, now })).toBe(false);
    expect(computeIsLate({ doneAt: new Date("2026-10-10T11:00:00Z"), closed: true, deadline, now })).toBe(true);
    expect(computeIsLate({ doneAt: new Date("2026-10-10T09:00:00Z"), closed: false, deadline, now })).toBe(false);
    expect(computeIsLate({ doneAt: null, closed: false, deadline, now: new Date("2026-10-10T09:59:59Z") })).toBe(false);
    // PD-045: "Đã check" or later closes a line (a Checking line: Done or later).
    expect(lineFinishStatusIds(workflow)).toEqual({
      checked: ["CHECKED", "COMPLETE", "DELIVERING", "FEEDBACK", "DELIVERED"],
      checkingDone: ["DONE", "WAITING_QC", "QC_CHECKING", "CHECKED", "COMPLETE", "DELIVERING", "FEEDBACK", "DELIVERED"]
    });
  });

  it("BUG-PR-03: default deadlines — job deadline − buffer; feedback redo tasks never start late", () => {
    const jobDeadline = new Date("2026-10-10T11:00:00Z");
    expect(defaultTaskDeadline(jobDeadline, 2).toISOString()).toBe("2026-10-10T09:00:00.000Z");
    // Job default still ahead: it is used.
    expect(feedbackTaskDeadline({ jobDeadline, qcBufferHours: 2, now: new Date("2026-10-10T08:00:00Z"), source: null }).toISOString()).toBe(
      "2026-10-10T09:00:00.000Z"
    );
    // Past it: now + the original task's span (assigned → deadline).
    const source = { assignedAt: new Date("2026-10-08T02:00:00Z"), deadline: new Date("2026-10-08T08:00:00Z") };
    const now = new Date("2026-10-12T03:00:00Z");
    expect(feedbackTaskDeadline({ jobDeadline, qcBufferHours: 2, now, source }).toISOString()).toBe("2026-10-12T09:00:00.000Z");
    // No original task: 24 h; spans are kept between 1 h and 7 days.
    expect(feedbackTaskDeadline({ jobDeadline, qcBufferHours: 2, now, source: null }).toISOString()).toBe("2026-10-13T03:00:00.000Z");
    const instant = { assignedAt: now, deadline: now };
    expect(feedbackTaskDeadline({ jobDeadline, qcBufferHours: 2, now, source: instant }).toISOString()).toBe("2026-10-12T04:00:00.000Z");
    const long = { assignedAt: new Date("2026-01-01T00:00:00Z"), deadline: new Date("2026-03-01T00:00:00Z") };
    expect(feedbackTaskDeadline({ jobDeadline, qcBufferHours: 2, now, source: long }).toISOString()).toBe("2026-10-19T03:00:00.000Z");
  });
});

describe("job status", () => {
  it("is the least advanced task status, FEEDBACK while feedback is open, null without tasks", () => {
    expect(deriveJobStatus(workflow, [], false)).toBeNull();
    expect(deriveJobStatus(workflow, ["CHECKED", "PROCESSING", "DONE"], false)).toBe("PROCESSING");
    expect(deriveJobStatus(workflow, ["DELIVERED", "DELIVERED"], false)).toBe("DELIVERED");
    expect(deriveJobStatus(workflow, ["DELIVERED", "DELIVERING"], false)).toBe("DELIVERING");
    expect(deriveJobStatus(workflow, ["ASSIGNED", "FEEDBACK"], true)).toBe("FEEDBACK");
  });
});

describe("task lines", () => {
  const leader = "leader";
  const context = {
    memberRoles: new Map<string, Set<ProductionRole>>([
      [leader, new Set<ProductionRole>(["LEADER", "QC"])],
      ["staff", new Set<ProductionRole>(["STAFF"])],
      ["qc", new Set<ProductionRole>(["QC"])],
      ["account", new Set<ProductionRole>(["ACCOUNT"])]
    ]),
    processes: new Map([
      ["normal", { active: true, isQc: false, name: "Normal Retouch" }],
      ["checking", { active: true, isQc: true, name: "Checking" }],
      ["old", { active: false, isQc: false, name: "Old" }]
    ]),
    shifts: new Map([
      ["official", { active: true }],
      ["closed", { active: false }]
    ])
  };
  const line = { assigneeId: "staff", qcId: "qc", processId: "normal", shiftId: "official", qtyAssigned: 5 };

  it("accepts a valid line; without QC only when no QC is required (an existing line re-validated)", () => {
    expect(taskLineErrors(line, context)).toEqual([]);
    expect(taskLineErrors({ ...line, qcId: null }, context)).toEqual([]);
    expect(taskLineErrors({ ...line, qcId: undefined }, context, {})).toEqual([]);
  });

  it("PD-047: a new work line must name a QC; a Checking line never has one", () => {
    const rules = { requireQc: true };
    expect(taskLineErrors(line, context, rules)).toEqual([]);
    expect(taskLineErrors({ ...line, qcId: null }, context, rules)).toEqual(["Chọn QC cho task."]);
    expect(taskLineErrors({ ...line, qcId: undefined }, context, rules)).toEqual([qcMissingMessage]);
    expect(taskLineErrors({ ...line, assigneeId: leader, qcId: null }, context, rules)).toEqual(["Chọn QC cho task."]);
    // Other problems are listed with it.
    expect(taskLineErrors({ ...line, assigneeId: "account", qcId: null }, context, rules)).toEqual([
      "Người làm phải có vai trò Nhân viên hoặc Leader.",
      "Chọn QC cho task."
    ]);
    const checking = { ...line, processId: "checking", assigneeId: "qc", qcId: null };
    expect(taskLineErrors(checking, context, rules)).toEqual([]);
    expect(taskLineErrors({ ...checking, qcId: leader }, context, rules)).toEqual(["Task Checking không có QC riêng — người làm chính là người kiểm."]);
  });

  it("rejects qc = assignee", () => {
    expect(taskLineErrors({ ...line, assigneeId: leader, qcId: leader }, context)).toContain("QC phải khác người làm.");
  });

  it("without the PD-047 rule a line may lack a QC (lines entered before PD-047, importers)", () => {
    expect(taskLineErrors({ ...line, assigneeId: leader, qcId: null }, context)).toEqual([]);
    expect(taskLineErrors({ ...line, assigneeId: leader, qcId: "qc" }, context)).toEqual([]);
  });

  it("checks roles and inactive catalog rows", () => {
    expect(taskLineErrors({ ...line, assigneeId: "account" }, context)).toHaveLength(1);
    expect(taskLineErrors({ ...line, qcId: "staff" }, context)).toContain("Người QC phải có vai trò QC.");
    expect(taskLineErrors({ ...line, processId: "old", shiftId: "closed" }, context)).toHaveLength(2);
  });

  it("a Checking line (PD-037) is the QC person's own work line, without a QC of its own", () => {
    const checking = { ...line, processId: "checking", assigneeId: "qc", qcId: null };
    expect(taskLineErrors(checking, context)).toEqual([]);
    // A Leader may check too; a STAFF-only person may not.
    expect(taskLineErrors({ ...checking, assigneeId: leader }, context)).toEqual([]);
    expect(taskLineErrors({ ...checking, assigneeId: "staff" }, context)).toEqual(["Người làm task Checking phải có vai trò QC (hoặc Leader)."]);
    expect(taskLineErrors({ ...checking, qcId: leader }, context)).toEqual(["Task Checking không có QC riêng — người làm chính là người kiểm."]);
    // A work line is still done by STAFF / LEADER (a QC-only person cannot retouch).
    expect(taskLineErrors({ ...line, assigneeId: "qc", qcId: null }, context)).toEqual(["Người làm phải có vai trò Nhân viên hoặc Leader."]);
  });

  it("warns (but allows) over-allocation", () => {
    expect(overAllocationWarning(10, 5, 5)).toBeNull();
    expect(overAllocationWarning(10, 5, 6)).toContain("11");
  });
});

describe("declared Done quantity cap (SEC2-03)", () => {
  const codeOf = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      return { code: (error as AppError).code, status: (error as AppError).statusCode, message: (error as AppError).message };
    }
    return null;
  };

  it("caps at max(2 × assigned, assigned + 10)", () => {
    expect(maxDeclaredDoneQty(10)).toBe(20);
    expect(maxDeclaredDoneQty(100)).toBe(200);
    expect(maxDeclaredDoneQty(1)).toBe(11);
    expect(maxDeclaredDoneQty(5)).toBe(15);
    expect(maxDeclaredDoneQty(0)).toBe(10);
  });

  it("keeps small overshoots legal (12/10 must still reach the anomaly report)", () => {
    expect(codeOf(() => assertDeclaredDoneQty(10, 12))).toBeNull();
    expect(codeOf(() => assertDeclaredDoneQty(10, 20))).toBeNull();
    expect(codeOf(() => assertDeclaredDoneQty(10, 8))).toBeNull();
    expect(codeOf(() => assertDeclaredDoneQty(10, 0))).toBeNull();
    expect(codeOf(() => assertDeclaredDoneQty(1, 11))).toBeNull();
  });

  it("refuses anything above the cap with QTY_DONE_TOO_HIGH (400, Vietnamese message)", () => {
    expect(codeOf(() => assertDeclaredDoneQty(10, 21))).toMatchObject({ code: "QTY_DONE_TOO_HIGH", status: 400 });
    expect(codeOf(() => assertDeclaredDoneQty(10, 1_000_000))?.code).toBe("QTY_DONE_TOO_HIGH");
    expect(codeOf(() => assertDeclaredDoneQty(1, 12))?.code).toBe("QTY_DONE_TOO_HIGH");
    expect(codeOf(() => assertDeclaredDoneQty(10, 21))?.message).toContain("tối đa 20");
  });
});

describe("PD-045 the line workflow stops at Đã check; a job status that needs every line checked", () => {
  const doneAt = new Date("2026-10-14T05:00:00Z");
  const line = (id: string, number: number, statusId: string, extra: { isChecking?: boolean; doneAt?: Date | null } = {}) => ({
    id,
    number,
    statusId,
    isChecking: extra.isChecking ?? false,
    doneAt: extra.doneAt === undefined ? (statusId === "PROCESSING" || statusId === "ASSIGNED" ? null : doneAt) : extra.doneAt
  });
  // Migration 20261014_0300: the six transitions after "Đã check" are gone.
  const after = new Set(["COMPLETE", "DELIVERING", "FEEDBACK", "DELIVERED"]);
  const pd045: Workflow = {
    ...workflow,
    transitions: workflow.transitions.filter((item) => !after.has(item.toStatusId) && !after.has(item.fromStatusId))
  };

  it("nobody but an ADMIN override moves a line past Đã check (a Checking line past Done)", () => {
    const jobLeader = who(["LEADER"], { isJobLeader: true });
    expect(allowedTransitions(pd045, "CHECKED", jobLeader)).toEqual([]);
    expect(allowedTransitions(pd045, "CHECKED", jobLeader, "job")).toEqual([]);
    expect(allowedTransitions(pd045, "DONE", jobLeader).map((option) => option.toStatusId)).toEqual(["WAITING_QC"]);
    expect(allowedTransitions(pd045, "CHECKED", who(["ACCOUNT"]))).toEqual([]);
    const forced = allowedTransitions(pd045, "CHECKED", who(["ADMIN"])).find((option) => option.toStatusId === "COMPLETE");
    expect(forced).toEqual({ toStatusId: "COMPLETE", requiresNote: true, override: true });
    rejects(() => assertTransition(pd045, "CHECKED", "COMPLETE", jobLeader, undefined), "TRANSITION_NOT_ALLOWED");
  });

  it("a line is finished at Đã check or later; a Checking line once Done (and still Done or later)", () => {
    expect(isLineFinished(workflow, line("a", 1, "CHECKED"))).toBe(true);
    expect(isLineFinished(workflow, line("a", 1, "DELIVERED"))).toBe(true);
    expect(isLineFinished(workflow, line("a", 1, "QC_CHECKING"))).toBe(false);
    expect(isLineFinished(workflow, line("a", 1, "DONE"))).toBe(false);
    expect(isLineFinished(workflow, line("a", 1, "DONE", { isChecking: true }))).toBe(true);
    // An ADMIN override back into the pipeline (done_at kept) reopens it; Done without done_at (override) is not finished.
    expect(isLineFinished(workflow, line("a", 1, "PROCESSING", { isChecking: true, doneAt }))).toBe(false);
    expect(isLineFinished(workflow, line("a", 1, "DONE", { isChecking: true, doneAt: null }))).toBe(false);
    // A status missing from the workflow finishes nothing.
    expect(isLineFinished(workflow, line("x", 1, "GONE"))).toBe(false);
    expect(isLineFinished({ statuses: [], transitions: [] }, line("a", 1, "CHECKED"))).toBe(false);
  });

  it("ready: at least one line and every line finished — the unchecked ones by number", () => {
    const ready = jobLinesReady(workflow, [line("a", 1, "CHECKED"), line("b", 2, "DELIVERING"), line("c", 3, "DONE", { isChecking: true })]);
    expect(ready).toEqual({ ready: true, lineCount: 3, uncheckedTaskIds: [], uncheckedNumbers: [] });
    expect(jobNotReadyMessage(ready)).toBeNull();

    const blocked = jobLinesReady(workflow, [
      line("a", 1217, "QC_CHECKING"),
      line("b", 1216, "WAITING_QC"),
      line("c", 1218, "DONE"),
      line("d", 1219, "CHECKED"),
      line("e", 1220, "REWORK"),
      line("f", 1221, "PROCESSING", { isChecking: true })
    ]);
    expect(blocked).toEqual({ ready: false, lineCount: 6, uncheckedTaskIds: ["b", "a", "c", "e", "f"], uncheckedNumbers: [1216, 1217, 1218, 1220, 1221] });
    expect(jobNotReadyMessage(blocked)).toBe("Còn 5 task chưa check: #1216, #1217, #1218, #1220, #1221.");

    const empty = jobLinesReady(workflow, []);
    expect(empty.ready).toBe(false);
    expect(jobNotReadyMessage(empty)).toBe("Job chưa có task nào.");
  });

  it("lists at most 10 line numbers", () => {
    const many = Array.from({ length: 12 }, (_, index) => line(`l${index}`, index + 1, "PROCESSING"));
    expect(jobNotReadyMessage(jobLinesReady(workflow, many))).toBe("Còn 12 task chưa check: #1, #2, #3, #4, #5, #6, #7, #8, #9, #10, ….");
  });
});

describe("PD-044 subtasks, quantity requests", () => {
  it("a subtask is a NORMAL row with a parent line (a feedback redo task with a source is not)", () => {
    expect(isSubtask({ kind: "NORMAL", parentTaskId: "line" })).toBe(true);
    expect(isSubtask({ kind: "NORMAL", parentTaskId: null })).toBe(false);
    expect(isSubtask({ kind: "FB_WRONG", parentTaskId: "line" })).toBe(false);
  });

  it("a subtask's process is active, not Checking and not its line's own", () => {
    expect(subtaskProcessProblem({ active: true, isQc: false }, "other", "mine")).toBeNull();
    expect(subtaskProcessProblem(undefined, "other", "mine")).toBe("Quy trình không tồn tại hoặc đã ngừng.");
    expect(subtaskProcessProblem({ active: false, isQc: false }, "other", "mine")).toBe("Quy trình không tồn tại hoặc đã ngừng.");
    expect(subtaskProcessProblem({ active: true, isQc: true }, "other", "mine")).toBe("Subtask không dùng quy trình Checking.");
    expect(subtaskProcessProblem({ active: true, isQc: false }, "mine", "mine")).toBe("Subtask phải khác quy trình của task.");
  });

  it("a subtask's quantity comes from its line, which keeps at least 1", () => {
    expect(subtaskQtyProblem(10, 9)).toBeNull();
    expect(subtaskQtyProblem(10, 1)).toBeNull();
    expect(subtaskQtyProblem(10, 10)).toBe("Subtask lấy tối đa 9 tấm — task giữ lại ít nhất 1 tấm.");
    expect(subtaskQtyProblem(1, 1)).toBe("Subtask lấy tối đa 0 tấm — task giữ lại ít nhất 1 tấm.");
    expect(subtaskQtyProblem(10, 0)).not.toBeNull();
  });

  it("a quantity request asks for a different total that still leaves the line 1 image besides its subtasks", () => {
    expect(qtyRequestProblem({ currentTotal: 20, subtaskQty: 5, requestedTotal: 25 })).toBeNull();
    expect(qtyRequestProblem({ currentTotal: 20, subtaskQty: 5, requestedTotal: 6 })).toBeNull();
    expect(qtyRequestProblem({ currentTotal: 20, subtaskQty: 5, requestedTotal: 20 })).toBe("Số tấm mới phải khác số hiện tại (20).");
    expect(qtyRequestProblem({ currentTotal: 20, subtaskQty: 5, requestedTotal: 5 })).toBe(
      "Tổng mới phải lớn hơn số tấm của các subtask (5) — task giữ lại ít nhất 1 tấm."
    );
  });
});
