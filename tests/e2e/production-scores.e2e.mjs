// Production scores & KPI — SPEC Phase 3 read/admin endpoints: personal scores, forecast, public board
// (points public, money private), KPI targets (matrix, PUT, CSV import all-or-nothing, defaults by role).
// Score fixtures are inserted directly (local DB only) in the 2019-12 … 2020-12 periods so totals are exact;
// the workflow → score path is covered by the scoring-hook checks and the jobs suite.
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

// Removes this suite's fixtures, including leftovers of an interrupted run (prefix E2ESC, E2E periods 2019–2020).
const purge = () =>
  localSql(`
    BEGIN;
    SET LOCAL session_replication_role = replica; -- the score ledger is immutable by trigger; fixtures only
    CREATE TEMP TABLE e2e_jobs ON COMMIT DROP AS
      SELECT j.id FROM production.jobs j JOIN production.projects p ON p.id = j.project_id
      WHERE p.organization_id = '${orgId}' AND p.code LIKE 'E2ESC%';
    DELETE FROM production.score_entries WHERE job_id IN (SELECT id FROM e2e_jobs);
    DELETE FROM production.task_logs WHERE job_id IN (SELECT id FROM e2e_jobs);
    DELETE FROM production.tasks WHERE job_id IN (SELECT id FROM e2e_jobs);
    DELETE FROM production.jobs WHERE id IN (SELECT id FROM e2e_jobs);
    DELETE FROM production.projects WHERE organization_id = '${orgId}' AND code LIKE 'E2ESC%';
    COMMIT;
    UPDATE production.member_profiles SET team_id = NULL
    WHERE organization_id = '${orgId}' AND team_id IN (SELECT id FROM production.teams WHERE organization_id = '${orgId}' AND name LIKE 'E2E scores team%');
    DELETE FROM production.teams WHERE organization_id = '${orgId}' AND name LIKE 'E2E scores team%';
    DELETE FROM production.kpi_targets WHERE organization_id = '${orgId}' AND effective_from BETWEEN '2019-01-01' AND '2020-12-01';
  `);
purge();
const previousTeam = localSql(`SELECT coalesce(team_id::text, '') FROM production.member_profiles WHERE organization_id = '${orgId}' AND user_id = '${staffId}';`)[0] ?? "";

// Fixture rows (explicit ids so cleanup is exact).
const stamp = Date.now().toString(36).toUpperCase();
const fx = {
  project: randomUUID(),
  team: randomUUID(),
  job: randomUUID(),
  tB1: randomUUID(),
  tB2: randomUUID(),
  tB3: randomUUID(),
  tA1: randomUUID(),
  eB1: randomUUID(),
  eA1qc: randomUUID()
};
const lookup = `
  (SELECT id FROM production.processes WHERE organization_id = '${orgId}' AND name = 'Normal Retouch') AS normal,
  (SELECT id FROM production.processes WHERE organization_id = '${orgId}' AND is_qc AND active LIMIT 1) AS checking,
  (SELECT id FROM production.shifts WHERE organization_id = '${orgId}' AND pay_mode = 'POINTS' AND NOT requires_ot_hours ORDER BY sort_order LIMIT 1) AS official,
  (SELECT id FROM production.shifts WHERE organization_id = '${orgId}' AND pay_mode = 'MONEY_IF_KPI' ORDER BY sort_order LIMIT 1) AS khoan,
  (SELECT id FROM production.statuses WHERE organization_id = '${orgId}' AND code = 'CHECKED') AS checked`;
// One ledger row: [id, user, task, role, payMode, process, shift, unitCredits, unitMoney, qty, day, period, adjustsEntryId?].
const insertEntries = (rows) => `
  INSERT INTO production.score_entries (id, organization_id, user_id, task_id, job_id, project_id, process_id, shift_id, role, pay_mode, kind,
    unit_credits, unit_money, qty, credits, money, business_day, period_month, adjusts_entry_id, created_at)
  SELECT e.id::uuid, '${orgId}', e.user_id::uuid, e.task_id::uuid, '${fx.job}', '${fx.project}',
    CASE e.process WHEN 'checking' THEN l.checking ELSE l.normal END, CASE e.shift WHEN 'khoan' THEN l.khoan ELSE l.official END,
    e.role, e.pay_mode, 'NORMAL', e.unit, e.unit_money, e.qty, e.unit * e.qty, e.unit_money * e.qty, e.day::date, e.period::date,
    e.adjusts::uuid, (e.day || 'T10:00:00+07:00')::timestamptz
  FROM (SELECT ${lookup}) l, (VALUES
    ${rows
      .map(
        ([id, user, task, role, payMode, process, shift, unit, unitMoney, qty, day, period, adjusts]) =>
          `('${id}', '${user}', '${task}', '${role}', '${payMode}', '${process}', '${shift}', ${unit}::numeric, ${unitMoney}::bigint, ${qty}::int, '${day}', '${period}', ${adjusts ? `'${adjusts}'` : "NULL"})`
      )
      .join(",\n    ")}
  ) AS e(id, user_id, task_id, role, pay_mode, process, shift, unit, unit_money, qty, day, period, adjusts);`;

