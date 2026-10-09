// Production reports — SPEC Phase 5: report query layer (fb_rate 2 FB_WRONG / 20 tasks, late_count only is_late,
// money_khoan refused to LEADER, three dimension × measure combinations), saved reports, Leader / Admin dashboards,
// anomalies with "Đã xem", and the Excel exports (report, jobs with formula-injection guard, score board, KPI).
// Fixtures are inserted directly (local DB only) with explicit ids — historical rows in May 2019, live rows for the
// dashboards / anomalies — and removed at the end.
import { randomUUID } from "node:crypto";

import ExcelJS from "exceljs";

import { base, bumpAuthz, localSql, seed, session } from "./lib.mjs";

const ok = (label, cond, extra = "") => console.log(`${cond ? "PASS" : "FAIL"}  ${label} ${extra}`);
const quote = (text) => `'${String(text).replaceAll("'", "''")}'`;
const email = (who) => seed[`SEED_${who}_EMAIL`].toLowerCase();

// Setup: MANAGER = ADMIN, MEMBER_A = LEADER + QC, MEMBER_B = STAFF, MEMBER_C outside the module.
localSql(`
  DELETE FROM production.user_roles WHERE user_id IN (SELECT id FROM public.app_users WHERE lower(email) IN (${["MEMBER_A", "MEMBER_B", "MEMBER_C"].map((who) => quote(email(who))).join(",")}));
  INSERT INTO production.user_roles (organization_id, user_id, role_code)
  SELECT om.organization_id, au.id, r.role FROM public.app_users au
  JOIN public.organization_memberships om ON om.user_id = au.id AND om.deleted_at IS NULL
  JOIN (VALUES (${quote(email("MANAGER"))}, 'ADMIN'), (${quote(email("MEMBER_A"))}, 'LEADER'), (${quote(email("MEMBER_A"))}, 'QC'),
               (${quote(email("MEMBER_B"))}, 'STAFF')) AS r(email, role) ON r.email = lower(au.email)
  ON CONFLICT DO NOTHING;
`);
bumpAuthz();

const [orgId, adminId, leaderId, staffId] = localSql(`
  SELECT om.organization_id || '|' || m.id || '|' || a.id || '|' || b.id
  FROM public.app_users m
  JOIN public.organization_memberships om ON om.user_id = m.id AND om.deleted_at IS NULL
  JOIN public.app_users a ON lower(a.email) = ${quote(email("MEMBER_A"))}
  JOIN public.app_users b ON lower(b.email) = ${quote(email("MEMBER_B"))}
  WHERE lower(m.email) = ${quote(email("MANAGER"))} LIMIT 1;
`)[0].split("|");
const previousTeam = localSql(`SELECT coalesce(team_id::text, '') FROM production.member_profiles WHERE organization_id = '${orgId}' AND user_id = '${staffId}';`)[0] ?? "";

const stamp = Date.now().toString(36).toUpperCase();
const fx = {
  client: randomUUID(),
  project: randomUUID(),
  team: randomUUID(),
  tag: randomUUID(),
  otherTag: randomUUID(),
  oldJob: randomUUID(),
  feedback: randomUUID(),
  liveJob: randomUUID(),
  formulaJob: randomUUID(),
  overdue: randomUUID(),
  dueSoon: randomUUID(),
  later: randomUUID(),
  qtyTask: randomUUID(),
  qcFailTask: randomUUID(),
  fastTask: randomUUID(),
  archivedJob: randomUUID(),
  archivedLate: randomUUID()
};
// 20 tasks done by MEMBER_B in May 2019: #1–#2 FB_WRONG (week of 06/05), #11–#13 is_late (week of 13/05),
// #14 done after its deadline but NOT flagged late (only the flag counts), #18–#20 on the Khoán shift.
const oldTasks = Array.from({ length: 20 }, (_, index) => ({
  id: randomUUID(),
  n: index + 1,
  day: index < 10 ? `2019-05-0${6 + (index % 5)}` : `2019-05-${13 + (index % 5)}`,
  fb: index < 2,
  late: index >= 10 && index < 13,
  doneAfterDeadline: index === 13,
  khoan: index >= 17
}));
const allTaskIds = [...oldTasks.map((task) => task.id), fx.overdue, fx.dueSoon, fx.later, fx.qtyTask, fx.qcFailTask, fx.fastTask, fx.archivedLate];
const taskIdList = allTaskIds.map((id) => `'${id}'`).join(",");
const lookup = `
  (SELECT id FROM production.processes WHERE organization_id = '${orgId}' AND name = 'Normal Retouch') AS normal,
  (SELECT id FROM production.processes WHERE organization_id = '${orgId}' AND is_qc AND active LIMIT 1) AS checking,
  (SELECT id FROM production.shifts WHERE organization_id = '${orgId}' AND pay_mode = 'POINTS' AND NOT requires_ot_hours ORDER BY sort_order LIMIT 1) AS official,
  (SELECT id FROM production.shifts WHERE organization_id = '${orgId}' AND pay_mode = 'MONEY_IF_KPI' ORDER BY sort_order LIMIT 1) AS khoan,
  (SELECT id FROM production.statuses WHERE organization_id = '${orgId}' AND code = 'CHECKED') AS checked,
  (SELECT id FROM production.statuses WHERE organization_id = '${orgId}' AND code = 'PROCESSING') AS processing,
  (SELECT id FROM production.statuses WHERE organization_id = '${orgId}' AND code = 'ASSIGNED') AS assigned`;

