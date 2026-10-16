import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessContext } from "../access/access-context.js";
import type * as JobsRepoModule from "./jobs.repo.js";
import type * as NotificationsModule from "./notifications.js";
import type { JobRow, SubtaskJson, TaskRow } from "./jobs.repo.js";
import type { Workflow, WorkflowStatus } from "./workflow.js";

/**
 * PD-058 "a task's quantity is optional until Done" at the service level, without a database (same fake `sql` as
 * pd044.test.ts): lines and subtasks created without a quantity, the carving rule, totals over known numbers, the worker
 * filling an empty quantity in directly (Leader told), no quantity request on an empty one, Done that needs the numbers
 * and stores them twice, anomalies that skip empty quantities. Fake names and ids only: the repository is public.
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

const { moveTasks, insertTasks, transitionProductionTask, updateProductionTask, deleteProductionTask, syncJobTotalImages } = await import("./tasks.service.js");
const { toProductionTask, relationOf, jobSelectSql, toJobSummary, allocatedQtyOf } = await import("./jobs.repo.js");
const { createProductionSubtask } = await import("./subtasks.service.js");
const { createQtyRequest } = await import("./qty-requests.service.js");
const { listAnomalies } = await import("./anomalies.service.js");
const { clearProductionConfigCache } = await import("./catalog-cache.js");
const { lineFinishStatusIds } = await import("./workflow.js");
const {
  CreateSubtaskRequestSchema,
  CreateTaskLineSchema,
  CreateWorkEntryRequestSchema,
  JobSummarySchema,
  ProductionTaskSchema,
  TaskQtyRequiredDetailsSchema
} = await import("../../contracts/production-jobs.js");
const { DashboardTaskSchema } = await import("../../contracts/production-reports.js");
const { notificationTypes } = await import("../../contracts/notifications.js");

const org = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const leader = "33333333-3333-4333-8333-333333333333";
const checker = "44444444-4444-4444-8444-444444444444";
const lineId = "55555555-5555-4555-8555-555555555555";
const subId = "56565656-5656-4565-8565-565656565656";
const jobId = "66666666-6666-4666-8666-666666666666";
const processId = "77777777-7777-4777-8777-777777777777";
const otherProcessId = "78787878-7878-4787-8787-787878787878";
const shiftId = "88888888-8888-4888-8888-888888888888";

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
    { fromStatusId: "PROCESSING", toStatusId: "DONE", actors: ["ASSIGNEE"], requiresNote: false },
    { fromStatusId: "DONE", toStatusId: "WAITING_QC", actors: ["SYSTEM", "JOB_LEADER"], requiresNote: false },
    { fromStatusId: "WAITING_QC", toStatusId: "CHECKED", actors: ["QC"], requiresNote: false }
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
  qty_assigned: null,
  qty_done: null,
  reason: null,
  created_by: userJson(me),
  created_at: "2026-10-16T03:00:00.000Z",
  ...overrides
});
const taskRow = (overrides: Partial<TaskRow> = {}): TaskRow => ({
  id: lineId,
  number: 1286,
  job_id: jobId,
  job_code: "VD JOB-58",
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
  qty_assigned: null,
  qty_done: null,
  error_qty: null,
  ot_hours: null,
  assigned_at: new Date("2026-10-16T00:00:00Z"),
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
  created_at: new Date("2026-10-16T00:00:00Z"),
  updated_at: new Date("2026-10-16T00:00:00Z"),
  closed_at: null,
  deadline_cursor: "2099-01-01 00:00:00.000000+00",
  job_archived: false,
  job_open_feedback: false,
  split_reason: null,
  // The Leader split the line (PD-044: the worker may not change the Leader's number directly).
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
    number: 1300,
    parent_task_id: lineId,
    sub_seq: 1,
    parent_number: 1286,
    process_id: otherProcessId,
    process_name: "Cắt nền",
    created_by: me,
    ...overrides
  });

/** Answers the reads of locked tasks, the subtasks of a line and a settled job from `rows`; `extra` answers first. */
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

