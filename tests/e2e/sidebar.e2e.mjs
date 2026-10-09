import { createRequire } from "node:module";
import { cleanupWorkProjects, dbNow } from "./cleanup.mjs";
import { apiOrigin, session } from "./lib.mjs";
const require = createRequire(process.cwd() + "/package.json");
const { io } = require("socket.io-client");
const ok = (label, cond, extra = "") => console.log(`${cond ? "PASS" : "FAIL"}  ${label} ${extra}`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const mgr = await session("MANAGER"), a = await session("MEMBER_A");
const ctxA = (await a.call("GET", "/workspace/context")).body;
const socket = io(apiOrigin, { transports: ["websocket"], extraHeaders: { cookie: a.cookieHeader(), origin: "http://127.0.0.1:5890" }, reconnection: false });
const hints = [];
socket.on("workspace:sidebar", (event) => hints.push(event));
await new Promise((resolve, reject) => { socket.on("connect", resolve); socket.on("connect_error", reject); });

const key = () => "H" + Math.random().toString(36).slice(2, 6).toUpperCase();
const since = dbNow();
const created = [];
const create = async (visibility, label) => {
  const k = key();
  const project = (await mgr.call("POST", "/projects", { key: k, name: `E2E sidebar ${label} ${k}`, visibility })).body;
  created.push(project?.id);
  return project;
};
try {
  const pub = await create("public", "public");
  const priv = await create("private", "private");
  ok("project has capabilities", typeof pub.capabilities?.canCreateTask === "boolean", JSON.stringify(pub.capabilities));
  await wait(800);
  ok("member hinted about public project", hints.some((h) => h.projectId === pub.id));
  ok("member NOT hinted about private project", !hints.some((h) => h.projectId === priv.id));
  await mgr.call("POST", `/projects/${priv.id}/members`, { userId: ctxA.user.id, accessLevel: "submit" });
  await wait(800);
  ok("member hinted when added to private project", hints.some((h) => h.projectId === priv.id && h.kind === "members"));
  ok("hint carries no names", hints.every((h) => !("name" in h)));
  socket.close();
  await mgr.call("PATCH", `/projects/${pub.id}`, { name: `${pub.name} (done)` });
} finally {
  socket.close();
  await cleanupWorkProjects(mgr, created, since);
}
