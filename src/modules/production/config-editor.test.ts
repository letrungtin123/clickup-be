import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../../lib/app-error.js";
import type { AccessContext } from "../access/access-context.js";

/**
 * PD-049 / PD-050: every write of "Cấu hình Photo Retouch" is the organization superadmin's alone; every other production
 * role — Quản trị (ADMIN) included — gets 403 before anything is read, non-members 404. No database: the fake `sql` throws
 * `Reached` on its first statement, so "accepted" means the call got past the guard to the database. Fake ids only.
 */
const db = vi.hoisted(() => {
  class Reached extends Error {}
  const state = { calls: 0 };
  const sql = () => {
    state.calls += 1;
    throw new Reached("database reached");
  };
  const fake = Object.assign(sql, { json: (value: unknown) => value, begin: <T>(fn: (tx: unknown) => Promise<T>) => fn(fake) });
  return { state, sql: fake, Reached };
});

vi.mock("../../db/client.js", () => ({ getSql: () => db.sql }));
vi.mock("../../lib/redis.js", () => ({
  hasRedisConfig: () => false,
  getOptionalRedis: () => undefined,
  getRedis: () => {
    throw new Error("Redis is not available in this test");
  }
}));

const { assertConfigEditor } = await import("./access.js");
const catalog = await import("./catalog.service.js");
const jobStatuses = await import("./job-statuses.service.js");
const kpiTargets = await import("./kpi-targets.service.js");
const settlement = await import("./kpi-settlement.service.js");
const usersAdmin = await import("./users-admin.service.js");
const { CreateProductionUserRequestSchema } = await import("../../contracts/users-admin.js");

const org = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const someId = "44444444-4444-4444-8444-444444444444";

const context = (superadmin: boolean, roles: string[]) =>
  ({
    user: { id: me, displayName: "Me", email: null },
    organization: { id: org, slug: "o", name: "O" },
    hasFullOrganizationAuthority: superadmin,
    productionRoles: roles,
    departments: superadmin ? ["PHOTO_RETOUCH", "PRODUCTION"] : ["PHOTO_RETOUCH"],
    canSwitchDepartment: superadmin,
    mustChangePassword: false,
    role: { id: "r", organizationId: org, key: superadmin ? "superadmin" : "member", name: "x", permissions: [] }
  }) as unknown as AccessContext;
const superadmin = context(true, []);
const productionAdmin = context(false, ["ADMIN"]);

const forbidden = { code: "FORBIDDEN", status: 403, message: "Chỉ Siêu quản trị mới sửa được Cấu hình Photo Retouch." };

const failure = (run: () => void) => {
  try {
    run();
  } catch (error) {
    return error instanceof AppError ? { code: error.code, status: error.statusCode, message: error.message } : null;
  }
  return null;
};

/** "reached" (past the guard, at the database), "ok" (resolved without a statement) or the AppError it failed with. */
const outcome = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return "ok";
  } catch (error) {
    if (error instanceof db.Reached) {
      return "reached";
    }
    if (error instanceof AppError) {
      return { code: error.code, status: error.statusCode, message: error.message };
    }
    throw error;
  }
};

