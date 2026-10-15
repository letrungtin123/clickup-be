import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceContext } from "../../contracts/schemas.js";
import { CreateOrganizationMemberRequestSchema, UpdateOrganizationMemberRequestSchema } from "../../contracts/schemas.js";

/**
 * Departments of members in Cài đặt › Thành viên (PD-041): create / update rules, escalation guards, the invariant
 * "no production role outside PHOTO_RETOUCH" and the list filter. Runs the real workspace services and the shared
 * department writer of the production users admin against a fake tagged-template `sql` that records every statement
 * (no database); GoTrue, realtime, job chats and the department access effects are mocked.
 */
type Call = { text: string; values: unknown[] };

const db = vi.hoisted(() => {
  const state = { calls: [] as Call[], handler: (() => undefined) as (call: Call) => unknown[] | undefined };
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const call = { text: strings.join("$").replace(/\s+/g, " ").trim(), values };
    state.calls.push(call);
    return Promise.resolve(state.handler(call) ?? []);
  };
  const fake = Object.assign(sql, { json: (value: unknown) => value, begin: <T>(fn: (tx: unknown) => Promise<T>) => fn(fake) });
  return { state, sql: fake };
});

const mocks = vi.hoisted(() => ({
  createAuthUser: vi.fn(() => Promise.resolve("77777777-7777-4777-8777-777777777777")),
  invalidateAccessContexts: vi.fn(() => Promise.resolve()),
  disconnectUsers: vi.fn(),
  syncJobChatsForMember: vi.fn(() => Promise.resolve(0)),
  listOpenJobsLedBy: vi.fn(() => Promise.resolve({ displayName: "Người A", leaderActive: false, items: [] as unknown[] })),
  enqueueDomainEvents: vi.fn(() => Promise.resolve()),
  revokeDepartmentAccessEffects: vi.fn(() => Promise.resolve([] as unknown[])),
  publishDepartmentAccessRevoked: vi.fn(() => Promise.resolve())
}));

vi.mock("../../db/client.js", () => ({ getSql: () => db.sql }));
vi.mock("../../lib/redis.js", () => ({ getOptionalRedis: () => undefined }));
vi.mock("../auth/supabase-admin.service.js", () => ({
  createAuthUser: mocks.createAuthUser,
  generateTemporaryPassword: () => "Temp-Password-123",
  setAuthUserBanned: vi.fn(() => Promise.resolve()),
  setAuthUserPassword: vi.fn(() => Promise.resolve())
}));
vi.mock("../auth/supabase-auth.service.js", () => ({
  revokeTokensIssuedBefore: vi.fn(() => Promise.resolve()),
  signInWithPassword: vi.fn(() => Promise.resolve())
}));
vi.mock("../../realtime/publisher.js", () => ({ disconnectUsers: mocks.disconnectUsers }));
vi.mock("../access/access-context.js", () => ({ invalidateAccessContexts: mocks.invalidateAccessContexts }));
vi.mock("../production/catalog.service.js", () => ({ updateMember: vi.fn() }));
vi.mock("../production/job-chat.service.js", () => ({ syncJobChatsForMember: mocks.syncJobChatsForMember }));
vi.mock("../production/member-lookups.js", () => ({ listOpenJobsLedBy: mocks.listOpenJobsLedBy }));
vi.mock("../events/outbox.js", () => ({ enqueueDomainEvents: mocks.enqueueDomainEvents }));
vi.mock("../work/department-access.js", () => ({
  revokeDepartmentAccessEffects: mocks.revokeDepartmentAccessEffects,
  publishDepartmentAccessRevoked: mocks.publishDepartmentAccessRevoked
}));

const { createOrganizationMember } = await import("./members.service.js");
const { listOrganizationMembers, updateOrganizationMember } = await import("./workspace.service.js");
const { afterDepartmentChange, applyDepartmentChange } = await import("../production/users-admin.service.js");

const org = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const target = "33333333-3333-4333-8333-333333333333";
const membershipId = "44444444-4444-4444-8444-444444444444";
const memberRoleId = "55555555-5555-4555-8555-555555555555";
const superRoleId = "66666666-6666-4666-8666-666666666666";

