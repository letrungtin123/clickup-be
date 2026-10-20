import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessContext } from "../access/access-context.js";
import type * as JobsRepoModule from "./jobs.repo.js";
import type * as NotificationsModule from "./notifications.js";
import type { QtyRequestJson, SubtaskJson, TaskRow } from "./jobs.repo.js";
import type { Workflow, WorkflowStatus } from "./workflow.js";

/**
 * PD-044 / PD-045 at the service level, without a database (same fake `sql` as security.test.ts): subtasks follow their
 * line, the worker's quantity rights and requests; PD-045 finished lines (closing, Việc của tôi), the job status that
 * needs every line checked and its notification, subtask codes, the retired job-level move and feedback. Fake names and
 * ids only: the repository is public.
 */
type Call = { text: string; values: unknown[] };
type Fragment = { readonly isFragment: true; text: string; values: unknown[] };

const db = vi.hoisted(() => {
  const state = {
    calls: [] as Call[],
    handler: (() => []) as (call: Call) => unknown[] | undefined
  };
  const isFragment = (value: unknown): value is Fragment =>
    typeof value === "object" && value !== null && (value as { isFragment?: unknown }).isFragment === true;
  const sql = (strings: TemplateStringsArray | string, ...values: unknown[]) => {
    if (typeof strings === "string") {
      return { isFragment: true as const, text: `"${strings}"`, values: [] as unknown[] };
    }
    let text = strings[0] ?? "";
    const flat: unknown[] = [];
    values.forEach((value, index) => {
      if (isFragment(value)) {
        text += value.text;
        flat.push(...value.values);
      } else {
        text += "$";
        flat.push(value);
      }
      text += strings[index + 1] ?? "";
    });
    return {
      isFragment: true as const,
      text,
      values: flat,
      then(resolve: (rows: unknown[]) => void, reject: (error: unknown) => void) {
        const call = { text: text.replace(/\s+/g, " ").trim(), values: flat };
        state.calls.push(call);
        try {
          resolve(state.handler(call) ?? []);
        } catch (error) {
          reject(error);
        }
      }
    };
  };
  const fake = Object.assign(sql, {
    json: (value: unknown) => value,
    begin: <T>(fn: (tx: unknown) => Promise<T>) => fn(fake)
  });
  return { state, sql: fake };
});
const fixtures = vi.hoisted(() => {
  const state: { workflow: unknown } = { workflow: null };
  return state;
});
const spies = vi.hoisted(() => ({ scored: [] as string[], events: [] as { type: string; payload: Record<string, unknown> }[] }));

vi.mock("../../lib/redis.js", () => ({
  hasRedisConfig: () => false,
  getOptionalRedis: () => undefined,
  getRedis: () => {
    throw new Error("Redis is not available in this test");
  }
}));
vi.mock("../../db/client.js", () => ({ getSql: () => db.sql }));
vi.mock("./realtime.js", () => ({ publishProductionChange: vi.fn(), jobAudience: vi.fn(() => Promise.resolve([])) }));
vi.mock("./job-chat.service.js", () => ({ syncJobChat: vi.fn(() => Promise.resolve()) }));
vi.mock("./scoring-hooks.js", () => ({
  onTaskStatusEntered: vi.fn((_sql: unknown, input: { taskId: string }) => {
    spies.scored.push(input.taskId);
    return Promise.resolve();
  }),
  onTaskQtyChanged: vi.fn(() => Promise.resolve()),
  onTaskDeleted: vi.fn(() => Promise.resolve(0))
}));
vi.mock("./notifications.js", async (importOriginal) => ({
  ...(await importOriginal<typeof NotificationsModule>()),
  enqueueProductionEvents: vi.fn((_tx: unknown, events: { type: string; payload: Record<string, unknown> }[]) => {
    spies.events.push(...events);
    return Promise.resolve();
  })
}));
vi.mock("./jobs.repo.js", async (importOriginal) => ({
  ...(await importOriginal<typeof JobsRepoModule>()),
  loadWorkflowModel: vi.fn(() => Promise.resolve(fixtures.workflow as Workflow))
}));

const { moveTasks, listMyProductionTasks, transitionProductionTask, updateProductionTask, updateProductionTaskQty, deleteProductionTask } = await import(
  "./tasks.service.js"
);
const { changeJobStatus, closeFeedback, createFeedback, createJob, reassignFeedback, transitionJob } = await import("./jobs.service.js");
const { toProductionTask, relationOf } = await import("./jobs.repo.js");
const { createProductionSubtask } = await import("./subtasks.service.js");
const { createQtyRequest, decideQtyRequest, cancelQtyRequest } = await import("./qty-requests.service.js");
const { clearProductionConfigCache } = await import("./catalog-cache.js");
const { CreateSubtaskRequestSchema, MyProductionTasksQuerySchema } = await import("../../contracts/production-jobs.js");

const org = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const leader = "33333333-3333-4333-8333-333333333333";
const checker = "44444444-4444-4444-8444-444444444444";
const lineId = "55555555-5555-4555-8555-555555555555";
const subId = "56565656-5656-4565-8565-565656565656";
const otherLineId = "57575757-5757-4575-8575-575757575757";
const jobId = "66666666-6666-4666-8666-666666666666";
const processId = "77777777-7777-4777-8777-777777777777";
const otherProcessId = "78787878-7878-4787-8787-787878787878";
const shiftId = "88888888-8888-4888-8888-888888888888";
const requestId = "99999999-9999-4999-8999-999999999999";

const contextWith = (roles: string[], userId = me) =>
  ({ user: { id: userId }, organization: { id: org }, hasFullOrganizationAuthority: false, productionRoles: roles, role: { permissions: [] } }) as unknown as AccessContext;