/** Every configuration write behind its route (PD-050), with a body good enough to reach the database. */
const writes: [string, (context: AccessContext) => Promise<unknown>][] = [
  ["PATCH /production/settings (job permission matrix included)", (c) => catalog.updateSettings(c, { scoresPublic: true })],
  ["PATCH /production/members/:userId", (c) => catalog.updateMember(c, other, { teamId: null })],
  ["POST /production/teams", (c) => catalog.upsertTeam(c, null, { name: "Team" })],
  ["PATCH /production/teams/:teamId", (c) => catalog.upsertTeam(c, someId, { name: "Team", active: false })],
  ["POST /production/clients", (c) => catalog.upsertClient(c, null, { name: "Client" })],
  ["PATCH /production/clients/:clientId", (c) => catalog.upsertClient(c, someId, { name: "Client" })],
  ["POST /production/projects", (c) => catalog.upsertProject(c, null, { code: "P1", name: "Project" })],
  ["PATCH /production/projects/:projectId", (c) => catalog.upsertProject(c, someId, { code: "P1", name: "Project" })],
  ["POST /production/processes", (c) => catalog.upsertProcess(c, null, { name: "Retouch" })],
  ["PATCH /production/processes/:processId", (c) => catalog.upsertProcess(c, someId, { name: "Retouch" })],
  ["DELETE /production/processes/:processId", (c) => catalog.deleteProcess(c, someId)],
  ["POST /production/shifts", (c) => catalog.upsertShift(c, null, { name: "Ca", payMode: "POINTS" } as never)],
  ["PATCH /production/shifts/:shiftId", (c) => catalog.upsertShift(c, someId, { name: "Ca", payMode: "POINTS" } as never)],
  ["PUT /production/{processes,shifts,custom-fields}/order", (c) => catalog.reorderCatalog(c, "shifts", [someId])],
  ["PUT /production/credit-rules", (c) => catalog.putCreditRule(c, { projectId: someId, processId: someId, effectiveFrom: "2026-11-01", creditPerImage: 1 } as never)],
  ["POST /production/credit-rules/versions", (c) => catalog.createCreditVersion(c, "2026-11-01")],
  ["DELETE /production/credit-rules/:ruleId", (c) => catalog.removeCreditVersion(c, someId)],
  [
    "POST /production/credit-rules/import",
    (c) => catalog.importCredits(c, { csv: "project_code,process_name,credit\nP1,Retouch,1.5", effectiveFrom: "2026-11-01", createMissing: true })
  ],
  ["POST /production/statuses", (c) => catalog.upsertStatus(c, null, { code: "NEW_CODE", name: "Mới" } as never)],
  ["PATCH /production/statuses/:statusId", (c) => catalog.upsertStatus(c, someId, { code: "NEW_CODE", name: "Mới" } as never)],
  ["PUT /production/statuses/order", (c) => catalog.reorderStatuses(c, [someId])],
  ["PUT /production/transitions", (c) => catalog.replaceTransitions(c, { transitions: [] })],
  ["POST /production/custom-fields", (c) => catalog.upsertCustomField(c, null, { entity: "JOB", key: "k", label: "K", type: "TEXT", options: [] } as never)],
  ["PATCH /production/custom-fields/:fieldId", (c) => catalog.upsertCustomField(c, someId, { label: "K", type: "TEXT", options: [] } as never)],
  ["POST /production/tags", (c) => catalog.upsertTag(c, null, { name: "Tag", color: "blue" } as never)],
  ["PATCH /production/tags/:tagId", (c) => catalog.upsertTag(c, someId, { name: "Tag", color: "blue" } as never)],
  ["POST /production/allowed-emails", (c) => catalog.addAllowedEmails(c, "new@example.test")],
  ["DELETE /production/allowed-emails/:email", (c) => catalog.removeAllowedEmail(c, "new@example.test")],
  ["POST /production/job-statuses", (c) => jobStatuses.createJobStatus(c, { name: "Chờ duyệt", color: "teal", isClosed: false, requiresAllChecked: false })],
  ["PATCH /production/job-statuses/:statusId", (c) => jobStatuses.updateJobStatus(c, someId, { name: "Chờ duyệt" })],
  ["PUT /production/job-statuses/order", (c) => jobStatuses.reorderJobStatuses(c, [someId])],
  ["DELETE /production/job-statuses/:statusId", (c) => jobStatuses.deleteJobStatus(c, someId, undefined)],
  ["PUT /production/kpi-targets", (c) => kpiTargets.putKpiTargets(c, { items: [] })],
  ["DELETE /production/kpi-targets/:targetId", (c) => kpiTargets.deleteKpiTarget(c, someId)],
  [
    "POST /production/kpi-targets/import",
    (c) => kpiTargets.importKpiTargets(c, { csv: "user_email,target\na@example.test,100", period: "2026-11", periodType: "MONTH" })
  ],
  ["POST /production/kpi-targets/apply-defaults", (c) => kpiTargets.applyDefaultKpiTargets(c, "2026-11")],
  ["POST /production/kpi/settlements/run", (c) => settlement.runKpiSettlement(c, { period: "2026-09", reason: "Chốt lại" })],
  [
    "POST /production/users",
    (c) =>
      usersAdmin.createProductionUser(
        c,
        CreateProductionUserRequestSchema.parse({ email: "x@example.test", displayName: "X", departments: ["PHOTO_RETOUCH"], roles: ["STAFF"] })
      )
  ],
  ["PATCH /production/users/:userId", (c) => usersAdmin.updateProductionUser(c, other, { teamId: null })],
  ["POST /production/users/:userId/deactivate", (c) => usersAdmin.setProductionUserActive(c, other, false)],
  ["POST /production/users/:userId/activate", (c) => usersAdmin.setProductionUserActive(c, other, true)],
  ["POST /production/users/:userId/reset-password", (c) => usersAdmin.resetProductionUserPassword(c, other)]
];

