// Production (Photo Retouch) catalog — SPEC Phase 0–1: roles/visibility, credit-rule versions, CSV import,
// workflow, custom fields, whitelist, settings, notification preferences.
import { bumpAuthz, localSql, seed, session } from "./lib.mjs";
const ok = (label, cond, extra = "") => console.log(`${cond ? "PASS" : "FAIL"}  ${label} ${extra}`);
const quote = (text) => `'${String(text).replaceAll("'", "''")}'`;

// Setup (local DB only): MANAGER is production ADMIN; members start without production roles.
const others = ["MEMBER_A", "MEMBER_B", "MEMBER_C"].map((who) => quote(seed[`SEED_${who}_EMAIL`].toLowerCase())).join(",");
localSql(`
  DELETE FROM production.user_roles WHERE user_id IN (SELECT id FROM public.app_users WHERE lower(email) IN (${others}));
  INSERT INTO production.user_roles (organization_id, user_id, role_code)
  SELECT om.organization_id, au.id, 'ADMIN' FROM public.app_users au
  JOIN public.organization_memberships om ON om.user_id = au.id AND om.deleted_at IS NULL
  WHERE lower(au.email) = ${quote(seed.SEED_MANAGER_EMAIL.toLowerCase())}
  ON CONFLICT DO NOTHING;
`);
bumpAuthz();

const admin = await session("MANAGER");
const a = await session("MEMBER_A");
const b = await session("MEMBER_B");
const outsider = await session("MEMBER_C");

// Visibility (PD-011)
let r = await outsider.call("GET", "/production/me");
ok("non-member /production/me says no roles", r.status === 200 && r.body.roles.length === 0 && r.body.isAdmin === false);
r = await outsider.call("GET", "/production/projects");
ok("non-member gets 404 on production data", r.status === 404 && r.body.error.code === "PRODUCTION_NOT_FOUND", r.body?.error?.code);
r = await admin.call("GET", "/production/me");
ok("admin /production/me", r.status === 200 && r.body.isAdmin && r.body.roles.includes("ADMIN") && r.body.settings.kpiCloseDay >= 1);

// Members & roles
r = await admin.call("GET", "/production/members");
const memberA = r.body.items?.find((item) => item.email?.toLowerCase() === seed.SEED_MEMBER_A_EMAIL.toLowerCase());
const memberB = r.body.items?.find((item) => item.email?.toLowerCase() === seed.SEED_MEMBER_B_EMAIL.toLowerCase());
const self = r.body.items?.find((item) => item.email?.toLowerCase() === seed.SEED_MANAGER_EMAIL.toLowerCase());
ok("admin lists all org members", r.status === 200 && memberA && memberB && self);
r = await admin.call("PATCH", `/production/members/${memberA.userId}`, { roles: ["LEADER", "QC"] });
ok("admin grants LEADER+QC", r.status === 200 && r.body.roles.join() === "LEADER,QC", JSON.stringify(r.body?.roles ?? r.body?.error));
r = await admin.call("PATCH", `/production/members/${memberB.userId}`, { roles: ["STAFF"] });
ok("admin grants STAFF", r.status === 200 && r.body.roles.join() === "STAFF");
r = await admin.call("PATCH", `/production/members/${self.userId}`, { roles: ["LEADER"] });
ok("admin cannot drop own ADMIN (409)", r.status === 409 && r.body.error.code === "SELF_ADMIN_REMOVAL", r.body?.error?.code);
r = await b.call("GET", "/production/projects");
ok("role change takes effect immediately for STAFF", r.status === 200);
r = await b.call("GET", "/production/members");
ok("STAFF cannot list members (403)", r.status === 403, r.body?.error?.code);
r = await b.call("PATCH", `/production/members/${memberB.userId}`, { roles: ["ADMIN"] });
ok("STAFF cannot self-escalate (403)", r.status === 403);
r = await a.call("GET", "/production/members");
ok("LEADER lists members, without custom data", r.status === 200 && r.body.items.every((item) => item.roles.length > 0 && Object.keys(item.customValues).length === 0));
r = await a.call("PATCH", "/production/settings", { kpiCloseDay: 20 });
ok("LEADER cannot change settings (403)", r.status === 403);

