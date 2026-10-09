import type { MyScores, ScoreBoard, ScoreEntry, ScoreForecast, TaskScores } from "../../contracts/production-scores.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { toIso, type QuerySql } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { toUserRef, type UserRefJson } from "../work/mappers.js";
import { assertProductionMember, isProductionAdmin } from "./access.js";
import { loadSettings } from "./catalog.service.js";
import { canViewTask, loadTask, relationOf } from "./jobs.repo.js";
import { approvedLeaveDays } from "./leave.service.js";
import {
  daysInclusive,
  effectiveTarget,
  forecast,
  kpiProgress,
  periodOfDay,
  periodRange,
  rankByPoints,
  summarize,
  totals,
  weekStart,
  type KpiPeriodType,
  type PayMode,
  type ScoreRole,
  type SummaryEntry,
  type TargetVersion
} from "./scoring.js";
import { businessDay, isValidDay } from "./time.js";

/** Personal scores, KPI forecast and the public board (SPEC Phase 3 §3–§4). Rules: scoring.ts. */

const org = (context: AccessContext) => context.organization.id;
const maxRangeDays = 366;
const maxListedEntries = 1000;

/**
 * Approved leave days of a user in [from, to] for KPI proration (settings.kpiProrateLeave). The leave
 * module wires it, e.g. `registerLeaveDaysProvider((sql, org, user, from, to) =>
 * approvedLeaveDays(sql, org, user, from, to, { workdaysOnly: true }))`. Until then the forecast
 * reports `leaveDays: null` and does not prorate.
 */
export type LeaveDaysProvider = (sql: QuerySql, organizationId: string, userId: string, from: string, to: string) => Promise<number>;
// SPEC §6.3: approved leave reduces the monthly target by working days (Mon–Sat) when kpi_prorate_leave is on.
let leaveDaysProvider: LeaveDaysProvider | null = (sql, organizationId, userId, from, to) =>
  approvedLeaveDays(sql, organizationId, userId, from, to, { workdaysOnly: true });
export const registerLeaveDaysProvider = (provider: LeaveDaysProvider | null) => {
  leaveDaysProvider = provider;
};

const invalidRange = () => new AppError("INVALID_RANGE", "Khoảng ngày không hợp lệ (tối đa 366 ngày).", 400);

// Entries -----------------------------------------------------------------------------------------------

type EntryRow = {
  id: string;
  role: ScoreRole;
  task_id: string;
  task_number: string;
  job_id: string;
  job_code: string;
  project_id: string;
  project_code: string;
  process_id: string | null;
  process_name: string | null;
  shift_id: string;
  shift_name: string;
  pay_mode: PayMode;
  kind: ScoreEntry["kind"];
  qty: number;
  unit_credits: string;
  credits: string;
  money: string;
  credit_rule_id: string | null;
  business_day: string;
  period: string;
  adjusts_entry_id: string | null;
  note: string | null;
  created_at: Date;
};

const toEntry = (row: EntryRow): ScoreEntry => ({
  id: row.id,
  role: row.role,
  task: { id: row.task_id, number: Number(row.task_number), jobId: row.job_id, jobCode: row.job_code },
  project: { id: row.project_id, code: row.project_code },
  process: row.process_id && row.process_name !== null ? { id: row.process_id, name: row.process_name } : null,
  shift: { id: row.shift_id, name: row.shift_name },
  payMode: row.pay_mode,
  kind: row.kind,
  qty: row.qty,
  unitCredits: Number(row.unit_credits),
  credits: Number(row.credits),
  money: Number(row.money),
  missingRule: row.credit_rule_id === null,
  businessDay: row.business_day,
  period: row.period,
  adjustsEntryId: row.adjusts_entry_id,
  note: row.note,
  createdAt: toIso(row.created_at)
});

