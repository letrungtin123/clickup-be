// Work module regressions of fix wave 1 (BUG-WK-04/07/08/10/11/13, WK-20/25/27/28/31/35/36/55/61,
// SEC-API-01/06/11/12/14). Self-cleaning: every project is purged at the end.
import { cleanupWorkProjects, dbNow, quote } from "./cleanup.mjs";
import { localSql, session, storageFetch } from "./lib.mjs";
const ok = (label, cond, extra = "") => console.log(`${cond ? "PASS" : "FAIL"}  ${label} ${extra}`);
const doc = (...content) => ({ type: "doc", content: [{ type: "paragraph", content }] });
const text = (value) => ({ type: "text", text: value });
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
const ctxA = (await a.call("GET", "/workspace/context")).body;
const ctxB = (await b.call("GET", "/workspace/context")).body;
const ctxC = (await c.call("GET", "/workspace/context")).body;
const since = dbNow();
const run = Math.random().toString(36).slice(2, 7).toUpperCase();
const created = [];
const newProject = async (suffix, visibility) => {
  const project = (await mgr.call("POST", "/projects", { key: `F${run}${suffix}`.slice(0, 12), name: `E2E fixes ${suffix} ${run}`, visibility })).body;
  created.push(project?.id);
  return project;
};
const newTask = async (project, body) => (await mgr.call("POST", `/projects/${project.id}/tasks`, { listId: project.lists[0].id, ...body })).body;
const activityCount = (taskId) => Number(localSql(`SELECT count(*) FROM public.task_activity_events WHERE task_id = ${quote(taskId)}`)[0]);