const oldValues = oldTasks
  .map((task) => {
    const done = `'${task.day}T15:00:00+07:00'::timestamptz`;
    const deadline = task.late || task.doneAfterDeadline ? `'${task.day}T09:00:00+07:00'::timestamptz` : `'${task.day}T20:00:00+07:00'::timestamptz`;
    return `('${task.id}'::uuid, ${task.fb ? "'FB_WRONG'" : "'NORMAL'"}, ${task.fb ? `'${fx.feedback}'::uuid` : "NULL::uuid"}, ${task.khoan}, ${done}, ${deadline}, ${task.late})`;
  })
  .join(",\n    ");

const savedIds = [];
const reviewedKeys = [];
const cleanup = () => {
  localSql(`
    BEGIN;
    SET LOCAL session_replication_role = replica; -- the score ledger and task logs are immutable by trigger; fixtures only
    DELETE FROM production.anomaly_reviews WHERE organization_id = '${orgId}' AND (task_id IN (${taskIdList})${
      reviewedKeys.length ? ` OR subject_key IN (${reviewedKeys.map(quote).join(",")})` : ""
    });
    DELETE FROM production.score_entries WHERE task_id IN (${taskIdList});
    DELETE FROM production.task_logs WHERE task_id IN (${taskIdList});
    DELETE FROM production.tasks WHERE id IN (${taskIdList});
    DELETE FROM production.feedbacks WHERE id = '${fx.feedback}';
    DELETE FROM production.entity_tags WHERE tag_id IN ('${fx.tag}', '${fx.otherTag}');
    DELETE FROM production.jobs WHERE id IN ('${fx.oldJob}', '${fx.liveJob}', '${fx.formulaJob}', '${fx.archivedJob}');
    DELETE FROM production.projects WHERE id = '${fx.project}';
    DELETE FROM production.clients WHERE id = '${fx.client}';
    DELETE FROM production.tags WHERE id IN ('${fx.tag}', '${fx.otherTag}');
    COMMIT;
    UPDATE production.member_profiles SET team_id = ${previousTeam ? `'${previousTeam}'` : "NULL"} WHERE organization_id = '${orgId}' AND user_id = '${staffId}';
    DELETE FROM production.teams WHERE id = '${fx.team}';
    ${savedIds.length ? `DELETE FROM production.saved_reports WHERE id IN (${savedIds.map(quote).join(",")});` : ""}
  `);
};