const toSummaryEntry = (row: { business_day: string; role: ScoreRole; pay_mode: PayMode; credits: string; money: string; qty: number; project_id: string; project_code: string }): SummaryEntry => ({
  businessDay: row.business_day,
  role: row.role,
  payMode: row.pay_mode,
  credits: Number(row.credits),
  money: Number(row.money),
  qty: row.qty,
  projectId: row.project_id,
  projectCode: row.project_code
});

const selectEntries = (sql: QuerySql, organizationId: string, userId: string, from: string, to: string) => sql<EntryRow[]>`
  SELECT e.id, e.role, e.task_id, t.number::text AS task_number, e.job_id, j.code AS job_code, e.project_id, p.code AS project_code,
    e.process_id, pr.name AS process_name, e.shift_id, s.name AS shift_name, e.pay_mode, e.kind, e.qty,
    e.unit_credits::text AS unit_credits, e.credits::text AS credits, e.money::text AS money, e.credit_rule_id,
    to_char(e.business_day, 'YYYY-MM-DD') AS business_day, to_char(e.period_month, 'YYYY-MM') AS period,
    e.adjusts_entry_id, e.note, e.created_at
  FROM production.score_entries e
  JOIN production.tasks t ON t.organization_id = e.organization_id AND t.id = e.task_id
  JOIN production.jobs j ON j.organization_id = e.organization_id AND j.id = e.job_id
  JOIN production.projects p ON p.organization_id = e.organization_id AND p.id = e.project_id
  JOIN production.shifts s ON s.organization_id = e.organization_id AND s.id = e.shift_id
  LEFT JOIN production.processes pr ON pr.organization_id = e.organization_id AND pr.id = e.process_id
  WHERE e.organization_id = ${organizationId} AND e.user_id = ${userId}
    AND e.business_day BETWEEN ${from}::date AND ${to}::date
  ORDER BY e.created_at DESC, e.id DESC
  LIMIT 50000
`;

/** GET /production/scores/me — own summary, fixed today/week/period cards and entries with task links. */
export const getMyScores = async (context: AccessContext, query: { from?: string | undefined; to?: string | undefined }): Promise<MyScores> => {
  assertProductionMember(context);
  const sql = getSql();
  const settings = await loadSettings(sql, org(context));
  const today = businessDay(new Date());
  const currentPeriod = periodOfDay(today, settings.kpiCloseDay);
  const current = periodRange(currentPeriod, settings.kpiCloseDay);
  const from = query.from ?? current.from;
  const to = query.to ?? current.to;
  if (!isValidDay(from) || !isValidDay(to) || from > to || daysInclusive(from, to) > maxRangeDays) {
    throw invalidRange();
  }

  const week = weekStart(today);
  const cardsFrom = week < current.from ? week : current.from;
  const cardsTo = today > current.to ? today : current.to;
  const [rows, cardRows] = await Promise.all([
    selectEntries(sql, org(context), context.user.id, from, to),
    sql<{ business_day: string; role: ScoreRole; pay_mode: PayMode; credits: string; money: string; qty: number; project_id: string; project_code: string }[]>`
      SELECT to_char(business_day, 'YYYY-MM-DD') AS business_day, role, pay_mode, credits::text AS credits, money::text AS money, qty,
        project_id, '' AS project_code
      FROM production.score_entries
      WHERE organization_id = ${org(context)} AND user_id = ${context.user.id}
        AND business_day BETWEEN ${cardsFrom}::date AND ${cardsTo}::date
    `
  ]);
  const cardEntries = cardRows.map(toSummaryEntry);
  const within = (start: string, end: string) => cardEntries.filter((entry) => entry.businessDay >= start && entry.businessDay <= end);

  return {
    from,
    to,
    today,
    summary: summarize(
      rows.map((row) => toSummaryEntry(row)),
      { from, to }
    ),
    cards: {
      today: totals(within(today, today)),
      week: totals(within(week, today)),
      period: { ...totals(within(current.from, current.to)), period: currentPeriod, from: current.from, to: current.to }
    },
    entries: rows.slice(0, maxListedEntries).map(toEntry),
    truncated: rows.length > maxListedEntries
  };
};

