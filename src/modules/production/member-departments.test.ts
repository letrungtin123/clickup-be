import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessContext } from "../access/access-context.js";

/**
 * Production member list / update and departments (PD-041): production roles only exist inside PHOTO_RETOUCH
 * (PATCH /production/members/:userId refuses them elsewhere), the list carries departments and pickers only get Photo
 * Retouch members holding a role. Fake tagged-template `sql`, no database.
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

vi.mock("../../db/client.js", () => ({ getSql: () => db.sql }));
vi.mock("../../lib/redis.js", () => ({ getOptionalRedis: () => undefined }));
vi.mock("../access/access-context.js", () => ({ invalidateAccessContexts: vi.fn(() => Promise.resolve()) }));

const { listMembers, updateMember } = await import("./catalog.service.js");

const org = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const target = "33333333-3333-4333-8333-333333333333";

const contextWith = (roles: string[]) =>
  ({
    user: { id: me, displayName: "Me", email: null },
    organization: { id: org, slug: "o", name: "O" },
    hasFullOrganizationAuthority: false,
    productionRoles: roles,
    departments: ["PHOTO_RETOUCH"],
    canSwitchDepartment: false,
    mustChangePassword: false,
    role: { id: "r", organizationId: org, key: "member", name: "x", permissions: [] }
  }) as unknown as AccessContext;
const admin = contextWith(["ADMIN"]);

const row = (userId: string, name: string, roles: string[] | null, departments: string[] | null, superadmin = false) => ({
  user_id: userId,
  display_name: name,
  email: null,
  avatar_url: null,
  status: "active",
  roles,
  superadmin,
  departments,
  team_id: null,
  custom_values: {},
  tag_ids: null
});

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return { code: (error as { code?: string }).code, status: (error as { statusCode?: number }).statusCode };
  }
  return null;
};
const statements = (prefix: string) => db.state.calls.filter((call) => call.text.startsWith(prefix));

/** One member (in PHOTO_RETOUCH or not) for the update; the department check answers accordingly. */
const memberAnswer = (inRetouch: boolean) => (call: Call) => {
  if (call.text.includes("mp.team_id, mp.custom_values")) {
    return [row(target, "Người A", inRetouch ? ["STAFF"] : null, inRetouch ? ["PHOTO_RETOUCH"] : ["PRODUCTION"])];
  }
  if (call.text === "SELECT $ AS member") {
    return [{ member: inRetouch }];
  }
  return undefined;
};

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = () => undefined;
});

describe("PATCH /production/members/:userId keeps production roles inside PHOTO_RETOUCH", () => {
  it("refuses roles for someone outside PHOTO_RETOUCH (no role written); removing all roles stays possible", async () => {
    db.state.handler = memberAnswer(false);
    expect(await failure(updateMember(admin, target, { roles: ["STAFF"] }))).toEqual({ code: "PRODUCTION_ROLES_NOT_ALLOWED", status: 400 });
    expect(statements("DELETE FROM production.user_roles")).toHaveLength(0);
    expect(statements("INSERT INTO production.user_roles")).toHaveLength(0);
    // The check is the shared SQL predicate (superadmins included).
    expect(db.state.calls.some((call) => call.text.startsWith("public.is_department_member("))).toBe(true);

    const member = await updateMember(admin, target, { roles: [] });
    expect(member).toMatchObject({ roles: [], departments: ["PRODUCTION"] });
    expect(statements("DELETE FROM production.user_roles")).toHaveLength(1);
  });

  it("grants roles to a Photo Retouch member; the in-transaction hook (department change) runs before the role write", async () => {
    db.state.handler = memberAnswer(true);
    const order: string[] = [];
    const member = await updateMember(admin, target, { roles: ["STAFF", "QC"] }, () => {
      order.push(`hook@${db.state.calls.length}`);
      return Promise.resolve();
    });
    expect(member).toMatchObject({ departments: ["PHOTO_RETOUCH"] });
    const hookAt = Number(order[0]!.split("@")[1]);
    const insertAt = db.state.calls.findIndex((call) => call.text.startsWith("INSERT INTO production.user_roles"));
    expect(insertAt).toBeGreaterThanOrEqual(hookAt);
  });
});

describe("GET /production/members carries departments", () => {
  const rows = [
    row(me, "A Superadmin", null, null, true),
    row(target, "B Retouch", ["QC"], ["PHOTO_RETOUCH"]),
    row("44444444-4444-4444-8444-444444444444", "C Production", null, ["PRODUCTION"]),
    row("55555555-5555-4555-8555-555555555555", "D Both", ["LEADER"], ["PRODUCTION", "PHOTO_RETOUCH"])
  ];

  it("admins get everyone with departments (superadmin: all); pickers only Photo Retouch members holding a role", async () => {
    db.state.handler = (call) => (call.text.includes("mp.team_id, mp.custom_values") ? rows : undefined);
    const all = await listMembers(admin);
    expect(all.items.map((member) => [member.displayName, member.departments])).toEqual([
      ["A Superadmin", ["PHOTO_RETOUCH", "PRODUCTION"]],
      ["B Retouch", ["PHOTO_RETOUCH"]],
      ["C Production", ["PRODUCTION"]],
      ["D Both", ["PHOTO_RETOUCH", "PRODUCTION"]]
    ]);
    const picker = await listMembers(contextWith(["LEADER"]));
    expect(picker.items.map((member) => member.displayName)).toEqual(["B Retouch", "D Both"]);
  });
});
