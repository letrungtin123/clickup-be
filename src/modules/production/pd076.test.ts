import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductionOverviewQuerySchema, ProductionOverviewSchema } from "../../contracts/production-overview.js";
import type { AccessContext } from "../access/access-context.js";
import type * as JobsRepoModule from "./jobs.repo.js";
import type { Workflow, WorkflowStatus } from "./workflow.js";

/**
 * PD-076 — "Tổng quan" (GET /production/overview), without a database: a fake tagged-template `sql` records every
 * statement (fragments inlined like postgres.js) and answers from a per-test handler (as pd073.test.ts). Pure helpers
 * (range, chart widening, comparison days, week, status classification, volume slices) are tested directly. Obviously
 * fake ids, codes and names only: the repository is public.
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

const statusOf = (code: string, sortOrder: number, extra: Partial<WorkflowStatus> = {}): WorkflowStatus => ({
  id: `a${String(sortOrder).padStart(7, "0")}-1111-4111-8111-111111111111`,
  code,
  name: code,
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
  ASSIGNED: statusOf("ASSIGNED", 1, { isInitial: true }),
  REWORK: statusOf("REWORK", 2),
  PROCESSING: statusOf("PROCESSING", 3),
  DONE: statusOf("DONE", 4),
  WAITING_QC: statusOf("WAITING_QC", 5),
  CHECKED: statusOf("CHECKED", 7),
  DELIVERED: statusOf("DELIVERED", 11, { isTerminal: true })
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

const {
  dayInTimeZone,
  fillOverviewDays,
  getProductionOverview,
  overviewChartRange,
  overviewComparisonRange,
  overviewVolumeSlices,
  resolveOverviewRange,
  summarizeOverviewLines,
  weekOfDay
} = await import("./overview.service.js");
const { clearProductionConfigCache } = await import("./catalog-cache.js");

const org = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const worker = "33333333-3333-4333-8333-333333333333";
const projectA = "88888888-8888-4888-8888-888888888881";
const projectB = "88888888-8888-4888-8888-888888888882";
const jobId = "66666666-6666-4666-8666-666666666666";
const taskId = "77777777-7777-4777-8777-777777777777";
const processId = "99999999-9999-4999-8999-999999999999";
// 10:00 on Wednesday 2026-10-21 in Asia/Ho_Chi_Minh.
const now = new Date("2026-10-21T03:00:00Z");

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

/** The statements of one overview read, by what they select. */
const calls = () => {
  const find = (marker: string) => db.state.calls.find((call) => call.text.includes(marker));
  return {
    groups: find("AS past_deadline"),
    daily: find("'received' AS kind"),
    volume: find("AS without_qty"),
    projects: find("WITH open_jobs AS MATERIALIZED"),
    due: db.state.calls.filter((call) => call.text.includes("count(*) OVER ()::int AS total"))
  };
};
const queriesOverLines = () => {
  const { groups, daily, volume, due } = calls();
  return [groups!, daily!, volume!, ...due];
};
/** PD-078 "Tôi quản lý": the jobs of the projects the caller owns (scope=mine; leader=me is its older spelling). */
const ownedProject = "EXISTS ( SELECT 1 FROM production.project_owners op WHERE op.organization_id = j.organization_id AND op.project_id = j.project_id AND op.user_id = $ )";
const scopeFilter = `AND ${ownedProject}`;
const createdByTest = "NOT EXISTS (SELECT 1 FROM public.app_users test_au WHERE test_au.id = j.created_by AND test_au.is_test_account)";
const assigneeTest = "NOT EXISTS (SELECT 1 FROM public.app_users test_au WHERE test_au.id = t.assignee_id AND test_au.is_test_account)";