const status = (code: string, sortOrder: number, flags: Partial<WorkflowStatus> = {}): WorkflowStatus => ({
  id: code,
  code,
  name: code,
  sortOrder,
  countsDone: false,
  countsChecked: false,
  isTerminal: false,
  isInitial: false,
  setByRoles: [],
  active: true,
  ...flags
});
const workflow: Workflow = {
  statuses: [
    status("ASSIGNED", 1, { isInitial: true }),
    status("REWORK", 2),
    status("PROCESSING", 3),
    status("DONE", 4, { countsDone: true }),
    status("WAITING_QC", 5),
    status("QC_CHECKING", 6),
    status("CHECKED", 7, { countsChecked: true }),
    status("COMPLETE", 8),
    status("DELIVERING", 9),
    status("FEEDBACK", 10),
    status("DELIVERED", 11, { isTerminal: true })
  ],
  transitions: [
    { fromStatusId: "ASSIGNED", toStatusId: "PROCESSING", actors: ["ASSIGNEE"], requiresNote: false },
    { fromStatusId: "REWORK", toStatusId: "PROCESSING", actors: ["ASSIGNEE"], requiresNote: false },
    { fromStatusId: "PROCESSING", toStatusId: "DONE", actors: ["ASSIGNEE"], requiresNote: false },
    { fromStatusId: "DONE", toStatusId: "WAITING_QC", actors: ["SYSTEM", "JOB_LEADER"], requiresNote: false },
    { fromStatusId: "WAITING_QC", toStatusId: "REWORK", actors: ["QC"], requiresNote: true },
    { fromStatusId: "WAITING_QC", toStatusId: "QC_CHECKING", actors: ["QC"], requiresNote: false },
    { fromStatusId: "WAITING_QC", toStatusId: "CHECKED", actors: ["QC"], requiresNote: false },
    { fromStatusId: "QC_CHECKING", toStatusId: "REWORK", actors: ["QC"], requiresNote: true },
    { fromStatusId: "QC_CHECKING", toStatusId: "CHECKED", actors: ["QC"], requiresNote: false }
    // PD-045: nothing after CHECKED (migration 20261014_0300 deleted those transitions).
  ]
};
fixtures.workflow = workflow;
const statusOf = (code: string) => workflow.statuses.find((item) => item.code === code)!;

const userJson = (id: string) => ({ id, display_name: `Người ${id.slice(0, 2)}`, email: null, avatar_url: null });
const subtaskJson = (overrides: Partial<SubtaskJson> = {}): SubtaskJson => ({
  id: subId,
  number: 8,
  sub_seq: 1,
  process_id: otherProcessId,
  process_name: "Cắt nền",
  qty_assigned: 3,
  qty_done: null,
  reason: "Ảnh cần cắt nền riêng",
  created_by: userJson(me),
  created_at: "2026-10-14T03:00:00.000Z",
  ...overrides
});
const taskRow = (overrides: Partial<TaskRow> = {}): TaskRow => ({
  id: lineId,
  number: 7,
  job_id: jobId,
  job_code: "VD JOB-1",
  job_leader_id: leader,
  project_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  project_code: "P1",
  project_name: "Dự án",
  assignee_id: me,
  assignee: userJson(me),
  qc_id: checker,
  qc: userJson(checker),
  process_id: processId,
  process_name: "Retouch",
  process_is_qc: false,
  shift_id: shiftId,
  shift_name: "Chính thức",
  pay_mode: "POINTS",
  requires_ot_hours: false,
  qty_assigned: 7,
  qty_done: null,
  error_qty: null,
  ot_hours: null,
  assigned_at: new Date("2026-10-14T00:00:00Z"),
  deadline: new Date("2099-01-01T00:00:00Z"),
  done_at: null,
  checked_at: null,
  status_id: "PROCESSING",
  status_code: "PROCESSING",
  status_name: "PROCESSING",
  status_color: "blue",
  kind: "NORMAL",
  parent_task_id: null,
  feedback_id: null,
  note: null,
  work_link: null,
  is_late: false,
  qc_fail_count: 0,
  custom_values: {},
  tag_ids: null,
  created_at: new Date("2026-10-14T00:00:00Z"),
  updated_at: new Date("2026-10-14T00:00:00Z"),
  closed_at: null,
  deadline_cursor: "2099-01-01 00:00:00.000000+00",
  job_archived: false,
  job_open_feedback: false,
  split_reason: null,
  created_by: leader,
  sub_seq: null,
  parent_number: null,
  subtasks: null,
  pending_qty_request: null,
  ...overrides
});
const subtaskRow = (overrides: Partial<TaskRow> = {}) =>
  taskRow({
    id: subId,
    number: 8,
    parent_task_id: lineId,
    sub_seq: 1,
    parent_number: 7,
    process_id: otherProcessId,
    process_name: "Cắt nền",
    qty_assigned: 3,
    split_reason: "Ảnh cần cắt nền riêng",
    created_by: me,
    ...overrides
  });
const pendingRequest = (overrides: Partial<QtyRequestJson> = {}): QtyRequestJson => ({
  id: requestId,
  task_id: lineId,
  from_qty: 10,
  to_qty: 12,
  reason: "Thư mục có thêm 2 ảnh",
  status: "PENDING",
  requested_by_id: me,
  requested_by: userJson(me),
  created_at: "2026-10-14T03:00:00.000Z",
  decided_by: null,
  decided_at: null,
  decision_note: null,
  ...overrides
});

/**
 * Answers the reads of a locked task (lockTaskForUpdate, selectTasks by id), the subtasks of a line, a settled job and
 * the request lookups, from `rows`. `extra` answers first.
 */
