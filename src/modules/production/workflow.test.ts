import { describe, expect, it } from "vitest";

import type { ProductionRole } from "../../contracts/production-catalog.js";
import { AppError } from "../../lib/app-error.js";
import {
  allowedTransitions,
  assertTransition,
  computeIsLate,
  defaultTaskDeadline,
  deriveJobStatus,
  feedbackTaskDeadline,
  finishedStatusIds,
  isQcFail,
  overAllocationWarning,
  systemFollowUp,
  taskLineErrors,
  type TaskRelation,
  type Workflow,
  type WorkflowStatus
} from "./workflow.js";

// The default workflow seeded by 20261009_2100_production_catalog.sql.
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
    status("PROCESSING", 2, ["STAFF", "LEADER", "QC"]),
    status("DONE", 3, ["STAFF", "LEADER"], { countsDone: true }),
    status("WAITING_QC", 4, ["LEADER"]),
    status("CHECKED", 5, ["QC"], { countsChecked: true }),
    status("COMPLETE", 6, ["LEADER"]),
    status("DELIVERING", 7, ["ACCOUNT"]),
    status("FEEDBACK", 8, ["ACCOUNT"]),
    status("DELIVERED", 9, ["ACCOUNT"], { isTerminal: true })
  ],
  transitions: [
    { fromStatusId: "ASSIGNED", toStatusId: "PROCESSING", actors: ["ASSIGNEE"], requiresNote: false },
    { fromStatusId: "PROCESSING", toStatusId: "DONE", actors: ["ASSIGNEE"], requiresNote: false },
    { fromStatusId: "DONE", toStatusId: "WAITING_QC", actors: ["SYSTEM", "JOB_LEADER"], requiresNote: false },
    { fromStatusId: "WAITING_QC", toStatusId: "CHECKED", actors: ["QC"], requiresNote: false },
    { fromStatusId: "WAITING_QC", toStatusId: "PROCESSING", actors: ["QC"], requiresNote: true },
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
  it("STAFF cannot move CHECKED → COMPLETE; only the job's leader can", () => {
    const staffAssignee = who(["STAFF"], { isAssignee: true });
    rejects(() => assertTransition(workflow, "CHECKED", "COMPLETE", staffAssignee, undefined), "TRANSITION_NOT_ALLOWED");
    // A leader of another job is not the job leader.
    rejects(() => assertTransition(workflow, "CHECKED", "COMPLETE", who(["LEADER"]), undefined), "TRANSITION_NOT_ALLOWED");
    expect(assertTransition(workflow, "CHECKED", "COMPLETE", who(["LEADER"], { isJobLeader: true }), undefined).override).toBe(false);
  });

  it("walks the happy path with the right actor at each step", () => {
    const assignee = who(["STAFF"], { isAssignee: true });
    expect(targets("ASSIGNED", assignee)).toEqual(["PROCESSING"]);
    expect(targets("PROCESSING", assignee)).toEqual(["DONE"]);
    expect(targets("WAITING_QC", who(["QC"], { isQc: true }))).toEqual(["PROCESSING", "CHECKED"]);
    expect(targets("COMPLETE", who(["ACCOUNT"]))).toEqual(["DELIVERING"]);
    expect(targets("DELIVERING", who(["ACCOUNT"]))).toEqual(["DELIVERED"]);
    // Someone else's task: nothing.
    expect(targets("ASSIGNED", who(["STAFF"]))).toEqual([]);
  });

  it("QC fail requires a note; SYSTEM-only moves are never offered", () => {
    const qc = who(["QC"], { isQc: true });
    rejects(() => assertTransition(workflow, "WAITING_QC", "PROCESSING", qc, "  "), "NOTE_REQUIRED");
    expect(assertTransition(workflow, "WAITING_QC", "PROCESSING", qc, "Da còn vết").requiresNote).toBe(true);
    expect(targets("FEEDBACK", who(["ACCOUNT", "STAFF", "QC"], { isAssignee: true, isQc: true }))).toEqual([]);
  });

  it("the target status' set_by_roles also applies (a QC-only assignee cannot mark Done)", () => {
    expect(targets("PROCESSING", who(["QC"], { isAssignee: true }))).toEqual([]);
  });

  it("ADMIN may force any move but must give a reason", () => {
    const admin = who(["ADMIN"]);
    // Every other status except FEEDBACK (system only).
    expect(targets("ASSIGNED", admin)).toHaveLength(7);
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
    // No open feedback (e.g. a job parked before the fix): the job leader may release it.
    expect(targets("FEEDBACK", jobLeader)).toEqual(["COMPLETE"]);
    // Other tasks of the job keep their flow.
    expect(targets("ASSIGNED", open(who(["STAFF"], { isAssignee: true })))).toEqual(["PROCESSING"]);
  });

  it("BUG-PR-04: tasks of an archived job cannot move", () => {
    const archived = { ...admin, jobArchived: true };
    expect(targets("ASSIGNED", archived)).toEqual([]);
    rejects(() => assertTransition(workflow, "COMPLETE", "DELIVERING", archived, undefined), "JOB_ARCHIVED");
  });

  it("BUG-PR-07: an ADMIN override out of Waiting QC is not a QC fail; the QC's own move is", () => {
    const waiting = workflow.statuses.find((status) => status.code === "WAITING_QC")!;
    const processing = workflow.statuses.find((status) => status.code === "PROCESSING")!;
    const checked = workflow.statuses.find((status) => status.code === "CHECKED")!;
    expect(isQcFail(waiting, processing, false)).toBe(true);
    expect(isQcFail(waiting, processing, true)).toBe(false);
    expect(isQcFail(waiting, checked, false)).toBe(false);
    expect(isQcFail(processing, { sortOrder: 1 }, false)).toBe(false);
    // The admin as the task's QC moves as QC (not an override): it counts.
    const adminQc = who(["ADMIN", "QC"], { isQc: true });
    expect(assertTransition(workflow, "WAITING_QC", "PROCESSING", adminQc, "Sai màu").override).toBe(false);
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
    expect(finishedStatusIds(workflow)).toEqual(["COMPLETE", "DELIVERING", "FEEDBACK", "DELIVERED"]);
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
    callerId: leader,
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

  it("accepts a valid line and lines without QC (assigned later)", () => {
    expect(taskLineErrors(line, context)).toEqual([]);
    expect(taskLineErrors({ ...line, qcId: null }, context)).toEqual([]);
  });

  it("rejects qc = assignee", () => {
    expect(taskLineErrors({ ...line, assigneeId: leader, qcId: leader }, context)).toContain("QC phải khác người làm.");
  });

  it("requires another QC when the leader assigns to themselves", () => {
    expect(taskLineErrors({ ...line, assigneeId: leader, qcId: null }, context)).toEqual([
      "Leader tự giao cho mình thì phải chọn QC là người khác."
    ]);
    expect(taskLineErrors({ ...line, assigneeId: leader, qcId: "qc" }, context)).toEqual([]);
  });

  it("checks roles, QC process and inactive catalog rows", () => {
    expect(taskLineErrors({ ...line, assigneeId: "account" }, context)).toHaveLength(1);
    expect(taskLineErrors({ ...line, qcId: "staff" }, context)).toContain("Người QC phải có vai trò QC.");
    expect(taskLineErrors({ ...line, processId: "checking" }, context)[0]).toContain("quy trình QC");
    expect(taskLineErrors({ ...line, processId: "old", shiftId: "closed" }, context)).toHaveLength(2);
  });

  it("warns (but allows) over-allocation", () => {
    expect(overAllocationWarning(10, 5, 5)).toBeNull();
    expect(overAllocationWarning(10, 5, 6)).toContain("11");
  });
});
