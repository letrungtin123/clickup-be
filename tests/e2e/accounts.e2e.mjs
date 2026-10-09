// Accounts, sessions and roles regressions of fix wave 1: BUG-WK-02/03/09/14, WK-33/34/37/38/39/40/59/30,
// SEC-API-04/07/11. Works on throw-away accounts (e2e.member.<ms>@nesso.test) and roles (r_e2e_<digits>)
// so the seeded accounts other suites use are never touched. Self-cleaning.
import { createRequire } from "node:module";
import { purgeTestRoles, quote, softDeleteTestAccounts } from "./cleanup.mjs";
import { apiOrigin, base, bumpAuthz, localSql, session } from "./lib.mjs";
const require = createRequire(process.cwd() + "/package.json");
const { io } = require("socket.io-client");
const ok = (label, cond, extra = "") => console.log(`${cond ? "PASS" : "FAIL"}  ${label} ${extra}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const origin = "http://127.0.0.1:5890";

/** Cookie + CSRF session for an arbitrary account (the seeded helper only knows seed accounts). */
const login = async (email, password) => {
  const cookies = new Map();
  let csrf = null;
  const cookieHeader = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", cookie: cookieHeader(), origin, ...(csrf ? { "x-csrf-token": csrf } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const index = pair.indexOf("=");
      if (pair.slice(index + 1)) cookies.set(pair.slice(0, index), pair.slice(index + 1));
      else cookies.delete(pair.slice(0, index));
    }
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  csrf = (await call("GET", "/auth/csrf")).body.csrfToken;
  const result = await call("POST", "/auth/login", { email, password });
  return { call, cookieHeader, status: result.status };
};

const mgr = await session("MANAGER");
const ctx = (await mgr.call("GET", "/workspace/context")).body;
const org = ctx.organization.id;
const memberRole = (await mgr.call("GET", "/roles")).body.items.find((role) => role.key === "member");
const stamp = Date.now();
const emails = { x: `e2e.member.${stamp}@nesso.test`, y: `e2e.member.${stamp + 1}@nesso.test`, z: `e2e.member.${stamp + 2}@nesso.test` };
const roleKeys = { low: `r_e2e_${stamp}1`, target: `r_e2e_${stamp}2`, manage: `r_e2e_${stamp}3`, admin: `r_e2e_${stamp}4` };
const projects = [];
let socketX = null;
let ids = {};

const createRole = (key, permissions) =>
  localSql(`
    WITH role AS (
      INSERT INTO public.roles (organization_id, key, name) VALUES (${quote(org)}, ${quote(key)}, ${quote(`E2E ${key}`)}) RETURNING id
    ), perms AS (
      INSERT INTO public.role_permissions (organization_id, role_id, permission_key)
      SELECT ${quote(org)}, role.id, p FROM role, unnest(ARRAY[${permissions.map(quote).join(",")}]::text[]) AS p
    )
    SELECT id FROM role
  `)[0];
const setRole = (userId, roleId) => {
  localSql(`UPDATE public.organization_memberships SET role_id = ${quote(roleId)} WHERE organization_id = ${quote(org)} AND user_id = ${quote(userId)} AND deleted_at IS NULL`);
  bumpAuthz();
};

try {
  // --- Account creation: one per address even on a double click (WK-33); e-mails as the DB accepts (WK-34)
  let r = await mgr.call("POST", "/organization/members", { email: emails.x, displayName: "E2E X", roleId: memberRole.id });
  const tempX = r.body.temporaryPassword;
  ids.x = r.body.member?.user.id;
  ok("create account X", r.status === 201, r.body?.error?.code ?? "");
  const both = await Promise.all([1, 2].map(() => mgr.call("POST", "/organization/members", { email: emails.y, displayName: "E2E Y", roleId: memberRole.id })));
  const winner = both.find((res) => res.status === 201);
  ok("double create: one 201, one 409", Boolean(winner) && both.filter((res) => res.status === 409).length === 1, both.map((res) => res.status).join(","));
  ids.y = winner?.body.member.user.id;
  const y = await login(emails.y, winner?.body.temporaryPassword);
  ok("the handed-out temporary password works", y.status === 200, y.status);
  r = await mgr.call("POST", "/organization/members", { email: `o'brien.${stamp}@nesso.test`, displayName: "Apostrophe", roleId: memberRole.id });
  ok("apostrophe e-mail rejected up front (400, not a DB error)", r.status === 400, r.status);
  r = await mgr.call("POST", "/organization/members", { email: emails.z, displayName: "E2E Z", roleId: memberRole.id });
  const tempZ = r.body.temporaryPassword;
  ids.z = r.body.member?.user.id;

  // --- Password changes: validation failures don't count (WK-38); GoTrue rejects nothing after revoking (BUG-WK-09)
  const x1 = await login(emails.x, tempX);
  const x2 = await login(emails.x, tempX);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await x1.call("POST", "/auth/change-password", { currentPassword: tempX, newPassword: "short" });
  }
  r = await x1.call("POST", "/auth/change-password", { currentPassword: tempX, newPassword: `${"a".repeat(80)}1` });
  ok("73+ byte password → 400 before anything is revoked", r.status === 400 && r.body.error.code === "VALIDATION_FAILED", r.status);
  r = await x2.call("GET", "/auth/me");
  ok("other session untouched by the failed change", r.status === 200, r.status);
  const passwordX = `E2e-${stamp}-Pass`;
  r = await x1.call("POST", "/auth/change-password", { currentPassword: tempX, newPassword: passwordX });
  ok("validation failures did not lock the change (WK-38)", r.status === 200, `${r.status} ${r.body?.error?.code ?? ""}`);
  r = await x2.call("GET", "/auth/me");
  ok("successful change ends the other session", r.status === 401, r.status);
  r = await x1.call("GET", "/auth/me");
  ok("/auth/me lists the role's permissions (WK-59)", r.status === 200 && r.body.user.permissions.includes("project.view"), r.body?.user?.permissions?.length);

  // --- Logout ends only this device (BUG-WK-02) ---------------------------------------------------------
  const x3 = await login(emails.x, passwordX);
  await x1.call("POST", "/auth/logout");
  r = await x1.call("GET", "/auth/me");
  ok("logged-out device is signed out", r.status === 401, r.status);
  r = await x3.call("GET", "/auth/me");
  const refreshed = await x3.call("POST", "/auth/refresh");
  ok("the other device keeps working, refresh included", r.status === 200 && refreshed.status === 200, `${r.status}/${refreshed.status}`);

  // --- Wrong current passwords do count ----------------------------------------------------------------
  const statuses = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    statuses.push((await y.call("POST", "/auth/change-password", { currentPassword: "wrong-password-1", newPassword: `Brand-${stamp}-New` })).status);
  }
  ok("wrong current passwords are rate limited", statuses.slice(0, 5).every((status) => status === 400) && statuses[5] === 429, statuses.join(","));

  // --- Temporary roles --------------------------------------------------------------------------------
  const roles = {
    low: createRole(roleKeys.low, ["project.view", "list.view", "channel.view"]),
    target: createRole(roleKeys.target, ["project.view"]),
    manage: createRole(roleKeys.manage, ["knowledge.delete", "member.view"]),
    admin: createRole(roleKeys.admin, [
      "role.view", "role.update", "role.delete", "role.assign_permission", "member.view", "member.manage",
      "project.view", "project.create", "project.update", "project.delete", "list.view", "channel.view", "task.view", "status.view"
    ])
  };
  setRole(ids.x, roles.low);
  const z = await login(emails.z, tempZ);
  await z.call("POST", "/auth/change-password", { currentPassword: tempZ, newPassword: `Z-${stamp}-Secret` });
  setRole(ids.z, roles.admin);
  const xLow = await login(emails.x, passwordX);

  // --- SEC-API-04: pickers without member.view get names, not e-mails ------------------------------------
  const pub = (await mgr.call("POST", "/projects", { key: `A${String(stamp).slice(-8)}`, name: `E2E accounts ${stamp}`, visibility: "public" })).body;
  projects.push(pub.id);
  const pubTask = (await mgr.call("POST", `/projects/${pub.id}/tasks`, { listId: pub.lists[0].id, title: "Hiển thị" })).body;
  r = await xLow.call("GET", `/directory/users?projectId=${pub.id}`);
  ok("directory without member.view hides other people's e-mails", r.status === 200 && r.body.items.length > 1 && r.body.items.every((user) => user.id === ids.x || user.email === null), r.status);
  r = await xLow.call("GET", "/directory/users");
  ok("unscoped directory still needs member.view", r.status === 403, r.status);

  // --- SEC-API-11: without task.view, by-key reveals nothing ----------------------------------------------
  const existing = await xLow.call("GET", `/tasks/by-key/${pubTask.key}`);
  const missing = await xLow.call("GET", `/tasks/by-key/${pub.key}-99999`);
  ok("by-key without task.view: same 404 for existing and missing keys", existing.status === 404 && missing.status === 404, `${existing.status}/${missing.status}`);

  // --- BUG-WK-03: production ADMIN accounts are out of reach of org managers without production roles ------
  // Z holds member.manage (and every permission of X's role) but no production role.
  localSql(`INSERT INTO production.user_roles (organization_id, user_id, role_code) VALUES (${quote(org)}, ${quote(ids.x)}, 'ADMIN') ON CONFLICT DO NOTHING`);
  bumpAuthz();
  const membershipX = localSql(`SELECT id FROM public.organization_memberships WHERE organization_id = ${quote(org)} AND user_id = ${quote(ids.x)} AND deleted_at IS NULL`)[0];
  r = await z.call("POST", `/organization/members/${membershipX}/reset-password`);
  ok("org manager without production roles cannot reset a production ADMIN's password", r.status === 403 && r.body.error.code === "PRODUCTION_ROLE_ESCALATION", `${r.status} ${r.body?.error?.code}`);
  r = await z.call("PATCH", `/organization/members/${membershipX}`, { status: "disabled" });
  ok("...nor disable them", r.status === 403 && r.body.error.code === "PRODUCTION_ROLE_ESCALATION", r.status);
  localSql(`UPDATE production.user_roles SET role_code = 'STAFF' WHERE organization_id = ${quote(org)} AND user_id = ${quote(ids.x)}`);
  bumpAuthz();
  r = await z.call("POST", `/organization/members/${membershipX}/reset-password`);
  ok("...nor a STAFF account while holding no STAFF role themselves", r.status === 403, r.status);
  localSql(`DELETE FROM production.user_roles WHERE organization_id = ${quote(org)} AND user_id = ${quote(ids.x)}`);
  bumpAuthz();

  // --- WK-39: signing in right after an admin reset gives a working session -----------------------------
  r = await z.call("POST", `/organization/members/${membershipX}/reset-password`);
  ok("reset allowed once the production role is gone", r.status === 200, r.status);
  const resetPassword = r.body.temporaryPassword;
  const fresh = await login(emails.x, resetPassword);
  const me = await fresh.call("GET", "/auth/me");
  ok("immediate sign-in after reset is not killed by the revocation marker", fresh.status === 200 && me.status === 200, `${fresh.status}/${me.status}`);
  r = await xLow.call("GET", "/auth/me");
  ok("pre-reset session is revoked", r.status === 401, r.status);
  r = await fresh.call("POST", "/auth/change-password", { currentPassword: resetPassword, newPassword: `E2e-${stamp}-Again` });
  ok("new password set after the reset", r.status === 200 && r.body.reauthenticate === false, r.status);

  // --- SEC-API-07: changing a role's permissions reconnects its holders -----------------------------------
  socketX = io(apiOrigin, { transports: ["websocket"], extraHeaders: { cookie: fresh.cookieHeader(), origin }, reconnection: false });
  const connected = await new Promise((resolve) => {
    socketX.on("connect", () => resolve(true));
    socketX.on("connect_error", () => resolve(false));
  });
  const disconnected = new Promise((resolve) => {
    socketX.on("disconnect", () => resolve(true));
    setTimeout(() => resolve(false), 4000);
  });
  r = await z.call("PATCH", `/roles/${roles.low}/permissions`, { permissions: ["project.view", "list.view"] });
  ok("role permission change by a role admin", r.status === 200, `${r.status} ${r.body?.error?.code ?? ""}`);
  ok("holders' sockets are disconnected to re-authorize", connected === true && (await disconnected) === true, `connected=${connected}`);

  // --- WK-40: no editing or deleting roles that hold more than you, nor your own -------------------------
  r = await z.call("PATCH", `/roles/${roles.manage}`, { name: "Leo thang" });
  ok("cannot rename a role with capabilities you lack", r.status === 403, r.status);
  r = await z.call("DELETE", `/roles/${roles.manage}`);
  ok("cannot delete a role with capabilities you lack", r.status === 403, r.status);
  r = await z.call("PATCH", `/roles/${roles.admin}`, { name: "Của tôi" });
  ok("cannot edit your own role", r.status === 403, r.status);

  // --- BUG-WK-14: a role held by a disabled member cannot be deleted --------------------------------------
  const membershipY = localSql(`SELECT id FROM public.organization_memberships WHERE organization_id = ${quote(org)} AND user_id = ${quote(ids.y)} AND deleted_at IS NULL`)[0];
  r = await mgr.call("PATCH", `/organization/members/${membershipY}`, { status: "disabled" });
  setRole(ids.y, roles.target);
  r = await z.call("DELETE", `/roles/${roles.target}`);
  ok("role of a disabled member is still in use (409)", r.status === 409 && r.body.error.code === "ROLE_IN_USE", r.status);
  r = await mgr.call("GET", `/organization/members?q=${encodeURIComponent("E2E Y")}`);
  ok("disabled member stays listed", r.body.items?.some((member) => member.user.id === ids.y && member.status === "disabled"));

  // --- WK-30: archived projects can be listed and restored -------------------------------------------------
  const zProject = (await z.call("POST", "/projects", { key: `Z${String(stamp).slice(-8)}`, name: `E2E accounts Z ${stamp}`, visibility: "private" })).body;
  projects.push(zProject?.id);
  r = await z.call("DELETE", `/projects/${zProject.id}`);
  ok("archive project", r.status === 200, r.status);
  r = await z.call("GET", "/projects/archived");
  ok("archived projects are listed", r.status === 200 && r.body.items.some((project) => project.id === zProject.id && project.archivedAt));
  r = await z.call("POST", `/projects/${zProject.id}/restore`);
  ok("restore archived project", r.status === 200 && r.body.id === zProject.id, r.status);

  // --- WK-37: member list pages ------------------------------------------------------------------------
  const total = Number(localSql(`
    SELECT count(*) FROM public.organization_memberships om JOIN public.app_users au ON au.id = om.user_id AND au.deleted_at IS NULL
    WHERE om.organization_id = ${quote(org)} AND om.deleted_at IS NULL
  `)[0]);
  const seen = [];
  let cursor = null;
  for (let page = 0; page < 200; page += 1) {
    r = await mgr.call("GET", `/organization/members?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (r.status !== 200) break;
    seen.push(...r.body.items.map((member) => member.id));
    cursor = r.body.pageInfo.nextCursor;
    if (!cursor) break;
  }
  ok("member list pages through everyone exactly once", seen.length === total && new Set(seen).size === total, `${seen.length}/${total}`);
  r = await mgr.call("GET", "/organization/members?cursor=garbage");
  ok("bad member cursor → 400", r.status === 400, r.status);
} finally {
  socketX?.close();
  await sleep(100);
  for (const id of projects.filter(Boolean)) {
    localSql(`
      BEGIN;
      DELETE FROM public.notifications WHERE project_id = ${quote(id)};
      UPDATE public.tasks SET parent_task_id = NULL WHERE project_id = ${quote(id)};
      DELETE FROM public.tasks WHERE project_id = ${quote(id)};
      DELETE FROM public.projects WHERE id = ${quote(id)} AND name LIKE 'E2E accounts %';
      COMMIT;
    `);
  }
  if (ids.x) localSql(`DELETE FROM production.user_roles WHERE organization_id = ${quote(org)} AND user_id = ${quote(ids.x)}`);
  softDeleteTestAccounts(Object.values(emails));
  purgeTestRoles(Object.values(roleKeys));
}
