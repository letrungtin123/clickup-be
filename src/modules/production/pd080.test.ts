import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultJobPermissions, UpdateProductionSettingsRequestSchema } from "../../contracts/production-catalog.js";
import {
  overviewMaxDays,
  ProductionOverviewQuerySchema,
  ProductionOverviewSchema,
  RiskHistoryQuerySchema,
  RiskHistorySchema,
  TeamLoadSchema
} from "../../contracts/production-overview.js";
import type { AccessContext } from "../access/access-context.js";
import type * as JobsRepoModule from "./jobs.repo.js";
import type { Workflow, WorkflowStatus } from "./workflow.js";

/**
 * PD-080 — Overview V2 reads and the At risk scan without a database: a fake tagged-template `sql` records every
 * statement (fragments inlined like postgres.js) and answers from a per-test handler (as pd073.test.ts). The pure rules
 * are in overview-model.test.ts, core-clock.test.ts and at-risk.test.ts. Obviously fake ids, codes and names only: the
 * repository is public.
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

const statusOf = (code: string, sortOrder: number, name: string, extra: Partial<WorkflowStatus> = {}): WorkflowStatus => ({
  id: `a${String(sortOrder).padStart(7, "0")}-1111-4111-8111-111111111111`,
  code,
  name,
  sortOrder,
  countsDone: code === "DONE",
  countsChecked: code === "CHECKED",
  isTerminal: false,
  isInitial: false,
  setByRoles: [],
  active: true,
  ...extra
});
const statuses = {
  ASSIGNED: statusOf("ASSIGNED", 1, "Mới giao", { isInitial: true }),
  REWORK: statusOf("REWORK", 2, "Cần sửa lại"),
  PROCESSING: statusOf("PROCESSING", 3, "Đang làm"),
  DONE: statusOf("DONE", 4, "Done"),
  WAITING_QC: statusOf("WAITING_QC", 5, "Chờ QC"),
  QC_CHECKING: statusOf("QC_CHECKING", 6, "Đang check"),
  CHECKED: statusOf("CHECKED", 7, "Đã check"),
  COMPLETE: statusOf("COMPLETE", 8, "Complete"),
  DELIVERED: statusOf("DELIVERED", 11, "Đã giao khách", { isTerminal: true })
};
const workflow: Workflow = { statuses: Object.values(statuses), transitions: [] };

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
  loadWorkflowModel: vi.fn(() => Promise.resolve(workflow))
}));

const { getProductionOverview, getRiskHistory, getTeamLoad, wasClientLate } = await import("./overview.service.js");
const { runAtRiskScan } = await import("./at-risk.js");
const { createJobStatus, listJobStatuses, updateJobStatus } = await import("./job-statuses.service.js");
const { getSettings, updateSettings } = await import("./catalog.service.js");
const { clearProductionConfigCache } = await import("./catalog-cache.js");

const org = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const worker = "33333333-3333-4333-8333-333333333333";
const checker = "44444444-4444-4444-8444-444444444444";
const projectA = "88888888-8888-4888-8888-888888888881";
const projectB = "88888888-8888-4888-8888-888888888882";
const jobOwned = "66666666-6666-4666-8666-666666666661";
const jobOther = "66666666-6666-4666-8666-666666666662";
const lineId = "77777777-7777-4777-8777-777777777771";
const processId = "99999999-9999-4999-8999-999999999991";
const qcProcessId = "99999999-9999-4999-8999-999999999992";
const jobStatusId = "55555555-5555-4555-8555-555555555551";
// 14:05 on Wednesday 2026-10-21 in Asia/Ho_Chi_Minh.
const now = new Date("2026-10-21T07:05:00Z");
const local = (value: string) => new Date(`${value.replace(" ", "T")}:00+07:00`);

const contextWith = (roles: string[], options: { superadmin?: boolean; test?: boolean } = {}) =>
  ({
    user: { id: me },
    organization: { id: org },
    hasFullOrganizationAuthority: options.superadmin ?? false,
    productionRoles: roles,
    role: { permissions: [] },
    ...(options.test ? { isTestAccount: true } : {})
  }) as unknown as AccessContext;

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return { code: (error as { code?: string }).code, status: (error as { statusCode?: number }).statusCode };
  }
  return null;
};

const userJson = (id: string, name: string) => ({ id, display_name: name, email: null, avatar_url: null });
const jobDb = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  code: id === jobOwned ? "AXP-01" : "BRX-01",
  name: null,
  project_id: id === jobOwned ? projectA : projectB,
  project_code: id === jobOwned ? "AXP" : "BRX",
  project_name: "Project",
  leader: userJson(me, "Leader Test"),
  received_at: local("2026-10-20 08:00"),
  deadline: local("2026-10-21 18:00"),
  created_at: local("2026-10-20 08:00"),
  created_by_account: false,
  total_images: 30,
  status_id: jobStatusId,
  status_name: "Đang làm",
  status_color: "blue",
  status_kind: "IN_PROGRESS",
  owned: id === jobOwned,
  last_activity_at: local("2026-10-21 14:00"),
  ...overrides
});
const lineDb = (overrides: Record<string, unknown> = {}) => ({
  id: lineId,
  job_id: jobOwned,
  number: "1286",
  process_id: processId,
  process_name: "Retouch",
  is_qc: false,
  assignee: userJson(worker, "Worker One"),
  qc: userJson(checker, "Checker Two"),
  status_id: statuses.PROCESSING.id,
  status_code: "PROCESSING",
  status_name: "Đang làm",
  status_color: "blue",
  assigned_at: local("2026-10-21 08:00"),
  deadline: local("2026-10-21 17:00"),
  done_at: null,
  qty_assigned: 12,
  qty_done: null,
  note: "Ghi chú",
  waiting_since: null,
  ...overrides
});
const riskDb = { job_id: jobOwned, reason: "CAPACITY", started_at: local("2026-10-21 11:00"), evaluated_at: local("2026-10-21 14:00"), work_hours: "9.50", capacity_hours: "2.42", hours_left: "2.42", people: 1 };

const overviewAnswer =
  (extra: { jobs?: unknown[]; lines?: unknown[]; leave?: unknown[]; risks?: unknown[]; settings?: unknown[] } = {}) =>
  (call: Call): unknown[] | undefined => {
    if (call.text.startsWith("SELECT key, value FROM production.settings")) return extra.settings ?? [];
    if (call.text.includes("AS last_activity_at")) return extra.jobs ?? [jobDb(jobOwned), jobDb(jobOther)];
    if (call.text.includes("AS waiting_since")) return extra.lines ?? [lineDb()];
    if (call.text.includes("slot_range @>")) return extra.leave ?? [];
    if (call.text.includes("FROM production.job_risk_episodes")) return extra.risks ?? [riskDb];
    return undefined;
  };
const find = (marker: string) => db.state.calls.find((call) => call.text.includes(marker));
const createdByTest = "NOT EXISTS (SELECT 1 FROM public.app_users test_au WHERE test_au.id = j.created_by AND test_au.is_test_account)";
const assigneeTest = "NOT EXISTS (SELECT 1 FROM public.app_users test_au WHERE test_au.id = t.assignee_id AND test_au.is_test_account)";

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = () => [];
  clearProductionConfigCache();
});

describe("GET /production/overview query (PD-080)", () => {
  it("days optional, from ≤ to, at most 92 days; scope mine|all; leader=me kept", () => {
    expect(overviewMaxDays).toBe(92);
    expect(ProductionOverviewQuerySchema.parse({})).toEqual({});
    expect(ProductionOverviewQuerySchema.safeParse({ from: "2026-10-21", to: "2026-10-20" }).success).toBe(false);
    expect(ProductionOverviewQuerySchema.safeParse({ from: "2026-08-01", to: "2026-10-31" }).success).toBe(true);
    expect(ProductionOverviewQuerySchema.safeParse({ from: "2026-08-01", to: "2026-11-01" }).success).toBe(false);
    expect(ProductionOverviewQuerySchema.safeParse({ from: "2026-02-31" }).success).toBe(false);
    expect(ProductionOverviewQuerySchema.parse({ scope: "mine" })).toEqual({ scope: "mine" });
    expect(ProductionOverviewQuerySchema.safeParse({ scope: "team" }).success).toBe(false);
    expect(ProductionOverviewQuerySchema.parse({ leader: "me" })).toEqual({ leader: "me" });
  });
});

describe("GET /production/overview reads (PD-080)", () => {
  it("Staff / QC alone: 403 OVERVIEW_FORBIDDEN before any read; job view 'none': 403", async () => {
    for (const roles of [["STAFF"], ["QC"], ["STAFF", "QC"]]) {
      expect(await failure(getProductionOverview(contextWith(roles), {}, now))).toEqual({ code: "OVERVIEW_FORBIDDEN", status: 403 });
    }
    expect(db.state.calls).toHaveLength(0);
    const none = { view: "none", create: "none", update: "none", delete: "none" };
    db.state.handler = overviewAnswer({ settings: [{ key: "job_permissions", value: { ...defaultJobPermissions, LEADER: none } }] });
    expect(await failure(getProductionOverview(contextWith(["LEADER"]), {}, now))).toEqual({ code: "FORBIDDEN", status: 403 });
    expect(find("AS last_activity_at")).toBeUndefined();
  });

  it("a Leader: My Projects by default (jobs of projects I co-own), both scope counts, Leader needs, Chia task", async () => {
    db.state.handler = overviewAnswer();
    const overview = ProductionOverviewSchema.parse(await getProductionOverview(contextWith(["LEADER"]), {}, now));
    expect(overview.scope).toBe("mine");
    expect(overview.range).toEqual({ from: "2026-10-21", to: "2026-10-21" });
    expect(overview.today).toBe("2026-10-21");
    expect(overview.jobs.map((job) => job.id)).toEqual([jobOwned]);
    expect(overview.scopeCounts).toEqual({ mine: 1, all: 2 });
    expect(overview.viewer).toEqual({ scopeSwitch: true, defaultScope: "mine", leaderNeeds: true, accountNeeds: false, canAssign: true, riskHistory: false });
    expect(overview.accountNeeds).toBeNull();
    expect(overview.clock).toEqual({ coreStart: "09:30", coreEnd: "16:30", alertHours: 2 });
    expect(overview.stageNames.find((item) => item.stage === "WAITING_QC")?.name).toBe("Chờ QC");
    expect(overview.cards.total).toEqual({ tasks: 1, images: 12, jobs: 1 });
    // The open episode is mapped (numbers come as numeric text).
    expect(overview.jobs[0]!.risk).toMatchObject({ reason: "CAPACITY", workHours: 9.5, capacityHours: 2.42, people: 1 });
    expect(overview.leaderNeeds).toMatchObject({ atRisk: 1 });
    const all = ProductionOverviewSchema.parse(await getProductionOverview(contextWith(["LEADER"]), { scope: "all" }, now));
    expect(all.jobs.map((job) => job.id).sort()).toEqual([jobOwned, jobOther].sort());
    expect((await getProductionOverview(contextWith(["LEADER"]), { leader: "me" }, now)).scope).toBe("mine");
  });

  it("an Account: Tất cả by default, no switch, Account needs, no Chia task (PD-079)", async () => {
    db.state.handler = overviewAnswer();
    const overview = await getProductionOverview(contextWith(["ACCOUNT"]), {}, now);
    expect(overview.scope).toBe("all");
    expect(overview.viewer).toEqual({ scopeSwitch: false, defaultScope: "all", leaderNeeds: false, accountNeeds: true, canAssign: false, riskHistory: false });
    expect(overview.scopeCounts).toEqual({ mine: 0, all: 2 });
    expect(overview.leaderNeeds).toBeNull();
    expect(overview.accountNeeds).toMatchObject({ atRisk: 1 });
  });

  it("the superadmin (ADMIN + DIRECTOR): Tất cả, Leader needs, Chia task and the At risk history", async () => {
    db.state.handler = overviewAnswer();
    const overview = await getProductionOverview(contextWith([], { superadmin: true }), {}, now);
    expect(overview.scope).toBe("all");
    expect(overview.viewer).toEqual({ scopeSwitch: true, defaultScope: "all", leaderNeeds: true, accountNeeds: false, canAssign: true, riskHistory: true });
    const director = await getProductionOverview(contextWith(["DIRECTOR"]), {}, now);
    expect(director.viewer).toMatchObject({ scopeSwitch: false, leaderNeeds: true, canAssign: false, riskHistory: true });
  });

  it("the job query: the job list's visibility, client deadline in range / client-late / a line due in range or overdue", async () => {
    db.state.handler = overviewAnswer();
    await getProductionOverview(contextWith(["LEADER"]), { from: "2026-10-19", to: "2026-10-25" }, now);
    const jobs = find("AS last_activity_at")!;
    expect(jobs.text).toContain("j.deleted_at IS NULL");
    expect(jobs.text).toContain("AND j.archived_at IS NULL");
    expect(jobs.text).toContain(createdByTest);
    expect(jobs.text).toContain("js.kind NOT IN ('DELIVERING', 'DELIVERED')");
    expect(jobs.text).toContain("(t.done_at IS NULL AND t.closed_at IS NULL AND t.deadline < $)");
    expect(jobs.text).toContain("EXISTS ( SELECT 1 FROM production.project_owners op");
    expect(jobs.text).toContain("max(c.created_at) FROM production.comments c");
    // Range instants: 19/10 00:00 → 26/10 00:00 organization time.
    expect(jobs.values).toContainEqual(local("2026-10-19 00:00"));
    expect(jobs.values).toContainEqual(local("2026-10-26 00:00"));
    expect(jobs.values).toContainEqual(now);
    const lines = find("AS waiting_since")!;
    expect(lines.text).toContain(assigneeTest);
    expect(lines.text).toContain("t.job_id = ANY($::uuid[])");
    expect(lines.text).toContain("l.to_value->>'code' = 'WAITING_QC'");
    expect(lines.values).toContainEqual([jobOwned, jobOther]);
    expect(find("FROM production.job_risk_episodes")!.text).toContain("ended_at IS NULL");
  });

  it("a QA test account sees test accounts' jobs and lines (PD-063); no jobs → no line / risk reads", async () => {
    db.state.handler = overviewAnswer();
    await getProductionOverview(contextWith(["LEADER"], { test: true }), {}, now);
    expect(find("AS last_activity_at")!.text).not.toContain(createdByTest);
    expect(find("AS waiting_since")!.text).not.toContain(assigneeTest);
    db.state.calls = [];
    db.state.handler = overviewAnswer({ jobs: [] });
    const empty = await getProductionOverview(contextWith(["LEADER"]), {}, now);
    expect(empty.jobs).toEqual([]);
    expect(empty.cards.total).toEqual({ tasks: 0, images: 0, jobs: 0 });
    expect(find("AS waiting_since")).toBeUndefined();
    expect(find("FROM production.job_risk_episodes")).toBeUndefined();
  });

  it("people on leave now: a waiting line's QC alerts at once, a worker makes the job 'Nhân viên đang nghỉ'", async () => {
    db.state.handler = overviewAnswer({
      lines: [
        lineDb({ assignee: userJson(worker, "Worker One") }),
        lineDb({
          id: "77777777-7777-4777-8777-777777777772",
          number: "1287",
          status_id: statuses.WAITING_QC.id,
          status_code: "WAITING_QC",
          done_at: local("2026-10-21 13:50"),
          qty_done: 7,
          waiting_since: local("2026-10-21 14:00")
        })
      ],
      leave: [{ user_id: worker }, { user_id: checker }],
      risks: []
    });
    const overview = await getProductionOverview(contextWith(["LEADER"]), {}, now);
    const job = overview.jobs[0]!;
    expect(job.stale).toMatchObject({ reason: "STAFF_ON_LEAVE" });
    expect(job.tasks.find((task) => task.stage === "WAITING_QC")!.qcWait).toMatchObject({ minutes: 5, alert: true });
    expect(overview.leaderNeeds).toMatchObject({ qcWaitImages: 7, staleJobs: 1, atRisk: 0 });
    expect(find("slot_range @>")!.values).toEqual([org, now, "Asia/Ho_Chi_Minh"]);
  });
});

describe("At risk scan (PD-080)", () => {
  const jobA = "66666666-6666-4666-8666-0000000000a1";
  const jobB = "66666666-6666-4666-8666-0000000000b2";
  const jobC = "66666666-6666-4666-8666-0000000000c3";
  const jobD = "66666666-6666-4666-8666-0000000000d4";
  const episodeB = "eeeeeeee-0000-4000-8000-0000000000b2";
  const episodeC = "eeeeeeee-0000-4000-8000-0000000000c3";
  const episodeD = "eeeeeeee-0000-4000-8000-0000000000d4";
  const episodeGone = "eeeeeeee-0000-4000-8000-0000000000e5";
  const dbRow = (job: string, code: keyof typeof statuses, qty: number, overrides: Record<string, unknown> = {}) => ({
    id: `${job.slice(0, 30)}${String(qty).padStart(6, "0")}`,
    job_id: job,
    parent_id: null,
    process_id: processId,
    is_qc: false,
    status_id: statuses[code].id,
    status_code: code,
    done_at: ["WAITING_QC", "CHECKED"].includes(code) ? local("2026-10-21 12:00") : null,
    qty_assigned: qty,
    qty_done: ["WAITING_QC", "CHECKED"].includes(code) ? qty : null,
    assignee_id: worker,
    qc_id: checker,
    ...overrides
  });
  const scanAnswer =
    (locked = true) =>
    (call: Call): unknown[] | undefined => {
      if (call.text.includes("pg_try_advisory_xact_lock")) return [{ locked }];
      if (call.text.includes("FROM public.organizations o")) return [{ id: org }];
      if (call.text.startsWith("SELECT j.id, j.project_id, j.leader_id")) {
        return [jobA, jobB, jobC, jobD].map((id) => ({ id, project_id: projectA, leader_id: me, deadline: local("2026-10-21 16:30"), total_images: 0 }));
      }
      if (call.text.includes("AS parent_id")) {
        return [
          dbRow(jobA, "PROCESSING", 40),
          dbRow(jobB, "PROCESSING", 30),
          dbRow(jobC, "WAITING_QC", 200),
          dbRow(jobD, "PROCESSING", 1)
        ];
      }
      if (call.text.includes("FROM production.credit_rules")) {
        return [
          { project_id: projectA, process_id: processId, credit_per_image: "5.50", hours_per_image: null },
          { project_id: projectA, process_id: qcProcessId, credit_per_image: "1.10", hours_per_image: "0.2000" }
        ];
      }
      if (call.text.includes("FROM production.processes WHERE")) return [{ id: qcProcessId, name: "Checking", sort_order: 9 }];
      if (call.text.includes("ended_at IS NULL FOR UPDATE")) {
        return [
          { id: episodeB, job_id: jobB },
          { id: episodeC, job_id: jobC },
          { id: episodeD, job_id: jobD },
          { id: episodeGone, job_id: "66666666-6666-4666-8666-0000000000e5" }
        ];
      }
      return undefined;
    };

  it("opens, updates and closes episodes; leftover open episodes end as REMOVED / FINISHED / CLIENT_LATE", async () => {
    db.state.handler = scanAnswer();
    await runAtRiskScan(now);
    const jobs = find("SELECT j.id, j.project_id, j.leader_id")!;
    expect(jobs.text).toContain("j.deadline > $");
    expect(jobs.text).toContain("NOT (js.kind = ANY($::text[]))");
    expect(jobs.values).toContainEqual(["COMPLETE", "DELIVERING", "DELIVERED"]);
    // Job A: 40 × 0.5 h (credit 5.5 ÷ 11) = 20 h > 2.42 h → a new episode.
    const inserts = db.state.calls.filter((call) => call.text.startsWith("INSERT INTO production.job_risk_episodes"));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.values).toEqual([org, jobA, projectA, me, "CAPACITY", now, local("2026-10-21 16:30"), 20, 2.42, 2.42, 1, now]);
    const updates = db.state.calls.filter((call) => call.text.startsWith("UPDATE production.job_risk_episodes"));
    // Job B still at risk (30 × 0.5 = 15 h): numbers refreshed on its open episode.
    const refreshed = updates.find((call) => call.values.includes(episodeB))!;
    expect(refreshed.text).toContain("SET reason = $");
    expect(refreshed.values.slice(0, 2)).toEqual(["CAPACITY", local("2026-10-21 16:30")]);
    expect(refreshed.values).toContain(15);
    // Job C: every line past its worker → FINISHED; job D fits (0.5 h) → CLEARED.
    expect(updates.find((call) => call.values.includes(episodeC))!.values).toEqual([now, "FINISHED", now, episodeC]);
    expect(updates.find((call) => call.values.includes(episodeD))!.values).toEqual([now, "CLEARED", now, episodeD]);
    const leftover = updates.find((call) => call.text.includes("'CLIENT_LATE'"))!;
    expect(leftover.text).toContain("THEN 'REMOVED'");
    expect(leftover.text).toContain("THEN 'FINISHED'");
    expect(leftover.values).toContainEqual([episodeGone]);
  });

  it("another worker holds the lock: nothing is read or written", async () => {
    db.state.handler = scanAnswer(false);
    await runAtRiskScan(now);
    expect(db.state.calls).toHaveLength(1);
  });
});

describe("GET /production/team-load (PD-080)", () => {
  const answer = (call: Call): unknown[] | undefined => {
    if (call.text.includes("AS leave_now")) {
      return [
        { user: userJson(worker, "Worker One"), roles: ["STAFF"], leave_part: null, leave_now: false },
        { user: userJson(checker, "Checker Two"), roles: ["QC", "STAFF"], leave_part: "MORNING", leave_now: true },
        { user: userJson(me, "Another Leader"), roles: ["LEADER"], leave_part: null, leave_now: false }
      ];
    }
    if (call.text.includes("AS without_qty")) {
      return [
        { assignee_id: worker, project_id: projectB, project_code: "BRX", images: 2, tasks: 1, without_qty: 0 },
        { assignee_id: worker, project_id: projectA, project_code: "AXP", images: 10, tasks: 2, without_qty: 1 }
      ];
    }
    return undefined;
  };

  it("Leaders and Quản trị only", async () => {
    for (const roles of [["ACCOUNT"], ["STAFF"], ["QC"], ["DIRECTOR"]]) {
      expect(await failure(getTeamLoad(contextWith(roles), now))).toMatchObject({ code: "FORBIDDEN", status: 403 });
    }
  });

  it("images in hand per person and project (biggest first), lines without quantity apart, leave today", async () => {
    db.state.handler = answer;
    const load = TeamLoadSchema.parse(await getTeamLoad(contextWith(["LEADER"]), now));
    expect(load.today).toBe("2026-10-21");
    expect(load.members.map((member) => member.user.displayName)).toEqual(["Another Leader", "Checker Two", "Worker One"]);
    const one = load.members.find((member) => member.user.id === worker)!;
    expect(one).toMatchObject({ openTasks: 3, images: 12, tasksWithoutQty: 1, leave: null });
    expect(one.byProject.map((item) => item.project.code)).toEqual(["AXP", "BRX"]);
    expect(load.members.find((member) => member.user.id === checker)).toMatchObject({ leave: { part: "MORNING", now: true }, openTasks: 0, roles: ["QC", "STAFF"] });
    const loads = find("AS without_qty")!;
    expect(loads.text).toContain("st.code IN ('ASSIGNED', 'PROCESSING', 'REWORK')");
    expect(loads.text).toContain("j.archived_at IS NULL");
    expect(find("AS leave_now")!.text).toContain("NOT au.is_test_account");
    expect(await getTeamLoad(contextWith(["ADMIN"]), now)).toBeTruthy();
  });
});

describe("GET /production/overview/risk-history (PD-080)", () => {
  const leaderJson = userJson(me, "Leader Test");
  const episode = (job: string, overrides: Record<string, unknown> = {}) => ({
    job_id: job,
    job_code: job === jobOwned ? "AXP-01" : "BRX-01",
    project_id: job === jobOwned ? projectA : projectB,
    project_code: job === jobOwned ? "AXP" : "BRX",
    project_name: "Project",
    leader: leaderJson,
    reason: "CAPACITY",
    started_at: local("2026-10-20 10:00"),
    ended_at: local("2026-10-20 15:00"),
    end_reason: "CLEARED",
    deadline: local("2026-10-21 17:00"),
    job_deadline: local("2026-10-21 17:00"),
    delivered_at: null,
    delivered_kind: false,
    ...overrides
  });

  it("superadmin and Director only", async () => {
    for (const roles of [["LEADER"], ["ADMIN"], ["ACCOUNT"]]) {
      expect(await failure(getRiskHistory(contextWith(roles), {}, now))).toMatchObject({ code: "FORBIDDEN", status: 403 });
    }
    expect(RiskHistoryQuerySchema.safeParse({ from: "2026-10-21", to: "2026-10-01" }).success).toBe(false);
  });

  it("one row per job, per week / Leader / project, and whether the job was really client-late", async () => {
    db.state.handler = (call) =>
      call.text.includes("FROM production.job_risk_episodes e")
        ? [
            // Newest first, as the query orders them.
            episode(jobOwned, { started_at: local("2026-10-21 09:45"), ended_at: null, end_reason: null }),
            episode(jobOther, { started_at: local("2026-10-14 10:00"), delivered_at: local("2026-10-21 18:00"), delivered_kind: true, job_deadline: local("2026-10-15 17:00") }),
            episode(jobOwned, { started_at: local("2026-10-20 10:00") })
          ]
        : undefined;
    const history = RiskHistorySchema.parse(await getRiskHistory(contextWith(["DIRECTOR"]), {}, now));
    // Default: the last 8 weeks (from the Monday 7 weeks before this week's).
    expect(history.from).toBe("2026-08-31");
    expect(history.to).toBe("2026-10-21");
    expect(history.totals).toEqual({ jobs: 2, clientLate: 1, episodes: 3, open: 1 });
    expect(history.weeks).toEqual([
      { week: "2026-10-12", jobs: 1, clientLate: 1 },
      { week: "2026-10-19", jobs: 1, clientLate: 0 }
    ]);
    expect(history.leaders).toEqual([{ leader: { id: me, displayName: "Leader Test", email: null, avatarUrl: null }, jobs: 2, clientLate: 1 }]);
    expect(history.projects.map((item) => [item.project.code, item.jobs, item.clientLate])).toEqual([
      ["AXP", 1, 0],
      ["BRX", 1, 1]
    ]);
    const owned = history.jobs.find((item) => item.job.id === jobOwned)!;
    expect(owned).toMatchObject({ episodes: 2, endedAt: null, endReason: null, clientLate: false });
    expect(history.jobs.map((item) => item.job.id)).toEqual([jobOwned, jobOther]);
    const query = find("FROM production.job_risk_episodes e")!;
    expect(query.text).toContain("ds.kind IN ('DELIVERING', 'DELIVERED')");
    expect(query.text).toContain(createdByTest);
    expect(await getRiskHistory(contextWith([], { superadmin: true }), { from: "2026-10-01", to: "2026-10-21" }, now)).toMatchObject({ from: "2026-10-01" });
  });

  it("really client-late: delivered after the deadline, or still undelivered past it", () => {
    const deadline = local("2026-10-21 12:00");
    expect(wasClientLate({ deadline, deliveredAt: local("2026-10-21 13:00"), delivered: true }, now)).toBe(true);
    expect(wasClientLate({ deadline, deliveredAt: local("2026-10-21 11:00"), delivered: true }, now)).toBe(false);
    expect(wasClientLate({ deadline, deliveredAt: null, delivered: false }, now)).toBe(true);
    expect(wasClientLate({ deadline: local("2026-10-22 12:00"), deliveredAt: null, delivered: false }, now)).toBe(false);
    // Delivered without a history row (e.g. imported): counted on time.
    expect(wasClientLate({ deadline, deliveredAt: null, delivered: true }, now)).toBe(false);
  });
});

describe("job status kinds (PD-080)", () => {
  const superadmin = contextWith([], { superadmin: true });

  it("lists the kind; creates with the given kind (default IN_PROGRESS); a PATCH changes it alone", async () => {
    db.state.handler = (call) => {
      if (call.text.includes("FROM production.job_statuses s")) {
        return [
          { id: jobStatusId, name: "Đã xong", color: "green", position: 4, is_closed: false, requires_all_checked: true, kind: "COMPLETE", job_count: 2, updated_at: now, updated_by: null }
        ];
      }
      if (call.text.startsWith("SELECT count(*)::int AS count FROM production.job_statuses")) return [{ count: 3 }];
      if (call.text.startsWith("UPDATE production.job_statuses")) return [{ id: jobStatusId }];
      return undefined;
    };
    expect((await listJobStatuses(superadmin)).items[0]).toMatchObject({ kind: "COMPLETE", requiresAllChecked: true });
    await createJobStatus(superadmin, { name: "Gửi khách", color: "violet", isClosed: false, requiresAllChecked: false, kind: "DELIVERING" });
    expect(db.state.calls.find((call) => call.text.startsWith("INSERT INTO production.job_statuses"))!.values).toContain("DELIVERING");
    db.state.calls = [];
    await createJobStatus(superadmin, { name: "Khác", color: "slate", isClosed: false, requiresAllChecked: false });
    expect(db.state.calls.find((call) => call.text.startsWith("INSERT INTO production.job_statuses"))!.values).toContain("IN_PROGRESS");
    db.state.calls = [];
    await updateJobStatus(superadmin, jobStatusId, { kind: "FEEDBACK" });
    const update = db.state.calls.find((call) => call.text.startsWith("UPDATE production.job_statuses"))!;
    expect(update.text).toContain("kind = coalesce($, kind)");
    expect(update.values.slice(0, 5)).toEqual([null, null, null, null, "FEEDBACK"]);
    expect(await failure(updateJobStatus(contextWith(["ADMIN"]), jobStatusId, { kind: "NEW" }))).toMatchObject({ code: "FORBIDDEN", status: 403 });
  });
});

describe("settings: core window and alert threshold (PD-080)", () => {
  const superadmin = contextWith([], { superadmin: true });

  it("defaults 09:30 – 16:30 and 2 h until saved", async () => {
    const settings = await getSettings(superadmin);
    expect(settings).toMatchObject({ coreWindowStart: "09:30", coreWindowEnd: "16:30", alertAfterHours: 2 });
  });

  it("the request schema: HH:MM, 0.25 – 24 h, start before end when both are sent", () => {
    expect(UpdateProductionSettingsRequestSchema.safeParse({ coreWindowStart: "08:00", coreWindowEnd: "17:00", alertAfterHours: 1.5 }).success).toBe(true);
    expect(UpdateProductionSettingsRequestSchema.safeParse({ coreWindowStart: "17:00", coreWindowEnd: "09:00" }).success).toBe(false);
    expect(UpdateProductionSettingsRequestSchema.safeParse({ coreWindowStart: "9:30" }).success).toBe(false);
    expect(UpdateProductionSettingsRequestSchema.safeParse({ coreWindowEnd: "24:00" }).success).toBe(false);
    expect(UpdateProductionSettingsRequestSchema.safeParse({ alertAfterHours: 0.1 }).success).toBe(false);
  });

  it("one end alone may not break the window (400 CORE_WINDOW_INVALID); a valid one is stored under its key", async () => {
    db.state.handler = (call) => (call.text.startsWith("SELECT key, value FROM production.settings") ? [{ key: "core_window_end", value: "12:00" }] : undefined);
    expect(await failure(updateSettings(superadmin, { coreWindowStart: "13:00" }))).toEqual({ code: "CORE_WINDOW_INVALID", status: 400 });
    expect(db.state.calls.some((call) => call.text.startsWith("INSERT INTO production.settings"))).toBe(false);
    clearProductionConfigCache();
    await updateSettings(superadmin, { coreWindowStart: "08:00", alertAfterHours: 3 });
    const writes = db.state.calls.filter((call) => call.text.startsWith("INSERT INTO production.settings"));
    expect(writes.map((call) => call.values[1])).toEqual(["core_window_start", "alert_after_hours"]);
    expect(await failure(updateSettings(contextWith(["ADMIN"]), { alertAfterHours: 3 }))).toMatchObject({ code: "FORBIDDEN", status: 403 });
  });
});