// Workflow seed
r = await b.call("GET", "/production/workflow");
const codes = r.body.statuses?.filter((status) => status.active).map((status) => status.code) ?? [];
ok("workflow seeded (9 statuses, 10 transitions)", codes.length === 9 && r.body.transitions.length === 10 && codes[0] === "ASSIGNED", codes.join(","));
const qcReturn = r.body.transitions?.find(
  (t) => t.fromStatusId === r.body.statuses.find((s) => s.code === "WAITING_QC").id && t.toStatusId === r.body.statuses.find((s) => s.code === "PROCESSING").id
);
ok("QC fail transition requires a note", qcReturn?.requiresNote === true && qcReturn.actors.includes("QC"));

// Catalog: project + credit-rule versions
const code = `E2E${Date.now().toString(36).toUpperCase()}`;
r = await admin.call("POST", "/production/projects", { code, name: `E2E ${code}`, qcBufferHours: 2 });
const project = r.body.items?.find((item) => item.code === code);
ok("admin creates production project", r.status === 201 && Boolean(project));
r = await admin.call("POST", "/production/projects", { code: code.toLowerCase(), name: "dup" });
ok("project code unique case-insensitively (409 PROJECT_CODE_TAKEN)", r.status === 409 && r.body.error.code === "PROJECT_CODE_TAKEN", r.body?.error?.code);
r = await admin.call("PATCH", `/production/projects/${project.id}`, { qcBufferHours: 3 });
ok("partial PATCH keeps unsent fields", r.status === 200 && r.body.items.find((item) => item.id === project.id)?.qcBufferHours === 3 && r.body.items.find((item) => item.id === project.id)?.code === code);
r = await b.call("POST", "/production/projects", { code: `${code}X`, name: "nope" });
ok("STAFF cannot create projects (403)", r.status === 403);
const processes = (await admin.call("GET", "/production/processes")).body.items;
const normal = processes.find((p) => p.name === "Normal Retouch");

r = await admin.call("PUT", "/production/credit-rules", { projectId: project.id, processId: normal.id, creditPerImage: 2.75, moneyPerImage: 7000, effectiveFrom: "2026-05-01" });
ok("set credit from 2026-05-01", r.status === 200 && r.body.items.length === 1);
r = await admin.call("PUT", "/production/credit-rules", { projectId: project.id, processId: normal.id, creditPerImage: 3, moneyPerImage: null, effectiveFrom: "2026-06-01" });
ok("new version from 2026-06-01 splits history", r.status === 200 && r.body.items.length === 2 && r.body.items[1].effectiveTo === "2026-06-01", JSON.stringify(r.body?.items?.map((i) => [i.effectiveFrom, i.effectiveTo])));
r = await admin.call("PUT", "/production/credit-rules", { projectId: project.id, processId: normal.id, creditPerImage: 2.8, moneyPerImage: 7000, effectiveFrom: "2026-05-01" });
ok("same-day version corrected in place", r.status === 200 && r.body.items.length === 2 && r.body.items[1].creditPerImage === 2.8);
r = await admin.call("PUT", "/production/credit-rules", { projectId: project.id, processId: normal.id, creditPerImage: 2.5, moneyPerImage: null, effectiveFrom: "2026-04-15" });
ok("earlier version ends where the next begins", r.status === 200 && r.body.items.length === 3 && r.body.items[2].effectiveTo === "2026-05-01");
const cell = async (session, at) => {
  const res = await session.call("GET", `/production/credit-rules/matrix?at=${at}`);
  return res.body.rules?.find((rule) => rule.projectId === project.id && rule.processId === normal.id) ?? null;
};
ok("matrix 2026-04-30 → 2.5", (await cell(admin, "2026-04-30"))?.creditPerImage === 2.5);
ok("matrix 2026-05-31 → 2.8 / 7000", (await cell(admin, "2026-05-31"))?.moneyPerImage === 7000);
ok("matrix 2026-06-01 → 3", (await cell(admin, "2026-06-01"))?.creditPerImage === 3);
ok("matrix before first version → none", (await cell(admin, "2026-04-14")) === null);
ok("STAFF sees credit but not money (money_public=false)", (await cell(b, "2026-05-31"))?.moneyPerImage === null && (await cell(b, "2026-05-31"))?.creditPerImage === 2.8);
r = await admin.call("GET", "/production/credit-rules/matrix?at=2026-13-01");
ok("invalid matrix date (400)", r.status === 400);

