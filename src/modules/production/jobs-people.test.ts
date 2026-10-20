import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultJobPermissions } from "../../contracts/production-catalog.js";
import { JobPageSchema, JobQuerySchema } from "../../contracts/production-jobs.js";
import type { AccessContext } from "../access/access-context.js";
import type * as JobsRepoModule from "./jobs.repo.js";
import type { JobRow, TaskRow } from "./jobs.repo.js";
import type { Workflow } from "./workflow.js";

/**
 * Job list "Người làm" (people summary per job) and the "Mọi nhân viên" filter, without a database: a fake
 * tagged-template `sql` records every statement and answers from a per-test handler (as security.test.ts).
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

const { toJobPeople } = await import("./jobs.repo.js");
const { listJobs, getJobDetail } = await import("./jobs.service.js");
const { personCells, personColumns, workersCell } = await import("./exports.service.js");
const { encodeTimeCursor } = await import("./cursor.js");
const { clearProductionConfigCache } = await import("./catalog-cache.js");
const { redactColleagueEmails } = await import("./http.js");

// Obviously fake ids and names (the repository is public).
const org = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const third = "44444444-4444-4444-8444-444444444444";
const jobId = "66666666-6666-4666-8666-666666666666";

const contextWith = (roles: string[], userId = me) =>
  ({
    user: { id: userId },
    organization: { id: org },
    hasFullOrganizationAuthority: false,
    productionRoles: roles,
    role: { permissions: [] }
  }) as unknown as AccessContext;

const userJson = (id: string, name: string) => ({ id, display_name: name, email: `${id.slice(0, 4)}@example.test`, avatar_url: null });

const jobRow = (overrides: Partial<JobRow> = {}): JobRow => ({
  id: jobId,
  number: 1,
  code: "JOB-1",
  name: null,
  project_id: "88888888-8888-4888-8888-888888888888",
  project_code: "P1",
  project_name: "Project",
  client_name: null,
  leader_id: third,
  leader: userJson(third, "Leader"),
  deadline: new Date("2099-01-01T00:00:00Z"),
  received_at: new Date("2026-10-01T00:00:00Z"),
  total_images: 40,
  total_images_manual: true,
  drive_link: null,
  channel_id: null,
  job_status_id: "99999999-9999-4999-8999-999999999999",
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
  workers: [
    { user: userJson(other, "Worker B"), qty: 25, task_count: 2 },
    { user: userJson(me, "Worker A"), qty: 15, task_count: 1 }
  ],
  qc_people: [userJson(third, "Checker C")],
  process_totals: [
    { id: "00000000-0000-4000-8000-000000000901", name: "Retouch mẫu", qty: 7 },
    { id: "00000000-0000-4000-8000-000000000902", name: "Cắt nền mẫu", qty: 3 }
  ],
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

const taskRow = (number: number, assignee: string, qty: number, qc: string | null): TaskRow => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(number).padStart(12, "0")}`,
  number,
  job_id: jobId,
  job_code: "JOB-1",
  job_leader_id: third,
  project_id: "88888888-8888-4888-8888-888888888888",
  project_code: "P1",
  project_name: "Project",
  assignee_id: assignee,
  assignee: userJson(assignee, "Worker"),
  qc_id: qc,
  qc: qc ? userJson(qc, "Checker") : null,
  process_id: "99999999-9999-4999-8999-999999999999",
  process_name: "Retouch",
  process_is_qc: false,
  shift_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  shift_name: "Ca ngày",
  pay_mode: "POINTS",
  requires_ot_hours: false,
  qty_assigned: qty,
  qty_done: null,
  error_qty: null,
  ot_hours: null,
  assigned_at: new Date("2026-10-10T02:00:00Z"),
  deadline: new Date("2099-01-01T00:00:00Z"),
  done_at: null,
  checked_at: null,
  status_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  status_code: "PROCESSING",
  status_name: "Processing",
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
  deadline_cursor: "2099-01-01T00:00:00.000000Z",
  job_archived: false,
  job_open_feedback: false,
  split_reason: null,
  created_by: null,
  sub_seq: null,
  parent_number: null,
  subtasks: null,
  pending_qty_request: null
});

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return { code: (error as { code?: string }).code, status: (error as { statusCode?: number }).statusCode };
  }
  return null;
};

const listQuery = () => db.state.calls.find((call) => call.text.startsWith("WITH page AS MATERIALIZED"))!;
/** Calls other than the (cached) production settings reads. */
const dataCalls = () => db.state.calls.filter((call) => !call.text.includes("production.settings") && !call.text.includes("production.kpi_close_days"));

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = () => [];
  clearProductionConfigCache();
});

