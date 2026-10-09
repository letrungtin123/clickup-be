// Production KPI settlement — SPEC Phase 6: Admin (re-)runs with a reason, idempotent replacement of a period's
// rows, run history, own-row visibility, KPI_SETTLED notifications, close-day change, KPI report (settled +
// provisional, quarter/year rollups) and per-task score rows. Fixtures live in the 2019-03 / 2019-04 periods
// (local DB only) and are removed at the end; the ledger is bypassed with session_replication_role = replica.
import { randomUUID } from "node:crypto";

import { bumpAuthz, localSql, seed, session } from "./lib.mjs";
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

// Sessions first: if the API is down, fail before writing any fixture.
const admin = await session("MANAGER");
const leader = await session("MEMBER_A");
const staff = await session("MEMBER_B");
const outsider = await session("MEMBER_C");
const originalSettings = (await admin.call("GET", "/production/settings")).body;

// Removes this suite's fixtures, including leftovers of an interrupted run (prefix E2EKPI, periods 2019-01 … 2019-06).
const purge = () =>
  localSql(`
    BEGIN;
    SET LOCAL session_replication_role = replica; -- the score ledger is immutable by trigger; fixtures only
    CREATE TEMP TABLE e2e_jobs ON COMMIT DROP AS
      SELECT j.id FROM production.jobs j JOIN production.projects p ON p.id = j.project_id
      WHERE p.organization_id = '${orgId}' AND p.code LIKE 'E2EKPI%';
    DELETE FROM production.score_entries WHERE job_id IN (SELECT id FROM e2e_jobs);
    DELETE FROM production.task_logs WHERE job_id IN (SELECT id FROM e2e_jobs);
    DELETE FROM production.tasks WHERE job_id IN (SELECT id FROM e2e_jobs);
    DELETE FROM production.jobs WHERE id IN (SELECT id FROM e2e_jobs);
    DELETE FROM production.projects WHERE organization_id = '${orgId}' AND code LIKE 'E2EKPI%';
    COMMIT;
    DELETE FROM production.kpi_settlements WHERE organization_id = '${orgId}' AND period_month BETWEEN '2019-01-01' AND '2019-06-01';
    DELETE FROM production.kpi_settlement_runs WHERE organization_id = '${orgId}' AND period_month BETWEEN '2019-01-01' AND '2019-06-01';
    DELETE FROM production.kpi_targets WHERE organization_id = '${orgId}' AND effective_from BETWEEN '2019-01-01' AND '2019-06-01';
    DELETE FROM public.notifications WHERE organization_id = '${orgId}' AND type = 'production.kpi_settled' AND payload->>'period' LIKE '2019-0%';
  `);
purge();

const stamp = Date.now().toString(36).toUpperCase();
const fx = { project: randomUUID(), job: randomUUID(), tB1: randomUUID(), tB2: randomUUID(), tB3: randomUUID(), tA1: randomUUID(), tA2: randomUUID(), tB5: randomUUID() };
const lookup = `
  (SELECT id FROM production.processes WHERE organization_id = '${orgId}' AND name = 'Normal Retouch') AS normal,
  (SELECT id FROM production.processes WHERE organization_id = '${orgId}' AND is_qc AND active LIMIT 1) AS checking,
  (SELECT id FROM production.shifts WHERE organization_id = '${orgId}' AND pay_mode = 'POINTS' AND NOT requires_ot_hours ORDER BY sort_order LIMIT 1) AS official,
  (SELECT id FROM production.shifts WHERE organization_id = '${orgId}' AND pay_mode = 'MONEY_IF_KPI' ORDER BY sort_order LIMIT 1) AS khoan,
  (SELECT id FROM production.statuses WHERE organization_id = '${orgId}' AND code = 'CHECKED') AS checked`;