type Options = { superadmin?: boolean; departments?: string[]; productionRoles?: string[] };
const contextWith = ({ superadmin = false, departments = ["PHOTO_RETOUCH", "PRODUCTION"], productionRoles = ["ADMIN"] }: Options = {}) =>
  ({
    user: { id: me, displayName: "Me", email: null },
    organization: { id: org, slug: "o", name: "O" },
    role: {
      id: superadmin ? superRoleId : "r-manager",
      organizationId: org,
      key: superadmin ? "superadmin" : "manager",
      name: "x",
      permissions: ["member.view", "member.manage"]
    },
    hasFullOrganizationAuthority: superadmin,
    mustChangePassword: false,
    productionRoles,
    departments: superadmin ? ["PHOTO_RETOUCH", "PRODUCTION"] : departments,
    canSwitchDepartment: true
  }) as unknown as WorkspaceContext;
const superadmin = contextWith({ superadmin: true });

type Target = { roleKey?: string; departments?: string[]; roles?: string[] };
const roleRow = (id: string, key: string) => ({
  id,
  organization_id: org,
  key,
  name: key,
  description: null,
  is_system: key === "superadmin",
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-01T00:00:00.000Z",
  permissions: key === "superadmin" ? ["member.manage", "member.view"] : ["member.view"]
});
const memberListRow = (userId: string, roleKey: string, departments: string[] | null) => ({
  id: membershipId,
  organization_id: org,
  user_id: userId,
  email: "a@example.test",
  display_name: "Người A",
  role_id: roleKey === "superadmin" ? superRoleId : memberRoleId,
  role_key: roleKey,
  role_name: roleKey,
  role_permissions: [],
  departments,
  status: "active",
  joined_at: "2026-10-01T00:00:00.000Z",
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-01T00:00:00.000Z",
  status_rank: 1
});

/** Answers the lookups of the member services for one target member. */
const answer = (person: Target) => (call: Call) => {
  const { text } = call;
  if (text.includes("FROM public.roles r LEFT JOIN public.role_permissions rp")) {
    const roleId = call.values.find((value) => value === memberRoleId || value === superRoleId);
    return roleId === superRoleId ? [roleRow(superRoleId, "superadmin")] : [roleRow(memberRoleId, "member")];
  }
  if (text.startsWith("SELECT id FROM public.roles")) {
    return [{ id: memberRoleId }];
  }
  if (text.startsWith("SELECT om.user_id, om.role_id, r.key AS role_key, om.status")) {
    return [{ user_id: target, role_id: memberRoleId, role_key: person.roleKey ?? "member", status: "active" }];
  }
  if (text.startsWith("SELECT COUNT(*)::text AS count")) {
    return [{ count: "1" }];
  }
  if (text.startsWith("SELECT department FROM public.user_departments")) {
    return (person.departments ?? []).map((department) => ({ department }));
  }
  if (text.startsWith("SELECT role_code FROM production.user_roles")) {
    return (person.roles ?? []).map((role_code) => ({ role_code }));
  }
  if (text.includes("AS role_permissions")) {
    return [memberListRow(target, person.roleKey ?? "member", person.departments ?? null)];
  }
  return undefined;
};

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return { code: (error as { code?: string }).code, status: (error as { statusCode?: number }).statusCode };
  }
  return null;
};
const statements = (prefix: string) => db.state.calls.filter((call) => call.text.startsWith(prefix));
const createInput = (body: Record<string, unknown>) =>
  CreateOrganizationMemberRequestSchema.parse({ email: "new@example.test", displayName: "Người Mới", roleId: memberRoleId, ...body });
const patch = (context: WorkspaceContext, body: Record<string, unknown>) =>
  updateOrganizationMember(context, membershipId, UpdateOrganizationMemberRequestSchema.parse(body), applyDepartmentChange);

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = answer({});
  for (const mock of Object.values(mocks)) {
    mock.mockClear();
  }
});

