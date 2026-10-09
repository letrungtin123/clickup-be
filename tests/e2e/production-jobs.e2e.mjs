// Production jobs & tasks — SPEC Phase 2 full loop: Account creates a job → Leader splits 5/5 → Done → QC fail
// then pass → Complete → Delivering → client feedback WRONG re-assigned to the same worker → Delivered.
import { bumpAuthz, localSql, seed, session } from "./lib.mjs";
const ok = (label, cond, extra = "") => console.log(`${cond ? "PASS" : "FAIL"}  ${label} ${extra}`);
const quote = (text) => `'${String(text).replaceAll("'", "''")}'`;
const email = (who) => quote(seed[`SEED_${who}_EMAIL`].toLowerCase());

// Setup (local DB only): MANAGER = ADMIN + QC, MEMBER_A = LEADER + QC, MEMBER_B = STAFF. MEMBER_C stays outside.
localSql(`
  DELETE FROM production.user_roles WHERE user_id IN (SELECT id FROM public.app_users WHERE lower(email) = ${email("MEMBER_C")});
  INSERT INTO production.user_roles (organization_id, user_id, role_code)
  SELECT om.organization_id, au.id, r.role FROM public.app_users au
  JOIN public.organization_memberships om ON om.user_id = au.id AND om.deleted_at IS NULL
  JOIN (VALUES (${email("MANAGER")}, 'ADMIN'), (${email("MANAGER")}, 'QC'), (${email("MEMBER_A")}, 'LEADER'),
               (${email("MEMBER_A")}, 'QC'), (${email("MEMBER_B")}, 'STAFF')) AS r(email, role) ON r.email = lower(au.email)
  ON CONFLICT DO NOTHING;
`);
bumpAuthz();

const admin = await session("MANAGER");
const leader = await session("MEMBER_A");
const staff = await session("MEMBER_B");
const outsider = await session("MEMBER_C");
const ids = {};
for (const [who, s] of [["admin", admin], ["leader", leader], ["staff", staff]]) {
  ids[who] = (await s.call("GET", "/workspace/context")).body.user.id;
}

const workflow = (await admin.call("GET", "/production/workflow")).body;
const st = Object.fromEntries(workflow.statuses.map((s) => [s.code, s.id]));
const normal = (await admin.call("GET", "/production/processes")).body.items.find((p) => p.name === "Normal Retouch");
const checking = (await admin.call("GET", "/production/processes")).body.items.find((p) => p.isQc);
const shift = (await admin.call("GET", "/production/shifts")).body.items.find((s) => s.payMode === "POINTS" && !s.requiresOtHours && s.active);
const otShift = (await admin.call("GET", "/production/shifts")).body.items.find((s) => s.requiresOtHours && s.active);

const stamp = Date.now().toString(36).toUpperCase();
const projectCode = `PJ${stamp}`;
let r = await admin.call("POST", "/production/projects", { code: projectCode, name: `E2E jobs ${stamp}`, qcBufferHours: 2 });
const project = r.body.items.find((item) => item.code === projectCode);
const deadline = new Date(Date.now() + 2 * 86_400_000).toISOString();
// Prices so the workflow writes real scores (fake numbers): Normal 3.00 / 15000 per image, Checking 0.50.
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
for (const [processId, creditPerImage, moneyPerImage] of [[normal.id, 3, 15000], [checking.id, 0.5, null]]) {
  await admin.call("PUT", "/production/credit-rules", { projectId: project.id, processId, creditPerImage, moneyPerImage, effectiveFrom: today });
}
const ledger = (taskId) =>
  localSql(`SELECT role || ':' || credits::text || ':' || money::text || ':' || qty FROM production.score_entries WHERE task_id = '${taskId}' ORDER BY created_at, role`);

