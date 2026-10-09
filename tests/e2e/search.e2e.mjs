import { cleanupWorkProjects, dbNow } from "./cleanup.mjs";
import { session } from "./lib.mjs";
const ok = (label, cond, extra = "") => console.log(`${cond ? "PASS" : "FAIL"}  ${label} ${extra}`);

const mgr = await session("MANAGER"), a = await session("MEMBER_A"), c = await session("MEMBER_C");
const ctxA = (await a.call("GET", "/workspace/context")).body;
const key = "S" + Math.random().toString(36).slice(2, 6).toUpperCase();
const since = dbNow();
const priv = (await mgr.call("POST", "/projects", { key, name: `E2E search Bí mật dự án ${key}`, visibility: "private" })).body;
try {
  await mgr.call("POST", `/projects/${priv.id}/members`, { userId: ctxA.user.id, accessLevel: "submit" });
  const list = priv.lists[0].id;
  const t = (await mgr.call("POST", `/projects/${priv.id}/tasks`, { listId: list, title: "Tối ưu truy vấn báo cáo doanh thu" })).body;
  const child = (await mgr.call("POST", `/projects/${priv.id}/tasks`, { listId: list, parentTaskId: t.id, title: "Index cho bảng revenue" })).body;

  let r = await a.call("GET", "/search?q=bao%20cao%20doanh");
  ok("member finds private task (accent-insensitive)", r.body.tasks?.some((hit) => hit.id === t.id), `${r.body.tasks?.length} tasks`);
  r = await c.call("GET", "/search?q=bao%20cao%20doanh");
  ok("outsider cannot find private task", !r.body.tasks?.some((hit) => hit.id === t.id));
  r = await c.call("GET", `/search?q=${encodeURIComponent("Bí mật")}`);
  ok("outsider cannot find private project", !r.body.projects?.some((hit) => hit.id === priv.id));
  r = await a.call("GET", `/search?q=${key}-1`);
  ok("search by task key ranks first", r.body.tasks?.[0]?.id === t.id);
  r = await a.call("GET", "/search?q=linh&groups=people");
  ok("people search", r.body.people?.length >= 1, r.body.people?.map((p) => p.displayName).join(","));

  r = await mgr.call("DELETE", `/tasks/${t.id}`);
  r = await a.call("GET", `/trash/tasks?projectId=${priv.id}`);
  const entry = r.body.items?.find((item) => item.id === t.id);
  ok("trash lists deleted root only", Boolean(entry) && !r.body.items.some((item) => item.id === child.id), `subtasks=${entry?.subtaskCount}`);
  ok("member cannot purge (needs manage + task.delete)", entry && entry.canPurge === false);
  r = await c.call("GET", "/trash/tasks");
  ok("outsider sees nothing from private trash", !r.body.items?.some((item) => item.id === t.id));
  r = await a.call("POST", `/trash/tasks/${t.id}/restore`);
  ok("member without task.delete cannot restore (403)", r.status === 403);
  r = await mgr.call("POST", `/trash/tasks/${t.id}/restore`);
  ok("manager restores subtree", r.status === 200);
  r = await mgr.call("GET", `/tasks/${child.id}`);
  ok("subtask restored with parent", r.status === 200);
  await mgr.call("DELETE", `/tasks/${t.id}`);
  r = await mgr.call("DELETE", `/trash/tasks/${t.id}`);
  ok("purge (manager has project manage + task.delete)", r.status === 200);
  r = await mgr.call("POST", `/trash/tasks/${t.id}/restore`);
  ok("purged task is gone", r.status === 404);
} finally {
  await cleanupWorkProjects(mgr, [priv?.id], since);
}
