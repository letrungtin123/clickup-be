// Keyset paging regressions (BUG-WK-01, BUG-WK-12, WK-57), bad input → 400 (SEC-API-08), and the
// List/Board group index (PERF-05). Rows that share a millisecond (or differ by microseconds) are paged with
// limit=1: every row must come back exactly once and no page may fail. Self-cleaning.
import { randomUUID } from "node:crypto";
import { cleanupWorkProjects, dbNow, purgeChannels, quote, settleOutbox } from "./cleanup.mjs";
import { localSql, session } from "./lib.mjs";
const ok = (label, cond, extra = "") => console.log(`${cond ? "PASS" : "FAIL"}  ${label} ${extra}`);
const doc = (...content) => ({ type: "doc", content: [{ type: "paragraph", content }] });
const text = (value) => ({ type: "text", text: value });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Follows nextCursor with limit=1 until the end; returns ids in order plus any failed page status. */
const pageAll = async (s, path, pick = (body) => body.items.map((item) => item.id), max = 400) => {
  const ids = [];
  let cursor = null;
  for (let page = 0; page < max; page += 1) {
    const sep = path.includes("?") ? "&" : "?";
    const r = await s.call("GET", `${path}${sep}limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (r.status !== 200) {
      return { ids, error: `${r.status} ${r.body?.error?.code ?? ""}` };
    }
    ids.push(...pick(r.body));
    cursor = r.body.pageInfo?.nextCursor ?? null;
    if (!cursor) {
      return { ids, error: null };
    }
  }
  return { ids, error: "too many pages" };
};
const exactlyOnce = (ids, expected) => {
  const seen = ids.filter((id) => expected.includes(id));
  return seen.length === expected.length && new Set(seen).size === expected.length;
};

const mgr = await session("MANAGER"), a = await session("MEMBER_A"), b = await session("MEMBER_B");
const me = (await mgr.call("GET", "/workspace/context")).body.user.id;
const ctxA = (await a.call("GET", "/workspace/context")).body;
const ctxB = (await b.call("GET", "/workspace/context")).body;
const since = dbNow();
const run = Math.random().toString(36).slice(2, 8);
const key = "P" + run.slice(0, 4).toUpperCase();
const project = (await mgr.call("POST", "/projects", { key, name: `E2E paging ${key}`, visibility: "private" })).body;
let channelId = null;
const sameMs = "2026-10-09 10:00:00.123456+00";
try {
  const listId = project.lists[0].id;
  // --- Task sorts (BUG-WK-01) ------------------------------------------------------------------------
  const specs = [
    { title: "Same title", dueAt: "2026-11-01T00:00:00Z", priority: "high" },
    { title: "Same title", dueAt: "2026-11-01T00:00:00Z", priority: "high" },
    { title: "Alpha", dueAt: "2026-10-20T00:00:00Z", priority: "low" },
    { title: "Beta", priority: "urgent" },
    { title: "Gamma", priority: "normal" },
    { title: "Delta", priority: "normal" }
  ];
  const tasks = [];
  for (const spec of specs) {
    tasks.push((await mgr.call("POST", `/projects/${project.id}/tasks`, { listId, assigneeIds: [me], ...spec })).body);
  }
  const taskIds = tasks.map((task) => task.id);
  // Same instant for most rows, microsecond steps for two (JS Dates cannot tell them apart).
  localSql(`
    BEGIN;
    SET LOCAL session_replication_role = replica;
    UPDATE public.tasks SET created_at = ${quote(sameMs)}, updated_at = ${quote(sameMs)}
    WHERE id IN (${taskIds.slice(0, 4).map(quote).join(",")});
    UPDATE public.tasks SET created_at = '2026-10-09 10:00:00.123457+00', updated_at = '2026-10-09 10:00:00.123457+00' WHERE id = ${quote(taskIds[4])};
    UPDATE public.tasks SET created_at = '2026-10-09 10:00:00.123458+00', updated_at = '2026-10-09 10:00:00.123458+00' WHERE id = ${quote(taskIds[5])};
    COMMIT;
  `);
  for (const sort of ["rank", "dueAt", "priority", "createdAt", "updatedAt", "title", "number"]) {
    for (const order of ["asc", "desc"]) {
      const { ids, error } = await pageAll(mgr, `/projects/${project.id}/tasks?listId=${listId}&sort=${sort}&order=${order}`);
      ok(`task list sort=${sort} ${order}: every task once`, !error && exactlyOnce(ids, taskIds) && ids.length === taskIds.length, error ?? `${ids.length}`);
    }
  }
  for (const sort of ["dueAt", "updatedAt", "priority"]) {
    const { ids, error } = await pageAll(mgr, `/tasks/mine?sort=${sort}&includeDone=true`, undefined, 2000);
    ok(`my tasks sort=${sort}: every task once`, !error && exactlyOnce(ids, taskIds), error ?? "");
  }
  let r = await mgr.call("GET", `/projects/${project.id}/tasks?cursor=garbage`);
  ok("bad task cursor → 400 INVALID_CURSOR", r.status === 400 && r.body.error.code === "INVALID_CURSOR", r.status);
  const dueCursor = (await mgr.call("GET", `/projects/${project.id}/tasks?sort=dueAt&limit=1`)).body.pageInfo.nextCursor;
  r = await mgr.call("GET", `/projects/${project.id}/tasks?sort=rank&cursor=${encodeURIComponent(dueCursor)}`);
  ok("cursor of another sort → 400", r.status === 400 && r.body.error.code === "INVALID_CURSOR", r.status);
  r = await mgr.call("GET", `/tasks/mine?cursor=garbage`);
  ok("bad my-tasks cursor → 400", r.status === 400, r.status);

  // --- Task timeline (BUG-WK-12) --------------------------------------------------------------------
  const target = tasks[0];
  for (let index = 0; index < 3; index += 1) {
    await mgr.call("POST", `/tasks/${target.id}/comments`, { body: doc(text(`Bình luận ${index}`)) });
  }
  localSql(`
    INSERT INTO public.task_activity_events (organization_id, task_id, actor_user_id, action, target_type, target_id, created_at)
    SELECT t.organization_id, t.id, ${quote(me)}, 'TASK_PRIORITY_CHANGED', 'task', t.id,
      ${quote(sameMs)}::timestamptz + (g % 3) * interval '1 microsecond'
    FROM public.tasks t, generate_series(1, 6) g WHERE t.id = ${quote(target.id)};
    UPDATE public.task_comments SET created_at = ${quote(sameMs)} WHERE task_id = ${quote(target.id)};
  `);
  const timelineIds = localSql(`
    SELECT id FROM public.task_comments WHERE task_id = ${quote(target.id)} AND parent_comment_id IS NULL AND deleted_at IS NULL
    UNION ALL
    SELECT id FROM public.task_activity_events WHERE task_id = ${quote(target.id)} AND action NOT LIKE 'COMMENT_%'
  `);
  const timeline = await pageAll(mgr, `/tasks/${target.id}/timeline`, (body) => body.items.map((item) => item.comment?.id ?? item.activity?.id));
  ok("timeline limit=1: every comment/activity exactly once", !timeline.error && exactlyOnce(timeline.ids, timelineIds) && timeline.ids.length === timelineIds.length, `${timeline.ids.length}/${timelineIds.length}`);
  r = await mgr.call("GET", `/tasks/${target.id}/timeline?cursor=garbage`);
  ok("bad timeline cursor → 400", r.status === 400, r.status);

  // --- Trash (BUG-WK-12, WK-57) ---------------------------------------------------------------------
  const trashed = tasks.slice(2, 6).map((task) => task.id);
  for (const id of trashed) {
    await mgr.call("DELETE", `/tasks/${id}`);
  }
  localSql(`UPDATE public.tasks SET deleted_at = ${quote(sameMs)} WHERE id IN (${trashed.map(quote).join(",")})`);
  const trash = await pageAll(mgr, `/trash/tasks?projectId=${project.id}`);
  ok("trash limit=1: every deleted task exactly once", !trash.error && exactlyOnce(trash.ids, trashed), trash.error ?? `${trash.ids.length}`);
  r = await mgr.call("GET", "/trash/tasks?cursor=garbage");
  ok("bad trash cursor → 400 (not the first page, WK-57)", r.status === 400 && r.body.error.code === "INVALID_CURSOR", r.status);

  // --- Notifications (BUG-WK-12) --------------------------------------------------------------------
  // Far-future timestamps so these are the newest entries of A's inbox; µs steps between some.
  const notificationIds = localSql(`
    INSERT INTO public.notifications (organization_id, recipient_user_id, type, title, dedupe_key, created_at)
    SELECT ${quote(ctxA.organization.id)}, ${quote(ctxA.user.id)}, 'task.assigned', 'E2E paging', 'e2e-paging:${run}:' || g,
      '2099-01-01 00:00:00.123456+00'::timestamptz + (g % 3) * interval '1 microsecond'
    FROM generate_series(1, 7) g
    RETURNING id
  `).filter((row) => /^[0-9a-f-]{36}$/.test(row));
  const inbox = await pageAll(a, "/notifications?filter=all", undefined, 9);
  ok("inbox limit=1: every notification exactly once", exactlyOnce(inbox.ids, notificationIds), `${inbox.ids.filter((id) => notificationIds.includes(id)).length}/7 ${inbox.error ?? ""}`);
  r = await a.call("GET", "/notifications?cursor=garbage");
  ok("bad inbox cursor → 400", r.status === 400, r.status);
  localSql(`DELETE FROM public.notifications WHERE dedupe_key LIKE ${quote(`e2e-paging:${run}:%`)}`);

  // --- Chat thread, search, mentions (BUG-WK-12) -----------------------------------------------------
  r = await a.call("POST", "/channels", { kind: "public", name: `e2e-paging-${run}` });
  channelId = r.body.id;
  await b.call("POST", `/channels/${channelId}/join`);
  const token = `zq${run}`;
  const root = (await a.call("POST", `/channels/${channelId}/messages`, { body: doc(text(`root ${token}`)), clientMessageId: randomUUID() })).body;
  const replies = [];
  for (let index = 0; index < 5; index += 1) {
    const sender = index % 2 ? a : b;
    const body = doc(text(`reply ${index} ${token} `), { type: "mention", attrs: { id: ctxB.user.id, label: "B" } });
    replies.push((await sender.call("POST", `/channels/${channelId}/messages`, { body, clientMessageId: randomUUID(), threadRootId: root.id })).body.id);
  }
  const replyIds = replies.filter(Boolean);
  localSql(`
    UPDATE public.messages SET created_at = ${quote(sameMs)}::timestamptz + ((ascii(right(id::text, 1)) % 2) * interval '1 microsecond')
    WHERE id IN (${replyIds.map(quote).join(",")});
    UPDATE public.message_mentions SET created_at = '2099-01-01 00:00:00.123456+00'
    WHERE message_id IN (${replyIds.map(quote).join(",")});
  `);
  const thread = await pageAll(a, `/messages/${root.id}/thread`);
  ok("thread limit=1: every reply exactly once", replyIds.length === 5 && !thread.error && exactlyOnce(thread.ids, replyIds) && thread.ids.length === 5, `${thread.ids.length} ${thread.error ?? ""}`);
  const search = await pageAll(a, `/chat/search?q=${token}`, (body) => body.items.map((item) => item.messageId));
  ok("chat search limit=1: every hit exactly once", !search.error && exactlyOnce(search.ids, replyIds), `${search.ids.length} ${search.error ?? ""}`);
  const mentionedByA = localSql(`SELECT message_id FROM public.message_mentions WHERE message_id IN (${replyIds.map(quote).join(",")}) AND user_id = ${quote(ctxB.user.id)}`);
  const mentions = await pageAll(b, "/chat/mentions", (body) => body.items.map((item) => item.messageId), mentionedByA.length + 1);
  ok("mentions limit=1: every mention exactly once", mentionedByA.length >= 2 && exactlyOnce(mentions.ids, mentionedByA), `${mentions.ids.length}/${mentionedByA.length}`);
  r = await a.call("GET", `/messages/${root.id}/thread?cursor=garbage`);
  ok("bad thread cursor → 400", r.status === 400, r.status);

  // --- Bad input never 500 (SEC-API-08) -------------------------------------------------------------
  const nul = String.fromCharCode(0);
  r = await mgr.call("POST", `/projects/${project.id}/tasks`, { listId, title: `a${nul}b` });
  ok("NUL in a title → 400", r.status === 400, r.status);
  r = await mgr.call("POST", `/projects/${project.id}/tasks`, { listId, title: "Year zero", dueAt: "0000-01-01T00:00:00Z" });
  ok("year 0000 → 400", r.status === 400, r.status);
  r = await mgr.call("POST", `/projects/${project.id}/tasks`, { listId, title: "Year 99", dueAt: "0099-05-01T00:00:00Z" });
  ok("year 0099 → 400 (WK-23)", r.status === 400, r.status);
  r = await mgr.call("GET", `/projects/${project.id}/tasks?q=${encodeURIComponent(`x${nul}`)}`);
  ok("NUL in a search → 400", r.status === 400, r.status);
  r = await mgr.call("GET", `/search?q=${encodeURIComponent(`ab${nul}`)}`);
  ok("NUL in global search → 400", r.status === 400, r.status);
  r = await mgr.call("POST", `/tasks/${target.id}/comments`, { body: doc(text(`hi${nul} there`)) });
  ok("NUL inside a comment is dropped, not a 500", r.status === 201 && r.body.bodyText === "hi there", `${r.status} ${JSON.stringify(r.body?.bodyText)}`);
  r = await a.call("POST", `/channels/${channelId}/messages`, { body: doc(text(`x${nul}y`)), clientMessageId: randomUUID() });
  ok("NUL inside a chat message is dropped, not a 500", r.status === 201 && r.body.text === "xy", `${r.status}`);
  r = await mgr.call("POST", `/tasks/${target.id}/attachments`, { fileName: "a.txt", mimeType: `text/plain${nul}`, sizeBytes: 1 });
  ok("NUL in a MIME type → 400", r.status === 400, r.status);

  // --- PERF-05: List/Board group pages use the partial (list, status, rank) index ---------------------
  // 20k generated top-level tasks in this project inside a transaction that is rolled back.
  // Spread over the workflow's statuses like a real board (one status group = a quarter of the list).
  const workflow = (await mgr.call("GET", `/projects/${project.id}/workflow?listId=${listId}`)).body.items.map((status) => status.id);
  const statusId = workflow[0];
  const otherList = (await mgr.call("POST", `/projects/${project.id}/lists`, { name: "Backlog lớn" })).body.id;
  const plan = localSql(`
    BEGIN;
    -- A third each: roots in another list, roots in this list, subtasks in this list.
    INSERT INTO public.tasks (organization_id, project_id, list_id, parent_task_id, status_id, number, rank, title, created_by)
    SELECT organization_id, project_id,
      CASE WHEN g % 3 = 0 THEN ${quote(otherList)}::uuid ELSE list_id END,
      CASE WHEN g % 3 = 2 THEN id END,
      (ARRAY[${workflow.map(quote).join(",")}]::uuid[])[1 + (g / 3) % ${workflow.length}],
      100000 + g, 'b' || lpad(g::text, 6, '0'), 'gen ' || g, created_by
    FROM public.tasks, generate_series(1, 30000) g WHERE id = ${quote(tasks[0].id)};
    ANALYZE public.tasks;
    EXPLAIN SELECT t.id FROM public.tasks t
      JOIN public.task_statuses ts ON ts.id = t.status_id AND ts.organization_id = t.organization_id
      WHERE t.organization_id = ${quote(ctxA.organization.id)} AND t.project_id = ${quote(project.id)}
        AND t.deleted_at IS NULL AND t.archived_at IS NULL AND t.list_id = ${quote(listId)}
        AND t.parent_task_id IS NULL AND t.status_id = ${quote(statusId)}
      ORDER BY t.rank COLLATE "C" ASC, t.id ASC LIMIT 51;
    ROLLBACK;
  `).join("\n");
  ok("board group page = ordered scan of tasks_list_root_status_rank_idx (no sort)", plan.includes("tasks_list_root_status_rank_idx") && !/\bSort\b/.test(plan), plan.split("\n").filter((line) => /Scan|Sort|Loop/.test(line)).map((line) => line.trim()).join(" | "));
} finally {
  if (channelId) {
    await a.call("DELETE", `/channels/${channelId}`).catch(() => undefined);
  }
  await sleep(200);
  await settleOutbox(since);
  purgeChannels([channelId]);
  localSql(`DELETE FROM public.notifications WHERE dedupe_key LIKE ${quote(`e2e-paging:${run}:%`)}`);
  await cleanupWorkProjects(mgr, [project?.id], since);
}
