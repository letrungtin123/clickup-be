// Live smoke test for the chat backend. Run with cwd = D:\Clickup-System\BE.
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { apiOrigin, session } from "./lib.mjs";

const require = createRequire("D:/Clickup-System/BE/package.json");
const { io } = require("socket.io-client");

let passed = 0;
const failures = [];
const check = (label, condition, detail) => {
  if (condition) {
    passed += 1;
    console.log(`PASS ${label}`);
  } else {
    failures.push(label);
    console.log(`FAIL ${label}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 400));
  }
};
const doc = (text, mentions = []) => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text }, ...mentions.flatMap((id) => [{ type: "text", text: " " }, { type: "mention", attrs: { id, label: "x" } }])]
    }
  ]
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const M = await session("MANAGER");
const A = await session("MEMBER_A");
const B = await session("MEMBER_B");
const C = await session("MEMBER_C");
const idOf = async (s) => (await s.call("GET", "/workspace/context")).body.user.id;
const [mId, aId, bId, cId] = await Promise.all([idOf(M), idOf(A), idOf(B), idOf(C)]);

const run = Date.now().toString(36);
const send = (s, channelId, text, extra = {}) =>
  s.call("POST", `/channels/${channelId}/messages`, { body: doc(text, extra.mentions ?? []), clientMessageId: extra.clientMessageId ?? randomUUID(), ...(extra.threadRootId ? { threadRootId: extra.threadRootId } : {}), ...(extra.attachmentIds ? { attachmentIds: extra.attachmentIds } : {}) });

// --- Channels ---------------------------------------------------------------------------------
let r = await M.call("POST", "/channels", { kind: "public", name: `smoke-pub-${run}`, description: "public smoke", memberIds: [aId] });
check("create public channel 201", r.status === 201 && r.body.myRole === "admin" && r.body.memberCount === 2, r);
const P = r.body;
r = await M.call("POST", "/channels", { kind: "private", name: `smoke-priv-${run}`, memberIds: [aId] });
check("create private channel 201", r.status === 201 && r.body.kind === "private", r);
const X = r.body;
r = await A.call("POST", "/channels", { kind: "public", name: `SMOKE-PUB-${run.toUpperCase()}` });
check("duplicate name (case-insensitive) 409", r.status === 409 && r.body.error.code === "CHANNEL_NAME_TAKEN", r);

r = await B.call("GET", "/channels");
check("non-member sidebar excludes both", r.status === 200 && !r.body.items.some((c) => c.id === P.id || c.id === X.id), r.status);
r = await B.call("GET", `/channels/browse?q=smoke-p&limit=100`);
check("browse lists public, hides private", r.status === 200 && r.body.items.some((c) => c.id === P.id) && !r.body.items.some((c) => c.id === X.id), r.body?.items?.length);
r = await B.call("GET", `/channels/${X.id}`);
check("private channel 404 for non-member", r.status === 404 && r.body.error.code === "CHANNEL_NOT_FOUND", r);
r = await B.call("GET", `/channels/${X.id}/messages`);
check("private messages 404 for non-member", r.status === 404, r.status);
r = await B.call("POST", `/channels/${X.id}/join`);
check("join private 404 for non-member", r.status === 404, r.status);
r = await B.call("GET", `/channels/${X.id}/members`);
check("private members 404 for non-member", r.status === 404, r.status);
r = await B.call("GET", `/channels/${P.id}/messages`);
check("public preview readable by non-member", r.status === 200 && r.body.lastReadSeq === null, r);
r = await send(B, P.id, "not joined yet");
check("post before join 403", r.status === 403 && r.body.error.code === "CHANNEL_MEMBERSHIP_REQUIRED", r);
r = await B.call("POST", `/channels/${P.id}/join`);
check("join public channel", r.status === 200 && r.body.myAccess === "submit" && r.body.isMember === true && r.body.unreadCount === 0, r);
r = await B.call("POST", `/channels/${P.id}/join`);
check("join is idempotent", r.status === 200 && r.body.isMember, r.status);

// View-only member
r = await M.call("POST", `/channels/${X.id}/members`, { userIds: [cId], access: "view" });
check("add view-only member", r.status === 200 && r.body.items.length === 1 && r.body.items[0].access === "view", r);
r = await M.call("POST", `/channels/${X.id}/members`, { userIds: [cId] });
check("re-adding existing member is a no-op", r.status === 200 && r.body.items.length === 0, r);
r = await send(C, X.id, "can I post?");
check("view-only cannot post 403", r.status === 403 && r.body.error.code === "CHANNEL_SUBMIT_REQUIRED", r);
r = await C.call("GET", `/channels/${X.id}/messages`);
check("view-only can read", r.status === 200, r.status);
r = await A.call("POST", `/channels/${X.id}/members`, { userIds: [bId] });
check("plain member cannot add members 403", r.status === 403, r);
r = await M.call("POST", `/channels/${X.id}/members`, { userIds: ["00000000-0000-4000-8000-0000000000aa"] });
check("adding non-org user 400", r.status === 400 && r.body.error.code === "CHAT_MEMBER_INVALID", r);

// --- DMs --------------------------------------------------------------------------------------
r = await A.call("POST", "/dms", { userIds: [bId] });
const dmStatus = r.status;
check("open DM 201/200", (r.status === 201 || r.status === 200) && r.body.kind === "dm" && r.body.participants.length === 1 && r.body.participants[0].id === bId, r);
const DM = r.body;
r = await A.call("POST", "/dms", { userIds: [bId] });
check("DM get-or-create idempotent (200, same id)", r.status === 200 && r.body.id === DM.id, { s: r.status, first: dmStatus });
r = await B.call("POST", "/dms", { userIds: [aId, bId] });
check("DM same set from other side returns same id", r.status === 200 && r.body.id === DM.id, r.status);
r = await A.call("POST", "/dms", { userIds: [cId, bId] });
check("group DM", (r.status === 201 || r.status === 200) && r.body.kind === "group_dm" && r.body.participants.length === 2, r);
const G = r.body;
r = await A.call("POST", "/dms", { userIds: [aId] });
check("self-only DM 400", r.status === 400, r.status);
r = await send(A, DM.id, `secret-dm-${run}`);
check("send DM", r.status === 201, r);
r = await M.call("GET", `/channels/${DM.id}`);
check("non-participant (manager) cannot see DM", r.status === 404, r.status);
r = await M.call("GET", `/channels/${DM.id}/messages`);
check("non-participant cannot read DM", r.status === 404, r.status);
r = await M.call("POST", `/channels/${DM.id}/members`, { userIds: [mId] });
check("non-participant cannot add self to DM", r.status === 404, r.status);
r = await A.call("POST", `/channels/${DM.id}/members`, { userIds: [cId] });
check("DM membership immutable 409", r.status === 409 && r.body.error.code === "CHAT_DM_IMMUTABLE", r);
r = await A.call("PATCH", `/channels/${DM.id}`, { name: "x" });
check("DM cannot be renamed", r.status === 409, r.status);

// --- Messages, idempotency, reactions, threads --------------------------------------------------
const clientId = randomUUID();
r = await send(A, P.id, `hello team ${run}`, { clientMessageId: clientId, mentions: [bId] });
check("send message 201 with seq + mention", r.status === 201 && r.body.seq >= 1 && r.body.mentions.includes(bId) && r.body.author.id === aId, r);
const m1 = r.body;
r = await send(A, P.id, "retry", { clientMessageId: clientId });
check("idempotent retry 200 same message", r.status === 200 && r.body.id === m1.id, r);
r = await send(A, X.id, "retry elsewhere", { clientMessageId: clientId });
check("clientMessageId reuse in other channel 409", r.status === 409 && r.body.error.code === "CHAT_CLIENT_ID_CONFLICT", r);
r = await A.call("POST", `/channels/${P.id}/messages`, { body: { type: "doc", content: [] }, clientMessageId: randomUUID() });
check("empty message 400", r.status === 400 && r.body.error.code === "CHAT_MESSAGE_EMPTY", r);
r = await A.call("POST", `/channels/${P.id}/messages`, { body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "<img src=x onerror=alert(1)>" , marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }, { type: "script" }] }, clientMessageId: randomUUID() });
check("rich text sanitized (no js link, unknown nodes dropped)", r.status === 201 && JSON.stringify(r.body.body).indexOf("javascript") === -1 && !JSON.stringify(r.body.body).includes("script\"}"), r.body?.body);

r = await B.call("PUT", `/messages/${m1.id}/reactions`, { emoji: "👍" });
check("react", r.status === 200 && r.body.count === 1 && r.body.reactedByMe, r);
r = await A.call("PUT", `/messages/${m1.id}/reactions`, { emoji: "👍" });
check("second reactor count 2", r.status === 200 && r.body.count === 2, r);
r = await B.call("PUT", `/messages/${m1.id}/reactions`, { emoji: "👍" });
check("re-react idempotent", r.status === 200 && r.body.count === 2, r);
r = await B.call("DELETE", `/messages/${m1.id}/reactions?emoji=${encodeURIComponent("👍")}`);
check("unreact", r.status === 200 && r.body.count === 1 && !r.body.reactedByMe, r);
r = await B.call("PUT", `/messages/${m1.id}/reactions`, { emoji: "lol" });
check("invalid emoji 400", r.status === 400, r.status);
r = await C.call("PUT", `/messages/${m1.id}/reactions`, { emoji: "🎉" });
check("non-member cannot react 403", r.status === 403, r.status);

r = await send(B, P.id, "thread reply", { threadRootId: m1.id });
check("thread reply", r.status === 201 && r.body.threadRootId === m1.id && r.body.seq === null, r);
const reply = r.body;
r = await send(B, P.id, "nested?", { threadRootId: reply.id });
check("no nested threads 404", r.status === 404 && r.body.error.code === "CHAT_THREAD_NOT_FOUND", r);
r = await A.call("GET", `/messages/${m1.id}/thread`);
check("thread page", r.status === 200 && r.body.root.replyCount === 1 && r.body.items.length === 1 && r.body.items[0].id === reply.id, r);
r = await A.call("GET", `/messages/${reply.id}/thread`);
check("thread resolves from reply id", r.status === 200 && r.body.root.id === m1.id, r.status);
r = await A.call("GET", `/channels/${P.id}/messages?limit=100`);
const hist = r.body;
check("history excludes replies, root has replyCount + reactions", r.status === 200 && !hist.items.some((m) => m.id === reply.id) && hist.items.find((m) => m.id === m1.id)?.replyCount === 1 && hist.items.find((m) => m.id === m1.id)?.reactions[0]?.count === 1, r.body?.items?.length);
check("history ascending by seq", hist.items.every((m, i, arr) => i === 0 || arr[i - 1].seq < m.seq), hist.items.map((m) => m.seq));
r = await A.call("GET", `/channels/${P.id}/messages?around=${reply.id}&limit=3`);
check("around a reply centers on its root", r.status === 200 && r.body.items.some((m) => m.id === m1.id), r.body);
r = await A.call("GET", `/channels/${P.id}/messages?before=2&after=1`);
check("ambiguous history query 400", r.status === 400, r.status);

r = await A.call("PATCH", `/messages/${m1.id}`, { body: doc("hello team (edited)") });
check("author edits", r.status === 200 && r.body.isEdited && r.body.text.includes("edited") && r.body.mentions.length === 0, r);
r = await B.call("PATCH", `/messages/${m1.id}`, { body: doc("hijack") });
check("non-author cannot edit 403", r.status === 403, r.status);
r = await B.call("DELETE", `/messages/${m1.id}`);
check("plain member cannot delete others' message 403", r.status === 403, r.status);
r = await M.call("DELETE", `/messages/${reply.id}`);
check("channel admin deletes others' reply", r.status === 200, r);
r = await A.call("GET", `/messages/${m1.id}/thread`);
check("reply tombstone + root replyCount 0", r.body.root.replyCount === 0 && r.body.items[0]?.isDeleted === true && r.body.items[0]?.body === null, r.body);
r = await A.call("DELETE", `/messages/${m1.id}`);
check("author deletes own message", r.status === 200, r.status);
r = await A.call("GET", `/channels/${P.id}/messages?around=${m1.id}&limit=3`);
const tomb = r.body.items.find((m) => m.id === m1.id);
check("deleted message tombstone (no body/reactions)", tomb?.isDeleted === true && tomb.body === null && tomb.text === "" && tomb.reactions.length === 0, tomb);
r = await A.call("PUT", `/messages/${m1.id}/reactions`, { emoji: "👍" });
check("cannot react to deleted message 409", r.status === 409, r.status);

// --- Mentions ----------------------------------------------------------------------------------
r = await send(A, X.id, "ping outsider", { mentions: [bId] });
check("private channel: mention non-member 400", r.status === 400 && r.body.error.code === "CHAT_MENTION_INVALID", r);
r = await send(A, P.id, "ping non-joined org member", { mentions: [cId] });
check("public channel: mention any org member 201", r.status === 201 && r.body.mentions.includes(cId), r);
r = await send(A, DM.id, "ping C in DM", { mentions: [cId] });
check("DM: mention non-participant 400", r.status === 400, r.status);

// --- Unread + read state -------------------------------------------------------------------------
r = await C.call("GET", "/channels");
const before = r.body.items.find((c) => c.id === X.id);
await send(A, X.id, "unread 1");
await send(A, X.id, "unread 2", { mentions: [cId] });
const last = await send(A, X.id, "unread 3");
r = await C.call("GET", "/channels");
const xc = r.body.items.find((c) => c.id === X.id);
check("unread count grows by 3 and mention counted", xc && xc.unreadCount === (before?.unreadCount ?? 0) + 3 && xc.mentionCount === 1 && xc.lastMessageSeq === last.body.seq, { before, xc });
r = await A.call("GET", "/channels");
check("author's own messages are not unread", r.body.items.find((c) => c.id === X.id)?.unreadCount === 0, r.body.items.find((c) => c.id === X.id));
r = await C.call("POST", `/channels/${X.id}/read`, { seq: last.body.seq });
check("mark read clears unread + mentions", r.status === 200 && r.body.unreadCount === 0 && r.body.mentionCount === 0 && r.body.lastReadSeq === last.body.seq, r);
r = await C.call("POST", `/channels/${X.id}/read`, { seq: 1 });
check("mark read never moves backwards", r.status === 200 && r.body.lastReadSeq === last.body.seq, r);
r = await C.call("POST", `/channels/${X.id}/read`, { seq: 999999 });
check("mark read clamps to last seq", r.status === 200 && r.body.lastReadSeq === last.body.seq, r);
r = await C.call("GET", "/chat/mentions");
check("mentions-of-me feed", r.status === 200 && r.body.items.some((h) => h.channelId === X.id), r.body?.items?.length);

// --- Search isolation --------------------------------------------------------------------------
const token = `zebra${run}`;
await send(A, X.id, `private ${token} words`);
await send(A, DM.id, `dm ${token} words`);
await send(A, P.id, `public ${token} words`);
const hits = async (s) => (await s.call("GET", `/chat/search?q=${token}`)).body.items.map((h) => h.channelId);
const [ha, hb, hc, hm] = await Promise.all([hits(A), hits(B), hits(C), hits(M)]);
check("search: author sees all 3", ha.includes(X.id) && ha.includes(DM.id) && ha.includes(P.id), ha);
check("search: B sees public (joined) + DM, not private", hb.includes(P.id) && hb.includes(DM.id) && !hb.includes(X.id), hb);
check("search: C sees private only (not DM, not unjoined public)", hc.includes(X.id) && !hc.includes(DM.id) && !hc.includes(P.id), hc);
check("search: manager sees private + public, never the DM", hm.includes(X.id) && hm.includes(P.id) && !hm.includes(DM.id), hm);
r = await B.call("GET", `/chat/search?q=${token}&channelId=${X.id}`);
check("search scoped to foreign channel returns nothing", r.status === 200 && r.body.items.length === 0, r.body);
r = await B.call("GET", `/search?q=${token}&groups=messages`);
check("global search messages group is membership-filtered", r.status === 200 && !r.body.messages.some((h) => h.channelId === X.id) && r.body.messages.some((h) => h.channelId === P.id), r.body);

// --- Channel admin flows -----------------------------------------------------------------------
r = await A.call("PATCH", `/channels/${P.id}`, { topic: "new topic" });
check("plain member cannot update channel 403", r.status === 403, r.status);
r = await M.call("PATCH", `/channels/${P.id}`, { topic: "Sprint planning", name: `smoke-pub2-${run}` });
check("admin renames + sets topic", r.status === 200 && r.body.topic === "Sprint planning" && r.body.name === `smoke-pub2-${run}`, r);
r = await M.call("POST", `/channels/${P.id}/archive`);
check("archive", r.status === 200 && r.body.archivedAt !== null && r.body.capabilities.canPost === false, r);
r = await send(A, P.id, "after archive");
check("archived channel is read-only 409", r.status === 409 && r.body.error.code === "CHANNEL_ARCHIVED", r);
r = await M.call("POST", `/channels/${P.id}/unarchive`);
check("unarchive", r.status === 200 && r.body.archivedAt === null, r.status);
r = await M.call("POST", `/channels/${P.id}/leave`);
check("last admin cannot leave while others remain 409", r.status === 409 && r.body.error.code === "CHANNEL_ADMIN_REQUIRED", r);
r = await M.call("PATCH", `/channels/${P.id}/members/${aId}`, { role: "admin" });
check("promote member to admin", r.status === 200 && r.body.role === "admin", r);
r = await M.call("PATCH", `/channels/${P.id}/members/${aId}`, { access: "view" });
check("admin requires submit 400", r.status === 400, r.status);
r = await M.call("POST", `/channels/${P.id}/leave`);
check("admin leaves after handover", r.status === 200, r);
r = await A.call("PATCH", `/channels/${P.id}/me`, { notifyLevel: "mentions" });
check("notify level", r.status === 200 && r.body.notifyLevel === "mentions", r);
r = await A.call("GET", `/channels/${P.id}/members?limit=1`);
check("members paginated", r.status === 200 && r.body.items.length === 1 && r.body.pageInfo.hasMore === true && r.body.pageInfo.nextCursor, r.body);
const page2 = await A.call("GET", `/channels/${P.id}/members?limit=1&cursor=${r.body.pageInfo.nextCursor}`);
check("members page 2 differs", page2.status === 200 && page2.body.items[0]?.user.id !== r.body.items[0]?.user.id, page2.body);
r = await A.call("PATCH", `/channels/${P.id}`, { kind: "private" });
check("channel admin converts public -> private", r.status === 200 && r.body.kind === "private", r.status);
r = await C.call("GET", `/channels/${P.id}/messages`);
check("converted channel hidden from non-members", r.status === 404, r.status);

// --- Realtime ----------------------------------------------------------------------------------
const connect = (s) =>
  new Promise((resolve, reject) => {
    const socket = io(apiOrigin, { path: "/socket.io", transports: ["websocket"], extraHeaders: { cookie: s.cookieHeader() }, reconnection: false });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
  });
const join = (socket, room) => new Promise((resolve) => socket.emit("room:join", room, resolve));
const waitFor = (socket, event, predicate, ms = 4000) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => { socket.off(event, handler); resolve(null); }, ms);
    const handler = (payload) => { if (predicate(payload)) { clearTimeout(timer); socket.off(event, handler); resolve(payload); } };
    socket.on(event, handler);
  });

let pending;
const [sa, sb, sc] = await Promise.all([connect(A), connect(B), connect(C)]);
let ack = await join(sa, { type: "channel", id: X.id });
check("member joins private channel room", ack.ok === true, ack);
ack = await join(sb, { type: "channel", id: X.id });
check("non-member room:join rejected", ack.ok === false && ack.code === "NOT_FOUND", ack);
ack = await join(sb, { type: "channel", id: DM.id });
check("DM participant joins DM room", ack.ok === true, ack);
pending = null;
pending = waitFor(sb, "chat:typing", () => true, 1200);
sa.emit("chat:typing", { channelId: DM.id, threadRootId: null });
check("typing ignored from socket outside the room", (await pending) === null);
ack = await join(sa, { type: "channel", id: DM.id });
check("author joins DM room", ack.ok === true, ack);
const smId = await new Promise((resolve) => setTimeout(resolve, 2600)); // typing throttle window
void smId;
ack = await join(sc, { type: "channel", id: X.id });
check("view-only member joins room", ack.ok === true, ack);

pending = waitFor(sb, "chat:message", (e) => e.channelId === DM.id && e.message.text === `rt-${run}`);
await send(A, DM.id, `rt-${run}`);
let evt = await pending;
check("realtime chat:message delivered to room member", evt !== null && evt.message.author.id === aId, evt);

pending = waitFor(sb, "chat:message", (e) => e.channelId === X.id, 1500);
const pendingC = waitFor(sc, "chat:message", (e) => e.channelId === X.id && e.message.text === `rt-x-${run}`);
await send(A, X.id, `rt-x-${run}`);
check("rejected socket gets no private messages", (await pending) === null);
check("view-only member receives messages", (await pendingC) !== null);

const rtMsg = (await send(A, DM.id, `react-me-${run}`)).body;
pending = waitFor(sa, "chat:reaction", (e) => e.messageId === rtMsg.id);
await B.call("PUT", `/messages/${rtMsg.id}/reactions`, { emoji: "🔥" });
evt = await pending;
check("realtime chat:reaction", evt?.count === 1 && evt.userId === bId && evt.added === true, evt);

pending = waitFor(sa, "chat:message", (e) => e.message.threadRootId === rtMsg.id);
await send(B, DM.id, "rt reply", { threadRootId: rtMsg.id });
evt = await pending;
check("realtime thread reply carries root replyCount", evt?.threadRoot?.id === rtMsg.id && evt.threadRoot.replyCount === 1, evt);

pending = waitFor(sa, "chat:message:updated", (e) => e.messageId === rtMsg.id);
await A.call("PATCH", `/messages/${rtMsg.id}`, { body: doc("edited live") });
evt = await pending;
check("realtime chat:message:updated", evt?.text === "edited live", evt);

pending = waitFor(sb, "chat:message:deleted", (e) => e.messageId === rtMsg.id);
await A.call("DELETE", `/messages/${rtMsg.id}`);
check("realtime chat:message:deleted", (await pending) !== null);

pending = waitFor(sb, "chat:read", (e) => e.channelId === DM.id);
const dmState = (await B.call("GET", "/channels")).body.items.find((c) => c.id === DM.id);
await B.call("POST", `/channels/${DM.id}/read`, { seq: dmState.lastMessageSeq });
evt = await pending;
check("realtime chat:read to own user room", evt?.unreadCount === 0, { evt, dmState });

pending = waitFor(sc, "chat:channel", (e) => e.channelId === G.id && e.kind === "joined", 2000);
// group DM was created before sockets connected; create a fresh group DM to observe the joined event
const others = [bId, cId, mId];
pending = waitFor(sc, "chat:channel", (e) => e.kind === "joined" && e.userIds.includes(cId) && e.userIds.length === 4);
r = await A.call("POST", "/dms", { userIds: others });
evt = await pending;
check("realtime chat:channel joined to new participants", (r.status === 201 && evt !== null && evt.channel?.myRole === undefined) || r.status === 200, { status: r.status, evt });

pending = waitFor(sc, "access:revoked", (e) => e.room.id === X.id);
const pendingLeft = waitFor(sc, "chat:channel", (e) => e.kind === "left" && e.channelId === X.id);
r = await M.call("DELETE", `/channels/${X.id}/members/${cId}`);
check("remove member", r.status === 200, r);
check("removed member gets chat:channel left", (await pendingLeft) !== null);
check("removed member evicted (access:revoked)", (await pending) !== null);
pending = waitFor(sc, "chat:message", (e) => e.channelId === X.id, 1500);
await send(A, X.id, "after removal");
check("evicted socket no longer receives messages", (await pending) === null);

pending = waitFor(sb, "chat:typing", (e) => e.channelId === DM.id);
sa.emit("chat:typing", { channelId: DM.id, threadRootId: null });
evt = await pending;
check("typing relay within DM", evt?.userId === aId, evt);

sa.close(); sb.close(); sc.close();

// --- Attachments -------------------------------------------------------------------------------
r = await A.call("POST", `/channels/${X.id}/attachments`, { fileName: "evil.html", mimeType: "text/html", sizeBytes: 10 });
check("blocked mime type 400", r.status === 400 && r.body.error.code === "CHAT_ATTACHMENT_TYPE_BLOCKED", r);
r = await C.call("POST", `/channels/${X.id}/attachments`, { fileName: "a.txt", mimeType: "text/plain", sizeBytes: 10 });
check("non-member cannot upload", r.status === 404, r.status);
r = await A.call("POST", `/channels/${X.id}/attachments`, { fileName: "Báo cáo Q3.txt", mimeType: "text/plain", sizeBytes: 11 });
if (r.status === 201) {
  const ticket = r.body;
  check("upload ticket", typeof ticket.uploadUrl === "string" && ticket.attachmentId, ticket);
  let c2 = await A.call("POST", `/chat-attachments/${ticket.attachmentId}/complete`);
  check("complete before upload 409", c2.status === 409, c2);
  const put = await fetch(ticket.uploadUrl, { method: "PUT", headers: { "content-type": "text/plain" }, body: "hello world" });
  check("browser PUT to signed URL", put.ok, put.status);
  c2 = await B.call("POST", `/chat-attachments/${ticket.attachmentId}/complete`);
  check("only uploader completes", c2.status === 404, c2.status);
  c2 = await A.call("POST", `/chat-attachments/${ticket.attachmentId}/complete`);
  check("complete upload", c2.status === 200 && c2.body.sizeBytes === 11 && c2.body.isImage === false, c2);
  r = await send(A, X.id, "", { attachmentIds: [ticket.attachmentId] });
  check("send attachment-only message", r.status === 201 && r.body.attachments.length === 1 && r.body.attachments[0].fileName === "Báo cáo Q3.txt", r);
  const withFile = r.body;
  r = await send(A, X.id, "reuse", { attachmentIds: [ticket.attachmentId] });
  check("attachment cannot be reused 400", r.status === 400 && r.body.error.code === "CHAT_ATTACHMENT_INVALID", r);
  r = await M.call("POST", "/chat-attachments/urls", { ids: [ticket.attachmentId] });
  check("member gets signed URL (forced download)", r.status === 200 && r.body.items.length === 1 && r.body.items[0].url.includes("download="), r);
  r = await B.call("POST", "/chat-attachments/urls", { ids: [ticket.attachmentId] });
  check("non-member gets no URL", r.status === 200 && r.body.items.length === 0, r);
  r = await C.call("POST", "/chat-attachments/urls", { ids: [ticket.attachmentId] });
  check("removed member gets no URL", r.status === 200 && r.body.items.length === 0, r);
  await A.call("DELETE", `/messages/${withFile.id}`);
  r = await M.call("POST", "/chat-attachments/urls", { ids: [ticket.attachmentId] });
  check("deleted message's file no longer served", r.status === 200 && r.body.items.length === 0, r);
} else {
  check("upload ticket (storage)", false, r);
}

// --- Rate limit (last: it burns B's quota) -------------------------------------------------------
let limited = null;
for (let i = 0; i < 22 && !limited; i += 1) {
  const res = await send(B, DM.id, `burst ${i}`);
  if (res.status === 429) limited = res;
}
check("send rate limit 429 CHAT_RATE_LIMITED", limited?.body?.error?.code === "CHAT_RATE_LIMITED", limited);

// --- Delete channel ----------------------------------------------------------------------------
r = await B.call("DELETE", `/channels/${X.id}`);
check("non-member cannot delete private channel (404)", r.status === 404, r.status);
r = await M.call("DELETE", `/channels/${X.id}`);
check("admin soft-deletes channel", r.status === 200, r);
r = await A.call("GET", `/channels/${X.id}`);
check("deleted channel 404", r.status === 404, r.status);
r = await M.call("POST", "/channels", { kind: "private", name: `smoke-priv-${run}` });
check("deleted channel frees its name", r.status === 201, r);
if (r.status === 201) await M.call("DELETE", `/channels/${r.body.id}`);
await A.call("DELETE", `/channels/${P.id}`);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) console.log("Failures:", failures);
process.exit(failures.length ? 1 : 0);
