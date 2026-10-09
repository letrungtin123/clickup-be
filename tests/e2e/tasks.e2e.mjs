import { session, storageFetch } from "./lib.mjs";
const ok = (label, cond, extra = "") => console.log(`${cond ? "PASS" : "FAIL"}  ${label} ${extra}`);
const para = (...content) => ({ type: "doc", content: [{ type: "paragraph", content }] });
const text = (value, marks) => (marks ? { type: "text", text: value, marks } : { type: "text", text: value });
const mention = (id, label) => ({ type: "mention", attrs: { id, label } });

const mgr = await session("MANAGER"), a = await session("MEMBER_A"), b = await session("MEMBER_B");
const ctxA = (await a.call("GET", "/workspace/context")).body;
const ctxB = (await b.call("GET", "/workspace/context")).body;
const key = "K" + Math.random().toString(36).slice(2, 6).toUpperCase();
const proj = (await mgr.call("POST", "/projects", { key, name: "Task smoke", visibility: "private" })).body;
const list1 = proj.lists[0].id;
const list2 = (await mgr.call("POST", `/projects/${proj.id}/lists`, { name: "Backlog" })).body.id;
await mgr.call("POST", `/projects/${proj.id}/members`, { userId: ctxA.user.id, accessLevel: "submit" });

let r = await mgr.call("GET", `/projects/${proj.id}/workflow?listId=${list1}`);
ok("workflow inherits global", r.status === 200 && r.body.scope === "global" && r.body.items.length === 4, JSON.stringify(r.body.items?.map((s) => s.name)));
const [todo, , , done] = r.body.items;

r = await mgr.call("POST", `/projects/${proj.id}/tasks`, {
  listId: list1,
  title: "Thiết kế màn hình đăng nhập",
  priority: "high",
  assigneeIds: [ctxA.user.id],
  description: para(text("Hi "), mention(ctxA.user.id, "Minh"), text("<script>alert(1)</script>", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]))
});
ok("create task", r.status === 201 && r.body.key === `${key}-1` && r.body.assignees.length === 1, r.body.key ?? JSON.stringify(r.body));
const t1 = r.body;
const t2 = (await mgr.call("POST", `/projects/${proj.id}/tasks`, { listId: list1, title: "API login", placement: { beforeId: t1.id } })).body;
ok("placement before", t2.rank < t1.rank, `${t2.rank} < ${t1.rank}`);
const sub = (await a.call("POST", `/projects/${proj.id}/tasks`, { listId: list1, parentTaskId: t1.id, title: "Subtask A" })).body;
ok("member creates subtask", sub?.parentTaskId === t1.id, sub?.key ?? JSON.stringify(sub));

r = await a.call("GET", `/tasks/${t1.id}`);
ok("detail", r.status === 200 && r.body.subtasks.length === 1 && r.body.capabilities.canEdit, `js-link-stripped=${!JSON.stringify(r.body.description).includes("javascript")}`);
r = await b.call("GET", `/tasks/${t1.id}`);
ok("non-member gets 404 on private task", r.status === 404);
r = await b.call("GET", `/projects/${proj.id}/tasks`);
ok("non-member list 404", r.status === 404);

r = await mgr.call("GET", `/projects/${proj.id}/tasks?listId=${list1}&parent=root&sort=rank&limit=1`);
ok("page 1", r.body.items.length === 1 && r.body.pageInfo.hasMore, r.body.items[0]?.title);
r = await mgr.call("GET", `/projects/${proj.id}/tasks?listId=${list1}&parent=root&sort=rank&limit=1&cursor=${r.body.pageInfo.nextCursor}`);
ok("page 2 via cursor", r.body.items.length === 1 && r.body.items[0].id === t1.id);
r = await mgr.call("GET", `/projects/${proj.id}/tasks?q=dang%20nhap`);
ok("unaccent search", r.body.items.some((t) => t.id === t1.id), `${r.body.items.length} hits`);
r = await mgr.call("GET", `/projects/${proj.id}/tasks?q=${key}-2`);
ok("search by key", r.body.items.length === 1 && r.body.items[0].id === t2.id);
r = await mgr.call("GET", `/projects/${proj.id}/tasks?assigneeIds=${ctxA.user.id}&priorities=high`);
ok("filter assignee+priority", r.body.items.length === 1);
r = await mgr.call("GET", `/projects/${proj.id}/tasks?sort=priority&order=desc`);
ok("sort priority", r.body.items[0].priority === "high");