describe("create (POST /organization/members)", () => {
  it("writes departments, production roles and the production profile in the provisioning transaction", async () => {
    const created = await createOrganizationMember(superadmin, createInput({ departments: ["PHOTO_RETOUCH"], productionRoles: ["STAFF", "QC"] }));
    expect(created.temporaryPassword).toBe("Temp-Password-123");
    const texts = db.state.calls.map((call) => call.text);
    const membership = texts.findIndex((text) => text.startsWith("INSERT INTO public.organization_memberships"));
    const departments = texts.findIndex((text) => text.startsWith("INSERT INTO public.user_departments"));
    expect(membership).toBeGreaterThanOrEqual(0);
    expect(departments).toBeGreaterThan(membership);
    expect(statements("INSERT INTO public.user_departments")[0]!.values).toContainEqual(["PHOTO_RETOUCH"]);
    expect(statements("INSERT INTO production.user_roles")[0]!.values).toContainEqual(["STAFF", "QC"]);
    expect(statements("INSERT INTO production.member_profiles")).toHaveLength(1);
    expect(mocks.invalidateAccessContexts).toHaveBeenCalled();
  });

  it("a Production-only member gets no production role (leftover roles of a taken-over account are removed)", async () => {
    await createOrganizationMember(superadmin, createInput({ departments: ["PRODUCTION"] }));
    expect(statements("INSERT INTO public.user_departments")[0]!.values).toContainEqual(["PRODUCTION"]);
    expect(statements("DELETE FROM production.user_roles")).toHaveLength(1);
    expect(statements("INSERT INTO production.user_roles")).toHaveLength(0);
    expect(statements("INSERT INTO production.member_profiles")).toHaveLength(0);
  });

  it("departments are required unless the role is superadmin (implicitly in every department, no rows)", async () => {
    expect(await failure(createOrganizationMember(superadmin, createInput({ departments: [] })))).toEqual({ code: "DEPARTMENTS_REQUIRED", status: 400 });
    expect(mocks.createAuthUser).not.toHaveBeenCalled();
    await createOrganizationMember(superadmin, createInput({ roleId: superRoleId, departments: [] }));
    expect(mocks.createAuthUser).toHaveBeenCalledTimes(1);
    expect(statements("INSERT INTO public.user_departments")).toHaveLength(0);
    expect(statements("INSERT INTO production.user_roles")).toHaveLength(0);
  });

  it("the contract enforces production roles iff PHOTO_RETOUCH", () => {
    const base = { email: "x@example.test", displayName: "X", roleId: memberRoleId };
    expect(CreateOrganizationMemberRequestSchema.safeParse(base).success).toBe(false);
    expect(CreateOrganizationMemberRequestSchema.safeParse({ ...base, departments: ["PHOTO_RETOUCH"] }).success).toBe(false);
    expect(CreateOrganizationMemberRequestSchema.safeParse({ ...base, departments: ["PHOTO_RETOUCH"], productionRoles: [] }).success).toBe(false);
    expect(CreateOrganizationMemberRequestSchema.safeParse({ ...base, departments: ["PRODUCTION"], productionRoles: ["STAFF"] }).success).toBe(false);
    expect(CreateOrganizationMemberRequestSchema.safeParse({ ...base, departments: ["PRODUCTION"] }).success).toBe(true);
  });

  it("escalation: only your own departments; production roles only from the superadmin (PD-050)", async () => {
    const retouchAdmin = contextWith({ departments: ["PHOTO_RETOUCH"], productionRoles: ["ADMIN"] });
    expect(await failure(createOrganizationMember(retouchAdmin, createInput({ departments: ["PRODUCTION"] })))).toEqual({
      code: "DEPARTMENT_ESCALATION",
      status: 403
    });
    const retouchLeader = contextWith({ departments: ["PHOTO_RETOUCH"], productionRoles: ["LEADER"] });
    // Holding the role yourself is not enough to grant it from Cài đặt.
    expect(await failure(createOrganizationMember(retouchLeader, createInput({ departments: ["PHOTO_RETOUCH"], productionRoles: ["LEADER"] })))).toEqual({
      code: "PRODUCTION_ROLE_ESCALATION",
      status: 403
    });
    // PD-050: a production ADMIN no longer grants Photo Retouch roles either — only the superadmin.
    expect(await failure(createOrganizationMember(retouchAdmin, createInput({ departments: ["PHOTO_RETOUCH"], productionRoles: ["STAFF"] })))).toEqual({
      code: "PRODUCTION_ROLE_ESCALATION",
      status: 403
    });
    expect(mocks.createAuthUser).not.toHaveBeenCalled();
    await createOrganizationMember(superadmin, createInput({ departments: ["PHOTO_RETOUCH"], productionRoles: ["STAFF"] }));
    expect(mocks.createAuthUser).toHaveBeenCalledTimes(1);
  });
});

