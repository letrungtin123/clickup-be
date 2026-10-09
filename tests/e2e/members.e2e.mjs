import { quote, softDeleteTestAccounts } from "./cleanup.mjs";
import { base, bumpAuthz, localSql, session } from "./lib.mjs";
const ok = (label, cond, extra = "") => console.log(`${cond ? "PASS" : "FAIL"}  ${label} ${extra}`);

const mgr = await session("MANAGER");
const member = await session("MEMBER_A");
const roles = (await mgr.call("GET", "/roles")).body;
const memberRole = roles.items?.find((role) => role.key === "member");
const superRole = roles.items?.find((role) => role.key === "superadmin");
ok("manager lists roles", Boolean(memberRole && superRole), `${roles.items?.length ?? roles.error?.code} roles`);

// Test-only identifiers (cleanup below and the runner's leftover sweep key on these exact shapes).
const email = `e2e.member.${Date.now()}@nesso.test`;
const roleKey = `r_${Date.now()}`;
try {
  let r = await member.call("POST", "/organization/members", { email, displayName: "Nope", roleId: memberRole.id });
  ok("member without member.manage cannot create (403)", r.status === 403, r.body?.error?.code);
  r = await mgr.call("POST", "/organization/members", { email, displayName: "Super Nope", roleId: superRole.id });
  ok("manager cannot assign superadmin (403)", r.status === 403, r.body?.error?.code);
  r = await mgr.call("POST", "/organization/members", { email, displayName: "E2E Người Mới", roleId: memberRole.id });
  ok("manager creates member", r.status === 201 && r.body.temporaryPassword?.length === 16, r.body?.error?.code ?? "");
  const temp = r.body.temporaryPassword;
  const membershipId = r.body.member?.id;
  r = await mgr.call("POST", "/organization/members", { email, displayName: "dup", roleId: memberRole.id });
  ok("duplicate member rejected (409)", r.status === 409, r.body?.error?.code);

  // New user signs in with the temporary password
  const cookies = new Map();
  const cookieHeader = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  let csrf = null;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { "content-type": "application/json", cookie: cookieHeader(), ...(csrf ? { "x-csrf-token": csrf } : {}) }, body: body ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); if (kv.slice(i + 1)) cookies.set(kv.slice(0, i), kv.slice(i + 1)); }
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  csrf = (await call("GET", "/auth/csrf")).body.csrfToken;
  r = await call("POST", "/auth/login", { email, password: temp });
  ok("new user logs in with temp password", r.status === 200);
  r = await call("GET", "/workspace/context");
  ok("context flags mustChangePassword", r.body?.mustChangePassword === true);
  r = await call("GET", "/projects");
  ok("business API blocked until password changed", r.status === 403 && r.body.error.code === "PASSWORD_CHANGE_REQUIRED");
  r = await call("POST", "/auth/change-password", { currentPassword: temp, newPassword: "short" });
  ok("weak password rejected", r.status === 400);
  r = await call("POST", "/auth/change-password", { currentPassword: "wrong-password-1", newPassword: "BrandNewPass2026" });
  ok("wrong current password rejected", r.status === 400, r.body?.error?.code);
  r = await call("POST", "/auth/change-password", { currentPassword: temp, newPassword: "BrandNewPass2026" });
  ok("password changed", r.status === 200);
  r = await call("GET", "/projects");
  ok("business API unlocked", r.status === 200);

  // Reset by admin revokes the session
  r = await mgr.call("POST", `/organization/members/${membershipId}/reset-password`);
  ok("admin reset password", r.status === 200 && r.body.temporaryPassword?.length === 16);
  r = await call("GET", "/auth/me");
  ok("old session revoked after reset", r.status === 401, r.body?.error?.code);

  // Disable member
  r = await mgr.call("PATCH", `/organization/members/${membershipId}`, { status: "disabled" });
  ok("disable member", r.status === 200 && r.body.status === "disabled");
  csrf = (await call("GET", "/auth/csrf")).body.csrfToken;
  r = await call("POST", "/auth/login", { email, password: "BrandNewPass2026" });
  r = await call("GET", "/projects");
  ok("disabled member gets no access", r.status === 403 || r.status === 401, `${r.status} ${r.body?.error?.code}`);

  // Escalation: manager cannot grant permissions it lacks
  r = await mgr.call("POST", "/roles", { key: roleKey, name: "Escalate", permissions: ["role.delete"] });
  ok("cannot create role with permissions you lack", r.status === 403, r.body?.error?.code);
} finally {
  // There is no API to remove an account: disable it (above), then soft-delete membership + profile.
  softDeleteTestAccounts([email]);
  // The escalation attempt must fail; should it ever succeed, do not leave the role behind.
  localSql(`DELETE FROM public.roles WHERE key = ${quote(roleKey)} AND NOT EXISTS (SELECT 1 FROM public.organization_memberships om WHERE om.role_id = roles.id);`);
  bumpAuthz();
}