r = await mgr.call("PATCH", `/tasks/${t1.id}`, { statusId: done.id });
ok("complete", r.body.completedAt !== null && r.body.status.id === done.id);
r = await mgr.call("PATCH", `/tasks/${t1.id}`, { assignees: { add: [ctxB.user.id] } });
ok("assign non-member to private (409)", r.status === 409, r.body?.error?.code);
await mgr.call("POST", `/projects/${proj.id}/members`, { userId: ctxB.user.id, accessLevel: "view" });
r = await mgr.call("PATCH", `/tasks/${t1.id}`, { assignees: { add: [ctxB.user.id] } });
ok("reassign done task reopens", r.status === 200 && r.body.status.id === todo.id && r.body.completedAt === null, r.body.status?.name);
r = await b.call("PATCH", `/tasks/${t1.id}`, { title: "hack" });
ok("view-only member cannot edit (403)", r.status === 403);
r = await mgr.call("PATCH", `/tasks/${t1.id}`, { startAt: "2026-10-20T00:00:00Z", dueAt: "2026-10-10T00:00:00Z" });
ok("due before start rejected", r.status === 400, r.body?.error?.code);

r = await mgr.call("POST", `/tasks/${t1.id}/move`, { listId: list2 });
ok("move with subtree to list2", r.status === 200 && r.body.listId === list2, JSON.stringify(r.body?.error ?? ""));
r = await mgr.call("GET", `/tasks/${sub.id}`);
ok("subtask moved along", r.body.listId === list2);
r = await mgr.call("POST", `/tasks/${t2.id}/move`, { parentTaskId: sub.id });
ok("cross-list parent rejected", r.status === 409, r.body?.error?.code);
r = await mgr.call("POST", `/tasks/${t1.id}/move`, { parentTaskId: sub.id });
ok("cycle rejected", r.status === 409, r.body?.error?.code);

r = await mgr.call("POST", `/tasks/${t1.id}/comments`, { body: para(mention(ctxA.user.id, "Minh"), text(" xong chưa?")) });
ok("comment with mention", r.status === 201 && r.body.mentionedUserIds.includes(ctxA.user.id));
const c1 = r.body;
r = await a.call("POST", `/tasks/${t1.id}/comments`, { parentCommentId: c1.id, body: para(text("Sắp xong")) });
ok("reply", r.status === 201);
r = await a.call("PATCH", `/tasks/${t1.id}/comments/${c1.id}`, { body: para(text("x")) });
ok("non-author edit forbidden", r.status === 403);
r = await mgr.call("GET", `/tasks/${t1.id}/timeline?limit=8`);
ok(
  "timeline merged",
  r.status === 200 && r.body.items.some((i) => i.kind === "comment") && r.body.items.some((i) => i.kind === "activity"),
  r.body.items?.map((i) => (i.kind === "comment" ? "comment" : i.activity.action)).join(",")
);
r = await mgr.call("GET", `/tasks/${t1.id}/comments/${c1.id}/replies`);
ok("replies", r.body.items.length === 1);

r = await mgr.call("PUT", `/projects/${proj.id}/workflow`, {
  listId: list2,
  statuses: [
    { name: "Backlog", category: "active", color: "slate" },
    { name: "Doing", category: "active", color: "blue" },
    { name: "Shipped", category: "done", color: "green" }
  ],
  remap: []
});
ok("list workflow override", r.status === 200 && r.body.scope === "list" && r.body.items.length === 3, JSON.stringify(r.body.error ?? r.body.items.map((s) => s.key)));
r = await mgr.call("GET", `/tasks/${t1.id}`);
ok("tasks remapped to new initial", r.body.status.name === "Backlog", r.body.status.name);
r = await mgr.call("PUT", `/projects/${proj.id}/workflow`, { listId: list2, inherit: true });
ok("revert to inherited", r.body.scope === "global");
r = await mgr.call("GET", `/tasks/${t1.id}`);
ok("tasks back on inherited statuses", r.body.status.name === "To do", r.body.status.name);