describe("update (PATCH /organization/members/:membershipId)", () => {
  it("removing PHOTO_RETOUCH deletes every production role, revokes the department and runs the PD-024 follow-ups", async () => {
    db.state.handler = answer({ departments: ["PHOTO_RETOUCH", "PRODUCTION"], roles: ["LEADER", "STAFF"] });
    const ledJob = { id: target, code: "JOB-1" };
    mocks.listOpenJobsLedBy.mockResolvedValueOnce({ displayName: "Người A", leaderActive: false, items: [ledJob] });
    const { departmentChange } = await patch(superadmin, { departments: ["PRODUCTION"] });
    expect(departmentChange).toMatchObject({
      departments: ["PRODUCTION"],
      removed: ["PHOTO_RETOUCH"],
      rolesAfter: [],
      removedRoles: ["LEADER", "STAFF"],
      changed: true
    });
    expect(statements("DELETE FROM public.user_departments")[0]!.values).toContainEqual(["PHOTO_RETOUCH"]);
    expect(statements("DELETE FROM production.user_roles")[0]!.values).toContainEqual(["LEADER", "STAFF"]);
    expect(mocks.revokeDepartmentAccessEffects).toHaveBeenCalledWith(expect.anything(), superadmin, target, "PHOTO_RETOUCH");
    // The membership row is updated first, in the same transaction.
    const texts = db.state.calls.map((call) => call.text);
    expect(texts.findIndex((text) => text.startsWith("UPDATE public.organization_memberships"))).toBeLessThan(
      texts.findIndex((text) => text.startsWith("DELETE FROM public.user_departments"))
    );

    expect(await afterDepartmentChange(superadmin, target, departmentChange)).toEqual([ledJob]);
    expect(mocks.invalidateAccessContexts).toHaveBeenCalled();
    expect(mocks.disconnectUsers).toHaveBeenCalledWith([target]);
    expect(mocks.publishDepartmentAccessRevoked).toHaveBeenCalledWith(superadmin, target, "PHOTO_RETOUCH", []);
    expect(mocks.syncJobChatsForMember).toHaveBeenCalledWith(superadmin, target);
    expect(mocks.enqueueDomainEvents).toHaveBeenCalledTimes(1);
  });

  it("removing PRODUCTION revokes it; unchanged departments are not a change", async () => {
    db.state.handler = answer({ departments: ["PHOTO_RETOUCH", "PRODUCTION"], roles: ["STAFF"] });
    const { departmentChange } = await patch(superadmin, { departments: ["PHOTO_RETOUCH"] });
    expect(mocks.revokeDepartmentAccessEffects).toHaveBeenCalledWith(expect.anything(), superadmin, target, "PRODUCTION");
    expect(departmentChange).toMatchObject({ removed: ["PRODUCTION"], removedRoles: [], changed: true });
    expect(statements("DELETE FROM production.user_roles")).toHaveLength(0);

    db.state.calls = [];
    mocks.revokeDepartmentAccessEffects.mockClear();
    const same = await patch(superadmin, { departments: ["PRODUCTION", "PHOTO_RETOUCH"] });
    expect(same.departmentChange).toMatchObject({ changed: false });
    expect(await afterDepartmentChange(superadmin, target, same.departmentChange)).toEqual([]);
    expect(mocks.revokeDepartmentAccessEffects).not.toHaveBeenCalled();
    // Status-only edits never touch departments.
    expect((await patch(superadmin, { status: "active" })).departmentChange).toBeNull();
  });

  it("adding PHOTO_RETOUCH needs production roles; roles outside PHOTO_RETOUCH are refused", async () => {
    db.state.handler = answer({ departments: ["PRODUCTION"] });
    expect(await failure(patch(superadmin, { departments: ["PHOTO_RETOUCH", "PRODUCTION"] }))).toEqual({ code: "PRODUCTION_ROLES_REQUIRED", status: 400 });
    expect(await failure(patch(superadmin, { departments: ["PHOTO_RETOUCH"], productionRoles: [] }))).toEqual({
      code: "PRODUCTION_ROLES_REQUIRED",
      status: 400
    });
    expect(await failure(patch(superadmin, { productionRoles: ["STAFF"] }))).toEqual({ code: "PRODUCTION_ROLES_NOT_ALLOWED", status: 400 });
    expect(statements("INSERT INTO production.user_roles")).toHaveLength(0);

    const { departmentChange } = await patch(superadmin, { departments: ["PHOTO_RETOUCH", "PRODUCTION"], productionRoles: ["QC"] });
    expect(departmentChange).toMatchObject({ added: ["PHOTO_RETOUCH"], rolesAfter: ["QC"], changed: true });
    expect(statements("INSERT INTO production.user_roles")[0]!.values).toContainEqual(["QC"]);
    expect(statements("INSERT INTO production.member_profiles")).toHaveLength(1);
  });

  it("at least one department; a superadmin demoted without departments is refused", async () => {
    db.state.handler = answer({ departments: ["PRODUCTION"] });
    expect(await failure(patch(superadmin, { departments: [] }))).toEqual({ code: "DEPARTMENTS_REQUIRED", status: 400 });

    db.state.handler = answer({ roleKey: "superadmin", departments: [] });
    expect(await failure(patch(superadmin, { roleId: memberRoleId }))).toEqual({ code: "DEPARTMENTS_REQUIRED", status: 400 });
    // With departments it works: the implicit departments not kept are revoked and the implicit ADMIN is lost.
    const { departmentChange } = await patch(superadmin, { roleId: memberRoleId, departments: ["PRODUCTION"] });
    expect(departmentChange).toMatchObject({ departments: ["PRODUCTION"], removed: ["PHOTO_RETOUCH"], removedRoles: ["ADMIN"], changed: true });
    expect(mocks.revokeDepartmentAccessEffects).toHaveBeenCalledWith(expect.anything(), superadmin, target, "PHOTO_RETOUCH");
    // Promoting to superadmin needs no department: every department implicitly, rows left as they are.
    db.state.handler = answer({ departments: ["PRODUCTION"] });
    db.state.calls = [];
    const promoted = await patch(superadmin, { roleId: superRoleId });
    expect(promoted.departmentChange).toBeNull();
    expect(statements("DELETE FROM public.user_departments")).toHaveLength(0);
  });

  it("escalation: only departments the caller belongs to; production roles granted or removed only by the superadmin (PD-050)", async () => {
    const productionManager = contextWith({ departments: ["PRODUCTION"], productionRoles: [] });
    db.state.handler = answer({ departments: ["PHOTO_RETOUCH"] });
    expect(await failure(patch(productionManager, { departments: ["PRODUCTION"] }))).toEqual({ code: "DEPARTMENT_ESCALATION", status: 403 });
    // Joining Photo Retouch with its roles kept (none taken away, none granted) is a plain department change.
    expect(await failure(patch(productionManager, { departments: ["PHOTO_RETOUCH", "PRODUCTION"] }))).toBeNull();

    const retouchLeader = contextWith({ departments: ["PHOTO_RETOUCH"], productionRoles: ["LEADER", "STAFF"] });
    db.state.handler = answer({ departments: ["PHOTO_RETOUCH"], roles: ["STAFF"] });
    expect(await failure(patch(retouchLeader, { productionRoles: ["STAFF", "LEADER"] }))).toEqual({ code: "PRODUCTION_ROLE_ESCALATION", status: 403 });
    // PD-050: taking a Photo Retouch role away is the superadmin's alone too.
    expect(await failure(patch(retouchLeader, { productionRoles: [] }))).toEqual({ code: "PRODUCTION_ROLE_ESCALATION", status: 403 });
    expect(await failure(patch(superadmin, { productionRoles: ["STAFF", "LEADER"] }))).toBeNull();
  });
});