localSql(`
  BEGIN;
  INSERT INTO production.projects (id, organization_id, code, name) VALUES ('${fx.project}', '${orgId}', 'E2ESC${stamp}', 'E2E scores ${stamp}');
  INSERT INTO production.teams (id, organization_id, name) VALUES ('${fx.team}', '${orgId}', 'E2E scores team ${stamp}');
  INSERT INTO production.member_profiles (organization_id, user_id, team_id) VALUES ('${orgId}', '${staffId}', '${fx.team}')
  ON CONFLICT (organization_id, user_id) DO UPDATE SET team_id = EXCLUDED.team_id;
  INSERT INTO production.jobs (id, organization_id, project_id, code, leader_id, deadline, total_images, created_by)
  VALUES ('${fx.job}', '${orgId}', '${fx.project}', 'E2ESC${stamp} job', '${leaderId}', '2020-03-20T18:00:00+07:00', 40, '${leaderId}');
  INSERT INTO production.tasks (id, organization_id, job_id, assignee_id, qc_id, process_id, shift_id, qty_assigned, qty_done, deadline, status_id, created_by)
  SELECT v.id::uuid, '${orgId}', '${fx.job}', v.assignee::uuid, v.qc::uuid, l.normal, CASE WHEN v.khoan THEN l.khoan ELSE l.official END,
         v.qty, v.qty, '2020-03-20T18:00:00+07:00', l.checked, '${leaderId}'
  FROM (SELECT ${lookup}) l, (VALUES
    ('${fx.tB1}', '${staffId}', '${leaderId}', false, 8), ('${fx.tB2}', '${staffId}', '${leaderId}', true, 10),
    ('${fx.tB3}', '${staffId}', '${leaderId}', false, 7), ('${fx.tA1}', '${leaderId}', '${staffId}', false, 4)
  ) AS v(id, assignee, qc, khoan, qty);
  ${insertEntries([
    [fx.eB1, staffId, fx.tB1, "WORKER", "POINTS", "normal", "official", 3, 0, 10, "2020-03-02", "2020-03-01"],
    [randomUUID(), staffId, fx.tB2, "WORKER", "MONEY_IF_KPI", "normal", "khoan", 3, 15000, 10, "2020-03-03", "2020-03-01"],
    [fx.eA1qc, leaderId, fx.tB1, "QC", "POINTS", "checking", "official", 0.5, 0, 10, "2020-03-04", "2020-03-01"],
    [randomUUID(), leaderId, fx.tA1, "WORKER", "POINTS", "normal", "official", 3, 0, 4, "2020-03-06", "2020-03-01"],
    [randomUUID(), staffId, fx.tA1, "QC", "POINTS", "checking", "official", 0.5, 0, 4, "2020-03-06", "2020-03-01"],
    [randomUUID(), staffId, fx.tB3, "WORKER", "POINTS", "normal", "official", 1, 0, 7, "2020-02-20", "2020-02-01"]
  ])}
  -- The Leader corrected tB1 from 10 to 8 images: adjustment rows (deltas) pointing at the originals.
  ${insertEntries([
    [randomUUID(), staffId, fx.tB1, "WORKER", "POINTS", "normal", "official", 3, 0, -2, "2020-03-05", "2020-03-01", fx.eB1],
    [randomUUID(), leaderId, fx.tB1, "QC", "POINTS", "checking", "official", 0.5, 0, -2, "2020-03-05", "2020-03-01", fx.eA1qc]
  ])}
  COMMIT;
`);

const cleanup = () => {
  purge();
  localSql(`UPDATE production.member_profiles SET team_id = ${previousTeam ? `'${previousTeam}'` : "NULL"} WHERE organization_id = '${orgId}' AND user_id = '${staffId}';`);
};