// CSV import (all-or-nothing)
const historyBefore = (await admin.call("GET", `/production/credit-rules/history?projectId=${project.id}&processId=${normal.id}`)).body.items.length;
r = await admin.call("POST", "/production/credit-rules/import", {
  csv: `project_code,process_name,credit,money\n${code},Normal Retouch,4,0\n${code},Normal Retouch,5,0\n${code},Clipping,abc,0\n`,
  effectiveFrom: "2026-07-01"
});
ok("bad CSV reports lines, writes nothing", r.status === 200 && r.body.ok === false && r.body.errors.map((e) => e.line).join() === "3,4", JSON.stringify(r.body?.errors));
r = await admin.call("POST", "/production/credit-rules/import", {
  csv: `project_code,process_name,credit,money\n${code},Normal Retouch,4,0\n${code}NEW,Clipping,1.5,3000\n`,
  effectiveFrom: "2026-07-01"
});
ok("unknown project rejected unless createMissing", r.body.ok === false && r.body.errors[0]?.line === 3);
const historyMid = (await admin.call("GET", `/production/credit-rules/history?projectId=${project.id}&processId=${normal.id}`)).body.items.length;
ok("rejected imports left history untouched", historyMid === historyBefore, `${historyBefore}→${historyMid}`);
r = await admin.call("POST", "/production/credit-rules/import", {
  csv: `project_code,process_name,credit,money\n${code},Normal Retouch,4,0\n${code}NEW,Clipping,1.5,3000\n`,
  effectiveFrom: "2026-07-01",
  createMissing: true
});
ok("import with createMissing", r.body.ok === true && r.body.imported === 2 && r.body.createdProjects.join() === `${code}NEW`, JSON.stringify(r.body));
ok("imported version effective 2026-07-01", (await cell(admin, "2026-07-01"))?.creditPerImage === 4);
r = await admin.call("POST", "/production/credit-rules/versions", { effectiveFrom: "2026-08-01" });
ok("new version copies every current rule", r.status === 201 && r.body.created >= 2, JSON.stringify(r.body));
r = await b.call("POST", "/production/credit-rules/import", { csv: "project_code,process_name,credit\nA,B,1", effectiveFrom: "2026-07-01" });
ok("STAFF cannot import (403)", r.status === 403);
{
  // Delete a mistaken version: the earlier one takes its period back; used prices cannot be deleted.
  const history = (await admin.call("GET", `/production/credit-rules/history?projectId=${project.id}&processId=${normal.id}`)).body.items;
  const newest = history[0];
  r = await admin.call("DELETE", `/production/credit-rules/${newest.id}`);
  ok("delete an unused price version", r.status === 200 && r.body.items.length === history.length - 1 && r.body.items[0].effectiveTo === newest.effectiveTo, JSON.stringify(r.body?.items?.slice(0, 2) ?? r.body));
  const used = localSql("SELECT credit_rule_id FROM production.score_entries WHERE credit_rule_id IS NOT NULL LIMIT 1")[0];
  if (used) {
    r = await admin.call("DELETE", `/production/credit-rules/${used}`);
    ok("a price used by scores cannot be deleted", r.status === 409 && r.body.error.code === "CREDIT_RULE_IN_USE");
  }
  r = await b.call("DELETE", `/production/credit-rules/${newest.id}`);
  ok("STAFF cannot delete prices", r.status === 403 || r.status === 404);
  const order = processes.map((item) => item.id);
  r = await admin.call("PUT", "/production/processes/order", { ids: [...order].reverse() });
  const reordered = (await admin.call("GET", "/production/processes")).body.items.filter((item) => item.active).map((item) => item.id);
  ok("bulk reorder processes", r.status === 200 && reordered[0] === [...order].reverse().find((id) => reordered.includes(id)));
  await admin.call("PUT", "/production/processes/order", { ids: order });
}