r = await mgr.call("POST", `/tasks/${t1.id}/attachments`, { fileName: "spec v1 (final).txt", mimeType: "text/plain", sizeBytes: 11 });
ok("upload ticket", r.status === 201, r.body?.error?.code ?? "");
if (r.status === 201) {
  const put = await storageFetch(r.body.uploadUrl, { method: "PUT", headers: { "content-type": "text/plain" }, body: "hello world" });
  ok("direct PUT to storage", put.ok, `${put.status} ${put.ok ? "" : await put.text()}`);
  const completed = await mgr.call("POST", `/attachments/${r.body.attachmentId}/complete`, { target: "task" });
  ok("complete upload", completed.status === 200 && completed.body.sizeBytes === 11, JSON.stringify(completed.body?.error ?? ""));
  const urls = await mgr.call("POST", `/attachments/urls`, { ids: [r.body.attachmentId] });
  const dl = urls.body.items?.[0] ? await storageFetch(urls.body.items[0].url) : null;
  ok("signed download", Boolean(dl?.ok) && (await dl.text()) === "hello world", dl?.headers.get("content-disposition") ?? "");
  const viewer = await b.call("POST", `/attachments/urls`, { ids: [r.body.attachmentId] });
  ok("view member can download", viewer.body.items?.length === 1);
  const outsider = await (await session("MEMBER_C")).call("POST", `/attachments/urls`, { ids: [r.body.attachmentId] });
  ok("outsider gets no url", outsider.body.items?.length === 0);
  const canDeleteFor = async (who) =>
    (await who.call("GET", `/tasks/${t1.id}`)).body.attachments?.find((item) => item.id === r.body.attachmentId)?.canDelete;
  ok("canDelete: uploader/manager yes, viewer no", (await canDeleteFor(mgr)) === true && (await canDeleteFor(b)) === false);
}
r = await mgr.call("GET", `/tasks/${t1.id}/timeline?limit=50`);
const assigned = r.body.items?.find((item) => item.kind === "activity" && item.activity.action === "TASK_ASSIGNEE_ADDED" && item.activity.newValue?.userId === ctxA.user.id);
ok("assignee activity names the user", assigned?.activity.newValue?.userId === ctxA.user.id && typeof assigned.activity.newValue.user?.displayName === "string", JSON.stringify(assigned?.activity.newValue ?? r.body.items?.map((item) => item.activity?.action ?? item.kind)));
r = await a.call("GET", "/notifications?types=task.assigned");
ok("notifications filtered by type", r.status === 200 && r.body.items.every((item) => item.type === "task.assigned"), `${r.body.items?.length}`);
r = await a.call("GET", "/notifications?types=nope.nope");
ok("unknown notification type rejected (400)", r.status === 400);
r = await mgr.call("POST", `/tasks/${t1.id}/attachments`, { fileName: "x.html", mimeType: "text/html", sizeBytes: 10 });
ok("html blocked", r.status === 400);
r = await a.call("GET", `/directory/users?projectId=${proj.id}&q=an`);
ok("directory scoped", r.status === 200, r.body.items?.map((u) => u.displayName).join(","));
r = await mgr.call("GET", `/tasks/by-key/${key}-1`);
ok("lookup by key", r.body.id === t1.id);
r = await mgr.call("DELETE", `/tasks/${t1.id}`);
ok("delete subtree", r.status === 200);
r = await mgr.call("GET", `/tasks/${sub.id}`);
ok("subtask deleted too", r.status === 404);
await mgr.call("DELETE", `/projects/${proj.id}`);
