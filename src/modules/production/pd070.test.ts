import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultFeaturePermissions } from "../../contracts/production-catalog.js";
import { JobDetailSchema, JobPageSchema, JobQuerySchema, ProductionTaskSchema } from "../../contracts/production-jobs.js";
import type { AccessContext } from "../access/access-context.js";
import type * as JobsRepoModule from "./jobs.repo.js";
import type { JobRow, SubtaskJson, TaskRow } from "./jobs.repo.js";
import type { PointsLine } from "./task-points.js";
import type { Workflow } from "./workflow.js";

/**
 * PD-070 — "Điểm" in the job List view: each task / subtask row's points on an official shift (recorded from the score
 * ledger, else expected from "Bảng đơn giá" as scoring.ts would price it at Done), nothing on a Khoán shift, others'
 * points only with `view_others_scores`, and the job total (per-person view: the person's rows). Without a database: a
 * fake tagged-template `sql` records every statement and answers from a per-test handler (as jobs-people.test.ts).
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
  loadWorkflowModel: vi.fn(() => Promise.resolve({ statuses: [], transitions: [] } satisfies Workflow))
}));

const { listJobs, getJobDetail } = await import("./jobs.service.js");
const { linePoints, sumPoints } = await import("./task-points.js");
const { clearProductionConfigCache } = await import("./catalog-cache.js");

// Obviously fake ids and names (the repository is public).
const org = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const jobId = "66666666-6666-4666-8666-666666666666";
const jobB = "66666666-6666-4666-8666-666666666667";
const project = "88888888-8888-4888-8888-888888888888";
const retouch = "99999999-9999-4999-8999-000000000001";
const clipping = "99999999-9999-4999-8999-000000000002";
const unpriced = "99999999-9999-4999-8999-000000000003";
const checking = "99999999-9999-4999-8999-000000000004";
const officialShift = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const khoanShift = "bbbbbbbb-bbbb-4bbb-8bbb-000000000002";
const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;

const contextWith = (roles: string[], userId = me, superadmin = false) =>
  ({
    user: { id: userId },
    organization: { id: org },
    hasFullOrganizationAuthority: superadmin,
    productionRoles: roles,
    role: { permissions: [] }
  }) as unknown as AccessContext;

const userJson = (userId: string, name: string) => ({ id: userId, display_name: name, email: null, avatar_url: null });

const jobRow = (overrides: Partial<JobRow> = {}): JobRow => ({
  id: jobId,
  number: 1,
  code: "JOB-1",
  name: null,
  project_id: project,
  project_code: "P1",
  project_name: "Project",
  client_name: null,
  leader_id: null,
  leader: null,
  deadline: new Date("2099-01-01T00:00:00Z"),
  received_at: new Date("2026-10-01T00:00:00Z"),
  total_images: 40,
  total_images_manual: false,
  drive_link: null,
  channel_id: null,
  job_status_id: "77777777-7777-4777-8777-777777777777",
  job_status_name: "Mới nhận",
  job_status_color: "slate",
  job_status_closed: false,
  job_status_requires_all_checked: false,
  status_id: null,
  status_code: null,
  status_name: null,
  status_color: null,
  qty_assigned: 40,
  qty_done: 0,
  qty_checked: 0,
  task_count: 3,
  late_task_count: 0,
  unchecked_task_count: 0,
  tasks_without_qty: 0,
  open_feedback_count: 0,
  workers: null,
  qc_people: null,
  process_totals: null,
  person_share: null,
  custom_values: {},
  tag_ids: null,
  created_by: null,
  created_at: new Date("2026-10-01T01:00:00Z"),
  created_cursor: "2026-10-01T01:00:00.000000Z",
  received_cursor: "2026-10-01T01:00:00.000000Z",
  archived_at: null,
  ...overrides
});

type TaskInput = {
  n: number;
  assignee: string;
  process?: string;
  isQc?: boolean;
  khoan?: boolean;
  qty?: number | null;
  qtyDone?: number | null;
  parent?: number;
  subtasks?: SubtaskJson[];
};

const taskRow = (input: TaskInput): TaskRow => ({
  id: id(input.n),
  number: input.parent ?? input.n,
  job_id: jobId,
  job_code: "JOB-1",
  job_leader_id: null,
  project_id: project,
  project_code: "P1",
  project_name: "Project",
  assignee_id: input.assignee,
  assignee: userJson(input.assignee, "Worker"),
  qc_id: null,
  qc: null,
  process_id: input.process ?? retouch,
  process_name: "Retouch",
  process_is_qc: input.isQc ?? false,
  shift_id: input.khoan ? khoanShift : officialShift,
  shift_name: input.khoan ? "Ca khoán" : "Ca ngày",
  pay_mode: input.khoan ? "MONEY_IF_KPI" : "POINTS",
  requires_ot_hours: false,
  qty_assigned: input.qty === undefined ? 10 : input.qty,
  qty_done: input.qtyDone ?? null,
  error_qty: null,
  ot_hours: null,
  assigned_at: new Date("2026-10-10T02:00:00Z"),
  deadline: new Date("2099-01-01T00:00:00Z"),
  done_at: null,
  checked_at: null,
  status_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  status_code: "PROCESSING",
  status_name: "Đang làm",
  status_color: "blue",
  kind: "NORMAL",
  parent_task_id: input.parent ? id(input.parent) : null,
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
  deadline_cursor: "2099-01-01T00:00:00.000000Z",
  job_archived: false,
  job_open_feedback: false,
  split_reason: input.parent ? "Tách cắt nền" : null,
  created_by: null,
  sub_seq: input.parent ? 1 : null,
  parent_number: input.parent ?? null,
  subtasks: input.subtasks ?? null,
  pending_qty_request: null
});

const subtaskJson = (n: number, process: string, qty: number | null): SubtaskJson => ({
  id: id(n),
  number: n,
  sub_seq: 1,
  process_id: process,
  process_name: "Clipping",
  qty_assigned: qty,
  qty_done: null,
  reason: "Tách cắt nền",
  created_by: null,
  created_at: "2026-10-10T02:00:00.000Z"
});

const rule = (process: string, credit: string) => ({
  id: `dddddddd-dddd-4ddd-8ddd-${process.slice(-12)}`,
  project_id: project,
  process_id: process,
  credit_per_image: credit,
  money_per_image: "5000",
  effective_from: "2026-01-01",
  effective_to: null
});

/** Ledger rows as the points query groups them (task, role): POINTS credits, someone else recorded. */
const ledger = (n: number, role: "WORKER" | "QC", official: string | null, others = false) => ({ task_id: id(n), role, official, others });