type Failure = { code: string | undefined; status: number | undefined; message: string; details: unknown };
const failure = async (promise: Promise<unknown>): Promise<Failure | null> => {
  try {
    await promise;
  } catch (error) {
    const caught = error as { code?: string; statusCode?: number; details?: unknown };
    return { code: caught.code, status: caught.statusCode, message: (error as Error).message, details: caught.details };
  }
  return null;
};
const callsLike = (pattern: RegExp) => db.state.calls.filter((call) => pattern.test(call.text));
const statusUpdate = () => callsLike(/^UPDATE production\.tasks AS t SET status_id/)[0];
const movedRows = () => (statusUpdate()?.values.find((value) => Array.isArray(value)) ?? []) as Record<string, unknown>[];
const logRows = () =>
  callsLike(/^INSERT INTO production\.task_logs/).flatMap((call) => call.values[1] as { taskId: string; action: string; from: unknown; to: unknown }[]);
const access = (roles: string[], userId = me) => ({
  scopes: roles.includes("LEADER")
    ? ({ view: "all", create: "all", update: "all", delete: "all" } as const)
    : ({ view: "all", create: "none", update: "own", delete: "none" } as const),
  userId
});

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = () => [];
  spies.scored = [];
  spies.events = [];
  clearProductionConfigCache();
});

describe("contracts: the quantity is optional when creating, required (≥ 1) only when given", () => {
  const ids = { assigneeId: me, processId, shiftId };

  it("Chia task / Nhập Task / subtask accept an omitted or null quantity; 0 is still refused", () => {
    expect(CreateTaskLineSchema.parse(ids).qtyAssigned).toBeUndefined();
    expect(CreateTaskLineSchema.parse({ ...ids, qtyAssigned: null }).qtyAssigned).toBeNull();
    expect(CreateTaskLineSchema.safeParse({ ...ids, qtyAssigned: 0 }).success).toBe(false);
    expect(CreateSubtaskRequestSchema.parse({ processId }).qtyAssigned).toBeUndefined();
    expect(CreateSubtaskRequestSchema.safeParse({ processId, qtyAssigned: 0 }).success).toBe(false);
    const entry = { projectId: jobId, jobId, processId, shiftId, assignedAt: "2026-10-16T00:00:00Z", deadline: "2026-10-17T00:00:00Z" };
    expect(CreateWorkEntryRequestSchema.safeParse(entry).success).toBe(true);
    expect(CreateWorkEntryRequestSchema.safeParse({ ...entry, qtyAssigned: null }).success).toBe(true);
  });

  it("every task representation allows null; the dashboard task too; the qty_filled notification type exists", () => {
    expect(ProductionTaskSchema.shape.qtyAssigned.safeParse(null).success).toBe(true);
    expect(DashboardTaskSchema.shape.qtyAssigned.safeParse(null).success).toBe(true);
    expect(TaskQtyRequiredDetailsSchema.parse({ taskIds: [lineId] })).toEqual({ taskIds: [lineId] });
    expect(notificationTypes).toContain("production.qty_filled");
  });
});

