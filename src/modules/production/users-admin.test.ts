import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreateProductionUserRequestSchema, UpdateProductionUserRequestSchema } from "../../contracts/users-admin.js";
import type { AccessContext } from "../access/access-context.js";

/**
 * Production user administration (PD-024, PD-041): who may do what, and the follow-ups of a role or department change.
 * The workspace member services, the catalog update, job chats, department access effects and realtime are mocked; a
 * fake tagged-template `sql` answers the target lookups and records every statement.
 */
type Call = { text: string; values: unknown[] };

const db = vi.hoisted(() => {
  const state = { calls: [] as Call[], handler: (() => []) as (call: Call) => unknown[] | undefined };
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("$").replace(/\s+/g, " ").trim();
    const call = { text, values };
    state.calls.push(call);
    return Promise.resolve(state.handler(call) ?? []);
  };
  const fake = Object.assign(sql, { json: (value: unknown) => value, begin: <T>(fn: (tx: unknown) => Promise<T>) => fn(fake) });
  return { state, sql: fake };
});

const mocks = vi.hoisted(() => ({
  provision: vi.fn(),
  issueTemporaryPassword: vi.fn(() => Promise.resolve({ temporaryPassword: "Temp-Password-123" })),
  afterMembershipStatusChange: vi.fn(() => Promise.resolve()),
  writeMemberDepartments: vi.fn(() => Promise.resolve()),
  updateMember: vi.fn(),
  syncJobChatsForMember: vi.fn(() => Promise.resolve(0)),
  disconnectUsers: vi.fn(),
  invalidateAccessContexts: vi.fn(() => Promise.resolve()),
  enqueueDomainEvents: vi.fn(() => Promise.resolve()),
  listOpenJobsLedBy: vi.fn(),
  revokeDepartmentAccessEffects: vi.fn(() => Promise.resolve([] as unknown[])),
  publishDepartmentAccessRevoked: vi.fn(() => Promise.resolve())
}));

vi.mock("../../db/client.js", () => ({ getSql: () => db.sql }));
vi.mock("../workspace/members.service.js", () => ({
  provisionOrganizationMember: mocks.provision,
  issueTemporaryPassword: mocks.issueTemporaryPassword,
  afterMembershipStatusChange: mocks.afterMembershipStatusChange,
  writeMemberDepartments: mocks.writeMemberDepartments
}));
vi.mock("./catalog.service.js", () => ({ updateMember: mocks.updateMember }));
vi.mock("./job-chat.service.js", () => ({ syncJobChatsForMember: mocks.syncJobChatsForMember }));
vi.mock("../../realtime/publisher.js", () => ({ disconnectUsers: mocks.disconnectUsers }));
vi.mock("../access/access-context.js", () => ({ invalidateAccessContexts: mocks.invalidateAccessContexts }));
vi.mock("../events/outbox.js", () => ({ enqueueDomainEvents: mocks.enqueueDomainEvents }));
vi.mock("./member-lookups.js", () => ({ listOpenJobsLedBy: mocks.listOpenJobsLedBy }));
vi.mock("../work/department-access.js", () => ({
  revokeDepartmentAccessEffects: mocks.revokeDepartmentAccessEffects,
  publishDepartmentAccessRevoked: mocks.publishDepartmentAccessRevoked
}));

const { createProductionUser, updateProductionUser, setProductionUserActive, resetProductionUserPassword, getLedJobs } = await import(
  "./users-admin.service.js"
);

const org = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const target = "33333333-3333-4333-8333-333333333333";
const teamId = "44444444-4444-4444-8444-444444444444";
const jobId = "55555555-5555-4555-8555-555555555555";
const memberRoleId = "66666666-6666-4666-8666-666666666666";

