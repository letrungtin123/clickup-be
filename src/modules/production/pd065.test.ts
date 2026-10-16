import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FeaturePermissionMatrix as Matrix } from "../../contracts/production-catalog.js";
import { AppError } from "../../lib/app-error.js";
import type * as AccessContextModule from "../access/access-context.js";
import type { AccessContext } from "../access/access-context.js";

/**
 * PD-065 — editable "Phân quyền Photo Retouch" (feature permission matrix) and the new production role DIRECTOR.
 * Pure rules (contracts), the settings read / write, `/production/me`, and every gated endpoint against a fake
 * tagged-template `sql` (no database): the stored matrix is answered to the settings read; "reached" means the call got
 * past its guard to the database. Fake ids and names only: the repository is public.
 */
type Call = { text: string; values: unknown[] };
type Fragment = { readonly isFragment: true; text: string; values: unknown[] };

const db = vi.hoisted(() => {
  class Reached extends Error {}
  const state = {
    calls: [] as Call[],
    /** Rows of the settings read (`SELECT key, value FROM production.settings`). */
    settings: [] as { key: string; value: unknown }[],
    /** Any other statement: rows, or `Reached` thrown when null. */
    handler: null as ((call: Call) => unknown[] | undefined) | null
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
        if (call.text.startsWith("SELECT key, value FROM production.settings")) {
          resolve(state.settings);
          return;
        }
        if (call.text.includes("FROM production.kpi_close_days")) {
          resolve([]);
          return;
        }
        if (!state.handler) {
          reject(new Reached("database reached"));
          return;
        }
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
    // begin(fn) or begin("read only", fn)
    begin: <T>(...args: unknown[]) => (args.at(-1) as (tx: unknown) => Promise<T>)(fake),
    unsafe: (text: string, values: unknown[] = []) => {
      state.calls.push({ text, values });
      return state.handler ? Promise.resolve(state.handler({ text, values }) ?? []) : Promise.reject(new Reached("database reached"));
    }
  });
  return { state, sql: fake, Reached };
});

vi.mock("../../lib/redis.js", () => ({
  hasRedisConfig: () => false,
  getOptionalRedis: () => undefined,
  getRedis: () => {
    throw new Error("Redis is not available in this test");
  }
}));
vi.mock("../../db/client.js", () => ({ getSql: () => db.sql }));
vi.mock("../../realtime/publisher.js", () => ({ publishToRoom: vi.fn(), publishToUsers: vi.fn() }));
vi.mock("../access/access-context.js", async (importOriginal) => ({
  ...(await importOriginal<typeof AccessContextModule>()),
  invalidateAccessContexts: vi.fn(() => Promise.resolve())
}));

const contracts = await import("../../contracts/production-catalog.js");
const { memberProductionRoleCodes, MemberProductionRolesSchema } = await import("../../contracts/departments.js");
const { CreateProductionUserRequestSchema } = await import("../../contracts/users-admin.js");
const { featuresOf, productionRolesOf, seesWholeOrganization } = await import("./access.js");
const { clearProductionConfigCache } = await import("./catalog-cache.js");
const catalog = await import("./catalog.service.js");
const { hasFeature, loadFeatures } = await import("./features.js");
const { listQcQueue } = await import("./tasks.service.js");
const { getAdminDashboard, getLeaderDashboard } = await import("./dashboards.service.js");
const { listAnomalies, unreviewAnomaly } = await import("./anomalies.service.js");
const { runReport } = await import("./reports.js");
const { ReportConfigSchema } = await import("../../contracts/production-reports.js");

const {
  defaultFeaturePermissions,
  defaultJobPermissions,
  effectiveFeatures,
  effectiveJobScopes,
  FeaturePermissionMatrixSchema,
  featurePermissionKeys,
  normalizeFeaturePermissions,
  normalizeJobPermissions,
  productionRoleCodes,
  ProductionMeSchema,
  ProductionSettingsSchema,
  UpdateProductionMemberRequestSchema,
  UpdateProductionSettingsRequestSchema
} = contracts;