describe("creating without a quantity", () => {
  const job = { id: jobId, leader_id: leader, received_at: new Date("2026-10-16T00:00:00Z"), deadline: new Date("2099-01-01T00:00:00Z"), qc_buffer_hours: 0 };
  const lineQueries = (call: Call) => {
    if (call.text.includes("FROM public.organization_memberships om") && call.text.includes("array_agg(ur.role_code)")) {
      return [
        { user_id: me, roles: ["STAFF"], superadmin: false },
        { user_id: checker, roles: ["QC"], superadmin: false }
      ];
    }
    if (call.text.startsWith("SELECT id, active, is_qc, name FROM production.processes")) {
      return [{ id: processId, active: true, is_qc: false, name: "Retouch" }];
    }
    if (call.text.startsWith("SELECT id, active FROM production.shifts")) {
      return [{ id: shiftId, active: true }];
    }
    if (call.text.includes("coalesce(sum(qty_assigned), 0)::int AS total")) {
      return [{ total: 500 }];
    }
    return undefined;
  };

  it("Chia task stores NULL ('chưa có số lượng'); a line without a number never warns about a typed Tổng tấm", async () => {
    db.state.handler = lineQueries;
    const line = CreateTaskLineSchema.parse({ assigneeId: me, qcId: checker, processId, shiftId });
    const result = await insertTasks(db.sql as never, contextWith(["LEADER"], leader), workflow, { ...job, total_images: 10, total_images_manual: true }, [line], {
      kind: "NORMAL",
      feedbackId: null,
      defaultParentId: null
    });
    expect(result.warnings).toEqual([]);
    // Nothing to compare: the assigned total is not even read.
    expect(callsLike(/coalesce\(sum\(qty_assigned\), 0\)::int AS total/)).toHaveLength(0);
    const insert = callsLike(/^INSERT INTO production\.tasks/)[0]!;
    const rows = insert.values.find((value): value is Record<string, unknown>[] => Array.isArray(value))!;
    expect(rows[0]).toMatchObject({ qtyAssigned: null });
    expect(logRows()[0]).toMatchObject({ action: "CREATE", to: { qtyAssigned: null } });
    // The worker is still told about the new task.
    expect(spies.events.map((event) => event.type)).toEqual(["production.task.assigned"]);

    // A number next to it still warns against the typed total (known numbers only).
    db.state.calls = [];
    const counted = await insertTasks(
      db.sql as never,
      contextWith(["LEADER"], leader),
      workflow,
      { ...job, total_images: 10, total_images_manual: true },
      [line, { ...line, qtyAssigned: 20 }],
      { kind: "NORMAL", feedbackId: null, defaultParentId: null }
    );
    expect(counted.warnings).toEqual(["Tổng số tấm đã giao (520) vượt tổng tấm của job (10)."]);
  });

  it("a subtask without a number takes nothing from its line; one with a number from a line without one takes nothing either", async () => {
    const processRow = (call: Call) =>
      call.text.startsWith("SELECT active, is_qc, name FROM production.processes")
        ? [{ active: true, is_qc: false, name: "Cắt nền" }]
        : call.text.startsWith("INSERT INTO production.tasks")
          ? [{ number: "1300" }]
          : undefined;
    db.state.handler = store([taskRow({ qty_assigned: 7 })], processRow);
    await createProductionSubtask(contextWith(["STAFF"]), lineId, CreateSubtaskRequestSchema.parse({ processId: otherProcessId })).catch(() => undefined);
    expect(callsLike(/^UPDATE production\.tasks SET qty_assigned/)).toHaveLength(0);
    expect(callsLike(/^INSERT INTO production\.tasks/)[0]!.values).toContain(null);
    expect(logRows().find((log) => log.action === "SUBTASK")).toMatchObject({ to: { op: "created", qtyAssigned: null, parentQtyAssigned: 7 } });

    // The line has no number: any subtask number is recorded as it is (no "task giữ lại ít nhất 1 tấm" rule to apply).
    db.state.calls = [];
    db.state.handler = store([taskRow({ qty_assigned: null })], processRow);
    await createProductionSubtask(contextWith(["STAFF"]), lineId, CreateSubtaskRequestSchema.parse({ processId: otherProcessId, qtyAssigned: 30 })).catch(
      () => undefined
    );
    expect(callsLike(/^UPDATE production\.tasks SET qty_assigned/)).toHaveLength(0);
    expect(callsLike(/^INSERT INTO production\.tasks/)[0]!.values).toContain(30);
    expect(logRows().find((log) => log.action === "SUBTASK")).toMatchObject({ to: { qtyAssigned: 30, parentQtyAssigned: null } });

    // Both have numbers: carved exactly as before (PD-044).
    db.state.calls = [];
    db.state.handler = store([taskRow({ qty_assigned: 7 })], processRow);
    await createProductionSubtask(contextWith(["STAFF"]), lineId, CreateSubtaskRequestSchema.parse({ processId: otherProcessId, qtyAssigned: 2 })).catch(
      () => undefined
    );
    expect(callsLike(/^UPDATE production\.tasks SET qty_assigned = \$/)[0]?.values[0]).toBe(5);
    db.state.handler = store([taskRow({ qty_assigned: 7 })], processRow);
    expect(
      await failure(createProductionSubtask(contextWith(["STAFF"]), lineId, CreateSubtaskRequestSchema.parse({ processId: otherProcessId, qtyAssigned: 7 })))
    ).toMatchObject({ code: "SUBTASK_QTY_INVALID", status: 400 });
  });
});