const contextWith = (roles: string[], superadmin = false, userId = me, departments: string[] = ["PHOTO_RETOUCH"]) =>
  ({
    user: { id: userId, displayName: "Me", email: null },
    organization: { id: org, slug: "o", name: "O" },
    hasFullOrganizationAuthority: superadmin,
    productionRoles: roles,
    departments: superadmin ? ["PHOTO_RETOUCH", "PRODUCTION"] : departments,
    canSwitchDepartment: superadmin || departments.length > 1,
    mustChangePassword: false,
    role: { id: "r", organizationId: org, key: superadmin ? "superadmin" : "member", name: "x", permissions: [] }
  }) as unknown as AccessContext;
const admin = contextWith(["ADMIN"]);
const superadmin = contextWith([], true);

type TargetRow = { status: string; role_key: string; org_admin: boolean; roles: string[] | null; departments?: string[] | null };
const memberRow = (roles: string[], active = true, departments: string[] = ["PHOTO_RETOUCH"]) => ({
  user_id: target,
  display_name: "Người A",
  email: "a@example.test",
  avatar_url: null,
  status: active ? "active" : "disabled",
  roles,
  superadmin: false,
  departments,
  team_id: null,
  custom_values: {},
  tag_ids: null
});
/** Answers the target lookups: account target, production member row, default role, team, department / role rows. */
const answer =
  (options: { target?: TargetRow; member?: ReturnType<typeof memberRow>; role?: { id: string; org_admin: boolean } | null; team?: boolean }) =>
  (call: Call) => {
    if (call.text.includes("AS org_admin, (SELECT array_agg(ur.role_code)")) {
      return options.target ? [{ departments: ["PHOTO_RETOUCH"], ...options.target }] : [];
    }
    if (call.text.startsWith("SELECT department FROM public.user_departments")) {
      return (options.target?.departments ?? ["PHOTO_RETOUCH"]).map((department) => ({ department }));
    }
    if (call.text.startsWith("SELECT role_code FROM production.user_roles")) {
      return (options.target?.roles ?? []).map((role_code) => ({ role_code }));
    }
    if (call.text.includes("mp.team_id, mp.custom_values")) {
      return options.member ? [options.member] : [];
    }
    if (call.text.includes("FROM public.roles r WHERE r.organization_id")) {
      return options.role ? [options.role] : [];
    }
    if (call.text.startsWith("SELECT 1 FROM production.teams")) {
      return options.team ? [{ "?column?": 1 }] : [];
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
const plainTarget: TargetRow = { status: "active", role_key: "member", org_admin: false, roles: ["LEADER", "QC"] };
const ledJob = { id: jobId, code: "JOB-1", name: null, deadline: "2026-10-20T00:00:00.000Z", jobStatus: { id: jobId, name: "Đang làm", color: "blue" as const, isClosed: false }, taskCount: 2 };

/** `updateMember` stand-in: runs the in-transaction hook (the department change) with the fake sql, then answers. */
const updateMemberRunsHook = (result: { userId: string; roles: string[]; departments?: string[] }) =>
  mocks.updateMember.mockImplementationOnce(async (_context: unknown, _userId: unknown, _input: unknown, hook?: (tx: unknown) => Promise<void>) => {
    if (hook) {
      await hook(db.sql);
    }
    return result;
  });
const statements = (prefix: string) => db.state.calls.filter((call) => call.text.startsWith(prefix));

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = () => [];
  for (const mock of Object.values(mocks)) {
    mock.mockReset();
  }
  mocks.issueTemporaryPassword.mockResolvedValue({ temporaryPassword: "Temp-Password-123" });
  mocks.afterMembershipStatusChange.mockResolvedValue(undefined);
  mocks.writeMemberDepartments.mockResolvedValue(undefined);
  mocks.syncJobChatsForMember.mockResolvedValue(0);
  mocks.invalidateAccessContexts.mockResolvedValue(undefined);
  mocks.enqueueDomainEvents.mockResolvedValue(undefined);
  mocks.revokeDepartmentAccessEffects.mockResolvedValue([]);
  mocks.publishDepartmentAccessRevoked.mockResolvedValue(undefined);
  mocks.listOpenJobsLedBy.mockResolvedValue({ displayName: "Người A", leaderActive: false, items: [] });
});

