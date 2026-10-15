import { beforeEach, describe, expect, it, vi } from "vitest";

import { kpiPeriodOfDay } from "../../contracts/production-scores.js";
import type { AccessContext } from "../access/access-context.js";
import type * as JobsRepoModule from "./jobs.repo.js";
import type * as NotificationsModule from "./notifications.js";
import type { TaskRow } from "./jobs.repo.js";
import type { Workflow, WorkflowStatus } from "./workflow.js";

/**
 * Service-level checks of the 2026-10-11 spec gaps without a database (same fake `sql` as security.test.ts):
 * required TASK fields on "Chia task" / "Giao lại" (G3), task tag history and job edit history (G11), and the
 * KPI close day applying from the next period (G15).
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
const fixtures = vi.hoisted(() => { const state: { workflow: unknown } = { workflow: null }; return state; });

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
vi.mock("./scoring-hooks.js", () => ({ onTaskStatusEntered: vi.fn(() => Promise.resolve()), onTaskQtyChanged: vi.fn(() => Promise.resolve()) }));
vi.mock("./notifications.js", async (importOriginal) => ({
  ...(await importOriginal<typeof NotificationsModule>()),
  enqueueProductionEvents: vi.fn(() => Promise.resolve())
}));
vi.mock("./jobs.repo.js", async (importOriginal) => ({
  ...(await importOriginal<typeof JobsRepoModule>()),
  loadWorkflowModel: vi.fn(() => Promise.resolve(fixtures.workflow as Workflow))
}));

const { createProductionTasks, insertTasks, updateProductionTask } = await import("./tasks.service.js");
const { jobEditChanges, reassignFeedback, updateJob } = await import("./jobs.service.js");
const { updateSettings } = await import("./catalog.service.js");
const { clearProductionConfigCache } = await import("./catalog-cache.js");
const { businessDay } = await import("./time.js");
const { shiftPeriod } = await import("./scoring.js");

const org = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const worker = "33333333-3333-4333-8333-333333333333";
const checker = "44444444-4444-4444-8444-444444444444";
const taskId = "55555555-5555-4555-8555-555555555555";
const jobId = "66666666-6666-4666-8666-666666666666";
const processId = "77777777-7777-4777-8777-777777777777";
const shiftId = "88888888-8888-4888-8888-888888888888";
const tagA = "99999999-9999-4999-8999-999999999999";
const tagB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const feedbackId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const projectId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const contextWith = (roles: string[], full = false) =>
  ({ user: { id: me }, organization: { id: org }, hasFullOrganizationAuthority: full, productionRoles: roles, role: { permissions: [] } }) as unknown as AccessContext;

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
fixtures.workflow = {
  statuses: [
    status("ASSIGNED", 1, { isInitial: true }),
    status("PROCESSING", 2),
    status("DONE", 3, { countsDone: true }),
    status("WAITING_QC", 4),
    status("CHECKED", 5, { countsChecked: true }),
    status("COMPLETE", 6),
    status("DELIVERING", 7),
    status("FEEDBACK", 8),
    status("DELIVERED", 9, { isTerminal: true })
  ],
  transitions: []
} satisfies Workflow;

const userJson = (id: string) => ({ id, display_name: `User ${id.slice(0, 4)}`, email: null, avatar_url: null });
const taskRow = (overrides: Partial<TaskRow> = {}): TaskRow => ({
  id: taskId,
  number: 7,
  job_id: jobId,
  job_code: "JOB-1",
  job_leader_id: me,
  project_id: projectId,
  project_code: "P1",
  project_name: "Project",
  assignee_id: worker,
  assignee: userJson(worker),
  qc_id: checker,
  qc: userJson(checker),
  process_id: processId,
  process_name: "Retouch",
  process_is_qc: false,
  shift_id: shiftId,
  shift_name: "Chính thức",
  pay_mode: "POINTS",
  requires_ot_hours: false,
  qty_assigned: 10,
  qty_done: null,
  error_qty: null,
  ot_hours: null,
  assigned_at: new Date("2026-10-10T02:00:00Z"),
  deadline: new Date("2099-01-01T00:00:00Z"),
  done_at: null,
  checked_at: null,
  status_id: "ASSIGNED",
  status_code: "ASSIGNED",
  status_name: "ASSIGNED",
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
  created_at: new Date("2026-10-10T02:00:00Z"),
  updated_at: new Date("2026-10-10T02:00:00Z"),
  closed_at: null,
  deadline_cursor: "2099-01-01 00:00:00.000000+00",
  job_archived: false,
  job_open_feedback: false,
  split_reason: null,
  created_by: null,
  sub_seq: null,
  parent_number: null,
  subtasks: null,
  pending_qty_request: null,
  ...overrides
});

const requiredField = [{ key: "do_kho", label: "Độ khó", type: "SELECT", options: [{ value: "de" }, { value: "kho" }], required: true }];

/** The catalog / people reads of a task split by me (job leader). */
const splitQueries = (extra: (call: Call) => unknown[] | undefined = () => undefined) => (call: Call) => {
  const answer = extra(call);
  if (answer) {
    return answer;
  }
  if (call.text.includes("FROM production.jobs j JOIN production.projects p")) {
    return [{ id: jobId, leader_id: me, received_at: new Date("2026-10-01T00:00:00Z"), deadline: new Date("2099-01-01T00:00:00Z"), total_images: 100, total_images_manual: true, qc_buffer_hours: 2, archived_at: null }];
  }
  if (call.text.startsWith("SELECT om.user_id")) {
    return [
      { user_id: worker, roles: ["STAFF"], superadmin: false },
      { user_id: checker, roles: ["QC"], superadmin: false }
    ];
  }
  if (call.text.startsWith("SELECT id, active, is_qc, name FROM production.processes")) {
    return [{ id: processId, active: true, is_qc: false, name: "Retouch" }];
  }
  if (call.text.startsWith("SELECT id, active FROM production.shifts")) {
    return [{ id: shiftId, active: true }];
  }
  if (call.text.includes("FROM production.custom_fields")) {
    return requiredField;
  }
  if (call.text.includes("coalesce(sum(qty_assigned), 0)::int AS total")) {
    return [{ total: 0 }];
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
const line = (overrides: Record<string, unknown> = {}) => ({ assigneeId: worker, qcId: checker, processId, shiftId, qtyAssigned: 5, ...overrides });

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = () => [];
  clearProductionConfigCache();
});

