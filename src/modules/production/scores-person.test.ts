import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProductionSettings } from "../../contracts/production-catalog.js";
import { ScoreBoardSchema, UserScoreForecastSchema, UserScoresSchema } from "../../contracts/production-scores.js";
import type { AccessContext } from "../access/access-context.js";
import type * as CatalogModule from "./catalog.service.js";
import type * as NotificationsModule from "./notifications.js";

/**
 * PD-052 — "Điểm cá nhân" for everyone: the ranking is open to every production member whatever
 * settings.scoresPublic says, and GET /production/scores/user/:userId (+ /forecast, KPI `userId`) shows any active
 * production member's scores with money only for the owner, ADMIN, or settings.moneyPublic. No database: a fake
 * tagged-template `sql` records every statement and answers from a per-test handler (fake ids only).
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

vi.mock("../../lib/redis.js", () => ({
  hasRedisConfig: () => false,
  getOptionalRedis: () => undefined,
  getRedis: () => {
    throw new Error("Redis is not available in this test");
  }
}));
vi.mock("../../db/client.js", () => ({ getSql: () => db.sql }));
vi.mock("./realtime.js", () => ({ publishProductionChange: vi.fn(), jobAudience: vi.fn(() => Promise.resolve([])) }));
vi.mock("./notifications.js", async (importOriginal) => ({
  ...(await importOriginal<typeof NotificationsModule>()),
  enqueueProductionEvents: vi.fn(() => Promise.resolve())
}));
vi.mock("./catalog.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof CatalogModule>()),
  loadSettings: vi.fn(() => Promise.resolve({ kpiCloseDay: 25, kpiProrateLeave: false, ...fixtures.settings } as ProductionSettings))
}));

const { getScoreBoard, getUserScoreForecast, getUserScores } = await import("./scores.service.js");
const { getKpiReport, listKpiSettlements } = await import("./kpi-settlement.service.js");

const org = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const stranger = "44444444-4444-4444-8444-444444444444";
const projectId = "55555555-5555-4555-8555-555555555555";
const ids = {
  entry: "66666666-6666-4666-8666-666666666666",
  task: "77777777-7777-4777-8777-777777777777",
  job: "88888888-8888-4888-8888-888888888888",
  shift: "99999999-9999-4999-8999-999999999999",
  process: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  team: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  settlement: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  run: "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
};

const contextWith = (roles: string[], full = false, userId = me) =>
  ({
    user: { id: userId },
    organization: { id: org },
    hasFullOrganizationAuthority: full,
    productionRoles: roles,
    role: { permissions: [] }
  }) as unknown as AccessContext;

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return { code: (error as { code?: string }).code, status: (error as { statusCode?: number }).statusCode };
  }
  return null;
};

const today = new Date().toISOString().slice(0, 10);
const subjectRow = (id: string) => ({
  id,
  display_name: "Nhân viên Ví Dụ",
  email: "vi.du@example.test",
  avatar_url: null,
  team_id: ids.team,
  team_name: "Team A"
});
const sumRow = { business_day: today, role: "WORKER", pay_mode: "MONEY_IF_KPI", credits: "12.50", money: "150000", qty: 25, project_id: projectId, project_code: "PRJ" };
const entryRow = {
  id: ids.entry,
  cursor_at: "2026-10-15 03:00:00.000000+00",
  role: "WORKER",
  task_id: ids.task,
  task_number: "1237",
  task_parent_number: "1237",
  task_sub_seq: 1,
  job_id: ids.job,
  job_code: "JOB-1",
  project_id: projectId,
  project_code: "PRJ",
  process_id: ids.process,
  process_name: "Retouch",
  shift_id: ids.shift,
  shift_name: "Ca Khoán",
  pay_mode: "MONEY_IF_KPI",
  kind: "NORMAL",
  qty: 25,
  unit_credits: "0.50",
  credits: "12.50",
  money: "150000",
  credit_rule_id: null,
  business_day: today,
  period: today.slice(0, 7),
  adjusts_entry_id: null,
  note: null,
  created_at: new Date()
};

/** Answers the subject lookup with `members` (active production members) and the score queries with one Khoán entry. */
const scoreQueries =
  (members: string[]) =>
  (call: Call): unknown[] | undefined => {
    if (call.text.includes("FROM public.organization_memberships om JOIN public.app_users au")) {
      const userId = call.values[1] as string;
      return members.includes(userId) ? [subjectRow(userId)] : [];
    }
    if (call.text.includes("ORDER BY created_at DESC, id DESC")) return [entryRow];
    if (call.text.includes("sum(e.credits) AS credits")) return [sumRow];
    if (call.text.includes("GROUP BY business_day, pay_mode")) return [{ business_day: today, pay_mode: "MONEY_IF_KPI", credits: "12.50", money: "150000" }];
    return undefined;
  };