const org = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";

const contextWith = (roles: string[], superadmin = false) =>
  ({
    user: { id: me, displayName: "Người Thử", email: null },
    organization: { id: org, slug: "o", name: "O" },
    hasFullOrganizationAuthority: superadmin,
    productionRoles: roles,
    departments: ["PHOTO_RETOUCH"],
    canSwitchDepartment: false,
    mustChangePassword: false,
    role: { id: "r", organizationId: org, key: superadmin ? "superadmin" : "member", name: "x", permissions: [] }
  }) as unknown as AccessContext;
const superadmin = contextWith([], true);

/** Stores a feature matrix (defaults overridden by `overrides`) for the next settings read. */
const storeFeatures = (overrides: Partial<Record<string, string[]>>) => {
  db.state.settings = [{ key: "feature_permissions", value: { ...defaultFeaturePermissions, ...overrides } }];
  clearProductionConfigCache();
};

/** "reached" (past the guard), "ok" (resolved) or the AppError it failed with. */
const outcome = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return "ok";
  } catch (error) {
    if (error instanceof db.Reached) {
      return "reached";
    }
    if (error instanceof AppError) {
      return { code: error.code, status: error.statusCode, ...(error.details ? { details: error.details } : {}) };
    }
    throw error;
  }
};
const forbidden = (feature: string, code = "FORBIDDEN") => ({ code, status: 403, details: { feature } });
const beyondSettings = () => db.state.calls.filter((call) => !call.text.includes("production.settings") && !call.text.includes("kpi_close_days"));

beforeEach(() => {
  db.state.calls = [];
  db.state.settings = [];
  db.state.handler = null;
  clearProductionConfigCache();
});