describe("G3 — Chia task validates required TASK fields and tags per line, before anything is written", () => {
  it("a line without a required field → 400 CUSTOM_FIELDS_INVALID naming the line; no task inserted", async () => {
    db.state.handler = splitQueries();
    const result = await failure(createProductionTasks(contextWith(["LEADER"]), jobId, [line({ customValues: { do_kho: "de" } }), line()]));
    expect(result).toMatchObject({ code: "CUSTOM_FIELDS_INVALID", status: 400 });
    expect(result?.message).toContain("Task 2:");
    expect(result?.message).not.toContain("Task 1:");
    expect(callsLike(/^INSERT INTO production\.tasks/)).toHaveLength(0);
  });

  it("an unknown tag → 400 TAG_NOT_FOUND naming the line; no task inserted", async () => {
    db.state.handler = splitQueries((call) => (call.text.startsWith("SELECT id FROM production.tags") ? [{ id: tagA }] : undefined));
    const result = await failure(
      createProductionTasks(contextWith(["LEADER"]), jobId, [line({ customValues: { do_kho: "de" }, tagIds: [tagA] }), line({ customValues: { do_kho: "kho" }, tagIds: [tagB] })])
    );
    expect(result).toMatchObject({ code: "TAG_NOT_FOUND", status: 400 });
    expect(result?.message).toBe("Task 2: tag không tồn tại.");
    expect(callsLike(/^INSERT INTO production\.tasks/)).toHaveLength(0);
  });

  it("valid lines are inserted with their values and tags", async () => {
    db.state.handler = splitQueries((call) => (call.text.startsWith("SELECT id FROM production.tags") ? [{ id: tagA }] : undefined));
    await createProductionTasks(contextWith(["LEADER"]), jobId, [line({ customValues: { do_kho: "kho" }, tagIds: [tagA] })]);
    const insert = callsLike(/^INSERT INTO production\.tasks/)[0];
    expect(JSON.stringify(insert?.values)).toContain('"customValues":{"do_kho":"kho"}');
    expect(JSON.stringify(callsLike(/^INSERT INTO production\.entity_tags/)[0]?.values)).toContain(tagA);
  });

  it("PD-047: a NORMAL work line without QC is refused unless an importer replays history (historicQcOptional)", async () => {
    db.state.handler = splitQueries();
    const job = {
      id: jobId,
      leader_id: me,
      received_at: new Date("2026-10-01T00:00:00Z"),
      deadline: new Date("2099-01-01T00:00:00Z"),
      total_images: 0,
      total_images_manual: false,
      qc_buffer_hours: 2
    };
    const lines = [line({ customValues: { do_kho: "de" } }), line({ qcId: null, customValues: { do_kho: "de" } })];
    const normal = { kind: "NORMAL" as const, feedbackId: null, defaultParentId: null };
    const refused = await failure(insertTasks(db.sql as never, contextWith(["LEADER"]), fixtures.workflow as Workflow, job, lines, normal));
    expect(refused).toEqual({ code: "TASK_LINES_INVALID", status: 400, message: "Task 2: Chọn QC cho task." });
    expect(callsLike(/^INSERT INTO production\.tasks/)).toHaveLength(0);

    await insertTasks(db.sql as never, contextWith(["LEADER"]), fixtures.workflow as Workflow, job, lines, { ...normal, historicQcOptional: true });
    const rows = callsLike(/^INSERT INTO production\.tasks/)[0]!.values.find((value) => Array.isArray(value)) as Record<string, unknown>[];
    expect(rows.map((row) => row.qcId)).toEqual([checker, null]);
  });
});