// Forecast ---------------------------------------------------------------------------------------------

type TargetRow = { period_type: KpiPeriodType; target_points: string; effective_from: string };

export const loadTargetVersions = async (sql: QuerySql, organizationId: string, userId: string): Promise<TargetVersion[]> =>
  (
    await sql<TargetRow[]>`
      SELECT period_type, target_points::text AS target_points, to_char(effective_from, 'YYYY-MM') AS effective_from
      FROM production.kpi_targets WHERE organization_id = ${organizationId} AND user_id = ${userId}
    `
  ).map((row) => ({ periodType: row.period_type, targetPoints: Number(row.target_points), effectiveFrom: row.effective_from }));

/** GET /production/scores/forecast — own KPI forecast for a period plus % KPI by month / quarter / year. */
export const getScoreForecast = async (context: AccessContext, query: { period?: string | undefined }): Promise<ScoreForecast> => {
  assertProductionMember(context);
  const sql = getSql();
  const organizationId = org(context);
  const userId = context.user.id;
  const settings = await loadSettings(sql, organizationId);
  const closeDay = settings.kpiCloseDay;
  const today = businessDay(new Date());
  const period = query.period ?? periodOfDay(today, closeDay);
  const { from, to } = periodRange(period, closeDay);
  const year = period.slice(0, 4);
  const yearFrom = periodRange(`${year}-01`, closeDay).from;
  const yearTo = periodRange(`${year}-12`, closeDay).to;

  const [days, targets] = await Promise.all([
    sql<{ business_day: string; pay_mode: PayMode; credits: string; money: string }[]>`
      SELECT to_char(business_day, 'YYYY-MM-DD') AS business_day, pay_mode, sum(credits)::text AS credits, sum(money)::text AS money
      FROM production.score_entries
      WHERE organization_id = ${organizationId} AND user_id = ${userId} AND business_day BETWEEN ${yearFrom}::date AND ${yearTo}::date
      GROUP BY business_day, pay_mode
    `,
    loadTargetVersions(sql, organizationId, userId)
  ]);

  const monthlyCents: Record<string, number> = {};
  let officialCents = 0;
  let khoanCents = 0;
  let khoanMoney = 0;
  for (const day of days) {
    const cents = Math.round(Number(day.credits) * 100);
    const inPeriod = day.business_day >= from && day.business_day <= to;
    if (day.pay_mode === "POINTS") {
      const key = periodOfDay(day.business_day, closeDay);
      monthlyCents[key] = (monthlyCents[key] ?? 0) + cents;
      officialCents += inPeriod ? cents : 0;
    } else if (inPeriod) {
      khoanCents += cents;
      khoanMoney += Number(day.money);
    }
  }
  const monthlyPoints = Object.fromEntries(Object.entries(monthlyCents).map(([key, cents]) => [key, cents / 100]));
  const pointsOfficial = officialCents / 100 + 0;

  const leaveDays = settings.kpiProrateLeave && leaveDaysProvider ? await leaveDaysProvider(sql, organizationId, userId, from, to) : null;
  const result = forecast({
    target: effectiveTarget(targets, "MONTH", period),
    pointsOfficial,
    period,
    closeDay,
    today,
    prorateLeave: settings.kpiProrateLeave,
    leaveDays
  });
  const progress = (periodType: KpiPeriodType) => kpiProgress({ periodType, period, monthlyPoints, targets });

  return {
    ...result,
    closeDay,
    today,
    pointsKhoan: khoanCents / 100 + 0,
    moneyKhoanProvisional: khoanMoney,
    kpi: { month: progress("MONTH"), quarter: progress("QUARTER"), year: progress("YEAR") }
  };
};

// Board -------------------------------------------------------------------------------------------------