describe("PD-065 contract: roles, defaults, matrix", () => {
  it("DIRECTOR is a production role everywhere a role list is validated", () => {
    expect(productionRoleCodes).toContain("DIRECTOR");
    expect([...memberProductionRoleCodes]).toEqual([...productionRoleCodes]);
    expect(MemberProductionRolesSchema.parse(["DIRECTOR", "STAFF", "DIRECTOR"])).toEqual(["DIRECTOR", "STAFF"]);
    expect(UpdateProductionMemberRequestSchema.parse({ roles: [...productionRoleCodes] }).roles).toHaveLength(6);
    const account = { email: "director@example.test", displayName: "Giám Đốc", roles: ["DIRECTOR"] };
    expect(CreateProductionUserRequestSchema.safeParse({ ...account, departments: ["PHOTO_RETOUCH"] }).success).toBe(true);
    // Production roles (DIRECTOR included) need the Photo Retouch department.
    expect(CreateProductionUserRequestSchema.safeParse({ ...account, departments: ["PRODUCTION"] }).success).toBe(false);
  });

  it("the owner's defaults", () => {
    expect(defaultFeaturePermissions).toEqual({
      qc_queue: ["ADMIN", "QC"],
      view_others_scores: ["ADMIN", "ACCOUNT", "LEADER", "QC", "STAFF", "DIRECTOR"],
      view_others_money: ["ADMIN", "DIRECTOR"],
      leader_dashboard: ["ADMIN", "LEADER", "DIRECTOR"],
      admin_dashboard: ["DIRECTOR"],
      anomalies: ["DIRECTOR"],
      leave_approval: ["ADMIN"],
      clients: ["ADMIN", "ACCOUNT"]
    });
    expect(Object.keys(defaultFeaturePermissions)).toEqual([...featurePermissionKeys]);
    // The Director sees every job and changes none.
    expect(defaultJobPermissions.DIRECTOR).toEqual({ view: "all", create: "none", update: "none", delete: "none" });
    expect(effectiveJobScopes(["DIRECTOR"], defaultJobPermissions)).toEqual({ view: "all", create: "none", update: "none", delete: "none" });
  });

  it("effectiveFeatures: union over the roles; the superadmin has everything; ADMIN only through the matrix", () => {
    expect(effectiveFeatures(["DIRECTOR"], defaultFeaturePermissions)).toEqual([
      "view_others_scores",
      "view_others_money",
      "leader_dashboard",
      "admin_dashboard",
      "anomalies"
    ]);
    expect(effectiveFeatures(["ADMIN"], defaultFeaturePermissions)).toEqual([
      "qc_queue",
      "view_others_scores",
      "view_others_money",
      "leader_dashboard",
      "leave_approval",
      "clients"
    ]);
    expect(effectiveFeatures(["STAFF", "QC"], defaultFeaturePermissions)).toEqual(["qc_queue", "view_others_scores"]);
    expect(effectiveFeatures([], defaultFeaturePermissions)).toEqual([]);
    const noAdmin = Object.fromEntries(featurePermissionKeys.map((key) => [key, ["STAFF"]])) as Matrix;
    expect(effectiveFeatures(["ADMIN"], noAdmin)).toEqual([]);
    expect(effectiveFeatures(["ADMIN"], noAdmin, true)).toEqual([...featurePermissionKeys]);
    expect(effectiveFeatures([], noAdmin, true)).toEqual([...featurePermissionKeys]);
  });

  it("the superadmin holds ADMIN and DIRECTOR implicitly; DIRECTOR and ADMIN see the whole organization", () => {
    expect([...productionRolesOf(superadmin)].sort()).toEqual(["ADMIN", "DIRECTOR"]);
    expect([...featuresOf(superadmin, Object.fromEntries(featurePermissionKeys.map((key) => [key, []])) as unknown as Matrix)]).toEqual([
      ...featurePermissionKeys
    ]);
    expect(seesWholeOrganization(contextWith(["DIRECTOR"]))).toBe(true);
    expect(seesWholeOrganization(contextWith(["ADMIN"]))).toBe(true);
    expect(seesWholeOrganization(contextWith(["LEADER", "ACCOUNT"]))).toBe(false);
  });

  it("the request schema requires every key, known keys and known roles only; roles are de-duplicated in a stable order", () => {
    const full = { ...defaultFeaturePermissions, anomalies: ["LEADER", "DIRECTOR", "LEADER", "ADMIN"] };
    expect(FeaturePermissionMatrixSchema.parse(full).anomalies).toEqual(["ADMIN", "LEADER", "DIRECTOR"]);
    expect(UpdateProductionSettingsRequestSchema.parse({ featurePermissions: full }).featurePermissions?.anomalies).toEqual(["ADMIN", "LEADER", "DIRECTOR"]);
    const missing: Record<string, unknown> = { ...defaultFeaturePermissions };
    delete missing.clients;
    expect(UpdateProductionSettingsRequestSchema.safeParse({ featurePermissions: missing }).success).toBe(false);
    expect(UpdateProductionSettingsRequestSchema.safeParse({ featurePermissions: { ...defaultFeaturePermissions, settings: ["ADMIN"] } }).success).toBe(false);
    expect(UpdateProductionSettingsRequestSchema.safeParse({ featurePermissions: { ...defaultFeaturePermissions, clients: ["OWNER"] } }).success).toBe(false);
    expect(UpdateProductionSettingsRequestSchema.safeParse({ featurePermissions: { ...defaultFeaturePermissions, clients: "ADMIN" } }).success).toBe(false);
    expect(UpdateProductionSettingsRequestSchema.safeParse({ featurePermissions: { ...defaultFeaturePermissions, clients: [] } }).success).toBe(true);
  });

  it("a job matrix without DIRECTOR (saved before PD-065, or sent by an older page) gets the Director's default", () => {
    const beforePd065: Record<string, unknown> = { ...defaultJobPermissions };
    delete beforePd065.DIRECTOR;
    expect(UpdateProductionSettingsRequestSchema.parse({ jobPermissions: beforePd065 }).jobPermissions?.DIRECTOR).toEqual(defaultJobPermissions.DIRECTOR);
    const viewer = { view: "own", create: "none", update: "none", delete: "none" } as const;
    expect(UpdateProductionSettingsRequestSchema.parse({ jobPermissions: { ...defaultJobPermissions, DIRECTOR: viewer } }).jobPermissions?.DIRECTOR).toEqual(viewer);
    expect(normalizeJobPermissions(beforePd065)).toEqual(defaultJobPermissions);
    expect(normalizeJobPermissions({ ...beforePd065, STAFF: { view: "mine" } }).STAFF).toEqual(defaultJobPermissions.STAFF);
    expect(normalizeJobPermissions(null)).toEqual(defaultJobPermissions);
  });

  it("a stored feature matrix: missing → defaults, an invalid key → its default, unknown keys dropped", () => {
    expect(normalizeFeaturePermissions(undefined)).toEqual(defaultFeaturePermissions);
    expect(normalizeFeaturePermissions("x")).toEqual(defaultFeaturePermissions);
    const stored = { qc_queue: ["QC"], anomalies: ["NOPE"], clients: "ADMIN", settings: ["STAFF"], leave_approval: ["DIRECTOR", "ADMIN", "ADMIN"] };
    expect(normalizeFeaturePermissions(stored)).toEqual({
      ...defaultFeaturePermissions,
      qc_queue: ["QC"],
      leave_approval: ["ADMIN", "DIRECTOR"]
    });
  });
});