describe("only production ADMIN (superadmins included) may administer users", () => {
  it("STAFF / LEADER / ACCOUNT get 403 and nothing is read; non-members get 404", async () => {
    for (const roles of [["STAFF"], ["LEADER"], ["ACCOUNT", "QC"]]) {
      const context = contextWith(roles);
      expect(
        await failure(
          createProductionUser(
            context,
            CreateProductionUserRequestSchema.parse({ email: "x@example.test", displayName: "X", departments: ["PHOTO_RETOUCH"], roles: ["STAFF"] })
          )
        )
      ).toEqual({ code: "FORBIDDEN", status: 403 });
      expect(await failure(setProductionUserActive(context, target, false))).toEqual({ code: "FORBIDDEN", status: 403 });
      expect(await failure(resetProductionUserPassword(context, target))).toEqual({ code: "FORBIDDEN", status: 403 });
      expect(await failure(updateProductionUser(context, target, { roles: ["STAFF"] }))).toEqual({ code: "FORBIDDEN", status: 403 });
      expect(await failure(updateProductionUser(context, target, { departments: ["PRODUCTION"] }))).toEqual({ code: "FORBIDDEN", status: 403 });
    }
    expect(await failure(setProductionUserActive(contextWith([]), target, false))).toEqual({ code: "PRODUCTION_NOT_FOUND", status: 404 });
    expect(db.state.calls).toHaveLength(0);
    expect(mocks.afterMembershipStatusChange).not.toHaveBeenCalled();
  });

  it("led jobs are readable by ADMIN and ACCOUNT, not by STAFF", async () => {
    db.state.handler = answer({ member: memberRow(["LEADER"]) });
    mocks.listOpenJobsLedBy.mockResolvedValue({ displayName: "Người A", leaderActive: true, items: [ledJob] });
    expect(await getLedJobs(contextWith(["ACCOUNT"]), target)).toMatchObject({ userId: target, leaderActive: true, items: [ledJob] });
    expect(await failure(getLedJobs(contextWith(["STAFF"]), target))).toEqual({ code: "FORBIDDEN", status: 403 });
  });
});