const ledgerCall = () => db.state.calls.filter((call) => call.text.startsWith("SELECT task_id, role, (sum(credits) FILTER"));
const rulesCall = () => db.state.calls.filter((call) => call.text.includes("FROM production.credit_rules"));
const pointsTasksCall = () => db.state.calls.filter((call) => call.text.includes("t.job_id = ANY("));

/** STAFF without `view_others_scores` (the superadmin ticked it off in "Phân quyền Photo Retouch"). */
const settingsWithoutOthers = [{ key: "feature_permissions", value: { ...defaultFeaturePermissions, view_others_scores: ["ADMIN", "LEADER"] } }];

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = () => [];
  clearProductionConfigCache();
});

describe("linePoints / sumPoints (pure)", () => {
  const line = (overrides: Partial<PointsLine> = {}): PointsLine => ({
    id: id(1),
    assigneeId: me,
    projectId: project,
    processId: retouch,
    processIsQc: false,
    payMode: "POINTS",
    kind: "NORMAL",
    qtyAssigned: 10,
    qtyDone: null,
    ...overrides
  });
  const viewer = { userId: me, seesOthers: true };
  const priced = { id: "r", creditPerImage: 1.25, moneyPerImage: 5000 };

  it("recorded → the ledger's POINTS credits; not recorded → quantity × today's price (qtyDone first), expected", () => {
    expect(linePoints(line(), { officialCents: 1250, others: false }, priced, viewer)).toEqual({ credits: 12.5, expected: false, missing: null });
    expect(linePoints(line(), undefined, priced, viewer)).toEqual({ credits: 12.5, expected: true, missing: null });
    expect(linePoints(line({ qtyDone: 7 }), undefined, priced, viewer)).toEqual({ credits: 8.75, expected: true, missing: null });
    // Exact to the cent, as computeLineEntry (no float drift).
    expect(linePoints(line({ qtyAssigned: 3 }), undefined, { ...priced, creditPerImage: 0.1 }, viewer)?.credits).toBe(0.3);
  });

  it("no quantity → QTY, no price → RULE (credits null); FB sai earns 0 like at Done", () => {
    expect(linePoints(line({ qtyAssigned: null }), undefined, priced, viewer)).toEqual({ credits: null, expected: true, missing: "QTY" });
    expect(linePoints(line(), undefined, null, viewer)).toEqual({ credits: null, expected: true, missing: "RULE" });
    expect(linePoints(line({ kind: "FB_WRONG" }), undefined, priced, viewer)).toEqual({ credits: 0, expected: true, missing: null });
  });

  it("Khoán: nothing (never money nor points) — before Done by the shift, after by the ledger", () => {
    expect(linePoints(line({ payMode: "MONEY_IF_KPI" }), undefined, priced, viewer)).toBeNull();
    expect(linePoints(line(), { officialCents: null, others: false }, priced, viewer)).toBeNull();
  });

  it("someone else's row needs view_others_scores; an own row recorded for someone else stays hidden too", () => {
    const own = { userId: me, seesOthers: false };
    expect(linePoints(line({ assigneeId: other }), undefined, priced, own)).toBeNull();
    expect(linePoints(line(), undefined, priced, own)).toEqual({ credits: 12.5, expected: true, missing: null });
    expect(linePoints(line(), { officialCents: 500, others: true }, priced, own)).toBeNull();
  });

  it("sumPoints: recorded + expected, expected when any row is not recorded yet; null without any points", () => {
    expect(sumPoints([{ credits: 10.1, expected: false, missing: null }, { credits: 0.2, expected: false, missing: null }, null])).toEqual({
      credits: 10.3,
      expected: false
    });
    expect(sumPoints([{ credits: 4, expected: false, missing: null }, { credits: null, expected: true, missing: "QTY" }])).toEqual({
      credits: 4,
      expected: true
    });
    expect(sumPoints([null, { credits: null, expected: true, missing: "RULE" }])).toBeNull();
    expect(sumPoints([])).toBeNull();
  });
});

