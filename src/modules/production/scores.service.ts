import type {
  MyScores,
  ScoreBoard,
  ScoreEntry,
  ScoreForecast,
  TaskScores,
  UserScoreForecast,
  UserScores
} from "../../contracts/production-scores.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { toIso, type QuerySql } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { visibleUserSql } from "../access/test-accounts.js";
import { toUserRef, type UserRefJson } from "../work/mappers.js";
import { assertProductionMember, featuresOf, isProductionAdmin } from "./access.js";
import { closeDaysOf, customFieldsForbidden, loadSettings } from "./catalog.service.js";
import { featureForbidden } from "./features.js";
import { matchesCustomFieldFilters, resolveCustomFieldFilters } from "./custom-fields.js";
import { cursorInstantSql, cursorTextSql, decodeTimeCursor, encodeTimeCursor } from "./cursor.js";
import { assertTaskVisible, loadTask } from "./jobs.repo.js";
import { loadKpiRequiredUserIds, loadKpiRequirement, loadTargetVersionsByUser } from "./kpi-targets.service.js";
import { approvedLeaveDays, approvedLeaveDaysByUser } from "./leave.service.js";
import type { CustomFieldFilter, CustomValues, ProductionSettings } from "../../contracts/production-catalog.js";
import { closeDayOfPeriod } from "../../contracts/production-scores.js";
import {
  countWorkingDays,
  daysInclusive,
  effectiveTarget,
  forecast,
  khoanTopUp,
  kpiProgress,
  periodOfDay,
  periodRange,
  periodTarget,
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
import { parentNumberSql, taskCode } from "./task-codes.js";
import { addDays, businessDay, isValidDay, startOfBusinessDay } from "./time.js";

/** Personal scores, KPI forecast and the public board (SPEC Phase 3 §3–§4). Rules: scoring.ts. */

const org = (context: AccessContext) => context.organization.id;
const maxRangeDays = 366;

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
  cursor_at?: string;
  role: ScoreRole;
  task_id: string;
  task_number: string;
  /** The line number of a subtask (null otherwise) and the subtask's letter index — for the display code. */
  task_parent_number: string | null;
  task_sub_seq: number | null;
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
  task: {
    id: row.task_id,
    number: Number(row.task_number),
    code: taskCode({ number: row.task_number, subSeq: row.task_sub_seq, parentNumber: row.task_parent_number }),
    jobId: row.job_id,
    jobCode: row.job_code
  },
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

type SumRow = { business_day: string; role: ScoreRole; pay_mode: PayMode; credits: string; money: string; qty: number; project_id: string; project_code: string };

/**
 * One person's entries over a day range, summed per (day, role, pay mode[, project]) in SQL — an index-only
 * scan of the covering index (PERF-09) instead of loading every row. The sums feed summarize() / totals()
 * exactly like single entries (credits stay exact to 2 decimals).
 */
const selectSums = (sql: QuerySql, organizationId: string, userId: string, from: string, to: string, byProject: boolean) => sql<SumRow[]>`
  SELECT to_char(a.business_day, 'YYYY-MM-DD') AS business_day, a.role, a.pay_mode, a.credits::text AS credits, a.money::text AS money,
    a.qty::int AS qty, a.project_id, coalesce(p.code, '') AS project_code
  FROM (
    SELECT e.business_day, e.role, e.pay_mode, ${byProject ? sql`e.project_id` : sql`NULL::uuid`} AS project_id,
      sum(e.credits) AS credits, sum(e.money) AS money, sum(e.qty) AS qty
    FROM production.score_entries e
    WHERE e.organization_id = ${organizationId} AND e.user_id = ${userId} AND e.business_day BETWEEN ${from}::date AND ${to}::date
    GROUP BY 1, 2, 3, 4
  ) a
  LEFT JOIN production.projects p ON p.organization_id = ${organizationId} AND p.id = a.project_id
`;

/**
 * One page of entries, newest first, keyset (created_at, id) at full precision. An entry's business day is
 * the business day of its created_at (scoring-hooks), so the day range also bounds created_at and the
 * (organization, user, created_at DESC, id DESC) index range-scans just the page.
 */
const selectEntryPage = (
  sql: QuerySql,
  organizationId: string,
  userId: string,
  range: { from: string; to: string },
  page: { cursor: { at: string; id: string } | null; limit: number }
) => sql<EntryRow[]>`
  SELECT e.id, e.role, e.task_id, t.number::text AS task_number, (${parentNumberSql(sql)})::text AS task_parent_number,
    t.sub_seq AS task_sub_seq, e.job_id, j.code AS job_code, e.project_id, p.code AS project_code,
    e.process_id, pr.name AS process_name, e.shift_id, s.name AS shift_name, e.pay_mode, e.kind, e.qty,
    e.unit_credits::text AS unit_credits, e.credits::text AS credits, e.money::text AS money, e.credit_rule_id,
    to_char(e.business_day, 'YYYY-MM-DD') AS business_day, to_char(e.period_month, 'YYYY-MM') AS period,
    e.adjusts_entry_id, e.note, e.created_at, ${cursorTextSql(sql, "e.created_at")} AS cursor_at
  FROM (
    SELECT * FROM production.score_entries
    WHERE organization_id = ${organizationId} AND user_id = ${userId}
      AND business_day BETWEEN ${range.from}::date AND ${range.to}::date
      AND created_at >= ${startOfBusinessDay(range.from)} AND created_at < ${startOfBusinessDay(addDays(range.to, 1))}
      ${page.cursor ? sql`AND (created_at, id) < (${cursorInstantSql(sql, page.cursor.at)}, ${page.cursor.id}::uuid)` : sql``}
    ORDER BY created_at DESC, id DESC
    LIMIT ${page.limit + 1}
  ) e
  JOIN production.tasks t ON t.organization_id = e.organization_id AND t.id = e.task_id
  JOIN production.jobs j ON j.organization_id = e.organization_id AND j.id = e.job_id
  JOIN production.projects p ON p.organization_id = e.organization_id AND p.id = e.project_id
  JOIN production.shifts s ON s.organization_id = e.organization_id AND s.id = e.shift_id
  LEFT JOIN production.processes pr ON pr.organization_id = e.organization_id AND pr.id = e.process_id
  ORDER BY e.created_at DESC, e.id DESC
`;

type ScoresQuery = { from?: string | undefined; to?: string | undefined; cursor?: string | undefined; limit?: number | undefined };

// Subjects (PD-052) ---------------------------------------------------------------------------------------

export type ScoreSubject = UserRefJson & { team_id: string | null; team_name: string | null };

/**
 * The person whose "Điểm cá nhân" is asked for (PD-052): an active member of the organization holding a production role
 * (or its superadmin, production ADMIN by PD-011) — 404 SCORE_USER_NOT_FOUND otherwise, whoever asks.
 */
export const loadScoreSubject = async (sql: QuerySql, organizationId: string, userId: string): Promise<ScoreSubject> => {
  const [subject] = await sql<ScoreSubject[]>`
    SELECT au.id, au.display_name, au.email, au.avatar_url, mp.team_id, tm.name AS team_name
    FROM public.organization_memberships om
    JOIN public.app_users au ON au.id = om.user_id
    LEFT JOIN production.member_profiles mp ON mp.organization_id = om.organization_id AND mp.user_id = om.user_id
    LEFT JOIN production.teams tm ON tm.organization_id = om.organization_id AND tm.id = mp.team_id
    WHERE om.organization_id = ${organizationId} AND om.user_id = ${userId} AND om.deleted_at IS NULL AND om.status = 'active'
      AND (
        EXISTS (SELECT 1 FROM production.user_roles ur WHERE ur.organization_id = om.organization_id AND ur.user_id = om.user_id)
        OR EXISTS (SELECT 1 FROM public.roles r WHERE r.id = om.role_id AND r.organization_id = om.organization_id AND r.key = 'superadmin')
      )
  `;
  if (!subject) {
    throw new AppError("SCORE_USER_NOT_FOUND", "Không tìm thấy nhân viên này trong Photo Retouch.", 404);
  }
  return subject;
};

/**
 * Everyone's Khoán money for the caller (board, task scores, "Điểm cá nhân", PD-065): the `view_others_money` feature (by
 * default Admin and Director; the superadmin always). PD-066: nothing else opens it (`moneyPublic` is retired).
 */
export const seesOthersMoney = (context: AccessContext, settings: Pick<ProductionSettings, "featurePermissions">) =>
  featuresOf(context, settings.featurePermissions).has("view_others_money");

/** Khoán money of `userId` for the caller: their own, or `seesOthersMoney`. */
export const seesMoneyOf = (context: AccessContext, settings: Pick<ProductionSettings, "featurePermissions">, userId: string) =>
  userId === context.user.id || seesOthersMoney(context, settings);

/**
 * PD-065: someone else's scores ("Xếp hạng", "Điểm cá nhân", forecast, a task's rows) need `view_others_scores` (by default
 * every role; the superadmin always). One's own scores are always visible.
 */
export const seesOthersScores = (context: AccessContext, settings: Pick<ProductionSettings, "featurePermissions">) =>
  featuresOf(context, settings.featurePermissions).has("view_others_scores");

/** 403 SCORES_PRIVATE when `userId` is someone else and the caller lacks `view_others_scores`. */
const assertSeesScoresOf = (context: AccessContext, settings: Pick<ProductionSettings, "featurePermissions">, userId: string) => {
  if (userId !== context.user.id && !seesOthersScores(context, settings)) {
    throw featureForbidden("view_others_scores");
  }
};

/**
 * Summary, fixed today / week / period cards and a page of entries of one person (`subjectId`) — GET /production/scores/me
 * for the caller, GET /production/scores/user/:userId for anyone (PD-052). Money is always filled in; the callers hide it.
 */
const loadScores = async (
  sql: QuerySql,
  organizationId: string,
  subjectId: string,
  settings: ProductionSettings,
  query: ScoresQuery
): Promise<MyScores> => {
  const today = businessDay(new Date());
  const currentPeriod = periodOfDay(today, closeDaysOf(settings));
  const current = periodRange(currentPeriod, closeDaysOf(settings));
  const from = query.from ?? current.from;
  const to = query.to ?? current.to;
  if (!isValidDay(from) || !isValidDay(to) || from > to || daysInclusive(from, to) > maxRangeDays) {
    throw invalidRange();
  }

  const cursor = decodeTimeCursor(query.cursor);
  const limit = query.limit ?? 100;

  const week = weekStart(today);
  const cardsFrom = week < current.from ? week : current.from;
  const cardsTo = today > current.to ? today : current.to;
  const [sums, cardRows, entryRows] = await Promise.all([
    selectSums(sql, organizationId, subjectId, from, to, true),
    selectSums(sql, organizationId, subjectId, cardsFrom, cardsTo, false),
    selectEntryPage(sql, organizationId, subjectId, { from, to }, { cursor, limit })
  ]);
  const page = entryRows.slice(0, limit);
  const last = page[page.length - 1];
  const hasMore = entryRows.length > limit;
  const cardEntries = cardRows.map(toSummaryEntry);
  const within = (start: string, end: string) => cardEntries.filter((entry) => entry.businessDay >= start && entry.businessDay <= end);

  return {
    from,
    to,
    today,
    summary: summarize(sums.map(toSummaryEntry), { from, to }),
    cards: {
      today: totals(within(today, today)),
      week: totals(within(week, today)),
      period: { ...totals(within(current.from, current.to)), period: currentPeriod, from: current.from, to: current.to }
    },
    entries: page.map(toEntry),
    truncated: hasMore,
    nextCursor: hasMore && last?.cursor_at ? encodeTimeCursor(last.cursor_at, last.id) : null
  };
};

/** GET /production/scores/me — own summary, fixed today/week/period cards and a page of entries with task links. */
export const getMyScores = async (context: AccessContext, query: ScoresQuery): Promise<MyScores> => {
  assertProductionMember(context);
  const sql = getSql();
  const settings = await loadSettings(sql, org(context));
  return await loadScores(sql, org(context), context.user.id, settings, query);
};

const hideTotalsMoney = <T extends { moneyKhoanProvisional: number }>(totals: T, visible: boolean) => ({
  ...totals,
  moneyKhoanProvisional: visible ? totals.moneyKhoanProvisional : null
});

/**
 * GET /production/scores/user/:userId — "Điểm cá nhân" of any production member (PD-052): what /scores/me shows its
 * owner, money hidden unless `seesMoneyOf`. Someone else's needs `view_others_scores` (PD-065, 403 SCORES_PRIVATE).
 */
export const getUserScores = async (context: AccessContext, userId: string, query: ScoresQuery): Promise<UserScores> => {
  assertProductionMember(context);
  const sql = getSql();
  const organizationId = org(context);
  const settings = await loadSettings(sql, organizationId);
  assertSeesScoresOf(context, settings, userId);
  const subject = await loadScoreSubject(sql, organizationId, userId);
  const scores = await loadScores(sql, organizationId, subject.id, settings, query);
  const moneyVisible = seesMoneyOf(context, settings, subject.id);
  return {
    ...scores,
    user: { ...toUserRef(subject)!, email: subject.id === context.user.id || isProductionAdmin(context) ? subject.email : null },
    teamId: subject.team_id,
    teamName: subject.team_name,
    moneyVisible,
    summary: hideTotalsMoney(scores.summary, moneyVisible),
    cards: {
      today: hideTotalsMoney(scores.cards.today, moneyVisible),
      week: hideTotalsMoney(scores.cards.week, moneyVisible),
      period: hideTotalsMoney(scores.cards.period, moneyVisible)
    },
    entries: scores.entries.map((entry) => ({ ...entry, money: moneyVisible ? entry.money : null }))
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

/**
 * KPI forecast of one person (`userId`) for a period plus % KPI by month / quarter / year (money always filled in), whether
 * they must have a KPI and what closing the period today would give (TOP_UP on the figures so far, PD-066).
 */
const computeForecast = async (
  sql: QuerySql,
  organizationId: string,
  userId: string,
  settings: ProductionSettings,
  query: { period?: string | undefined }
): Promise<ScoreForecast> => {
  const closeDay = closeDaysOf(settings);
  const today = businessDay(new Date());
  const period = query.period ?? periodOfDay(today, closeDay);
  const { from, to } = periodRange(period, closeDay);
  const year = period.slice(0, 4);
  const yearFrom = periodRange(`${year}-01`, closeDay).from;
  const yearTo = periodRange(`${year}-12`, closeDay).to;

  const [days, targets, requirement] = await Promise.all([
    sql<{ business_day: string; pay_mode: PayMode; credits: string; money: string }[]>`
      SELECT to_char(business_day, 'YYYY-MM-DD') AS business_day, pay_mode, sum(credits)::text AS credits, sum(money)::text AS money
      FROM production.score_entries
      WHERE organization_id = ${organizationId} AND user_id = ${userId} AND business_day BETWEEN ${yearFrom}::date AND ${yearTo}::date
      GROUP BY business_day, pay_mode
    `,
    loadTargetVersions(sql, organizationId, userId),
    loadKpiRequirement(sql, organizationId, userId, period)
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
  const pointsKhoan = khoanCents / 100 + 0;

  return {
    ...result,
    closeDay: closeDayOfPeriod(closeDay, period),
    today,
    pointsKhoan,
    moneyKhoanProvisional: khoanMoney,
    kpi: { month: progress("MONTH"), quarter: progress("QUARTER"), year: progress("YEAR") },
    kpiRequired: requirement.required,
    ifSettledToday: khoanTopUp({ target: result.target, pointsOfficial, khoanCredits: pointsKhoan, khoanMoney })
  };
};

/** GET /production/scores/forecast — own KPI forecast for a period plus % KPI by month / quarter / year. */
export const getScoreForecast = async (context: AccessContext, query: { period?: string | undefined }): Promise<ScoreForecast> => {
  assertProductionMember(context);
  const sql = getSql();
  const settings = await loadSettings(sql, org(context));
  return await computeForecast(sql, org(context), context.user.id, settings, query);
};

/**
 * GET /production/scores/user/:userId/forecast — the KPI forecast of any production member (PD-052), money and "Nếu chốt
 * hôm nay" (PD-066) per `seesMoneyOf`; someone else's needs `view_others_scores` (PD-065, 403 SCORES_PRIVATE).
 */
export const getUserScoreForecast = async (
  context: AccessContext,
  userId: string,
  query: { period?: string | undefined }
): Promise<UserScoreForecast> => {
  assertProductionMember(context);
  const sql = getSql();
  const organizationId = org(context);
  const settings = await loadSettings(sql, organizationId);
  assertSeesScoresOf(context, settings, userId);
  const subject = await loadScoreSubject(sql, organizationId, userId);
  const result = await computeForecast(sql, organizationId, subject.id, settings, query);
  const moneyVisible = seesMoneyOf(context, settings, subject.id);
  return { ...hideTotalsMoney(result, moneyVisible), ifSettledToday: moneyVisible ? result.ifSettledToday : null };
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
  custom_values: CustomValues | null;
  tag_ids: string[] | null;
};

/**
 * GET /production/scores/board — "Bảng điểm → Toàn đội" (PD-069): every production worker (STAFF/LEADER/QC), everyone who
 * must have a KPI (PD-066) and anyone who scored in the period, by official points, each with their KPI of the period
 * (effective MONTH target prorated by approved leave like the forecast / close — scoring.ts periodTarget) and whether
 * they must have one. PD-065: the roles of `view_others_scores` (by default every role; the superadmin always), others
 * 403 SCORES_PRIVATE (settings.scoresPublic stays retired, PD-052); money only for the row's owner or
 * `view_others_money` (PD-066). Temporary QA test accounts are left out for a viewer who is not one (PD-063). A fixed
 * number of queries whatever the number of people (required members, the board, targets, leave).
 */
export const getScoreBoard = async (
  context: AccessContext,
  query: { period?: string | undefined; teamId?: string | undefined; tagId?: string[] | undefined; cf?: CustomFieldFilter[] | undefined }
): Promise<ScoreBoard> => {
  assertProductionMember(context);
  const sql = getSql();
  const organizationId = org(context);
  const settings = await loadSettings(sql, organizationId);
  if (!seesOthersScores(context, settings)) {
    throw featureForbidden("view_others_scores");
  }
  const admin = isProductionAdmin(context);
  // USER tags / custom fields (e.g. "Năng lực") are Admin data: only an Admin filters the board by them.
  const tagIds = query.tagId ?? [];
  if (!admin && (tagIds.length > 0 || (query.cf?.length ?? 0) > 0)) {
    throw customFieldsForbidden();
  }
  const plans = await resolveCustomFieldFilters(sql, organizationId, "USER", query.cf);
  const period = query.period ?? periodOfDay(businessDay(new Date()), closeDaysOf(settings));
  const { from, to } = periodRange(period, closeDaysOf(settings));
  const teamId = query.teamId ?? null;
  // PD-066: who must have a KPI this period — on the board even before they score (PD-069 "Chưa có KPI").
  const required = await loadKpiRequiredUserIds(sql, organizationId, period);

  const rows = await sql<BoardRow[]>`
    WITH sums AS (
      SELECT user_id,
        coalesce(sum(credits) FILTER (WHERE pay_mode = 'POINTS'), 0)::text AS points_official,
        coalesce(sum(credits) FILTER (WHERE pay_mode = 'MONEY_IF_KPI'), 0)::text AS points_khoan,
        coalesce(sum(qty) FILTER (WHERE pay_mode = 'MONEY_IF_KPI'), 0)::int AS qty_khoan,
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
      UNION
      SELECT unnest(${[...required]}::uuid[])
    )
    SELECT au.id AS user_id, au.display_name, au.email, au.avatar_url, mp.team_id, tm.name AS team_name,
      coalesce(s.points_official, '0') AS points_official, coalesce(s.points_khoan, '0') AS points_khoan,
      coalesce(s.qty_khoan, 0) AS qty_khoan, coalesce(s.money, '0') AS money,
      ${plans.length > 0 ? sql`mp.custom_values` : sql`NULL::jsonb`} AS custom_values,
      ${
        tagIds.length > 0
          ? sql`(SELECT array_agg(et.tag_id) FROM production.entity_tags et WHERE et.organization_id = ${organizationId} AND et.entity = 'USER' AND et.entity_id = au.id)`
          : sql`NULL::uuid[]`
      } AS tag_ids
    FROM people pe
    JOIN public.app_users au ON au.id = pe.user_id
    LEFT JOIN sums s ON s.user_id = pe.user_id
    LEFT JOIN production.member_profiles mp ON mp.organization_id = ${organizationId} AND mp.user_id = pe.user_id
    LEFT JOIN production.teams tm ON tm.organization_id = ${organizationId} AND tm.id = mp.team_id
    WHERE (${teamId}::uuid IS NULL OR mp.team_id = ${teamId}::uuid)
      AND ${visibleUserSql(sql, context)}
    LIMIT 5000
  `;

  const moneyVisible = seesOthersMoney(context, settings);
  const ranked = rankByPoints(
    rows
      .filter((row) => matchesCustomFieldFilters(row.custom_values, plans) && (tagIds.length === 0 || (row.tag_ids ?? []).some((id) => tagIds.includes(id))))
      .map((row) => ({ ...row, pointsOfficial: Number(row.points_official) })),
    (row) => row.display_name
  );
  // PD-069: each person's KPI of the period, as the forecast / close compute it (one query each for all the people).
  const userIds = ranked.map((row) => row.user_id);
  const [targets, leave] = await Promise.all([
    loadTargetVersionsByUser(sql, organizationId, userIds, ["MONTH"]),
    settings.kpiProrateLeave ? approvedLeaveDaysByUser(sql, organizationId, userIds, from, to, { workdaysOnly: true }) : null
  ]);
  const workingDays = countWorkingDays(from, to);
  const kpiTargetOf = (userId: string) =>
    periodTarget({
      targetBase: effectiveTarget(targets.get(userId) ?? [], "MONTH", period),
      prorateLeave: settings.kpiProrateLeave,
      workingDays,
      leaveDays: leave?.get(userId) ?? null
    });
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
        money: moneyVisible || own ? Number(row.money) : null,
        kpiTarget: kpiTargetOf(row.user_id),
        kpiRequired: required.has(row.user_id)
      };
    })
  };
};

// Task scores -------------------------------------------------------------------------------------------------

/**
 * GET /production/scores/task/:taskId — the ledger rows of one task (task detail), everyone's, for anyone who may
 * see the task (PD-052 retired the settings.scoresPublic filter of PR-11). PD-065: someone without
 * `view_others_scores` gets only their own rows (totals and per-process figures of those rows); money only for the row's
 * owner or `view_others_money` (PD-066).
 */
export const getTaskScores = async (context: AccessContext, taskId: string): Promise<TaskScores> => {
  assertProductionMember(context);
  const sql = getSql();
  const organizationId = org(context);
  const task = await loadTask(sql, organizationId, taskId);
  await assertTaskVisible(sql, context, task);
  const settings = await loadSettings(sql, organizationId);
  const admin = isProductionAdmin(context);
  const moneyVisible = seesOthersMoney(context, settings);
  const onlyMine = !seesOthersScores(context, settings);
  const rows = await sql<(EntryRow & { owner: UserRefJson })[]>`
    SELECT e.id, e.role, e.task_id, t.number::text AS task_number, (${parentNumberSql(sql)})::text AS task_parent_number,
      t.sub_seq AS task_sub_seq, e.job_id, j.code AS job_code, e.project_id, p.code AS project_code,
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
    WHERE e.organization_id = ${organizationId}
      AND (e.task_id = ${taskId} OR e.task_id IN (
        -- PD-048: a task's page shows its subtasks' points too (each scored by its own process and quantity).
        SELECT st.id FROM production.tasks st
        WHERE st.organization_id = ${organizationId} AND st.parent_task_id = ${taskId} AND st.kind = 'NORMAL' AND st.deleted_at IS NULL
      ))
      ${onlyMine ? sql`AND e.user_id = ${context.user.id}` : sql``}
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
  // PD-048: per process (the task's own and each subtask's), in order of first appearance.
  const byProcess = new Map<string, { process: { id: string; name: string } | null; qty: number; cents: number; units: Set<string>; missingRule: boolean }>();
  for (const row of rows) {
    const key = row.process_id ?? "none";
    const group = byProcess.get(key) ?? {
      process: row.process_id && row.process_name !== null ? { id: row.process_id, name: row.process_name } : null,
      qty: 0,
      cents: 0,
      units: new Set<string>(),
      missingRule: false
    };
    group.qty += row.qty;
    group.cents += Math.round(Number(row.credits) * 100);
    if (row.adjusts_entry_id === null) {
      group.units.add(row.unit_credits);
      if (row.credit_rule_id === null) group.missingRule = true;
    }
    byProcess.set(key, group);
  }
  return {
    taskId,
    byProcess: [...byProcess.values()].map((group) => ({
      process: group.process,
      qty: group.qty,
      credits: group.cents / 100 + 0,
      unitCredits: group.units.size === 1 ? Number([...group.units][0]) : null,
      missingRule: group.missingRule
    })),
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