describe("escalation guards", () => {
  it("never on an organization superadmin — not even for another superadmin", async () => {
    db.state.handler = answer({ target: { status: "active", role_key: "superadmin", org_admin: true, roles: null } });
    for (const context of [admin, superadmin]) {
      expect(await failure(setProductionUserActive(context, target, false))).toEqual({ code: "ORG_ADMIN_PROTECTED", status: 403 });
      expect(await failure(resetProductionUserPassword(context, target))).toEqual({ code: "ORG_ADMIN_PROTECTED", status: 403 });
      // A superadmin implicitly belongs to every department: their departments are not edited here.
      expect(await failure(updateProductionUser(context, target, { departments: ["PHOTO_RETOUCH"] }))).toEqual({ code: "ORG_ADMIN_PROTECTED", status: 403 });
    }
    expect(await failure(updateProductionUser(admin, target, { roles: ["STAFF"] }))).toEqual({ code: "ORG_ADMIN_PROTECTED", status: 403 });
    expect(mocks.issueTemporaryPassword).not.toHaveBeenCalled();
    expect(mocks.updateMember).not.toHaveBeenCalled();
    expect(db.state.calls.some((call) => call.text.startsWith("UPDATE public.organization_memberships"))).toBe(false);
  });

  it("organization admins (member.manage / role.*): only a superadmin may disable, reset, re-role or move them", async () => {
    db.state.handler = answer({ target: { status: "active", role_key: "manager", org_admin: true, roles: ["QC"] }, member: memberRow(["QC"], false) });
    expect(await failure(setProductionUserActive(admin, target, false))).toEqual({ code: "ORG_ADMIN_PROTECTED", status: 403 });
    expect(await failure(resetProductionUserPassword(admin, target))).toEqual({ code: "ORG_ADMIN_PROTECTED", status: 403 });
    expect(await failure(updateProductionUser(admin, target, { roles: ["QC", "LEADER"] }))).toEqual({ code: "ORG_ADMIN_PROTECTED", status: 403 });
    expect(await failure(updateProductionUser(admin, target, { departments: ["PHOTO_RETOUCH", "PRODUCTION"] }))).toEqual({
      code: "ORG_ADMIN_PROTECTED",
      status: 403
    });
    // Profile data (team, custom fields, tags) stays editable; resending the same departments is no change.
    mocks.updateMember.mockResolvedValueOnce({ userId: target, roles: ["QC"] });
    expect(await updateProductionUser(admin, target, { teamId })).toMatchObject({ orphanedJobs: [] });
    mocks.updateMember.mockResolvedValueOnce({ userId: target, roles: ["QC"] });
    expect(await updateProductionUser(admin, target, { departments: ["PHOTO_RETOUCH"], teamId })).toMatchObject({ orphanedJobs: [] });
    // A superadmin may.
    await setProductionUserActive(superadmin, target, false);
    expect(mocks.afterMembershipStatusChange).toHaveBeenCalledWith(target, "disabled");
  });

  it("not on yourself: no self-deactivation, no self-reset (use change password)", async () => {
    db.state.handler = answer({ target: plainTarget });
    expect(await failure(setProductionUserActive(admin, me, false))).toEqual({ code: "SELF_DEACTIVATE_FORBIDDEN", status: 409 });
    expect(await failure(resetProductionUserPassword(admin, me))).toEqual({ code: "SELF_RESET_FORBIDDEN", status: 409 });
  });

  it("the body cannot carry an organization role or unknown fields; departments required, production roles iff PHOTO_RETOUCH", () => {
    const base = { email: "x@example.test", displayName: "X" };
    const retouch = { ...base, departments: ["PHOTO_RETOUCH"] };
    expect(CreateProductionUserRequestSchema.safeParse({ ...retouch, roles: ["STAFF"], roleId: memberRoleId }).success).toBe(false);
    expect(CreateProductionUserRequestSchema.safeParse({ ...retouch, roles: [] }).success).toBe(false);
    expect(CreateProductionUserRequestSchema.safeParse({ ...retouch, roles: ["OWNER"] }).success).toBe(false);
    expect(CreateProductionUserRequestSchema.safeParse({ ...base, roles: ["STAFF"] }).success).toBe(false);
    expect(CreateProductionUserRequestSchema.safeParse({ ...base, departments: [], roles: [] }).success).toBe(false);
    expect(CreateProductionUserRequestSchema.safeParse({ ...base, departments: ["PRODUCTION"], roles: ["STAFF"] }).success).toBe(false);
    expect(CreateProductionUserRequestSchema.parse({ ...base, departments: ["PRODUCTION"] })).toMatchObject({ departments: ["PRODUCTION"], roles: [] });
    expect(CreateProductionUserRequestSchema.parse({ ...retouch, email: " X@Example.TEST ", roles: ["QC", "QC", "STAFF"] })).toMatchObject({
      email: "x@example.test",
      roles: ["QC", "STAFF"],
      allowGoogleSignIn: true
    });
    expect(UpdateProductionUserRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateProductionUserRequestSchema.safeParse({ departments: [] }).success).toBe(false);
    expect(UpdateProductionUserRequestSchema.parse({ departments: ["PRODUCTION", "PHOTO_RETOUCH", "PRODUCTION"] })).toEqual({
      departments: ["PHOTO_RETOUCH", "PRODUCTION"]
    });
  });
});