type BoardRow = {
  user_id: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  team_id: string | null;
  team_name: string | null;
  points_official: string;
  points_khoan: string;
  qty_khoan: number;
  money: string;
};

/**
 * GET /production/scores/board — every production worker (STAFF/LEADER/QC) and anyone who scored in
 * the period, ranked by official points. Points are public; money only for the row's owner, ADMIN,
 * or when settings.moneyPublic. 403 for non-admins when settings.scoresPublic is off.
 */
export const getScoreBoard = async (context: AccessContext, query: { period?: string | undefined; teamId?: string | undefined }): Promise<ScoreBoard> => {
  assertProductionMember(context);
  const sql = getSql();
  const organizationId = org(context);
  const settings = await loadSettings(sql, organizationId);
  const admin = isProductionAdmin(context);
  if (!settings.scoresPublic && !admin) {
    throw new AppError("SCORES_PRIVATE", "Bảng điểm chung đang để riêng tư.", 403);
  }
  const period = query.period ?? periodOfDay(businessDay(new Date()), settings.kpiCloseDay);
  const { from, to } = periodRange(period, settings.kpiCloseDay);
  const teamId = query.teamId ?? null;

  const rows = await sql<BoardRow[]>`
    WITH sums AS (
      SELECT user_id,
        coalesce(sum(credits) FILTER (WHERE pay_mode = 'POINTS'), 0)::text AS points_official,
        coalesce(sum(credits) FILTER (WHERE pay_mode = 'MONEY_IF_KPI'), 0)::text AS points_khoan,
        coalesce(sum(qty) FILTER (WHERE pay_mode = 'MONEY_IF_KPI' AND role = 'WORKER'), 0)::int AS qty_khoan,
        coalesce(sum(money) FILTER (WHERE pay_mode = 'MONEY_IF_KPI'), 0)::text AS money
      FROM production.score_entries
      WHERE organization_id = ${organizationId} AND business_day BETWEEN ${from}::date AND ${to}::date
      GROUP BY user_id
    ), people AS (
      SELECT user_id FROM sums
      UNION
      SELECT ur.user_id FROM production.user_roles ur
      JOIN public.organization_memberships om
        ON om.organization_id = ur.organization_id AND om.user_id = ur.user_id AND om.deleted_at IS NULL AND om.status = 'active'
      WHERE ur.organization_id = ${organizationId} AND ur.role_code IN ('STAFF', 'LEADER', 'QC')
    )
    SELECT au.id AS user_id, au.display_name, au.email, au.avatar_url, mp.team_id, tm.name AS team_name,
      coalesce(s.points_official, '0') AS points_official, coalesce(s.points_khoan, '0') AS points_khoan,
      coalesce(s.qty_khoan, 0) AS qty_khoan, coalesce(s.money, '0') AS money
    FROM people pe
    JOIN public.app_users au ON au.id = pe.user_id
    LEFT JOIN sums s ON s.user_id = pe.user_id
    LEFT JOIN production.member_profiles mp ON mp.organization_id = ${organizationId} AND mp.user_id = pe.user_id
    LEFT JOIN production.teams tm ON tm.organization_id = ${organizationId} AND tm.id = mp.team_id
    WHERE ${teamId}::uuid IS NULL OR mp.team_id = ${teamId}::uuid
    LIMIT 5000
  `;

  const moneyVisible = admin || settings.moneyPublic;
  const ranked = rankByPoints(
    rows.map((row) => ({ ...row, pointsOfficial: Number(row.points_official) })),
    (row) => row.display_name
  );
  return {
    period,
    from,
    to,
    moneyVisible,
    items: ranked.map((row) => {
      const own = row.user_id === context.user.id;
      return {
        rank: row.rank,
        // Colleagues' emails are not part of the public board.
        user: { id: row.user_id, displayName: row.display_name, email: own || admin ? row.email : null, avatarUrl: row.avatar_url },
        teamId: row.team_id,
        teamName: row.team_name,
        pointsOfficial: row.pointsOfficial,
        pointsKhoan: Number(row.points_khoan),
        qtyKhoan: row.qty_khoan,
        money: moneyVisible || own ? Number(row.money) : null
      };
    })
  };
};

