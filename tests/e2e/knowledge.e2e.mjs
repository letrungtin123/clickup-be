// Knowledge base ("Kho tri thức", PD-031) end to end: spaces, access matrix, drafts, approval step (published items
// for managers only), critical-item reasons, optimistic concurrency, categories, statuses, comments + mentions,
// notifications, versions, history, audit log + export, search, realtime room, attachments, tables and images in
// bodies, trash / purge, append-only guards, default grants of the "Quản lý" role. Cleans up after itself.
//   cd BE && node tests/e2e/run.mjs knowledge
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { cleanupKnowledgeSpaces, dbNow, quote, revokeSuiteKnowledgeGrants } from "./cleanup.mjs";
import { apiOrigin, bumpAuthz, localSql, session, storageFetch } from "./lib.mjs";
const require = createRequire(process.cwd() + "/package.json");
const { io } = require("socket.io-client");

const ok = (label, cond, extra = "") => console.log(`${cond ? "PASS" : "FAIL"}  ${label} ${extra}`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (value) => ({ type: "text", text: value });
const mention = (id, label) => ({ type: "mention", attrs: { id, label } });
const doc = (...content) => ({ type: "doc", content: [{ type: "paragraph", content }] });
const code = (res) => res.body?.error?.code ?? res.status;

/** Polls the inbox until a matching notification shows up (the worker delivers asynchronously). */
const waitForNotification = async (s, predicate, timeoutMs = 12_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = await s.call("GET", "/notifications?limit=50");
    const found = (page.body?.items ?? []).find(predicate);
    if (found) return found;
    await wait(400);
  }
  return null;
};

const mgr = await session("MANAGER");
const a = await session("MEMBER_A");
const b = await session("MEMBER_B");
const c = await session("MEMBER_C");
const ctx = {};
for (const [name, s] of Object.entries({ mgr, a, b, c })) {
  ctx[name] = (await s.call("GET", "/workspace/context")).body;
}
const ids = Object.fromEntries(Object.entries(ctx).map(([name, value]) => [name, value.user.id]));

// Owner decision 2026-10-11 (migration 20261011_0410): the org role "Quản lý" (key manager) creates spaces, changes
// their settings and manages their members — but does not archive / delete / purge.
const managerGrants = new Set((ctx.mgr.role?.permissions ?? []).filter((key) => key.startsWith("knowledge.")));
ok(
  "org role Quản lý holds knowledge.create / update / manage_members by default",
  ctx.mgr.role?.key === "manager" && ["knowledge.view", "knowledge.create", "knowledge.update", "knowledge.manage_members"].every((key) => managerGrants.has(key)),
  [...managerGrants].join(",")
);
ok("…but not knowledge.delete", !managerGrants.has("knowledge.delete"));
ok("org role Thành viên only reads knowledge", ctx.a.role?.key === "member" && !(ctx.a.role?.permissions ?? []).includes("knowledge.create"));

// The suite also archives, deletes and purges as the dev MANAGER: grant the knowledge permissions that role lacks
// for the run (granted_by = the dev account, so a crashed run is swept by cleanup.mjs; default grants have no
// granted_by and are left alone).
const roleId = localSql(`SELECT role_id FROM public.organization_memberships WHERE user_id = ${quote(ids.mgr)} AND deleted_at IS NULL`)[0];
localSql(`
  INSERT INTO public.role_permissions (organization_id, role_id, permission_key, granted_by)
  SELECT r.organization_id, r.id, p.key, ${quote(ids.mgr)}
  FROM public.roles r CROSS JOIN (VALUES ('knowledge.create'), ('knowledge.update'), ('knowledge.delete'), ('knowledge.manage_members')) AS p(key)
  WHERE r.id = ${quote(roleId)}
  ON CONFLICT DO NOTHING;
`);
bumpAuthz();

const tag = Math.random().toString(36).slice(2, 8).toUpperCase();
const since = dbNow();
const created = [];
const socket = io(apiOrigin, { transports: ["websocket"], extraHeaders: { cookie: b.cookieHeader(), origin: "http://127.0.0.1:5890" }, reconnection: false });
const live = [];
socket.on("knowledge:changed", (event) => live.push(event));
const join = (room) => new Promise((resolve) => socket.emit("room:join", room, (ack) => resolve(ack)));