describe("G3 — Giao lại: FB redo tasks inherit the source task's custom values and tags", () => {
  it("PD-045: Giao lại itself is retired — 409 FEEDBACK_RETIRED before anything is read", async () => {
    db.state.handler = splitQueries();
    const error = await reassignFeedback(contextWith(["LEADER"]), feedbackId, { tasks: [line()] }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "FEEDBACK_RETIRED", statusCode: 409 });
    expect(db.state.calls).toHaveLength(0);
  });

  it("a line without values passes the required-field check with the source task's values (insertTasks, FB kinds)", async () => {
    db.state.handler = splitQueries((call) => {
      if (call.text.includes("t.assigned_at, t.deadline, t.custom_values")) {
        return [{ id: taskId, assigned_at: new Date("2026-10-01T02:00:00Z"), deadline: new Date("2026-10-03T02:00:00Z"), custom_values: { do_kho: "kho", da_bo: "x" }, tag_ids: [tagA] }];
      }
      if (call.text.startsWith("SELECT id FROM production.tags")) {
        return [{ id: tagA }];
      }
      return undefined;
    });
    const job = {
      id: jobId,
      leader_id: me,
      received_at: new Date("2026-10-01T00:00:00Z"),
      deadline: new Date("2099-01-01T00:00:00Z"),
      total_images: 100,
      total_images_manual: true,
      qc_buffer_hours: 2
    };
    await insertTasks(db.sql as never, contextWith(["LEADER"]), fixtures.workflow as Workflow, job, [line()], {
      kind: "FB_WRONG",
      feedbackId,
      defaultParentId: taskId
    });
    const insert = callsLike(/^INSERT INTO production\.tasks/)[0];
    expect(JSON.stringify(insert?.values)).toContain('"customValues":{"do_kho":"kho"}');
    expect(JSON.stringify(insert?.values)).not.toContain("da_bo");
    expect(insert?.values).toContain("FB_WRONG");
    expect(JSON.stringify(callsLike(/^INSERT INTO production\.entity_tags/)[0]?.values)).toContain(tagA);
  });
});