describe("totals over known numbers", () => {
  it("job rows count the tasks without a quantity and leave them out of every sum", () => {
    const text = (jobSelectSql(db.sql as never, lineFinishStatusIds(workflow)) as unknown as Fragment).text.replace(/\s+/g, " ");
    // Every live task — subtasks and Checking lines included.
    expect(text).toContain("count(*) FILTER (WHERE t.qty_assigned IS NULL) AS tasks_without_qty");
    expect(text).toContain("coalesce(agg.tasks_without_qty, 0)::int AS tasks_without_qty");
    // "Người làm" and per process: known numbers only (a process with none known is not listed).
    expect(text).toContain("coalesce(sum(t.qty_assigned), 0)::int AS qty");
    expect(text).toContain("AND NOT pr.is_qc AND t.qty_assigned IS NOT NULL");
  });

  it("Tổng tấm (automatic) adds known numbers only: sum() skips NULL", async () => {
    await syncJobTotalImages(db.sql as never, org, jobId);
    expect(callsLike(/^UPDATE production\.jobs j SET total_images/)[0]!.text).toContain("coalesce(sum(t.qty_assigned), 0)::int AS total");
  });

  it("a job summary carries tasksWithoutQty; 'Số lượng / Tổng' of a line adds its known numbers", () => {
    const row = {
      id: jobId,
      number: 1,
      code: "Batch 58",
      name: null,
      project_id: jobId,
      project_code: "P1",
      project_name: "Dự án",
      client_name: null,
      leader_id: null,
      leader: null,
      received_at: new Date("2026-10-16T00:00:00Z"),
      deadline: new Date("2099-01-01T00:00:00Z"),
      total_images: 30,
      total_images_manual: false,
      drive_link: null,
      channel_id: null,
      job_status_id: jobId,
      job_status_name: "Mới nhận",
      job_status_color: "slate",
      job_status_closed: false,
      job_status_requires_all_checked: false,
      status_id: null,
      status_code: null,
      status_name: null,
      status_color: null,
      qty_assigned: 30,
      qty_done: 0,
      qty_checked: 0,
      task_count: 2,
      late_task_count: 0,
      unchecked_task_count: 2,
      tasks_without_qty: 2,
      open_feedback_count: 0,
      workers: null,
      qc_people: null,
      process_totals: [{ id: otherProcessId, name: "Cắt nền", qty: 30 }],
      person_share: null,
      custom_values: {},
      tag_ids: null,
      created_by: null,
      created_at: new Date("2026-10-16T01:00:00Z"),
      created_cursor: "2026-10-16T01:00:00.000000Z",
      archived_at: null
    } satisfies JobRow;
    const summary = JobSummarySchema.parse(toJobSummary(row));
    expect(summary).toMatchObject({ tasksWithoutQty: 2, qtyAssigned: 30, totalImages: 30 });

    expect(allocatedQtyOf({ qty_assigned: null, subtasks: [subtaskJson({ qty_assigned: 30 }), subtaskJson({ qty_assigned: null })] })).toBe(30);
    expect(allocatedQtyOf({ qty_assigned: null, subtasks: null })).toBe(0);
  });
});