beforeEach(() => {
  db.state.calls = 0;
});

describe("assertConfigEditor (PD-049, PD-050)", () => {
  it("lets the organization superadmin edit", () => {
    expect(failure(() => assertConfigEditor(context(true, [])))).toBeNull();
  });

  it("refuses every other role, a production Admin included (403)", () => {
    for (const roles of [["ADMIN"], ["LEADER"], ["ACCOUNT"], ["QC"], ["STAFF"], ["ADMIN", "LEADER", "ACCOUNT"]]) {
      expect(failure(() => assertConfigEditor(context(false, roles)))).toEqual(forbidden);
    }
  });

  it("keeps the module hidden from non-members (404)", () => {
    expect(failure(() => assertConfigEditor(context(false, [])))?.status).toBe(404);
  });
});

describe("every configuration write is the superadmin's (PD-050)", () => {
  it.each(writes)("%s: a production Admin gets 403 before anything is read", async (_route, write) => {
    expect(await outcome(write(productionAdmin))).toEqual(forbidden);
    expect(db.state.calls).toBe(0);
  });

  it.each(writes)("%s: the superadmin gets past the guard", async (_route, write) => {
    expect(await outcome(write(superadmin))).toBe("reached");
  });

  it("Account no longer writes clients (it keeps reading them); Leader / QC / Staff write nothing either", async () => {
    expect(await outcome(catalog.upsertClient(context(false, ["ACCOUNT"]), null, { name: "Client" }))).toEqual(forbidden);
    for (const roles of [["LEADER"], ["QC"], ["STAFF"]]) {
      expect(await outcome(catalog.upsertStatus(context(false, roles), null, { code: "X", name: "X" } as never))).toEqual(forbidden);
      expect(await outcome(kpiTargets.putKpiTargets(context(false, roles), { items: [] }))).toEqual(forbidden);
    }
    expect(db.state.calls).toBe(0);
    expect(await outcome(catalog.listClients(context(false, ["ACCOUNT"])))).toBe("reached");
  });

  it("reads keep their rules: the production Admin still reads settings, members, whitelist, KPI targets and runs", async () => {
    expect(await outcome(catalog.getSettings(productionAdmin))).toBe("reached");
    expect(await outcome(catalog.listMembers(productionAdmin))).toBe("reached");
    expect(await outcome(catalog.listAllowedEmails(productionAdmin))).toBe("reached");
    expect(await outcome(kpiTargets.getKpiTargetMatrix(productionAdmin, {}))).toBe("reached");
    expect(await outcome(settlement.listKpiSettlementRuns(productionAdmin, { limit: 10 }))).toBe("reached");
    expect(await outcome(catalog.getWorkflow(context(false, ["STAFF"])))).toBe("reached");
  });
});