// One original ledger row: [user, task, role, payMode, process, shift, unitCredits, unitMoney, qty, day, period].
const insertEntries = (rows) => `
  INSERT INTO production.score_entries (organization_id, user_id, task_id, job_id, project_id, process_id, shift_id, role, pay_mode, kind,
    unit_credits, unit_money, qty, credits, money, business_day, period_month, created_at)
  SELECT '${orgId}', e.user_id::uuid, e.task_id::uuid, '${fx.job}', '${fx.project}',
    CASE e.process WHEN 'checking' THEN l.checking ELSE l.normal END, CASE e.shift WHEN 'khoan' THEN l.khoan ELSE l.official END,
    e.role, e.pay_mode, 'NORMAL', e.unit, e.unit_money, e.qty, e.unit * e.qty, e.unit_money * e.qty, e.day::date, e.period::date,
    (e.day || 'T10:00:00+07:00')::timestamptz
  FROM (SELECT ${lookup}) l, (VALUES
    ${rows
      .map(
        ([user, task, role, payMode, process, shift, unit, unitMoney, qty, day, period]) =>
          `('${user}', '${task}', '${role}', '${payMode}', '${process}', '${shift}', ${unit}::numeric, ${unitMoney}::bigint, ${qty}::int, '${day}', '${period}')`
      )
      .join(",\n    ")}
  ) AS e(user_id, task_id, role, pay_mode, process, shift, unit, unit_money, qty, day, period);`;

localSql(`
  BEGIN;
  INSERT INTO production.projects (id, organization_id, code, name) VALUES ('${fx.project}', '${orgId}', 'E2EKPI${stamp}', 'E2E KPI ${stamp}');
  INSERT INTO production.jobs (id, organization_id, project_id, code, leader_id, deadline, total_images, created_by)
  VALUES ('${fx.job}', '${orgId}', '${fx.project}', 'E2EKPI${stamp} job', '${leaderId}', '2019-03-20T18:00:00+07:00', 200, '${leaderId}');
  INSERT INTO production.tasks (id, organization_id, job_id, assignee_id, qc_id, process_id, shift_id, qty_assigned, qty_done, deadline, status_id, created_by)
  SELECT v.id::uuid, '${orgId}', '${fx.job}', v.assignee::uuid, v.qc::uuid, l.normal, CASE WHEN v.khoan THEN l.khoan ELSE l.official END,
         v.qty, v.qty, '2019-03-20T18:00:00+07:00', l.checked, '${leaderId}'
  FROM (SELECT ${lookup}) l, (VALUES
    ('${fx.tB1}', '${staffId}', '${leaderId}', false, 40), ('${fx.tB2}', '${staffId}', '${leaderId}', true, 10),
    ('${fx.tB3}', '${staffId}', '${leaderId}', false, 50), ('${fx.tA1}', '${leaderId}', '${staffId}', false, 20),
    ('${fx.tA2}', '${leaderId}', NULL, true, 10), ('${fx.tB5}', '${staffId}', '${leaderId}', false, 10)
  ) AS v(id, assignee, qc, khoan, qty);
  ${insertEntries([
    // B (STAFF): official 120, Khoán 30 credits / 150 000 → target 100 → met (SPEC §8.6 case 1).
    [staffId, fx.tB1, "WORKER", "POINTS", "normal", "official", 3, 0, 40, "2019-03-04", "2019-03-01"],
    [staffId, fx.tB2, "WORKER", "MONEY_IF_KPI", "normal", "khoan", 3, 15000, 10, "2019-03-22", "2019-03-01"],
    // A (LEADER+QC): official 60 worker + 20 QC = 80, Khoán 30 / 150 000 → not met, 30 converted, total 110 (case 2).
    [leaderId, fx.tA1, "WORKER", "POINTS", "normal", "official", 3, 0, 20, "2019-03-06", "2019-03-01"],
    [leaderId, fx.tB1, "QC", "POINTS", "checking", "official", 0.5, 0, 40, "2019-03-06", "2019-03-01"],
    [leaderId, fx.tA2, "WORKER", "MONEY_IF_KPI", "normal", "khoan", 3, 15000, 10, "2019-03-07", "2019-03-01"],
    // B in the next period (26/03 → kỳ 04/2019).
    [staffId, fx.tB3, "WORKER", "POINTS", "normal", "official", 1, 0, 50, "2019-03-26", "2019-04-01"]
  ])}
  INSERT INTO production.kpi_targets (organization_id, user_id, period_type, target_points, effective_from)
  VALUES ('${orgId}', '${staffId}', 'MONTH', 100, '2019-03-01'), ('${orgId}', '${leaderId}', 'MONTH', 100, '2019-03-01'),
         ('${orgId}', '${staffId}', 'QUARTER', 300, '2019-01-01');
  COMMIT;
`);