/** Raw request for binary responses (exports). */
const download = async (s, method, path, body) => {
  const cookie = s.cookieHeader();
  const csrf = cookie.match(/(?:^|; )nesso_csrf=([^;]+)/)?.[1];
  const res = await fetch(base + path, {
    method,
    headers: { cookie, "content-type": "application/json", origin: process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:5890", ...(csrf ? { "x-csrf-token": csrf } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const buffer = Buffer.from(await res.arrayBuffer());
  let workbook = null;
  if (res.ok && res.headers.get("content-type")?.includes("spreadsheetml")) {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
  }
  return { status: res.status, type: res.headers.get("content-type"), disposition: res.headers.get("content-disposition"), workbook, json: workbook ? null : JSON.parse(buffer.toString("utf8") || "null") };
};

const may = { from: "2019-05-01", to: "2019-05-31", filters: { project: [fx.project] } };
const query = (s, config) => s.call("POST", "/production/reports/query", config);
const rowOf = (body, key, value) => body.rows?.find((row) => row[key] === value);

let admin = null;
let originalSettings = null;
try {
  localSql(`
    BEGIN;
    INSERT INTO production.clients (id, organization_id, name) VALUES ('${fx.client}', '${orgId}', 'E2E report client ${stamp}');
    INSERT INTO production.projects (id, organization_id, code, name, client_id) VALUES ('${fx.project}', '${orgId}', 'E2ERP${stamp}', 'E2E reports ${stamp}', '${fx.client}');
    INSERT INTO production.teams (id, organization_id, name) VALUES ('${fx.team}', '${orgId}', 'E2E report team ${stamp}');
    INSERT INTO production.tags (id, organization_id, name) VALUES ('${fx.tag}', '${orgId}', 'e2e-rp-${stamp}'), ('${fx.otherTag}', '${orgId}', 'e2e-rp-other-${stamp}');
    INSERT INTO production.member_profiles (organization_id, user_id, team_id) VALUES ('${orgId}', '${staffId}', '${fx.team}')
    ON CONFLICT (organization_id, user_id) DO UPDATE SET team_id = EXCLUDED.team_id;
    INSERT INTO production.jobs (id, organization_id, project_id, code, leader_id, deadline, total_images, created_by) VALUES
      ('${fx.oldJob}', '${orgId}', '${fx.project}', 'E2ERP${stamp} may', '${leaderId}', '2019-05-25T18:00:00+07:00', 400, '${leaderId}'),
      ('${fx.liveJob}', '${orgId}', '${fx.project}', 'E2ERP${stamp} live', '${leaderId}', now() + interval '1 day', 100, '${leaderId}'),
      ('${fx.formulaJob}', '${orgId}', '${fx.project}', '=HYPERLINK("http://x") E2ERP${stamp}', '${adminId}', now() + interval '2 days', 5, '${adminId}');
    -- An archived job with a late open task: in neither the "Job đang trễ" card nor its report (PR-09).
    INSERT INTO production.jobs (id, organization_id, project_id, code, leader_id, deadline, total_images, created_by, archived_at)
    VALUES ('${fx.archivedJob}', '${orgId}', '${fx.project}', 'E2ERP${stamp} archived', '${leaderId}', now() - interval '1 day', 5, '${leaderId}', now());
    INSERT INTO production.entity_tags (organization_id, entity, entity_id, tag_id) VALUES ('${orgId}', 'JOB', '${fx.oldJob}', '${fx.tag}');
    INSERT INTO production.feedbacks (id, organization_id, job_id, type, note, created_by, status)
    VALUES ('${fx.feedback}', '${orgId}', '${fx.oldJob}', 'WRONG', 'E2E', '${adminId}', 'RESOLVED');
    INSERT INTO production.tasks (id, organization_id, job_id, assignee_id, qc_id, process_id, shift_id, qty_assigned, qty_done,
      assigned_at, deadline, done_at, checked_at, status_id, kind, feedback_id, is_late, created_by)
    SELECT v.id, '${orgId}', '${fx.oldJob}', '${staffId}', '${leaderId}', l.normal, CASE WHEN v.khoan THEN l.khoan ELSE l.official END, 10, 10,
      v.done - interval '2 hours', v.deadline, v.done, v.done + interval '1 hour', l.checked, v.kind, v.feedback, v.late, '${leaderId}'
    FROM (SELECT ${lookup}) l, (VALUES
      ${oldValues}
    ) AS v(id, kind, feedback, khoan, done, deadline, late);
    INSERT INTO production.score_entries (organization_id, user_id, task_id, job_id, project_id, process_id, shift_id, role, pay_mode, kind,
      unit_credits, unit_money, qty, credits, money, business_day, period_month, created_at)
    SELECT '${orgId}', '${staffId}', t.id, t.job_id, '${fx.project}', t.process_id, t.shift_id, 'WORKER', s.pay_mode, t.kind,
      CASE WHEN t.kind = 'FB_WRONG' THEN 0 ELSE 1.5 END,
      CASE WHEN t.kind <> 'FB_WRONG' AND s.pay_mode = 'MONEY_IF_KPI' THEN 5000 ELSE 0 END, 10,
      CASE WHEN t.kind = 'FB_WRONG' THEN 0 ELSE 15 END,
      CASE WHEN t.kind <> 'FB_WRONG' AND s.pay_mode = 'MONEY_IF_KPI' THEN 50000 ELSE 0 END,
      (t.done_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, '2019-05-01', t.done_at
    FROM production.tasks t JOIN production.shifts s ON s.organization_id = t.organization_id AND s.id = t.shift_id
    WHERE t.id IN (${oldTasks.map((task) => `'${task.id}'`).join(",")});
    INSERT INTO production.score_entries (organization_id, user_id, task_id, job_id, project_id, process_id, shift_id, role, pay_mode, kind,
      unit_credits, unit_money, qty, credits, money, business_day, period_month, created_at)
    SELECT '${orgId}', '${leaderId}', '${oldTasks[5].id}', '${fx.oldJob}', '${fx.project}', l.checking, l.official, 'QC', 'POINTS', 'NORMAL',
      0.5, 0, 10, 5, 0, '2019-05-08', '2019-05-01', '2019-05-08T16:00:00+07:00'
    FROM (SELECT ${lookup}) l;
    -- Live tasks: open ones for the Leader dashboard, done ones for the anomalies (last 30 days).
    INSERT INTO production.tasks (id, organization_id, job_id, assignee_id, qc_id, process_id, shift_id, qty_assigned, qty_done,
      assigned_at, deadline, done_at, status_id, is_late, qc_fail_count, created_by)
    SELECT v.id::uuid, '${orgId}', '${fx.liveJob}', '${staffId}', '${leaderId}', l.normal, l.official, v.qa, v.qd,
      v.assigned, v.deadline, v.done, CASE v.st WHEN 'P' THEN l.processing WHEN 'A' THEN l.assigned ELSE l.checked END, v.late, v.fails, '${leaderId}'
    FROM (SELECT ${lookup}) l, (VALUES
      ('${fx.overdue}', 7, NULL::int, now() - interval '5 hours', now() - interval '1 hour', NULL::timestamptz, 'P', true, 0),
      ('${fx.dueSoon}', 3, NULL::int, now() - interval '2 hours', now() + interval '30 minutes', NULL::timestamptz, 'A', false, 0),
      ('${fx.later}', 4, NULL::int, now() - interval '1 hour', now() + interval '10 days', NULL::timestamptz, 'A', false, 0),
      ('${fx.qtyTask}', 10, 8, now() - interval '30 hours', now() + interval '1 day', now() - interval '26 hours', 'C', false, 0),
      ('${fx.qcFailTask}', 5, 5, now() - interval '30 hours', now() + interval '1 day', now() - interval '25 hours', 'C', false, 2),
      ('${fx.fastTask}', 6, 6, now() - interval '20 hours', now() + interval '1 day', now() - interval '20 hours' + interval '2 minutes', 'C', false, 0)
    ) AS v(id, qa, qd, assigned, deadline, done, st, late, fails);
    INSERT INTO production.tasks (id, organization_id, job_id, assignee_id, qc_id, process_id, shift_id, qty_assigned,
      assigned_at, deadline, status_id, is_late, late_notified_deadline, created_by)
    SELECT '${fx.archivedLate}', '${orgId}', '${fx.archivedJob}', '${staffId}', '${leaderId}', l.normal, l.official, 3,
      now() - interval '3 days', now() - interval '2 days', l.processing, true, now() - interval '2 days', '${leaderId}'
    FROM (SELECT ${lookup}) l;
    INSERT INTO production.task_logs (organization_id, task_id, job_id, user_id, action, from_value, to_value, created_at) VALUES
      ('${orgId}', '${fx.qtyTask}', '${fx.liveJob}', '${staffId}', 'STATUS', '{"code":"PROCESSING"}', '{"code":"DONE","qtyDone":10}', now() - interval '26 hours'),
      ('${orgId}', '${fx.qtyTask}', '${fx.liveJob}', '${leaderId}', 'QTY', '{"qtyDone":10}', '{"qtyDone":8}', now() - interval '25 hours');
    COMMIT;
  `);

  admin = await session("MANAGER");
  const leader = await session("MEMBER_A");
  const staff = await session("MEMBER_B");
  const outsider = await session("MEMBER_C");
  originalSettings = (await admin.call("GET", "/production/settings")).body;

  // Access
  let r = await query(staff, { measures: ["task_count"], ...may });
  ok("STAFF cannot run reports (403)", r.status === 403);
  r = await query(outsider, { measures: ["task_count"], ...may });
  ok("non-member gets 404", r.status === 404);
  r = await query(admin, { dimensions: ["user; DROP TABLE production.tasks"], measures: ["task_count"], ...may });
  ok("unknown dimension rejected (400)", r.status === 400 && r.body.error.code === "VALIDATION_FAILED");
  r = await query(admin, { measures: ["credits"], ...may });
  ok("unknown measure rejected (400)", r.status === 400);

  // SPEC §7.7 — fb_rate = 2 FB_WRONG / 20 tasks
  r = await query(admin, { dimensions: ["user"], measures: ["fb_rate", "fb_wrong_count", "task_count"], ...may });
  let row = rowOf(r.body, "user", staffId);
  ok("fb_rate = 2 FB_WRONG / 20 tasks = 0.1", r.status === 200 && row?.task_count === 20 && row.fb_wrong_count === 2 && row.fb_rate === 0.1, JSON.stringify(row ?? r.body));
  ok("rows carry labels", typeof row?.user_label === "string" && row.user_label.length > 0);

  // SPEC §7.7 — late_count only counts is_late (a task done after its deadline but not flagged is not late)
  r = await query(admin, { measures: ["late_count", "late_rate", "task_count"], ...may });
  ok("late_count counts only is_late tasks", r.status === 200 && r.body.totals.late_count === 3 && r.body.totals.late_rate === 0.15, JSON.stringify(r.body.totals));
  ok("no dimensions → one totals row", r.body.rows.length === 1 && r.body.rows[0].late_count === 3);

  // SPEC §7.7 — money_khoan is never returned to a LEADER
  r = await query(leader, { dimensions: ["user"], measures: ["points", "money_khoan"], ...may });
  ok("LEADER asking money_khoan → 403 MONEY_FORBIDDEN", r.status === 403 && r.body.error.code === "MONEY_FORBIDDEN" && !JSON.stringify(r.body).includes("150000"));
  r = await query(leader, { dimensions: ["user"], measures: ["points", "points_khoan"], ...may });
  row = rowOf(r.body, "user", staffId);
  ok("LEADER gets points without money", r.status === 200 && row?.points === 225 && row.points_khoan === 45 && !("money_khoan" in row), JSON.stringify(row));
  r = await query(admin, { dimensions: ["user"], measures: ["points", "points_khoan", "money_khoan"], ...may });
  row = rowOf(r.body, "user", staffId);
  ok("combination 1 (scores): ADMIN user × points / Khoán points / money", row?.points === 225 && row.points_khoan === 45 && row.money_khoan === 150000, JSON.stringify(row));
  ok("QC credit reported under the QC", rowOf(r.body, "user", leaderId)?.points === 5);

  // Combination 2 — tasks: user × week
  r = await query(admin, { dimensions: ["user", "week"], measures: ["task_count", "fb_rate", "late_count"], ...may });
  const week1 = r.body.rows?.find((item) => item.user === staffId && item.week === "2019-05-06");
  const week2 = r.body.rows?.find((item) => item.user === staffId && item.week === "2019-05-13");
  ok(
    "combination 2 (tasks): user × week",
    week1?.task_count === 10 && week1.fb_rate === 0.2 && week2?.task_count === 10 && week2.fb_rate === 0 && week2.late_count === 3 && r.body.totals.fb_rate === 0.1,
    JSON.stringify(r.body.rows)
  );
  ok("week label in Vietnamese", week1?.week_label === "Tuần 06/05/2019");

  // Combination 3 — mixed sources: project × month
  r = await query(admin, { dimensions: ["project", "month"], measures: ["points", "points_khoan", "qty_done", "fb_rate"], ...may });
  row = r.body.rows?.[0];
  ok(
    "combination 3 (mixed): project × month",
    r.body.rows?.length === 1 && row.project === fx.project && row.project_label === `E2ERP${stamp}` && row.month === "2019-05" && row.points === 230 && row.points_khoan === 45 && row.qty_done === 200 && row.fb_rate === 0.1,
    JSON.stringify(r.body.rows)
  );

  // Team / client labels, tags, KPI period, sort + limit
  r = await query(admin, { dimensions: ["team", "client"], measures: ["task_count"], ...may });
  ok("team and client dimensions", rowOf(r.body, "team", fx.team)?.client_label === `E2E report client ${stamp}` && rowOf(r.body, "team", fx.team)?.task_count === 20);
  r = await query(admin, { measures: ["task_count"], from: may.from, to: may.to, filters: { tag: [fx.tag] } });
  ok("tag filter (tag on the job)", r.body.totals?.task_count === 20, JSON.stringify(r.body.totals));
  r = await query(admin, { measures: ["task_count"], from: may.from, to: may.to, filters: { tag: [fx.otherTag] } });
  ok("other tag matches nothing", r.body.totals?.task_count === 0);
  r = await query(admin, { dimensions: ["period"], measures: ["points", "task_count"], ...may });
  ok("KPI period dimension (close day)", r.body.rows?.length === 1 && r.body.rows[0].period === "2019-05" && r.body.rows[0].task_count === 20);
  r = await query(admin, { dimensions: ["day"], measures: ["task_count"], ...may, sort: { key: "task_count", direction: "desc" }, limit: 3 });
  ok("sort + limit bound the rows", r.body.rows?.length === 3 && r.body.truncated === true && r.body.rowLimit === 3);
  r = await query(admin, { measures: ["task_count"], from: "2018-01-01", to: "2019-05-31" });
  ok("range over 366 days rejected", r.status === 400 && r.body.error.code === "INVALID_RANGE");

  // Private scores: no per-person points for a LEADER
  await admin.call("PATCH", "/production/settings", { scoresPublic: false });
  r = await query(leader, { dimensions: ["user"], measures: ["points"], ...may });
  ok("scores private → LEADER cannot see points per person", r.status === 403 && r.body.error.code === "SCORES_PRIVATE");
  r = await query(leader, { dimensions: ["team"], measures: ["points"], ...may });
  ok("scores private → team totals still available", r.status === 200);
  r = await query(leader, { dimensions: ["job"], measures: ["points"], ...may });
  ok("PR-11: scores private → no points per job for a LEADER either", r.status === 403 && r.body.error.code === "SCORES_PRIVATE");
  r = await query(leader, { dimensions: ["job"], measures: ["task_count"], ...may });
  ok("PR-11: … task measures per job stay available", r.status === 200);
  await admin.call("PATCH", "/production/settings", { scoresPublic: originalSettings.scoresPublic });

  // Saved reports
  const savedConfig = { dimensions: ["user"], measures: ["fb_rate", "task_count"], preset: "THIS_MONTH" };
  r = await leader.call("POST", "/production/reports/saved", { name: `E2E FB ${stamp}`, config: savedConfig });
  const mine = r.body;
  if (mine?.id) savedIds.push(mine.id);
  ok("leader saves a private report", r.status === 201 && mine.shared === false && mine.canEdit && !mine.canPin);
  r = await leader.call("POST", "/production/reports/saved", { name: `E2E money ${stamp}`, config: { measures: ["money_khoan"] } });
  ok("leader cannot save a money report", r.status === 403);
  r = await leader.call("POST", "/production/reports/saved", { name: `E2E pin ${stamp}`, config: savedConfig, pinned: true });
  ok("leader cannot pin", r.status === 403);
  // PR-20: a shared report with money is the Admins' only
  r = await admin.call("POST", "/production/reports/saved", { name: `E2E money ${stamp}`, config: { dimensions: ["user"], measures: ["points", "money_khoan"], ...may }, shared: true });
  const moneyReport = r.body;
  if (moneyReport?.id) savedIds.push(moneyReport.id);
  ok("PR-20: admin shares a money report (flagged adminOnly)", r.status === 201 && moneyReport.shared === true && moneyReport.adminOnly === true, JSON.stringify(r.body?.error ?? ""));
  r = await leader.call("GET", "/production/reports/saved");
  ok("PR-20: … not listed for a LEADER", r.status === 200 && !r.body.items.some((item) => item.id === moneyReport.id) && r.body.items.every((item) => item.adminOnly === false));
  r = await leader.call("GET", `/production/reports/saved/${moneyReport.id}`);
  ok("PR-20: … nor openable (404)", r.status === 404);
  r = await admin.call("GET", "/production/reports/saved");
  ok("PR-20: … listed for Admins", r.body.items?.some((item) => item.id === moneyReport.id && item.adminOnly));
  r = await admin.call("GET", "/production/reports/saved");
  ok("private report hidden from others", r.status === 200 && !r.body.items.some((item) => item.id === mine.id));
  r = await admin.call("GET", `/production/reports/saved/${mine.id}`);
  ok("private report 404 for others", r.status === 404);
  r = await leader.call("PATCH", `/production/reports/saved/${mine.id}`, { shared: true, name: `E2E FB shared ${stamp}` });
  ok("owner shares it", r.status === 200 && r.body.shared && r.body.name === `E2E FB shared ${stamp}`);
  r = await admin.call("PATCH", `/production/reports/saved/${mine.id}`, { name: "hijack" });
  ok("admin cannot rename someone else's report", r.status === 403);
  r = await admin.call("PATCH", `/production/reports/saved/${mine.id}`, { pinned: true, pinOrder: 1 });
  ok("admin pins a shared report", r.status === 200 && r.body.pinned && r.body.canPin && !r.body.canEdit);
  r = await admin.call("POST", "/production/reports/saved", { name: `E2E bad ${stamp}`, config: { measures: ["points"], filters: { nope: [] } } });
  ok("saved config validated", r.status === 400);

  // Dashboards
  r = await staff.call("GET", "/production/dashboard/leader");
  ok("STAFF has no leader dashboard (403)", r.status === 403);
  r = await leader.call("GET", `/production/dashboard/leader?leaderId=${adminId}`);
  ok("leader cannot open another leader's dashboard", r.status === 403);
  const t0 = Date.now();
  r = await leader.call("GET", "/production/dashboard/leader");
  const leaderMs = Date.now() - t0;
  const dash = r.body;
  ok(
    "leader dashboard: late (red) and due soon (amber) of own jobs",
    r.status === 200 &&
      dash.late.some((task) => task.id === fx.overdue && task.minutes >= 55) &&
      dash.dueSoon.some((task) => task.id === fx.dueSoon) &&
      !dash.dueSoon.some((task) => task.id === fx.later) &&
      !dash.late.some((task) => task.id === fx.dueSoon),
    `${r.status} ${leaderMs}ms`
  );
  const load = dash.workload?.find((item) => item.user.id === staffId);
  ok("workload per worker (processing / not started)", load?.qtyProcessing >= 7 && load.qtyNotStarted >= 7 && load.teamId === fx.team, JSON.stringify(load));
  ok("team points per week: 8 aligned weeks", dash.teamPoints?.weeks.length === 8 && dash.teamPoints.series.every((item) => item.points.length === 8));

  const t1 = Date.now();
  r = await admin.call("GET", "/production/dashboard/admin");
  const adminMs = Date.now() - t1;
  const cards = r.body.cards;
  ok("admin dashboard: 6 cards with report configs", r.status === 200 && Object.keys(cards ?? {}).length === 6 && Object.values(cards).every((card) => card.config?.measures?.length > 0), `${adminMs}ms`);
  ok("admin dashboard: late job listed", cards?.lateJobs.items.some((item) => item.job.id === fx.liveJob && item.lateTaskCount >= 1));
  ok("admin dashboard: pinned saved report", r.body.pinned?.some((item) => item.id === mine.id));
  ok("admin dashboard: KPI buckets", cards?.kpiAttainment.buckets.length === 4 && cards.kpiAttainment.members >= cards.kpiAttainment.withoutTarget);
  // PR-09: "Job đang trễ" and the report it opens agree (same definition; archived jobs in neither)
  r = await query(admin, cards.lateJobs.config);
  const lateRows = (r.body.rows ?? []).filter((item) => item.late_count > 0);
  ok(
    "PR-09: the late-jobs card equals its report (jobs with late tasks, late task count)",
    r.status === 200 && r.body.totals.late_count === cards.lateJobs.taskCount && lateRows.length === cards.lateJobs.jobCount && cards.lateJobs.items.every((item) => lateRows.some((row) => row.job === item.job.id && row.late_count === item.lateTaskCount)),
    `${r.body.totals?.late_count}/${cards.lateJobs.taskCount} ${lateRows.length}/${cards.lateJobs.jobCount}`
  );
  ok(
    "PR-09: archived jobs are in neither",
    !cards.lateJobs.items.some((item) => item.job.id === fx.archivedJob) && !(r.body.rows ?? []).some((item) => item.job === fx.archivedJob) && cards.lateJobs.items.some((item) => item.job.id === fx.liveJob)
  );
  r = await query(admin, cards.fbRateByUser.config);
  ok("a card's config reproduces it", r.status === 200 && JSON.stringify(r.body.rows) === JSON.stringify(cards.fbRateByUser.result.rows));
  r = await leader.call("GET", "/production/dashboard/admin");
  ok("admin dashboard is ADMIN only", r.status === 403);
  ok("dashboards answer in < 3 s", leaderMs < 3000 && adminMs < 3000, `${leaderMs}ms / ${adminMs}ms`);

  // Anomalies
  r = await staff.call("GET", "/production/anomalies");
  ok("STAFF has no anomalies (403)", r.status === 403);
  r = await leader.call("GET", "/production/anomalies");
  const anomalies = r.body;
  const find = (kind, id) => anomalies.items?.find((item) => item.kind === kind && (item.task?.id === id || item.user?.id === id));
  const qty = find("QTY_MISMATCH", fx.qtyTask);
  ok("qty_done ≠ qty_assigned with who changed it", qty?.difference === -2 && qty.changedBy?.id === leaderId && qty.source === "CORRECTION", JSON.stringify(qty));
  ok("QC fail ≥ 2", find("QC_FAIL_REPEAT", fx.qcFailTask)?.qcFailCount === 2);
  const fast = find("FAST_DONE", fx.fastTask);
  ok("Done within 5 minutes of assignment", fast?.minutes === 2 && fast.task.jobId === fx.liveJob);
  const worker = find("WORKER_FAIL_RATE", staffId);
  ok("worker above the fail-rate threshold", worker?.qcFailedCount >= 1 && worker.qcFailRate > anomalies.threshold, JSON.stringify(worker));
  ok("no anomaly for tasks outside the window", !anomalies.items.some((item) => oldTasks.some((task) => task.id === item.task?.id)));

  r = await leader.call("POST", "/production/anomalies/review", { kind: "QTY_MISMATCH", key: qty?.key ?? "x" });
  ok("mark Đã xem", r.status === 200 && r.body.reviewedAt);
  r = await leader.call("GET", "/production/anomalies?kind=QTY_MISMATCH");
  ok("reviewed row hidden by default", r.status === 200 && !r.body.items.some((item) => item.task?.id === fx.qtyTask));
  r = await admin.call("GET", "/production/anomalies?kind=QTY_MISMATCH&includeReviewed=true");
  const reviewed = r.body.items?.find((item) => item.task?.id === fx.qtyTask);
  ok("ADMIN sees it with who reviewed", reviewed?.reviewed?.by?.id === leaderId);
  r = await leader.call("DELETE", `/production/anomalies/reviews?kind=QTY_MISMATCH&key=${encodeURIComponent(qty?.key ?? "x")}`);
  ok("undo Đã xem", r.status === 200 && r.body.reviewedAt === null);
  r = await leader.call("GET", "/production/anomalies?kind=QTY_MISMATCH");
  ok("row back after undo", r.body.items?.some((item) => item.task?.id === fx.qtyTask));
  r = await leader.call("POST", "/production/anomalies/review", { kind: "FAST_DONE", key: randomUUID() });
  ok("unknown subject → 404", r.status === 404);
  r = await leader.call("POST", "/production/anomalies/review", { kind: "FAST_DONE", key: "1; DROP TABLE x" });
  ok("malformed key → 400", r.status === 400);
  if (worker) {
    reviewedKeys.push(worker.key);
    r = await leader.call("POST", "/production/anomalies/review", { kind: "WORKER_FAIL_RATE", key: worker.key, note: "Đã nhắc" });
    ok("review a worker anomaly", r.status === 200);
  }

  // Excel exports
  let x = await download(admin, "POST", "/production/reports/export", { config: { dimensions: ["user"], measures: ["fb_rate", "task_count", "money_khoan"], ...may }, name: "FB tháng 5" });
  const data = x.workbook?.getWorksheet("Dữ liệu");
  const headers = data ? data.getRow(1).values.slice(1) : [];
  ok(
    "report export: xlsx with data + config sheets",
    x.status === 200 && x.type?.startsWith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") && x.workbook.getWorksheet("Cấu hình") && headers.join("|") === "Nhân viên|Tỉ lệ FB|Số task|Tiền khoán (VND)",
    `${x.status} ${headers.join("|")}`
  );
  ok(
    "report export filename: period + export day, RFC 5987",
    /filename="FB_thang_5_2019-05-01_2019-05-31_xuat_\d{4}-\d{2}-\d{2}\.xlsx"/.test(x.disposition ?? "") && x.disposition.includes("filename*=UTF-8''FB%20th%C3%A1ng%205%202019-05-01_2019-05-31%20%28xu%E1%BA%A5t%20"),
    x.disposition
  );
  const lastRow = data?.getRow(data.rowCount);
  ok("report export totals row", lastRow?.getCell(1).value === "Tổng cộng" && lastRow.getCell(3).value === 20);
  x = await download(leader, "POST", "/production/reports/export", { config: { measures: ["money_khoan"], ...may } });
  ok("LEADER cannot export money (403 JSON)", x.status === 403 && x.json?.error.code === "MONEY_FORBIDDEN");

  x = await download(leader, "GET", `/production/jobs/export?q=${encodeURIComponent(`e2erp${stamp.toLowerCase()}`)}`);
  const jobsSheet = x.workbook?.getWorksheet("Job");
  const codes = [];
  jobsSheet?.eachRow((sheetRow, index) => index > 1 && codes.push(sheetRow.getCell(1).value));
  ok("jobs export uses the job list filters", x.status === 200 && codes.length === 3 && codes.includes(`E2ERP${stamp} live`), JSON.stringify(codes));
  ok("formula injection neutralised", codes.includes(`'=HYPERLINK("http://x") E2ERP${stamp}`));
  ok("jobs export headers in Vietnamese", jobsSheet?.getRow(1).getCell(1).value === "Mã job" && jobsSheet.getRow(1).getCell(9).value === "Đã done");
  x = await download(staff, "GET", "/production/jobs/export");
  ok("jobs export follows job list permissions (STAFF 403)", x.status === 403);

  x = await download(leader, "GET", "/production/scores/board/export?period=2019-05");
  const board = x.workbook?.getWorksheet("Bảng điểm");
  const boardHeaders = board ? board.getRow(1).values.slice(1) : [];
  let staffPoints = null;
  let staffMoney = null;
  board?.eachRow((sheetRow, index) => {
    if (index > 1 && sheetRow.getCell(3).value === `E2E report team ${stamp}`) {
      staffPoints = sheetRow.getCell(4).value;
      staffMoney = sheetRow.getCell(7).value;
    }
  });
  // The leader's own row may carry its own money; a colleague's never does (unless money is public).
  ok(
    "score board export: colleague's points, not their money (LEADER)",
    x.status === 200 && boardHeaders.includes("Điểm chính thức") && staffPoints === 225 && (originalSettings.moneyPublic || staffMoney === null),
    `${boardHeaders.join("|")} ${staffPoints} ${staffMoney}`
  );
  x = await download(admin, "GET", "/production/scores/board/export?period=2019-05");
  ok("score board export: ADMIN sees money", x.status === 200 && x.workbook.getWorksheet("Bảng điểm").getRow(1).values.includes("Tiền khoán tạm tính (VND)"));
  await admin.call("PATCH", "/production/settings", { scoresPublic: false });
  x = await download(staff, "GET", "/production/scores/board/export?period=2019-05");
  ok("score board export hidden when scores are private", x.status === 403 && x.json?.error.code === "SCORES_PRIVATE");
  await admin.call("PATCH", "/production/settings", { scoresPublic: originalSettings.scoresPublic });

  x = await download(admin, "GET", "/production/kpi/export?from=2019-05&to=2019-05");
  ok("KPI export (ADMIN)", x.status === 200 && x.workbook.getWorksheet("KPI theo kỳ") && x.disposition.includes("KPI%20k%E1%BB%B3%202019-05"), `${x.status} ${x.disposition}`);
  x = await download(admin, "GET", "/production/kpi/export?from=2019-05");
  ok("KPI export validates its query", x.status === 400);

  // PR-17: the report's KPI period follows the CURRENT close day — like the board and the settlement
  await admin.call("PATCH", "/production/settings", { kpiCloseDay: 10 });
  r = await query(admin, { dimensions: ["period"], measures: ["points", "task_count"], ...may });
  const byPeriod = Object.fromEntries((r.body.rows ?? []).map((item) => [item.period, item]));
  ok(
    "PR-17: close day 10 → May 6–10 in 2019-05, May 13–17 in 2019-06, for scores and tasks alike",
    r.status === 200 && byPeriod["2019-05"]?.points === 125 && byPeriod["2019-05"].task_count === 10 && byPeriod["2019-06"]?.points === 105 && byPeriod["2019-06"].task_count === 10,
    JSON.stringify(r.body.rows)
  );
  const boardJune = (await admin.call("GET", "/production/scores/board?period=2019-06")).body;
  r = await query(admin, { dimensions: ["period", "user"], measures: ["points"], ...may });
  const juneStaff = r.body.rows?.find((item) => item.period === "2019-06" && item.user === staffId);
  ok("PR-17: … the same figure as the board's period", juneStaff?.points === boardJune.items?.find((item) => item.user.id === staffId)?.pointsOfficial && juneStaff.points === 105, JSON.stringify(juneStaff));
  await admin.call("PATCH", "/production/settings", { kpiCloseDay: originalSettings.kpiCloseDay });

  // Saved report delete
  r = await leader.call("DELETE", `/production/reports/saved/${mine.id}`);
  ok("owner deletes", r.status === 200 && r.body.deleted);
} finally {
  if (admin && originalSettings) {
    await admin.call("PATCH", "/production/settings", {
      scoresPublic: originalSettings.scoresPublic,
      moneyPublic: originalSettings.moneyPublic,
      kpiCloseDay: originalSettings.kpiCloseDay
    });
  }
  cleanup();
}