// Jobs
r = await staff.call("POST", "/production/jobs", { projectId: project.id, code: `STAFF ${stamp}`, deadline, totalImages: 10 });
ok("STAFF cannot create jobs (403)", r.status === 403);
r = await outsider.call("GET", "/production/jobs");
ok("non-member gets 404", r.status === 404);
r = await admin.call("POST", "/production/jobs", { projectId: project.id, code: `JOB ${stamp}`, deadline, totalImages: 10 });
ok("Account/Admin must pick a leader", r.status === 400 && r.body.error.code === "LEADER_REQUIRED");
r = await admin.call("POST", "/production/jobs", { projectId: project.id, code: `JOB ${stamp}`, deadline, totalImages: 10, leaderId: ids.staff });
ok("leader must hold LEADER", r.status === 400 && r.body.error.code === "LEADER_INVALID");
r = await admin.call("POST", "/production/jobs", {
  projectId: project.id,
  code: `JOB ${stamp}`,
  name: "Batch 3",
  deadline,
  totalImages: 10,
  leaderId: ids.leader,
  driveLink: "https://drive.example.test/folder"
});
const job = r.body;
ok("admin creates job for a leader", r.status === 201 && job.leader.id === ids.leader && job.status === null && job.capabilities.canSplit === true);
r = await admin.call("POST", "/production/jobs", { projectId: project.id, code: `job ${stamp}`.toLowerCase(), deadline, totalImages: 1, leaderId: ids.leader });
ok("job code unique (409)", r.status === 409);
r = await admin.call("POST", "/production/jobs", { projectId: project.id, code: `X${stamp}`, deadline, totalImages: 1, leaderId: ids.leader, driveLink: "javascript:alert(1)" });
ok("drive link must be http(s)", r.status === 400);

// Split 5/5
const line = (extra) => ({ processId: normal.id, shiftId: shift.id, qtyAssigned: 5, ...extra });
r = await staff.call("POST", `/production/jobs/${job.id}/tasks`, { tasks: [line({ assigneeId: ids.staff })] });
ok("staff cannot split (403/404)", r.status === 403 || r.status === 404, `${r.status}`);
r = await leader.call("POST", `/production/jobs/${job.id}/tasks`, { tasks: [line({ assigneeId: ids.leader, qcId: ids.leader })] });
ok("qc = assignee rejected", r.status === 400 && r.body.error.message.includes("QC phải khác"));
r = await leader.call("POST", `/production/jobs/${job.id}/tasks`, { tasks: [line({ assigneeId: ids.leader })] });
ok("leader self-assign needs another QC", r.status === 400 && r.body.error.message.includes("Leader tự giao"));
r = await leader.call("POST", `/production/jobs/${job.id}/tasks`, { tasks: [line({ assigneeId: ids.staff, processId: checking.id })] });
ok("QC process cannot be assigned as work", r.status === 400);
r = await leader.call("POST", `/production/jobs/${job.id}/tasks`, {
  tasks: [line({ assigneeId: ids.staff, qcId: ids.leader }), line({ assigneeId: ids.leader, qcId: ids.admin })]
});
ok("leader splits 5/5", r.status === 201 && r.body.tasks.length === 2 && r.body.warnings.length === 0, JSON.stringify(r.body.error ?? r.body.warnings));
const [t1, t2] = r.body.tasks;
ok("default deadline = job − QC buffer", new Date(job.deadline).getTime() - new Date(t1.deadline).getTime() === 2 * 3_600_000);
ok("new tasks start Assigned", t1.status.code === "ASSIGNED" && t1.capabilities.transitions.length === 0);

let detail = (await leader.call("GET", `/production/jobs/${job.id}`)).body;
ok("job status follows tasks (Assigned)", detail.status?.code === "ASSIGNED" && detail.qtyAssigned === 10 && detail.capabilities.canSplit);
r = await outsider.call("GET", `/production/jobs/${job.id}`);
ok("outsider cannot see job", r.status === 404);

// Worker flow with QC fail
// Notifications are delivered asynchronously (outbox → RabbitMQ → worker): poll briefly.
const waitFor = async (s, type, predicate) => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const page = (await s.call("GET", `/notifications?types=${type}&limit=50`)).body;
    const found = page.items?.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
};
let n = await waitFor(staff, "production.task_assigned", (item) => item.target.productionTaskId === t1.id);
ok("worker notified of the new task", n?.title === job.code && n.target.jobId === job.id, n ? "" : "(none)");