describe("the worker fills an empty quantity in directly", () => {
  it("the assignee sets it (no request), it is logged — — → 120 — and the job's Leader is told", async () => {
    db.state.handler = store([taskRow()]);
    await updateProductionTask(contextWith(["STAFF"]), lineId, { qtyAssigned: 120 }).catch(() => undefined);
    const update = callsLike(/^UPDATE production\.tasks SET qty_assigned = \$, process_id/)[0]!;
    expect(update.values[0]).toBe(120);
    expect(callsLike(/^UPDATE production\.jobs j SET total_images/)).toHaveLength(1);
    expect(logRows()).toContainEqual(expect.objectContaining({ action: "FIELD", from: { qtyAssigned: null }, to: { qtyAssigned: 120 } }));
    expect(spies.events).toEqual([
      expect.objectContaining({ type: "production.task.qty_filled", actorUserId: me, payload: { taskId: lineId, qty: 120, atDone: false } })
    ]);
  });

  it("changing a number keeps PD-044 (403 QTY_REQUEST_REQUIRED); someone else's empty task stays theirs (403)", async () => {
    db.state.handler = store([taskRow({ qty_assigned: 100 })]);
    expect(await failure(updateProductionTask(contextWith(["STAFF"]), lineId, { qtyAssigned: 120 }))).toMatchObject({ code: "QTY_REQUEST_REQUIRED", status: 403 });
    db.state.handler = store([taskRow({ assignee_id: checker, qc_id: leader })]);
    expect(await failure(updateProductionTask(contextWith(["STAFF"]), lineId, { qtyAssigned: 120 }))).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(callsLike(/^UPDATE production\./)).toHaveLength(0);
    expect(spies.events).toEqual([]);
    // The Leader (or "update: all") fills it in too; nobody is told about their own step by the handler.
    db.state.handler = store([taskRow()]);
    await updateProductionTask(contextWith(["LEADER"], leader), lineId, { qtyAssigned: 80 }).catch(() => undefined);
    expect(callsLike(/^UPDATE production\.tasks SET qty_assigned = \$, process_id/)[0]?.values[0]).toBe(80);
    expect(spies.events.map((event) => event.type)).toEqual(["production.task.qty_filled"]);
  });

  it("capabilities: the assignee edits an empty quantity directly and never requests it", () => {
    const line = taskRow();
    const task = toProductionTask(line, workflow, relationOf(contextWith(["STAFF"]), line), access(["STAFF"]));
    expect(task).toMatchObject({ qtyAssigned: null, allocatedQty: 0 });
    expect(ProductionTaskSchema.shape.qtyAssigned.parse(task.qtyAssigned)).toBeNull();
    expect(task.capabilities).toMatchObject({ canEditQtyAssigned: true, canRequestQty: false });
    const numbered = taskRow({ qty_assigned: 100 });
    expect(toProductionTask(numbered, workflow, relationOf(contextWith(["STAFF"]), numbered), access(["STAFF"])).capabilities).toMatchObject({
      canEditQtyAssigned: false,
      canRequestQty: true
    });
    // Someone else's empty task: nothing to fill for a staff member.
    const theirs = taskRow({ assignee_id: checker, qc_id: leader });
    expect(toProductionTask(theirs, workflow, relationOf(contextWith(["STAFF"]), theirs), access(["STAFF"])).capabilities.canEditQtyAssigned).toBe(false);
  });

  it("an empty subtask filled in takes its number from a line that has one (the line keeps ≥ 1); from an empty line nothing", async () => {
    const parentRow = (qty: number | null) => (call: Call) =>
      call.text.startsWith("SELECT id, number, process_id, qty_assigned, done_at FROM production.tasks")
        ? [{ id: lineId, number: "1286", process_id: processId, qty_assigned: qty, done_at: null }]
        : undefined;
    db.state.handler = store([taskRow({ qty_assigned: 100, subtasks: [subtaskJson()] }), subtaskRow()], parentRow(100));
    await updateProductionTask(contextWith(["STAFF"]), subId, { qtyAssigned: 30 }).catch(() => undefined);
    const updates = callsLike(/^UPDATE production\.tasks SET (process_id|qty_assigned)/);
    expect(updates[0]!.values.slice(0, 2)).toEqual([otherProcessId, 30]);
    expect(updates[1]!.values[0]).toBe(70);
    expect(logRows().find((log) => log.action === "SUBTASK")).toMatchObject({ from: { qtyAssigned: null, parentQtyAssigned: 100 }, to: { qtyAssigned: 30, parentQtyAssigned: 70 } });
    expect(spies.events).toEqual([expect.objectContaining({ type: "production.task.qty_filled", payload: { taskId: subId, qty: 30, atDone: false } })]);
    db.state.handler = store([taskRow({ qty_assigned: 100, subtasks: [subtaskJson()] }), subtaskRow()], parentRow(100));
    expect(await failure(updateProductionTask(contextWith(["STAFF"]), subId, { qtyAssigned: 100 }))).toMatchObject({ code: "SUBTASK_QTY_INVALID" });

    db.state.calls = [];
    spies.events = [];
    db.state.handler = store([taskRow({ subtasks: [subtaskJson()] }), subtaskRow()], parentRow(null));
    await updateProductionTask(contextWith(["STAFF"]), subId, { qtyAssigned: 30 }).catch(() => undefined);
    expect(callsLike(/^UPDATE production\.tasks SET qty_assigned/)).toHaveLength(0);
    expect(callsLike(/^UPDATE production\.tasks SET process_id/)[0]!.values.slice(0, 2)).toEqual([otherProcessId, 30]);
    expect(spies.events.map((event) => event.type)).toEqual(["production.task.qty_filled"]);
  });

  it("deleting a subtask gives back only a number to a line that has one", async () => {
    const parentRow = (qty: number | null) => (call: Call) =>
      call.text.startsWith("SELECT id, qty_assigned, done_at FROM production.tasks") ? [{ id: lineId, qty_assigned: qty, done_at: null }] : undefined;
    db.state.handler = store([taskRow({ subtasks: [subtaskJson()] }), subtaskRow()], parentRow(100));
    await deleteProductionTask(contextWith(["STAFF"]), subId);
    expect(callsLike(/^UPDATE production\.tasks SET qty_assigned/)).toHaveLength(0);
    db.state.calls = [];
    db.state.handler = store([taskRow({ subtasks: [subtaskJson({ qty_assigned: 30 })] }), subtaskRow({ qty_assigned: 30 })], parentRow(null));
    await deleteProductionTask(contextWith(["STAFF"]), subId);
    expect(callsLike(/^UPDATE production\.tasks SET qty_assigned/)).toHaveLength(0);
  });

  it("a quantity request on an empty task → 409 TASK_QTY_EMPTY; nothing written", async () => {
    db.state.handler = store([taskRow()]);
    expect(await failure(createQtyRequest(contextWith(["STAFF"]), lineId, { qtyAssigned: 12, reason: "Thư mục có 12 ảnh" }))).toEqual({
      code: "TASK_QTY_EMPTY",
      status: 409,
      message: "Task chưa có số lượng — điền trực tiếp vào ô số lượng.",
      details: undefined
    });
    expect(callsLike(/^INSERT INTO production\./)).toHaveLength(0);
    expect(spies.events).toEqual([]);
  });
});

