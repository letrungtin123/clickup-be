import { randomUUID } from "node:crypto";
import { dbNow, purgeChannels, settleOutbox } from "./cleanup.mjs";
import { session } from "./lib.mjs";
const ok = (label, cond, extra = "") => console.log(`${cond ? "PASS" : "FAIL"}  ${label} ${extra}`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const doc = (...content) => ({ type: "doc", content: [{ type: "paragraph", content }] });

const a = await session("MEMBER_A"), b = await session("MEMBER_B"), c = await session("MEMBER_C");
const ctxA = (await a.call("GET", "/workspace/context")).body;
const ctxC = (await c.call("GET", "/workspace/context")).body;
await a.call("POST", "/notifications/read", { all: true });
await c.call("POST", "/notifications/read", { all: true });

const since = dbNow();
let channelId = null;
try {
  let r = await a.call("POST", "/channels", { kind: "public", name: `e2e-thread-test-${Date.now()}` });
  ok("create public channel", r.status === 201, r.body?.error?.code ?? "");
  channelId = r.body.id ?? r.body.channel?.id;
  await b.call("POST", `/channels/${channelId}/join`);
  await c.call("POST", `/channels/${channelId}/join`);

  r = await a.call("POST", `/channels/${channelId}/messages`, { body: doc({ type: "text", text: "Root message" }), clientMessageId: randomUUID() });
  const rootId = r.body.id ?? r.body.message?.id;
  ok("root posted", Boolean(rootId), r.body?.error?.code ?? "");
  r = await b.call("POST", `/channels/${channelId}/messages`, { body: doc({ type: "text", text: "Reply in thread" }), clientMessageId: randomUUID(), threadRootId: rootId });
  const replyId = r.body.id ?? r.body.message?.id;
  ok("thread reply posted", Boolean(replyId), r.body?.error?.code ?? "");
  r = await b.call("PATCH", `/messages/${replyId}`, { body: doc({ type: "text", text: "Reply edited " }, { type: "mention", attrs: { id: ctxC.user.id, label: "Khoa" } }) });
  ok("edit adds mention", r.status === 200, r.body?.error?.code ?? "");
  await wait(4000);

  r = await a.call("GET", "/notifications?limit=20");
  ok("root author gets thread reply notification", r.body.items.some((n) => n.type === "chat.thread_replied" && n.target.channelId === channelId));
  ok("thread author not notified of own reply", !(await b.call("GET", "/notifications?limit=20")).body.items.some((n) => n.type === "chat.thread_replied" && n.target.channelId === channelId));
  r = await c.call("GET", "/notifications?limit=20");
  ok("newly mentioned via edit gets mention", r.body.items.some((n) => n.type === "chat.mentioned" && n.target.channelId === channelId));
  r = await a.call("GET", `/directory/users?channelId=${channelId}&q=`);
  ok("directory scoped to channel works", r.status === 200, `${r.body.items?.length} people`);
  void ctxA;
} finally {
  // The API delete is a soft delete (and drops the members' notifications); then remove the rows for real.
  if (channelId) {
    await a.call("DELETE", `/channels/${channelId}`);
  }
  await settleOutbox(since);
  purgeChannels([channelId]);
}
