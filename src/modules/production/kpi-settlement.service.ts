import type {
  KpiReport,
  KpiReportRollup,
  KpiReportRow,
  KpiReportTotal,
  KpiSettlement,
  KpiSettlementList,
  KpiSettlementRun,
  KpiSettlementRunResult
} from "../../contracts/production-scores.js";
import { closeDayOfPeriod } from "../../contracts/production-scores.js";
import type { CustomFieldFilter, CustomValues, KhoanPayPolicy } from "../../contracts/production-catalog.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { toIso, toNullableIso, type QuerySql } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { enqueueDomainEvents } from "../events/outbox.js";
import { toUserRef, type UserRefJson } from "../work/mappers.js";
import { assertConfigEditor, assertProductionAdmin, assertProductionMember, isProductionAdmin } from "./access.js";
import { matchesCustomFieldFilters, resolveCustomFieldFilters } from "./custom-fields.js";
import { closeDaysOf, customFieldsForbidden, loadSettings } from "./catalog.service.js";
import { kpiSettledEvent } from "./kpi-settlement-notifications.js";
import { approvedLeaveDaysByUser } from "./leave.service.js";
import { loadScoreSubject } from "./scores.service.js";
import {
  effectiveTarget,
  latestClosedPeriod,
  percentKpi,
  periodOfDay,
  periodRange,
  periodsIn,
  rollupKey,
  rollupKpiPeriod,
  sumKpiFigures,
  settlePeriod,
  shiftPeriod,
  type KpiCloseDays,
  type KpiPeriodType,
  type SettlementResult,
  type TargetVersion
} from "./scoring.js";
import { businessDay } from "./time.js";

/**
 * KPI settlement on the close day (SPEC §8, PLAN §6). The rules are pure (scoring.ts settleUser /
 * settlePeriod); this module loads the period's figures, replaces the period's rows atomically, keeps
 * the run history and queues the KPI_SETTLED notifications. Runs of one organization are serialized
 * by a transaction-scoped advisory lock shared with the scheduler.
 */

const org = (context: AccessContext) => context.organization.id;
export const settlementLockKey = (organizationId: string) => `production:kpi-settlement:${organizationId}`;
const maxReportPeriods = 24;

type TargetRow = { user_id: string; period_type: KpiPeriodType; target_points: string; effective_from: string };

const loadTargets = async (sql: QuerySql, organizationId: string, userIds: string[], types: KpiPeriodType[]) => {
  const byUser = new Map<string, TargetVersion[]>();
  if (userIds.length === 0) {
    return byUser;
  }
  const rows = await sql<TargetRow[]>`
    SELECT user_id, period_type, target_points::text AS target_points, to_char(effective_from, 'YYYY-MM') AS effective_from
    FROM production.kpi_targets
    WHERE organization_id = ${organizationId} AND user_id = ANY(${userIds}::uuid[]) AND period_type = ANY(${types}::text[])
  `;
  for (const row of rows) {
    byUser.set(row.user_id, [
      ...(byUser.get(row.user_id) ?? []),
      { periodType: row.period_type, targetPoints: Number(row.target_points), effectiveFrom: row.effective_from }
    ]);
  }
  return byUser;
};

/**
 * What settling `period` gives right now, without writing anything: everyone with a score entry in the
 * period plus active members with a MONTH target effective for it (optionally only `onlyUserIds`).
 * `khoanPolicy` is settings.khoanPayPolicy (PD-033).
 */