describe("job people summary (Người làm)", () => {
  it("maps workers (quantity order kept) and QC people; empty lists before the job is split", () => {
    const people = toJobPeople(jobRow());
    expect(people.workers.map((worker) => [worker.user.displayName, worker.qty, worker.taskCount])).toEqual([
      ["Worker B", 25, 2],
      ["Worker A", 15, 1]
    ]);
    expect(people.qc.map((user) => user.displayName)).toEqual(["Checker C"]);
    expect(toJobPeople({ workers: null, qc_people: null })).toEqual({ workers: [], qc: [] });
  });

  it("is aggregated in the page query itself (one statement, no per-job query)", async () => {
    db.state.handler = (call) => (call.text.startsWith("WITH page AS MATERIALIZED") ? [jobRow()] : undefined);
    const page = JobPageSchema.parse(await listJobs(contextWith(["LEADER"]), JobQuerySchema.parse({})));
    expect(page.items[0]!.people.workers.map((worker) => worker.qty)).toEqual([25, 15]);
    // PD-070: besides it, one batched statement reads the page's task rows for the "Điểm" column (never one per job).
    const points = dataCalls().filter((call) => call.text.includes("t.job_id = ANY("));
    expect(points).toHaveLength(1);
    expect(dataCalls()).toHaveLength(2);
    expect(listQuery().text).toContain("people ON true");
    expect(listQuery().text).toContain("ORDER BY w.qty DESC");
  });

  it("carries Tổng tấm per process (PD-048): work tasks incl. subtasks, Checking left out, largest first", async () => {
    db.state.handler = (call) => (call.text.startsWith("WITH page AS MATERIALIZED") ? [jobRow()] : undefined);
    const page = JobPageSchema.parse(await listJobs(contextWith(["LEADER"]), JobQuerySchema.parse({})));
    expect(page.items[0]!.processTotals.map((item) => [item.process.name, item.qty])).toEqual([
      ["Retouch mẫu", 7],
      ["Cắt nền mẫu", 3]
    ]);
    expect(listQuery().text).toContain("AS process_totals");
    expect(listQuery().text).toContain("t.kind = 'NORMAL' AND NOT pr.is_qc");
  });

  it("view scope (PD-036): own lists only jobs with a live line of mine, none is refused; workers are never hidden", async () => {
    // Default matrix: QC views "own".
    await listJobs(contextWith(["QC"]), JobQuerySchema.parse({}));
    expect(listQuery().text).toContain("AND t.deleted_at IS NULL AND (t.assignee_id = $ OR t.qc_id = $)");
    expect(listQuery().text).toContain("people ON true");
    // Leader / Account view "all": no ownership filter; STAFF too since PD-047.
    db.state.calls = [];
    await listJobs(contextWith(["LEADER"]), JobQuerySchema.parse({}));
    expect(listQuery().text).not.toContain("t.qc_id = $)");
    db.state.calls = [];
    await listJobs(contextWith(["STAFF"]), JobQuerySchema.parse({}));
    expect(listQuery().text).not.toContain("t.qc_id = $)");
    // A matrix where STAFF may not view jobs.
    clearProductionConfigCache();
    db.state.calls = [];
    db.state.handler = (call) =>
      call.text.includes("FROM production.settings")
        ? [{ key: "job_permissions", value: { ...defaultJobPermissions, STAFF: { view: "none", create: "own", update: "own", delete: "own" } } }]
        : undefined;
    expect(await failure(listJobs(contextWith(["STAFF"]), JobQuerySchema.parse({})))).toEqual({ code: "FORBIDDEN", status: 403 });
    expect(db.state.calls.some((call) => call.text.startsWith("WITH page AS MATERIALIZED"))).toBe(false);
  });

  it("job detail: a STAFF working on the job sees the same people as its task list (every task, PD-014)", async () => {
    const tasks = [taskRow(1, me, 15, third), taskRow(2, other, 20, third), taskRow(3, other, 5, null)];
    db.state.handler = (call) => {
      if (call.text.includes("people ON true")) return [jobRow()];
      if (call.text.includes("AS job_leader_id") && call.text.includes("t.job_id = $")) return tasks;
      return undefined;
    };
    const detail = await getJobDetail(contextWith(["STAFF"]), jobId, db.sql as never);
    expect(detail.tasks.map((task) => task.assignee.id)).toEqual([me, other, other]);
    // Not narrowed to the caller's own tasks: the detail shows them every task of the job.
    expect(detail.people).toEqual(toJobPeople(jobRow()));
  });

  it("job detail: someone outside the job gets 404 with an own view (QC by default), people included", async () => {
    db.state.handler = (call) => {
      if (call.text.includes("people ON true")) return [jobRow()];
      if (call.text.includes("AS job_leader_id") && call.text.includes("t.job_id = $")) return [taskRow(1, other, 10, third)];
      return undefined;
    };
    expect(await failure(getJobDetail(contextWith(["QC"]), jobId, db.sql as never))).toEqual({ code: "JOB_NOT_FOUND", status: 404 });
    // PD-047: STAFF views every job by default.
    expect((await getJobDetail(contextWith(["STAFF"]), jobId, db.sql as never)).tasks.map((task) => task.assignee.id)).toEqual([other]);
  });

  it("e-mails of colleagues in the summary are hidden from STAFF / QC callers (SEC2-09)", () => {
    const redacted = redactColleagueEmails({ people: toJobPeople(jobRow()) }, me);
    expect(redacted.people.workers.map((worker) => worker.user.email)).toEqual([null, "2222@example.test"]);
    expect(redacted.people.qc[0]!.email).toBeNull();
  });
});