const touchedScores = () => db.state.calls.some((call) => call.text.includes("production.score_entries"));

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = () => [];
  fixtures.settings = { scoresPublic: false, moneyPublic: false };
});

describe("PD-052 — the ranking is open to every production member", () => {
  const boardRows = [
    { user_id: me, display_name: "Tôi", email: "me@example.test", avatar_url: null, team_id: null, team_name: null, points_official: "10", points_khoan: "2", qty_khoan: 4, money: "50000", custom_values: null, tag_ids: null },
    { user_id: other, display_name: "Đồng nghiệp", email: "other@example.test", avatar_url: null, team_id: null, team_name: null, points_official: "20", points_khoan: "1", qty_khoan: 2, money: "30000", custom_values: null, tag_ids: null }
  ];

  it("staff see the board with scoresPublic off; others' money stays hidden", async () => {
    db.state.handler = (call) => (call.text.startsWith("WITH sums AS") ? boardRows : undefined);
    const board = ScoreBoardSchema.parse(await getScoreBoard(contextWith(["STAFF", "QC"]), {}));
    expect(board.moneyVisible).toBe(false);
    expect(board.items.map((item) => [item.user.id, item.rank, item.money])).toEqual([
      [other, 1, null],
      [me, 2, 50000]
    ]);
    // Colleagues' e-mails are not part of the board.
    expect(board.items.find((item) => item.user.id === other)?.user.email).toBeNull();
  });

  it("money of everyone with moneyPublic on; the tag / custom-field filters stay Admin only", async () => {
    fixtures.settings = { scoresPublic: false, moneyPublic: true };
    db.state.handler = (call) => (call.text.startsWith("WITH sums AS") ? boardRows : undefined);
    const board = await getScoreBoard(contextWith(["LEADER"]), {});
    expect(board.items.map((item) => item.money)).toEqual([30000, 50000]);
    expect(await failure(getScoreBoard(contextWith(["STAFF"]), { tagId: [ids.team] }))).toEqual({ code: "CUSTOM_FIELDS_FORBIDDEN", status: 403 });
  });

  it("non-members still get 404", async () => {
    expect(await failure(getScoreBoard(contextWith([]), {}))).toEqual({ code: "PRODUCTION_NOT_FOUND", status: 404 });
  });
});

describe("PD-052 — GET /production/scores/user/:userId", () => {
  it("another member's scores for a staff member: same content as /scores/me, money hidden", async () => {
    db.state.handler = scoreQueries([me, other]);
    const result = UserScoresSchema.parse(await getUserScores(contextWith(["STAFF"]), other, {}));
    expect(result.user).toEqual({ id: other, displayName: "Nhân viên Ví Dụ", email: null, avatarUrl: null });
    expect(result.teamName).toBe("Team A");
    expect(result.moneyVisible).toBe(false);
    expect(result.summary.pointsKhoan).toBe(12.5);
    expect(result.summary.moneyKhoanProvisional).toBeNull();
    expect(result.cards.period.moneyKhoanProvisional).toBeNull();
    expect(result.cards.today.qtyKhoan).toBe(25);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ credits: 12.5, money: null, task: { code: "1237a" } });
    // Every score query reads the subject's rows, not the caller's.
    const scoreCalls = db.state.calls.filter((call) => call.text.includes("production.score_entries"));
    expect(scoreCalls.length).toBeGreaterThan(0);
    for (const call of scoreCalls) {
      expect(call.values).toContain(other);
      expect(call.values).not.toContain(me);
    }
  });

  it("money shows with moneyPublic on, for an Admin, and for oneself", async () => {
    db.state.handler = scoreQueries([me, other]);
    fixtures.settings = { scoresPublic: false, moneyPublic: true };
    const shared = await getUserScores(contextWith(["STAFF"]), other, {});
    expect([shared.moneyVisible, shared.summary.moneyKhoanProvisional, shared.entries[0]?.money]).toEqual([true, 150000, 150000]);

    fixtures.settings = { scoresPublic: false, moneyPublic: false };
    const admin = await getUserScores(contextWith(["ADMIN"]), other, {});
    expect([admin.moneyVisible, admin.cards.week.moneyKhoanProvisional, admin.user.email]).toEqual([true, 150000, "vi.du@example.test"]);
    const superadmin = await getUserScores(contextWith([], true), other, {});
    expect(superadmin.moneyVisible).toBe(true);

    const own = await getUserScores(contextWith(["STAFF"]), me, {});
    expect([own.moneyVisible, own.summary.moneyKhoanProvisional, own.user.email]).toEqual([true, 150000, "vi.du@example.test"]);
  });

  it("404 SCORE_USER_NOT_FOUND for someone who is not an active production member; nothing scored is read", async () => {
    db.state.handler = scoreQueries([me, other]);
    expect(await failure(getUserScores(contextWith(["STAFF"]), stranger, {}))).toEqual({ code: "SCORE_USER_NOT_FOUND", status: 404 });
    expect(touchedScores()).toBe(false);
    const lookup = db.state.calls.find((call) => call.text.includes("FROM public.organization_memberships om"))!;
    expect(lookup.text).toContain("om.deleted_at IS NULL AND om.status = 'active'");
    expect(lookup.text).toContain("production.user_roles");
    expect(lookup.values).toEqual([org, stranger]);
  });

  it("callers outside Photo Retouch get 404 before anything is read", async () => {
    db.state.handler = scoreQueries([me, other]);
    expect(await failure(getUserScores(contextWith([]), other, {}))).toEqual({ code: "PRODUCTION_NOT_FOUND", status: 404 });
    expect(db.state.calls).toHaveLength(0);
  });

  it("the forecast of another member hides the Khoán money by the same rule", async () => {
    db.state.handler = scoreQueries([me, other]);
    const hidden = UserScoreForecastSchema.parse(await getUserScoreForecast(contextWith(["QC"]), other, {}));
    expect(hidden.pointsKhoan).toBe(12.5);
    expect(hidden.moneyKhoanProvisional).toBeNull();
    fixtures.settings = { scoresPublic: false, moneyPublic: true };
    expect((await getUserScoreForecast(contextWith(["QC"]), other, {})).moneyKhoanProvisional).toBe(150000);
    expect(await failure(getUserScoreForecast(contextWith(["QC"]), stranger, {}))).toEqual({ code: "SCORE_USER_NOT_FOUND", status: 404 });
  });
});