describe("PD-065 settings: read, write (superadmin only), /production/me", () => {
  it("GET /production/settings returns featurePermissions (stored or default) and the DIRECTOR job column", async () => {
    const beforePd065: Record<string, unknown> = { ...defaultJobPermissions };
    delete beforePd065.DIRECTOR;
    db.state.settings = [
      { key: "job_permissions", value: beforePd065 },
      { key: "feature_permissions", value: { ...defaultFeaturePermissions, anomalies: ["LEADER", "DIRECTOR"], admin_dashboard: ["X"] } }
    ];
    const settings = ProductionSettingsSchema.parse(await catalog.getSettings(contextWith(["ADMIN"])));
    expect(settings.jobPermissions.DIRECTOR).toEqual(defaultJobPermissions.DIRECTOR);
    expect(settings.featurePermissions.anomalies).toEqual(["LEADER", "DIRECTOR"]);
    expect(settings.featurePermissions.admin_dashboard).toEqual(["DIRECTOR"]);
    clearProductionConfigCache();
    db.state.settings = [];
    expect((await catalog.getSettings(contextWith(["ADMIN"]))).featurePermissions).toEqual(defaultFeaturePermissions);
  });

  it("PATCH featurePermissions: a production Admin or Director gets 403 before anything is read; the superadmin saves it", async () => {
    const input = UpdateProductionSettingsRequestSchema.parse({ featurePermissions: { ...defaultFeaturePermissions, admin_dashboard: ["DIRECTOR", "ADMIN"] } });
    for (const roles of [["ADMIN"], ["DIRECTOR"], ["ADMIN", "DIRECTOR", "LEADER"]]) {
      expect(await outcome(catalog.updateSettings(contextWith(roles), input))).toEqual({ code: "FORBIDDEN", status: 403 });
    }
    expect(db.state.calls).toHaveLength(0);

    db.state.handler = () => [];
    await catalog.updateSettings(superadmin, input);
    const write = db.state.calls.find((call) => call.text.startsWith("INSERT INTO production.settings"))!;
    expect(write.values).toContain("feature_permissions");
    expect(write.values).toContainEqual({ ...defaultFeaturePermissions, admin_dashboard: ["ADMIN", "DIRECTOR"] });
  });

  it("/production/me returns the caller's features", async () => {
    db.state.handler = () => [];
    const meOf = async (context: AccessContext) => ProductionMeSchema.parse(await catalog.getProductionMe(context));
    expect((await meOf(contextWith(["STAFF"]))).features).toEqual(["view_others_scores"]);
    expect((await meOf(contextWith(["DIRECTOR"]))).features).toEqual(["view_others_scores", "view_others_money", "leader_dashboard", "admin_dashboard", "anomalies"]);
    const director = await meOf(contextWith(["DIRECTOR"]));
    expect([director.isAdmin, director.jobPermissions]).toEqual([false, { view: "all", create: "none", update: "none", delete: "none" }]);
    const owner = await meOf(superadmin);
    expect(owner.features).toEqual([...featurePermissionKeys]);
    expect(owner.roles).toEqual(["ADMIN", "DIRECTOR"]);
    storeFeatures({ view_others_scores: ["LEADER"], qc_queue: ["STAFF"] });
    expect((await meOf(contextWith(["STAFF"]))).features).toEqual(["qc_queue"]);
  });

  it("hasFeature / loadFeatures read the stored matrix (cached with the settings)", async () => {
    storeFeatures({ anomalies: ["LEADER"] });
    expect(await hasFeature(contextWith(["LEADER"]), "anomalies")).toBe(true);
    expect(await hasFeature(contextWith(["DIRECTOR"]), "anomalies")).toBe(false);
    expect([...(await loadFeatures(contextWith(["DIRECTOR"])))]).not.toContain("anomalies");
    expect(await hasFeature(superadmin, "anomalies")).toBe(true);
  });
});