const store = (rows: TaskRow[], extra?: (call: Call) => unknown[] | undefined) => (call: Call) => {
  const answer = extra?.(call);
  if (answer) {
    return answer;
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (call.text.startsWith("SELECT job_id FROM production.tasks")) {
    const row = byId.get(call.values[1] as string);
    return row ? [{ job_id: row.job_id }] : [];
  }
  if (call.text.includes("AS job_leader_id") && call.text.includes("t.id = ANY(")) {
    const ids = call.values.find((value): value is string[] => Array.isArray(value)) ?? [];
    return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  }
  if (call.text.startsWith("SELECT id FROM production.tasks") && call.text.includes("parent_task_id = ANY(")) {
    const parents = call.values.find((value): value is string[] => Array.isArray(value)) ?? [];
    return rows.filter((row) => row.parent_task_id && parents.includes(row.parent_task_id)).map((row) => ({ id: row.id }));
  }
  if (call.text.includes("SELECT EXISTS (SELECT 1 FROM production.feedbacks")) {
    return [{ open: false }];
  }
  return undefined;
};

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return { code: (error as { code?: string }).code, status: (error as { statusCode?: number }).statusCode, message: (error as Error).message };
  }
  return null;
};
const callsLike = (pattern: RegExp) => db.state.calls.filter((call) => pattern.test(call.text));
const statusUpdate = () => callsLike(/^UPDATE production\.tasks AS t SET status_id/)[0];
const movedRows = () => (statusUpdate()?.values.find((value) => Array.isArray(value)) ?? []) as Record<string, unknown>[];

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = () => [];
  spies.scored = [];
  spies.events = [];
  clearProductionConfigCache();
});

describe("subtasks follow their line (moveTasks)", () => {
  it("moving a line moves its subtasks in the same statement; each gets its own Done quantity and score entry, no notification", async () => {
    db.state.handler = store([taskRow(), subtaskRow()]);
    await moveTasks(db.sql as never, org, workflow, [taskRow({ qc_id: null })], statusOf("DONE"), me, null, {
      qtyDone: 6,
      subtaskQtyDone: [{ taskId: subId, qtyDone: 2 }]
    });
    expect(movedRows()).toEqual([
      expect.objectContaining({ id: lineId, firstDone: true, qtyDone: 6 }),
      expect.objectContaining({ id: subId, firstDone: true, qtyDone: 2 })
    ]);
    expect(spies.scored).toEqual([lineId, subId]);
    // Two STATUS history rows, one UPDATE.
    expect(callsLike(/^UPDATE production\.tasks AS t/)).toHaveLength(1);
    expect(JSON.stringify(callsLike(/^INSERT INTO production\.task_logs/)[0]?.values)).toContain(subId);
  });

  it("a subtask's Done quantity defaults to its own quantity and is capped like any Done", async () => {
    db.state.handler = store([taskRow(), subtaskRow()]);
    await moveTasks(db.sql as never, org, workflow, [taskRow()], statusOf("DONE"), me, null, {});
    expect(movedRows()[1]).toMatchObject({ id: subId, qtyDone: 3 });

    db.state.calls = [];
    expect(
      await failure(moveTasks(db.sql as never, org, workflow, [taskRow()], statusOf("DONE"), me, null, { subtaskQtyDone: [{ taskId: subId, qtyDone: 99 }] }))
    ).toMatchObject({ code: "QTY_DONE_TOO_HIGH", status: 400 });
    expect(statusUpdate()).toBeUndefined();
    // A quantity for a row that is not one of the line's subtasks is refused.
    expect(
      await failure(moveTasks(db.sql as never, org, workflow, [taskRow()], statusOf("DONE"), me, null, { subtaskQtyDone: [{ taskId: otherLineId, qtyDone: 1 }] }))
    ).toMatchObject({ code: "SUBTASK_INVALID", status: 400 });
  });

  it("a QC fail is the line's: it notifies and counts once, the subtask just follows", async () => {
    const waiting = { status_id: "WAITING_QC", status_code: "WAITING_QC", done_at: new Date("2026-10-14T05:00:00Z"), qty_done: 7 };
    db.state.handler = store([taskRow(waiting), subtaskRow({ ...waiting, qty_done: 3 })]);
    await moveTasks(db.sql as never, org, workflow, [taskRow(waiting)], statusOf("REWORK"), checker, "Da còn vết");
    expect(movedRows().map((row) => [row.id, row.qcFail])).toEqual([
      [lineId, 1],
      [subId, 0]
    ]);
    expect(spies.events.map((event) => event.payload.taskId)).toEqual([lineId]);
    expect(spies.events[0]?.payload).toMatchObject({ qcFail: true, note: "Da còn vết" });
  });

  it("back into Done after Cần sửa lại: a new Done quantity until QC checked the line, locked afterwards", async () => {
    const redo = { status_id: "PROCESSING", status_code: "PROCESSING", done_at: new Date("2026-10-14T05:00:00Z"), qty_done: 7 };
    db.state.handler = store([taskRow(redo)]);
    const [moved] = await moveTasks(db.sql as never, org, workflow, [taskRow(redo)], statusOf("DONE"), me, null, { qtyDone: 5 });
    expect(moved?.qty_done).toBe(5);
    expect(movedRows()[0]).toMatchObject({ setQty: true, firstDone: false, qtyDone: 5 });
    expect(
      await failure(moveTasks(db.sql as never, org, workflow, [taskRow({ ...redo, checked_at: new Date() })], statusOf("DONE"), me, null, { qtyDone: 5 }))
    ).toMatchObject({ code: "QTY_LOCKED" });
    expect(await failure(moveTasks(db.sql as never, org, workflow, [taskRow(redo)], statusOf("WAITING_QC"), me, null, { qtyDone: 5 }))).toMatchObject({
      code: "QTY_LOCKED"
    });
  });

  it("a subtask has no moves of its own (409 SUBTASK_FOLLOWS_PARENT naming its line)", async () => {
    db.state.handler = store([taskRow(), subtaskRow()], (call) => (call.text.startsWith("SELECT number FROM production.tasks") ? [{ number: "7" }] : undefined));
    expect(await failure(transitionProductionTask(contextWith(["STAFF"]), subId, { toStatusId: "DONE" }))).toEqual({
      code: "SUBTASK_FOLLOWS_PARENT",
      status: 409,
      message: "Subtask đi theo trạng thái của task #7."
    });
    expect(statusUpdate()).toBeUndefined();
  });

  it("one line is never moved to Complete on its own — not even by the job's leader", async () => {
    db.state.handler = store([taskRow({ status_id: "CHECKED", status_code: "CHECKED", assignee_id: checker, qc_id: me })]);
    expect(await failure(transitionProductionTask(contextWith(["LEADER"], leader), lineId, { toStatusId: "COMPLETE" }))).toMatchObject({
      code: "TRANSITION_NOT_ALLOWED",
      status: 400
    });
  });
});