describe("create", () => {
  const input = CreateProductionUserRequestSchema.parse({
    email: "new@example.test",
    displayName: "Người Mới",
    departments: ["PHOTO_RETOUCH"],
    roles: ["STAFF", "QC"],
    teamId
  });
  const provisionRunsExtra = (tx: Call[]) =>
    mocks.provision.mockImplementationOnce(async (_context: unknown, account: { roleId: string }, extra: (tx: unknown, userId: string) => Promise<void>) => {
      expect(account.roleId).toBe(memberRoleId);
      const record = (strings: TemplateStringsArray, ...values: unknown[]) => {
        tx.push({ text: strings.join("$").replace(/\s+/g, " ").trim(), values });
        return Promise.resolve([]);
      };
      await extra(record, target);
      return { member: { user: { id: target } }, temporaryPassword: "Temp-Password-123" };
    });

  it("uses the organization's default member role, adds departments + roles + team + whitelist in the same transaction", async () => {
    db.state.handler = answer({ role: { id: memberRoleId, org_admin: false }, team: true, member: memberRow(["QC", "STAFF"]) });
    const tx: Call[] = [];
    provisionRunsExtra(tx);
    const created = await createProductionUser(admin, input);
    expect(created).toMatchObject({
      temporaryPassword: "Temp-Password-123",
      member: { userId: target, roles: ["QC", "STAFF"], departments: ["PHOTO_RETOUCH"] }
    });
    expect(mocks.writeMemberDepartments).toHaveBeenCalledWith(expect.anything(), admin, {
      userId: target,
      departments: ["PHOTO_RETOUCH"],
      productionRoles: ["STAFF", "QC"]
    });
    expect(tx.some((call) => call.text.startsWith("INSERT INTO production.member_profiles") && call.values.includes(teamId))).toBe(true);
    expect(tx.some((call) => call.text.startsWith("INSERT INTO public.allowed_emails") && call.values.includes("new@example.test"))).toBe(true);
  });

  it("a Production-only account gets no production role", async () => {
    db.state.handler = answer({ role: { id: memberRoleId, org_admin: false }, member: memberRow([], true, ["PRODUCTION"]) });
    provisionRunsExtra([]);
    const productionOnly = CreateProductionUserRequestSchema.parse({ email: "p@example.test", displayName: "P", departments: ["PRODUCTION"] });
    // The caller must belong to PRODUCTION to hand it out.
    expect(await failure(createProductionUser(admin, productionOnly))).toEqual({ code: "DEPARTMENT_ESCALATION", status: 403 });
    expect(mocks.provision).not.toHaveBeenCalled();
    const both = contextWith(["ADMIN"], false, me, ["PHOTO_RETOUCH", "PRODUCTION"]);
    expect(await createProductionUser(both, productionOnly)).toMatchObject({ member: { roles: [], departments: ["PRODUCTION"] } });
    expect(mocks.writeMemberDepartments).toHaveBeenCalledWith(expect.anything(), both, { userId: target, departments: ["PRODUCTION"], productionRoles: [] });
  });

  it("refuses when the default role is missing or carries organization admin permissions", async () => {
    db.state.handler = answer({ role: null });
    expect(await failure(createProductionUser(admin, input))).toEqual({ code: "DEFAULT_ROLE_MISSING", status: 409 });
    db.state.handler = answer({ role: { id: memberRoleId, org_admin: true } });
    expect(await failure(createProductionUser(admin, input))).toEqual({ code: "DEFAULT_ROLE_UNSAFE", status: 409 });
    db.state.handler = answer({ role: { id: memberRoleId, org_admin: false }, team: false });
    expect(await failure(createProductionUser(admin, input))).toEqual({ code: "TEAM_NOT_FOUND", status: 404 });
    expect(mocks.provision).not.toHaveBeenCalled();
  });
});