describe("job detail (the List view's expand source)", () => {
  // 1 mine, recorded (a legacy task-level QC credit of someone else on the same line is not its points)
  // 2 someone else's, expected (Retouch 1,50 × 8); 3 its subtask (Clipping 0,75 × 4), scored on its own
  // 4 mine on a Khoán shift; 5 someone else's, no price; 6 mine without a quantity; 7 my Checking line (role QC), recorded
  const rows = () => [
    taskRow({ n: 1, assignee: me }),
    taskRow({ n: 2, assignee: other, qty: 8, subtasks: [subtaskJson(3, clipping, 4)] }),
    taskRow({ n: 3, assignee: other, process: clipping, qty: 4, parent: 2 }),
    taskRow({ n: 4, assignee: me, khoan: true, qty: 5 }),
    taskRow({ n: 5, assignee: other, process: unpriced, qty: 6 }),
    taskRow({ n: 6, assignee: me, qty: null }),
    taskRow({ n: 7, assignee: me, process: checking, isQc: true, qty: 20, qtyDone: 20 })
  ];
  const handler = (call: Call) => {
    if (call.text.includes("people ON true")) return [jobRow()];
    if (call.text.includes("AS job_leader_id") && call.text.includes("t.job_id = $")) return rows();
    if (call.text.startsWith("SELECT task_id, role, (sum(credits) FILTER")) {
      return [ledger(1, "WORKER", "12.50"), ledger(1, "QC", "5.00", true), ledger(7, "QC", "2.00")];
    }
    if (call.text.includes("FROM production.credit_rules")) return [rule(retouch, "1.50"), rule(clipping, "0.75"), rule(checking, "0.10")];
    return undefined;
  };

  it("each row carries its points; the job total sums the official rows (recorded + expected)", async () => {
    db.state.handler = handler;
    const detail = JobDetailSchema.parse(await getJobDetail(contextWith(["LEADER"]), jobId, db.sql as never));
    const points = new Map(detail.tasks.map((task) => [task.code, task.points]));
    expect(points.get("1")).toEqual({ credits: 12.5, expected: false, missing: null });
    expect(points.get("2")).toEqual({ credits: 12, expected: true, missing: null });
    expect(points.get("2a")).toEqual({ credits: 3, expected: true, missing: null });
    expect(points.get("4")).toBeNull();
    expect(points.get("5")).toEqual({ credits: null, expected: true, missing: "RULE" });
    expect(points.get("6")).toEqual({ credits: null, expected: true, missing: "QTY" });
    expect(points.get("7")).toEqual({ credits: 2, expected: false, missing: null });
    // The subtask embedded in its line carries the same points.
    expect(detail.tasks.find((task) => task.code === "2")!.subtasks[0]!.points).toEqual({ credits: 3, expected: true, missing: null });
    expect(detail.pointsOfficial).toEqual({ credits: 29.5, expected: true });
    // Batched: one ledger and one rule statement for the whole job, today's business day.
    expect(ledgerCall()).toHaveLength(1);
    expect(rulesCall()).toHaveLength(1);
    expect(rulesCall()[0]!.values.some((value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))).toBe(true);
  });

  it("without view_others_scores: only the caller's rows (others' null, never looked up), the total over them", async () => {
    db.state.handler = (call) => (call.text.includes("FROM production.settings") ? settingsWithoutOthers : handler(call));
    const detail = JobDetailSchema.parse(await getJobDetail(contextWith(["STAFF"]), jobId, db.sql as never));
    const points = new Map(detail.tasks.map((task) => [task.code, task.points]));
    expect(points.get("1")).toEqual({ credits: 12.5, expected: false, missing: null });
    expect(points.get("2")).toBeNull();
    expect(points.get("2a")).toBeNull();
    expect(points.get("5")).toBeNull();
    expect(detail.tasks.find((task) => task.code === "2")!.subtasks[0]!.points).toBeNull();
    expect(detail.pointsOfficial).toEqual({ credits: 14.5, expected: true });
    expect(ledgerCall()[0]!.values.flat()).not.toContain(id(2));
  });

  it("the superadmin always sees everyone's points", async () => {
    db.state.handler = (call) => (call.text.includes("FROM production.settings") ? settingsWithoutOthers : handler(call));
    const detail = await getJobDetail(contextWith([], me, true), jobId, db.sql as never);
    expect(detail.tasks.find((task) => task.code === "2")!.points).toEqual({ credits: 12, expected: true, missing: null });
  });

  it("task DTOs validate with points null (Khoán) and set", async () => {
    db.state.handler = handler;
    const detail = await getJobDetail(contextWith(["LEADER"]), jobId, db.sql as never);
    for (const task of detail.tasks) {
      expect(ProductionTaskSchema.safeParse(task).success).toBe(true);
    }
  });
});