try {
  // Visibility
  let r = await outsider.call("GET", "/production/scores/me");
  ok("non-member gets 404 on scores", r.status === 404 && r.body.error.code === "PRODUCTION_NOT_FOUND", r.body?.error?.code);
  r = await outsider.call("GET", "/production/scores/board");
  ok("non-member gets 404 on the board", r.status === 404);

  // Personal scores
  r = await staff.call("GET", "/production/scores/me?from=2020-02-26&to=2020-03-25");
  const s = r.body.summary;
  ok(
    "STAFF own summary (official 30−6+2, Khoán 30 / 150 000)",
    r.status === 200 && s.pointsOfficial === 26 && s.pointsKhoan === 30 && s.moneyKhoanProvisional === 150000 && s.qtyKhoan === 10 && s.qcPoints === 2,
    JSON.stringify(s && { ...s, byDay: undefined, byProject: undefined })
  );
  ok("entries of the range only (Feb period excluded), newest first", r.body.entries?.length === 4 && r.body.entries[0].businessDay === "2020-03-06", JSON.stringify(r.body.entries?.map((e) => e.businessDay)));
  const adjustment = r.body.entries?.find((e) => e.adjustsEntryId);
  ok("adjustment row carries the delta and points at the original", adjustment?.qty === -2 && adjustment.credits === -6 && adjustment.adjustsEntryId === fx.eB1);
  const khoanEntry = r.body.entries?.find((e) => e.payMode === "MONEY_IF_KPI");
  ok("entry has task link, owner sees own money", khoanEntry?.task.id === fx.tB2 && khoanEntry.task.jobCode === `E2ESC${stamp} job` && khoanEntry.money === 150000 && khoanEntry.period === "2020-03");
  ok("byDay covers every day of the range", s.byDay.length === 29 && s.byDay.find((d) => d.day === "2020-03-05").pointsOfficial === -6);
  ok("byProject (worker qty 10 − 2 + 10)", s.byProject.length === 1 && s.byProject[0].qty === 18 && s.byProject[0].pointsKhoan === 30);
  r = await staff.call("GET", "/production/scores/me");
  ok("default range = current period, with today/week/period cards", r.status === 200 && r.body.from <= r.body.today && r.body.today <= r.body.to && typeof r.body.cards.week.pointsOfficial === "number" && r.body.cards.period.period.length === 7);
  r = await staff.call("GET", "/production/scores/me?from=2020-03-10&to=2020-02-01");
  ok("reversed range rejected (400)", r.status === 400 && r.body.error.code === "INVALID_RANGE");
  r = await staff.call("GET", "/production/scores/me?from=2019-01-01&to=2020-03-25");
  ok("range over 366 days rejected (400)", r.status === 400);
  r = await staff.call("GET", "/production/scores/me?from=2020-02-30&to=2020-03-25");
  ok("invalid day rejected (400)", r.status === 400);

  // Forecast without target
  r = await staff.call("GET", "/production/scores/forecast?period=2020-03");
  ok("forecast without target", r.status === 200 && r.body.target === null && r.body.tone === "NO_TARGET" && r.body.pointsOfficial === 26 && r.body.daysLeft === 0 && r.body.from === "2020-02-26", JSON.stringify(r.body));

  // KPI targets (ADMIN)
  r = await staff.call("GET", "/production/kpi-targets?year=2020");
  ok("STAFF cannot read KPI targets (403)", r.status === 403);
  r = await staff.call("PUT", "/production/kpi-targets", { items: [{ userId: staffId, effectiveFrom: "2020-02", targetPoints: 1 }] });
  ok("STAFF cannot set KPI targets (403)", r.status === 403);
  r = await admin.call("PUT", "/production/kpi-targets", {
    items: [
      { userId: staffId, effectiveFrom: "2020-02", targetPoints: 100 },
      { userId: staffId, periodType: "QUARTER", effectiveFrom: "2020-01", targetPoints: 250 }
    ]
  });
  ok("admin sets MONTH + QUARTER targets", r.status === 200 && r.body.items.length === 2 && r.body.items.every((item) => item.updatedBy?.id === adminId), JSON.stringify(r.body));
  r = await admin.call("PUT", "/production/kpi-targets", { items: [{ userId: staffId, effectiveFrom: "2020-02", targetPoints: 120 }] });
  r = await admin.call("PUT", "/production/kpi-targets", { items: [{ userId: staffId, effectiveFrom: "2020-02", targetPoints: 100 }] });
  ok("same start replaces the version", r.status === 200 && r.body.items[0].targetPoints === 100);
  r = await admin.call("PUT", "/production/kpi-targets", { items: [{ userId: staffId, periodType: "QUARTER", effectiveFrom: "2020-02", targetPoints: 1 }] });
  ok("misaligned quarter rejected (400)", r.status === 400 && r.body.error.code === "KPI_PERIOD_INVALID");
  r = await admin.call("PUT", "/production/kpi-targets", { items: [{ userId: randomUUID(), effectiveFrom: "2020-02", targetPoints: 1 }] });
  ok("unknown member rejected (404)", r.status === 404);
  r = await admin.call("PUT", "/production/kpi-targets", { items: [{ userId: staffId, effectiveFrom: "2020-02", targetPoints: -1 }] });
  ok("negative target rejected (400)", r.status === 400);

  r = await staff.call("GET", "/production/scores/forecast?period=2020-03");
  ok(
    "forecast with target: remaining, closed period",
    r.body.target === 100 && r.body.remaining === 74 && r.body.avgPerDayNeeded === null && r.body.tone === "BEHIND" && r.body.percent === 26 && r.body.pointsKhoan === 30 && r.body.moneyKhoanProvisional === 150000,
    JSON.stringify(r.body)
  );
  ok("KPI month / quarter (explicit) / year (sum of months)", r.body.kpi.month.target === 100 && r.body.kpi.quarter.points === 33 && r.body.kpi.quarter.target === 250 && r.body.kpi.quarter.percent === 13.2 && r.body.kpi.year.target === 1100 && r.body.kpi.year.percent === 3, JSON.stringify(r.body.kpi));
  ok("prorate flag exposed (leave days not wired yet)", typeof r.body.prorateLeave === "boolean" && r.body.leaveDays === null);

  const row = (matrix, userId) => matrix.rows.find((item) => item.user.id === userId);
  r = await admin.call("GET", "/production/kpi-targets?year=2020");
  let staffRow = row(r.body, staffId);
  ok(
    "matrix: inherited vs explicit cells, quarter cell, history",
    r.status === 200 && r.body.periods.length === 12 && staffRow?.months[0].targetPoints === null && staffRow.months[1].explicit && staffRow.months[2].targetPoints === 100 && !staffRow.months[2].explicit && staffRow.quarters[0].targetPoints === 250 && r.body.history.filter((h) => h.userId === staffId).length === 2,
    JSON.stringify(staffRow?.months.slice(0, 3))
  );

  // CSV import: all-or-nothing with line numbers
  r = await admin.call("POST", "/production/kpi-targets/import", {
    csv: `user_email,target\n${email("MEMBER_B")},2.600\nnobody.${stamp.toLowerCase()}@nowhere.test,100\n${email("MEMBER_B").toUpperCase()},2400\n${email("MEMBER_A")},abc\n`,
    period: "2020-04"
  });
  ok("bad CSV: format errors by line, nothing written", r.status === 200 && r.body.ok === false && r.body.errors.map((e) => e.line).join() === "4,5", JSON.stringify(r.body));
  r = await admin.call("POST", "/production/kpi-targets/import", { csv: `user_email,target\n${email("MEMBER_B")},2600\nnobody.${stamp.toLowerCase()}@nowhere.test,100\n`, period: "2020-04" });
  ok("unknown email reported by line, nothing written", r.body.ok === false && r.body.errors.map((e) => e.line).join() === "3", JSON.stringify(r.body));
  r = await admin.call("GET", "/production/kpi-targets?year=2020");
  ok("rejected imports left targets untouched", row(r.body, staffId).months[3].targetPoints === 100 && !row(r.body, staffId).months[3].explicit);
  r = await admin.call("POST", "/production/kpi-targets/import", { csv: `user_email,target\n${email("MEMBER_B")},2.600\n${email("MEMBER_A")},"1,848"\n`, period: "2020-04" });
  ok("valid import", r.body.ok === true && r.body.imported === 2, JSON.stringify(r.body));
  r = await admin.call("GET", "/production/kpi-targets?year=2020");
  staffRow = row(r.body, staffId);
  ok("imported versions effective from 2020-04", staffRow.months[3].targetPoints === 2600 && staffRow.months[3].explicit && row(r.body, leaderId).months[3].targetPoints === 1848);
  r = await admin.call("POST", "/production/kpi-targets/import", { csv: "user_email,target\na@b.co,1\n", period: "2020-05", periodType: "YEAR" });
  ok("YEAR import must start in January (400)", r.status === 400);
  r = await leader.call("POST", "/production/kpi-targets/import", { csv: `user_email,target\n${email("MEMBER_B")},1\n`, period: "2020-04" });
  ok("LEADER cannot import (403)", r.status === 403);

  // Delete a version → the previous one applies again
  const imported = staffRow.months[3].targetId;
  r = await admin.call("DELETE", `/production/kpi-targets/${imported}`);
  ok("delete a version", r.status === 200);
  r = await admin.call("DELETE", `/production/kpi-targets/${imported}`);
  ok("delete again → 404", r.status === 404);
  r = await admin.call("GET", "/production/kpi-targets?year=2020");
  ok("previous version applies again", row(r.body, staffId).months[3].targetPoints === 100);

  // Defaults by role for a period where nobody has a target yet
  // MANAGER gets a default only if it also holds a production worker role (other suites may grant QC).
  const managerWorks = localSql(`
    SELECT count(*) FROM production.user_roles WHERE organization_id = '${orgId}' AND user_id = '${adminId}' AND role_code IN ('STAFF', 'LEADER', 'QC');
  `)[0] !== "0";
  r = await admin.call("POST", "/production/kpi-targets/apply-defaults", { period: "2019-12" });
  const byUser = new Map((r.body.items ?? []).map((item) => [item.userId, item.targetPoints]));
  ok(
    "apply defaults: member vs leader default, workers only",
    r.status === 200 && byUser.get(staffId) === originalSettings.kpiDefaultMember && byUser.get(leaderId) === originalSettings.kpiDefaultLeader && byUser.has(adminId) === managerWorks,
    JSON.stringify(r.body)
  );
  r = await admin.call("POST", "/production/kpi-targets/apply-defaults", { period: "2020-01" });
  ok("members with an effective target are skipped", r.status === 200 && !r.body.items.some((item) => item.userId === staffId || item.userId === leaderId) && r.body.skipped >= 2);
  r = await leader.call("POST", "/production/kpi-targets/apply-defaults", { period: "2019-12" });
  ok("LEADER cannot apply defaults (403)", r.status === 403);

  // Board: points public, money private
  r = await leader.call("GET", "/production/scores/board?period=2020-03");
  const find = (board, userId) => board.items.find((item) => item.user.id === userId);
  let b = find(r.body, staffId);
  let a = find(r.body, leaderId);
  ok("board ranks by official points", r.status === 200 && b?.rank === 1 && b.pointsOfficial === 26 && a?.rank === 2 && a.pointsOfficial === 16, JSON.stringify(r.body?.items?.slice(0, 3)));
  ok("others see Khoán points/qty but not money or email", r.body.moneyVisible === false && b.pointsKhoan === 30 && b.qtyKhoan === 10 && b.money === null && b.user.email === null && b.teamName === `E2E scores team ${stamp}`);
  ok("own row shows own money", a.money === 0);
  r = await admin.call("GET", "/production/scores/board?period=2020-03");
  ok("ADMIN sees money", r.body.moneyVisible === true && find(r.body, staffId).money === 150000);
  r = await leader.call("GET", `/production/scores/board?period=2020-03&teamId=${fx.team}`);
  ok("team filter", r.status === 200 && r.body.items.length === 1 && r.body.items[0].user.id === staffId);
  r = await leader.call("GET", "/production/scores/board?period=2020-13");
  ok("invalid period rejected (400)", r.status === 400);

  await admin.call("PATCH", "/production/settings", { moneyPublic: true });
  r = await leader.call("GET", "/production/scores/board?period=2020-03");
  ok("money_public → others' money visible", find(r.body, staffId)?.money === 150000 && r.body.moneyVisible === true);
  await admin.call("PATCH", "/production/settings", { moneyPublic: originalSettings.moneyPublic, scoresPublic: false });
  r = await staff.call("GET", "/production/scores/board?period=2020-03");
  ok("scores_public off → board 403 for members", r.status === 403 && r.body.error.code === "SCORES_PRIVATE");
  r = await admin.call("GET", "/production/scores/board?period=2020-03");
  ok("scores_public off → ADMIN still sees the board", r.status === 200 && find(r.body, staffId)?.pointsOfficial === 26);
  r = await staff.call("GET", "/production/scores/me?from=2020-02-26&to=2020-03-25");
  ok("personal scores stay available when the board is private", r.status === 200 && r.body.summary.pointsOfficial === 26);
} finally {
  await admin.call("PATCH", "/production/settings", { scoresPublic: originalSettings.scoresPublic, moneyPublic: originalSettings.moneyPublic });
  cleanup();
}