describe("role changes (SEC2-04 follow-up)", () => {
  it("removing LEADER from someone who still leads open jobs returns them, notifies admins and reconciles job chats", async () => {
    db.state.handler = answer({ target: plainTarget });
    mocks.updateMember.mockResolvedValueOnce({ userId: target, roles: ["QC"] });
    mocks.listOpenJobsLedBy.mockResolvedValueOnce({ displayName: "Người A", leaderActive: false, items: [ledJob] });
    const result = await updateProductionUser(admin, target, { roles: ["QC"] });
    expect(result.orphanedJobs).toEqual([ledJob]);
    expect(mocks.syncJobChatsForMember).toHaveBeenCalledWith(admin, target);
    expect(mocks.disconnectUsers).toHaveBeenCalledWith([target]);
    expect(mocks.enqueueDomainEvents).toHaveBeenCalledTimes(1);
    const [, events] = mocks.enqueueDomainEvents.mock.calls[0] as unknown as [unknown, { type: string; payload: Record<string, unknown> }[]];
    expect(events[0]).toMatchObject({ type: "production.member.leader_removed", payload: { userId: target, reason: "role_removed" } });
  });

  it("no event and no chat sync when nothing leading was removed or the roles did not change", async () => {
    db.state.handler = answer({ target: plainTarget });
    mocks.updateMember.mockResolvedValueOnce({ userId: target, roles: ["LEADER", "QC", "STAFF"] });
    expect(await updateProductionUser(admin, target, { roles: ["LEADER", "QC", "STAFF"] })).toMatchObject({ orphanedJobs: [] });
    mocks.updateMember.mockResolvedValueOnce({ userId: target, roles: ["LEADER", "QC"] });
    expect(await updateProductionUser(admin, target, { roles: ["QC", "LEADER"] })).toMatchObject({ orphanedJobs: [] });
    expect(mocks.syncJobChatsForMember).not.toHaveBeenCalled();
    expect(mocks.enqueueDomainEvents).not.toHaveBeenCalled();
  });

  it("deactivation ends sessions (shared flow), leaves job chats and reports the jobs still led", async () => {
    db.state.handler = answer({ target: plainTarget, member: memberRow(["LEADER", "QC"], false) });
    mocks.listOpenJobsLedBy.mockResolvedValueOnce({ displayName: "Người A", leaderActive: false, items: [ledJob] });
    const result = await setProductionUserActive(admin, target, false);
    expect(db.state.calls.some((call) => call.text.startsWith("UPDATE public.organization_memberships") && call.values.includes("disabled"))).toBe(true);
    expect(mocks.invalidateAccessContexts).toHaveBeenCalled();
    expect(mocks.afterMembershipStatusChange).toHaveBeenCalledWith(target, "disabled");
    expect(mocks.syncJobChatsForMember).toHaveBeenCalledWith(admin, target);
    expect(result).toMatchObject({ member: { active: false }, orphanedJobs: [ledJob] });
    expect(mocks.enqueueDomainEvents).toHaveBeenCalledTimes(1);
  });

  it("reset password issues a one-time password for an ordinary account", async () => {
    db.state.handler = answer({ target: plainTarget });
    expect(await resetProductionUserPassword(admin, target)).toEqual({ temporaryPassword: "Temp-Password-123" });
    expect(mocks.issueTemporaryPassword).toHaveBeenCalledWith(target);
  });
});

