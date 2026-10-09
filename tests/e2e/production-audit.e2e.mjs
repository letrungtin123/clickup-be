// Production audit fixes (2026-10-10 audit, fix wave 1): BUG-PR-01/02/03/04/05/07/08, PR-10/12/13/15/16/20,
// SEC-API-05 and the job-list keyset (PERF-01). One job is walked to delivery, gets feedback closed without rework and a
// re-done feedback; a second job is archived; a third carries late tasks and the chat reconciliation. Everything lives
// in an "E2E jobs <stamp>" project and is purged at the end (cleanup.mjs, like production-jobs).
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { dbNow, purgeProductionProjects, settleOutbox } from "./cleanup.mjs";
import { apiOrigin, bumpAuthz, localSql, seed, session } from "./lib.mjs";

const require = createRequire(new URL("../../package.json", import.meta.url));
const { io } = require("socket.io-client");
const backendRoot = fileURLToPath(new URL("../..", import.meta.url));

const ok = (label, cond, extra = "") => console.log(`${cond ? "PASS" : "FAIL"}  ${label} ${cond ? "" : typeof extra === "string" ? extra : JSON.stringify(extra)}`);
const quote = (text) => `'${String(text).replaceAll("'", "''")}'`;
const email = (who) => quote(seed[`SEED_${who}_EMAIL`].toLowerCase());
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cursorOf = (values) => Buffer.from(JSON.stringify(values), "utf8").toString("base64url");

// Setup (local DB only): MANAGER = ADMIN + QC, MEMBER_A = LEADER + QC, MEMBER_B and MEMBER_C = STAFF (C is put back
// outside the module at the end, as the other suites expect).
localSql(`
  DELETE FROM production.user_roles WHERE user_id IN (SELECT id FROM public.app_users WHERE lower(email) IN (${email("MEMBER_C")}));
  INSERT INTO production.user_roles (organization_id, user_id, role_code)
  SELECT om.organization_id, au.id, r.role FROM public.app_users au
  JOIN public.organization_memberships om ON om.user_id = au.id AND om.deleted_at IS NULL
  JOIN (VALUES (${email("MANAGER")}, 'ADMIN'), (${email("MANAGER")}, 'QC'), (${email("MEMBER_A")}, 'LEADER'), (${email("MEMBER_A")}, 'QC'),
               (${email("MEMBER_B")}, 'STAFF'), (${email("MEMBER_C")}, 'STAFF')) AS r(email, role) ON r.email = lower(au.email)
  ON CONFLICT DO NOTHING;
`);
bumpAuthz();

const admin = await session("MANAGER");
const leader = await session("MEMBER_A");
const staff = await session("MEMBER_B");
const other = await session("MEMBER_C");
const ids = {};
for (const [who, s] of [["admin", admin], ["leader", leader], ["staff", staff], ["other", other]]) {
  ids[who] = (await s.call("GET", "/workspace/context")).body.user.id;
}
const orgId = (await admin.call("GET", "/workspace/context")).body.organization.id;

const workflow = (await admin.call("GET", "/production/workflow")).body;
const st = Object.fromEntries(workflow.statuses.map((s) => [s.code, s.id]));
const processes = (await admin.call("GET", "/production/processes")).body.items;
const normal = processes.find((p) => p.name === "Normal Retouch");
const checking = processes.find((p) => p.isQc);
const shift = (await admin.call("GET", "/production/shifts")).body.items.find((s) => s.payMode === "POINTS" && !s.requiresOtHours && s.active);

const stamp = Date.now().toString(36).toUpperCase();
const projectCode = `PJ${stamp}`;
const businessDay = (offset = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(Date.now() + offset * 86_400_000));
const today = businessDay();
const inHours = (hours) => new Date(Date.now() + hours * 3_600_000).toISOString();

/** The worker's 15-minute lateness scan, run once now (same code, same database). */
const runLatenessScan = () => {
  const code = `
    const { runLatenessScan } = await import("./src/modules/production/lateness-scheduler.ts");
    const { closeDatabase } = await import("./src/db/client.ts");
    const { closeRedis } = await import("./src/lib/redis.ts");
    await runLatenessScan();
    await closeDatabase();
    await closeRedis();
  `;
  const result = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "--input-type=module", "--eval", code], { cwd: backendRoot, encoding: "utf8", timeout: 90_000 });
  if (result.status !== 0) {
    console.log(`WARN lateness scan exited ${result.status}: ${(result.stderr || "").split("\n").slice(-3).join(" ")}`);
  }
};