const move = (s, task, code, extra = {}) => s.call("POST", `/production/tasks/${task.id}/transition`, { toStatusId: st[code], ...extra });
r = await staff.call("GET", `/production/tasks/${t1.id}`);
ok("assignee sees start action", r.body.capabilities.transitions.map((t) => t.toStatusId).join() === st.PROCESSING);
r = await move(staff, t1, "DONE");
ok("cannot skip Processing", r.status === 400 && r.body.error.code === "TRANSITION_NOT_ALLOWED");
r = await move(staff, t1, "PROCESSING");
ok("assignee starts", r.status === 200 && r.body.status.code === "PROCESSING");
r = await move(leader, t1, "DONE");
ok("others cannot mark Done", r.status === 400);
r = await move(staff, t1, "DONE", { qtyDone: 5 });
ok("Done → auto Waiting QC (QC assigned)", r.status === 200 && r.body.status.code === "WAITING_QC" && r.body.qtyDone === 5 && r.body.doneAt, JSON.stringify(r.body.error ?? r.body.status));
r = await leader.call("GET", "/production/tasks/qc-queue");
ok("task in leader's QC queue", r.body.items.some((task) => task.id === t1.id));
r = await move(staff, t1, "CHECKED");
ok("assignee cannot check own work", r.status === 400);
r = await move(leader, t1, "PROCESSING");
ok("QC fail needs a note", r.status === 400 && r.body.error.code === "NOTE_REQUIRED");
r = await move(leader, t1, "PROCESSING", { note: "Viền tóc còn răng cưa" });
n = null;
ok("QC fail returns to Processing", r.status === 200 && r.body.status.code === "PROCESSING" && r.body.qcFailCount === 1);
n = await waitFor(staff, "production.qc_failed", (item) => item.target.productionTaskId === t1.id);
ok("worker notified of the QC fail with the note", n?.payload.note === "Viền tóc còn răng cưa");
n = await waitFor(leader, "production.task_waiting_qc", (item) => item.target.productionTaskId === t1.id);
ok("QC notified when work waits for them", Boolean(n));
r = await move(staff, t1, "DONE", { qtyDone: 4 });
ok("qty locked after the first Done", r.status === 400 && r.body.error.code === "QTY_LOCKED");
r = await move(staff, t1, "DONE");
ok("Done again → Waiting QC", r.status === 200 && r.body.status.code === "WAITING_QC" && r.body.qtyDone === 5);
r = await move(leader, t1, "CHECKED");
ok("QC pass → Checked", r.status === 200 && r.body.status.code === "CHECKED" && r.body.checkedAt);

// Leader's own task, checked by another QC
await move(leader, t2, "PROCESSING");
r = await move(leader, t2, "DONE", { qtyDone: 5 });
ok("leader's own task waits for the other QC", r.body.status.code === "WAITING_QC");
r = await move(admin, t2, "CHECKED");
ok("assigned QC (admin) passes", r.status === 200 && r.body.status.code === "CHECKED");

// Quantity correction after Done
r = await staff.call("POST", `/production/tasks/${t2.id}/qty`, { qtyDone: 4 });
ok("staff cannot correct quantities (403/404)", r.status === 403 || r.status === 404);
r = await leader.call("POST", `/production/tasks/${t2.id}/qty`, { qtyDone: 4, note: "Khách bỏ 1 ảnh" });
ok("job leader corrects qty after Done", r.status === 200 && r.body.qtyDone === 4);
n = await waitFor(leader, "production.task_checked", (item) => item.target.productionTaskId === t2.id);
ok("job leader notified when a task is checked", Boolean(n));

// Scores written by the workflow (Phase 3 hooks)
ok("worker credit on first Done only (QC fail → Done again adds nothing)", ledger(t1.id).filter((row) => row.startsWith("WORKER")).join() === "WORKER:15.00:0:5", ledger(t1.id).join());
ok("QC credit per task on Checked (PD-010)", ledger(t1.id).includes("QC:2.50:0:5"), ledger(t1.id).join());
ok("leader's qty correction books adjustments", ledger(t2.id).join() === "WORKER:15.00:0:5,QC:2.50:0:5,QC:-0.50:0:-1,WORKER:-3.00:0:-1" || ledger(t2.id).filter((row) => row.includes(":-")).length === 2, ledger(t2.id).join());