const group = (status: WorkflowStatus, lines: number, extra: Partial<Parameters<typeof summarizeOverviewLines>[1][number]> = {}) => ({
  status_id: status.id,
  status_code: status.code,
  status_name: status.name,
  status_color: "blue",
  status_order: status.sortOrder,
  is_checking: false,
  was_done: false,
  current: true,
  led: false,
  lines,
  past_deadline: 0,
  ...extra
});

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = () => [];
  clearProductionConfigCache();
});

describe("GET /production/overview query (PD-076)", () => {
  it("days are optional; from ≤ to; at most 400 days; leader only 'me'; impossible days refused", () => {
    expect(ProductionOverviewQuerySchema.parse({})).toEqual({});
    expect(ProductionOverviewQuerySchema.safeParse({ from: "2026-10-01", to: "2026-10-31", leader: "me" }).success).toBe(true);
    expect(ProductionOverviewQuerySchema.safeParse({ from: "2026-10-22", to: "2026-10-21" }).success).toBe(false);
    // 400 days inclusive pass, 401 fail.
    expect(ProductionOverviewQuerySchema.safeParse({ from: "2025-09-17", to: "2026-10-21" }).success).toBe(true);
    expect(ProductionOverviewQuerySchema.safeParse({ from: "2025-09-16", to: "2026-10-21" }).success).toBe(false);
    expect(ProductionOverviewQuerySchema.safeParse({ from: "2026-02-31" }).success).toBe(false);
    expect(ProductionOverviewQuerySchema.safeParse({ leader: me }).success).toBe(false);
    expect(ProductionOverviewQuerySchema.safeParse({ leader: "all" }).success).toBe(false);
  });
});

describe("overview ranges (PD-076)", () => {
  it("a missing end is the other one; none = today", () => {
    expect(resolveOverviewRange({}, "2026-10-21")).toEqual({ from: "2026-10-21", to: "2026-10-21" });
    expect(resolveOverviewRange({ from: "2026-10-03" }, "2026-10-21")).toEqual({ from: "2026-10-03", to: "2026-10-03" });
    expect(resolveOverviewRange({ to: "2026-10-05" }, "2026-10-21")).toEqual({ from: "2026-10-05", to: "2026-10-05" });
    expect(resolveOverviewRange({ from: "2026-09-26", to: "2026-10-25" }, "2026-10-21")).toEqual({ from: "2026-09-26", to: "2026-10-25" });
  });

  it("the chart widens a range shorter than 7 days to the 7 days ending on its last day", () => {
    expect(overviewChartRange({ from: "2026-10-21", to: "2026-10-21" })).toEqual({ from: "2026-10-15", to: "2026-10-21" });
    expect(overviewChartRange({ from: "2026-10-19", to: "2026-10-21" })).toEqual({ from: "2026-10-15", to: "2026-10-21" });
    // Across a month / year boundary.
    expect(overviewChartRange({ from: "2026-01-02", to: "2026-01-02" })).toEqual({ from: "2025-12-27", to: "2026-01-02" });
    expect(overviewChartRange({ from: "2026-10-19", to: "2026-10-25" })).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(overviewChartRange({ from: "2026-09-26", to: "2026-10-25" })).toEqual({ from: "2026-09-26", to: "2026-10-25" });
  });

  it("compares with the same number of days just before (up to today); a future range has none", () => {
    expect(overviewComparisonRange({ from: "2026-10-21", to: "2026-10-21" }, "2026-10-21")).toEqual({ from: "2026-10-20", to: "2026-10-20" });
    // "Tháng này" on the 21st: the 21 days before the 1st, not the whole of September.
    expect(overviewComparisonRange({ from: "2026-10-01", to: "2026-10-31" }, "2026-10-21")).toEqual({ from: "2026-09-10", to: "2026-09-30" });
    // A past range: its full length.
    expect(overviewComparisonRange({ from: "2026-09-01", to: "2026-09-30" }, "2026-10-21")).toEqual({ from: "2026-08-02", to: "2026-08-31" });
    expect(overviewComparisonRange({ from: "2026-10-22", to: "2026-10-31" }, "2026-10-21")).toBeNull();
  });

  it("the week runs Monday – Sunday", () => {
    for (const day of ["2026-10-19", "2026-10-21", "2026-10-25"]) {
      expect(weekOfDay(day)).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    }
    expect(weekOfDay("2026-11-01")).toEqual({ from: "2026-10-26", to: "2026-11-01" });
    expect(weekOfDay("2026-01-01")).toEqual({ from: "2025-12-29", to: "2026-01-04" });
  });

  it("days are zero-filled; today follows the organization timezone", () => {
    expect(
      fillOverviewDays({ from: "2026-10-19", to: "2026-10-21" }, new Map([["2026-10-20", 3]]), new Map([["2026-10-21", 2]]))
    ).toEqual([
      { day: "2026-10-19", received: 0, done: 0 },
      { day: "2026-10-20", received: 3, done: 0 },
      { day: "2026-10-21", received: 0, done: 2 }
    ]);
    // 23:30 UTC on the 20th is already the 21st in Vietnam.
    expect(dayInTimeZone(new Date("2026-10-20T23:30:00Z"), "Asia/Ho_Chi_Minh")).toBe("2026-10-21");
    expect(dayInTimeZone(new Date("2026-10-20T23:30:00Z"), "Not/AZone")).toBe("2026-10-21");
  });
});