// Task scores -------------------------------------------------------------------------------------------------

/**
 * GET /production/scores/task/:taskId — the ledger rows of one task (task detail), for anyone who may
 * see the task. Points are public; money only for the row's owner, ADMIN, or when settings.moneyPublic.
 */
export const getTaskScores = async (context: AccessContext, taskId: string): Promise<TaskScores> => {
  assertProductionMember(context);
  const sql = getSql();
  const organizationId = org(context);
  const task = await loadTask(sql, organizationId, taskId);
  if (!canViewTask(relationOf(context, task))) {
    throw new AppError("TASK_NOT_FOUND", "Không tìm thấy task.", 404);
  }
  const settings = await loadSettings(sql, organizationId);
  const admin = isProductionAdmin(context);
  const moneyVisible = admin || settings.moneyPublic;
  const rows = await sql<(EntryRow & { owner: UserRefJson })[]>`
    SELECT e.id, e.role, e.task_id, t.number::text AS task_number, e.job_id, j.code AS job_code, e.project_id, p.code AS project_code,
      e.process_id, pr.name AS process_name, e.shift_id, s.name AS shift_name, e.pay_mode, e.kind, e.qty,
      e.unit_credits::text AS unit_credits, e.credits::text AS credits, e.money::text AS money, e.credit_rule_id,
      to_char(e.business_day, 'YYYY-MM-DD') AS business_day, to_char(e.period_month, 'YYYY-MM') AS period,
      e.adjusts_entry_id, e.note, e.created_at,
      json_build_object('id', au.id, 'display_name', au.display_name, 'email', au.email, 'avatar_url', au.avatar_url) AS owner
    FROM production.score_entries e
    JOIN production.tasks t ON t.organization_id = e.organization_id AND t.id = e.task_id
    JOIN production.jobs j ON j.organization_id = e.organization_id AND j.id = e.job_id
    JOIN production.projects p ON p.organization_id = e.organization_id AND p.id = e.project_id
    JOIN production.shifts s ON s.organization_id = e.organization_id AND s.id = e.shift_id
    JOIN public.app_users au ON au.id = e.user_id
    LEFT JOIN production.processes pr ON pr.organization_id = e.organization_id AND pr.id = e.process_id
    WHERE e.organization_id = ${organizationId} AND e.task_id = ${taskId}
    ORDER BY e.created_at, e.adjusts_entry_id NULLS FIRST, e.recorded_at, e.id
  `;
  const visible = (userId: string) => moneyVisible || userId === context.user.id;
  const userRef = (user: UserRefJson) => ({ ...toUserRef(user)!, email: admin || user.id === context.user.id ? user.email : null });
  const totals = new Map<string, { role: ScoreRole; user: UserRefJson; qty: number; cents: number; money: number }>();
  for (const row of rows) {
    const key = `${row.role}:${row.owner.id}`;
    const total = totals.get(key) ?? { role: row.role, user: row.owner, qty: 0, cents: 0, money: 0 };
    total.qty += row.qty;
    total.cents += Math.round(Number(row.credits) * 100);
    total.money += Number(row.money);
    totals.set(key, total);
  }
  return {
    taskId,
    moneyVisible,
    items: rows.map((row) => ({ ...toEntry(row), user: userRef(row.owner), money: visible(row.owner.id) ? Number(row.money) : null })),
    totals: [...totals.values()].map((total) => ({
      role: total.role,
      user: userRef(total.user),
      qty: total.qty,
      credits: total.cents / 100 + 0,
      money: visible(total.user.id) ? total.money : null
    }))
  };
};