const waitFor = async (s, type, predicate, attempts = 30) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const page = (await s.call("GET", `/notifications?types=${type}&limit=100`)).body;
    const found = page.items?.find(predicate);
    if (found) return found;
    await sleep(500);
  }
  return null;
};
const countNotifications = (type, taskId) =>
  Number(localSql(`SELECT count(*) FROM public.notifications WHERE type = ${quote(type)} AND payload->>'productionTaskId' = ${quote(taskId)}`)[0]);

/** Socket of a session that joined the production room (like the web app) and records production:changed hints. */
const connect = async (s) => {
  const socket = await new Promise((resolve, reject) => {
    const client = io(apiOrigin, { path: "/socket.io", transports: ["websocket"], extraHeaders: { cookie: s.cookieHeader() }, reconnection: false });
    client.on("connect", () => resolve(client));
    client.on("connect_error", reject);
  });
  const events = [];
  socket.on("production:changed", (payload) => events.push(payload));
  await new Promise((resolve) => socket.emit("room:join", { type: "production", id: orgId }, resolve));
  return { socket, events };
};

const since = dbNow();
const sockets = [];
let projectId = null;
try {
  let r = await admin.call("POST", "/production/projects", { code: projectCode, name: `E2E jobs ${stamp}` });
  projectId = r.body.items.find((item) => item.code === projectCode).id;
  for (const [processId, creditPerImage, moneyPerImage] of [[normal.id, 3, 15000], [checking.id, 0.5, null]]) {
    await admin.call("PUT", "/production/credit-rules", { projectId, processId, creditPerImage, moneyPerImage, effectiveFrom: today });
  }
  const line = (extra) => ({ processId: normal.id, shiftId: shift.id, qtyAssigned: 5, ...extra });
  const move = (s, task, code, extra = {}) => s.call("POST", `/production/tasks/${task.id}/transition`, { toStatusId: st[code], ...extra });
  const bulk = (s, job, code) => s.call("POST", `/production/jobs/${job.id}/transition`, { toStatusId: st[code] });
  const detailOf = async (s, job) => (await s.call("GET", `/production/jobs/${job.id}`)).body;

  // Job A — created by the leader (the Admin is related only as QC of one task)
  r = await leader.call("POST", "/production/jobs", { projectId, code: `JOB ${stamp}A`, deadline: inHours(48), totalImages: 10 });
  const jobA = r.body;
  ok("leader creates job A", r.status === 201, r.body);

  // PR-20: production:changed reaches only people who may see the job
  const watch = { staff: await connect(staff), other: await connect(other), leader: await connect(leader) };
  sockets.push(...Object.values(watch).map((item) => item.socket));
  r = await leader.call("POST", `/production/jobs/${jobA.id}/tasks`, {
    tasks: [line({ assigneeId: ids.staff, qcId: ids.leader }), line({ assigneeId: ids.staff, qcId: ids.admin })]
  });
  const [t1, t2] = r.body.tasks ?? [];
  ok("leader splits job A 5/5", r.status === 201 && t1 && t2, r.body);
  await sleep(2000);
  const saw = (name) => watch[name].events.some((event) => event.jobId === jobA.id);
  ok("PR-20: worker and leader get the job's realtime hint", saw("staff") && saw("leader"), watch.staff.events);
  ok("PR-20: a member not involved in the job gets no job / task ids", !saw("other") && watch.other.events.length === 0, watch.other.events);

  // PR-10: mentions only for people who can see the task
  r = await staff.call("POST", `/production/tasks/${t1.id}/comments`, { body: "Nhờ xem giúp", mentionedUserIds: [ids.other] });
  ok("PR-10: mentioning someone who cannot see the task → 400", r.status === 400 && r.body.error.code === "MENTION_INVALID", r.body);
  r = await staff.call("POST", `/production/tasks/${t1.id}/comments`, { body: "Nhờ leader xem", mentionedUserIds: [ids.leader] });
  ok("PR-10: mentioning the job leader works", r.status === 201, r.body);
  r = await leader.call("POST", `/production/jobs/${jobA.id}/comments`, { body: "Job này gấp", mentionedUserIds: [ids.staff] });
  ok("PR-10: mentioning a worker of the job on the job works", r.status === 201, r.body);

  // BUG-PR-07: an ADMIN override out of Waiting QC is not a QC fail
  await move(staff, t1, "PROCESSING");
  r = await move(staff, t1, "DONE", { qtyDone: 5 });
  ok("t1 waits for QC", r.body.status?.code === "WAITING_QC", r.body);
  r = await move(admin, t1, "PROCESSING", { note: "Mở lại để đổi tên file" });
  ok("BUG-PR-07: admin override back to Processing does not count a QC fail", r.status === 200 && r.body.status.code === "PROCESSING" && r.body.qcFailCount === 0, r.body);
  await move(staff, t1, "DONE");
  r = await move(leader, t1, "CHECKED");
  ok("t1 checked by its QC", r.body.status?.code === "CHECKED", r.body);
  await move(staff, t2, "PROCESSING");
  await move(staff, t2, "DONE", { qtyDone: 5 });
  r = await move(admin, t2, "CHECKED");
  ok("t2 checked by its QC (admin)", r.body.status?.code === "CHECKED", r.body);

  // PR-12: a price that already priced scores is history
  r = await admin.call("PUT", "/production/credit-rules", { projectId, processId: normal.id, creditPerImage: 4, moneyPerImage: 15000, effectiveFrom: today });
  ok("PR-12: editing a used price in place → 409", r.status === 409 && r.body.error.code === "CREDIT_RULE_IN_USE", r.body);
  r = await admin.call("PUT", "/production/credit-rules", { projectId, processId: normal.id, creditPerImage: 4, moneyPerImage: 15000, effectiveFrom: businessDay(1) });
  ok("PR-12: a new version from a later day is accepted", r.status === 200 && r.body.items.length === 2 && r.body.items.some((rule) => rule.creditPerImage === 3), r.body);

  // Complete → Delivering
  r = await bulk(leader, jobA, "COMPLETE");
  ok("leader completes job A", r.status === 200 && r.body.moved === 2, r.body);
  r = await bulk(admin, jobA, "DELIVERING");
  ok("account delivers job A", r.status === 200 && r.body.job.status.code === "DELIVERING", r.body);

  // BUG-PR-01: FEEDBACK only through "Ghi feedback"
  let detail = await detailOf(admin, jobA);
  ok("BUG-PR-01: no bulk move into Feedback", !detail.capabilities.bulkActions.some((action) => action.toStatusId === st.FEEDBACK), detail.capabilities.bulkActions);
  ok("BUG-PR-01: no per-task move into Feedback (not even an override)", detail.tasks.every((task) => !task.capabilities.transitions.some((option) => option.toStatusId === st.FEEDBACK)));
  r = await bulk(admin, jobA, "FEEDBACK");
  ok("BUG-PR-01: job transition into Feedback refused (400)", r.status === 400 && r.body.error.code === "TRANSITION_NOT_ALLOWED", r.body);
  r = await move(admin, t1, "FEEDBACK", { note: "ép" });
  ok("BUG-PR-01: task transition into Feedback refused (400)", r.status === 400, r.body);
  const feedbackRow = workflow.transitions.find((item) => item.fromStatusId === st.DELIVERING && item.toStatusId === st.FEEDBACK);
  ok("BUG-PR-01: DELIVERING → FEEDBACK is SYSTEM-only in the workflow", !feedbackRow || feedbackRow.actors.join() === "SYSTEM", feedbackRow);

  // BUG-PR-02: the leader cannot release FEEDBACK while it is open; Account/Admin closes it without rework
  r = await admin.call("POST", `/production/jobs/${jobA.id}/feedbacks`, { type: "EXTRA", note: "Khách hỏi có cần crop không" });
  const fbExtra = r.body.feedbacks?.find((item) => item.status !== "RESOLVED");
  ok("feedback parks job A", r.status === 201 && r.body.status.code === "FEEDBACK" && r.body.capabilities.canCloseFeedback === true, r.body);
  detail = await detailOf(leader, jobA);
  ok(
    "BUG-PR-02: while open, the leader has no move out of Feedback",
    detail.capabilities.canCloseFeedback === false && !detail.capabilities.bulkActions.some((action) => action.toStatusId === st.COMPLETE) && detail.tasks.every((task) => task.capabilities.transitions.length === 0),
    detail.capabilities
  );
  r = await move(leader, t1, "COMPLETE");
  ok("BUG-PR-02: leader FEEDBACK → COMPLETE refused while open (409)", r.status === 409 && r.body.error.code === "FEEDBACK_OPEN", r.body);
  r = await leader.call("POST", `/production/feedbacks/${fbExtra.id}/close`, { note: "x" });
  ok("BUG-PR-02: only Account/Admin close a feedback (403)", r.status === 403, r.body);
  r = await admin.call("POST", `/production/feedbacks/${fbExtra.id}/close`, { note: "  " });
  ok("BUG-PR-02: closing needs a note (400)", r.status === 400, r.body);
  r = await admin.call("POST", `/production/feedbacks/${fbExtra.id}/close`, { note: "Khách đồng ý bản hiện tại" });
  const closed = r.body.feedbacks?.find((item) => item.id === fbExtra.id);
  ok(
    "BUG-PR-02: 'Đóng feedback, không cần làm lại' resolves it and returns the tasks to Complete",
    r.status === 200 && r.body.status.code === "COMPLETE" && r.body.tasks.every((task) => task.status.code === "COMPLETE") && closed?.status === "RESOLVED" && closed.resolution === "CLOSED" && closed.resolvedBy?.id === ids.admin && closed.resolutionNote === "Khách đồng ý bản hiện tại",
    r.body
  );
  r = await admin.call("POST", `/production/feedbacks/${fbExtra.id}/close`, { note: "lần hai" });
  ok("BUG-PR-02: closing twice → 409", r.status === 409 && r.body.error.code === "FEEDBACK_RESOLVED", r.body);

  // BUG-PR-03 (redo deadline) and PR-15 (feedback on an FB task notifies its worker)
  await bulk(admin, jobA, "DELIVERING");
  r = await admin.call("POST", `/production/jobs/${jobA.id}/feedbacks`, { type: "WRONG", note: "Ảnh 2 sai màu", sourceTaskId: t1.id });
  const fbWrong = r.body.feedbacks?.find((item) => item.status !== "RESOLVED");
  r = await leader.call("PATCH", `/production/jobs/${jobA.id}`, { deadline: inHours(-24) });
  ok("job A deadline moved into the past", r.status === 200, r.body);
  r = await leader.call("POST", `/production/feedbacks/${fbWrong.id}/reassign`, { tasks: [line({ assigneeId: ids.other, qcId: ids.leader, qtyAssigned: 1, sourceTaskId: t1.id })] });
  const fbTask = r.body.tasks?.[0];
  ok(
    "BUG-PR-03: a feedback redo task gets a deadline in the future (not late at birth)",
    r.status === 201 && new Date(fbTask.deadline).getTime() > Date.now() && fbTask.isLate === false,
    r.body
  );
  await move(other, fbTask, "PROCESSING");
  await move(other, fbTask, "DONE");
  r = await move(leader, fbTask, "CHECKED");
  detail = await detailOf(admin, jobA);
  ok("re-done work checked → feedback resolved (REWORKED), job back to Complete", detail.status?.code === "COMPLETE" && detail.feedbacks.find((item) => item.id === fbWrong.id)?.resolution === "REWORKED", detail.status);
  await bulk(admin, jobA, "DELIVERING");
  r = await admin.call("POST", `/production/jobs/${jobA.id}/feedbacks`, { type: "EXTRA", note: `Thêm bóng đổ ${stamp}`, sourceTaskId: fbTask.id });
  ok("feedback on the FB task", r.status === 201, r.body);
  const fbNotice = await waitFor(other, "production.feedback", (item) => item.target.jobId === jobA.id && item.payload.note === `Thêm bóng đổ ${stamp}`);
  ok("PR-15: the worker of the FB source task is notified", Boolean(fbNotice));
  const lastFeedback = r.body.feedbacks?.find((item) => item.status !== "RESOLVED");
  await admin.call("POST", `/production/feedbacks/${lastFeedback.id}/close`, { note: "Không cần" });

  // BUG-PR-05: the job timeline pages every row exactly once (rows of one bulk move share their timestamp)
  const full = (await leader.call("GET", `/production/jobs/${jobA.id}/timeline?limit=100`)).body.items ?? [];
  const keyOf = (item) => (item.kind === "log" ? item.log.id : item.comment.id);
  const timeOf = (item) => (item.kind === "log" ? item.log.createdAt : item.comment.createdAt);
  const paged = [];
  let cursor = null;
  for (let page = 0; page < 200; page += 1) {
    r = await leader.call("GET", `/production/jobs/${jobA.id}/timeline?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    paged.push(...r.body.items.map(keyOf));
    cursor = r.body.pageInfo.nextCursor;
    if (!cursor) break;
  }
  const sharedTimestamps = full.length - new Set(full.map(timeOf)).size;
  ok(
    "BUG-PR-05: limit=1 paging returns every timeline row once, in order",
    paged.length === full.length && new Set(paged).size === paged.length && JSON.stringify(paged) === JSON.stringify(full.map(keyOf)) && sharedTimestamps > 0,
    `${paged.length}/${full.length} rows, ${sharedTimestamps} shared timestamps`
  );

  // Job C — chat reconciliation (SEC-API-05, PR-13) and lateness (BUG-PR-03, BUG-PR-08)
  r = await leader.call("POST", "/production/jobs", { projectId, code: `JOB ${stamp}C`, deadline: inHours(48), totalImages: 10 });
  const jobC = r.body;
  r = await leader.call("POST", `/production/jobs/${jobC.id}/tasks`, { tasks: [line({ assigneeId: ids.staff, qcId: ids.leader })] });
  const c1 = r.body.tasks?.[0];
  r = await leader.call("POST", `/production/jobs/${jobC.id}/chat`);
  const channelId = r.body.channelId;
  ok("leader opens job C's chat", r.status === 200 && r.body.created === true, r.body);
  const members = () => localSql(`SELECT user_id FROM public.channel_members WHERE channel_id = '${channelId}' AND deleted_at IS NULL`);
  ok("chat members: leader + worker", members().sort().join() === [ids.leader, ids.staff].sort().join(), members());
  r = await admin.call("GET", `/channels/${channelId}`);
  const adminSawBefore = r.status;
  r = await admin.call("POST", `/production/jobs/${jobC.id}/chat`);
  ok("PR-13: an Admin who is not a member opening 'Nhóm chat' is added", r.status === 200 && r.body.channelId === channelId && members().includes(ids.admin), r.body);
  r = await admin.call("GET", `/channels/${channelId}`);
  ok("PR-13: …and can open the channel now", r.status === 200, `${adminSawBefore} → ${r.status}`);
  r = await leader.call("POST", `/production/tasks/${c1.id}/assign`, { assigneeId: ids.other });
  ok("leader moves job C's task to another worker", r.status === 200 && r.body.assignee.id === ids.other, r.body);
  ok("SEC-API-05: the worker taken off the job leaves its chat; the new one joins; the Admin stays", !members().includes(ids.staff) && members().includes(ids.other) && members().includes(ids.admin), members());
  r = await staff.call("GET", `/channels/${channelId}`);
  ok("SEC-API-05: …and can no longer open it", r.status === 404, `${r.status}`);
  r = await other.call("POST", `/production/jobs/${jobC.id}/chat`);
  ok("an involved worker may open the existing job chat", r.status === 200 && r.body.channelId === channelId, r.body);

  // BUG-PR-03 / BUG-PR-08: tasks created late are notified once per deadline; closed-without-Done tasks are not late
  r = await leader.call("POST", `/production/jobs/${jobC.id}/tasks`, {
    tasks: [line({ assigneeId: ids.staff, qcId: ids.leader, qtyAssigned: 1, deadline: inHours(-2) }), line({ assigneeId: ids.staff, qcId: ids.leader, qtyAssigned: 1, deadline: inHours(-3) })]
  });
  const [late1, late2] = r.body.tasks ?? [];
  ok("tasks created already late are flagged late", late1?.isLate === true && late2?.isLate === true, r.body);
  r = await move(admin, late2, "COMPLETE", { note: "Khách huỷ phần này" });
  ok("BUG-PR-08: closed by an override without Done → no longer late", r.status === 200 && r.body.isLate === false && r.body.doneAt === null, r.body);
  r = await leader.call("GET", "/production/dashboard/leader");
  ok("BUG-PR-08: not in the leader's late list; the open one is", r.status === 200 && !r.body.late.some((task) => task.id === late2.id) && r.body.late.some((task) => task.id === late1.id));
  ok("BUG-PR-08: job late count only counts open work", (await detailOf(leader, jobC)).lateTaskCount === 1);
  runLatenessScan();
  const lateNotice = await waitFor(staff, "production.task_late", (item) => item.target.productionTaskId === late1.id, 6);
  ok("BUG-PR-03: a task created late is notified late (worker)", Boolean(lateNotice));
  ok("BUG-PR-03: … and the job leader", Boolean(await waitFor(leader, "production.task_late", (item) => item.target.productionTaskId === late1.id, 6)));
  ok("BUG-PR-08: no late notification for the task closed without Done", countNotifications("production.task_late", late2.id) === 0);
  r = await leader.call("PATCH", `/production/tasks/${late1.id}`, { deadline: inHours(-1) });
  ok("deadline edited to another past time keeps the task late", r.status === 200 && r.body.isLate === true, r.body);
  runLatenessScan();
  runLatenessScan();
  ok("BUG-PR-03: notified once per deadline (2 deadlines → 2 notifications per person)", countNotifications("production.task_late", late1.id) === 4, `${countNotifications("production.task_late", late1.id)}`);

  // Job B — archived jobs are read-only and leave the QC queue / workload (BUG-PR-04)
  r = await leader.call("POST", "/production/jobs", { projectId, code: `JOB ${stamp}B`, deadline: inHours(48), totalImages: 800 });
  const jobB = r.body;
  r = await leader.call("POST", `/production/jobs/${jobB.id}/tasks`, {
    tasks: [line({ assigneeId: ids.staff, qcId: ids.leader, qtyAssigned: 7 }), line({ assigneeId: ids.staff, qcId: ids.leader, qtyAssigned: 777 })]
  });
  const [b1, b2] = r.body.tasks ?? [];
  await move(staff, b1, "PROCESSING");
  await move(staff, b1, "DONE");
  await move(staff, b2, "PROCESSING");
  const workload = async () => (await leader.call("GET", "/production/dashboard/leader")).body.workload.find((row) => row.user.id === ids.staff)?.qtyProcessing ?? 0;
  const processingBefore = await workload();
  ok("job B task in the QC queue before archiving", (await leader.call("GET", "/production/tasks/qc-queue")).body.items.some((task) => task.id === b1.id));
  r = await admin.call("PATCH", `/production/jobs/${jobB.id}`, { archived: true });
  ok("job B archived", r.status === 200 && r.body.archived === true, r.body);
  ok("BUG-PR-04: archived job leaves the QC queue", !(await leader.call("GET", "/production/tasks/qc-queue")).body.items.some((task) => task.id === b1.id));
  ok("BUG-PR-04: archived job leaves the workload", processingBefore - (await workload()) === 777, `${processingBefore}`);
  r = await staff.call("GET", `/production/tasks/${b2.id}`);
  ok("BUG-PR-04: archived job's task offers no action", r.status === 200 && r.body.capabilities.transitions.length === 0 && !r.body.capabilities.canEdit, r.body.capabilities);
  const archivedWrites = [
    ["transition", await move(staff, b2, "DONE")],
    ["QC", await move(leader, b1, "CHECKED")],
    ["qty", await leader.call("POST", `/production/tasks/${b1.id}/qty`, { qtyDone: 6 })],
    ["assign", await leader.call("POST", `/production/tasks/${b2.id}/assign`, { assigneeId: ids.other })],
    ["edit", await leader.call("PATCH", `/production/tasks/${b2.id}`, { note: "x" })],
    ["comment", await staff.call("POST", `/production/tasks/${b2.id}/comments`, { body: "x" })],
    ["job comment", await leader.call("POST", `/production/jobs/${jobB.id}/comments`, { body: "x" })],
    ["job transition", await bulk(leader, jobB, "COMPLETE")],
    ["new tasks", await leader.call("POST", `/production/jobs/${jobB.id}/tasks`, { tasks: [line({ assigneeId: ids.staff, qcId: ids.leader })] })],
    ["chat", await leader.call("POST", `/production/jobs/${jobB.id}/chat`)]
  ];
  const refused = archivedWrites.filter(([, res]) => res.status === 409 && res.body.error.code === "JOB_ARCHIVED").map(([name]) => name);
  ok("BUG-PR-04: every write on an archived job → 409 JOB_ARCHIVED", refused.length === archivedWrites.length, archivedWrites.map(([name, res]) => `${name}:${res.status}`).join(" "));

  // PERF-01: the job list keyset (full precision) pages every job once
  const listed = [];
  cursor = null;
  for (let page = 0; page < 10; page += 1) {
    r = await leader.call("GET", `/production/jobs?q=${encodeURIComponent(stamp.toLowerCase())}&includeArchived=true&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    listed.push(...r.body.items.map((job) => job.id));
    cursor = r.body.pageInfo.nextCursor;
    if (!cursor) break;
  }
  ok("PERF-01: job list pages newest first, each job once", JSON.stringify(listed) === JSON.stringify([jobB.id, jobC.id, jobA.id]), listed);
  r = await leader.call("GET", `/production/jobs?q=${encodeURIComponent(stamp.toLowerCase())}`);
  ok("PERF-01: archived jobs left out by default; aggregates per job", r.status === 200 && r.body.items.length === 2 && r.body.items.find((job) => job.id === jobC.id)?.lateTaskCount === 1, r.body.items);

  // PR-16: bad cursors and inputs are 400, never 500
  const bad = [
    ["job list cursor", await leader.call("GET", "/production/jobs?cursor=bm9wZQ")],
    ["job list cursor (year 0000)", await leader.call("GET", `/production/jobs?cursor=${cursorOf(["0000-01-01T00:00:00Z", jobA.id])}`)],
    ["job list cursor (not a uuid)", await leader.call("GET", `/production/jobs?cursor=${cursorOf(["2026-10-10T00:00:00Z", "x"])}`)],
    ["timeline cursor", await leader.call("GET", `/production/jobs/${jobA.id}/timeline?cursor=${cursorOf(["yesterday", jobA.id])}`)],
    ["my tasks cursor", await staff.call("GET", `/production/tasks/mine?cursor=${cursorOf(["2026-02-31T00:00:00Z", jobA.id])}`)],
    ["NUL in a comment", await staff.call("POST", `/production/tasks/${t1.id}/comments`, { body: "a\u0000b" })],
    ["NUL in the job search", await leader.call("GET", `/production/jobs?q=${encodeURIComponent("a\u0000b")}`)],
    ["year 0000 deadline", await leader.call("POST", "/production/jobs", { projectId, code: `X${stamp}`, deadline: "0000-01-01T00:00:00Z", totalImages: 1 })]
  ];
  ok("PR-16: bad cursors / NUL / impossible dates → 400", bad.every(([, res]) => res.status === 400), bad.map(([name, res]) => `${name}:${res.status}`).join(" "));

  // Delivered by now (the outbox was drained by the waits above).
  await settleOutbox(since, { graceMs: 500 });
  ok("BUG-PR-07: the override sent no QC-fail notification", countNotifications("production.qc_failed", t1.id) === 0);
} finally {
  for (const socket of sockets) socket.close();
  await settleOutbox(since);
  if (projectId) purgeProductionProjects([projectId]);
  localSql(`DELETE FROM production.user_roles WHERE user_id IN (SELECT id FROM public.app_users WHERE lower(email) IN (${email("MEMBER_C")}));`);
  bumpAuthz();
}