describe("PD-065 gated endpoints follow the matrix", () => {
  it("GET /production/tasks/qc-queue: QC and Admin by default; others 403; a role the superadmin adds passes", async () => {
    for (const roles of [["STAFF"], ["LEADER"], ["DIRECTOR"], ["ACCOUNT"]]) {
      expect(await outcome(listQcQueue(contextWith(roles)))).toEqual(forbidden("qc_queue"));
    }
    expect(beyondSettings()).toHaveLength(0);
    expect(await outcome(listQcQueue(contextWith(["QC"])))).toBe("reached");
    expect(await outcome(listQcQueue(contextWith(["ADMIN"])))).toBe("reached");
    expect(await outcome(listQcQueue(superadmin))).toBe("reached");
    storeFeatures({ qc_queue: ["STAFF"] });
    expect(await outcome(listQcQueue(contextWith(["STAFF"])))).toBe("reached");
    expect(await outcome(listQcQueue(contextWith(["QC"])))).toEqual(forbidden("qc_queue"));
    expect(await outcome(listQcQueue(contextWith([])))).toMatchObject({ code: "PRODUCTION_NOT_FOUND", status: 404 });
  });

  it("GET /production/dashboard/admin (Quản trị số liệu): the Director's — a production Admin now gets 403", async () => {
    for (const roles of [["ADMIN"], ["LEADER"], ["ADMIN", "LEADER", "ACCOUNT", "QC", "STAFF"]]) {
      expect(await outcome(getAdminDashboard(contextWith(roles)))).toEqual(forbidden("admin_dashboard"));
    }
    expect(beyondSettings()).toHaveLength(0);
    expect(await outcome(getAdminDashboard(contextWith(["DIRECTOR"])))).toBe("reached");
    expect(await outcome(getAdminDashboard(superadmin))).toBe("reached");
    storeFeatures({ admin_dashboard: ["ADMIN", "DIRECTOR"] });
    expect(await outcome(getAdminDashboard(contextWith(["ADMIN"])))).toBe("reached");
  });

  it("GET /production/anomalies: the Director's (every job) — Leaders and Admins 403 unless the superadmin adds them", async () => {
    for (const roles of [["ADMIN"], ["LEADER"], ["STAFF"]]) {
      expect(await outcome(listAnomalies(contextWith(roles), { days: 30, includeReviewed: false }))).toEqual(forbidden("anomalies"));
      expect(await outcome(unreviewAnomaly(contextWith(roles), { kind: "FAST_DONE", key: other }))).toEqual(forbidden("anomalies"));
    }
    expect(beyondSettings()).toHaveLength(0);

    db.state.handler = () => [];
    const director = await listAnomalies(contextWith(["DIRECTOR"]), { kind: "FAST_DONE", days: 30, includeReviewed: false });
    expect(director.leaderId).toBeNull();
    expect(beyondSettings().some((call) => call.text.includes("j.leader_id = $ OR j.leader_id IS NULL"))).toBe(false);

    // A Leader the superadmin adds sees the jobs they lead and the jobs without a leader.
    storeFeatures({ anomalies: ["LEADER", "DIRECTOR"] });
    db.state.calls = [];
    const leader = await listAnomalies(contextWith(["LEADER"]), { kind: "FAST_DONE", days: 30, includeReviewed: false });
    expect(leader.leaderId).toBe(me);
    expect(beyondSettings().some((call) => call.text.includes("j.leader_id = $ OR j.leader_id IS NULL"))).toBe(true);

    // The Director (like an Admin) may undo someone else's "Đã xem".
    db.state.handler = (call) => (call.text.startsWith("SELECT reviewed_by FROM production.anomaly_reviews") ? [{ reviewed_by: other }] : []);
    expect(await unreviewAnomaly(contextWith(["DIRECTOR"]), { kind: "FAST_DONE", key: other })).toMatchObject({ reviewedAt: null });
    expect(await outcome(unreviewAnomaly(contextWith(["LEADER"]), { kind: "FAST_DONE", key: other }))).toMatchObject({ code: "ANOMALY_REVIEW_NOT_OWNER" });
  });

  it("GET /production/dashboard/leader: Leader, Admin and Director; Leaders their jobs + unled ones, Admin / Director every job", async () => {
    for (const roles of [["ACCOUNT"], ["QC", "STAFF"]]) {
      expect(await outcome(getLeaderDashboard(contextWith(roles), {}))).toEqual(forbidden("leader_dashboard"));
    }
    expect(beyondSettings()).toHaveLength(0);
    expect(await outcome(getLeaderDashboard(contextWith(["LEADER"]), { leaderId: other }))).toMatchObject({ code: "FORBIDDEN", status: 403 });

    const scoped = async (roles: string[], query: { leaderId?: string } = {}) => {
      db.state.calls = [];
      await outcome(getLeaderDashboard(contextWith(roles), query));
      const late = beyondSettings().find((call) => call.text.includes("FROM production.tasks t") && call.text.includes("t.deadline < $"))!;
      return late.text.includes("j.leader_id = $ OR j.leader_id IS NULL") ? late.values.find((value) => value === me || value === other) : "all";
    };
    db.state.handler = () => [];
    expect(await scoped(["LEADER"])).toBe(me);
    expect(await scoped(["DIRECTOR"])).toBe("all");
    expect(await scoped(["DIRECTOR"], { leaderId: other })).toBe(other);
    expect(await scoped(["ADMIN"])).toBe("all");
    storeFeatures({ leader_dashboard: ["ACCOUNT"] });
    expect(await scoped(["ACCOUNT"])).toBe(me);
    expect(await outcome(getLeaderDashboard(contextWith(["LEADER"]), {}))).toEqual(forbidden("leader_dashboard"));
  });

  it("GET /production/clients: Account and Admin by default (Admin always reads it as Cấu hình); Leaders 403 unless added", async () => {
    for (const roles of [["LEADER"], ["STAFF"], ["DIRECTOR"]]) {
      expect(await outcome(catalog.listClients(contextWith(roles)))).toEqual(forbidden("clients"));
    }
    expect(await outcome(catalog.listClients(contextWith(["ACCOUNT"])))).toBe("reached");
    expect(await outcome(catalog.listClients(contextWith(["ADMIN"])))).toBe("reached");
    storeFeatures({ clients: ["LEADER"] });
    expect(await outcome(catalog.listClients(contextWith(["LEADER"])))).toBe("reached");
    expect(await outcome(catalog.listClients(contextWith(["ACCOUNT"])))).toEqual(forbidden("clients"));
    // Cấu hình → Khách hàng stays readable by a production Admin (the fixed Cấu hình rule).
    expect(await outcome(catalog.listClients(contextWith(["ADMIN"])))).toBe("reached");
  });

  it("reports: whoever has Quản trị số liệu runs its pinned reports (money included) without being Leader / Admin", async () => {
    const money = ReportConfigSchema.parse({ dimensions: ["user"], measures: ["money_khoan"], preset: "THIS_MONTH" });
    expect(await outcome(runReport(contextWith(["DIRECTOR"]), money))).toBe("reached");
    expect(await outcome(runReport(contextWith(["STAFF"]), money))).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(await outcome(runReport(contextWith(["LEADER"]), money))).toMatchObject({ code: "MONEY_FORBIDDEN", status: 403 });
    storeFeatures({ admin_dashboard: [] });
    expect(await outcome(runReport(contextWith(["DIRECTOR"]), money))).toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("Bảng đơn giá money per image: view_others_money or moneyPublic", async () => {
    const rule = { id: other, project_id: other, process_id: other, credit_per_image: "1", money_per_image: "500", effective_from: "2026-10-01", effective_to: null };
    db.state.handler = (call) => (call.text.includes("FROM production.credit_rules") ? [rule] : []);
    const moneyOf = async (roles: string[]) => {
      clearProductionConfigCache();
      return (await catalog.getCreditHistory(contextWith(roles), other, other)).items.map((item) => item.moneyPerImage);
    };
    expect(await moneyOf(["DIRECTOR"])).toEqual([500]);
    expect(await moneyOf(["STAFF"])).toEqual([null]);
    storeFeatures({ view_others_money: ["DIRECTOR"] });
    expect(await moneyOf(["ADMIN"])).toEqual([null]);
    db.state.settings = [...db.state.settings, { key: "money_public", value: true }];
    expect(await moneyOf(["STAFF"])).toEqual([500]);
  });
});

describe("PD-065 granting DIRECTOR", () => {
  it("only the superadmin grants or removes DIRECTOR (PD-050); it needs the Photo Retouch department", async () => {
    for (const roles of [["ADMIN"], ["DIRECTOR"]]) {
      expect(await outcome(catalog.updateMember(contextWith(roles), other, { roles: ["DIRECTOR"] }))).toEqual({ code: "FORBIDDEN", status: 403 });
    }
    expect(db.state.calls).toHaveLength(0);

    const member = {
      user_id: other,
      display_name: "Giám Đốc",
      email: "gd@example.test",
      avatar_url: null,
      roles: ["DIRECTOR"],
      superadmin: false,
      departments: ["PHOTO_RETOUCH"],
      team_id: null,
      status: "active",
      custom_values: null,
      tag_ids: null
    };
    let inRetouch = true;
    db.state.handler = (call) =>
      call.text.includes("FROM public.organization_memberships om") && call.text.includes("ORDER BY au.display_name") ? [member]
      : call.text.includes("AS member") ? [{ member: inRetouch }]
      : [];
    const updated = await catalog.updateMember(superadmin, other, UpdateProductionMemberRequestSchema.parse({ roles: ["DIRECTOR"] }));
    expect(updated.roles).toEqual(["DIRECTOR"]);
    const insert = db.state.calls.find((call) => call.text.startsWith("INSERT INTO production.user_roles"))!;
    expect(insert.values).toContainEqual(["DIRECTOR"]);

    inRetouch = false;
    expect(await outcome(catalog.updateMember(superadmin, other, { roles: ["DIRECTOR"] }))).toMatchObject({ code: "PRODUCTION_ROLES_NOT_ALLOWED", status: 400 });
  });
});