try {
  const p = await newProject("A", "private");
  const list1 = p.lists[0].id;
  await mgr.call("POST", `/projects/${p.id}/members`, { userId: ctxA.user.id, accessLevel: "submit" });

  // --- BUG-WK-07: archived lists take their tasks along; restore brings them back --------------------
  const list2 = (await mgr.call("POST", `/projects/${p.id}/lists`, { name: "Sẽ lưu trữ" })).body.id;
  const hidden = (await mgr.call("POST", `/projects/${p.id}/tasks`, { listId: list2, title: `Ẩn theo danh sách ${run}`, assigneeIds: [ctxA.user.id], dueAt: new Date(Date.now() + 3600_000).toISOString() })).body;
  const trashedInList2 = (await mgr.call("POST", `/projects/${p.id}/tasks`, { listId: list2, title: `Thùng rác ${run}` })).body;
  await mgr.call("DELETE", `/tasks/${trashedInList2.id}`);
  let r = await mgr.call("DELETE", `/projects/${p.id}/lists/${list2}`);
  ok("archive list", r.status === 200, r.status);
  r = await mgr.call("GET", `/projects/${p.id}/tasks`);
  ok("project-wide task list hides tasks of archived lists", r.status === 200 && !r.body.items.some((task) => task.id === hidden.id));
  r = await a.call("GET", "/tasks/mine?limit=100");
  ok("My tasks hides tasks of archived lists", r.status === 200 && !r.body.items.some((task) => task.id === hidden.id));
  r = await a.call("GET", `/search?q=${encodeURIComponent(`Ẩn theo danh sách ${run}`)}&groups=tasks`);
  ok("search hides tasks of archived lists", r.status === 200 && !r.body.tasks.some((task) => task.id === hidden.id));
  r = await mgr.call("GET", `/tasks/${hidden.id}`);
  ok("task of an archived list answers 404", r.status === 404, r.status);
  r = await mgr.call("POST", `/trash/tasks/${trashedInList2.id}/restore`);
  ok("trash restore into an archived list explains (409 RESTORE_LIST_UNAVAILABLE)", r.status === 409 && r.body.error.code === "RESTORE_LIST_UNAVAILABLE", r.body?.error?.message);
  r = await mgr.call("GET", `/projects/${p.id}/archived-lists`);
  ok("archived lists are listed", r.status === 200 && r.body.items.some((list) => list.id === list2 && list.archivedAt));
  r = await mgr.call("POST", `/projects/${p.id}/lists/${list2}/restore`);
  ok("restore (unarchive) list", r.status === 200 && r.body.id === list2, r.status);
  r = await mgr.call("GET", `/tasks/${hidden.id}`);
  ok("its tasks are back", r.status === 200);
  r = await mgr.call("POST", `/trash/tasks/${trashedInList2.id}/restore`);
  ok("trash restore works once the list is back", r.status === 200, r.status);

  // --- BUG-WK-08: a repeated status id cannot bypass workflow validation ------------------------------
  const workflow = (await mgr.call("GET", `/projects/${p.id}/workflow?listId=${list1}`)).body.items;
  r = await mgr.call("PUT", `/projects/${p.id}/workflow`, {
    listId: list1,
    statuses: [
      { id: workflow[0].id, name: "Mở", category: "active", color: "slate" },
      { id: workflow[0].id, name: "Xong", category: "done", color: "green" }
    ]
  });
  ok("duplicate status id in a workflow → 400", r.status === 400 && r.body.error.code === "WORKFLOW_DUPLICATE_STATUS", r.body?.error?.code);

  // --- BUG-WK-11: a subtask trashed before its parent changed lists follows the parent on restore ----
  const parent = await newTask(p, { title: "Cha" });
  const child = await newTask(p, { title: "Con", parentTaskId: parent.id });
  await mgr.call("DELETE", `/tasks/${child.id}`);
  r = await mgr.call("POST", `/tasks/${parent.id}/move`, { listId: list2 });
  ok("parent moved to another list", r.status === 200 && r.body.listId === list2);
  r = await mgr.call("POST", `/trash/tasks/${child.id}/restore`);
  ok("restored subtask lands in its parent's list", r.status === 200 && r.body.listId === list2 && r.body.parentTaskId === parent.id, `${r.status} ${r.body?.listId === list2}`);

  // --- WK-27: purging a parent whose child was trashed separately ------------------------------------
  const px = await newTask(p, { title: "Cha WK27" });
  const py = await newTask(p, { title: "Con WK27", parentTaskId: px.id });
  await mgr.call("DELETE", `/tasks/${py.id}`);
  await mgr.call("DELETE", `/tasks/${px.id}`);
  r = await mgr.call("DELETE", `/trash/tasks/${px.id}`);
  ok("purge parent after its child was trashed separately", r.status === 200, `${r.status} ${r.body?.error?.code ?? ""}`);
  r = await mgr.call("GET", `/trash/tasks?projectId=${p.id}`);
  ok("separately trashed child stays restorable as a top-level task", r.body.items?.some((item) => item.id === py.id));
  r = await mgr.call("POST", `/trash/tasks/${py.id}/restore`);
  ok("...and restores", r.status === 200 && r.body.parentTaskId === null, r.status);

  // --- WK-20: re-adding a current assignee does not reopen a Done task --------------------------------
  const doneStatus = workflow.find((status) => status.category !== "active");
  const doneTask = await newTask(p, { title: "Đã xong", assigneeIds: [ctxA.user.id] });
  await mgr.call("PATCH", `/tasks/${doneTask.id}`, { statusId: doneStatus.id });
  r = await mgr.call("PATCH", `/tasks/${doneTask.id}`, { assignees: { add: [ctxA.user.id] } });
  ok("re-adding the same assignee keeps the task done", r.status === 200 && r.body.status.id === doneStatus.id && r.body.completedAt !== null, r.body?.status?.name);

  // --- WK-31: a save that changes nothing logs nothing ------------------------------------------------
  const quiet = await newTask(p, { title: "Không đổi", dueAt: "2026-12-01T00:00:00Z", description: doc(text("Mô tả")) });
  const before = activityCount(quiet.id);
  r = await mgr.call("PATCH", `/tasks/${quiet.id}`, { title: "Không đổi", dueAt: "2026-12-01T00:00:00.000Z", description: doc(text("Mô tả")) });
  ok("no-op save adds no activity", r.status === 200 && activityCount(quiet.id) === before, `${before} → ${activityCount(quiet.id)}`);

  // --- WK-25: concurrent appends never share a rank ----------------------------------------------------
  const burst = await Promise.all(Array.from({ length: 8 }, (_, index) => newTask(p, { title: `Song song ${index}` })));
  ok("concurrent creates get distinct ranks", burst.every(Boolean) && new Set(burst.map((task) => task.rank)).size === burst.length, burst.map((task) => task?.rank).join(","));

  // --- WK-28: files of a comment draft are not task attachments ---------------------------------------
  const filesTask = await newTask(p, { title: "Tệp" });
  const upload = async (target, name) => {
    const ticket = (await mgr.call("POST", `/tasks/${filesTask.id}/attachments`, { fileName: name, mimeType: "text/plain", sizeBytes: 5 })).body;
    await storageFetch(ticket.uploadUrl, { method: "PUT", headers: { "content-type": "text/plain" }, body: "hello" });
    return (await mgr.call("POST", `/attachments/${ticket.attachmentId}/complete`, { target })).body;
  };
  const draftFile = await upload("comment", "draft.txt");
  const taskFile = await upload("task", "task.txt");
  r = await mgr.call("GET", `/tasks/${filesTask.id}`);
  ok("comment-draft file is not a task attachment", r.body.attachments?.length === 1 && r.body.attachments[0].id === taskFile.id && r.body.attachmentCount === 1, `${r.body.attachments?.length}/${r.body.attachmentCount}`);
  r = await mgr.call("POST", `/tasks/${filesTask.id}/comments`, { body: doc(text("kèm tệp")), attachmentIds: [draftFile.id] });
  ok("draft file attaches to its comment", r.status === 201 && r.body.attachments.some((file) => file.id === draftFile.id));
  r = await mgr.call("GET", `/tasks/${filesTask.id}`);
  ok("task attachment count still excludes comment files", r.body.attachmentCount === 1, r.body.attachmentCount);

  // --- SEC-API-01 / SEC-API-14: upload allowlist and safe storage names ------------------------------
  for (const mimeType of ["application/x-msdownload", "application/octet-stream", "text/html"]) {
    r = await mgr.call("POST", `/tasks/${filesTask.id}/attachments`, { fileName: "x.bin", mimeType, sizeBytes: 5 });
    ok(`upload type ${mimeType} refused`, r.status === 400 && r.body.error.code === "ATTACHMENT_TYPE_BLOCKED", r.status);
  }
  const trick = `${String.fromCodePoint(0x301)}..`;
  const rlo = `bao-cao${String.fromCodePoint(0x202e)}fdp.exe.txt`;
  for (const fileName of [trick, rlo]) {
    r = await mgr.call("POST", `/tasks/${filesTask.id}/attachments`, { fileName, mimeType: "text/plain", sizeBytes: 5 });
    const [row] = localSql(`SELECT file_name || '|' || storage_path FROM public.task_attachments WHERE id = ${quote(r.body.attachmentId)}`);
    const [storedName, path] = (row ?? "").split("|");
    ok(`file name ${JSON.stringify(fileName)} stored safely`, r.status === 201 && !/\/\.\.?$/.test(path) && !path.includes("/../") && !/[‪-‮]/.test(storedName), `${JSON.stringify(storedName)} ${path?.split("/").pop()}`);
  }

  // --- SEC-API-06: deleting a comment never removes other people's replies -----------------------------
  const talk = await newTask(p, { title: "Thảo luận" });
  const own = (await a.call("POST", `/tasks/${talk.id}/comments`, { body: doc(text("Của A")) })).body;
  const reply = (await mgr.call("POST", `/tasks/${talk.id}/comments`, { body: doc(text("Trả lời của quản lý")), parentCommentId: own.id })).body;
  r = await a.call("DELETE", `/tasks/${talk.id}/comments/${own.id}`);
  ok("author cannot delete a thread holding others' replies (409)", r.status === 409 && r.body.error.code === "COMMENT_HAS_OTHER_REPLIES", r.status);
  r = await mgr.call("GET", `/tasks/${talk.id}/comments/${own.id}/replies`);
  ok("the other person's reply survived", r.body.items?.some((item) => item.id === reply.id));
  const solo = (await a.call("POST", `/tasks/${talk.id}/comments`, { body: doc(text("Xoá được")) })).body;
  r = await a.call("DELETE", `/tasks/${talk.id}/comments/${solo.id}`);
  ok("author deletes own comment", r.status === 200);
  r = await mgr.call("DELETE", `/tasks/${talk.id}/comments/${own.id}`);
  ok("project manager may delete the whole thread", r.status === 200);

  // --- BUG-WK-05 (comments): inbox excerpts follow edits and disappear with the comment -----------------
  await mgr.call("PATCH", `/tasks/${talk.id}`, { assignees: { add: [ctxA.user.id] } });
  const note = (await mgr.call("POST", `/tasks/${talk.id}/comments`, { body: doc(text("Nội dung cũ")) })).body;
  const commentInbox = async () => (await a.call("GET", "/notifications?limit=100")).body.items.find((n) => n.target.commentId === note.id);
  ok("assignee notified with the comment excerpt", (await waitFor(async () => (await commentInbox())?.body === "Nội dung cũ")) === true);
  await mgr.call("PATCH", `/tasks/${talk.id}/comments/${note.id}`, { body: doc(text("Nội dung đã sửa")) });
  ok("edited comment refreshes the excerpt", (await waitFor(async () => (await commentInbox())?.body === "Nội dung đã sửa")) === true);
  await mgr.call("DELETE", `/tasks/${talk.id}/comments/${note.id}`);
  ok("deleted comment leaves the inbox", (await waitFor(async () => !(await commentInbox()))) === true);

  // --- WK-55: "OTHER-1" never matches task #1 of this project -----------------------------------------
  r = await mgr.call("GET", `/projects/${p.id}/tasks?q=ZZZZ-1`);
  ok("foreign key prefix does not match task #1", r.status === 200 && !r.body.items.some((task) => task.number === 1), r.body.items?.map((task) => task.key).join(","));
  r = await mgr.call("GET", `/projects/${p.id}/tasks?q=${p.key}-1`);
  ok("own key still matches", r.body.items?.some((task) => task.number === 1));

  // --- WK-35: old task keys keep working after a key change; old keys stay reserved --------------------
  const oldKey = p.key;
  const newKey = `G${run}`.slice(0, 12);
  r = await mgr.call("PATCH", `/projects/${p.id}`, { key: newKey });
  ok("project key changed", r.status === 200 && r.body.key === newKey, r.body?.error?.code);
  r = await mgr.call("GET", `/tasks/by-key/${oldKey}-1`);
  ok("old task key still resolves", r.status === 200 && r.body.projectId === p.id, r.status);
  r = await mgr.call("POST", "/projects", { key: oldKey, name: `E2E fixes dup ${run}` });
  created.push(r.body?.id);
  ok("old key cannot be taken by another project", r.status === 409, r.status);
  r = await mgr.call("PATCH", `/projects/${p.id}`, { key: oldKey });
  ok("the project can take its old key back", r.status === 200 && r.body.key === oldKey, r.body?.error?.code);

  // --- WK-36 / WK-61: precise member updates, no empty PATCH -------------------------------------------
  r = await mgr.call("PATCH", `/projects/${p.id}/members/${ctxC.user.id}`, { accessLevel: "view" });
  ok("PATCH a non-member → 404 (not added)", r.status === 404, r.status);
  r = await mgr.call("PATCH", `/projects/${p.id}`, {});
  ok("empty project PATCH → 400", r.status === 400, r.status);
  r = await mgr.call("PATCH", `/projects/${p.id}/lists/${list1}`, {});
  ok("empty list PATCH → 400", r.status === 400, r.status);

  // --- SEC-API-11: by-key is a uniform 404 for people who cannot see the task --------------------------
  const hiddenKey = await c.call("GET", `/tasks/by-key/${oldKey}-1`);
  const missingKey = await c.call("GET", `/tasks/by-key/${oldKey}-99999`);
  ok("by-key: no access and nonexistent look the same", hiddenKey.status === 404 && missingKey.status === 404 && hiddenKey.body.error.code === missingKey.body.error.code);

  // --- BUG-WK-10: a project keeps a manager that can actually manage -----------------------------------
  const q = await newProject("B", "private");
  await mgr.call("POST", `/projects/${q.id}/members`, { userId: ctxA.user.id, accessLevel: "manage" });
  const me = (await mgr.call("GET", "/workspace/context")).body.user.id;
  r = await mgr.call("PATCH", `/projects/${q.id}/members/${me}`, { accessLevel: "submit" });
  ok("last usable manager cannot step down (the other 'manager' lacks project.manage_members)", r.status === 409 && r.body.error.code === "PROJECT_MANAGER_REQUIRED", r.status);

  // --- BUG-WK-13 / BUG-WK-04: losing access to a private project ends assignments and inbox entries ---
  const assigned = await newTask(p, { title: `Giao cho A ${run}`, assigneeIds: [ctxA.user.id] });
  const notifiedA = await waitFor(async () => (await a.call("GET", "/notifications?limit=50")).body.items.some((n) => n.target.taskId === assigned.id));
  ok("A was notified about the assignment", Boolean(notifiedA));
  r = await mgr.call("DELETE", `/projects/${p.id}/members/${ctxA.user.id}`);
  ok("remove A from the private project", r.status === 200);
  r = await mgr.call("GET", `/tasks/${assigned.id}`);
  ok("A is no longer an assignee", r.status === 200 && !r.body.assignees.some((user) => user.id === ctxA.user.id));
  r = await mgr.call("GET", `/tasks/${assigned.id}/timeline?limit=50`);
  ok("unassignment is in the timeline", r.body.items?.some((item) => item.activity?.action === "TASK_ASSIGNEE_REMOVED" && item.activity.previousValue?.reason === "project_access_revoked"));
  r = await a.call("GET", "/notifications?limit=100");
  ok("A's inbox no longer shows the project", !r.body.items.some((n) => n.target.projectId === p.id));

  const pub = await newProject("C", "public");
  const pubTask = await newTask(pub, { title: `Công khai ${run}`, assigneeIds: [ctxB.user.id] });
  ok("B notified on the public project", Boolean(await waitFor(async () => (await b.call("GET", "/notifications?limit=50")).body.items.some((n) => n.target.taskId === pubTask.id))));
  r = await mgr.call("PATCH", `/projects/${pub.id}`, { visibility: "private" });
  ok("public → private", r.status === 200 && r.body.visibility === "private");
  r = await mgr.call("GET", `/tasks/${pubTask.id}`);
  ok("non-member assignee removed when the project turned private", !r.body.assignees.some((user) => user.id === ctxB.user.id));
  r = await b.call("GET", "/notifications?limit=100");
  ok("non-member lost the project's inbox entries", !r.body.items.some((n) => n.target.projectId === pub.id));
  // Defense in depth: an entry that slipped through is not shown either (BUG-WK-04).
  localSql(`
    INSERT INTO public.notifications (organization_id, recipient_user_id, type, title, project_id, task_id, dedupe_key)
    VALUES (${quote(ctxB.organization.id)}, ${quote(ctxB.user.id)}, 'task.assigned', 'leak', ${quote(pub.id)}, ${quote(pubTask.id)}, 'e2e-fixes:${run}')
  `);
  r = await b.call("GET", "/notifications?limit=100");
  ok("inbox filters entries about projects the recipient cannot see", !r.body.items.some((n) => n.target.projectId === pub.id));

  // --- SEC-API-12 / WK-29: archived projects are out of the trash --------------------------------------
  const arch = await newProject("D", "private");
  const archTask = await newTask(arch, { title: "Trong dự án lưu trữ" });
  await mgr.call("DELETE", `/tasks/${archTask.id}`);
  localSql(`UPDATE public.projects SET archived_at = now() WHERE id = ${quote(arch.id)}`);
  r = await mgr.call("GET", "/trash/tasks?limit=100");
  ok("trash excludes archived projects", r.status === 200 && !r.body.items.some((item) => item.projectId === arch.id));
  r = await mgr.call("GET", "/projects/archived");
  ok("archived project list needs project.delete (manager lacks it → 403)", r.status === 403, r.status);
} finally {
  localSql(`DELETE FROM public.notifications WHERE dedupe_key LIKE ${quote(`e2e-fixes:${run}%`)}`);
  await cleanupWorkProjects(mgr, created, since);
}