try {
  await new Promise((resolve, reject) => {
    socket.on("connect", resolve);
    socket.on("connect_error", reject);
  });

  // Spaces & access matrix -------------------------------------------------------------------------------
  let r = await a.call("POST", "/knowledge/spaces", { name: `E2E KB denied ${tag}` });
  ok("member role without knowledge.create cannot create a space", r.status === 403, code(r));

  r = await mgr.call("POST", "/knowledge/spaces", { name: `E2E KB pub ${tag}`, visibility: "public", description: "Kho thử" });
  const pub = r.body;
  created.push(pub?.id);
  ok("create public space", r.status === 201 && pub.myAccess === "manage" && pub.capabilities.canManage, code(r));
  const groups = new Set((pub.statuses ?? []).map((status) => status.group));
  ok("default statuses: 5, one per group at least", pub.statuses?.length === 5 && groups.size === 3, pub.statuses?.map((s) => s.name).join(","));
  const statusByName = (detail, name) => detail.statuses.find((status) => status.name === name);
  const nhap = statusByName(pub, "Nháp");
  const choDuyet = statusByName(pub, "Chờ duyệt");
  const banHanh = statusByName(pub, "Đã ban hành");
  const canCapNhat = statusByName(pub, "Cần cập nhật");

  r = await mgr.call("POST", "/knowledge/spaces", { name: `E2E KB priv ${tag}`, visibility: "private" });
  const priv = r.body;
  created.push(priv?.id);
  ok("create private space", r.status === 201 && priv.visibility === "private", code(r));

  r = await mgr.call("POST", "/knowledge/spaces", { name: `E2E KB pub ${tag}` });
  ok("duplicate space name refused", r.status === 409 && code(r) === "KNOWLEDGE_SPACE_EXISTS", code(r));

  await mgr.call("POST", `/knowledge/spaces/${pub.id}/members`, { userId: ids.a, accessLevel: "submit" });
  r = await mgr.call("POST", `/knowledge/spaces/${pub.id}/members`, { userId: ids.c, accessLevel: "view" });
  ok("add view member", r.status === 200 && r.body.accessLevel === "view", code(r));
  await mgr.call("POST", `/knowledge/spaces/${priv.id}/members`, { userId: ids.a, accessLevel: "submit" });

  r = await b.call("GET", "/knowledge/spaces");
  const bPub = r.body.items.find((space) => space.id === pub.id);
  ok("reader sees the public space (not a member, read + comment only)", bPub && bPub.myAccess === null && bPub.capabilities.canComment && !bPub.capabilities.canEdit);
  ok("reader does not see the private space in the list", !r.body.items.some((space) => space.id === priv.id));
  r = await b.call("GET", `/knowledge/spaces/${priv.id}`);
  ok("private space is a 404 for outsiders", r.status === 404, code(r));
  r = await a.call("POST", `/knowledge/spaces/${pub.id}/members`, { userId: ids.b, accessLevel: "view" });
  ok("submit member cannot manage members", r.status === 403, code(r));
  r = await mgr.call("PATCH", `/knowledge/spaces/${pub.id}/members/${ids.mgr}`, { accessLevel: "submit" });
  ok("the last manager cannot step down", r.status === 409 && code(r) === "KNOWLEDGE_MANAGER_REQUIRED", code(r));

  ok("reader joins the public space room", (await join({ type: "knowledge", id: pub.id })).ok === true);
  ok("outsider cannot join the private space room", (await join({ type: "knowledge", id: priv.id })).ok === false);

  // Items: drafts, concurrency -----------------------------------------------------------------------------
  const unique = `kb${tag.toLowerCase()}`;
  r = await a.call("POST", `/knowledge/spaces/${pub.id}/items`, {
    title: `Quy trình retouch chân dung ${unique}`,
    summary: "Các bước chuẩn",
    body: doc(text("Bước 1: kiểm tra ảnh gốc.")),
    importance: "important",
    tags: ["retouch", "Retouch ", "chân dung"]
  });
  const item = r.body;
  ok("submit member creates an item (draft, v1)", r.status === 201 && item.status.group === "draft" && item.version === 1, code(r));
  ok("tags normalized (case-insensitive duplicates dropped)", item.tags?.length === 2, JSON.stringify(item.tags));
  ok("creator follows the item", item.isFollowing === true);
  r = await b.call("GET", `/knowledge/items/${item.id}`);
  ok("draft is hidden from readers", r.status === 404, code(r));
  r = await c.call("GET", `/knowledge/spaces/${pub.id}/items`);
  ok("draft is hidden from view members in lists", !r.body.items.some((entry) => entry.id === item.id));
  r = await a.call("GET", `/knowledge/spaces/${pub.id}/items`);
  ok("author sees the draft", r.body.items.some((entry) => entry.id === item.id));

  r = await a.call("PATCH", `/knowledge/items/${item.id}`, { expectedVersion: 1, body: doc(text("Bước 1: kiểm tra ảnh gốc. Bước 2: cân màu.")), versionNote: "Thêm bước 2" });
  ok("content save creates v2", r.status === 200 && r.body.version === 2, code(r));
  r = await a.call("PATCH", `/knowledge/items/${item.id}`, { expectedVersion: 1, title: "Ghi đè" });
  ok("stale save is refused with a conflict", r.status === 409 && code(r) === "KNOWLEDGE_VERSION_CONFLICT" && r.body.error.details?.latestVersion === 2, JSON.stringify(r.body?.error?.details ?? {}));
  r = await a.call("PATCH", `/knowledge/items/${item.id}`, { title: "Không có số phiên bản" });
  ok("content save without expectedVersion refused", r.status === 400 && code(r) === "KNOWLEDGE_EXPECTED_VERSION_REQUIRED", code(r));

  // Approval step -----------------------------------------------------------------------------------------
  r = await mgr.call("PATCH", `/knowledge/spaces/${pub.id}`, { approvalRequired: true });
  ok("approval step switched on", r.status === 200 && r.body.approvalRequired === true, code(r));
  r = await a.call("GET", `/knowledge/items/${item.id}`);
  ok("allowed statuses exclude active ones for a submit member", !r.body.capabilities.allowedStatusIds.includes(banHanh.id) && r.body.capabilities.allowedStatusIds.includes(choDuyet.id));
  r = await a.call("PATCH", `/knowledge/items/${item.id}`, { statusId: banHanh.id });
  ok("submit member cannot publish while approval is on", r.status === 403 && code(r) === "KNOWLEDGE_APPROVAL_REQUIRED", code(r));
  r = await a.call("PATCH", `/knowledge/items/${item.id}`, { statusId: choDuyet.id });
  ok("submit member sends for approval", r.status === 200 && r.body.status.id === choDuyet.id, code(r));
  const approval = await waitForNotification(mgr, (n) => n.type === "knowledge.approval_requested" && n.target.knowledgeItemId === item.id);
  ok("managers get knowledge.approval_requested", Boolean(approval) && approval.target.knowledgeSpaceId === pub.id);
  r = await mgr.call("PATCH", `/knowledge/items/${item.id}`, { statusId: banHanh.id });
  ok("manager publishes", r.status === 200 && r.body.status.group === "active", code(r));
  const authorNotice = await waitForNotification(a, (n) => n.type === "knowledge.status_changed" && n.target.knowledgeItemId === item.id);
  ok("follower gets knowledge.status_changed", Boolean(authorNotice));
  const published = await waitForNotification(c, (n) => n.type === "knowledge.updated" && n.target.knowledgeItemId === item.id && n.payload.broadcast === true);
  ok("important item published → every member notified", Boolean(published));
  r = await b.call("GET", `/knowledge/items/${item.id}`);
  ok("published item visible to readers", r.status === 200 && r.body.capabilities.canEdit === false && r.body.capabilities.canComment === true, code(r));
  ok("reader has no item history", r.body?.capabilities?.canViewHistory === false);
  r = await b.call("POST", `/knowledge/items/${item.id}/follow`);
  ok("reader follows", r.status === 200 && r.body.isFollowing === true, code(r));
  r = await b.call("PATCH", `/knowledge/items/${item.id}`, { pinned: true });
  ok("reader cannot edit", r.status === 403, code(r));

  // Owner decision 2026-10-11: approval on ⇒ published items are for managers only ---------------------------------
  const locked = (res) => res.status === 403 && code(res) === "KNOWLEDGE_PUBLISHED_LOCKED";
  r = await a.call("GET", `/knowledge/items/${item.id}`);
  const lockedCaps = r.body?.capabilities ?? {};
  ok(
    "approval on: a member's capabilities on a published item are read + comment only",
    lockedCaps.canEdit === false && lockedCaps.canChangeStatus === false && lockedCaps.allowedStatusIds?.length === 0 && lockedCaps.canDelete === false && lockedCaps.canComment === true,
    JSON.stringify(lockedCaps)
  );
  r = await a.call("PATCH", `/knowledge/items/${item.id}`, { expectedVersion: 2, body: doc(text("Sửa bản đã ban hành")) });
  ok("member cannot edit the content of a published item", locked(r), code(r));
  r = await a.call("PATCH", `/knowledge/items/${item.id}`, { tags: ["khác"] });
  ok("…nor its fields", locked(r), code(r));
  r = await a.call("PATCH", `/knowledge/items/${item.id}`, { statusId: choDuyet.id });
  ok("…nor its status", locked(r), code(r));
  r = await a.call("POST", `/knowledge/items/${item.id}/versions/1/restore`, {});
  ok("…nor restore an old version", locked(r), code(r));
  r = await a.call("POST", `/knowledge/items/${item.id}/editing`, { editing: true });
  ok("…nor hold the edit presence", locked(r), code(r));
  r = await a.call("DELETE", `/knowledge/items/${item.id}`, {});
  ok("…nor move it to the trash", locked(r), code(r));
  r = await a.call("POST", `/knowledge/items/${item.id}/follow`);
  ok("members still follow a published item", r.status === 200 && r.body.isFollowing === true, code(r));
  r = await mgr.call("DELETE", `/knowledge/items/${item.id}`, { reason: "Thử khoá" });
  ok("the manager moves it to the trash", r.status === 200, code(r));
  r = await a.call("GET", `/knowledge/spaces/${pub.id}/trash`);
  ok("trash: the member cannot restore a published item", (r.body.items ?? []).some((entry) => entry.id === item.id && entry.canRestore === false));
  r = await a.call("GET", `/knowledge/items/${item.id}`);
  ok("trashed published item: canRestore false for the member", r.status === 200 && r.body.capabilities.canRestore === false, code(r));
  r = await a.call("POST", `/knowledge/items/${item.id}/restore`, {});
  ok("member restore refused", locked(r), code(r));
  r = await mgr.call("POST", `/knowledge/items/${item.id}/restore`, {});
  ok("the manager restores it", r.status === 200 && r.body.deletedAt === null && r.body.capabilities.canEdit === true, code(r));
  r = await a.call("POST", `/knowledge/spaces/${pub.id}/items`, { title: `Nháp khi bật duyệt ${unique}`, body: doc(text("nháp")) });
  const lockedDraft = r.body;
  ok("members still create items while approval is on", r.status === 201 && lockedDraft.capabilities.canEdit === true, code(r));
  r = await a.call("PATCH", `/knowledge/items/${lockedDraft.id}`, { expectedVersion: 1, body: doc(text("nháp đã sửa")) });
  ok("…and edit their drafts", r.status === 200 && r.body.version === 2, code(r));
  r = await a.call("DELETE", `/knowledge/items/${lockedDraft.id}`, {});
  ok("…and trash their drafts", r.status === 200, code(r));
  r = await mgr.call("PATCH", `/knowledge/spaces/${pub.id}`, { approvalRequired: false });
  ok("approval step switched off", r.status === 200 && r.body.approvalRequired === false, code(r));
  r = await a.call("GET", `/knowledge/items/${item.id}`);
  ok(
    "approval off: members edit published items again (unchanged)",
    r.body?.capabilities?.canEdit === true && r.body.capabilities.canDelete === true && r.body.capabilities.allowedStatusIds.length === 5,
    JSON.stringify(r.body?.capabilities ?? {})
  );

  // Critical items need a reason ------------------------------------------------------------------------
  r = await mgr.call("PATCH", `/knowledge/items/${item.id}`, { importance: "critical" });
  ok("raising to critical needs a reason", r.status === 400 && code(r) === "KNOWLEDGE_REASON_REQUIRED", code(r));
  r = await mgr.call("PATCH", `/knowledge/items/${item.id}`, { importance: "critical", reason: "Chính sách bắt buộc" });
  ok("critical with a reason", r.status === 200 && r.body.importance === "critical", code(r));
  r = await a.call("PATCH", `/knowledge/items/${item.id}`, { expectedVersion: 2, body: doc(text("Bước 3: xuất file.")) });
  ok("editing a critical item without a reason is refused", r.status === 400 && code(r) === "KNOWLEDGE_REASON_REQUIRED", code(r));
  r = await a.call("PATCH", `/knowledge/items/${item.id}`, { expectedVersion: 2, body: doc(text("Bước 3: xuất file.")), reason: "Cập nhật bước 3" });
  ok("critical edit with a reason → v3", r.status === 200 && r.body.version === 3, code(r));
  const criticalFollower = await waitForNotification(b, (n) => n.type === "knowledge.updated" && n.target.knowledgeItemId === item.id && n.payload.criticalVersion === true);
  ok("follower gets knowledge.updated marked as critical version (e-mailable)", Boolean(criticalFollower) && criticalFollower.payload.broadcast === false);
  const criticalMember = await waitForNotification(c, (n) => n.type === "knowledge.updated" && n.target.knowledgeItemId === item.id && n.payload.criticalVersion === true);
  ok("members get the critical new version too", Boolean(criticalMember));

  // Comments & mentions ---------------------------------------------------------------------------------------
  r = await b.call("POST", `/knowledge/items/${item.id}/comments`, { body: doc(text("Bước 3 thiếu định dạng, "), mention(ids.c, "C"), text(" xem giúp")) });
  const comment = r.body;
  ok("reader comments with a mention", r.status === 201 && comment.mentionedUserIds.includes(ids.c), code(r));
  ok("mention label comes from the server", JSON.stringify(comment.body).includes(ctx.c.user.displayName));
  const mentioned = await waitForNotification(c, (n) => n.type === "knowledge.mentioned" && n.target.knowledgeItemId === item.id);
  ok("mentioned person gets knowledge.mentioned", Boolean(mentioned) && mentioned.payload.source === "comment");
  const followerComment = await waitForNotification(a, (n) => n.type === "knowledge.commented" && n.target.knowledgeItemId === item.id);
  ok("follower gets knowledge.commented", Boolean(followerComment));
  r = await a.call("POST", `/knowledge/items/${item.id}/comments`, { body: doc(text("Đã sửa, cảm ơn")), parentCommentId: comment.id });
  const reply = r.body;
  ok("reply", r.status === 201 && reply.parentCommentId === comment.id, code(r));
  const replied = await waitForNotification(b, (n) => n.type === "knowledge.replied" && n.target.knowledgeItemId === item.id);
  ok("comment author gets knowledge.replied", Boolean(replied));
  r = await b.call("GET", "/notifications?limit=50");
  ok("the writer is never notified of their own comment", !r.body.items.some((n) => n.type === "knowledge.commented" && n.target.knowledgeItemId === item.id));
  r = await a.call("POST", `/knowledge/items/${item.id}/comments`, { body: doc(text("x")), parentCommentId: reply.id });
  ok("replies are one level deep", r.status === 409, code(r));
  r = await b.call("PATCH", `/knowledge/items/${item.id}/comments/${comment.id}`, { body: doc(text("Bước 3 thiếu định dạng (đã sửa câu)")) });
  ok("the author edits their comment", r.status === 200 && r.body.editedAt !== null, code(r));
  r = await c.call("POST", `/knowledge/items/${item.id}/comments/${comment.id}/resolve`, { resolved: true });
  ok("view member cannot resolve someone else's comment", r.status === 403, code(r));
  r = await b.call("POST", `/knowledge/items/${item.id}/comments/${comment.id}/resolve`, { resolved: true });
  ok("author resolves their comment", r.status === 200 && r.body.resolvedAt !== null, code(r));
  r = await a.call("GET", `/knowledge/items/${item.id}`);
  ok("open comment count follows resolution", r.body.commentCount === 2 && r.body.openCommentCount === 0, `${r.body.commentCount}/${r.body.openCommentCount}`);
  r = await mgr.call("DELETE", `/knowledge/items/${item.id}/comments/${comment.id}`);
  ok("manager deletes a comment thread (moderation)", r.status === 200, code(r));

  // Categories ------------------------------------------------------------------------------------------
  r = await mgr.call("POST", `/knowledge/spaces/${pub.id}/categories`, { name: "Quy trình" });
  const root = r.body;
  r = await mgr.call("POST", `/knowledge/spaces/${pub.id}/categories`, { name: "Retouch", parentId: root.id });
  const child = r.body;
  ok("two-level categories", r.status === 201 && child.parentId === root.id, code(r));
  r = await mgr.call("POST", `/knowledge/spaces/${pub.id}/categories`, { name: "Sâu", parentId: child.id });
  ok("third level refused", r.status === 400 && code(r) === "KNOWLEDGE_CATEGORY_DEPTH", code(r));
  r = await mgr.call("PATCH", `/knowledge/spaces/${pub.id}/categories/${root.id}`, { parentId: child.id });
  ok("a category with children cannot move under another", r.status === 400, code(r));
  r = await a.call("POST", `/knowledge/spaces/${pub.id}/categories`, { name: "Không quyền" });
  ok("submit member cannot create categories", r.status === 403, code(r));
  r = await a.call("PATCH", `/knowledge/items/${item.id}`, { categoryId: child.id, reason: "Xếp vào chuyên mục" });
  ok("move item into a sub-category", r.status === 200 && r.body.category?.parent?.id === root.id, code(r));
  r = await b.call("GET", `/knowledge/spaces/${pub.id}/items?categoryId=${root.id}`);
  ok("filtering by a top category includes its sub-categories", r.body.items.some((entry) => entry.id === item.id));

  // Statuses replace ----------------------------------------------------------------------------------------
  const keep = (status, extra = {}) => ({ id: status.id, name: status.name, color: status.color, group: status.group, ...extra });
  const retired = statusByName(pub, "Hết hiệu lực");
  r = await mgr.call("PUT", `/knowledge/spaces/${pub.id}/statuses`, { statuses: [keep(nhap), keep(choDuyet), keep(banHanh), keep(canCapNhat)] });
  ok("every group needs a status", r.status === 400 && code(r) === "KNOWLEDGE_STATUS_GROUPS_REQUIRED", code(r));
  r = await mgr.call("PUT", `/knowledge/spaces/${pub.id}/statuses`, { statuses: [keep(nhap), keep(choDuyet), keep(canCapNhat), keep(retired)] });
  ok("removing a used status needs a reassignment", r.status === 400 && code(r) === "KNOWLEDGE_STATUS_REASSIGN_REQUIRED", code(r));
  r = await mgr.call("PUT", `/knowledge/spaces/${pub.id}/statuses`, {
    statuses: [keep(nhap), keep(choDuyet), keep(canCapNhat, { name: "Cần rà soát" }), { name: "Ban hành", color: "green", group: "active" }, keep(retired)],
    reassign: { [banHanh.id]: canCapNhat.id }
  });
  ok("replace statuses with reassignment", r.status === 200 && r.body.statuses.length === 5 && r.body.statuses.some((s) => s.name === "Cần rà soát"), code(r));
  r = await a.call("GET", `/knowledge/items/${item.id}`);
  ok("items moved to the kept status", r.body.status.id === canCapNhat.id && r.body.status.name === "Cần rà soát", r.body.status?.name);

  // Versions & history -------------------------------------------------------------------------------------
  r = await a.call("GET", `/knowledge/items/${item.id}/versions`);
  ok("members list versions (newest first)", r.status === 200 && r.body.items.map((v) => v.number).join(",") === "3,2,1", r.body.items?.map((v) => v.number).join(","));
  r = await b.call("GET", `/knowledge/items/${item.id}/versions`);
  ok("readers outside the space cannot list versions", r.status === 403, code(r));
  r = await a.call("POST", `/knowledge/items/${item.id}/versions/1/restore`, {});
  ok("restoring a version of a critical item needs a reason", r.status === 400 && code(r) === "KNOWLEDGE_REASON_REQUIRED", code(r));
  r = await a.call("POST", `/knowledge/items/${item.id}/versions/1/restore`, { reason: "Quay lại bản đầu" });
  ok("restore v1 creates v4", r.status === 200 && r.body.version === 4, code(r));
  r = await a.call("GET", `/knowledge/items/${item.id}/versions/4`);
  ok("v4 is a copy of v1 (restoredFrom 1)", r.body.restoredFrom === 1 && JSON.stringify(r.body.body).includes("Bước 1: kiểm tra ảnh gốc.") && !JSON.stringify(r.body.body).includes("Bước 2"));
  r = await a.call("GET", `/knowledge/items/${item.id}/history?limit=100`);
  const actions = new Set((r.body.items ?? []).map((entry) => entry.action));
  ok(
    "item history has every change",
    ["ITEM_CREATED", "ITEM_CONTENT_UPDATED", "ITEM_STATUS_CHANGED", "ITEM_IMPORTANCE_CHANGED", "ITEM_MOVED", "VERSION_RESTORED", "COMMENT_DELETED", "COMMENT_RESOLVED", "COMMENT_EDITED"].every((action) => actions.has(action)),
    [...actions].join(",")
  );
  const deletedForMember = r.body.items.find((entry) => entry.action === "COMMENT_DELETED");
  ok("deleted comment text hidden from non-managers", deletedForMember && !("text" in (deletedForMember.before ?? {})));
  ok("critical changes carry their reason", r.body.items.some((entry) => entry.action === "VERSION_RESTORED" && entry.reason === "Quay lại bản đầu"));
  r = await b.call("GET", `/knowledge/items/${item.id}/history`);
  ok("readers outside the space have no history", r.status === 403, code(r));

  // Audit log ----------------------------------------------------------------------------------------------
  r = await mgr.call("GET", `/knowledge/spaces/${pub.id}/audit?limit=100`);
  const audit = r.body.items ?? [];
  ok("space audit for the manager", r.status === 200 && audit.some((entry) => entry.action === "SPACE_CREATED") && audit.some((entry) => entry.action === "STATUSES_REPLACED"));
  ok("manager sees the deleted comment text", audit.some((entry) => entry.action === "COMMENT_DELETED" && typeof entry.before?.text === "string"));
  ok("manager sees a comment edit, old and new text (PD-031)", audit.some((entry) => entry.action === "COMMENT_EDITED" && typeof entry.before?.text === "string" && entry.after?.text === "Bước 3 thiếu định dạng (đã sửa câu)"));
  r = await mgr.call("GET", `/knowledge/spaces/${pub.id}/audit?action=MEMBER_ADDED`);
  ok("audit filter by action", r.body.items.length === 2 && r.body.items.every((entry) => entry.action === "MEMBER_ADDED"), `${r.body.items?.length}`);
  r = await a.call("GET", `/knowledge/spaces/${pub.id}/audit`);
  ok("submit members cannot read the full space log", r.status === 403, code(r));
  const exportRes = await fetch(`${apiOrigin}/api/v1/knowledge/spaces/${pub.id}/audit/export`, { headers: { cookie: mgr.cookieHeader(), origin: "http://127.0.0.1:5890" } });
  ok("audit Excel export", exportRes.status === 200 && (exportRes.headers.get("content-type") ?? "").includes("spreadsheetml"), String(exportRes.status));
  {
    // BE-2: a readable Vietnamese "Chi tiết" column instead of raw JSON before / after; the raw JSON stays, last.
    const ExcelJS = require("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await exportRes.arrayBuffer()));
    const sheet = workbook.getWorksheet("Nhật ký");
    const headers = (sheet?.getRow(1).values ?? []).slice(1);
    ok("export: 'Chi tiết' column, raw JSON last, no raw Trước / Sau", headers.includes("Chi tiết") && headers.at(-1) === "Dữ liệu gốc (JSON)" && !headers.includes("Trước"), headers.join(" | "));
    const rows = [];
    sheet?.eachRow((row, number) => {
      if (number > 1) rows.push(row.values);
    });
    const cell = (values, name) => String(values[headers.indexOf(name) + 1] ?? "");
    const detailOf = (label) => rows.filter((values) => cell(values, "Thao tác") === label).map((values) => cell(values, "Chi tiết"));
    ok("export: status change reads 'Trạng thái: … → …'", detailOf("Đổi trạng thái").some((detail) => /^Trạng thái: .+ → .+$/.test(detail)), detailOf("Đổi trạng thái")[0]);
    ok(
      "export: importance in Vietnamese",
      detailOf("Đổi mức quan trọng").length > 0 &&
        detailOf("Đổi mức quan trọng").every((detail) => /^Mức quan trọng: (Bình thường|Quan trọng|Rất quan trọng) → (Bình thường|Quan trọng|Rất quan trọng)$/.test(detail)),
      detailOf("Đổi mức quan trọng")[0]
    );
    ok("export: member added reads 'Thành viên: … — thêm với mức …'", detailOf("Thêm thành viên").some((detail) => /^Thành viên: .+ — thêm với mức (Chỉ xem|Thành viên|Quản lý)$/.test(detail)), detailOf("Thêm thành viên")[0]);
    ok("export: content saves name their version", detailOf("Sửa nội dung").some((detail) => /→ phiên bản \d+/.test(detail)), detailOf("Sửa nội dung")[0]);
    ok("export: comment edits keep both texts", detailOf("Sửa bình luận").some((detail) => detail.startsWith("Bình luận đã sửa: “Bước 3 thiếu định dạng (đã sửa câu)”")), detailOf("Sửa bình luận")[0]);
    ok("export: raw JSON kept for completeness", rows.some((values) => cell(values, "Dữ liệu gốc (JSON)").startsWith('{"before":')));
  }

  // Search -------------------------------------------------------------------------------------------------
  r = await a.call("POST", `/knowledge/spaces/${pub.id}/items`, { title: `Bản nháp bí mật ${unique}`, body: doc(text("nháp")) });
  const draft = r.body;
  r = await b.call("GET", `/search?q=${unique}&groups=knowledge`);
  const bHits = r.body.knowledge ?? [];
  ok("readers find the active item", bHits.some((hit) => hit.id === item.id) && !bHits.some((hit) => hit.id === draft.id), JSON.stringify(bHits.map((hit) => hit.title)));
  r = await a.call("GET", `/search?q=${unique}`);
  ok("members find drafts too (default groups include knowledge)", (r.body.knowledge ?? []).some((hit) => hit.id === draft.id));
  r = await b.call("GET", `/knowledge/spaces/${pub.id}/items?q=${encodeURIComponent("chan dung")}`);
  ok("in-space search without diacritics", r.body.items.some((entry) => entry.id === item.id));

  // Keyset paging on every sort (items without a review date sort last: "infinity" cursor) --------------------
  for (const sort of ["updated", "created", "title", "importance", "reviewBy"]) {
    const seen = [];
    let cursor = null;
    do {
      r = await a.call("GET", `/knowledge/spaces/${pub.id}/items?sort=${sort}&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (r.status !== 200) break;
      seen.push(...r.body.items.map((entry) => entry.id));
      cursor = r.body.pageInfo.nextCursor;
    } while (cursor);
    ok(`keyset paging by ${sort}`, r.status === 200 && seen.length === 2 && new Set(seen).size === 2, `${r.status} ${seen.length}`);
  }
  r = await a.call("GET", `/knowledge/spaces/${pub.id}/items?sort=updated&limit=1`);
  const updatedCursor = r.body.pageInfo.nextCursor;
  r = await a.call("GET", `/knowledge/spaces/${pub.id}/items?sort=title&cursor=${encodeURIComponent(updatedCursor)}`);
  ok("a cursor of another sort is refused", r.status === 400 && code(r) === "INVALID_CURSOR", code(r));
  r = await a.call("PATCH", `/knowledge/items/${draft.id}`, { reviewBy: "2026-02-31" });
  ok("impossible dates are a 400", r.status === 400, code(r));
  r = await a.call("PATCH", `/knowledge/items/${draft.id}`, { reviewBy: "2026-10-01", effectiveFrom: "2026-09-01" });
  ok("review date saved", r.status === 200 && r.body.reviewBy === "2026-10-01" && r.body.reviewDue === false, code(r));

  // Edit presence ------------------------------------------------------------------------------------------
  r = await a.call("POST", `/knowledge/items/${item.id}/editing`, { editing: true });
  ok("edit presence heartbeat", r.status === 200 && Array.isArray(r.body.editing), code(r));
  r = await mgr.call("GET", `/knowledge/items/${item.id}`);
  ok("others see who is editing", r.body.editing.some((user) => user.id === ids.a));
  await a.call("POST", `/knowledge/items/${item.id}/editing`, { editing: false });

  // Attachments --------------------------------------------------------------------------------------------
  const content = "Bảng kiểm tra màu";
  const ticket = (await a.call("POST", `/knowledge/items/${item.id}/attachments`, { fileName: "kiem-tra.txt", mimeType: "text/plain", sizeBytes: Buffer.byteLength(content) })).body;
  await storageFetch(ticket.uploadUrl, { method: "PUT", headers: { "content-type": "text/plain" }, body: content });
  r = await a.call("POST", `/knowledge/attachments/${ticket.attachmentId}/complete`, { target: "item" });
  ok("item attachment uploaded", r.status === 200 && r.body.itemId === item.id, code(r));
  r = await b.call("POST", "/knowledge/attachments/urls", { ids: [ticket.attachmentId] });
  ok("readers get a download URL", r.status === 200 && r.body.items.length === 1, code(r));
  const readerTicket = (await b.call("POST", `/knowledge/items/${item.id}/attachments`, { fileName: "anh.txt", mimeType: "text/plain", sizeBytes: 3 })).body;
  await storageFetch(readerTicket.uploadUrl, { method: "PUT", headers: { "content-type": "text/plain" }, body: "abc" });
  r = await b.call("POST", `/knowledge/attachments/${readerTicket.attachmentId}/complete`, { target: "item" });
  ok("readers cannot attach files to the item", r.status === 403, code(r));
  r = await b.call("POST", `/knowledge/attachments/${readerTicket.attachmentId}/complete`, { target: "comment" });
  ok("readers attach files to comments", r.status === 200, code(r));
  r = await b.call("POST", `/knowledge/items/${item.id}/comments`, { body: doc(text("Kèm ảnh")), attachmentIds: [readerTicket.attachmentId] });
  ok("comment with a file", r.status === 201 && r.body.attachments.length === 1, code(r));
  r = await a.call("DELETE", `/knowledge/attachments/${ticket.attachmentId}`);
  ok("uploader removes the item file", r.status === 200, code(r));

  // Tables and images in item bodies (owner decision 2026-10-11) -----------------------------------------------
  const cellWord = `bangma${tag.toLowerCase()}`;
  const para = (...content) => ({ type: "paragraph", content });
  const tableDoc = (...extra) => ({
    type: "doc",
    content: [
      para(text("Bảng giá dịch vụ")),
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", attrs: { colspan: 1, rowspan: 1, colwidth: [200] }, content: [para(text("Hạng mục"))] },
              { type: "tableHeader", content: [para(text("Phụ trách"))] }
            ]
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", attrs: { style: "color:red" }, content: [para(text(cellWord))] },
              { type: "tableCell", content: [para(mention(ids.c, "C"))] }
            ]
          }
        ]
      },
      ...extra
    ]
  });
  const image = (attachmentId, attrs = {}) => ({ type: "image", attrs: { attachmentId, ...attrs } });
  const sqlTrue = (statement) => localSql(statement)[0] === "t";
  const objectCount = (path) => Number(localSql(`SELECT count(*) FROM storage.objects WHERE name = ${quote(path)}`)[0]);
  const waitForObjectCount = async (path, expected) => {
    for (let attempt = 0; attempt < 30 && objectCount(path) !== expected; attempt += 1) await wait(200);
    return objectCount(path) === expected;
  };

  r = await a.call("POST", `/knowledge/spaces/${pub.id}/items`, { title: `Bảng và ảnh ${unique}`, body: tableDoc(image(randomUUID())) });
  ok("a new item cannot carry images yet (the editor saves the draft first)", r.status === 400 && code(r) === "KNOWLEDGE_IMAGE_INVALID", code(r));
  r = await a.call("POST", `/knowledge/spaces/${pub.id}/items`, { title: `Bảng và ảnh ${unique}`, body: tableDoc() });
  const rich = r.body;
  const storedTable = rich?.body?.content?.[1];
  ok("item with a table is created (draft, v1)", r.status === 201 && storedTable?.type === "table" && storedTable.content.length === 2, code(r));
  const headerAttrs = storedTable?.content?.[0]?.content?.[0]?.attrs ?? {};
  const cellAttrs = storedTable?.content?.[1]?.content?.[0]?.attrs ?? {};
  ok(
    "table cells keep only colspan / rowspan / colwidth",
    Object.keys(headerAttrs).length === 3 && headerAttrs.colspan === 1 && JSON.stringify(headerAttrs.colwidth) === "[200]" &&
      Object.keys(cellAttrs).length === 3 && cellAttrs.rowspan === 1 && cellAttrs.colwidth === null,
    JSON.stringify([headerAttrs, cellAttrs])
  );
  ok("plain text has one line per table row", sqlTrue(`SELECT position(${quote("Hạng mục | Phụ trách")} IN body_text) > 0 FROM knowledge.items WHERE id = ${quote(rich.id)}`));
  ok("mentions inside table cells work (server label, mention list)", JSON.stringify(storedTable).includes(ctx.c.user.displayName) &&
    sqlTrue(`SELECT ${quote(ids.c)}::uuid = ANY(mentioned_user_ids) FROM knowledge.items WHERE id = ${quote(rich.id)}`));
  r = await a.call("GET", `/knowledge/spaces/${pub.id}/items?q=${cellWord}`);
  ok("in-space search finds table cell text", (r.body.items ?? []).some((entry) => entry.id === rich.id), code(r));
  r = await a.call("GET", `/search?q=${cellWord}&groups=knowledge`);
  ok("global search finds table cell text", (r.body.knowledge ?? []).some((hit) => hit.id === rich.id), code(r));

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const upload = async (s, itemId, fileName, mimeType, bytes, { complete = true } = {}) => {
    const issued = (await s.call("POST", `/knowledge/items/${itemId}/attachments`, { fileName, mimeType, sizeBytes: bytes.length })).body;
    if (!complete) return { id: issued.attachmentId, done: null };
    await storageFetch(issued.uploadUrl, { method: "PUT", headers: { "content-type": mimeType }, body: bytes });
    return { id: issued.attachmentId, done: await s.call("POST", `/knowledge/attachments/${issued.attachmentId}/complete`, { target: "item" }) };
  };
  const pngA = await upload(a, rich.id, "so-do.png", "image/png", png);
  ok("image uploaded to the saved draft", pngA.done.status === 200 && pngA.done.body.isImage === true, code(pngA.done));
  const textFile = await upload(a, rich.id, "ghi-chu.txt", "text/plain", Buffer.from("ghi chu"));
  const pendingImage = await upload(a, rich.id, "cho.png", "image/png", png, { complete: false });
  const [pngPath, textPath] = [pngA.id, textFile.id].map(
    (id) => localSql(`SELECT storage_path FROM knowledge.item_attachments WHERE id = ${quote(id)}`)[0]
  );

  r = await a.call("PATCH", `/knowledge/items/${rich.id}`, {
    expectedVersion: 1,
    body: tableDoc(image(pngA.id, { alt: "Sơ đồ quy trình", width: 480, src: "https://evil.example/x.png", title: "x" }))
  });
  ok("image placed in the body (v2)", r.status === 200 && r.body.version === 2, code(r));
  const placed = (r.body?.body?.content ?? []).find((node) => node.type === "image");
  ok(
    "the image node keeps attachmentId / alt / width only (no src, no URL)",
    placed?.attrs?.attachmentId === pngA.id && placed.attrs.alt === "Sơ đồ quy trình" && placed.attrs.width === 480 &&
      Object.keys(placed.attrs).length === 3 && !JSON.stringify(r.body.body).includes("evil"),
    JSON.stringify(placed ?? null)
  );
  ok("plain text reads [Ảnh: alt]", sqlTrue(`SELECT position(${quote("[Ảnh: Sơ đồ quy trình]")} IN body_text) > 0 FROM knowledge.items WHERE id = ${quote(rich.id)}`));
  ok("the version records its image", sqlTrue(`SELECT ${quote(pngA.id)}::uuid = ANY(image_attachment_ids) FROM knowledge.item_versions WHERE item_id = ${quote(rich.id)} AND number = 2`));

  r = await a.call("GET", `/knowledge/items/${draft.id}`);
  const otherItem = { id: draft.id, version: r.body.version };
  for (const [label, target, attachmentId, version] of [
    ["a text file", rich.id, textFile.id, 2],
    ["an upload that never completed", rich.id, pendingImage.id, 2],
    ["an unknown id", rich.id, randomUUID(), 2],
    ["an image of another item", otherItem.id, pngA.id, otherItem.version]
  ]) {
    r = await a.call("PATCH", `/knowledge/items/${target}`, { expectedVersion: version, body: tableDoc(image(attachmentId)) });
    ok(`image refused: ${label}`, r.status === 400 && code(r) === "KNOWLEDGE_IMAGE_INVALID", code(r));
  }
  r = await b.call("POST", `/knowledge/items/${item.id}/comments`, { body: tableDoc(image(pngA.id), para(text("Bình luận có bảng"))) });
  ok("comments keep today's rules (no tables, no images)", r.status === 201 && !JSON.stringify(r.body.body).includes("table") && !JSON.stringify(r.body.body).includes("image"), code(r));
  r = await mgr.call("DELETE", `/knowledge/items/${item.id}/comments/${r.body.id}`);

  // Images used by a version stay in storage until the item itself is purged.
  r = await mgr.call("GET", `/knowledge/spaces/${pub.id}`);
  const activeStatus = r.body.statuses.find((status) => status.group === "active");
  r = await a.call("PATCH", `/knowledge/items/${rich.id}`, { statusId: activeStatus.id });
  ok("rich item published", r.status === 200 && r.body.status.group === "active", code(r));
  r = await a.call("PATCH", `/knowledge/items/${rich.id}`, { expectedVersion: 2, body: tableDoc() });
  ok("image taken out of the body (v3)", r.status === 200 && r.body.version === 3, code(r));
  r = await a.call("DELETE", `/knowledge/attachments/${pngA.id}`);
  ok("deleting the image file", r.status === 200, code(r));
  r = await a.call("GET", `/knowledge/items/${rich.id}`);
  ok("…hides it from the attachment list", !r.body.attachments.some((file) => file.id === pngA.id) && r.body.attachments.some((file) => file.id === textFile.id));
  await wait(300);
  ok("…but keeps the object in storage (v2 still shows it)", objectCount(pngPath) === 1);
  r = await b.call("POST", "/knowledge/attachments/urls", { ids: [pngA.id] });
  const hiddenUrl = r.body?.items?.[0]?.url;
  ok("readers of the item still get a URL for the hidden image", r.status === 200 && r.body.items.length === 1, code(r));
  const fetched = hiddenUrl ? await storageFetch(hiddenUrl) : null;
  ok("…and the image downloads", fetched?.status === 200 && Buffer.from(await fetched.arrayBuffer()).equals(png), String(fetched?.status));
  r = await a.call("POST", `/knowledge/items/${rich.id}/versions/2/restore`, {});
  ok("restoring v2 brings the hidden image back into the body (v4)", r.status === 200 && r.body.version === 4 && JSON.stringify(r.body.body).includes(pngA.id), code(r));
  r = await a.call("PATCH", `/knowledge/items/${rich.id}`, { expectedVersion: 4, body: tableDoc(image(pngA.id, { alt: "Sơ đồ" })) });
  ok("saving a body that still uses the hidden image stays valid (v5)", r.status === 200 && r.body.version === 5, code(r));
  r = await a.call("DELETE", `/knowledge/attachments/${textFile.id}`);
  ok("a file no version uses is removed from storage", r.status === 200 && (await waitForObjectCount(textPath, 0)), code(r));

  // Limits: longer articles than task descriptions; tables bounded; bodies up to 4 MB.
  const rows = (count) => Array.from({ length: count }, (_, index) => ({ type: "tableRow", content: [{ type: "tableCell", content: [para(text(`r${index}`))] }] }));
  r = await a.call("PATCH", `/knowledge/items/${rich.id}`, { expectedVersion: 5, body: { type: "doc", content: [{ type: "table", content: rows(61) }] } });
  ok("61 table rows refused", r.status === 400 && code(r) === "INVALID_RICH_TEXT", code(r));
  r = await a.call("PATCH", `/knowledge/items/${rich.id}`, { expectedVersion: 5, body: { type: "doc", content: Array.from({ length: 150 }, () => para(text("x".repeat(1000)))) } });
  ok("a 150 000-character article is accepted (task descriptions stop at 100 000)", r.status === 200 && r.body.version === 6, code(r));
  const fullTable = () => ({
    type: "table",
    content: Array.from({ length: 60 }, () => ({ type: "tableRow", content: Array.from({ length: 12 }, () => ({ type: "tableCell", content: [para(text("ô"))] })) }))
  });
  const bigBody = { type: "doc", content: Array.from({ length: 20 }, fullTable) };
  const bigSize = Buffer.byteLength(JSON.stringify({ expectedVersion: 6, body: bigBody }));
  r = await a.call("PATCH", `/knowledge/items/${rich.id}`, { expectedVersion: 6, body: bigBody });
  ok("20 full tables (60 × 12) in a body over 1 MB are accepted", bigSize > 1024 * 1024 && r.status === 200 && r.body.version === 7, `${code(r)} ${bigSize} bytes`);
  r = await a.call("PATCH", `/knowledge/items/${rich.id}`, { expectedVersion: 7, body: { type: "doc", content: [...bigBody.content, fullTable()] } });
  ok("a 21st table is refused", r.status === 400 && code(r) === "INVALID_RICH_TEXT", code(r));

  // Purging the item removes every file, the kept image included.
  await a.call("DELETE", `/knowledge/items/${rich.id}`, {});
  r = await mgr.call("POST", `/knowledge/items/${rich.id}/purge`, { reason: "Dọn ảnh" });
  ok("purging the item removes the kept image from storage", r.status === 200 && (await waitForObjectCount(pngPath, 0)), code(r));

  // Private space mentions --------------------------------------------------------------------------------
  r = await a.call("POST", `/knowledge/spaces/${priv.id}/items`, { title: `Mật ${unique}`, body: doc(text("Hỏi "), mention(ids.b, "B"), text(" và "), mention(ids.mgr, "M")) });
  const secret = r.body;
  ok("people who cannot read the space become plain text", r.status === 201 && !JSON.stringify(secret.body).includes(ids.b) && JSON.stringify(secret.body).includes(ids.mgr), code(r));
  r = await b.call("GET", `/knowledge/items/${secret.id}`);
  ok("private items are a 404 for outsiders", r.status === 404, code(r));
  r = await b.call("GET", `/search?q=${unique}&groups=knowledge`);
  ok("search never returns private items to outsiders", !(r.body.knowledge ?? []).some((hit) => hit.id === secret.id));

  // Realtime -------------------------------------------------------------------------------------------------
  await wait(300);
  ok("room members get knowledge:changed hints without content", live.some((event) => event.spaceId === pub.id && event.itemId === item.id) && live.every((event) => !("title" in event)), `${live.length} events`);

  // Trash ---------------------------------------------------------------------------------------------------
  r = await a.call("DELETE", `/knowledge/items/${item.id}`, {});
  ok("deleting a critical item needs a reason", r.status === 400 && code(r) === "KNOWLEDGE_REASON_REQUIRED", code(r));
  r = await a.call("DELETE", `/knowledge/items/${item.id}`, { reason: "Thay bằng quy trình mới" });
  ok("delete to trash", r.status === 200, code(r));
  r = await b.call("GET", `/knowledge/items/${item.id}`);
  ok("trashed item hidden from readers", r.status === 404, code(r));
  r = await a.call("GET", `/knowledge/spaces/${pub.id}/trash`);
  const trashed = (r.body.items ?? []).find((entry) => entry.id === item.id);
  ok("trash lists it (restore yes, purge no for submit)", trashed && trashed.canRestore && !trashed.canPurge && trashed.purgeAt > trashed.deletedAt);
  r = await a.call("POST", `/knowledge/items/${item.id}/purge`, { reason: "x".repeat(5) });
  ok("submit members cannot purge", r.status === 403, code(r));
  r = await a.call("POST", `/knowledge/items/${item.id}/restore`, { reason: "Nhầm" });
  ok("restore from trash", r.status === 200 && r.body.deletedAt === null, code(r));
  await a.call("DELETE", `/knowledge/items/${item.id}`, { reason: "Xoá lại" });
  r = await mgr.call("POST", `/knowledge/items/${item.id}/purge`, { reason: "Xoá vĩnh viễn" });
  ok("manager purges", r.status === 200, code(r));
  r = await mgr.call("GET", `/knowledge/items/${item.id}`);
  ok("purged item is gone", r.status === 404, code(r));
  ok("its versions are gone", localSql(`SELECT count(*) FROM knowledge.item_versions WHERE item_id = ${quote(item.id)}`)[0] === "0");
  ok("its audit entries stay", Number(localSql(`SELECT count(*) FROM knowledge.audit_log WHERE item_id = ${quote(item.id)}`)[0]) > 5);
  r = await mgr.call("GET", `/knowledge/spaces/${pub.id}/audit?itemId=${item.id}&action=ITEM_PURGED`);
  ok("purge is in the space log with title and reason", r.body.items?.[0]?.itemTitle?.includes(unique) && r.body.items?.[0]?.reason === "Xoá vĩnh viễn");

  // Append-only guards ----------------------------------------------------------------------------------------
  const refused = (statement) => {
    try {
      localSql(`BEGIN; ${statement}; ROLLBACK;`);
      return false;
    } catch {
      return true;
    }
  };
  ok("audit_log refuses UPDATE", refused(`UPDATE knowledge.audit_log SET reason = 'x' WHERE space_id = ${quote(pub.id)}`));
  ok("audit_log refuses DELETE", refused(`DELETE FROM knowledge.audit_log WHERE space_id = ${quote(pub.id)}`));
  ok("audit_log refuses TRUNCATE", refused("TRUNCATE knowledge.audit_log"));
  ok("item_versions refuses UPDATE", refused(`UPDATE knowledge.item_versions SET note = 'x' WHERE space_id = ${quote(pub.id)}`));
  ok("item_versions refuses TRUNCATE", refused("TRUNCATE knowledge.item_versions CASCADE"));

  // Visibility change, archive, delete -------------------------------------------------------------------------
  r = await b.call("POST", `/knowledge/items/${draft.id}/follow`);
  ok("drafts cannot be followed by readers", r.status === 404, code(r));
  r = await mgr.call("PATCH", `/knowledge/spaces/${pub.id}`, { visibility: "private" });
  ok("space made private", r.status === 200 && r.body.visibility === "private", code(r));
  r = await b.call("GET", `/knowledge/spaces/${pub.id}`);
  ok("former readers lose the space", r.status === 404, code(r));
  r = await mgr.call("POST", `/knowledge/spaces/${priv.id}/archive`);
  ok("archive space", r.status === 200, code(r));
  r = await a.call("GET", `/knowledge/spaces/${priv.id}`);
  ok("archived space opens read-only for its members", r.status === 200 && r.body.archivedAt !== null && r.body.capabilities.canRead && !r.body.capabilities.canEdit, code(r));
  r = await b.call("GET", `/knowledge/spaces/${priv.id}`);
  ok("…and stays a 404 for outsiders", r.status === 404, code(r));
  r = await mgr.call("GET", "/knowledge/spaces/archived");
  ok("archived list", r.body.items.some((space) => space.id === priv.id && space.archivedAt));
  r = await mgr.call("POST", `/knowledge/spaces/${priv.id}/restore`);
  ok("restore space", r.status === 200 && r.body.archivedAt === null, code(r));
  r = await mgr.call("DELETE", `/knowledge/spaces/${priv.id}`);
  ok("delete space", r.status === 200, code(r));
  r = await a.call("GET", `/knowledge/spaces/${priv.id}`);
  ok("deleted space is gone", r.status === 404, code(r));
  const lastPrivEntry = localSql(`
    SELECT action || '|' || coalesce(before->>'name', '') || '|' || (after ? 'deletedAt')::text
    FROM knowledge.audit_log WHERE space_id = ${quote(priv.id)} ORDER BY created_at DESC, id DESC LIMIT 1
  `)[0];
  ok("deleting a space is logged as SPACE_DELETED (the soft delete keeps the log)", lastPrivEntry === `SPACE_DELETED|E2E KB priv ${tag}|true`, lastPrivEntry);

  // Archived spaces: read-only for their members and org admins, closed to everyone else (2026-10-11) ------------
  r = await mgr.call("POST", "/knowledge/spaces", { name: `E2E KB arch ${tag}`, visibility: "public" });
  const arch = r.body;
  created.push(arch?.id);
  ok("create a public space to archive", r.status === 201, code(r));
  await mgr.call("POST", `/knowledge/spaces/${arch.id}/members`, { userId: ids.a, accessLevel: "submit" });
  r = await mgr.call("POST", `/knowledge/spaces/${arch.id}/members`, { userId: ids.c, accessLevel: "manage" });
  ok("a second Quản lý whose role lacks knowledge.delete", r.status === 200 && !(ctx.c.role?.permissions ?? []).includes("knowledge.delete"), code(r));
  const archActive = arch.statuses.find((status) => status.group === "active");
  r = await mgr.call("POST", `/knowledge/spaces/${arch.id}/items`, { title: `Sổ tay lưu trữ ${unique}`, body: doc(text("Nội dung đã chốt")), statusId: archActive.id });
  const archItem = r.body;
  ok("a published item in it", r.status === 201 && archItem.status.group === "active", code(r));
  r = await a.call("POST", `/knowledge/items/${archItem.id}/comments`, { body: doc(text("Góp ý của thành viên")) });
  const archComment = r.body;
  r = await b.call("POST", `/knowledge/items/${archItem.id}/comments`, { body: doc(text("Góp ý của người đọc")) });
  ok("member and public reader comment before the archive", Boolean(archComment?.id) && r.status === 201, code(r));
  r = await b.call("GET", `/search?q=${encodeURIComponent(`Sổ tay lưu trữ ${unique}`)}&groups=knowledge`);
  ok("readers find it while it is live", (r.body.knowledge ?? []).some((hit) => hit.id === archItem.id));
  r = await c.call("POST", `/knowledge/spaces/${arch.id}/archive`);
  ok("a Quản lý without knowledge.delete cannot archive", r.status === 403, code(r));
  r = await mgr.call("POST", `/knowledge/spaces/${arch.id}/archive`);
  ok("archive the public space", r.status === 200, code(r));

  r = await c.call("GET", `/knowledge/spaces/${arch.id}`);
  const archCaps = r.body.capabilities ?? {};
  ok(
    "members open it read-only: capabilities all false except read",
    r.status === 200 && r.body.archivedAt !== null && archCaps.canRead && !archCaps.canComment && !archCaps.canEdit && !archCaps.canManage && !archCaps.canUpdate && !archCaps.canManageMembers && !archCaps.canPurge,
    JSON.stringify(archCaps)
  );
  ok("a Quản lý without knowledge.delete still reads the log, cannot restore", archCaps.canViewAudit === true && archCaps.canArchive === false);
  r = await mgr.call("GET", `/knowledge/spaces/${arch.id}`);
  ok("the manager holding knowledge.delete may restore or delete it (canArchive)", r.status === 200 && r.body.capabilities.canArchive === true && r.body.capabilities.canUpdate === false, JSON.stringify(r.body.capabilities));
  r = await a.call("GET", "/knowledge/spaces");
  const listed = r.body.items ?? [];
  const aArch = listed.find((space) => space.id === arch.id);
  ok(
    "in the members' space list with archivedAt (after the live spaces)",
    aArch && aArch.archivedAt !== null && !aArch.capabilities.canEdit && listed.findIndex((space) => space.archivedAt !== null) > listed.findLastIndex((space) => space.archivedAt === null)
  );
  r = await b.call("GET", "/knowledge/spaces");
  ok("not in a non-member's list (a public space closes when archived)", !(r.body.items ?? []).some((space) => space.id === arch.id));
  r = await b.call("GET", `/knowledge/spaces/${arch.id}`);
  ok("non-members get a 404 for the space", r.status === 404, code(r));
  r = await b.call("GET", `/knowledge/items/${archItem.id}`);
  ok("…and for its items", r.status === 404, code(r));
  r = await b.call("POST", `/knowledge/items/${archItem.id}/comments`, { body: doc(text("Còn ai không?")) });
  ok("…and for writes (nothing revealed)", r.status === 404, code(r));
  r = await b.call("GET", `/search?q=${encodeURIComponent(`Sổ tay lưu trữ ${unique}`)}&groups=knowledge`);
  ok("archived items leave search for non-members", !(r.body.knowledge ?? []).some((hit) => hit.id === archItem.id));
  ok("the archived space has no realtime room for outsiders", (await join({ type: "knowledge", id: arch.id })).ok === false);

  r = await a.call("GET", `/knowledge/spaces/${arch.id}/items`);
  ok("members list its items", r.status === 200 && r.body.items.some((entry) => entry.id === archItem.id), code(r));
  r = await a.call("GET", `/knowledge/items/${archItem.id}`);
  const archItemCaps = r.body.capabilities ?? {};
  ok(
    "the item page opens read-only",
    r.status === 200 &&
      !archItemCaps.canEdit &&
      !archItemCaps.canChangeStatus &&
      !archItemCaps.canDelete &&
      !archItemCaps.canRestore &&
      !archItemCaps.canComment &&
      archItemCaps.allowedStatusIds?.length === 0 &&
      archItemCaps.canViewHistory,
    JSON.stringify(archItemCaps)
  );
  r = await a.call("GET", `/knowledge/items/${archItem.id}/versions/1`);
  ok("versions stay readable", r.status === 200 && r.body.number === 1, code(r));
  r = await a.call("GET", `/knowledge/items/${archItem.id}/history`);
  ok("history stays readable", r.status === 200 && r.body.items.length > 0, code(r));
  r = await a.call("GET", `/knowledge/items/${archItem.id}/comments`);
  ok("comments stay readable, none editable", r.status === 200 && r.body.items.length === 2 && r.body.items.every((entry) => !entry.canEdit && !entry.canDelete && !entry.canResolve), code(r));
  r = await a.call("GET", `/knowledge/spaces/${arch.id}/members`);
  ok("members stay readable", r.status === 200 && r.body.items.length === 3, code(r));
  r = await a.call("GET", `/knowledge/spaces/${arch.id}/trash`);
  ok("the trash list stays readable", r.status === 200, code(r));
  r = await c.call("GET", `/knowledge/spaces/${arch.id}/audit?action=SPACE_ARCHIVED`);
  ok("managers read the space log", r.status === 200 && r.body.items.length === 1, code(r));
  r = await a.call("POST", "/knowledge/attachments/urls", { ids: [randomUUID()] });
  ok("file URLs are a read (no error)", r.status === 200, code(r));

  const archivedRefusal = (res) => res.status === 409 && code(res) === "KNOWLEDGE_SPACE_ARCHIVED" && /lưu trữ/.test(res.body?.error?.message ?? "");
  const archStatuses = { statuses: arch.statuses.map(({ id, name, color, group }) => ({ id, name, color, group })), reassign: {} };
  const writes = [
    ["create an item", a, "POST", `/knowledge/spaces/${arch.id}/items`, { title: "Mục mới", body: doc(text("x")) }],
    ["edit the content", mgr, "PATCH", `/knowledge/items/${archItem.id}`, { title: "Đổi tên", expectedVersion: 1 }],
    ["change a field", mgr, "PATCH", `/knowledge/items/${archItem.id}`, { importance: "important" }],
    ["move to the trash", mgr, "DELETE", `/knowledge/items/${archItem.id}`, {}],
    ["restore a version", mgr, "POST", `/knowledge/items/${archItem.id}/versions/1/restore`, {}],
    ["edit presence", mgr, "POST", `/knowledge/items/${archItem.id}/editing`, { editing: true }],
    ["comment", a, "POST", `/knowledge/items/${archItem.id}/comments`, { body: doc(text("x")) }],
    ["edit an own comment", a, "PATCH", `/knowledge/items/${archItem.id}/comments/${archComment.id}`, { body: doc(text("y")) }],
    ["delete an own comment", a, "DELETE", `/knowledge/items/${archItem.id}/comments/${archComment.id}`],
    ["resolve a comment", mgr, "POST", `/knowledge/items/${archItem.id}/comments/${archComment.id}/resolve`, { resolved: true }],
    ["follow", c, "POST", `/knowledge/items/${archItem.id}/follow`],
    ["unfollow", a, "DELETE", `/knowledge/items/${archItem.id}/follow`],
    ["upload a file", a, "POST", `/knowledge/items/${archItem.id}/attachments`, { fileName: "a.png", mimeType: "image/png", sizeBytes: 10 }],
    ["change settings", mgr, "PATCH", `/knowledge/spaces/${arch.id}`, { description: "Mô tả mới" }],
    ["add a member", mgr, "POST", `/knowledge/spaces/${arch.id}/members`, { userId: ids.b, accessLevel: "view" }],
    ["change a member", mgr, "PATCH", `/knowledge/spaces/${arch.id}/members/${ids.a}`, { accessLevel: "view" }],
    ["remove a member", mgr, "DELETE", `/knowledge/spaces/${arch.id}/members/${ids.a}`],
    ["replace statuses", mgr, "PUT", `/knowledge/spaces/${arch.id}/statuses`, archStatuses],
    ["add a category", mgr, "POST", `/knowledge/spaces/${arch.id}/categories`, { name: "Chuyên mục" }],
    ["archive it again", mgr, "POST", `/knowledge/spaces/${arch.id}/archive`]
  ];
  const unexpected = [];
  for (const [label, who, method, path, body] of writes) {
    const res = await who.call(method, path, body);
    if (!archivedRefusal(res)) unexpected.push(`${label}: ${res.status} ${code(res)}`);
  }
  ok(`every write answers 409 KNOWLEDGE_SPACE_ARCHIVED (${writes.length} kinds)`, unexpected.length === 0, unexpected.join("; "));
  ok(
    "nothing changed while archived",
    localSql(`SELECT count(*) FROM knowledge.items WHERE space_id = ${quote(arch.id)}`)[0] === "1" &&
      localSql(`SELECT version || '|' || importance || '|' || (deleted_at IS NULL)::text FROM knowledge.items WHERE id = ${quote(archItem.id)}`)[0] === "1|normal|true" &&
      localSql(`SELECT count(*) FROM knowledge.comments WHERE item_id = ${quote(archItem.id)} AND deleted_at IS NULL`)[0] === "2" &&
      localSql(`SELECT count(*) FROM knowledge.space_members WHERE space_id = ${quote(arch.id)}`)[0] === "3"
  );

  r = await c.call("POST", `/knowledge/spaces/${arch.id}/restore`);
  ok("restore needs knowledge.delete", r.status === 403, code(r));
  r = await mgr.call("POST", `/knowledge/spaces/${arch.id}/restore`);
  ok("restore reopens it for writes", r.status === 200 && r.body.archivedAt === null && r.body.capabilities.canEdit && r.body.capabilities.canComment, code(r));
  r = await b.call("GET", `/knowledge/items/${archItem.id}`);
  ok("public readers read it again after the restore", r.status === 200 && r.body.capabilities.canComment === true, code(r));
  await mgr.call("POST", `/knowledge/spaces/${arch.id}/archive`);
  r = await mgr.call("DELETE", `/knowledge/spaces/${arch.id}`);
  ok("an archived space can be deleted", r.status === 200, code(r));
  const archDeleted = localSql(`
    SELECT action || '|' || (before->>'archivedAt' IS NOT NULL)::text || '|' || (before->>'itemCount')
    FROM knowledge.audit_log WHERE space_id = ${quote(arch.id)} ORDER BY created_at DESC, id DESC LIMIT 1
  `)[0];
  ok("…logged as SPACE_DELETED (was archived, 1 item)", archDeleted === "SPACE_DELETED|true|1", archDeleted);
  r = await c.call("GET", `/knowledge/spaces/${arch.id}`);
  ok("a deleted space is gone for its members too", r.status === 404, code(r));
} finally {
  socket.close();
  try {
    // Before the grants go: purging trashed items with files needs knowledge.delete.
    await cleanupKnowledgeSpaces(mgr, created, since);
  } finally {
    revokeSuiteKnowledgeGrants();
    bumpAuthz();
  }
}