describe("overview counts (PD-076)", () => {
  it("total = chưa bắt đầu + đang làm + đã xong; quá hạn only among the unfinished; statuses in workflow order", () => {
    const summary = summarizeOverviewLines(
      workflow,
      [
        group(statuses.ASSIGNED, 4, { past_deadline: 2 }),
        group(statuses.PROCESSING, 3, { past_deadline: 1 }),
        group(statuses.REWORK, 1),
        // Done on time, waiting for QC: in progress, not late (past_deadline counts not-Done lines only).
        group(statuses.DONE, 2, { was_done: true }),
        // A Checking line once Done is finished.
        group(statuses.DONE, 1, { was_done: true, is_checking: true }),
        // Finished lines are never Quá hạn, whatever the deadline.
        group(statuses.CHECKED, 5, { past_deadline: 5 }),
        group(statuses.DELIVERED, 1),
        // The comparison days before the range.
        group(statuses.CHECKED, 6, { current: false }),
        group(statuses.PROCESSING, 2, { current: false })
      ],
      false
    );
    expect(summary.stats).toEqual({ total: 17, notStarted: 4, inProgress: 6, done: 7, overdue: 3 });
    expect(summary.stats.notStarted + summary.stats.inProgress + summary.stats.done).toBe(summary.stats.total);
    expect(summary.previous).toEqual({ total: 8, done: 6 });
    expect(summary.byStatus.map((slice) => [slice.status.code, slice.count, slice.overdue])).toEqual([
      ["ASSIGNED", 4, 2],
      ["REWORK", 1, 0],
      ["PROCESSING", 3, 1],
      ["DONE", 3, 0],
      ["CHECKED", 5, 0],
      ["DELIVERED", 1, 0]
    ]);
    expect(summary.byStatus[0]!.status).toEqual({ id: statuses.ASSIGNED.id, code: "ASSIGNED", name: "ASSIGNED", color: "blue" });
  });

  it("'Tôi quản lý' keeps the led groups; the tab counts cover the range either way", () => {
    const groups = [
      group(statuses.PROCESSING, 3, { led: true, past_deadline: 1 }),
      group(statuses.CHECKED, 2, { led: true }),
      group(statuses.ASSIGNED, 4),
      group(statuses.CHECKED, 9, { current: false, led: true }),
      group(statuses.CHECKED, 7, { current: false })
    ];
    const mine = summarizeOverviewLines(workflow, groups, true);
    expect(mine.stats).toEqual({ total: 5, notStarted: 0, inProgress: 3, done: 2, overdue: 1 });
    expect(mine.previous).toEqual({ total: 9, done: 9 });
    expect(mine.tabs).toEqual({ all: 9, mine: 5 });
    const all = summarizeOverviewLines(workflow, groups, false);
    expect(all.stats.total).toBe(9);
    expect(all.tabs).toEqual({ all: 9, mine: 5 });
  });

  it("volume: the largest projects, then one 'Khác'; a single leftover project is shown as itself", () => {
    const rows = Array.from({ length: 9 }, (_, index) => ({
      project_id: `88888888-8888-4888-8888-88888888890${index}`,
      code: `AX${index}`,
      name: `Dự án ${index}`,
      qty: (index + 1) * 10,
      lines: 1,
      without_qty: 0
    }));
    const slices = overviewVolumeSlices([...rows, { ...rows[0]!, project_id: projectB, code: "BRX", qty: 0 }]);
    expect(slices.map((slice) => slice.project?.code ?? "Khác")).toEqual(["AX8", "AX7", "AX6", "AX5", "AX4", "AX3", "Khác"]);
    expect(slices[6]).toEqual({ project: null, projectCount: 3, qty: 60, lines: 3 });
    expect(overviewVolumeSlices(rows.slice(0, 7)).map((slice) => slice.project?.code)).toHaveLength(7);
    expect(overviewVolumeSlices(rows.slice(0, 7)).some((slice) => slice.project === null)).toBe(false);
  });
});