const cleanup = purge;

const run = (who, period, reason) => who.call("POST", "/production/kpi/settlements/run", { period, reason });
const byUser = (items, userId) => items?.find((item) => item.user.id === userId);
const waitFor = async (s, predicate) => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const found = (await s.call("GET", "/notifications?types=production.kpi_settled&limit=50")).body.items?.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
};

try {
  // Access
  let r = await outsider.call("GET", "/production/kpi/settlements?period=2019-03");
  ok("non-member gets 404", r.status === 404);
  r = await run(staff, "2019-03", "thử chốt");
  ok("STAFF cannot run a settlement (403)", r.status === 403);
  r = await staff.call("GET", "/production/kpi/settlement-runs");
  ok("STAFF cannot read the run history (403)", r.status === 403);
  r = await admin.call("POST", "/production/kpi/settlements/run", { period: "2019-03" });
  ok("reason required (400)", r.status === 400);
  r = await run(admin, "2019-03", "ab");
  ok("reason of at least 3 characters (400)", r.status === 400);
  r = await run(admin, "2031-01", "kỳ tương lai");
  ok("future period rejected (400)", r.status === 400 && r.body.error.code === "KPI_PERIOD_NOT_STARTED");

  // Report before any run: provisional figures
  r = await staff.call("GET", "/production/kpi/report?from=2019-03&to=2019-04");
  let mar = r.body.rows?.find((row) => row.period === "2019-03");
  let apr = r.body.rows?.find((row) => row.period === "2019-04");
  ok(
    "report before settlement is provisional (own rows only)",
    r.status === 200 && r.body.users.length === 1 && r.body.users[0].user.id === staffId && mar?.settled === false && mar.totalPoints === 120 && mar.khoanMoney === 150000 && apr?.totalPoints === 50 && apr.met === false,
    JSON.stringify(r.body?.rows ?? r.body)
  );

  // First run (SPEC §8.6 cases 1 and 2)
  r = await run(admin, "2019-03", "E2E chốt thử");
  const run1 = r.body.run;
  ok(
    "admin run: counts and history fields",
    r.status === 200 && run1.userCount === 2 && run1.metCount === 1 && run1.notMetCount === 1 && run1.khoanMoneyTotal === 150000 && run1.khoanPointsConvertedTotal === 30 && run1.trigger === "MANUAL" && run1.runBy?.id === adminId && run1.reason === "E2E chốt thử" && run1.current && run1.replacedCount === 0 && run1.from === "2019-02-26" && run1.to === "2019-03-25",
    JSON.stringify(r.body?.run ?? r.body)
  );
  let b = byUser(r.body.items, staffId);
  let a = byUser(r.body.items, leaderId);
  ok("target 100 / official 120 / Khoán 30 → met, money 150 000, converted 0", b?.met === true && b.khoanMoney === 150000 && b.khoanPointsConverted === 0 && b.totalPoints === 120 && b.difference === 20, JSON.stringify(b));
  ok("target 100 / official 80 / Khoán 30 → not met, money 0, converted 30, total 110", a?.met === false && a.khoanMoney === 0 && a.khoanPointsConverted === 30 && a.totalPoints === 110 && a.percent === 110 && a.difference === 10, JSON.stringify(a));

  // Re-run: same result, rows replaced (no duplicates), history kept
  r = await run(admin, "2019-03", "E2E chạy lại");
  const run2 = r.body.run;
  ok("re-run gives the same result and replaces the rows", run2.replacedCount === 2 && run2.metCount === 1 && byUser(r.body.items, leaderId)?.totalPoints === 110 && byUser(r.body.items, staffId)?.khoanMoney === 150000);
  ok("no duplicate rows", localSql(`SELECT count(*) FROM production.kpi_settlements WHERE organization_id = '${orgId}' AND period_month = '2019-03-01';`)[0] === "2");
  r = await admin.call("GET", "/production/kpi/settlement-runs?period=2019-03");
  ok("run history keeps both runs, the newest is current", r.status === 200 && r.body.items.length === 2 && r.body.items[0].id === run2.id && r.body.items[0].current && !r.body.items[1].current, JSON.stringify(r.body?.items?.map((item) => [item.reason, item.current])));

  // Visibility of settlement rows
  r = await staff.call("GET", "/production/kpi/settlements?period=2019-03");
  ok("a member sees only their own row, with their money, and no run", r.status === 200 && r.body.items.length === 1 && r.body.items[0].user.id === staffId && r.body.items[0].khoanMoney === 150000 && r.body.run === null);
  r = await leader.call("GET", "/production/kpi/settlements?period=2019-03");
  ok("LEADER sees own row only", r.body.items.length === 1 && r.body.items[0].user.id === leaderId && r.body.items[0].khoanMoney === 0 && r.body.items[0].khoanMoneyRaw === 150000);
  r = await admin.call("GET", "/production/kpi/settlements?period=2019-03");
  ok("ADMIN sees every row and the current run", r.body.items.length === 2 && r.body.run?.id === run2.id);

  // Notifications (worker): each settled person + one summary for admins
  const own = await waitFor(staff, (item) => item.payload.runId === run2.id);
  ok("settled person notified with the result", own?.payload.period === "2019-03" && own.payload.met === true && own.payload.points === 120 && own.payload.target === 100, own ? "" : "(none)");
  const leaderNote = await waitFor(leader, (item) => item.payload.runId === run2.id);
  ok("not-met person notified", leaderNote?.payload.met === false && leaderNote.payload.khoanPointsConverted === 30, leaderNote ? "" : "(none)");
  const summary = await waitFor(admin, (item) => item.payload.runId === run2.id && item.payload.summary === true);
  ok("admins get one summary per run", summary?.payload.settled === 2 && summary.payload.met === 1, summary ? "" : "(none)");

  // Data changes → an Admin re-run reflects them
  localSql(`${insertEntries([[leaderId, fx.tB5, "QC", "POINTS", "checking", "official", 2.5, 0, 10, "2019-03-08", "2019-03-01"]])}`);
  r = await run(admin, "2019-03", "Bổ sung điểm QC");
  a = byUser(r.body.items, leaderId);
  ok("re-run after new points: A now meets the KPI (105 ≥ 100) and gets the Khoán money", a?.met === true && a.pointsOfficial === 105 && a.khoanMoney === 150000 && a.khoanPointsConverted === 0 && r.body.run.metCount === 2);

  // Close day 20: the period becomes 21/02–20/03 and B's Khoán work of 22/03 moves to the next period
  await admin.call("PATCH", "/production/settings", { kpiCloseDay: 20 });
  r = await run(admin, "2019-03", "Thử ngày chốt 20");
  b = byUser(r.body.items, staffId);
  ok("close day 20 shifts the period", r.body.run?.from === "2019-02-21" && r.body.run.to === "2019-03-20" && r.body.run.closeDay === 20 && b?.khoanCredits === 0 && b.khoanMoney === 0 && b.pointsOfficial === 120, JSON.stringify(r.body?.run));
  await admin.call("PATCH", "/production/settings", { kpiCloseDay: originalSettings.kpiCloseDay });
  r = await run(admin, "2019-03", "Trả lại ngày chốt 25");
  ok("back to close day 25", r.body.run?.to === "2019-03-25" && byUser(r.body.items, staffId)?.khoanMoney === 150000);

  // KPI report: settled month + provisional month, rollups
  r = await admin.call("GET", "/production/kpi/report?from=2019-03&to=2019-04");
  mar = r.body.rows?.find((row) => row.period === "2019-03" && row.userId === staffId);
  apr = r.body.rows?.find((row) => row.period === "2019-04" && row.userId === staffId);
  ok("report: settled March + provisional April", r.status === 200 && mar?.settled === true && mar.totalPoints === 120 && apr?.settled === false && apr.totalPoints === 50, JSON.stringify(r.body?.rows));
  ok("report: ADMIN sees others' money", r.body.rows.find((row) => row.userId === leaderId && row.period === "2019-03")?.khoanMoney === 150000);
  const roll = (periodType, key) => r.body.rollups.find((item) => item.userId === staffId && item.periodType === periodType && item.key === key);
  ok("quarter with an explicit QUARTER target", roll("QUARTER", "2019-Q1")?.explicitTarget === true && roll("QUARTER", "2019-Q1").target === 300 && roll("QUARTER", "2019-Q1").percent === 40, JSON.stringify(roll("QUARTER", "2019-Q1")));
  ok("a QUARTER version keeps applying to later quarters", roll("QUARTER", "2019-Q2")?.explicitTarget === true && roll("QUARTER", "2019-Q2").target === 300 && roll("QUARTER", "2019-Q2").totalPoints === 50);
  const leaderQ1 = r.body.rollups.find((item) => item.userId === leaderId && item.periodType === "QUARTER" && item.key === "2019-Q1");
  ok("quarter without a QUARTER target sums the monthly targets", leaderQ1?.explicitTarget === false && leaderQ1.target === 100 && leaderQ1.totalPoints === 105, JSON.stringify(leaderQ1));
  ok("year = sum of the months", roll("YEAR", "2019")?.periods.join() === "2019-03,2019-04" && roll("YEAR", "2019").totalPoints === 170 && roll("YEAR", "2019").target === 200 && roll("YEAR", "2019").percent === 85);
  r = await leader.call("GET", "/production/kpi/report?from=2019-03&to=2019-04");
  ok("a member's report holds only their rows", r.status === 200 && r.body.rows.every((row) => row.userId === leaderId) && r.body.users.length === 1);
  r = await admin.call("GET", "/production/kpi/report?from=2019-05&to=2019-03");
  ok("reversed report range rejected (400)", r.status === 400);
  r = await admin.call("GET", "/production/kpi/report?from=2017-01&to=2019-04");
  ok("report range over 24 periods rejected (400)", r.status === 400);

  // Per-task score rows (task detail)
  r = await staff.call("GET", `/production/scores/task/${fx.tB2}`);
  ok("assignee sees own Khoán money on the task", r.status === 200 && r.body.items.length === 1 && r.body.items[0].money === 150000 && r.body.items[0].user.id === staffId && r.body.totals[0].credits === 30);
  r = await leader.call("GET", `/production/scores/task/${fx.tB2}`);
  ok("others see points but not money", r.status === 200 && r.body.items[0].money === null && r.body.items[0].credits === 30 && r.body.moneyVisible === false && r.body.items[0].user.email === null);
  r = await admin.call("GET", `/production/scores/task/${fx.tB1}`);
  ok("ADMIN sees worker + QC rows of a task with money", r.status === 200 && r.body.moneyVisible && r.body.items.length === 2 && r.body.totals.find((t) => t.role === "QC")?.credits === 20 && r.body.totals.find((t) => t.role === "WORKER")?.qty === 40);
  r = await outsider.call("GET", `/production/scores/task/${fx.tB1}`);
  ok("non-member gets 404 on task scores", r.status === 404);
  r = await staff.call("GET", `/production/scores/task/${fx.tA1}`);
  ok("the task's QC sees its rows", r.status === 200 && r.body.items.length === 1 && r.body.items[0].money === null);
  r = await staff.call("GET", `/production/scores/task/${fx.tA2}`);
  ok("STAFF cannot see an unrelated task (404)", r.status === 404);
  r = await admin.call("GET", `/production/scores/task/${randomUUID()}`);
  ok("unknown task (404)", r.status === 404);
} finally {
  await admin.call("PATCH", "/production/settings", { kpiCloseDay: originalSettings.kpiCloseDay });
  cleanup();
}