export const computeSettlement = async (
  sql: QuerySql,
  organizationId: string,
  period: string,
  options: { closeDay: KpiCloseDays; prorateLeave: boolean; khoanPolicy: KhoanPayPolicy; onlyUserIds?: string[] | null }
) => {
  const { from, to } = periodRange(period, options.closeDay);
  const only = options.onlyUserIds ?? null;
  const [sums, targeted] = await Promise.all([
    sql<{ user_id: string; official: string; khoan: string; money: string }[]>`
      SELECT user_id,
        coalesce(sum(credits) FILTER (WHERE pay_mode = 'POINTS'), 0)::text AS official,
        coalesce(sum(credits) FILTER (WHERE pay_mode = 'MONEY_IF_KPI'), 0)::text AS khoan,
        coalesce(sum(money) FILTER (WHERE pay_mode = 'MONEY_IF_KPI'), 0)::text AS money
      FROM production.score_entries
      WHERE organization_id = ${organizationId} AND business_day BETWEEN ${from}::date AND ${to}::date
        AND (${only}::uuid[] IS NULL OR user_id = ANY(${only}::uuid[]))
      GROUP BY user_id
    `,
    sql<{ user_id: string }[]>`
      SELECT DISTINCT k.user_id FROM production.kpi_targets k
      JOIN public.organization_memberships om
        ON om.organization_id = k.organization_id AND om.user_id = k.user_id AND om.deleted_at IS NULL AND om.status = 'active'
      JOIN public.app_users au ON au.id = k.user_id AND au.deleted_at IS NULL
      WHERE k.organization_id = ${organizationId} AND k.period_type = 'MONTH' AND k.effective_from <= ${`${period}-01`}::date
        AND (${only}::uuid[] IS NULL OR k.user_id = ANY(${only}::uuid[]))
    `
  ]);
  const userIds = [...new Set([...sums.map((row) => row.user_id), ...targeted.map((row) => row.user_id)])].sort();
  const [targets, leave] = await Promise.all([
    loadTargets(sql, organizationId, userIds, ["MONTH"]),
    approvedLeaveDaysByUser(sql, organizationId, userIds, from, to, { workdaysOnly: true })
  ]);
  const sumOf = new Map(sums.map((row) => [row.user_id, row]));
  return settlePeriod({
    period,
    closeDay: options.closeDay,
    prorateLeave: options.prorateLeave,
    khoanPolicy: options.khoanPolicy,
    users: userIds.map((userId) => ({
      userId,
      targets: targets.get(userId) ?? [],
      pointsOfficial: Number(sumOf.get(userId)?.official ?? 0),
      khoanCredits: Number(sumOf.get(userId)?.khoan ?? 0),
      khoanMoneyRaw: Number(sumOf.get(userId)?.money ?? 0),
      leaveDays: leave.get(userId) ?? 0
    }))
  });
};

/**
 * SPEC §8.2 settleMonth: settles `period` and replaces its rows (idempotent: the same data gives the
 * same rows, never duplicates), records the run, and queues the notifications. Call inside a transaction.
 * The run uses the settings at run time (close day of the period, leave proration, Khoán pay policy — PD-033) and
 * records them, so re-running a period after switching the policy replaces its rows with the other outcome.
 */