describe("Mọi nhân viên — per-person view (personId, PD-034)", () => {
  const totalsQuery = () => db.state.calls.find((call) => call.text.startsWith("SELECT count(DISTINCT t.job_id)"));
  const share = { processes: ["Clipping", "Retouch"], task_count: 2, qty_assigned: 30, qty_done: 30, qty_checked: 10 };

  it("keeps only jobs where the person is an ASSIGNEE (QC-only involvement does not match)", async () => {
    await listJobs(contextWith(["ACCOUNT"]), JobQuerySchema.parse({ personId: other }));
    const query = listQuery();
    expect(query.text).toContain(
      "AND EXISTS ( SELECT 1 FROM production.tasks t WHERE t.organization_id = j.organization_id AND t.job_id = j.id AND t.assignee_id = $ AND t.deleted_at IS NULL)"
    );
    expect(query.text).not.toContain("t.qc_id = $");
  });

  it("rows carry the person's share of the job (their own tasks: processes, assigned / done / checked)", async () => {
    db.state.handler = (call) => {
      if (call.text.startsWith("WITH page AS MATERIALIZED")) return [jobRow({ person_share: share })];
      if (call.text.startsWith("SELECT count(DISTINCT t.job_id)")) return [{ job_count: 63, task_count: 90, qty_assigned: 2345, qty_done: 2345, qty_checked: 1800 }];
      return undefined;
    };
    const page = JobPageSchema.parse(await listJobs(contextWith(["LEADER"]), JobQuerySchema.parse({ personId: other })));
    expect(page.items[0]!.personShare).toEqual({ processes: ["Clipping", "Retouch"], taskCount: 2, qtyAssigned: 30, qtyDone: 30, qtyChecked: 10 });
    expect(listQuery().text).toContain("mine ON true");
    expect(listQuery().text).toContain("WHERE t.organization_id = j.organization_id AND t.job_id = j.id AND t.assignee_id = $ AND t.deleted_at IS NULL ) mine ON true");
    // Totals over every matching job (not only the page).
    expect(page.personTotals).toEqual({ personId: other, jobCount: 63, taskCount: 90, qtyAssigned: 2345, qtyDone: 2345, qtyChecked: 1800 });
  });

  it("the totals respect the other filters and reach the tasks by assignee (no LIMIT, no cursor)", async () => {
    await listJobs(contextWith(["ACCOUNT"]), JobQuerySchema.parse({ personId: other, leaderId: third, late: "true", q: "abc" }));
    const totals = totalsQuery()!;
    expect(totals.text).toContain("WHERE t.organization_id = $ AND t.assignee_id = $ AND t.deleted_at IS NULL AND j.organization_id = $ AND j.deleted_at IS NULL");
    expect(totals.text).toContain("AND j.leader_id = $");
    expect(totals.text).toContain("t.is_late AND t.done_at IS NULL");
    expect(totals.text).toContain("LIKE public.immutable_unaccent($)");
    expect(totals.text).not.toContain("LIMIT");
    expect(totals.values).toContain(other);
    expect(totals.values).toContain(third);
  });

  it("later pages and lists without a person skip the totals (personTotals null)", async () => {
    const cursor = encodeTimeCursor("2026-10-01T01:00:00.000000Z", jobId);
    const next = await listJobs(contextWith(["ACCOUNT"]), JobQuerySchema.parse({ personId: other, cursor }));
    expect(next.personTotals).toBeNull();
    expect(totalsQuery()).toBeUndefined();
    db.state.calls = [];
    const plain = await listJobs(contextWith(["ACCOUNT"]), JobQuerySchema.parse({}));
    expect(plain.personTotals).toBeNull();
    expect(totalsQuery()).toBeUndefined();
    expect(listQuery().text).not.toContain("mine ON true");
    expect(listQuery().text).toContain("NULL::json AS person_share");
    expect(plain.items).toEqual([]);
  });

  it("refuses a malformed id", () => {
    expect(JobQuerySchema.safeParse({ personId: "not-a-uuid" }).success).toBe(false);
  });

  it("the job detail never carries a person share", async () => {
    db.state.handler = (call) => {
      if (call.text.includes("people ON true")) return [jobRow()];
      if (call.text.includes("AS job_leader_id") && call.text.includes("t.job_id = $")) return [taskRow(1, me, 10, null)];
      return undefined;
    };
    const detail = await getJobDetail(contextWith(["LEADER"]), jobId, db.sql as never);
    expect(detail.personShare).toBeNull();
    expect(db.state.calls.some((call) => call.text.includes("mine ON true"))).toBe(false);
  });
});

describe("job export (Xuất Excel) — Người làm column", () => {
  it("lists names with quantities, most images first; empty cell before the split", () => {
    expect(workersCell(toJobPeople(jobRow()).workers)).toBe("Worker B · 25 tấm, Worker A · 15 tấm");
    expect(workersCell([])).toBeNull();
  });

  it("per-person view: the person's columns next to the job totals", () => {
    expect(personColumns("Worker B").map((column) => column.header)).toEqual([
      "Công đoạn (Worker B)",
      "Giao (Worker B)",
      "Done (Worker B)",
      "Checked (Worker B)"
    ]);
    expect(personCells({ processes: ["Clipping", "Retouch"], taskCount: 2, qtyAssigned: 30, qtyDone: 25, qtyChecked: 10 })).toEqual({
      personProcesses: "Clipping, Retouch",
      personAssigned: 30,
      personDone: 25,
      personChecked: 10
    });
    expect(personCells(null)).toEqual({ personProcesses: null, personAssigned: 0, personDone: 0, personChecked: 0 });
  });
});
