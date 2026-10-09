// Chat / inbox regressions of fix wave 1 (SEC-API-02/03/10/13, BUG-WK-04/05/06, WK-42/45/46/63) and socket
// re-authentication without reconnecting (PERF-02). Self-cleaning.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dbNow, purgeChannels, quote, settleOutbox } from "./cleanup.mjs";
import { apiOrigin, localSql, session } from "./lib.mjs";
const require = createRequire(process.cwd() + "/package.json");
const { io } = require("socket.io-client");
const ok = (label, cond, extra = "") => console.log(`${cond ? "PASS" : "FAIL"}  ${label} ${extra}`);
const doc = (...content) => ({ type: "doc", content: [{ type: "paragraph", content }] });
const text = (value) => ({ type: "text", text: value });
const mention = (id, label) => ({ type: "mention", attrs: { id, label } });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (check, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value || Date.now() > deadline) return value;
    await sleep(400);
  }
};

const mgr = await session("MANAGER"), a = await session("MEMBER_A"), b = await session("MEMBER_B"), c = await session("MEMBER_C");
const ctx = {};
for (const [name, s] of Object.entries({ mgr, a, b, c })) {
  ctx[name] = (await s.call("GET", "/workspace/context")).body;
}
const since = dbNow();
const run = Math.random().toString(36).slice(2, 8);
const channels = [];
const newChannel = async (s, kind, name) => {
  const r = await s.call("POST", "/channels", { kind, name });
  if (r.status === 201) channels.push(r.body.id);
  return r;
};
const send = async (s, channelId, body, extra = {}) => (await s.call("POST", `/channels/${channelId}/messages`, { body, clientMessageId: randomUUID(), ...extra })).body;
const inbox = async (s) => (await s.call("GET", "/notifications?limit=100")).body.items ?? [];
const settingRow = localSql(`
  SELECT s.value::text FROM production.settings s
  WHERE s.organization_id = ${quote(ctx.a.organization.id)} AND s.key = 'chat_attachments_enabled'
`);
let socketA = null;