describe("PD-045 finished lines: closing and Việc của tôi", () => {
  const waiting = { status_id: "WAITING_QC", status_code: "WAITING_QC", done_at: new Date("2026-10-14T05:00:00Z"), qty_done: 7 };

  it("a line entering Đã check is closed (its subtasks with it); a work line entering Done is not", async () => {
    db.state.handler = store([taskRow(waiting), subtaskRow({ ...waiting, qty_done: 3 })]);
    await moveTasks(db.sql as never, org, workflow, [taskRow(waiting)], statusOf("CHECKED"), checker, null);
    expect(statusUpdate()?.text).toContain("closed_at = CASE WHEN (m->>'closing')::boolean THEN coalesce(t.closed_at, (m->>'closedAt')::timestamptz) ELSE NULL END");
    expect(movedRows().map((row) => [row.id, row.closing, typeof row.closedAt])).toEqual([
      [lineId, true, "string"],
      [subId, true, "string"]
    ]);

    db.state.calls = [];
    db.state.handler = store([taskRow()]);
    await moveTasks(db.sql as never, org, workflow, [taskRow({ qc_id: null })], statusOf("DONE"), me, null, { qtyDone: 7 });
    expect(movedRows()[0]).toMatchObject({ closing: false, closedAt: null });
  });

  it("a Checking line is closed at Done; moving a line back out of Đã check (ADMIN override) reopens it", async () => {
    const checking = taskRow({ process_is_qc: true, qc_id: null });
    db.state.handler = store([checking]);
    await moveTasks(db.sql as never, org, workflow, [checking], statusOf("DONE"), me, null, { qtyDone: 7 });
    expect(movedRows()[0]).toMatchObject({ closing: true, isLate: false });

    db.state.calls = [];
    const checked = taskRow({ status_id: "CHECKED", status_code: "CHECKED", done_at: new Date(), checked_at: new Date(), closed_at: new Date(), qty_done: 7 });
    db.state.handler = store([checked]);
    await moveTasks(db.sql as never, org, workflow, [checked], statusOf("PROCESSING"), leader, "Làm lại", { override: true });
    expect(movedRows()[0]).toMatchObject({ closing: false, closedAt: null });
  });

  it("Việc của tôi leaves finished lines out (Đã check or later; a Checking line once Done) unless asked for", async () => {
    db.state.handler = () => [];
    await listMyProductionTasks(contextWith(["STAFF"]), MyProductionTasksQuerySchema.parse({}));
    const query = callsLike(/AS job_leader_id/)[0]!;
    expect(query.text).toContain('AND NOT (t.status_id = ANY($::uuid[]) OR ("pr".is_qc AND t.done_at IS NOT NULL AND t.status_id = ANY($::uuid[])))');
    expect(query.values).toContainEqual(["CHECKED", "COMPLETE", "DELIVERING", "FEEDBACK", "DELIVERED"]);
    expect(query.values).toContainEqual(["DONE", "WAITING_QC", "QC_CHECKING", "CHECKED", "COMPLETE", "DELIVERING", "FEEDBACK", "DELIVERED"]);

    db.state.calls = [];
    await listMyProductionTasks(contextWith(["STAFF"]), MyProductionTasksQuerySchema.parse({ includeFinished: "true" }));
    // PD-068: finished lines are kept (they only sort after the open ones).
    expect(callsLike(/AS job_leader_id/)[0]!.text).not.toContain("AND NOT (t.status_id = ANY(");
  });
});