describe("G11 — history: task tag changes and job edits", () => {
  it("changing a task's tags writes a FIELD log with the sorted tag ids", async () => {
    const task = taskRow({ tag_ids: [tagA] });
    db.state.handler = (call) => {
      if (call.text.startsWith("SELECT job_id FROM production.tasks")) {
        return [{ job_id: jobId }];
      }
      if (call.text.includes("AS job_leader_id") && call.text.includes("t.id = ANY(")) {
        return [task];
      }
      if (call.text.startsWith("SELECT id FROM production.tags")) {
        return [{ id: tagB }];
      }
      return undefined;
    };
    await updateProductionTask(contextWith(["LEADER"]), taskId, { tagIds: [tagB] });
    const log = callsLike(/^INSERT INTO production\.task_logs/)[0];
    const logs = JSON.stringify(log?.values);
    expect(logs).toContain('"action":"FIELD"');
    expect(logs).toContain(`"from":{"tagIds":["${tagA}"]}`);
    expect(logs).toContain(`"to":{"tagIds":["${tagB}"]}`);
  });

  it("required TASK fields are checked when values are edited (like jobs and clients)", async () => {
    const task = taskRow();
    db.state.handler = (call) => {
      if (call.text.startsWith("SELECT job_id FROM production.tasks")) {
        return [{ job_id: jobId }];
      }
      if (call.text.includes("AS job_leader_id") && call.text.includes("t.id = ANY(")) {
        return [task];
      }
      if (call.text.includes("FROM production.custom_fields")) {
        return [...requiredField, { key: "ghi_chu", label: "Ghi chú", type: "TEXT", options: [], required: false }];
      }
      return undefined;
    };
    expect(await failure(updateProductionTask(contextWith(["LEADER"]), taskId, { customValues: { ghi_chu: "x" } }))).toMatchObject({ code: "CUSTOM_FIELDS_INVALID" });
    expect(callsLike(/^UPDATE production\.tasks/)).toHaveLength(0);
  });

  it("jobEditChanges keeps only the changed fields", () => {
    const before = {
      code: "J-1",
      name: null,
      project_id: projectId,
      leader_id: me,
      deadline: new Date("2026-10-20T10:00:00Z"),
      received_at: new Date("2026-10-19T00:00:00Z"),
      total_images: 100,
      total_images_manual: true,
      drive_link: null,
      custom_values: { ma_don_hang: "PO-1" },
      archived_at: null
    };
    expect(jobEditChanges(before, { ...before }, null)).toBeNull();
    expect(
      jobEditChanges(before, { ...before, total_images: 120, deadline: new Date("2026-10-21T10:00:00Z"), custom_values: { ma_don_hang: "PO-2" } }, { before: [tagA], after: [tagA] })
    ).toEqual({
      from: { totalImages: 100, deadline: "2026-10-20T10:00:00.000Z", customValues: { ma_don_hang: "PO-1" } },
      to: { totalImages: 120, deadline: "2026-10-21T10:00:00.000Z", customValues: { ma_don_hang: "PO-2" } }
    });
    expect(jobEditChanges(before, { ...before, archived_at: new Date() }, { before: [tagA], after: [tagB, tagA] })).toEqual({
      from: { tagIds: [tagA], archived: false },
      to: { tagIds: [tagB, tagA].sort(), archived: true }
    });
  });

  it("updateJob writes one job-level history row (task_id NULL, action JOB) with the changes", async () => {
    const before = {
      code: "J-1",
      name: null,
      project_id: projectId,
      leader_id: me,
      deadline: new Date("2026-10-20T10:00:00Z"),
      received_at: new Date("2026-10-19T00:00:00Z"),
      total_images: 100,
      total_images_manual: true,
      drive_link: null,
      custom_values: {},
      archived_at: null
    };
    db.state.handler = (call) => {
      if (call.text.includes("FROM production.jobs WHERE organization_id = $ AND id = $ AND deleted_at IS NULL FOR UPDATE")) {
        return [before];
      }
      if (call.text.startsWith("SELECT code, name, project_id, leader_id")) {
        return [{ ...before, total_images: 150 }];
      }
      return undefined;
    };
    // The final read of the job detail finds nothing in this fake database (404): the write is what matters.
    await failure(updateJob(contextWith(["ACCOUNT"]), jobId, { totalImages: 150 }));
    const log = callsLike(/^INSERT INTO production\.task_logs/)[0];
    expect(log?.text).toContain("VALUES ($, NULL, $, $, 'JOB', $, $)");
    expect(log?.values).toEqual([org, jobId, me, { totalImages: 100 }, { totalImages: 150 }]);
  });
});