// Custom fields & clients
const key = `tier_${Date.now().toString(36)}`;
r = await admin.call("POST", "/production/custom-fields", {
  entity: "CLIENT",
  key,
  label: "Hạng khách",
  type: "SELECT",
  options: [{ value: "vip", label: "VIP", color: "amber" }, { value: "std", label: "Thường" }]
});
const field = r.body.items?.find((item) => item.key === key);
ok("admin creates SELECT custom field", r.status === 201 && field?.options.length === 2);
r = await admin.call("POST", "/production/custom-fields", { entity: "CLIENT", key: `${key}_x`, label: "X", type: "SELECT", options: [] });
ok("SELECT without options rejected", r.status === 400 && r.body.error.code === "FIELD_OPTIONS_REQUIRED");
r = await a.call("POST", "/production/clients", { name: `E2E Client ${code}` });
ok("LEADER cannot create clients (403, Account/Admin only)", r.status === 403);
r = await admin.call("POST", "/production/clients", { name: `E2E Client ${code}`, customValues: { [key]: "gold" } });
ok("invalid option rejected (400)", r.status === 400 && r.body.error.code === "CUSTOM_FIELDS_INVALID", r.body?.error?.code);
r = await admin.call("POST", "/production/clients", { name: `E2E Client ${code}`, customValues: { [key]: "vip", nope: 1 } });
ok("unknown custom key rejected (400)", r.status === 400);
const tag = (await admin.call("POST", "/production/tags", { name: `e2e-${code}`, color: "rose" })).body.items?.find((item) => item.name === `e2e-${code}`);
r = await admin.call("POST", "/production/clients", { name: `E2E Client ${code}`, customValues: { [key]: "vip" }, tagIds: [tag.id] });
const client = r.body.items?.find((item) => item.name === `E2E Client ${code}`);
ok("client with custom value + tag", r.status === 201 && client?.customValues[key] === "vip" && client.tagIds[0] === tag.id);
r = await b.call("GET", "/production/clients");
ok("STAFF cannot see clients (403)", r.status === 403);
r = await admin.call("PATCH", `/production/custom-fields/${field.id}`, { entity: "CLIENT", key, label: "Hạng khách", type: "SELECT", options: field.options, active: false });
ok("custom field deactivated", r.status === 200);

// Whitelist, settings, preferences
const wl = `e2e.${Date.now()}@nesso.test`;
r = await admin.call("POST", "/production/allowed-emails", { text: `${wl}, not-an-email; ${wl.toUpperCase()}` });
ok("whitelist paste: added / invalid", r.status === 200 && r.body.added.join() === wl && r.body.invalid.join() === "not-an-email", JSON.stringify(r.body));
r = await admin.call("DELETE", `/production/allowed-emails/${encodeURIComponent(wl)}`);
ok("whitelist remove", r.status === 200);
r = await a.call("GET", "/production/allowed-emails");
ok("LEADER cannot read whitelist (403)", r.status === 403);
r = await admin.call("PATCH", "/production/settings", { kpiCloseDay: 26, anomalyFailRate: 0.2 });
ok("admin updates settings", r.status === 200 && r.body.kpiCloseDay === 26 && r.body.anomalyFailRate === 0.2);
r = await admin.call("PATCH", "/production/settings", { kpiCloseDay: 31 });
ok("invalid close day rejected (400)", r.status === 400);
r = await admin.call("PATCH", "/production/settings", { timezone: "UTC" });
ok("timezone is not editable (400)", r.status === 400);
await admin.call("PATCH", "/production/settings", { kpiCloseDay: 25, anomalyFailRate: 0.15 });
r = await outsider.call("PATCH", "/me/notification-preferences", { notifyEmail: true });
ok("anyone sets own notification preferences", r.status === 200 && r.body.notifyEmail === true && r.body.notifyWeb === true);
await outsider.call("PATCH", "/me/notification-preferences", { notifyEmail: false });

// Cleanup: archive the e2e catalog rows (history is kept by design).
for (const item of (await admin.call("GET", "/production/projects")).body.items.filter((p) => p.code.startsWith(code))) {
  await admin.call("PATCH", `/production/projects/${item.id}`, { code: item.code, name: item.name, active: false });
}
await admin.call("PATCH", `/production/clients/${client.id}`, { name: client.name, active: false });
await admin.call("PATCH", `/production/tags/${tag.id}`, { name: tag.name, color: tag.color, active: false });