describe("Done needs the numbers", () => {
  const withEmptySubtask = () => store([taskRow({ subtasks: [subtaskJson()] }), subtaskRow()]);

  it("missing → 400 TASK_QTY_REQUIRED naming the line and / or its subtasks; nothing written", async () => {
    db.state.handler = withEmptySubtask();
    expect(await failure(transitionProductionTask(contextWith(["STAFF"]), lineId, { toStatusId: "DONE" }))).toEqual({
      code: "TASK_QTY_REQUIRED",
      status: 400,
      message: "Nhập số lượng trước khi chuyển Done.",
      details: { taskIds: [lineId, subId] }
    });
    expect(await failure(transitionProductionTask(contextWith(["STAFF"]), lineId, { toStatusId: "DONE", qtyDone: 120 }))).toMatchObject({
      code: "TASK_QTY_REQUIRED",
      details: { taskIds: [subId] }
    });
    // 0 is no number either.
    expect(
      await failure(transitionProductionTask(contextWith(["STAFF"]), lineId, { toStatusId: "DONE", qtyDone: 0, subtaskQtyDone: [{ taskId: subId, qtyDone: 30 }] }))
    ).toMatchObject({ code: "TASK_QTY_REQUIRED", details: { taskIds: [lineId] } });
    expect(statusUpdate()).toBeUndefined();
    expect(callsLike(/^INSERT INTO production\.task_logs/)).toHaveLength(0);
    expect(spies.scored).toEqual([]);
    expect(spies.events).toEqual([]);
  });

  it("given → each number becomes both quantities (uncapped), logged — → N, scored, the Leader told per task", async () => {
    db.state.handler = withEmptySubtask();
    await moveTasks(db.sql as never, org, workflow, [taskRow({ subtasks: [subtaskJson()] })], statusOf("DONE"), me, null, {
      qtyDone: 120,
      subtaskQtyDone: [{ taskId: subId, qtyDone: 30 }]
    });
    expect(statusUpdate()!.text).toContain("qty_assigned = CASE WHEN (m->>'fillQty')::boolean THEN (m->>'qtyAssigned')::int ELSE t.qty_assigned END");
    expect(movedRows()).toEqual([
      expect.objectContaining({ id: lineId, firstDone: true, setQty: true, fillQty: true, qtyAssigned: 120, qtyDone: 120 }),
      expect.objectContaining({ id: subId, firstDone: true, setQty: true, fillQty: true, qtyAssigned: 30, qtyDone: 30 })
    ]);
    expect(logRows().map((log) => [log.taskId, log.from, log.to])).toEqual([
      [lineId, expect.objectContaining({ qtyAssigned: null }), expect.objectContaining({ qtyAssigned: 120, qtyDone: 120 })],
      [subId, expect.objectContaining({ qtyAssigned: null }), expect.objectContaining({ qtyAssigned: 30, qtyDone: 30 })]
    ]);
    // The ledger hook runs after the UPDATE (it reads the numbers back), for the line and its subtask.
    expect(spies.scored).toEqual([lineId, subId]);
    expect(spies.events.map((event) => [event.type, event.payload])).toEqual([
      ["production.task.qty_filled", { taskId: lineId, qty: 120, atDone: true }],
      ["production.task.qty_filled", { taskId: subId, qty: 30, atDone: true }]
    ]);
  });

  it("a line with a number keeps today's Done (default = its quantity, capped); only its empty subtask needs one", async () => {
    db.state.handler = store([taskRow({ qty_assigned: 10, subtasks: [subtaskJson()] }), subtaskRow()]);
    expect(
      await failure(moveTasks(db.sql as never, org, workflow, [taskRow({ qty_assigned: 10, subtasks: [subtaskJson()] })], statusOf("DONE"), me, null, {}))
    ).toMatchObject({ code: "TASK_QTY_REQUIRED", details: { taskIds: [subId] } });
    expect(
      await failure(
        moveTasks(db.sql as never, org, workflow, [taskRow({ qty_assigned: 10 })], statusOf("DONE"), me, null, {
          qtyDone: 99,
          subtaskQtyDone: [{ taskId: subId, qtyDone: 5 }]
        })
      )
    ).toMatchObject({ code: "QTY_DONE_TOO_HIGH" });
    db.state.calls = [];
    await moveTasks(db.sql as never, org, workflow, [taskRow({ qty_assigned: 10 })], statusOf("DONE"), me, null, { subtaskQtyDone: [{ taskId: subId, qtyDone: 5 }] });
    expect(movedRows()).toEqual([
      expect.objectContaining({ id: lineId, fillQty: false, qtyAssigned: 10, qtyDone: 10 }),
      expect.objectContaining({ id: subId, fillQty: true, qtyAssigned: 5, qtyDone: 5 })
    ]);
    expect(spies.events.map((event) => event.payload.taskId)).toEqual([subId]);
  });

  it("moves that are not Done never ask for a number (an empty task can start, or wait for QC by override)", async () => {
    db.state.handler = store([taskRow({ status_id: "ASSIGNED", status_code: "ASSIGNED" })]);
    await moveTasks(db.sql as never, org, workflow, [taskRow({ status_id: "ASSIGNED", status_code: "ASSIGNED" })], statusOf("PROCESSING"), me, null);
    expect(movedRows()[0]).toMatchObject({ fillQty: false, setQty: false, qtyAssigned: null });
  });
});

