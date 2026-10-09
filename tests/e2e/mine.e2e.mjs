// My Tasks: tasks assigned to me across projects, keyset pages, overdue filter. Self-contained fixtures.
import { cleanupWorkProjects, dbNow } from "./cleanup.mjs";
import { session } from "./lib.mjs";
const ok = (label, cond, extra = "") => console.log(`${cond ? "PASS" : "FAIL"}  ${label} ${extra}`);

const mgr = await session("MANAGER");
const me = (await mgr.call("GET", "/workspace/context")).body.user.id;
const key = "M" + Math.random().toString(36).slice(2, 6).toUpperCase();
const since = dbNow();
const project = (await mgr.call("POST", "/projects", { key, name: `My tasks e2e ${key}`, visibility: "private" })).body;
const listId = project.lists[0].id;
const day = 86_400_000;
try {
  // 7 tasks assigned to me (3 overdue, 4 upcoming) + 1 not assigned to me.
  for (let index = 0; index < 7; index += 1) {
    const dueAt = new Date(Date.now() + (index < 3 ? -(index + 1) : index) * day).toISOString();
    await mgr.call("POST", `/projects/${project.id}/tasks`, { listId, title: `Mine ${index}`, assigneeIds: [me], dueAt, priority: index % 2 ? "high" : "normal" });
  }
  await mgr.call("POST", `/projects/${project.id}/tasks`, { listId, title: "Not mine" });

  let r = await mgr.call("GET", "/tasks/mine?limit=5");
  const mine = (r.body.items ?? []).filter((task) => task.projectId === project.id);
  ok("my tasks page 1 (soonest due first)", r.status === 200 && r.body.items.length === 5 && mine.every((task) => task.assignees.some((user) => user.id === me)), `${r.body.items?.[0]?.key}`);
  const t0 = performance.now();
  r = await mgr.call("GET", `/tasks/mine?limit=50&cursor=${r.body.pageInfo.nextCursor}`);
  const all = (r.body.items ?? []).filter((task) => task.projectId === project.id);
  ok("page 2 continues the keyset", r.status === 200 && all.length >= 2 && !all.some((task) => task.title === "Not mine"), `${(performance.now() - t0).toFixed(0)}ms`);
  r = await mgr.call("GET", "/tasks/mine?due=overdue&limit=50&sort=priority");
  const overdue = (r.body.items ?? []).filter((task) => task.projectId === project.id);
  ok("overdue filter by priority", r.status === 200 && overdue.length === 3, `${overdue.length} items`);
} finally {
  await mgr.call("DELETE", `/projects/${project.id}`);
  // The seeded MANAGER lacks project.delete (the archive above is a 403): remove the fixture for real.
  await cleanupWorkProjects(mgr, [project?.id], since);
}