// Complete → Delivering
r = await move(staff, t1, "COMPLETE");
ok("STAFF cannot complete (400)", r.status === 400);
detail = (await leader.call("GET", `/production/jobs/${job.id}`)).body;
const completeAction = detail.capabilities.bulkActions.find((action) => action.toStatusId === st.COMPLETE);
ok("leader gets a bulk Complete action for 2 tasks", completeAction?.taskCount === 2, JSON.stringify(detail.capabilities.bulkActions));
r = await leader.call("POST", `/production/jobs/${job.id}/transition`, { toStatusId: st.COMPLETE });
ok("leader completes the job", r.status === 200 && r.body.moved === 2 && r.body.job.status.code === "COMPLETE" && r.body.job.qtyChecked === 9);
r = await leader.call("POST", `/production/jobs/${job.id}/transition`, { toStatusId: st.DELIVERING });
ok("leader cannot deliver (Account only)", r.status === 409 && r.body.error.code === "NOTHING_TO_MOVE");
r = await admin.call("POST", `/production/jobs/${job.id}/transition`, { toStatusId: st.DELIVERING });
ok("account delivers", r.status === 200 && r.body.job.status.code === "DELIVERING");

// Client feedback (WRONG) → re-assigned to the same worker
r = await staff.call("POST", `/production/jobs/${job.id}/feedbacks`, { type: "WRONG", note: "x" });
ok("staff cannot record feedback", r.status === 403);
r = await admin.call("POST", `/production/jobs/${job.id}/feedbacks`, { type: "WRONG", note: "Ảnh 3 sai màu da", sourceTaskId: t1.id });
const feedback = r.body.feedbacks?.[0];
ok("feedback parks the job in FEEDBACK", r.status === 201 && r.body.status.code === "FEEDBACK" && feedback?.status === "OPEN" && r.body.tasks.every((t) => t.status.code === "FEEDBACK"));
n = await waitFor(staff, "production.feedback", (item) => item.target.jobId === job.id);
ok("original worker notified of client feedback", n?.payload.note === "Ảnh 3 sai màu da");
r = await staff.call("POST", `/production/feedbacks/${feedback.id}/reassign`, { tasks: [line({ assigneeId: ids.staff, qtyAssigned: 1 })] });
ok("staff cannot re-assign", r.status === 403);
r = await leader.call("POST", `/production/feedbacks/${feedback.id}/reassign`, {
  tasks: [line({ assigneeId: ids.staff, qcId: ids.leader, qtyAssigned: 1, sourceTaskId: t1.id })]
});
const fb = r.body.tasks?.[0];
ok("re-assigned to the same worker as FB_WRONG", r.status === 201 && fb.kind === "FB_WRONG" && fb.parentTaskId === t1.id && fb.assignee.id === ids.staff && fb.feedbackId === feedback.id);
await move(staff, fb, "PROCESSING");
await move(staff, fb, "DONE");
r = await move(leader, fb, "CHECKED");
ok("FB task checked", r.status === 200);
ok("FB_WRONG work earns 0 but keeps qty", ledger(fb.id).every((row) => row.split(":")[1] === "0.00") && ledger(fb.id).length === 2, ledger(fb.id).join());
detail = (await admin.call("GET", `/production/jobs/${job.id}`)).body;
ok("feedback resolved → job back to Complete", detail.feedbacks[0].status === "RESOLVED" && detail.status.code === "COMPLETE" && detail.tasks.every((t) => t.status.code === "COMPLETE"), `${detail.status?.code} ${detail.tasks.map((t) => t.status.code)}`);
r = await admin.call("POST", `/production/jobs/${job.id}/transition`, { toStatusId: st.DELIVERING });
r = await admin.call("POST", `/production/jobs/${job.id}/transition`, { toStatusId: st.DELIVERED });
ok("client OK → Delivered", r.status === 200 && r.body.job.status.code === "DELIVERED" && r.body.moved === 3);

// Personal boards, timeline, comments
r = await staff.call("GET", "/production/tasks/mine");
ok("finished tasks leave My Tasks", r.status === 200 && !r.body.items.some((t) => t.jobId === job.id));
r = await staff.call("GET", "/production/tasks/mine?includeFinished=true");
ok("…but can be listed", r.body.items.filter((t) => t.jobId === job.id).length === 2);
r = await staff.call("POST", `/production/tasks/${t1.id}/comments`, { body: "Đã sửa ảnh 3", mentionedUserIds: [ids.leader] });
ok("assignee comments on own task", r.status === 201 && r.body.canEdit);
n = await waitFor(leader, "production.mentioned", (item) => item.target.productionTaskId === t1.id);
ok("mentioned leader notified", n?.body === "Đã sửa ảnh 3");
r = await outsider.call("POST", `/production/tasks/${t1.id}/comments`, { body: "x" });
ok("outsider cannot comment", r.status === 404);
r = await staff.call("POST", `/production/tasks/${t1.id}/comments`, { body: "x", mentionedUserIds: [(await outsider.call("GET", "/workspace/context")).body.user.id] });
ok("mentions limited to production members", r.status === 400);
r = await leader.call("GET", `/production/jobs/${job.id}/timeline?limit=100`);
const kinds = new Set(r.body.items.map((item) => (item.kind === "log" ? item.log.action : "comment")));
ok("job timeline interleaves comments and history", ["comment", "CREATE", "STATUS", "QTY"].every((kind) => kinds.has(kind)), [...kinds].join());
const failLog = r.body.items.find((item) => item.kind === "log" && item.log.toValue?.qcFail);
ok("QC fail note kept in history", failLog?.log.note === "Viền tóc còn răng cưa");
r = await staff.call("GET", `/production/tasks/${t2.id}/timeline`);
ok("staff can open a task of their job? (not their task → 404)", r.status === 404);