describe("department changes (PD-041)", () => {
  const both = contextWith(["ADMIN"], false, me, ["PHOTO_RETOUCH", "PRODUCTION"]);
  const leaderInBoth: TargetRow = { status: "active", role_key: "member", org_admin: false, roles: ["LEADER", "QC"], departments: ["PHOTO_RETOUCH", "PRODUCTION"] };

  it("leaving PHOTO_RETOUCH removes every production role with the PD-024 follow-ups (same transaction)", async () => {
    db.state.handler = answer({ target: leaderInBoth });
    updateMemberRunsHook({ userId: target, roles: [], departments: ["PRODUCTION"] });
    mocks.listOpenJobsLedBy.mockResolvedValueOnce({ displayName: "Người A", leaderActive: false, items: [ledJob] });
    mocks.revokeDepartmentAccessEffects.mockResolvedValueOnce([{ id: jobId, projectId: jobId, listId: jobId, parentTaskId: null }]);
    const result = await updateProductionUser(admin, target, { departments: ["PRODUCTION"] });

    const departmentDelete = statements("DELETE FROM public.user_departments")[0]!;
    expect(departmentDelete.values).toContainEqual(["PHOTO_RETOUCH"]);
    const roleDelete = statements("DELETE FROM production.user_roles")[0]!;
    expect(roleDelete.values).toContainEqual(["LEADER", "QC"]);
    expect(statements("INSERT INTO production.user_roles")).toHaveLength(0);
    expect(mocks.revokeDepartmentAccessEffects).toHaveBeenCalledWith(expect.anything(), admin, target, "PHOTO_RETOUCH");
    expect(mocks.publishDepartmentAccessRevoked).toHaveBeenCalledWith(admin, target, "PHOTO_RETOUCH", [
      { id: jobId, projectId: jobId, listId: jobId, parentTaskId: null }
    ]);
    expect(mocks.disconnectUsers).toHaveBeenCalledWith([target]);
    expect(mocks.syncJobChatsForMember).toHaveBeenCalledWith(admin, target);
    expect(result.orphanedJobs).toEqual([ledJob]);
    expect(mocks.enqueueDomainEvents).toHaveBeenCalledTimes(1);
  });

  it("joining PHOTO_RETOUCH needs production roles; they are granted with a production profile row", async () => {
    const productionOnly: TargetRow = { status: "active", role_key: "member", org_admin: false, roles: null, departments: ["PRODUCTION"] };
    db.state.handler = answer({ target: productionOnly });
    updateMemberRunsHook({ userId: target, roles: [] });
    expect(await failure(updateProductionUser(both, target, { departments: ["PHOTO_RETOUCH", "PRODUCTION"] }))).toEqual({
      code: "PRODUCTION_ROLES_REQUIRED",
      status: 400
    });

    db.state.calls = [];
    updateMemberRunsHook({ userId: target, roles: ["STAFF"] });
    await updateProductionUser(both, target, { departments: ["PHOTO_RETOUCH", "PRODUCTION"], roles: ["STAFF"] });
    expect(statements("INSERT INTO public.user_departments")[0]!.values).toContainEqual(["PHOTO_RETOUCH"]);
    expect(statements("INSERT INTO production.user_roles")[0]!.values).toContainEqual(["STAFF"]);
    expect(statements("INSERT INTO production.member_profiles")).toHaveLength(1);
    expect(mocks.revokeDepartmentAccessEffects).not.toHaveBeenCalled();
  });

  it("production roles outside PHOTO_RETOUCH are refused; only departments the caller belongs to change", async () => {
    db.state.handler = answer({ target: leaderInBoth });
    updateMemberRunsHook({ userId: target, roles: [] });
    expect(await failure(updateProductionUser(admin, target, { departments: ["PRODUCTION"], roles: ["QC"] }))).toEqual({
      code: "PRODUCTION_ROLES_NOT_ALLOWED",
      status: 400
    });
    // `admin` is only in PHOTO_RETOUCH: removing PRODUCTION is an escalation.
    updateMemberRunsHook({ userId: target, roles: ["LEADER", "QC"] });
    expect(await failure(updateProductionUser(admin, target, { departments: ["PHOTO_RETOUCH"] }))).toEqual({
      code: "DEPARTMENT_ESCALATION",
      status: 403
    });
    expect(statements("DELETE FROM public.user_departments")).toHaveLength(0);
  });

  it("you cannot drop your own ADMIN by leaving PHOTO_RETOUCH", async () => {
    db.state.handler = answer({ target: { status: "active", role_key: "member", org_admin: false, roles: ["ADMIN"], departments: ["PHOTO_RETOUCH", "PRODUCTION"] } });
    updateMemberRunsHook({ userId: me, roles: [] });
    expect(await failure(updateProductionUser(both, me, { departments: ["PRODUCTION"] }))).toEqual({ code: "SELF_ADMIN_REMOVAL", status: 409 });
  });
});
