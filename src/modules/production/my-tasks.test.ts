import { beforeEach, describe, expect, it, vi } from "vitest";

import { MyProductionTasksQuerySchema } from "../../contracts/production-jobs.js";
import { encodeCursor } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import type * as JobsRepoModule from "./jobs.repo.js";
import type { TaskRow } from "./jobs.repo.js";
import type { Workflow, WorkflowStatus } from "./workflow.js";

/**
 * PD-068 — "Việc của tôi" (GET /production/tasks/mine): finished lines after the open ones with a grouped keyset cursor,
 * the date range (Ngày nhận / Ngày giao, organization timezone) and the search, without a database: a fake
 * tagged-template `sql` records every statement (fragments inlined like postgres.js) and answers from a handler.
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
  const fake = Object.assign(sql, { json: (value: unknown) => value, begin: <T>(fn: (tx: unknown) => Promise<T>) => fn(fake) });
  return { state, sql: fake };
});
const fixtures = vi.hoisted((): { workflow: Workflow } => ({ workflow: { statuses: [], transitions: [] } }));

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
vi.mock("./jobs.repo.js", async (importOriginal) => ({
  ...(await importOriginal<typeof JobsRepoModule>()),
  loadWorkflowModel: vi.fn(() => Promise.resolve(fixtures.workflow))
}));

const { listMyProductionTasks } = await import("./tasks.service.js");
const { encodeTimeCursor } = await import("./cursor.js");
const { clearProductionConfigCache } = await import("./catalog-cache.js");

// Obviously fake ids and names (the repository is public).
const org = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;

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
    status("PROCESSING", 3),
    status("DONE", 4, { countsDone: true }),
    status("WAITING_QC", 5),
    status("CHECKED", 7, { countsChecked: true })
  ],
  transitions: []
} satisfies Workflow;

const contextWith = () =>
  ({ user: { id: me }, organization: { id: org }, hasFullOrganizationAuthority: false, productionRoles: ["STAFF"], role: { permissions: [] } }) as unknown as AccessContext;

const userJson = { id: me, display_name: "Người Thử", email: null, avatar_url: null };
const row = (n: number, overrides: Partial<TaskRow> = {}): TaskRow => ({
  id: id(n),
  number: 1280 + n,
  job_id: "66666666-6666-4666-8666-666666666666",
  job_code: "VD JOB-1",
  job_leader_id: null,
  project_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  project_code: "P1",
  project_name: "Dự án",
  assignee_id: me,
  assignee: userJson,
  qc_id: null,
  qc: null,
  process_id: "77777777-7777-4777-8777-777777777777",
  process_name: "Retouch",
  process_is_qc: false,
  shift_id: "88888888-8888-4888-8888-888888888888",
  shift_name: "Chính thức",
  pay_mode: "POINTS",
  requires_ot_hours: false,
  qty_assigned: 5,
  qty_done: null,
  error_qty: null,
  ot_hours: null,
  assigned_at: new Date("2026-10-14T00:00:00Z"),
  deadline: new Date("2026-10-20T16:59:00Z"),
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
  deadline_cursor: `2026-10-20T16:59:00.00000${n}Z`,
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
const finishedRow = (n: number, overrides: Partial<TaskRow> = {}) =>
  row(n, { status_id: "CHECKED", status_code: "CHECKED", done_at: new Date("2026-10-15T00:00:00Z"), checked_at: new Date("2026-10-16T00:00:00Z"), ...overrides });

const listCall = () => db.state.calls.find((call) => call.text.includes("AS job_leader_id"))!;
const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return { code: (error as { code?: string }).code, status: (error as { statusCode?: number }).statusCode };
  }
  return null;
};
const query = (input: Record<string, unknown>) => MyProductionTasksQuerySchema.parse(input);
const finishedSql = '(t.status_id = ANY($::uuid[]) OR ("pr".is_qc AND t.done_at IS NOT NULL AND t.status_id = ANY($::uuid[])))';

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = () => [];
  clearProductionConfigCache();
});

describe("ordering with finished lines (PD-068)", () => {
  it("without includeFinished: open lines only, soonest Ngày giao first, the plain cursor (unchanged)", async () => {
    db.state.handler = (call) => (call.text.includes("AS job_leader_id") ? [row(1), row(2), row(3)] : undefined);
    const page = await listMyProductionTasks(contextWith(), query({ limit: "2" }));
    expect(listCall().text).toContain(`AND NOT ${finishedSql}`);
    expect(listCall().text).toContain("ORDER BY t.deadline, t.id LIMIT $");
    expect(page.pageInfo.nextCursor).toBe(encodeTimeCursor(row(2).deadline_cursor, id(2)));

    db.state.calls = [];
    await listMyProductionTasks(contextWith(), query({ cursor: page.pageInfo.nextCursor }));
    expect(listCall().text).toContain("AND (t.deadline, t.id) > (($::text)::timestamptz, $::uuid)");
  });

  it("with includeFinished: open lines first (Ngày giao ascending), then finished ones (latest first)", async () => {
    await listMyProductionTasks(contextWith(), query({ includeFinished: "true" }));
    const text = listCall().text;
    expect(text).not.toContain(`AND NOT ${finishedSql}`);
    expect(text).toContain(
      `ORDER BY ${finishedSql} , CASE WHEN ${finishedSql} THEN NULL ELSE t.deadline END ASC, CASE WHEN ${finishedSql} THEN t.deadline END DESC, ` +
        `CASE WHEN ${finishedSql} THEN NULL ELSE t.id END ASC, CASE WHEN ${finishedSql} THEN t.id END DESC LIMIT $`
    );
  });

  it("the cursor carries the group: an open page continues after the open line and then every finished one", async () => {
    db.state.handler = (call) => (call.text.includes("AS job_leader_id") ? [row(1), row(2), finishedRow(3)] : undefined);
    const first = await listMyProductionTasks(contextWith(), query({ includeFinished: "true", limit: "2" }));
    expect(first.items.map((item) => item.code)).toEqual(["1281", "1282"]);
    expect(first.pageInfo.nextCursor).toBe(encodeCursor(["open", row(2).deadline_cursor, id(2)]));

    db.state.calls = [];
    await listMyProductionTasks(contextWith(), query({ includeFinished: "true", cursor: first.pageInfo.nextCursor }));
    const next = listCall();
    expect(next.text).toContain(`AND ( ${finishedSql} OR (t.deadline, t.id) > (($::text)::timestamptz, $::uuid))`);
    expect(next.values).toEqual(expect.arrayContaining([row(2).deadline_cursor, id(2)]));
  });

  it("a finished page continues among the finished lines only, latest Ngày giao first", async () => {
    db.state.handler = (call) => (call.text.includes("AS job_leader_id") ? [row(1), finishedRow(2), finishedRow(3)] : undefined);
    const first = await listMyProductionTasks(contextWith(), query({ includeFinished: "true", limit: "2" }));
    expect(first.pageInfo.nextCursor).toBe(encodeCursor(["finished", row(2).deadline_cursor, id(2)]));

    db.state.calls = [];
    await listMyProductionTasks(contextWith(), query({ includeFinished: "true", cursor: first.pageInfo.nextCursor }));
    expect(listCall().text).toContain(`AND ${finishedSql} AND (t.deadline, t.id) < (($::text)::timestamptz, $::uuid)`);
  });

  it("a Checking line counts as finished once Done (same rule as the SQL)", async () => {
    const checking = row(2, { process_is_qc: true, status_id: "DONE", status_code: "DONE", done_at: new Date("2026-10-15T00:00:00Z") });
    db.state.handler = (call) => (call.text.includes("AS job_leader_id") ? [row(1), checking, finishedRow(3)] : undefined);
    const first = await listMyProductionTasks(contextWith(), query({ includeFinished: "true", limit: "2" }));
    expect(first.pageInfo.nextCursor).toBe(encodeCursor(["finished", checking.deadline_cursor, id(2)]));
  });

  it("an older cursor (or one of the other order) is a 400 INVALID_CURSOR", async () => {
    const plain = encodeTimeCursor("2026-10-20T16:59:00.000001Z", id(1));
    expect(await failure(listMyProductionTasks(contextWith(), query({ includeFinished: "true", cursor: plain })))).toEqual({
      code: "INVALID_CURSOR",
      status: 400
    });
    const grouped = encodeCursor(["open", "2026-10-20T16:59:00.000001Z", id(1)]);
    expect(await failure(listMyProductionTasks(contextWith(), query({ cursor: grouped })))).toEqual({ code: "INVALID_CURSOR", status: 400 });
    const bad = encodeCursor(["later", "2026-10-20T16:59:00.000001Z", id(1)]);
    expect(await failure(listMyProductionTasks(contextWith(), query({ includeFinished: "true", cursor: bad })))).toEqual({
      code: "INVALID_CURSOR",
      status: 400
    });
  });
});

describe("date range (PD-068)", () => {
  it("Ngày nhận by default: [from 00:00, to + 1 day 00:00) in the organization timezone", async () => {
    db.state.handler = (call) => (call.text.includes("FROM production.settings") ? [{ key: "timezone", value: "Asia/Ho_Chi_Minh" }] : undefined);
    await listMyProductionTasks(contextWith(), query({ from: "2026-10-01", to: "2026-10-31" }));
    const call = listCall();
    expect(call.text).toContain("AND t.assigned_at >= (($::date)::timestamp AT TIME ZONE $::text)");
    expect(call.text).toContain("AND t.assigned_at < ((($::date) + 1)::timestamp AT TIME ZONE $::text)");
    const fromIndex = call.values.indexOf("2026-10-01");
    expect(call.values[fromIndex + 1]).toBe("Asia/Ho_Chi_Minh");
    const toIndex = call.values.indexOf("2026-10-31");
    expect(call.values[toIndex + 1]).toBe("Asia/Ho_Chi_Minh");
    expect(call.text).not.toContain("t.deadline >= ((");
  });

  it("Ngày giao on request; one bound alone works; the organization's own timezone is used", async () => {
    db.state.handler = (call) => (call.text.includes("FROM production.settings") ? [{ key: "timezone", value: "Asia/Bangkok" }] : undefined);
    await listMyProductionTasks(contextWith(), query({ dateBy: "deadline", to: "2026-10-19" }));
    const call = listCall();
    expect(call.text).toContain("AND t.deadline < ((($::date) + 1)::timestamp AT TIME ZONE $::text)");
    expect(call.text).not.toContain("t.deadline >= ((");
    expect(call.text).not.toContain("t.assigned_at >=");
    expect(call.values).toContain("Asia/Bangkok");
  });

  it("validates the days: real calendar days, “Từ ngày” not after “Đến ngày”, a known basis", () => {
    expect(MyProductionTasksQuerySchema.safeParse({ from: "2026-10-20", to: "2026-10-19" }).success).toBe(false);
    expect(MyProductionTasksQuerySchema.safeParse({ from: "2026-10-19", to: "2026-10-19" }).success).toBe(true);
    expect(MyProductionTasksQuerySchema.safeParse({ from: "2026-02-31" }).success).toBe(false);
    expect(MyProductionTasksQuerySchema.safeParse({ to: "19/10/2026" }).success).toBe(false);
    expect(MyProductionTasksQuerySchema.safeParse({ dateBy: "done" }).success).toBe(false);
    expect(query({}).dateBy).toBe("received");
  });
});

describe("search (PD-068)", () => {
  const searchOf = async (q: string) => {
    db.state.calls = [];
    await listMyProductionTasks(contextWith(), query({ q }));
    return listCall();
  };
  const text =
    "public.immutable_unaccent(lower(concat_ws(' ', j.code, j.name, p.code, p.name, pr.name, t.note))) LIKE public.immutable_unaccent($)";

  it("a code (1286, #1286, a subtask's 1286a) finds the line by its number, and the text too", async () => {
    for (const [q, like] of [
      ["1286", "%1286%"],
      ["#1286", "%#1286%"],
      ["1286a", "%1286a%"]
    ] as const) {
      const call = await searchOf(q);
      expect(call.text).toContain(`AND ( t.number = $ OR ${text} )`);
      expect(call.values).toContain(1286);
      expect(call.values).toContain(like);
    }
  });

  it("other words search job, project, process and note, accents and case ignored (the job list's helper)", async () => {
    const call = await searchOf("  Cắt NỀN 50%_x ");
    expect(call.text).toContain(`AND ( ${text} )`);
    expect(call.text).not.toContain("t.number = $");
    expect(call.values).toContain("%cắt nền 50\\%\\_x%");
  });

  it("a blank search is no search; the QC role and the tag filters still apply", async () => {
    expect(query({ q: "   " }).q).toBeUndefined();
    db.state.calls = [];
    await listMyProductionTasks(contextWith(), query({ q: " ", role: "qc" }));
    expect(listCall().text).not.toContain("immutable_unaccent");
    expect(listCall().text).toContain("AND t.qc_id = $");
  });
});