describe("G15 — a new KPI close day applies from the next period", () => {
  const next = shiftPeriod(kpiPeriodOfDay(businessDay(new Date()), 25), 1);

  it("writes the version for the next period and drops later ones; the current period keeps its days", async () => {
    db.state.handler = (call) => (call.text.includes("FROM production.kpi_close_days") ? [{ period: "2000-01", close_day: 25 }] : undefined);
    await updateSettings(contextWith(["ADMIN"]), { kpiCloseDay: 20 });
    const remove = callsLike(/^DELETE FROM production\.kpi_close_days/)[0];
    expect(remove?.values).toEqual([org, `${next}-01`]);
    const insert = callsLike(/^INSERT INTO production\.kpi_close_days/)[0];
    expect(insert?.values).toEqual([org, `${next}-01`, 20, me]);
    expect(JSON.stringify(callsLike(/^INSERT INTO production\.settings/)[0]?.values)).toContain("kpi_close_day");
  });

  it("re-sending the day already in force (settings form save) changes no version", async () => {
    db.state.handler = (call) => (call.text.includes("FROM production.kpi_close_days") ? [{ period: "2000-01", close_day: 25 }] : undefined);
    await updateSettings(contextWith(["ADMIN"]), { kpiCloseDay: 25 });
    expect(callsLike(/^DELETE FROM production\.kpi_close_days/)).toHaveLength(0);
    expect(callsLike(/^INSERT INTO production\.kpi_close_days/)).toHaveLength(0);
    db.state.calls = [];
    db.state.handler = (call) =>
      call.text.includes("FROM production.kpi_close_days")
        ? [
            { period: "2000-01", close_day: 25 },
            { period: next, close_day: 20 }
          ]
        : undefined;
    await updateSettings(contextWith(["ADMIN"]), { kpiCloseDay: 20 });
    expect(callsLike(/kpi_close_days/).filter((call) => !call.text.startsWith("SELECT"))).toHaveLength(0);
  });

  it("changing back before the next period starts removes the scheduled version", async () => {
    db.state.handler = (call) =>
      call.text.includes("FROM production.kpi_close_days")
        ? [
            { period: "2000-01", close_day: 25 },
            { period: next, close_day: 20 }
          ]
        : undefined;
    await updateSettings(contextWith(["ADMIN"]), { kpiCloseDay: 25 });
    expect(callsLike(/^DELETE FROM production\.kpi_close_days/)[0]?.values).toEqual([org, `${next}-01`]);
    expect(callsLike(/^INSERT INTO production\.kpi_close_days/)).toHaveLength(0);
  });

  it("an organization without versions gets its baseline first", async () => {
    await updateSettings(contextWith(["ADMIN"]), { kpiCloseDay: 20 });
    const inserts = callsLike(/^INSERT INTO production\.kpi_close_days/);
    expect(inserts[0]?.text).toContain("DATE '2000-01-01'");
    expect(inserts[1]?.values).toEqual([org, `${next}-01`, 20, me]);
  });
});