describe("job list (GET /production/jobs) — pointsOfficial per job, one batched query per page", () => {
  const pageRows = () => [jobRow(), jobRow({ id: jobB, number: 2, code: "JOB-2" })];
  const pointsRow = (n: number, job: string, assignee: string, options: { khoan?: boolean; qty?: number | null; process?: string } = {}) => ({
    id: id(n),
    job_id: job,
    assignee_id: assignee,
    project_id: project,
    process_id: options.process ?? retouch,
    process_is_qc: false,
    pay_mode: options.khoan ? "MONEY_IF_KPI" : "POINTS",
    kind: "NORMAL",
    qty_assigned: options.qty === undefined ? 10 : options.qty,
    qty_done: null
  });
  const handler = (call: Call) => {
    if (call.text.startsWith("WITH page AS MATERIALIZED")) return pageRows();
    if (call.text.includes("t.job_id = ANY(")) {
      const rows = [
        pointsRow(1, jobId, me),
        pointsRow(2, jobId, other, { qty: 4 }),
        pointsRow(3, jobId, other, { khoan: true }),
        pointsRow(4, jobB, me, { khoan: true })
      ];
      const assignee = call.text.includes("t.assignee_id = $") ? call.values[call.values.length - 1] : null;
      return assignee ? rows.filter((row) => row.assignee_id === assignee) : rows;
    }
    if (call.text.startsWith("SELECT task_id, role, (sum(credits) FILTER")) return [ledger(1, "WORKER", "11.00")];
    if (call.text.includes("FROM production.credit_rules")) return [rule(retouch, "1.25")];
    return undefined;
  };

  it("recorded + expected, Khoán left out (a Khoán-only job: null)", async () => {
    db.state.handler = handler;
    const page = JobPageSchema.parse(await listJobs(contextWith(["LEADER"]), JobQuerySchema.parse({ sort: "received" })));
    expect(page.items.map((job) => job.pointsOfficial)).toEqual([{ credits: 16, expected: true }, null]);
    expect(pointsTasksCall()).toHaveLength(1);
    expect(pointsTasksCall()[0]!.values).toContainEqual([jobId, jobB]);
    expect(pointsTasksCall()[0]!.text).not.toContain("t.assignee_id = $");
    expect(ledgerCall()).toHaveLength(1);
    expect(rulesCall()).toHaveLength(1);
  });

  it("per-person view: only that person's rows", async () => {
    db.state.handler = handler;
    const page = JobPageSchema.parse(await listJobs(contextWith(["LEADER"]), JobQuerySchema.parse({ personId: other })));
    expect(pointsTasksCall()[0]!.text).toContain("t.assignee_id = $");
    expect(pointsTasksCall()[0]!.values).toContain(other);
    expect(page.items.map((job) => job.pointsOfficial)).toEqual([{ credits: 5, expected: true }, null]);
  });

  it("without view_others_scores: own rows only; another person's view → null without reading anything", async () => {
    db.state.handler = (call) => (call.text.includes("FROM production.settings") ? settingsWithoutOthers : handler(call));
    const page = JobPageSchema.parse(await listJobs(contextWith(["STAFF"]), JobQuerySchema.parse({})));
    expect(pointsTasksCall()[0]!.values).toContain(me);
    expect(page.items.map((job) => job.pointsOfficial)).toEqual([{ credits: 11, expected: false }, null]);

    db.state.calls = [];
    const theirs = JobPageSchema.parse(await listJobs(contextWith(["STAFF"]), JobQuerySchema.parse({ personId: other })));
    expect(theirs.items.map((job) => job.pointsOfficial)).toEqual([null, null]);
    expect(pointsTasksCall()).toHaveLength(0);
    expect(ledgerCall()).toHaveLength(0);
  });

  it("an empty page reads nothing more", async () => {
    db.state.handler = (call) => (call.text.startsWith("WITH page AS MATERIALIZED") ? [] : undefined);
    const page = await listJobs(contextWith(["LEADER"]), JobQuerySchema.parse({}));
    expect(page.items).toEqual([]);
    expect(pointsTasksCall()).toHaveLength(0);
  });
});