describe("anomalies never call an empty quantity 'lệch số lượng'", () => {
  it("QTY_MISMATCH reads tasks that have both numbers only", async () => {
    // PD-065: "Bất thường" is the Director's by default.
    await listAnomalies(contextWith(["DIRECTOR"], leader), { kind: "QTY_MISMATCH", days: 30, includeReviewed: false });
    const query = callsLike(/t\.qty_done <> t\.qty_assigned/)[0]!;
    expect(query.text).toContain("AND t.qty_done IS NOT NULL AND t.qty_assigned IS NOT NULL AND t.qty_done <> t.qty_assigned");
  });
});

describe("exports show an empty quantity as an empty cell", () => {
  it("work log 'Số lượng' is empty; 'Người làm' names someone without a number by name only", async () => {
    const { workLogCells, workersCell } = await import("./exports.service.js");
    const cells = workLogCells({
      job_id: jobId,
      assignee: "Người A",
      project_code: "P1",
      job_code: "Batch 58",
      process: "Retouch",
      assigned_at: new Date("2026-10-16T00:00:00Z"),
      deadline: new Date("2026-10-17T16:59:00Z"),
      shift: "Ca 1",
      qty_assigned: null,
      error_qty: null,
      ot_hours: null,
      note: null,
      status: "PROCESSING",
      qc: null,
      job_status: "Mới nhận",
      work_link: null
    });
    expect(cells.qty).toBeNull();
    const user = (id: string, name: string) => ({ id, displayName: name, email: null, avatarUrl: null });
    expect(
      workersCell([
        { user: user(me, "Người A"), qty: 30, taskCount: 1 },
        { user: user(checker, "Người B"), qty: 0, taskCount: 1 }
      ])
    ).toBe("Người A · 30 tấm, Người B");
  });
});