describe("list (GET /organization/members)", () => {
  it("returns departments (superadmin: all) and filters by department, superadmin included", async () => {
    db.state.handler = (call) =>
      call.text.includes("AS role_permissions")
        ? [memberListRow(me, "superadmin", null), memberListRow(target, "member", ["PRODUCTION"])]
        : undefined;
    const page = await listOrganizationMembers(superadmin, { limit: 1, department: "PRODUCTION" });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.departments).toEqual(["PHOTO_RETOUCH", "PRODUCTION"]);
    expect(page.pageInfo.hasMore).toBe(true);
    expect(page.pageInfo.nextCursor).not.toBeNull();
    const filter = db.state.calls.find((call) => call.text.includes("r.key = 'superadmin' OR EXISTS"))!;
    expect(filter.text).toContain("ud.department = $");
    expect(filter.values).toContain("PRODUCTION");

    const all = await listOrganizationMembers(superadmin, { limit: 10 });
    expect(all.items.map((item) => item.departments)).toEqual([["PHOTO_RETOUCH", "PRODUCTION"], ["PRODUCTION"]]);
    db.state.calls = [];
    await listOrganizationMembers(superadmin, { limit: 10 });
    expect(db.state.calls.some((call) => call.text.includes("ud.department = $"))).toBe(false);
  });
});