describe("PD-045 job status that needs every line checked", () => {
  const statusDoing = "a2222222-2222-4222-8222-222222222222";
  const statusFinished = "a4444444-4444-4444-8444-444444444444";
  const jobStatuses = [
    { id: statusDoing, name: "Đang làm", color: "blue", is_closed: false, requires_all_checked: false },
    { id: statusFinished, name: "Đã xong", color: "green", is_closed: false, requires_all_checked: true }
  ];
  type Line = { id: string; number: number; status_id: string; done_at: Date | null; is_checking: boolean };
  const line = (id: string, number: number, statusId: string, extra: Partial<Line> = {}): Line => ({
    id,
    number,
    status_id: statusId,
    done_at: statusId === "PROCESSING" ? null : new Date("2026-10-14T05:00:00Z"),
    is_checking: false,
    ...extra
  });
  const statusQueries = (lines: Line[], current = statusDoing) => (call: Call) => {
    if (call.text.startsWith("SELECT j.leader_id, j.archived_at, j.job_status_id")) {
      return [{ leader_id: leader, archived_at: null, job_status_id: current, mine: false }];
    }
    if (call.text.startsWith("SELECT id, name, color, is_closed, requires_all_checked FROM production.job_statuses")) {
      return jobStatuses.filter((row) => row.id === call.values[1]);
    }
    if (call.text.startsWith("SELECT t.id, t.number, t.status_id, t.done_at, pr.is_qc AS is_checking")) {
      return lines;
    }
    return undefined;
  };
  const leaderContext = contextWith(["LEADER"], leader);

  it("refused without a line, or while a line is not checked (409 JOB_NOT_READY naming them); nothing written", async () => {
    db.state.handler = statusQueries([]);
    expect(await failure(changeJobStatus(leaderContext, jobId, { statusId: statusFinished }))).toEqual({
      code: "JOB_NOT_READY",
      status: 409,
      message: "Job chưa có task nào."
    });
    const lines = [
      line(otherLineId, 1217, "WAITING_QC"),
      line(lineId, 1216, "CHECKED"),
      line("58585858-5858-4585-8585-585858585858", 1218, "DONE", { is_checking: true }),
      line("59595959-5959-4595-8595-595959595959", 1219, "PROCESSING")
    ];
    db.state.handler = statusQueries(lines);
    expect(await failure(changeJobStatus(leaderContext, jobId, { statusId: statusFinished }))).toEqual({
      code: "JOB_NOT_READY",
      status: 409,
      message: "Còn 2 task chưa check: #1217, #1219."
    });
    // Lines only: subtasks follow their line.
    expect(callsLike(/^SELECT t\.id, t\.number, t\.status_id/)[0]!.text).toContain("NOT (t.kind = 'NORMAL' AND t.parent_task_id IS NOT NULL)");
    expect(callsLike(/^UPDATE production\.jobs/)).toHaveLength(0);
    expect(spies.events).toEqual([]);
  });

  it("ready (Đã check or later; a Checking line Done): changed, logged and notified once", async () => {
    const lines = [
      line(lineId, 1216, "CHECKED"),
      line(otherLineId, 1217, "DONE", { is_checking: true }),
      line("58585858-5858-4585-8585-585858585858", 1218, "DELIVERED")
    ];
    db.state.handler = statusQueries(lines);
    // The detail read afterwards is not answered by the fake: only the change matters here.
    await changeJobStatus(leaderContext, jobId, { statusId: statusFinished }).catch(() => undefined);
    expect(callsLike(/^UPDATE production\.jobs SET job_status_id/)[0]?.values).toEqual([statusFinished, org, jobId]);
    expect(spies.events).toEqual([
      expect.objectContaining({
        type: "production.job.status_changed",
        aggregateType: "production_job",
        aggregateId: jobId,
        actorUserId: leader,
        payload: { jobId, from: { id: statusDoing, name: "Đang làm", color: "blue" }, to: { id: statusFinished, name: "Đã xong", color: "green" } }
      })
    ]);
  });

  it("a status without the rule needs no line; the same status changes and notifies nothing", async () => {
    db.state.handler = statusQueries([], statusFinished);
    await changeJobStatus(leaderContext, jobId, { statusId: statusDoing }).catch(() => undefined);
    expect(callsLike(/^SELECT t\.id, t\.number, t\.status_id/)).toHaveLength(0);
    expect(spies.events.map((event) => event.type)).toEqual(["production.job.status_changed"]);

    db.state.calls = [];
    spies.events = [];
    db.state.handler = statusQueries([], statusDoing);
    await changeJobStatus(leaderContext, jobId, { statusId: statusDoing }).catch(() => undefined);
    expect(callsLike(/^UPDATE production\.jobs/)).toHaveLength(0);
    expect(spies.events).toEqual([]);
  });

  it("a new job cannot start in such a status (no line yet)", async () => {
    db.state.handler = (call) =>
      call.text.startsWith("SELECT 1 FROM production.projects") ? [{ "?column?": 1 }]
      : call.text.includes("array_agg(ur.role_code)") ? [{ user_id: leader, roles: ["LEADER"], superadmin: false }]
      : statusQueries([])(call);
    // PD-073: the Leader is required.
    const input = { projectId: jobId, code: "Batch 1", leaderId: leader, receivedAt: "2026-10-14T00:00:00Z", deadline: "2026-10-15T00:00:00Z", jobStatusId: statusFinished };
    expect(await failure(createJob(leaderContext, input))).toEqual({ code: "JOB_NOT_READY", status: 409, message: "Job chưa có task nào." });
    expect(callsLike(/^INSERT INTO production\.jobs/)).toHaveLength(0);
  });
});

describe("PD-045 retired: the job-level line move and the feedback feature", () => {
  const jobQueries = (rows: TaskRow[]) =>
    store(rows, (call) => {
      if (call.text.includes("FROM production.jobs j JOIN production.projects p")) {
        return [{ id: jobId, leader_id: null, received_at: new Date(), deadline: new Date(), total_images: 0, total_images_manual: false, qc_buffer_hours: 0, archived_at: null }];
      }
      if (call.text.startsWith("SELECT id FROM production.tasks") && call.text.includes("job_id = $")) {
        return rows.map((row) => ({ id: row.id }));
      }
      return undefined;
    });
  const checkedLine = taskRow({ status_id: "CHECKED", status_code: "CHECKED", done_at: new Date(), checked_at: new Date(), qty_done: 7 });

  it("POST …/jobs/:id/transition: 409 JOB_TRANSITION_RETIRED for everyone but a production ADMIN, before any read", async () => {
    db.state.handler = jobQueries([checkedLine]);
    for (const context of [contextWith(["LEADER"], leader), contextWith(["ACCOUNT"]), contextWith(["STAFF"])]) {
      expect(await failure(transitionJob(context, jobId, { toStatusId: "COMPLETE" }))).toMatchObject({ code: "JOB_TRANSITION_RETIRED", status: 409 });
    }
    expect(db.state.calls).toHaveLength(0);
  });

  it("an ADMIN still applies a listed move to every line it fits; nothing reaches Complete (no transition left)", async () => {
    const done = taskRow({ job_leader_id: null, status_id: "DONE", status_code: "DONE", done_at: new Date(), qty_done: 7 });
    db.state.handler = jobQueries([{ ...checkedLine, job_leader_id: null }]);
    expect(await failure(transitionJob(contextWith(["ADMIN"]), jobId, { toStatusId: "COMPLETE" }))).toMatchObject({ code: "NOTHING_TO_MOVE", status: 409 });
    db.state.handler = jobQueries([done]);
    await transitionJob(contextWith(["ADMIN"]), jobId, { toStatusId: "WAITING_QC" }).catch(() => undefined);
    expect(movedRows().map((row) => row.id)).toEqual([lineId]);
  });

  it("Ghi feedback / Đóng feedback / Giao lại: 409 FEEDBACK_RETIRED (404 for non-members); nothing read or written", async () => {
    const feedbackId = "abababab-abab-4bab-8bab-abababababab";
    for (const call of [
      () => createFeedback(contextWith(["ACCOUNT"]), jobId, { type: "WRONG", note: "Sai màu" }),
      () => closeFeedback(contextWith(["ADMIN"]), feedbackId, { note: "Không cần" }),
      () => reassignFeedback(contextWith(["LEADER"], leader), feedbackId, { tasks: [] })
    ]) {
      expect(await failure(call())).toEqual({
        code: "FEEDBACK_RETIRED",
        status: 409,
        message: "Tính năng ghi feedback đã bỏ — đổi trạng thái job sang “Feedback” và Chia task cho phần sửa."
      });
    }
    expect(await failure(createFeedback(contextWith([]), jobId, { type: "WRONG", note: "x" }))).toMatchObject({ status: 404 });
    expect(db.state.calls).toHaveLength(0);
  });
});

