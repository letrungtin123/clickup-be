import type { Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProductionSettings } from "../../contracts/production-catalog.js";
import { ScoreBoardSchema } from "../../contracts/production-scores.js";
import type { AccessContext } from "../access/access-context.js";
import type * as CatalogModule from "./catalog.service.js";
import type * as ExcelModule from "./excel.js";
import { countWorkingDays, forecast, periodRange, settlePeriod } from "./scoring.js";

/**
 * PD-069 — "Bảng điểm → Toàn đội": GET /production/scores/board rows carry the person's KPI of the period (effective MONTH
 * target prorated by approved leave exactly like the forecast and the close) and whether they must have one (PD-066);
 * the export follows the tab's columns. No database: a fake tagged-template `sql` records every statement and answers
 * from a per-test handler (fake ids and names only — the repository is public).
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

const fixtures = vi.hoisted(() => {
  const state: { settings: Record<string, unknown> } = { settings: {} };
  return state;
});
const workbook = vi.hoisted(() => ({ send: vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()) }));

vi.mock("../../lib/redis.js", () => ({
  hasRedisConfig: () => false,
  getOptionalRedis: () => undefined,
  getRedis: () => {
    throw new Error("Redis is not available in this test");
  }
}));
vi.mock("../../db/client.js", () => ({ getSql: () => db.sql }));
vi.mock("./realtime.js", () => ({ publishProductionChange: vi.fn(), jobAudience: vi.fn(() => Promise.resolve([])) }));
vi.mock("./catalog.service.js", async (importOriginal) => {
  const { defaultFeaturePermissions } = await import("../../contracts/production-catalog.js");
  return {
    ...(await importOriginal<typeof CatalogModule>()),
    loadSettings: vi.fn(() =>
      Promise.resolve({
        kpiCloseDay: 25,
        kpiCloseDays: [{ fromPeriod: null, closeDay: 25 }],
        kpiProrateLeave: false,
        featurePermissions: defaultFeaturePermissions,
        ...fixtures.settings
      } as unknown as ProductionSettings)
    )
  };
});
vi.mock("./excel.js", async (importOriginal) => ({ ...(await importOriginal<typeof ExcelModule>()), sendWorkbook: workbook.send }));

const { getScoreBoard } = await import("./scores.service.js");
const { exportScoreBoard, noKpiLabel } = await import("./exports.service.js");

const org = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const director = "44444444-4444-4444-8444-444444444444";
const period = "2026-10";

const contextWith = (roles: string[], full = false) =>
  ({
    user: { id: me, displayName: "Người Xem" },
    organization: { id: org },
    hasFullOrganizationAuthority: full,
    productionRoles: roles,
    role: { permissions: [] }
  }) as unknown as AccessContext;

const boardRow = (userId: string, name: string, points: string, money: string) => ({
  user_id: userId,
  display_name: name,
  email: `${name.toLowerCase().replace(/\s/g, ".")}@example.test`,
  avatar_url: null,
  team_id: null,
  team_name: "Team Thử",
  points_official: points,
  points_khoan: "5",
  qty_khoan: 10,
  money,
  custom_values: null,
  tag_ids: null
});

/** Me: KPI 2600 since January and two days of approved leave; other: must have a KPI, has none; director: needs none. */
const handler = (call: Call): unknown[] | undefined => {
  if (call.text.includes("AS has_target")) {
    return [me, other].map((id) => ({ id, display_name: "x", email: null, avatar_url: null, team_id: null, team_name: null, roles: ["STAFF"], has_target: id === me }));
  }
  if (call.text.startsWith("WITH sums AS")) {
    return [boardRow(me, "Người Xem", "2550", "1000000"), boardRow(other, "Đồng Nghiệp", "2700.5", "30000"), boardRow(director, "Giám Đốc", "0", "0")];
  }
  if (call.text.includes("FROM production.kpi_targets WHERE")) {
    return [
      { user_id: me, period_type: "MONTH", target_points: "2600.00", effective_from: "2026-01" },
      // Starts after the period: not effective yet.
      { user_id: director, period_type: "MONTH", target_points: "1000.00", effective_from: "2026-11" }
    ];
  }
  if (call.text.includes("FROM production.leave_requests")) {
    // Thursday 01/10 and Friday 02/10 (full days), plus a half day on Saturday 03/10 → 2.5 working days.
    return [
      { user_id: me, from_date: "2026-10-01", to_date: "2026-10-02", part: "FULL_DAY" },
      { user_id: me, from_date: "2026-10-03", to_date: "2026-10-03", part: "MORNING" }
    ];
  }
  return undefined;
};

const callsOf = (fragment: string) => db.state.calls.filter((call) => call.text.includes(fragment));

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = handler;
  fixtures.settings = {};
  workbook.send.mockClear();
});

