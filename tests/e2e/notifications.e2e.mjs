import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { cleanupWorkProjects, dbNow, quote } from "./cleanup.mjs";
import { apiOrigin, localSql, session } from "./lib.mjs";
const require = createRequire(process.cwd() + "/package.json");
const { io } = require("socket.io-client");
const ok = (label, cond, extra = "") => console.log(`${cond ? "PASS" : "FAIL"}  ${label} ${extra}`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const para = (...content) => ({ type: "doc", content: [{ type: "paragraph", content }] });

const mgr = await session("MANAGER"), a = await session("MEMBER_A");
const ctxA = (await a.call("GET", "/workspace/context")).body;
await a.call("POST", "/notifications/read", { all: true });

// Member A listens for live notifications
const socket = io(apiOrigin, { transports: ["websocket"], extraHeaders: { cookie: a.cookieHeader(), origin: "http://127.0.0.1:5890" }, reconnection: false });
const live = [];
socket.on("notification:new", (event) => live.push(event));
await new Promise((resolve, reject) => { socket.on("connect", resolve); socket.on("connect_error", reject); });

const key = "N" + Math.random().toString(36).slice(2, 6).toUpperCase();
const since = dbNow();
const proj = (await mgr.call("POST", "/projects", { key, name: `E2E notifications ${key}`, visibility: "public" })).body;
try {
  const listId = proj.lists[0].id;
  const task = (await mgr.call("POST", `/projects/${proj.id}/tasks`, { listId, title: "Viết tài liệu API", assigneeIds: [ctxA.user.id], dueAt: new Date(Date.now() + 3 * 3600 * 1000).toISOString() })).body;
  await mgr.call("POST", `/tasks/${task.id}/comments`, { body: para({ type: "mention", attrs: { id: ctxA.user.id, label: "Minh" } }, { type: "text", text: " xem giúp nhé" }) });
  await mgr.call("PATCH", `/tasks/${task.id}`, { statusId: (await mgr.call("GET", `/projects/${proj.id}/workflow?listId=${listId}`)).body.items[1].id });
  await wait(4000);

  let r = await a.call("GET", "/notifications?limit=20");
  const types = r.body.items.filter((n) => n.target.taskId === task.id).map((n) => n.type);
  ok("assigned notification", types.includes("task.assigned"), types.join(","));
  ok("mention notification", types.includes("task.mentioned"));
  ok("no duplicate comment notif for mentioned user", !types.includes("task.commented"));
  ok("status change notification", types.includes("task.status_changed"));
  ok("unread count", r.body.unreadCount >= 3, `${r.body.unreadCount}`);
  ok("live push via socket", live.length >= 3, `${live.length} events`);
  ok("task key in target", r.body.items[0]?.target.taskKey?.startsWith(key));
  const managerInbox = await mgr.call("GET", "/notifications?limit=50");
  ok("actor not self-notified", !managerInbox.body.items.some((n) => n.target.taskId === task.id), "");

  const first = r.body.items[0].id;
  r = await a.call("POST", "/notifications/read", { ids: [first] });
  ok("mark one read", r.status === 200);
  r = await a.call("GET", "/notifications?filter=unread");
  ok("unread filter excludes read", !r.body.items.some((n) => n.id === first));
  r = await a.call("POST", "/notifications/read", { all: true });
  ok("mark all read", r.body.unreadCount === 0);

  // Deadline reminders (PERF-04): the set-based scan run twice in a separate process — exactly one reminder.
  const scan = spawnSync(process.execPath, [
    "--import", "tsx", "--input-type=module", "-e",
    "const m = await import('./src/modules/notifications/deadline-scheduler.ts'); const first = await m.runDeadlineScan(); const second = await m.runDeadlineScan(); console.log('SCAN ' + JSON.stringify({ first, second })); process.exit(0);"
  ], { cwd: process.cwd(), encoding: "utf8", timeout: 60_000, env: { ...process.env, LOG_LEVEL: "silent" } });
  const scanLine = (scan.stdout ?? "").split(/\r?\n/).find((line) => line.startsWith("SCAN ")) ?? "";
  ok("deadline scan runs (set-based)", scan.status === 0 && scanLine.length > 0, scanLine || (scan.stderr ?? "").split(/\r?\n/).slice(-3).join(" "));
  const reminders = localSql(`
    SELECT count(*) FROM public.notifications
    WHERE recipient_user_id = ${quote(ctxA.user.id)} AND task_id = ${quote(task.id)} AND type = 'task.due_soon'
  `)[0];
  ok("exactly one due-soon reminder after repeated scans", reminders === "1", reminders);
  r = await a.call("GET", "/notifications?limit=50");
  ok("reminder reaches the inbox", r.body.items.some((n) => n.type === "task.due_soon" && n.target.taskId === task.id && n.payload.taskKey?.startsWith(key)));
} finally {
  socket.close();
  await cleanupWorkProjects(mgr, [proj?.id], since);
}