describe("PD-045 subtask codes", () => {
  const access = { scopes: { view: "all", create: "all", update: "all", delete: "all" } as const, userId: me };

  it("a line shows its number, a subtask its line's number + letter; a feedback redo task keeps its own number", () => {
    const line = taskRow({ number: 1216, subtasks: [subtaskJson({ number: 1300, sub_seq: 1 }), subtaskJson({ id: otherLineId, number: 1310, sub_seq: 28 })] });
    const lineTask = toProductionTask(line, workflow, relationOf(contextWith(["STAFF"]), line), access);
    expect(lineTask.code).toBe("1216");
    expect(lineTask.subtasks.map((subtask) => subtask.code)).toEqual(["1216a", "1216ab"]);
    const sub = subtaskRow({ number: 1300, sub_seq: 2, parent_number: "1216" });
    expect(toProductionTask(sub, workflow, relationOf(contextWith(["STAFF"]), sub), access).code).toBe("1216b");
    const redo = taskRow({ number: 1400, kind: "FB_WRONG", parent_task_id: lineId });
    expect(toProductionTask(redo, workflow, relationOf(contextWith(["STAFF"]), redo), access).code).toBe("1400");
  });

  it("a new subtask takes the line's next letter (deleted ones count); reason optional (null); after zz the line is full", async () => {
    const processRow = (call: Call) =>
      call.text.startsWith("SELECT active, is_qc, name FROM production.processes") ? [{ active: true, is_qc: false, name: "Cắt nền" }] : undefined;
    db.state.handler = store([taskRow()], (call) => {
      if (call.text.startsWith("SELECT max(sub_seq)::int AS last FROM production.tasks")) {
        return [{ last: 2 }];
      }
      return processRow(call) ?? (call.text.startsWith("INSERT INTO production.tasks") ? [{ number: "8" }] : undefined);
    });
    const input = CreateSubtaskRequestSchema.parse({ processId: otherProcessId, qtyAssigned: 2, reason: "   " });
    await createProductionSubtask(contextWith(["STAFF"]), lineId, input).catch(() => undefined);
    // Every subtask the line ever had (no deleted_at filter), under the line's lock.
    expect(callsLike(/^SELECT max\(sub_seq\)/)[0]!.text).not.toContain("deleted_at");
    const insert = callsLike(/^INSERT INTO production\.tasks/)[0]!;
    expect(insert.text).toContain("parent_task_id, sub_seq, split_reason");
    expect(insert.values).toContain(3);
    expect(insert.values).toContain(null);
    const logs = callsLike(/^INSERT INTO production\.task_logs/)[0]!.values[1] as { action: string; note: string | null; to: Record<string, unknown> }[];
    expect(logs.map((log) => [log.action, log.note])).toEqual([
      ["CREATE", null],
      ["SUBTASK", null]
    ]);
    expect(logs[1]!.to).toMatchObject({ op: "created", subtaskCode: "7c", subtaskNumber: 8 });

    db.state.calls = [];
    db.state.handler = store([taskRow()], (call) =>
      call.text.startsWith("SELECT max(sub_seq)::int AS last FROM production.tasks") ? [{ last: 702 }] : processRow(call)
    );
    expect(await failure(createProductionSubtask(contextWith(["STAFF"]), lineId, input))).toMatchObject({ code: "SUBTASK_LIMIT", status: 409 });
    expect(callsLike(/^INSERT INTO production\.tasks/)).toHaveLength(0);
  });
});