// Lateness and admin override
r = await leader.call("POST", `/production/jobs/${job.id}/tasks`, {
  tasks: [line({ assigneeId: ids.staff, qcId: ids.leader, qtyAssigned: 1, deadline: new Date(Date.now() - 3_600_000).toISOString() })]
});
ok("delivered job still accepts extra work (warns over-allocation)", r.status === 201 && r.body.warnings.length === 1 && r.body.tasks[0].isLate);
const late = r.body.tasks[0];
r = await admin.call("POST", `/production/tasks/${late.id}/transition`, { toStatusId: st.DELIVERED });
ok("admin override needs a reason", r.status === 400 && r.body.error.code === "NOTE_REQUIRED");
r = await admin.call("POST", `/production/tasks/${late.id}/transition`, { toStatusId: st.DELIVERED, note: "Huỷ – khách không cần" });
ok("admin override with reason", r.status === 200 && r.body.status.code === "DELIVERED");
ok("override that skips Done records no scores", ledger(late.id).length === 0, ledger(late.id).join());
if (otShift) {
  r = await leader.call("POST", `/production/jobs/${job.id}/tasks`, { tasks: [line({ assigneeId: ids.staff, qcId: ids.leader, qtyAssigned: 1, shiftId: otShift.id })] });
  const ot = r.body.tasks[0];
  await move(staff, ot, "PROCESSING");
  r = await move(staff, ot, "DONE");
  ok("OT shift requires OT hours at Done", r.status === 400 && r.body.error.code === "OT_HOURS_REQUIRED");
  r = await move(staff, ot, "DONE", { otHours: 1.5 });
  ok("OT hours stored", r.status === 200 && r.body.otHours === 1.5);
}

// Job group chat
r = await staff.call("POST", `/production/jobs/${job.id}/chat`);
ok("staff cannot create the job chat", r.status === 403);
r = await leader.call("POST", `/production/jobs/${job.id}/chat`);
ok("leader creates the job chat", r.status === 200 && r.body.created === true, JSON.stringify(r.body.error ?? ""));
const channelId = r.body.channelId;
r = await staff.call("GET", `/channels/${channelId}`);
ok("worker is a member of the job chat", r.status === 200 && r.body.kind === "private", `${r.status}`);
r = await outsider.call("GET", `/channels/${channelId}`);
ok("outsider cannot see the job chat", r.status === 404);
r = await leader.call("POST", `/production/jobs/${job.id}/chat`);
ok("second call reuses the channel", r.body.channelId === channelId && r.body.created === false);
ok("job exposes its chat", (await leader.call("GET", `/production/jobs/${job.id}`)).body.channelId === channelId);

// Listing & cleanup
r = await leader.call("GET", `/production/jobs?q=${encodeURIComponent(stamp.toLowerCase())}`);
ok("job list search + aggregates", r.status === 200 && r.body.items[0]?.id === job.id && r.body.items[0].taskCount >= 3);
r = await leader.call("PATCH", `/production/jobs/${job.id}`, { archived: true });
ok("leader cannot archive", r.status === 403);
r = await admin.call("PATCH", `/production/jobs/${job.id}`, { archived: true });
ok("account/admin archives", r.status === 200 && r.body.archived);
await admin.call("PATCH", `/production/projects/${project.id}`, { code: project.code, name: project.name, active: false });
await leader.call("DELETE", `/channels/${channelId}`, { confirmName: (await leader.call("GET", `/channels/${channelId}`)).body.name });