describe("PD-069 — board rows carry the KPI of the period", () => {
  it("KPI prorated by approved leave exactly like the close and the forecast; null without one; the PD-066 flag", async () => {
    fixtures.settings = { kpiProrateLeave: true };
    const board = ScoreBoardSchema.parse(await getScoreBoard(contextWith(["STAFF"]), { period }));
    const byId = new Map(board.items.map((item) => [item.user.id, item]));

    const { from, to } = periodRange(period, 25);
    const targets = [{ periodType: "MONTH" as const, targetPoints: 2600, effectiveFrom: "2026-01" }];
    const settled = settlePeriod({
      period,
      closeDay: 25,
      prorateLeave: true,
      users: [{ userId: me, targets, pointsOfficial: 2550, khoanCredits: 0, khoanMoneyRaw: 0, leaveDays: 2.5 }]
    }).items[0]!;
    const forecasted = forecast({ target: 2600, pointsOfficial: 2550, period, closeDay: 25, today: from, prorateLeave: true, leaveDays: 2.5 });
    expect(settled.target).toBeLessThan(2600);
    expect(byId.get(me)).toMatchObject({ kpiTarget: settled.target, kpiRequired: true });
    expect(forecasted.target).toBe(settled.target);
    expect(settled.target).toBe(Math.round(((2600 * (countWorkingDays(from, to) - 2.5)) / countWorkingDays(from, to)) * 100) / 100);

    expect(byId.get(other)).toMatchObject({ kpiTarget: null, kpiRequired: true });
    expect(byId.get(director)).toMatchObject({ kpiTarget: null, kpiRequired: false });
    // Still by official points, highest first; the old fields stay for older builds.
    expect(board.items.map((item) => [item.user.id, item.rank])).toEqual([
      [other, 1],
      [me, 2],
      [director, 3]
    ]);
  });

  it("no proration while the setting is off (and the leave is not even read)", async () => {
    const board = await getScoreBoard(contextWith(["STAFF"]), { period });
    expect(board.items.find((item) => item.user.id === me)?.kpiTarget).toBe(2600);
    expect(callsOf("FROM production.leave_requests")).toHaveLength(0);
  });

  it("a fixed number of queries for any number of people (no N+1); people who must have a KPI are on the board", async () => {
    fixtures.settings = { kpiProrateLeave: true };
    await getScoreBoard(contextWith(["STAFF"]), { period });
    expect(callsOf("FROM production.kpi_targets WHERE")).toHaveLength(1);
    expect(callsOf("FROM production.leave_requests")).toHaveLength(1);
    expect(callsOf("AS has_target")).toHaveLength(1);
    const targets = callsOf("FROM production.kpi_targets WHERE")[0]!;
    expect(targets.values).toContainEqual([other, me, director]);
    // The required members (PD-066: never test accounts) join the board's people; real viewers never see test accounts.
    expect(callsOf("AS has_target")[0]!.text).toContain("NOT au.is_test_account");
    const select = callsOf("WITH sums AS")[0]!;
    expect(select.text).toContain("SELECT unnest($::uuid[])");
    expect(select.values).toContainEqual([me, other]);
    expect(select.text).toContain("AND NOT au.is_test_account");
  });

  it("still needs “Xem điểm người khác” (PD-065): nothing is read without it", async () => {
    const { defaultFeaturePermissions } = await import("../../contracts/production-catalog.js");
    fixtures.settings = { featurePermissions: { ...defaultFeaturePermissions, view_others_scores: ["ADMIN"] } };
    await expect(getScoreBoard(contextWith(["STAFF"]), { period })).rejects.toMatchObject({ code: "SCORES_PRIVATE", statusCode: 403 });
    expect(db.state.calls).toHaveLength(0);
  });
});

describe("PD-069 — the board export follows the Toàn đội tab", () => {
  type Sheet = { name: string; columns: { header: string; key: string }[]; rows: Record<string, unknown>[] };
  const exported = async (context: AccessContext) => {
    await exportScoreBoard(context, {} as Response, { period });
    const [, filename, sheets] = workbook.send.mock.calls[0] as unknown as [Response, string, Sheet[]];
    return { filename, sheet: sheets[0]!, info: Object.fromEntries(sheets[1]!.rows.map((row) => [String(row.item), row.value] as const)) };
  };

  it("Họ tên, Team, Điểm chính thức, KPI, % đạt — no rank, no Khoán points, no money for a viewer without view_others_money", async () => {
    const { filename, sheet, info } = await exported(contextWith(["STAFF"]));
    expect(filename).toMatch(/^Điểm toàn đội kỳ 2026-10 /);
    expect(sheet.columns.map((column) => column.header)).toEqual(["Họ tên", "Team", "Điểm chính thức", "KPI", "% đạt"]);
    expect(sheet.rows).toEqual([
      { name: "Đồng Nghiệp", team: "Team Thử", pointsOfficial: 2700.5, kpi: noKpiLabel, percent: null },
      { name: "Người Xem", team: "Team Thử", pointsOfficial: 2550, kpi: 2600, percent: 0.9808 },
      { name: "Giám Đốc", team: "Team Thử", pointsOfficial: 0, kpi: null, percent: null }
    ]);
    // Even the viewer's own money stays out: no money column at all.
    expect(JSON.stringify(sheet.rows)).not.toContain("1000000");
    expect(info).toMatchObject({ "Số người": 3, "Tổng điểm chính thức": 5250.5, "Đạt KPI": 0, "Chưa có KPI": 1 });
  });

  it("Tiền Khoán for whoever sees everyone's money (Director by default, the superadmin)", async () => {
    const { sheet } = await exported(contextWith(["DIRECTOR"]));
    expect(sheet.columns.map((column) => column.header)).toEqual(["Họ tên", "Team", "Điểm chính thức", "KPI", "% đạt", "Tiền Khoán (VND)"]);
    expect(sheet.rows.map((row) => row.money)).toEqual([30000, 1000000, 0]);
    workbook.send.mockClear();
    expect((await exported(contextWith([], true))).sheet.columns.at(-1)?.header).toBe("Tiền Khoán (VND)");
  });
});
