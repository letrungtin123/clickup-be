import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProductionSettings } from "../../contracts/production-catalog.js";
import { ProductionMeSchema } from "../../contracts/production-catalog.js";
import {
  KpiSettlementListSchema,
  KpiSettlementRunCollectionSchema,
  KpiTargetsMissingDetailsSchema,
  KpiTargetsMissingSchema,
  ScoreForecastSchema,
  UserScoreForecastSchema
} from "../../contracts/production-scores.js";
import type { AccessContext } from "../access/access-context.js";
import type * as CatalogModule from "./catalog.service.js";
import type * as LeaveModule from "./leave.service.js";
import { businessDay } from "./time.js";

/**
 * PD-066 — Khoán is money only, the close tops a KPI shortfall up from the Khoán work (TOP_UP), money is the owner's or
 * `view_others_money`'s (moneyPublic retired), and KPI is mandatory: a settlement is refused (409 KPI_TARGETS_MISSING,
 * nothing written) while someone who must have a KPI has none. No database: a fake tagged-template `sql` records every
 * statement and answers from a per-test handler (fake ids and names only).
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
  const sql = (strings: TemplateStringsArray | string | unknown[], ...values: unknown[]) => {
    if (typeof strings === "string") {
      return { isFragment: true as const, text: `"${strings}"`, values: [] as unknown[] };
    }
    if (!("raw" in strings)) {
      // sql(rows): a bulk INSERT helper — one placeholder carrying the rows.
      return { isFragment: true as const, text: "$rows", values: [strings] as unknown[] };
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

vi.mock("../../lib/redis.js", () => ({
  hasRedisConfig: () => false,
  getOptionalRedis: () => undefined,
  getRedis: () => {
    throw new Error("Redis is not available in this test");
  }
}));
vi.mock("../../db/client.js", () => ({ getSql: () => db.sql }));
vi.mock("../events/outbox.js", () => ({ enqueueDomainEvents: vi.fn(() => Promise.resolve()) }));
vi.mock("./realtime.js", () => ({ publishProductionChange: vi.fn(), jobAudience: vi.fn(() => Promise.resolve([])) }));
vi.mock("./leave.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof LeaveModule>()),
  approvedLeaveDaysByUser: vi.fn((_sql: unknown, _org: string, userIds: string[]) => Promise.resolve(new Map(userIds.map((id) => [id, 0]))))
}));
vi.mock("./catalog.service.js", async (importOriginal) => {
  const { defaultFeaturePermissions, defaultJobPermissions } = await import("../../contracts/production-catalog.js");
  return {
    ...(await importOriginal<typeof CatalogModule>()),
    loadSettings: vi.fn(() =>
      Promise.resolve({
        kpiCloseDay: 25,
        kpiCloseDays: [{ fromPeriod: null, closeDay: 25 }],
        kpiProrateLeave: false,
        scoresPublic: true,
        chatAttachmentsEnabled: true,
        timezone: "Asia/Ho_Chi_Minh",
        jobPermissions: defaultJobPermissions,
        featurePermissions: defaultFeaturePermissions,
        ...fixtures.settings
      } as ProductionSettings)
    )
  };
});

const { runKpiSettlement, listKpiSettlements, listKpiSettlementRuns } = await import("./kpi-settlement.service.js");
const { getMissingKpiTargets } = await import("./kpi-targets.service.js");
const { getScoreForecast, getUserScoreForecast } = await import("./scores.service.js");
const { getProductionMe } = await import("./catalog.service.js");
const { runKpiSettlementTick } = await import("./kpi-settlement-scheduler.js");

const org = "11111111-1111-4111-8111-111111111111";
const org2 = "12121212-1212-4212-8212-121212121212";
const me = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const third = "44444444-4444-4444-8444-444444444444";
const runId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const settlementId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const contextWith = (roles: string[], full = false, userId = me, organizationId = org) =>
  ({
    user: { id: userId },
    organization: { id: organizationId },
    hasFullOrganizationAuthority: full,
    productionRoles: roles,
    role: { permissions: [] }
  }) as unknown as AccessContext;

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    const appError = error as { code?: string; statusCode?: number; message?: string; details?: unknown };
    return { code: appError.code, status: appError.statusCode, message: appError.message, details: appError.details };
  }
  return null;
};

const matrix = async (overrides: Record<string, string[]>) => {
  const { defaultFeaturePermissions } = await import("../../contracts/production-catalog.js");
  return { ...defaultFeaturePermissions, ...overrides };
};

const person = (id: string, name: string, hasTarget: boolean, roles = ["STAFF"]) => ({
  id,
  display_name: name,
  email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.test`,
  avatar_url: null,
  team_id: null,
  team_name: null,
  roles,
  has_target: hasTarget
});

const isRequiredQuery = (call: Call) => call.text.includes("AS has_target");
const writes = () => db.state.calls.filter((call) => /^(INSERT|UPDATE|DELETE)\b/.test(call.text));

const runRow = {
  id: runId,
  period: "2026-09",
  period_from: "2026-08-26",
  period_to: "2026-09-25",
  close_day: 25,
  trigger: "MANUAL",
  run_by: null,
  reason: "Chốt thử",
  prorate_leave: false,
  khoan_policy: "TOP_UP",
  user_count: 2,
  met_count: 1,
  not_met_count: 1,
  khoan_money_total: "750000",
  khoan_points_converted_total: "80",
  replaced_count: 0,
  started_at: new Date("2026-10-19T03:00:00Z"),
  finished_at: new Date("2026-10-19T03:00:01Z"),
  current: true
};

const settlementRow = (userId: string, overrides: Record<string, unknown> = {}) => ({
  settlement_id: settlementId,
  id: userId,
  display_name: "Nhân viên Ví Dụ",
  email: "vi.du@example.test",
  avatar_url: null,
  period: "2026-09",
  period_from: "2026-08-26",
  period_to: "2026-09-25",
  target_base: "2600",
  target_points: "2600",
  prorate_leave: false,
  working_days: 26,
  leave_days: "0",
  points_official: "2550",
  shortfall_points: "50",
  met: true,
  khoan_credits: "200",
  khoan_money_raw: "1000000",
  khoan_money: "750000",
  khoan_points_converted: "50",
  total_points: "2600",
  khoan_policy: "TOP_UP",
  run_id: runId,
  run_at: new Date("2026-10-19T03:00:01Z"),
  note: null,
  ...overrides
});

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = () => [];
  fixtures.settings = {};
});

describe("PD-066 — KPI is mandatory before a settlement", () => {
  it("a run with people missing a KPI → 409 KPI_TARGETS_MISSING with who, and nothing is written", async () => {
    db.state.handler = (call) =>
      isRequiredQuery(call) ? [person(me, "An Bình", true), person(other, "Chi Dũng", false), person(third, "Em Giang", false, ["ADMIN"])] : undefined;
    const result = await failure(runKpiSettlement(contextWith([], true), { period: "2026-09", reason: "Chốt kỳ 09" }));
    expect(result).toMatchObject({
      code: "KPI_TARGETS_MISSING",
      status: 409,
      message: "Còn 2 người chưa có KPI kỳ này — set KPI trước khi chốt."
    });
    expect(KpiTargetsMissingDetailsSchema.parse(result!.details)).toEqual({
      users: [
        { id: other, displayName: "Chi Dũng" },
        { id: third, displayName: "Em Giang" }
      ]
    });
    expect(writes()).toEqual([]);
    expect(db.state.calls.some((call) => call.text.includes("production.score_entries"))).toBe(false);
  });

  it("who must have a KPI: active members holding ADMIN / ACCOUNT / LEADER / QC / STAFF — never the superadmin or a QA test account", async () => {
    db.state.handler = (call) => (isRequiredQuery(call) ? [] : undefined);
    await getMissingKpiTargets(contextWith(["ADMIN"]), { period: "2026-10" });
    const query = db.state.calls.find(isRequiredQuery)!;
    expect(query.text).toContain("om.deleted_at IS NULL AND om.status = 'active'");
    expect(query.text).toContain("NOT au.is_test_account");
    expect(query.text).toContain("NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.id = om.role_id AND r.key = 'superadmin')");
    expect(query.text).toContain("k.period_type = 'MONTH'");
    // DIRECTOR is not in the list: a Director-only member needs no KPI.
    expect(query.values).toContainEqual(["ADMIN", "ACCOUNT", "LEADER", "QC", "STAFF"]);
    expect(query.values).toContain("2026-10-01");
  });

  it("GET /production/kpi-targets/missing lists the people without a KPI (ADMIN); others 403", async () => {
    db.state.handler = (call) =>
      isRequiredQuery(call) ? [person(me, "An Bình", true), person(other, "Chi Dũng", false, ["QC", "STAFF"])] : undefined;
    const missing = KpiTargetsMissingSchema.parse(await getMissingKpiTargets(contextWith(["ADMIN"]), { period: "2026-10" }));
    expect(missing).toEqual({
      period: "2026-10",
      requiredCount: 2,
      items: [
        {
          user: { id: other, displayName: "Chi Dũng", email: "chi.dũng@example.test", avatarUrl: null },
          teamId: null,
          teamName: null,
          roles: ["QC", "STAFF"]
        }
      ]
    });
    expect(await failure(getMissingKpiTargets(contextWith(["STAFF", "LEADER"]), {}))).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(await failure(getMissingKpiTargets(contextWith([]), {}))).toMatchObject({ code: "PRODUCTION_NOT_FOUND", status: 404 });
    // Default period: the current one.
    db.state.calls = [];
    const current = await getMissingKpiTargets(contextWith(["ADMIN"]), {});
    expect(current.period).toMatch(/^\d{4}-\d{2}$/);
    expect(db.state.calls.find(isRequiredQuery)!.values).toContain(`${current.period}-01`);
  });

  it("everyone has a KPI → the run settles with TOP_UP and stores the shortfall", async () => {
    db.state.handler = (call) => {
      if (isRequiredQuery(call)) return [person(me, "An Bình", true), person(other, "Chi Dũng", true)];
      if (call.text.includes("FROM production.score_entries") && call.text.includes("GROUP BY user_id")) {
        return [
          { user_id: me, official: "2550", khoan: "200", money: "1000000" },
          { user_id: other, official: "2000", khoan: "30", money: "300000" }
        ];
      }
      if (call.text.includes("SELECT DISTINCT k.user_id FROM production.kpi_targets k")) return [{ user_id: me }, { user_id: other }];
      if (call.text.includes("FROM production.kpi_targets") && call.text.includes("period_type = ANY")) {
        return [
          { user_id: me, period_type: "MONTH", target_points: "2600", effective_from: "2026-01" },
          { user_id: other, period_type: "MONTH", target_points: "2600", effective_from: "2026-01" }
        ];
      }
      if (call.text.startsWith("INSERT INTO production.kpi_settlement_runs")) return [{ id: runId }];
      if (call.text.includes("FROM production.kpi_settlement_runs r")) return [runRow];
      if (call.text.includes("FROM production.kpi_settlements ks")) return [settlementRow(me), settlementRow(other, { met: false, shortfall_points: "600" })];
      return undefined;
    };
    const result = await runKpiSettlement(contextWith([], true), { period: "2026-09", reason: "Chốt kỳ 09" });
    const runInsert = db.state.calls.find((call) => call.text.startsWith("INSERT INTO production.kpi_settlement_runs"))!;
    expect(runInsert.values).toContain("TOP_UP");
    const rowsInsert = db.state.calls.find((call) => call.text.startsWith("INSERT INTO production.kpi_settlements"))!;
    const rows = rowsInsert.values[0] as Record<string, unknown>[];
    expect(rows.map((row) => [row.user_id, row.points_official, row.shortfall_points, row.khoan_points_converted, row.khoan_money_raw, row.khoan_money, row.met])).toEqual([
      // 50 short of 2600, 200 Khoán points worth 1 000 000 → 50 converted, 150/200 paid.
      [me, 2550, 50, 50, 1_000_000, 750_000, true],
      // 600 short, only 30 Khoán points → all 30 converted, nothing paid, not met.
      [other, 2000, 600, 30, 300_000, 0, false]
    ]);
    expect(result.run).toMatchObject({ khoanPolicy: "TOP_UP", khoanMoneyTotal: 750000 });
    expect(result.items[0]).toMatchObject({ shortfall: 50, khoanPointsConverted: 50, khoanMoneyEarned: 1_000_000, khoanMoneyPaid: 750_000, met: true });
  });
});

describe("PD-066 — the automatic close waits for the missing KPIs", () => {
  it("a blocked organization is skipped (nothing written, no error); the next one still settles", async () => {
    // 2026-09 closed at 23:59 on 25/09 (VN): an hour later the scheduler settles it.
    const now = new Date("2026-09-25T18:00:00Z");
    db.state.handler = (call) => {
      if (call.text.includes("FROM public.organizations o")) return [{ id: org }, { id: org2 }];
      if (call.text.includes("pg_try_advisory_xact_lock")) return [{ locked: true }];
      if (call.text.includes("AS exists")) return [{ exists: false }];
      if (isRequiredQuery(call)) return call.values[1] === org ? [person(other, "Chi Dũng", false)] : [];
      if (call.text.startsWith("INSERT INTO production.kpi_settlement_runs")) return [{ id: runId }];
      return undefined;
    };
    await expect(runKpiSettlementTick(now)).resolves.toBeUndefined();
    const runInserts = db.state.calls.filter((call) => call.text.startsWith("INSERT INTO production.kpi_settlement_runs"));
    expect(runInserts).toHaveLength(1);
    expect(runInserts[0]!.values[0]).toBe(org2);
  });
});

describe("PD-066 — Khoán money: one's own, or view_others_money; moneyPublic opens nothing", () => {
  const settlementQueries = (call: Call) => {
    if (call.text.includes("FROM public.organization_memberships om JOIN public.app_users au")) {
      return [{ id: call.values[1], display_name: "Nhân viên Ví Dụ", email: "vi.du@example.test", avatar_url: null, team_id: null, team_name: null }];
    }
    if (call.text.includes("FROM production.kpi_settlements ks")) return [settlementRow(call.values.flat().includes(me) ? me : other)];
    if (call.text.includes("FROM production.kpi_settlement_runs r")) return [runRow];
    return undefined;
  };
  const moneyOf = async (context: AccessContext, userId: string) => {
    const list = KpiSettlementListSchema.parse(await listKpiSettlements(context, { period: "2026-09", userId }));
    return [list.items[0]?.khoanMoneyEarned, list.items[0]?.khoanMoneyPaid];
  };

  it("self, Admin, Director and the superadmin see it; another staff member does not — even with moneyPublic stored on", async () => {
    fixtures.settings = { moneyPublic: true };
    db.state.handler = settlementQueries;
    expect(await moneyOf(contextWith(["STAFF"]), me)).toEqual([1_000_000, 750_000]);
    expect(await moneyOf(contextWith(["ADMIN"]), other)).toEqual([1_000_000, 750_000]);
    expect(await moneyOf(contextWith(["DIRECTOR"]), other)).toEqual([1_000_000, 750_000]);
    expect(await moneyOf(contextWith([], true), other)).toEqual([1_000_000, 750_000]);
    expect(await moneyOf(contextWith(["STAFF", "LEADER", "QC", "ACCOUNT"]), other)).toEqual([null, null]);
  });

  it("run money totals need view_others_money too", async () => {
    db.state.handler = settlementQueries;
    expect(KpiSettlementRunCollectionSchema.parse(await listKpiSettlementRuns(contextWith(["ADMIN"]), { limit: 10 })).items[0]?.khoanMoneyTotal).toBe(750000);
    fixtures.settings = { featurePermissions: await matrix({ view_others_money: ["DIRECTOR"] }) };
    expect((await listKpiSettlementRuns(contextWith(["ADMIN"]), { limit: 10 })).items[0]?.khoanMoneyTotal).toBeNull();
    expect((await listKpiSettlements(contextWith(["ADMIN"]), { period: "2026-09" })).run?.khoanMoneyTotal).toBeNull();
  });

  it("/production/me still carries the retired fields for older app builds, fixed: IF_KPI and moneyPublic false", async () => {
    fixtures.settings = { moneyPublic: true, khoanPayPolicy: "ALWAYS" };
    const meInfo = ProductionMeSchema.parse(await getProductionMe(contextWith(["STAFF"])));
    expect(meInfo.settings).toMatchObject({ khoanPayPolicy: "IF_KPI", moneyPublic: false });
  });
});

describe("PD-066 — forecast: “Nếu chốt hôm nay” and the missing-KPI warning", () => {
  const today = businessDay(new Date());
  const forecastQueries =
    (options: { required: boolean; target: string | null }) =>
    (call: Call): unknown[] | undefined => {
      // The KPI requirement first: its query also reads organization_memberships / app_users.
      if (isRequiredQuery(call)) return options.required ? [person(String(call.values[3]), "Nhân viên", options.target !== null)] : [];
      if (call.text.includes("FROM public.organization_memberships om JOIN public.app_users au")) {
        return [{ id: call.values[1], display_name: "Nhân viên Ví Dụ", email: "vi.du@example.test", avatar_url: null, team_id: null, team_name: null }];
      }
      if (call.text.includes("GROUP BY business_day, pay_mode")) {
        return [
          { business_day: today, pay_mode: "POINTS", credits: "2550", money: "0" },
          { business_day: today, pay_mode: "MONEY_IF_KPI", credits: "200", money: "1000000" }
        ];
      }
      if (call.text.includes("FROM production.kpi_targets WHERE organization_id = $ AND user_id = $")) {
        return options.target === null ? [] : [{ period_type: "MONTH", target_points: options.target, effective_from: "2000-01" }];
      }
      return undefined;
    };

  it("own forecast: tops up 50 points from Khoán and pays 750 000 if settled today", async () => {
    db.state.handler = forecastQueries({ required: true, target: "2600" });
    const result = ScoreForecastSchema.parse(await getScoreForecast(contextWith(["STAFF"]), {}));
    expect(result).toMatchObject({ kpiRequired: true, target: 2600, pointsOfficial: 2550, moneyKhoanProvisional: 1_000_000 });
    expect(result.ifSettledToday).toEqual({ shortfall: 50, khoanPointsConverted: 50, khoanMoneyEarned: 1_000_000, khoanMoneyPaid: 750_000, met: true });
  });

  it("someone who must have a KPI and has none: kpiRequired with no target; nobody else's money", async () => {
    db.state.handler = forecastQueries({ required: true, target: null });
    const own = await getScoreForecast(contextWith(["STAFF"]), {});
    expect([own.kpiRequired, own.targetBase, own.tone]).toEqual([true, null, "NO_TARGET"]);
    expect(own.ifSettledToday).toMatchObject({ shortfall: 0, khoanMoneyPaid: 1_000_000, met: true });
    const seen = UserScoreForecastSchema.parse(await getUserScoreForecast(contextWith(["STAFF"]), other, {}));
    expect([seen.kpiRequired, seen.moneyKhoanProvisional, seen.ifSettledToday]).toEqual([true, null, null]);
    // A superadmin or a Director-only member needs no KPI.
    db.state.handler = forecastQueries({ required: false, target: null });
    expect((await getScoreForecast(contextWith(["DIRECTOR"]), {})).kpiRequired).toBe(false);
  });
});

describe("PD-066 — the KPI_SETTLED notification tells the person their top-up and Khoán money", () => {
  it("words the result", async () => {
    const { kpiResultBody } = await import("./kpi-settlement-notifications.js");
    const words = (text: string) => text.replace(/\s/g, " ");
    expect(words(kpiResultBody({ met: true, total: 2600, target: 2600, converted: 50, earned: 1_000_000, paid: 750_000 }))).toBe(
      "Đạt KPI: 2.600 / 2.600 điểm (bù 50 điểm từ Khoán) · Tiền Khoán nhận 750.000đ"
    );
    expect(words(kpiResultBody({ met: false, total: 2030, target: 2600, converted: 30, earned: 300_000, paid: 0 }))).toBe(
      "Chưa đạt KPI: 2.030 / 2.600 điểm (bù 30 điểm từ Khoán) · Tiền Khoán nhận 0đ"
    );
    expect(kpiResultBody({ met: true, total: 120, target: null, converted: 0, earned: 0, paid: 0 })).toBe("Đạt KPI: 120 điểm");
  });
});