export const settleMonth = async (
  tx: QuerySql,
  organizationId: string,
  period: string,
  options: { trigger: "AUTO" | "MANUAL"; runBy: string | null; reason: string | null }
) => {
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${settlementLockKey(organizationId)}, 0))`;
  const settings = await loadSettings(tx, organizationId);
  const result = await computeSettlement(tx, organizationId, period, {
    closeDay: closeDaysOf(settings),
    prorateLeave: settings.kpiProrateLeave,
    khoanPolicy: settings.khoanPayPolicy
  });
  const met = result.items.filter((item) => item.met).length;
  const run = (
    await tx<{ id: string }[]>`
      INSERT INTO production.kpi_settlement_runs (
        organization_id, period_month, period_from, period_to, close_day, trigger, run_by, reason, prorate_leave, khoan_policy,
        user_count, met_count, not_met_count, khoan_money_total, khoan_points_converted_total
      ) VALUES (
        ${organizationId}, ${`${period}-01`}::date, ${result.from}::date, ${result.to}::date, ${closeDayOfPeriod(closeDaysOf(settings), period)}, ${options.trigger},
        ${options.runBy}, ${options.reason}, ${settings.kpiProrateLeave}, ${settings.khoanPayPolicy}, ${result.items.length}, ${met}, ${result.items.length - met},
        ${result.items.reduce((sum, item) => sum + item.khoanMoney, 0)},
        ${Math.round(result.items.reduce((sum, item) => sum + item.khoanPointsConverted * 100, 0)) / 100}
      )
      RETURNING id
    `
  )[0]!;
  const replaced = await tx`
    DELETE FROM production.kpi_settlements WHERE organization_id = ${organizationId} AND period_month = ${`${period}-01`}::date RETURNING id
  `;
  const rows = result.items.map((item) => ({
    organization_id: organizationId,
    user_id: item.userId,
    period_month: `${period}-01`,
    period_from: result.from,
    period_to: result.to,
    target_base: item.targetBase,
    target_points: item.target,
    prorate_leave: item.prorateLeave,
    working_days: item.workingDays,
    leave_days: item.leaveDays,
    points_official: item.pointsOfficial,
    met: item.met,
    khoan_credits: item.khoanCredits,
    khoan_money_raw: item.khoanMoneyRaw,
    khoan_money: item.khoanMoney,
    khoan_points_converted: item.khoanPointsConverted,
    total_points: item.totalPoints,
    run_id: run.id,
    run_by: options.runBy,
    note: options.reason
  }));
  for (let index = 0; index < rows.length; index += 500) {
    await tx`INSERT INTO production.kpi_settlements ${tx(rows.slice(index, index + 500))}`;
  }
  await tx`UPDATE production.kpi_settlement_runs SET replaced_count = ${replaced.length}, finished_at = clock_timestamp() WHERE id = ${run.id}`;
  await enqueueDomainEvents(tx, [kpiSettledEvent(organizationId, run.id, period, options.runBy)]);
  return { runId: run.id, ...result };
};

// Reads ---------------------------------------------------------------------------------------------------------

type SettlementRow = UserRefJson & {
  settlement_id: string;
  period: string;
  period_from: string;
  period_to: string;
  target_base: string | null;
  target_points: string | null;
  prorate_leave: boolean;
  working_days: number;
  leave_days: string;
  points_official: string;
  met: boolean;
  khoan_credits: string;
  khoan_money_raw: string;
  khoan_money: string;
  khoan_points_converted: string;
  total_points: string;
  khoan_policy: KhoanPayPolicy;
  run_id: string;
  run_at: Date;
  note: string | null;
};

const nullableNumber = (value: string | null) => (value === null ? null : Number(value));

const selectSettlements = (sql: QuerySql, organizationId: string, filter: { fromPeriod: string; toPeriod: string; userIds: string[] | null }) =>
  sql<SettlementRow[]>`
    SELECT ks.id AS settlement_id, au.id, au.display_name, au.email, au.avatar_url,
      to_char(ks.period_month, 'YYYY-MM') AS period, to_char(ks.period_from, 'YYYY-MM-DD') AS period_from,
      to_char(ks.period_to, 'YYYY-MM-DD') AS period_to, ks.target_base::text AS target_base, ks.target_points::text AS target_points,
      ks.prorate_leave, ks.working_days, ks.leave_days::text AS leave_days, ks.points_official::text AS points_official, ks.met,
      ks.khoan_credits::text AS khoan_credits, ks.khoan_money_raw::text AS khoan_money_raw, ks.khoan_money::text AS khoan_money,
      ks.khoan_points_converted::text AS khoan_points_converted, ks.total_points::text AS total_points, r.khoan_policy,
      ks.run_id, ks.run_at, ks.note
    FROM production.kpi_settlements ks
    JOIN public.app_users au ON au.id = ks.user_id
    JOIN production.kpi_settlement_runs r ON r.organization_id = ks.organization_id AND r.id = ks.run_id
    WHERE ks.organization_id = ${organizationId}
      AND ks.period_month BETWEEN ${`${filter.fromPeriod}-01`}::date AND ${`${filter.toPeriod}-01`}::date
      AND (${filter.userIds}::uuid[] IS NULL OR ks.user_id = ANY(${filter.userIds}::uuid[]))
    ORDER BY ks.period_month, ks.total_points DESC, au.display_name
  `;

/** Who reads the rows: money is visible to ADMIN, to the row's owner, and to everyone when settings.moneyPublic (PD-052). */
type Viewer = { id: string; admin: boolean; moneyPublic: boolean };
const seesMoney = (viewer: Viewer, userId: string) => viewer.admin || viewer.moneyPublic || userId === viewer.id;

const toSettlement = (row: SettlementRow, viewer: Viewer): KpiSettlement => {
  const own = row.id === viewer.id;
  const money = seesMoney(viewer, row.id);
  const target = nullableNumber(row.target_points);
  const totalPoints = Number(row.total_points);
  return {
    id: row.settlement_id,
    user: { ...toUserRef(row)!, email: own || viewer.admin ? row.email : null },
    period: row.period,
    from: row.period_from,
    to: row.period_to,
    targetBase: nullableNumber(row.target_base),
    target,
    prorateLeave: row.prorate_leave,
    workingDays: row.working_days,
    leaveDays: Number(row.leave_days),
    pointsOfficial: Number(row.points_official),
    met: row.met,
    khoanCredits: Number(row.khoan_credits),
    khoanMoneyRaw: money ? Number(row.khoan_money_raw) : null,
    khoanMoney: money ? Number(row.khoan_money) : null,
    khoanPointsConverted: Number(row.khoan_points_converted),
    totalPoints,
    percent: percentKpi(totalPoints, target),
    difference: target === null ? null : Math.round((totalPoints - target) * 100) / 100 + 0,
    khoanPolicy: row.khoan_policy,
    runId: row.run_id,
    runAt: toIso(row.run_at),
    note: row.note
  };
};

type RunRow = {
  id: string;
  period: string;
  period_from: string;
  period_to: string;
  close_day: number;
  trigger: "AUTO" | "MANUAL";
  run_by: UserRefJson | null;
  reason: string | null;
  prorate_leave: boolean;
  khoan_policy: KhoanPayPolicy;
  user_count: number;
  met_count: number;
  not_met_count: number;
  khoan_money_total: string;
  khoan_points_converted_total: string;
  replaced_count: number;
  started_at: Date;
  finished_at: Date | null;
  current: boolean;
};

const selectRuns = (sql: QuerySql, organizationId: string, filter: { ids?: string[]; period?: string | undefined; limit: number }) => sql<RunRow[]>`
  SELECT r.id, to_char(r.period_month, 'YYYY-MM') AS period, to_char(r.period_from, 'YYYY-MM-DD') AS period_from,
    to_char(r.period_to, 'YYYY-MM-DD') AS period_to, r.close_day, r.trigger, r.reason, r.prorate_leave, r.khoan_policy, r.user_count, r.met_count,
    r.not_met_count, r.khoan_money_total::text AS khoan_money_total, r.khoan_points_converted_total::text AS khoan_points_converted_total,
    r.replaced_count, r.started_at, r.finished_at,
    CASE WHEN u.id IS NULL THEN NULL
      ELSE json_build_object('id', u.id, 'display_name', u.display_name, 'email', u.email, 'avatar_url', u.avatar_url) END AS run_by,
    r.id = (
      SELECT r2.id FROM production.kpi_settlement_runs r2
      WHERE r2.organization_id = r.organization_id AND r2.period_month = r.period_month
      ORDER BY r2.finished_at DESC NULLS LAST, r2.started_at DESC LIMIT 1
    ) AS current
  FROM production.kpi_settlement_runs r
  LEFT JOIN public.app_users u ON u.id = r.run_by
  WHERE r.organization_id = ${organizationId}
    ${filter.ids ? sql`AND r.id = ANY(${filter.ids}::uuid[])` : sql``}
    ${filter.period ? sql`AND r.period_month = ${`${filter.period}-01`}::date` : sql``}
  ORDER BY r.finished_at DESC NULLS LAST, r.started_at DESC
  LIMIT ${filter.limit}