describe("GET /production/overview reads (PD-076)", () => {
  const answer = (call: Call): unknown[] | undefined => {
    if (call.text.includes("AS past_deadline")) {
      return [
        group(statuses.ASSIGNED, 2, { past_deadline: 1, led: true }),
        group(statuses.CHECKED, 3, { led: false }),
        group(statuses.PROCESSING, 4, { current: false })
      ];
    }
    if (call.text.includes("'received' AS kind")) {
      return [
        { kind: "received", day: "2026-10-21", count: 5 },
        { kind: "received", day: "2026-10-16", count: 2 },
        { kind: "done", day: "2026-10-20", count: 3 }
      ];
    }
    if (call.text.includes("AS without_qty")) {
      return [
        { project_id: projectA, code: "AXP", name: "Dự án A", qty: 120, lines: 3, without_qty: 1 },
        { project_id: projectB, code: "BRX", name: "Dự án B", qty: 0, lines: 2, without_qty: 2 }
      ];
    }
    if (call.text.includes("WITH open_jobs AS MATERIALIZED")) {
      return [{ project_id: projectA, code: "AXP", name: "Dự án A", open_jobs: 3, late_jobs: 1, images_total: 3000, images_done: 1240, images_checked: 800 }];
    }
    if (call.text.includes("count(*) OVER ()::int AS total")) {
      return [
        {
          id: taskId,
          number: "1286",
          job_id: jobId,
          job_code: "Batch 07",
          project_id: projectA,
          project_code: "AXP",
          project_name: "Dự án A",
          process_id: processId,
          process_name: "Normal Retouch",
          assignee: { id: worker, display_name: "Nhân viên Một", email: null, avatar_url: null },
          status_id: statuses.PROCESSING.id,
          status_code: "PROCESSING",
          status_name: "Đang làm",
          status_color: "blue",
          deadline: new Date("2026-10-21T02:00:00Z"),
          overdue: true,
          qty_assigned: 40,
          total: 12
        }
      ];
    }
    return undefined;
  };

  it("a Leader: tab counts from one grouped query (split by 'project I own'), every other read on the visible jobs", async () => {
    db.state.handler = answer;
    const overview = ProductionOverviewSchema.parse(
      await getProductionOverview(contextWith(["LEADER"]), ProductionOverviewQuerySchema.parse({}), now)
    );
    expect(overview.today).toBe("2026-10-21");
    expect(overview.range).toEqual({ from: "2026-10-21", to: "2026-10-21" });
    expect(overview.leaderTabs).toEqual({ all: 5, mine: 2 });
    expect(overview.stats).toEqual({ total: 5, notStarted: 2, inProgress: 0, done: 3, overdue: 1 });
    expect(overview.previous).toEqual({ from: "2026-10-20", to: "2026-10-20", total: 4, done: 0 });
    const { groups, daily } = calls();
    // No scope filter on the grouped lines: the split is a column (PD-078: the job's project is mine, not the job's Leader).
    expect(groups!.text).toContain(`${ownedProject} AS led`);
    expect(groups!.text).not.toContain(scopeFilter);
    expect(groups!.text).not.toContain("j.leader_id = $");
    expect(groups!.values).toContain(me);
    // Received in [comparison start, range end + 1 day) in the organization timezone; Quá hạn against `now`.
    expect(groups!.text).toContain(
      "t.assigned_at >= (($::date)::timestamp AT TIME ZONE $::text) AND t.assigned_at < ((($::date) + 1)::timestamp AT TIME ZONE $::text)"
    );
    expect(groups!.values).toEqual(expect.arrayContaining(["2026-10-20", "2026-10-21", "Asia/Ho_Chi_Minh", now]));
    // Lines only (subtasks are part of their line), live jobs, not archived.
    expect(groups!.text).toContain("NOT (t.kind = 'NORMAL' AND t.parent_task_id IS NOT NULL)");
    expect(groups!.text).toContain("j.deleted_at IS NULL");
    expect(groups!.text).toContain("j.archived_at IS NULL");
    // Single day (Hôm nay): the chart covers the 7 days ending today, zero-filled.
    expect(daily!.values).toEqual(expect.arrayContaining(["2026-10-15", "2026-10-21"]));
    expect(daily!.text).toContain("coalesce(t.closed_at, t.checked_at, t.done_at)");
    expect(overview.daily.from).toBe("2026-10-15");
    expect(overview.daily.days).toHaveLength(7);
    expect(overview.daily.days.find((day) => day.day === "2026-10-16")).toEqual({ day: "2026-10-16", received: 2, done: 0 });
    expect(overview.daily.days.find((day) => day.day === "2026-10-20")).toEqual({ day: "2026-10-20", received: 0, done: 3 });
    expect(overview.daily.days.at(-1)).toEqual({ day: "2026-10-21", received: 5, done: 0 });
  });

  it("'Tôi quản lý' (scope=mine, or the older leader=me): stats of my projects' jobs, every other read filtered to them", async () => {
    for (const query of [{ scope: "mine" }, { leader: "me" }]) {
      db.state.calls = [];
      db.state.handler = answer;
      const overview = await getProductionOverview(contextWith(["LEADER"]), ProductionOverviewQuerySchema.parse(query), now);
      expect(overview.leaderTabs).toEqual({ all: 5, mine: 2 });
      expect(overview.stats).toEqual({ total: 2, notStarted: 2, inProgress: 0, done: 0, overdue: 1 });
      const { groups, daily, volume, projects, due } = calls();
      expect(groups!.text).not.toContain(scopeFilter);
      for (const call of [daily!, volume!, projects!, ...due]) {
        expect(call.text).toContain(scopeFilter);
        expect(call.text).not.toContain("j.leader_id = $");
        expect(call.values).toContain(me);
      }
    }
    // scope=all: no filter.
    db.state.calls = [];
    await getProductionOverview(contextWith(["LEADER"]), ProductionOverviewQuerySchema.parse({ scope: "all" }), now);
    for (const call of queriesOverLines()) {
      expect(call.text).not.toContain(scopeFilter);
    }
  });

  it("tabs for holders of LEADER or ADMIN (PD-078); for anyone else none, and their scope=mine is a plain filter", async () => {
    db.state.handler = answer;
    for (const context of [contextWith(["ADMIN"]), contextWith([], { superadmin: true })]) {
      db.state.calls = [];
      const overview = await getProductionOverview(context, ProductionOverviewQuerySchema.parse({}), now);
      expect(overview.leaderTabs).toEqual({ all: 5, mine: 2 });
      expect(calls().groups!.text).toContain(`${ownedProject} AS led`);
    }
    for (const context of [contextWith(["STAFF"]), contextWith(["ACCOUNT"]), contextWith(["DIRECTOR"])]) {
      db.state.calls = [];
      const overview = await getProductionOverview(context, ProductionOverviewQuerySchema.parse({ scope: "mine" }), now);
      expect(overview.leaderTabs).toBeNull();
      const { groups } = calls();
      expect(groups!.text).toContain("false AS led");
      expect(groups!.text).toContain(scopeFilter);
    }
    db.state.calls = [];
    await getProductionOverview(contextWith(["STAFF"]), ProductionOverviewQuerySchema.parse({}), now);
    for (const call of queriesOverLines()) {
      expect(call.text).not.toContain(scopeFilter);
    }
  });

  it("follows the job list's view scope: 'own' = jobs with a line of mine or that I lead; 'none' = 403", async () => {
    // QC's default view scope is "own".
    await getProductionOverview(contextWith(["QC"]), ProductionOverviewQuerySchema.parse({}), now);
    for (const call of [...queriesOverLines(), calls().projects!]) {
      expect(call.text).toContain("(t.assignee_id = $ OR t.qc_id = $)");
    }
    db.state.calls = [];
    await getProductionOverview(contextWith(["STAFF"]), ProductionOverviewQuerySchema.parse({}), now);
    expect(calls().groups!.text).not.toContain("t.qc_id = $");

    clearProductionConfigCache();
    db.state.handler = (call) =>
      call.text.includes("FROM production.settings")
        ? [{ key: "job_permissions", value: { STAFF: { view: "none", create: "none", update: "own", delete: "none" } } }]
        : undefined;
    expect(await failure(getProductionOverview(contextWith(["STAFF"]), ProductionOverviewQuerySchema.parse({}), now))).toEqual({
      code: "FORBIDDEN",
      status: 403
    });
    // Not a production member at all: the module does not exist.
    expect(await failure(getProductionOverview(contextWith([]), ProductionOverviewQuerySchema.parse({}), now))).toEqual({
      code: "PRODUCTION_NOT_FOUND",
      status: 404
    });
  });

  it("hides test accounts' jobs and lines from a real viewer (PD-063), not from a test account", async () => {
    await getProductionOverview(contextWith(["LEADER"]), ProductionOverviewQuerySchema.parse({}), now);
    for (const call of queriesOverLines()) {
      expect(call.text).toContain(createdByTest);
      expect(call.text).toContain(assigneeTest);
    }
    expect(calls().projects!.text).toContain(createdByTest);
    db.state.calls = [];
    await getProductionOverview(contextWith(["LEADER"], { test: true }), ProductionOverviewQuerySchema.parse({}), now);
    for (const call of [...queriesOverLines(), calls().projects!]) {
      expect(call.text).not.toContain("is_test_account");
    }
  });

  it("a longer range: counted and charted over exactly its days; volume, progress and due lists mapped", async () => {
    db.state.handler = answer;
    const overview = ProductionOverviewSchema.parse(
      await getProductionOverview(contextWith(["ADMIN"]), ProductionOverviewQuerySchema.parse({ from: "2026-09-26", to: "2026-10-25" }), now)
    );
    expect(overview.daily.from).toBe("2026-09-26");
    expect(overview.daily.to).toBe("2026-10-25");
    expect(overview.daily.days).toHaveLength(30);
    // Up to today: 26 days of the period, compared with the 26 days before it.
    expect(overview.previous).toMatchObject({ from: "2026-08-31", to: "2026-09-25" });
    const { groups, volume, projects, due } = calls();
    expect(groups!.values).toEqual(expect.arrayContaining(["2026-08-31", "2026-10-25"]));
    // Volume: work rows (lines and their subtasks, not Checking), received in the range.
    expect(volume!.text).toContain("sum(t.qty_assigned) FILTER (WHERE t.kind = 'NORMAL' AND NOT pr.is_qc)");
    expect(volume!.text).not.toContain("AND NOT (t.kind = 'NORMAL' AND t.parent_task_id IS NOT NULL) AND");
    expect(volume!.values).toEqual(expect.arrayContaining(["2026-09-26", "2026-10-25"]));
    expect(overview.volume).toEqual({
      totalQty: 120,
      withoutQty: 3,
      slices: [{ project: { id: projectA, code: "AXP", name: "Dự án A" }, projectCount: 1, qty: 120, lines: 3 }]
    });
    // Progress: open jobs (not "đóng", live, not archived) of active projects; independent of the range.
    expect(projects!.text).toContain("NOT js.is_closed");
    expect(projects!.text).toContain("AND p.active");
    expect(projects!.text).toContain("j.archived_at IS NULL");
    expect(projects!.values).not.toContain("2026-09-26");
    expect(overview.projects).toEqual([
      { project: { id: projectA, code: "AXP", name: "Dự án A" }, openJobs: 3, lateJobs: 1, imagesTotal: 3000, imagesDone: 1240, imagesChecked: 800 }
    ]);
    // Due lists: today, then Monday – Sunday; open lines only, soonest first, at most 50.
    expect(due).toHaveLength(2);
    expect(due[0]!.values).toEqual(expect.arrayContaining(["2026-10-21"]));
    expect(due[1]!.values).toEqual(expect.arrayContaining(["2026-10-19", "2026-10-25"]));
    for (const call of due) {
      expect(call.text).toContain("AND NOT (t.status_id = ANY($::uuid[])");
      expect(call.text).toContain("t.deadline >= ");
      expect(call.text).toContain("ORDER BY t.deadline, t.number LIMIT $");
      expect(call.values).toContain(50);
    }
    expect(overview.dueToday).toMatchObject({ from: "2026-10-21", to: "2026-10-21", total: 12 });
    expect(overview.dueThisWeek).toMatchObject({ from: "2026-10-19", to: "2026-10-25", total: 12 });
    expect(overview.dueToday.items[0]).toEqual({
      id: taskId,
      code: "1286",
      jobId,
      jobCode: "Batch 07",
      project: { id: projectA, code: "AXP", name: "Dự án A" },
      process: { id: processId, name: "Normal Retouch" },
      assignee: { id: worker, displayName: "Nhân viên Một", email: null, avatarUrl: null },
      status: { id: statuses.PROCESSING.id, code: "PROCESSING", name: "Đang làm", color: "blue" },
      deadline: "2026-10-21T02:00:00.000Z",
      overdue: true,
      qtyAssigned: 40
    });
  });

  it("empty: zero counts, no slices, empty due lists", async () => {
    const overview = ProductionOverviewSchema.parse(
      await getProductionOverview(contextWith(["STAFF"]), ProductionOverviewQuerySchema.parse({ from: "2026-10-01", to: "2026-10-31" }), now)
    );
    expect(overview.stats).toEqual({ total: 0, notStarted: 0, inProgress: 0, done: 0, overdue: 0 });
    expect(overview.byStatus).toEqual([]);
    expect(overview.volume).toEqual({ totalQty: 0, withoutQty: 0, slices: [] });
    expect(overview.projects).toEqual([]);
    expect(overview.dueToday).toEqual({ from: "2026-10-21", to: "2026-10-21", total: 0, items: [] });
    expect(overview.daily.days.every((day) => day.received === 0 && day.done === 0)).toBe(true);
  });
});