describe("Số lượng giao, Done quantity, subtasks (PD-044)", () => {
  it("a worker changing the Leader's quantity directly gets 403 QTY_REQUEST_REQUIRED; nothing is written", async () => {
    db.state.handler = store([taskRow()]);
    expect(await failure(updateProductionTask(contextWith(["STAFF"]), lineId, { qtyAssigned: 9 }))).toEqual({
      code: "QTY_REQUEST_REQUIRED",
      status: 403,
      message: "Gửi đề nghị sửa số tấm để Leader duyệt."
    });
    expect(callsLike(/^UPDATE production\.tasks/)).toHaveLength(0);
    // A line I entered myself: allowed directly.
    db.state.handler = store([taskRow({ created_by: me })]);
    await updateProductionTask(contextWith(["STAFF"]), lineId, { qtyAssigned: 9 }).catch(() => undefined);
    expect(callsLike(/^UPDATE production\.tasks SET qty_assigned = \$/)[0]?.values[0]).toBe(9);
  });

  it("a subtask's shift / dates / link follow its line (400 SUBTASK_FIELD_LOCKED); its quantity moves to / from the line", async () => {
    const line = taskRow({ subtasks: [subtaskJson()] });
    db.state.handler = store([line, subtaskRow()], (call) =>
      call.text.startsWith("SELECT id, number, process_id, qty_assigned, done_at FROM production.tasks")
        ? [{ id: lineId, number: "7", process_id: processId, qty_assigned: 7, done_at: null }]
        : undefined
    );
    expect(await failure(updateProductionTask(contextWith(["STAFF"]), subId, { workLink: "Y:\\Khác" }))).toMatchObject({ code: "SUBTASK_FIELD_LOCKED", status: 400 });
    // 3 → 10 would leave the line 0: refused.
    expect(await failure(updateProductionTask(contextWith(["STAFF"]), subId, { qtyAssigned: 10 }))).toMatchObject({ code: "SUBTASK_QTY_INVALID", status: 400 });
    db.state.calls = [];
    await updateProductionTask(contextWith(["STAFF"]), subId, { qtyAssigned: 5 }).catch(() => undefined);
    // The line gives 2 more images; a SUBTASK "updated" row goes on the line's history.
    expect(callsLike(/^UPDATE production\.tasks SET qty_assigned = \$/)[0]?.values.slice(0, 1)).toEqual([5]);
    const log = callsLike(/^INSERT INTO production\.task_logs/)[0]!;
    expect(JSON.stringify(log.values)).toContain('"action":"SUBTASK"');
    expect(JSON.stringify(log.values)).toContain('"op":"updated"');
  });

  it("the worker corrects the Done quantity until QC checked the line; afterwards only update: all", async () => {
    const done = taskRow({ status_id: "WAITING_QC", status_code: "WAITING_QC", done_at: new Date(), qty_done: 7 });
    db.state.handler = store([done]);
    await updateProductionTaskQty(contextWith(["STAFF"]), lineId, { qtyDone: 6 }).catch(() => undefined);
    expect(callsLike(/^UPDATE production\.tasks SET qty_done/)).toHaveLength(1);
    // Capped like at Done.
    expect(await failure(updateProductionTaskQty(contextWith(["STAFF"]), lineId, { qtyDone: 100 }))).toMatchObject({ code: "QTY_DONE_TOO_HIGH" });
    db.state.handler = store([{ ...done, checked_at: new Date() }]);
    expect(await failure(updateProductionTaskQty(contextWith(["STAFF"]), lineId, { qtyDone: 6 }))).toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("splitting a subtask: the line keeps at least 1, the process differs; then the line gives the quantity", async () => {
    const processRow = (row: { active: boolean; is_qc: boolean; name: string }) => (call: Call) =>
      call.text.startsWith("SELECT active, is_qc, name FROM production.processes") ? [row] : undefined;
    const input = CreateSubtaskRequestSchema.parse({ processId: otherProcessId, qtyAssigned: 7, reason: "Cắt nền riêng" });
    db.state.handler = store([taskRow()], processRow({ active: true, is_qc: false, name: "Cắt nền" }));
    expect(await failure(createProductionSubtask(contextWith(["STAFF"]), lineId, input))).toMatchObject({ code: "SUBTASK_QTY_INVALID", status: 400 });
    expect(await failure(createProductionSubtask(contextWith(["STAFF"]), lineId, { ...input, processId, qtyAssigned: 2 }))).toMatchObject({
      code: "PROCESS_INVALID"
    });
    db.state.handler = store([taskRow()], processRow({ active: true, is_qc: true, name: "Checking" }));
    expect(await failure(createProductionSubtask(contextWith(["STAFF"]), lineId, { ...input, qtyAssigned: 2 }))).toMatchObject({ code: "PROCESS_INVALID" });
    // Someone else's line under "own", not leading the job: 403.
    db.state.handler = store([taskRow({ assignee_id: checker, qc_id: me })], processRow({ active: true, is_qc: false, name: "Cắt nền" }));
    expect(await failure(createProductionSubtask(contextWith(["QC"]), lineId, { ...input, qtyAssigned: 2 }))).toMatchObject({ status: 403 });
    expect(callsLike(/^UPDATE production\.tasks|^INSERT INTO production\.tasks/)).toHaveLength(0);

    db.state.handler = store([taskRow()], (call) =>
      processRow({ active: true, is_qc: false, name: "Cắt nền" })(call) ?? (call.text.startsWith("INSERT INTO production.tasks") ? [{ number: "8" }] : undefined)
    );
    await createProductionSubtask(contextWith(["STAFF"]), lineId, { ...input, qtyAssigned: 2 }).catch(() => undefined);
    expect(callsLike(/^UPDATE production\.tasks SET qty_assigned = \$/)[0]?.values[0]).toBe(5);
    expect(callsLike(/^INSERT INTO production\.tasks/)[0]?.text).toContain("'NORMAL', p.id");
    const logs = JSON.stringify(callsLike(/^INSERT INTO production\.task_logs/)[0]?.values);
    expect(logs).toContain('"op":"created"');
    expect(logs).toContain('"parentQtyAssigned":5');
    // No "task assigned" notification: it is the same person's work.
    expect(spies.events).toEqual([]);
  });

  it("deleting a subtask before Done gives its quantity back to the line", async () => {
    db.state.handler = store([taskRow({ subtasks: [subtaskJson()] }), subtaskRow()], (call) =>
      call.text.startsWith("SELECT id, qty_assigned, done_at FROM production.tasks") ? [{ id: lineId, qty_assigned: 7, done_at: null }] : undefined
    );
    await deleteProductionTask(contextWith(["STAFF"]), subId);
    expect(callsLike(/^UPDATE production\.tasks SET deleted_at/)[0]?.values).toContainEqual([subId]);
    expect(callsLike(/^UPDATE production\.tasks SET qty_assigned = \$/)[0]?.values[0]).toBe(10);
    expect(JSON.stringify(callsLike(/^INSERT INTO production\.task_logs/).map((call) => call.values))).toContain('"op":"deleted"');
  });

  it("deleting a line deletes its subtasks with it; staff never delete their line (PD-047: delete none)", async () => {
    db.state.handler = store([taskRow({ subtasks: [subtaskJson()] }), subtaskRow()]);
    expect(await failure(deleteProductionTask(contextWith(["STAFF"]), lineId))).toEqual({
      code: "FORBIDDEN",
      status: 403,
      message: "Bạn không có quyền xoá công việc."
    });
    expect(callsLike(/^UPDATE production\.tasks SET deleted_at/)).toHaveLength(0);
    await deleteProductionTask(contextWith(["LEADER"]), lineId);
    expect(callsLike(/^UPDATE production\.tasks SET deleted_at/)[0]?.values).toContainEqual([lineId, subId]);
  });
});

describe("quantity requests (PD-044)", () => {
  const requestQueries = (rows: TaskRow[], request: Record<string, unknown>) =>
    store(rows, (call) => {
      if (call.text.startsWith("SELECT task_id FROM production.task_qty_requests")) {
        return [{ task_id: lineId }];
      }
      if (call.text.startsWith("SELECT id, task_id, status, from_qty, to_qty, requested_by FROM production.task_qty_requests")) {
        return [request];
      }
      if (call.text.startsWith("INSERT INTO production.task_qty_requests")) {
        return [{ id: requestId }];
      }
      return undefined;
    });
  const open = { id: requestId, task_id: lineId, status: "PENDING", from_qty: 10, to_qty: 12, requested_by: me };

  it("the worker asks for a new total: from = the current total (line + subtasks); the Leader is notified", async () => {
    db.state.handler = requestQueries([taskRow({ subtasks: [subtaskJson()] })], open);
    await createQtyRequest(contextWith(["STAFF"]), lineId, { qtyAssigned: 12, reason: "Thư mục có thêm 2 ảnh" }).catch(() => undefined);
    expect(callsLike(/^INSERT INTO production\.task_qty_requests/)[0]?.values.slice(3, 6)).toEqual([me, 10, 12]);
    expect(spies.events.map((event) => event.type)).toEqual(["production.task.qty_change_requested"]);
    expect(JSON.stringify(callsLike(/^INSERT INTO production\.task_logs/)[0]?.values)).toContain('"op":"requested"');
  });

  it("one open request per line; the same total or one the subtasks do not fit in is refused; only the worker asks", async () => {
    db.state.handler = requestQueries([taskRow({ pending_qty_request: pendingRequest() })], open);
    expect(await failure(createQtyRequest(contextWith(["STAFF"]), lineId, { qtyAssigned: 12, reason: "x" }))).toMatchObject({ code: "QTY_REQUEST_OPEN", status: 409 });
    db.state.handler = requestQueries([taskRow({ subtasks: [subtaskJson()] })], open);
    expect(await failure(createQtyRequest(contextWith(["STAFF"]), lineId, { qtyAssigned: 10, reason: "x" }))).toMatchObject({ code: "QTY_REQUEST_INVALID" });
    expect(await failure(createQtyRequest(contextWith(["STAFF"]), lineId, { qtyAssigned: 3, reason: "x" }))).toMatchObject({ code: "QTY_REQUEST_INVALID" });
    db.state.handler = requestQueries([taskRow({ assignee_id: checker })], open);
    expect(await failure(createQtyRequest(contextWith(["LEADER"], leader), lineId, { qtyAssigned: 12, reason: "x" }))).toMatchObject({ status: 403 });
    expect(callsLike(/^INSERT INTO production\.task_qty_requests/)).toHaveLength(0);
  });

  it("the Leader approves: the line's own quantity becomes the new total minus its subtasks; the worker is notified", async () => {
    db.state.handler = requestQueries([taskRow({ subtasks: [subtaskJson()], pending_qty_request: pendingRequest() })], open);
    await decideQtyRequest(contextWith(["LEADER"], leader), requestId, { approve: true, note: "Đồng ý" }).catch(() => undefined);
    expect(callsLike(/^UPDATE production\.tasks SET qty_assigned = \$/)[0]?.values[0]).toBe(9);
    expect(callsLike(/^UPDATE production\.task_qty_requests/)[0]?.values.slice(0, 3)).toEqual(["APPROVED", leader, "Đồng ý"]);
    expect(spies.events.map((event) => event.type)).toEqual(["production.task.qty_change_decided"]);
  });

  it("approving after Done is refused; a decided request is closed; only the Leader / update all decides", async () => {
    db.state.handler = requestQueries([taskRow({ done_at: new Date(), pending_qty_request: pendingRequest() })], open);
    expect(await failure(decideQtyRequest(contextWith(["LEADER"], leader), requestId, { approve: true }))).toEqual({
      code: "TASK_ALREADY_DONE",
      status: 409,
      message: "Task đã Done — hãy từ chối đề nghị."
    });
    db.state.handler = requestQueries([taskRow()], { ...open, status: "REJECTED" });
    expect(await failure(decideQtyRequest(contextWith(["LEADER"], leader), requestId, { approve: false }))).toMatchObject({ code: "QTY_REQUEST_CLOSED", status: 409 });
    db.state.handler = requestQueries([taskRow({ pending_qty_request: pendingRequest() })], open);
    expect(await failure(decideQtyRequest(contextWith(["STAFF"]), requestId, { approve: true }))).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(callsLike(/^UPDATE production\./)).toHaveLength(0);
  });

  it("the worker who asked may cancel an open request", async () => {
    db.state.handler = requestQueries([taskRow({ pending_qty_request: pendingRequest() })], open);
    await cancelQtyRequest(contextWith(["STAFF"]), requestId).catch(() => undefined);
    expect(callsLike(/^UPDATE production\.task_qty_requests SET status = 'CANCELLED'/)).toHaveLength(1);
    db.state.calls = [];
    db.state.handler = requestQueries([taskRow({ pending_qty_request: pendingRequest() })], { ...open, requested_by: checker });
    expect(await failure(cancelQtyRequest(contextWith(["STAFF"]), requestId))).toMatchObject({ status: 403 });
    expect(callsLike(/^UPDATE production\./)).toHaveLength(0);
  });
});