`;

const toRun = (row: RunRow): KpiSettlementRun => ({
  id: row.id,
  period: row.period,
  from: row.period_from,
  to: row.period_to,
  closeDay: row.close_day,
  trigger: row.trigger,
  runBy: toUserRef(row.run_by),
  reason: row.reason,
  prorateLeave: row.prorate_leave,
  khoanPolicy: row.khoan_policy,
  userCount: row.user_count,
  metCount: row.met_count,
  notMetCount: row.not_met_count,
  khoanMoneyTotal: Number(row.khoan_money_total),
  khoanPointsConvertedTotal: Number(row.khoan_points_converted_total),
  replacedCount: row.replaced_count,
  startedAt: toIso(row.started_at),
  finishedAt: toNullableIso(row.finished_at),
  current: row.current
});

// API --------------------------------------------------------------------------------------------------------

/** POST /production/kpi/settlements/run — the superadmin (PD-050) (re-)settles a period; the reason is kept in the run history. */
export const runKpiSettlement = async (context: AccessContext, input: { period: string; reason: string }): Promise<KpiSettlementRunResult> => {
  assertConfigEditor(context);
  const sql = getSql();
  const settings = await loadSettings(sql, org(context));
  if (periodRange(input.period, closeDaysOf(settings)).from > businessDay(new Date())) {
    throw new AppError("KPI_PERIOD_NOT_STARTED", "Kỳ này chưa bắt đầu, chưa thể chốt KPI.", 400);
  }
  const { runId } = await sql.begin(
    async (tx) => await settleMonth(tx, org(context), input.period, { trigger: "MANUAL", runBy: context.user.id, reason: input.reason.trim() })
  );
  const [runs, rows] = await Promise.all([
    selectRuns(sql, org(context), { ids: [runId], limit: 1 }),
    selectSettlements(sql, org(context), { fromPeriod: input.period, toPeriod: input.period, userIds: null })
  ]);
  const viewer = { id: context.user.id, admin: true, moneyPublic: settings.moneyPublic };
  return { run: toRun(runs[0]!), items: rows.map((row) => toSettlement(row, viewer)) };
};

/**
 * GET /production/kpi/settlements — ADMIN: every row + the current run; other members: their own row only. `userId`
 * ("Điểm cá nhân", PD-052): only that production member's row, for any production member.
 */
export const listKpiSettlements = async (
  context: AccessContext,
  query: { period?: string | undefined; userId?: string | undefined }
): Promise<KpiSettlementList> => {
  assertProductionMember(context);
  const sql = getSql();
  const admin = isProductionAdmin(context);
  const [settings, subject] = await Promise.all([
    loadSettings(sql, org(context)),
    query.userId ? loadScoreSubject(sql, org(context), query.userId) : Promise.resolve(null)
  ]);
  const period = query.period ?? latestClosedPeriod(new Date(), closeDaysOf(settings));
  const userIds = subject ? [subject.id] : admin ? null : [context.user.id];
  const [rows, runs] = await Promise.all([
    selectSettlements(sql, org(context), { fromPeriod: period, toPeriod: period, userIds }),
    admin ? selectRuns(sql, org(context), { period, limit: 1 }) : Promise.resolve([])
  ]);
  const viewer = { id: context.user.id, admin, moneyPublic: settings.moneyPublic };
  return { period, run: runs[0] ? toRun(runs[0]) : null, items: rows.map((row) => toSettlement(row, viewer)) };
};

/** GET /production/kpi/settlement-runs — run history (ADMIN). */
export const listKpiSettlementRuns = async (context: AccessContext, query: { period?: string | undefined; limit: number }) => {
  assertProductionAdmin(context);
  return { items: (await selectRuns(getSql(), org(context), { period: query.period, limit: query.limit })).map(toRun) };
};

const periodsBetween = (from: string, to: string) => {
  const periods: string[] = [];
  for (let period = from; period <= to && periods.length <= maxReportPeriods; period = shiftPeriod(period, 1)) {
    periods.push(period);
  }
  return periods;
};

const reportRow = (
  userId: string,
  period: string,
  settled: boolean,
  item: Omit<SettlementResult, "prorateLeave" | "workingDays" | "khoanMoneyRaw">,
  moneyVisible: boolean
): KpiReportRow => ({
  userId,
  period,
  settled,
  targetBase: item.targetBase,
  target: item.target,
  pointsOfficial: item.pointsOfficial,
  khoanCredits: item.khoanCredits,
  khoanPointsConverted: item.khoanPointsConverted,
  totalPoints: item.totalPoints,
  percent: item.percent,
  difference: item.difference,
  met: item.met,
  leaveDays: item.leaveDays,
  khoanMoney: moneyVisible ? item.khoanMoney : null
});

/**
 * GET /production/kpi/report — user × period: target, official points, converted Khoán credits, total,
 * % đạt, vượt/thiếu, Khoán money (ADMIN and the owner). Settled periods come from kpi_settlements; periods
 * without a run yet show what a settlement would give now (`settled: false`).
 *
 * Quarter / year rollups (SPEC §8.4 "Quý/năm = cộng các tháng", G8) always cover the WHOLE quarter / year the
 * range touches — the months outside the selected range are read too — so a Q3 column is the same whatever range
 * is shown: sum of its started months against the explicit QUARTER/YEAR target, else the sum of the monthly
 * targets of all its months (`complete` / `settled` flags tell whether it is final).
 *
 * ADMIN also gets team and organization totals (PLAN §6 "theo NV, team") and may filter people by team, USER tags
 * (any of them) and USER custom fields (e.g. cf.nang_luc=A). Others see only themselves and cannot use the
 * tag / custom-field filters (403 CUSTOM_FIELDS_FORBIDDEN: members' custom values are Admin data). `userId`
 * ("Điểm cá nhân", PD-052): only that production member, for any production member. Khoán money: ADMIN, the
 * owner, or settings.moneyPublic.
 */
export const getKpiReport = async (
  context: AccessContext,
  query: {
    from: string;
    to: string;
    userId?: string | undefined;
    teamId?: string | undefined;
    tagId?: string[] | undefined;
    cf?: CustomFieldFilter[] | undefined;
  },
  /** rollups: false skips the quarter / year rollups and the extra months they read (dashboard card). */
  options: { rollups?: boolean } = {}
): Promise<KpiReport> => {
  assertProductionMember(context);
  const periods = periodsBetween(query.from, query.to);
  if (query.from > query.to || periods.length > maxReportPeriods) {
    throw new AppError("INVALID_RANGE", `Khoảng kỳ không hợp lệ (từ ≤ đến, tối đa ${maxReportPeriods} kỳ).`, 400);
  }
  const admin = isProductionAdmin(context);
  const tagIds = query.tagId ?? [];
  if (!admin && (tagIds.length > 0 || (query.cf?.length ?? 0) > 0)) {
    throw customFieldsForbidden();
  }
  const sql = getSql();
  const organizationId = org(context);
  const [settings, subject] = await Promise.all([
    loadSettings(sql, organizationId),
    query.userId ? loadScoreSubject(sql, organizationId, query.userId) : Promise.resolve(null)
  ]);
  const onlyUserIds = subject ? [subject.id] : admin ? null : [context.user.id];
  const closeDays = closeDaysOf(settings);
  const today = businessDay(new Date());
  const started = (period: string) => periodRange(period, closeDays).from <= today;
  const plans = await resolveCustomFieldFilters(sql, organizationId, "USER", query.cf);

  // Every month of the years the range touches (rollups cover whole quarters / years).
  const withRollups = options.rollups !== false;
  const years = withRollups ? [...new Set(periods.map((period) => period.slice(0, 4)))] : [];
  const readPeriods = [...new Set([...periods, ...years.flatMap((year) => periodsIn("YEAR", `${year}-01`))])].sort();
  const readFrom = readPeriods[0]!;
  const readTo = readPeriods[readPeriods.length - 1]!;

  const [settledRows, runPeriods, firstData] = await Promise.all([
    selectSettlements(sql, organizationId, { fromPeriod: readFrom, toPeriod: readTo, userIds: onlyUserIds }),
    sql<{ period: string }[]>`
      SELECT DISTINCT to_char(period_month, 'YYYY-MM') AS period FROM production.kpi_settlement_runs
      WHERE organization_id = ${organizationId} AND period_month BETWEEN ${`${readFrom}-01`}::date AND ${`${readTo}-01`}::date
    `,
    // Months before the first score entry and the first MONTH target have no figures: no need to compute them.
    sql<{ first_day: string | null; first_target: string | null }[]>`
      SELECT
        (SELECT to_char(min(business_day), 'YYYY-MM-DD') FROM production.score_entries WHERE organization_id = ${organizationId}) AS first_day,
        (SELECT to_char(min(effective_from), 'YYYY-MM') FROM production.kpi_targets WHERE organization_id = ${organizationId} AND period_type = 'MONTH') AS first_target
    `
  ]);
  const settledPeriods = new Set(runPeriods.map((row) => row.period));
  const firstPeriods = [
    firstData[0]?.first_day ? periodOfDay(firstData[0].first_day, closeDays) : null,
    firstData[0]?.first_target ?? null
  ].filter((value): value is string => value !== null);
  const dataFrom = firstPeriods.length > 0 ? firstPeriods.sort()[0]! : null;
  const viewer = { id: context.user.id, admin, moneyPublic: settings.moneyPublic };
  const rows: KpiReportRow[] = settledRows.map((row) => {
    const settlement = toSettlement(row, viewer);
    return reportRow(row.id, row.period, true, { ...settlement, khoanMoney: Number(row.khoan_money) }, seesMoney(viewer, row.id));
  });
  const userInfo = new Map<string, UserRefJson>(settledRows.map((row) => [row.id, row]));

  for (const period of readPeriods.filter((item) => !settledPeriods.has(item) && started(item) && dataFrom !== null && item >= dataFrom)) {
    const provisional = await computeSettlement(sql, organizationId, period, {
      closeDay: closeDays,
      prorateLeave: settings.kpiProrateLeave,
      khoanPolicy: settings.khoanPayPolicy,
      onlyUserIds
    });
    for (const item of provisional.items) {
      rows.push(reportRow(item.userId, period, false, item, seesMoney(viewer, item.userId)));
    }
  }

  const inRange = new Set(periods);
  const userIds = [...new Set(rows.filter((row) => inRange.has(row.period)).map((row) => row.userId))];
  const people = userIds.length
    ? await sql<(UserRefJson & { team_id: string | null; team_name: string | null; custom_values: CustomValues | null; tag_ids: string[] | null })[]>`
        SELECT au.id, au.display_name, au.email, au.avatar_url, mp.team_id, tm.name AS team_name, mp.custom_values,
          (SELECT array_agg(et.tag_id) FROM production.entity_tags et
            WHERE et.organization_id = ${organizationId} AND et.entity = 'USER' AND et.entity_id = au.id) AS tag_ids
        FROM public.app_users au
        LEFT JOIN production.member_profiles mp ON mp.organization_id = ${organizationId} AND mp.user_id = au.id
        LEFT JOIN production.teams tm ON tm.organization_id = ${organizationId} AND tm.id = mp.team_id
        WHERE au.id = ANY(${userIds}::uuid[])
      `
    : [];
  for (const person of people) {
    userInfo.set(person.id, person);
  }
  const profileOf = new Map(people.map((person) => [person.id, person]));
  const teamOf = new Map(people.map((person) => [person.id, { teamId: person.team_id, teamName: person.team_name }]));
  const visibleUsers = userIds.filter((userId) => {
    const person = profileOf.get(userId);
    return (
      (!query.teamId || person?.team_id === query.teamId) &&
      (tagIds.length === 0 || (person?.tag_ids ?? []).some((tagId) => tagIds.includes(tagId))) &&
      matchesCustomFieldFilters(person?.custom_values, plans)
    );
  });
  const visible = new Set(visibleUsers);
  const finalRows = rows
    .filter((row) => visible.has(row.userId) && inRange.has(row.period))
    .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : b.totalPoints - a.totalPoints));

  const targets = await loadTargets(sql, organizationId, visibleUsers, ["MONTH", "QUARTER", "YEAR"]);
  const rollups: KpiReportRollup[] = [];
  for (const userId of withRollups ? visibleUsers : []) {
    const mine = rows.filter((row) => row.userId === userId);
    for (const periodType of ["QUARTER", "YEAR"] as const) {
      const anchors = new Map<string, string>();
      for (const period of periods) {
        anchors.set(rollupKey(periodType, period), period);
      }
      for (const [key, anchor] of anchors) {
        const months = mine.filter((row) => rollupKey(periodType, row.period) === key);
        const explicit = effectiveTarget(targets.get(userId) ?? [], periodType, periodsIn(periodType, anchor)[0]!);
        const rollup = rollupKpiPeriod({
          periodType,
          period: anchor,
          months: months.map((month) => ({ ...month, khoanMoney: month.khoanMoney ?? 0 })),
          monthTargets: targets.get(userId) ?? [],
          explicitTarget: explicit,
          started,
          settled: (period) => settledPeriods.has(period)
        });
        rollups.push({
          userId,
          periodType,
          ...rollup,
          explicitTarget: explicit !== null,
          khoanMoney: seesMoney(viewer, userId) ? rollup.khoanMoney : null
        });
      }
    }
  }

  // Team and organization totals (ADMIN): per month of the range and per quarter / year.
  const totals: KpiReportTotal[] = [];
  if (admin) {
    const groups: { scope: "TEAM" | "ORG"; teamId: string | null; teamName: string | null; members: Set<string> }[] = [];
    const teams = new Map<string, { teamId: string | null; teamName: string | null; members: Set<string> }>();
    for (const userId of visibleUsers) {
      const team = teamOf.get(userId) ?? { teamId: null, teamName: null };
      const entry = teams.get(team.teamId ?? "") ?? { ...team, members: new Set<string>() };
      entry.members.add(userId);
      teams.set(team.teamId ?? "", entry);
    }
    groups.push(
      ...[...teams.values()]
        .sort((a, b) => (a.teamName === null ? 1 : b.teamName === null ? -1 : a.teamName.localeCompare(b.teamName, "vi")))
        .map((team) => ({ scope: "TEAM" as const, ...team })),
      { scope: "ORG", teamId: null, teamName: null, members: visible }
    );
    for (const group of groups) {
      for (const period of periods) {
        const items = finalRows.filter((row) => row.period === period && group.members.has(row.userId));
        if (items.length > 0) {
          totals.push({ scope: group.scope, teamId: group.teamId, teamName: group.teamName, periodType: "MONTH", key: period, ...sumKpiFigures(items) });
        }
      }
      for (const periodType of ["QUARTER", "YEAR"] as const) {
        const keys = [...new Set(rollups.filter((item) => item.periodType === periodType).map((item) => item.key))];
        for (const key of keys) {
          const items = rollups.filter((item) => item.periodType === periodType && item.key === key && group.members.has(item.userId));
          if (items.length > 0) {
            totals.push({ scope: group.scope, teamId: group.teamId, teamName: group.teamName, periodType, key, ...sumKpiFigures(items) });
          }
        }
      }
    }
  }

  return {
    from: query.from,
    to: query.to,
    periods,
    users: visibleUsers.map((userId) => {
      const info = userInfo.get(userId)!;
      const own = userId === context.user.id;
      return {
        user: { ...toUserRef(info)!, email: own || admin ? info.email : null },
        teamId: teamOf.get(userId)?.teamId ?? null,
        teamName: teamOf.get(userId)?.teamName ?? null
      };
    }),
    rows: finalRows,
    rollups,
    totals
  };
};