describe("PD-052 — KPI settlements / report of one member (userId)", () => {
  const settlementRow = {
    settlement_id: ids.settlement,
    id: other,
    display_name: "Nhân viên Ví Dụ",
    email: "vi.du@example.test",
    avatar_url: null,
    period: "2026-09",
    period_from: "2026-08-26",
    period_to: "2026-09-25",
    target_base: "100",
    target_points: "100",
    prorate_leave: false,
    working_days: 26,
    leave_days: "0",
    points_official: "120",
    met: true,
    khoan_credits: "10",
    khoan_money_raw: "200000",
    khoan_money: "200000",
    khoan_points_converted: "0",
    total_points: "120",
    khoan_policy: "ALWAYS",
    run_id: ids.run,
    run_at: new Date("2026-09-25T16:59:00Z"),
    note: null
  };
  const settlementQueries = (call: Call) => {
    const members = scoreQueries([me, other])(call);
    if (members) return members;
    if (call.text.includes("FROM production.kpi_settlements ks")) return [settlementRow];
    return undefined;
  };

  it("a staff member reads another member's settled period; money hidden unless moneyPublic", async () => {
    db.state.handler = settlementQueries;
    const list = await listKpiSettlements(contextWith(["STAFF"]), { period: "2026-09", userId: other });
    const select = db.state.calls.find((call) => call.text.includes("FROM production.kpi_settlements ks"))!;
    expect(select.values).toContainEqual([other]);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ met: true, totalPoints: 120, khoanMoney: null, khoanMoneyRaw: null });

    fixtures.settings = { scoresPublic: false, moneyPublic: true };
    const shared = await listKpiSettlements(contextWith(["STAFF"]), { period: "2026-09", userId: other });
    expect(shared.items[0]?.khoanMoney).toBe(200000);
  });

  it("without userId a member still reads only their own row; a non-member userId → 404", async () => {
    db.state.handler = settlementQueries;
    await listKpiSettlements(contextWith(["STAFF"]), { period: "2026-09" });
    expect(db.state.calls.find((call) => call.text.includes("FROM production.kpi_settlements ks"))!.values).toContainEqual([me]);
    expect(await failure(listKpiSettlements(contextWith(["STAFF"]), { period: "2026-09", userId: stranger }))).toEqual({
      code: "SCORE_USER_NOT_FOUND",
      status: 404
    });
    expect(await failure(getKpiReport(contextWith(["STAFF"]), { from: "2026-09", to: "2026-09", userId: stranger }))).toEqual({
      code: "SCORE_USER_NOT_FOUND",
      status: 404
    });
  });
});