try {
  const x = (await newChannel(a, "public", `e2e-fix-${run}`)).body;
  await mgr.call("POST", `/channels/${x.id}/join`);
  await b.call("POST", `/channels/${x.id}/join`);
  await c.call("POST", `/channels/${x.id}/join`);

  // --- SEC-API-02: channel.manage_members cannot hand out (or take) the channel admin role ------------
  let r = await mgr.call("GET", `/channels/${x.id}`);
  ok("manage_members holder sees canManageAdmins=false", r.body.capabilities?.canManageMembers === true && r.body.capabilities?.canManageAdmins === false);
  r = await mgr.call("PATCH", `/channels/${x.id}/members/${ctx.mgr.user.id}`, { role: "admin" });
  ok("no self-promotion to channel admin (403)", r.status === 403 && r.body.error.code === "CHANNEL_ADMIN_ONLY", r.status);
  r = await mgr.call("PATCH", `/channels/${x.id}/members/${ctx.b.user.id}`, { role: "admin" });
  ok("manage_members holder cannot make others admin (403)", r.status === 403, r.status);
  r = await a.call("PATCH", `/channels/${x.id}/members/${ctx.b.user.id}`, { role: "admin" });
  ok("channel admin makes B admin", r.status === 200 && r.body.role === "admin", r.status);
  r = await mgr.call("DELETE", `/channels/${x.id}/members/${ctx.b.user.id}`);
  ok("manage_members holder cannot remove an admin (403)", r.status === 403, r.status);
  r = await mgr.call("PATCH", `/channels/${x.id}/members/${ctx.c.user.id}`, { access: "view" });
  ok("...but still manages ordinary members", r.status === 200 && r.body.access === "view", r.status);
  await mgr.call("PATCH", `/channels/${x.id}/members/${ctx.c.user.id}`, { access: "submit" });

  // --- SEC-API-13 / WK-41: private channel names are invisible to everyone else -----------------------
  const secretName = `e2e-secret-${run}`;
  await newChannel(a, "private", secretName);
  r = await newChannel(c, "public", secretName);
  ok("a public channel may take a private channel's name (nothing revealed)", r.status === 201, r.body?.error?.code);
  r = await newChannel(b, "public", secretName);
  ok("public names stay unique", r.status === 409 && r.body.error.code === "CHANNEL_NAME_TAKEN", r.status);
  r = await newChannel(b, "private", secretName);
  ok("private channels never hold a name (WK-41)", r.status === 201, r.body?.error?.code);

  // --- SEC-API-10 / WK-44: mention labels come from the server ---------------------------------------
  const labelled = await send(a, x.id, doc(text("Hỏi "), mention(ctx.b.user.id, "Giám đốc")));
  ok("spoofed mention label replaced by the display name", labelled.text === `Hỏi @${ctx.b.user.displayName}` && JSON.stringify(labelled.body).includes(ctx.b.user.displayName), labelled.text);

  // --- BUG-WK-05: edited / deleted messages leave no stale text in the inbox --------------------------
  const original = await send(a, x.id, doc(mention(ctx.c.user.id, "c"), text(" bí mật cũ")));
  const notified = await waitFor(async () => (await inbox(c)).find((n) => n.target.messageId === original.id));
  ok("C notified about the mention", Boolean(notified), notified?.body ?? "");
  await a.call("PATCH", `/messages/${original.id}`, { body: doc(mention(ctx.c.user.id, "c"), text(" nội dung mới")) });
  const refreshed = await waitFor(async () => (await inbox(c)).find((n) => n.target.messageId === original.id && n.body?.includes("nội dung mới")));
  ok("edit refreshes the inbox excerpt", Boolean(refreshed) && !refreshed.body.includes("bí mật cũ"), refreshed?.body ?? "");
  await a.call("DELETE", `/messages/${original.id}`);
  const removed = await waitFor(async () => !(await inbox(c)).some((n) => n.target.messageId === original.id));
  ok("delete removes the inbox entry", Boolean(removed));

  // --- BUG-WK-06: notify levels ------------------------------------------------------------------------
  await c.call("PATCH", `/channels/${x.id}/me`, { notifyLevel: "none" });
  const muted = await send(a, x.id, doc(mention(ctx.c.user.id, "c"), text(" muted?")));
  const root = await send(b, x.id, doc(text("Chủ đề")));
  await send(c, x.id, doc(text("C tham gia")), { threadRootId: root.id });
  await c.call("PATCH", `/channels/${x.id}/me`, { notifyLevel: "mentions" });
  const replyWhileMentions = await send(b, x.id, doc(text("trả lời 1")), { threadRootId: root.id });
  const mentionWhileMentions = await send(a, x.id, doc(mention(ctx.c.user.id, "c"), text(" vẫn báo")));
  await waitFor(async () => (await inbox(c)).some((n) => n.target.messageId === mentionWhileMentions.id));
  await c.call("PATCH", `/channels/${x.id}/me`, { notifyLevel: "all" });
  const replyWhileAll = await send(b, x.id, doc(text("trả lời 2")), { threadRootId: root.id });
  await waitFor(async () => (await inbox(c)).some((n) => n.target.messageId === replyWhileAll.id));
  const items = await inbox(c);
  ok("'none': no mention notification", !items.some((n) => n.target.messageId === muted.id));
  ok("'mentions': mentions notify", items.some((n) => n.target.messageId === mentionWhileMentions.id && n.type === "chat.mentioned"));
  ok("'mentions': thread replies do not", !items.some((n) => n.target.messageId === replyWhileMentions.id));
  ok("'all': thread replies notify", items.some((n) => n.target.messageId === replyWhileAll.id && n.type === "chat.thread_replied"));

  // --- BUG-WK-04: channel turned private / deleted → inbox entries of people who lost it go -----------
  const y = (await newChannel(a, "public", `e2e-fix-y-${run}`)).body;
  await b.call("POST", `/channels/${y.id}/join`);
  const toOutsider = await send(a, y.id, doc(mention(ctx.c.user.id, "c"), text(" (C chưa tham gia)")));
  const toMember = await send(a, y.id, doc(mention(ctx.b.user.id, "b"), text(" (B là thành viên)")));
  ok("public mention reaches a non-member", Boolean(await waitFor(async () => (await inbox(c)).some((n) => n.target.messageId === toOutsider.id))));
  ok("member mentioned", Boolean(await waitFor(async () => (await inbox(b)).some((n) => n.target.messageId === toMember.id))));
  r = await a.call("PATCH", `/channels/${y.id}`, { kind: "private" });
  ok("public → private", r.status === 200 && r.body.kind === "private", r.status);
  ok("non-member's entries about it are gone", !(await inbox(c)).some((n) => n.target.channelId === y.id));
  ok("member keeps theirs", (await inbox(b)).some((n) => n.target.channelId === y.id));
  await a.call("DELETE", `/channels/${y.id}`);
  ok("deleting the channel removes every entry about it", !(await inbox(b)).some((n) => n.target.channelId === y.id));

  // --- WK-42: a save that changes nothing posts nothing --------------------------------------------------
  const seqBefore = (await a.call("GET", `/channels/${x.id}`)).body.lastMessageSeq;
  r = await a.call("PATCH", `/channels/${x.id}`, { name: x.name, description: x.description ?? null });
  const seqAfter = (await a.call("GET", `/channels/${x.id}`)).body.lastMessageSeq;
  ok("no-op channel update writes no system message", r.status === 200 && seqAfter === seqBefore, `${seqBefore} → ${seqAfter}`);

  // --- WK-45: deleted messages are not unread ----------------------------------------------------------
  const unread = async () => (await c.call("GET", "/channels")).body.items.find((item) => item.id === x.id)?.unreadCount ?? -1;
  await c.call("POST", `/channels/${x.id}/read`, { seq: 1_000_000 });
  const m1 = await send(b, x.id, doc(text("chưa đọc 1")));
  await send(b, x.id, doc(text("chưa đọc 2")));
  const beforeDelete = await unread();
  await b.call("DELETE", `/messages/${m1.id}`);
  const afterDelete = await unread();
  ok("unread count drops when an unread message is deleted", beforeDelete >= 2 && afterDelete === beforeDelete - 1, `${beforeDelete} → ${afterDelete}`);

  // --- WK-63: one reaction per emoji spelling; reply counts follow deletions --------------------------
  const target = await send(b, x.id, doc(text("thả tim")));
  const heart = String.fromCodePoint(0x2764);
  await a.call("PUT", `/messages/${target.id}/reactions`, { emoji: heart });
  r = await c.call("PUT", `/messages/${target.id}/reactions`, { emoji: `${heart}${String.fromCodePoint(0xfe0f)}` });
  ok("❤ and ❤️ are the same reaction", r.status === 200 && r.body.count === 2, `${r.status} count=${r.body?.count}`);
  const threadRoot = await send(a, x.id, doc(text("đếm trả lời")));
  const r1 = await send(b, x.id, doc(text("r1")), { threadRootId: threadRoot.id });
  await sleep(20);
  const r2 = await send(b, x.id, doc(text("r2")), { threadRootId: threadRoot.id });
  await b.call("DELETE", `/messages/${r2.id}`);
  r = await a.call("GET", `/messages/${threadRoot.id}/thread`);
  const live = r.body.items?.find((item) => item.id === r1.id);
  ok("reply count and last reply follow a deletion", r.body.root?.replyCount === 1 && r.body.root?.lastReplyAt === live?.createdAt, `${r.body.root?.replyCount} ${r.body.root?.lastReplyAt} vs ${live?.createdAt}`);

  // --- WK-46: joining / leaving twice at once is not an error --------------------------------------------
  const z = (await newChannel(a, "public", `e2e-fix-z-${run}`)).body;
  const joins = await Promise.all([c.call("POST", `/channels/${z.id}/join`), c.call("POST", `/channels/${z.id}/join`)]);
  ok("double join → both 200", joins.every((res) => res.status === 200), joins.map((res) => res.status).join(","));
  const leaves = await Promise.all([c.call("POST", `/channels/${z.id}/leave`), c.call("POST", `/channels/${z.id}/leave`)]);
  ok("double leave → both 200", leaves.every((res) => res.status === 200), leaves.map((res) => res.status).join(","));

  // --- SEC-API-03 / BUG-WK-49: the admin switch for chat files is enforced -------------------------------
  r = await a.call("GET", "/chat/settings");
  ok("chat settings readable", r.status === 200 && typeof r.body.attachmentsEnabled === "boolean");
  localSql(`
    INSERT INTO production.settings (organization_id, key, value) VALUES (${quote(ctx.a.organization.id)}, 'chat_attachments_enabled', 'false'::jsonb)
    ON CONFLICT (organization_id, key) DO UPDATE SET value = 'false'::jsonb
  `);
  r = await a.call("POST", `/channels/${x.id}/attachments`, { fileName: "a.txt", mimeType: "text/plain", sizeBytes: 3 });
  ok("upload refused while chat files are off (403)", r.status === 403 && r.body.error.code === "CHAT_ATTACHMENTS_DISABLED", r.status);
  r = await a.call("GET", "/chat/settings");
  ok("settings report attachmentsEnabled=false", r.body.attachmentsEnabled === false);

  // --- System-level membership (for modules such as production job chats) --------------------------------
  const sys = (await newChannel(a, "private", `e2e-fix-sys-${run}`)).body;
  const callHelper = (add, remove) => {
    const code = `const m = await import('./src/modules/chat/channels.service.ts');
      const result = await m.setSystemChannelMembers({ organizationId: ${JSON.stringify(ctx.a.organization.id)}, channelId: ${JSON.stringify(sys.id)},
        add: ${JSON.stringify(add)}, remove: ${JSON.stringify(remove)}, actorId: ${JSON.stringify(ctx.a.user.id)} });
      console.log('RESULT ' + JSON.stringify(result)); process.exit(0);`;
    const out = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { cwd: process.cwd(), encoding: "utf8", timeout: 60_000, env: { ...process.env, LOG_LEVEL: "silent" } });
    return JSON.parse(((out.stdout ?? "").split(/\r?\n/).find((line) => line.startsWith("RESULT ")) ?? "RESULT null").slice(7));
  };
  let result = callHelper([ctx.c.user.id], []);
  r = await c.call("GET", `/channels/${sys.id}`);
  ok("system helper adds a member without channel capabilities", result?.addedIds?.includes(ctx.c.user.id) && r.status === 200 && r.body.isMember === true, JSON.stringify(result));
  r = await c.call("GET", `/channels/${sys.id}/messages`);
  ok("...with the usual system message", r.body.items?.some((message) => message.systemEvent?.type === "members_added"));
  result = callHelper([], [ctx.c.user.id]);
  r = await c.call("GET", `/channels/${sys.id}`);
  ok("system helper removes the member", result?.removedIds?.includes(ctx.c.user.id) && r.status === 404, `${r.status}`);

  // --- BUG-WK-48: archiving tells the user's other tabs (notification:archived) ---------------------------
  const tab = io(apiOrigin, { transports: ["websocket"], extraHeaders: { cookie: b.cookieHeader(), origin: "http://127.0.0.1:5890" }, reconnection: false });
  await new Promise((resolve, reject) => { tab.on("connect", resolve); tab.on("connect_error", reject); });
  const archivedEvent = new Promise((resolve) => { tab.on("notification:archived", resolve); setTimeout(() => resolve(null), 4000); });
  // An entry this suite produced (B was mentioned in X), never someone's real inbox item.
  const someEntry = await waitFor(async () => (await inbox(b)).find((n) => n.target.channelId === x.id));
  if (someEntry) {
    await b.call("POST", "/notifications/archive", { ids: [someEntry.id] });
  }
  const archivedPayload = someEntry ? await archivedEvent : null;
  tab.close();
  ok("archive emits notification:archived with ids and unread count", Boolean(someEntry) && archivedPayload?.ids?.includes(someEntry.id) && typeof archivedPayload.unreadCount === "number", JSON.stringify(archivedPayload));

  // --- PERF-02: an open socket survives the token refresh through session:refresh -----------------------
  socketA = io(apiOrigin, { transports: ["websocket"], extraHeaders: { cookie: a.cookieHeader(), origin: "http://127.0.0.1:5890" }, reconnection: false });
  await new Promise((resolve, reject) => { socketA.on("connect", resolve); socketA.on("connect_error", reject); });
  const refresh = (ticket) => new Promise((resolve) => socketA.emit("session:refresh", { ticket }, resolve));
  await a.call("POST", "/auth/refresh");
  const ticket = await a.call("POST", "/auth/socket-ticket");
  ok("socket ticket issued", ticket.status === 200 && ticket.body.ticket.length > 16 && ticket.body.expiresAt > Date.now() / 1000, ticket.status);
  let ack = await refresh(ticket.body.ticket);
  ok("session:refresh extends the open socket", ack?.ok === true && ack.expiresAt === ticket.body.expiresAt && socketA.connected, JSON.stringify(ack));
  ack = await refresh("x".repeat(40));
  ok("forged ticket refused", ack?.ok === false && socketA.connected, JSON.stringify(ack));
  const otherTicket = (await b.call("POST", "/auth/socket-ticket")).body.ticket;
  ack = await refresh(otherTicket);
  ok("someone else's ticket refused", ack?.ok === false && ack.code === "SESSION_MISMATCH", JSON.stringify(ack));
} finally {
  socketA?.close();
  if (settingRow.length > 0) {
    localSql(`UPDATE production.settings SET value = ${quote(settingRow[0])}::jsonb WHERE organization_id = ${quote(ctx.a.organization.id)} AND key = 'chat_attachments_enabled'`);
  } else {
    localSql(`DELETE FROM production.settings WHERE organization_id = ${quote(ctx.a.organization.id)} AND key = 'chat_attachments_enabled'`);
  }
  await settleOutbox(since);
  purgeChannels(channels);
}
