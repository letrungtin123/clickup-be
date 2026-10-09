import { addDays, businessDay } from "./time.js";

/**
 * Score and KPI rules (docs/retouch/SPEC.md Phase 3, PLAN §5–§6, PD-010) as pure functions.
 * The hooks (scoring-hooks.ts) and services load data and call these; scoring.test.ts covers them.
 *
 * Decisions recorded here (see also the migration 20261009_2300_production_scores.sql):
 * - Credits are exact to 2 decimals: computed in integer cents, never float-multiplied.
 * - No credit rule for (project, process) on the business day → the entry is still written with
 *   0 credits / 0 money and `creditRuleId = null`, so the anomalies report can flag it and an
 *   Admin can correct it with an adjustment. The workflow is never blocked by a missing price.
 * - FB_WRONG tasks earn nothing for anyone (PLAN §5 "FB sai → —"): worker and QC entries are
 *   recorded with their qty and 0 credits / 0 money.
 * - QC entries never carry money and are always pay mode POINTS: QC credit counts toward the KPI
 *   whatever the task's shift (Checking has no price; a MONEY_IF_KPI QC entry could only lose credit
 *   at settlement). The task's shift is still copied for reporting.
 * - Adjustments (qty edited after the entry) reuse the original entry's unit price — prices are
 *   fixed at the time of Done/Checked (PLAN §10) — and are booked on the day they happen.
 */

export type PayMode = "POINTS" | "MONEY_IF_KPI";
export type TaskKind = "NORMAL" | "FB_WRONG" | "FB_EXTRA";
export type ScoreRole = "WORKER" | "QC";
export type KpiPeriodType = "MONTH" | "QUARTER" | "YEAR";

export type RuleSnapshot = { id: string; creditPerImage: number; moneyPerImage: number | null };

/** What one original score entry records (DB columns besides task/user/period context). */
export type ScoreDraft = {
  role: ScoreRole;
  payMode: PayMode;
  creditRuleId: string | null;
  qty: number;
  /** Credits per image actually applied (0 for FB_WRONG or a missing rule). */
  unitCredits: number;
  /** VND per image actually applied (only Khoán worker entries with a priced rule). */
  unitMoney: number;
  credits: number;
  money: number;
};

/** Pay mode of every QC entry (see decisions above). */
export const qcPayMode: PayMode = "POINTS";

const toCents = (value: number) => Math.round(value * 100);
/** `+ 0` turns -0 into 0. */
const fromCents = (cents: number) => cents / 100 + 0;
const round2 = (value: number) => fromCents(Math.round(value * 100));
const ceil2 = (value: number) => Math.ceil(value * 100 - 1e-9) / 100 + 0;

const draft = (role: ScoreRole, payMode: PayMode, rule: RuleSnapshot | null, qty: number, unitCredits: number, unitMoney: number): ScoreDraft => ({
  role,
  payMode,
  creditRuleId: rule?.id ?? null,
  qty,
  unitCredits,
  unitMoney,
  credits: fromCents(toCents(unitCredits) * qty),
  money: unitMoney * qty + 0
});

/** SPEC §5.2: Done → WORKER entry for the assignee, priced by the task's (project, process) rule. */
export const computeWorkerEntry = (input: { rule: RuleSnapshot | null; qtyDone: number; payMode: PayMode; kind: TaskKind }): ScoreDraft => {
  const priced = input.rule !== null && input.kind !== "FB_WRONG";
  const unitCredits = priced ? fromCents(toCents(input.rule!.creditPerImage)) : 0;
  const unitMoney = priced && input.payMode === "MONEY_IF_KPI" && input.rule!.moneyPerImage !== null ? input.rule!.moneyPerImage : 0;
  return draft("WORKER", input.payMode, input.rule, input.qtyDone, unitCredits, unitMoney);
};

/** SPEC §5.2 / PD-010: Checked → QC entry for qc_id, priced by the project's QC process ("Checking") rule. */
export const computeQcEntry = (input: { rule: RuleSnapshot | null; qtyDone: number; kind: TaskKind }): ScoreDraft => {
  const priced = input.rule !== null && input.kind !== "FB_WRONG";
  const unitCredits = priced ? fromCents(toCents(input.rule!.creditPerImage)) : 0;
  return draft("QC", qcPayMode, input.rule, input.qtyDone, unitCredits, 0);
};

/**
 * Roles whose original entry must be written when a task enters a status: only the first time
 * (an original entry for the role does not exist yet). QC fail → Done again writes nothing.
 */
export const rolesToRecord = (input: { countsDone: boolean; countsChecked: boolean; hasQc: boolean; recorded: ReadonlySet<ScoreRole> }): ScoreRole[] => {
  const roles: ScoreRole[] = [];
  if (input.countsDone && !input.recorded.has("WORKER")) {
    roles.push("WORKER");
  }
  if (input.countsChecked && input.hasQc && !input.recorded.has("QC")) {
    roles.push("QC");
  }
  return roles;
};

/**
 * Adjustment entry (new − old) when the qty behind an entry changes. `ledgerQty` is the qty the
 * entry and its earlier adjustments already account for. Null when nothing changes.
 */
export const computeAdjustment = (
  original: { unitCredits: number; unitMoney: number },
  ledgerQty: number,
  nextQty: number
): { qty: number; credits: number; money: number } | null => {
  const qty = nextQty - ledgerQty;
  if (qty === 0) {
    return null;
  }
  return { qty, credits: fromCents(toCents(original.unitCredits) * qty), money: original.unitMoney * qty + 0 };
};

// KPI periods ---------------------------------------------------------------------------------------

const pad = (value: number) => String(value).padStart(2, "0");
const splitDay = (day: string) => day.split("-").map(Number) as [number, number, number];
const splitPeriod = (period: string) => period.split("-").map(Number) as [number, number];

export const isValidPeriod = (period: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(period);

/** Moves a "YYYY-MM" period by `months`. */
export const shiftPeriod = (period: string, months: number) => {
  const [year, month] = splitPeriod(period);
  const index = year * 12 + (month - 1) + months;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
};

/** Period ("YYYY-MM") of a business day: the month of the next close day (day ≤ close day → this month). */
export const periodOfDay = (day: string, closeDay: number) => {
  const [year, month, date] = splitDay(day);
  const period = `${year}-${pad(month)}`;
  return date > closeDay ? shiftPeriod(period, 1) : period;
};

/** SPEC §5.2 `period_month`: first day of the period containing `at` (business timezone). */
export const periodMonth = (at: Date, closeDay: number) => `${periodOfDay(businessDay(at), closeDay)}-01`;

/** Business days covered by a period: (previous close day + 1) … close day, inclusive. */
export const periodRange = (period: string, closeDay: number) => ({
  from: addDays(`${shiftPeriod(period, -1)}-${pad(closeDay)}`, 1),
  to: `${period}-${pad(closeDay)}`
});

/** Monthly periods summed by a KPI period type (quarters and years accumulate months). */
export const periodsIn = (periodType: KpiPeriodType, period: string): string[] => {
  const [year, month] = splitPeriod(period);
  if (periodType === "MONTH") {
    return [period];
  }
  const first = periodType === "QUARTER" ? Math.floor((month - 1) / 3) * 3 + 1 : 1;
  const count = periodType === "QUARTER" ? 3 : 12;
  return Array.from({ length: count }, (_, index) => `${year}-${pad(first + index)}`);
};

const dayNumber = (day: string) => Date.UTC(...(splitDay(day).map((part, index) => (index === 1 ? part - 1 : part)) as [number, number, number])) / 86_400_000;

/** Calendar days from `from` to `to`, both included (0 when `to` < `from`). */
export const daysInclusive = (from: string, to: string) => Math.max(0, dayNumber(to) - dayNumber(from) + 1);

const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

/** Working days (Monday–Saturday, SPEC §6.3) from `from` to `to`, both included. */
export const countWorkingDays = (from: string, to: string) => {
  let count = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    if (weekday(day) !== 0) {
      count += 1;
    }
  }
  return count;
};

/** Monday of the week containing `day`. */
export const weekStart = (day: string) => addDays(day, -((weekday(day) + 6) % 7));

// Summaries -------------------------------------------------------------------------------------------

export type SummaryEntry = {
  businessDay: string;
  role: ScoreRole;
  payMode: PayMode;
  credits: number;
  money: number;
  qty: number;
  projectId: string;
  projectCode: string;
};

export type ScoreTotals = {
  /** Credits of POINTS entries (worker and QC): what counts toward the KPI. */
  pointsOfficial: number;
  /** Credits of Khoán (MONEY_IF_KPI) entries: settled on the close day (Phase 6). */
  pointsKhoan: number;
  /** Provisional Khoán money (paid only if the KPI is met at settlement). */
  moneyKhoanProvisional: number;
  /** Images done in Khoán shifts (worker entries). */
  qtyKhoan: number;
  /** Part of pointsOfficial earned as QC. */
  qcPoints: number;
};

export type ScoreSummary = ScoreTotals & {
  byDay: { day: string; pointsOfficial: number; pointsKhoan: number }[];
  byProject: { projectId: string; projectCode: string; pointsOfficial: number; pointsKhoan: number; qty: number }[];
};

export const totals = (entries: readonly SummaryEntry[]): ScoreTotals => {
  let official = 0;
  let khoan = 0;
  let qc = 0;
  let money = 0;
  let qtyKhoan = 0;
  for (const entry of entries) {
    const cents = toCents(entry.credits);
    if (entry.payMode === "POINTS") {
      official += cents;
      if (entry.role === "QC") {
        qc += cents;
      }
    } else {
      khoan += cents;
      money += entry.money;
      if (entry.role === "WORKER") {
        qtyKhoan += entry.qty;
      }
    }
  }
  return {
    pointsOfficial: fromCents(official),
    pointsKhoan: fromCents(khoan),
    moneyKhoanProvisional: money + 0,
    qtyKhoan: qtyKhoan + 0,
    qcPoints: fromCents(qc)
  };
};

/** SPEC §5.3 summarize: totals plus points per day (gaps filled when a range is given) and per project. */
export const summarize = (entries: readonly SummaryEntry[], range?: { from: string; to: string }): ScoreSummary => {
  const days = new Map<string, { official: number; khoan: number }>();
  if (range && daysInclusive(range.from, range.to) <= 400) {
    for (let day = range.from; day <= range.to; day = addDays(day, 1)) {
      days.set(day, { official: 0, khoan: 0 });
    }
  }
  const projects = new Map<string, { projectCode: string; official: number; khoan: number; qty: number }>();
  for (const entry of entries) {
    const cents = toCents(entry.credits);
    const day = days.get(entry.businessDay) ?? { official: 0, khoan: 0 };
    const project = projects.get(entry.projectId) ?? { projectCode: entry.projectCode, official: 0, khoan: 0, qty: 0 };
    if (entry.payMode === "POINTS") {
      day.official += cents;
      project.official += cents;
    } else {
      day.khoan += cents;
      project.khoan += cents;
    }
    if (entry.role === "WORKER") {
      project.qty += entry.qty;
    }
    days.set(entry.businessDay, day);
    projects.set(entry.projectId, project);
  }
  return {
    ...totals(entries),
    byDay: [...days.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([day, value]) => ({ day, pointsOfficial: fromCents(value.official), pointsKhoan: fromCents(value.khoan) })),
    byProject: [...projects.entries()]
      .sort(([, a], [, b]) => b.official + b.khoan - (a.official + a.khoan) || a.projectCode.localeCompare(b.projectCode))
      .map(([projectId, value]) => ({
        projectId,
        projectCode: value.projectCode,
        pointsOfficial: fromCents(value.official),
        pointsKhoan: fromCents(value.khoan),
        qty: value.qty + 0
      }))
  };
};

// KPI ----------------------------------------------------------------------------------------------------

/** % of target reached (2 decimals); null without a positive target. */
export const percentKpi = (points: number, target: number | null) => (target === null || target <= 0 ? null : round2((points / target) * 100));

/** SPEC §6.3: target × (working days − approved leave days) / working days. */
export const prorateTarget = (target: number, workingDays: number, leaveDays: number) =>
  workingDays <= 0 ? target : round2((target * Math.max(workingDays - leaveDays, 0)) / workingDays);

export type ForecastTone = "MET" | "ON_TRACK" | "AT_RISK" | "BEHIND" | "NO_TARGET";

export type Forecast = {
  period: string;
  from: string;
  to: string;
  /** Target before leave proration. */
  targetBase: number | null;
  target: number | null;
  pointsOfficial: number;
  remaining: number | null;
  /** Calendar days left until the close day, today included. */
  daysLeft: number;
  workingDaysLeft: number;
  avgPerDayNeeded: number | null;
  percent: number | null;
  /** Colour of the forecast line: green (MET/ON_TRACK), yellow (AT_RISK), red (BEHIND). */
  tone: ForecastTone;
  prorateLeave: boolean;
  leaveDays: number | null;
};

/** Pace below this share of the needed daily average is "behind" (red); between it and 100 % "at risk". */
const atRiskShare = 0.8;

/**
 * SPEC §5.3 forecast: remaining = max(target − official points, 0), days left to the close day and the
 * average needed per day. Leave proration applies only when the setting is on and leave days are known.
 */
export const forecast = (input: {
  target: number | null;
  pointsOfficial: number;
  period: string;
  closeDay: number;
  today: string;
  prorateLeave: boolean;
  leaveDays: number | null;
}): Forecast => {
  const { from, to } = periodRange(input.period, input.closeDay);
  const totalDays = daysInclusive(from, to);
  const daysLeft = input.today > to ? 0 : input.today < from ? totalDays : daysInclusive(input.today, to);
  const workingDaysLeft = input.today > to ? 0 : countWorkingDays(input.today < from ? from : input.today, to);
  const elapsed = totalDays - daysLeft;
  const target =
    input.target === null
      ? null
      : input.prorateLeave && input.leaveDays !== null
        ? prorateTarget(input.target, countWorkingDays(from, to), input.leaveDays)
        : input.target;
  const remaining = target === null ? null : Math.max(round2(target - input.pointsOfficial), 0);
  const avgPerDayNeeded = remaining === null || daysLeft === 0 ? null : ceil2(remaining / daysLeft);

  let tone: ForecastTone;
  if (remaining === null) {
    tone = "NO_TARGET";
  } else if (remaining === 0) {
    tone = "MET";
  } else if (daysLeft === 0) {
    tone = "BEHIND";
  } else if (elapsed === 0) {
    tone = "ON_TRACK";
  } else {
    const pace = input.pointsOfficial / elapsed;
    const needed = remaining / daysLeft;
    tone = pace >= needed ? "ON_TRACK" : pace >= needed * atRiskShare ? "AT_RISK" : "BEHIND";
  }

  return {
    period: input.period,
    from,
    to,
    targetBase: input.target,
    target,
    pointsOfficial: input.pointsOfficial,
    remaining,
    daysLeft,
    workingDaysLeft,
    avgPerDayNeeded,
    percent: percentKpi(input.pointsOfficial, target),
    tone,
    prorateLeave: input.prorateLeave,
    leaveDays: input.leaveDays
  };
};

export type TargetVersion = { periodType: KpiPeriodType; targetPoints: number; effectiveFrom: string };

/** Version of a period: the latest of that type whose effective_from is not after the period's first month. */
export const effectiveVersion = <T extends TargetVersion>(targets: readonly T[], periodType: KpiPeriodType, period: string): T | null => {
  const anchor = periodsIn(periodType, period)[0]!;
  let best: T | null = null;
  for (const target of targets) {
    if (target.periodType === periodType && target.effectiveFrom <= anchor && (!best || target.effectiveFrom > best.effectiveFrom)) {
      best = target;
    }
  }
  return best;
};

export const effectiveTarget = (targets: readonly TargetVersion[], periodType: KpiPeriodType, period: string): number | null =>
  effectiveVersion(targets, periodType, period)?.targetPoints ?? null;

export type KpiProgress = { periodType: KpiPeriodType; periods: string[]; points: number; target: number | null; percent: number | null };

/**
 * SPEC §5.3 percent KPI by MONTH / QUARTER / YEAR: points accumulate the monthly periods; the target
 * is the explicit QUARTER/YEAR target when one exists, otherwise the sum of the monthly targets.
 */
export const kpiProgress = (input: {
  periodType: KpiPeriodType;
  period: string;
  monthlyPoints: Readonly<Record<string, number>>;
  targets: readonly TargetVersion[];
}): KpiProgress => {
  const periods = periodsIn(input.periodType, input.period);
  const points = fromCents(periods.reduce((sum, period) => sum + toCents(input.monthlyPoints[period] ?? 0), 0));
  let target: number | null;
  if (input.periodType === "MONTH") {
    target = effectiveTarget(input.targets, "MONTH", input.period);
  } else {
    target = effectiveTarget(input.targets, input.periodType, input.period);
    if (target === null) {
      const monthly = periods.map((period) => effectiveTarget(input.targets, "MONTH", period)).filter((value): value is number => value !== null);
      target = monthly.length > 0 ? fromCents(monthly.reduce((sum, value) => sum + toCents(value), 0)) : null;
    }
  }
  return { periodType: input.periodType, periods, points, target, percent: percentKpi(points, target) };
};

/** Board ranking by official points (ties share a rank: 1, 2, 2, 4), then by name. */
export const rankByPoints = <T extends { pointsOfficial: number }>(items: readonly T[], name: (item: T) => string): (T & { rank: number })[] => {
  const sorted = [...items].sort((a, b) => b.pointsOfficial - a.pointsOfficial || name(a).localeCompare(name(b), "vi"));
  let rank = 0;
  return sorted.map((item, index) => {
    if (index === 0 || item.pointsOfficial !== sorted[index - 1]!.pointsOfficial) {
      rank = index + 1;
    }
    return { ...item, rank };
  });
};

// KPI settlement (SPEC §8, PLAN §6) -------------------------------------------------------------------------

export type SettlementInput = {
  /** MONTH target effective for the period (null = no KPI). */
  targetBase: number | null;
  prorateLeave: boolean;
  /** Monday–Saturday days of the period. */
  workingDays: number;
  /** Approved leave on working days in the period (half days = 0.5). */
  leaveDays: number;
  /** Credits of POINTS entries, worker + QC (PLAN §6.2). */
  pointsOfficial: number;
  /** Credits and provisional money of Khoán (MONEY_IF_KPI) entries. */
  khoanCredits: number;
  khoanMoneyRaw: number;
};

export type SettlementResult = SettlementInput & {
  /** Target applied (prorated by leave when the setting is on). */
  target: number | null;
  met: boolean;
  khoanMoney: number;
  khoanPointsConverted: number;
  /** KPI points of the period: official + converted Khoán credits. */
  totalPoints: number;
  percent: number | null;
  /** Vượt (+) / thiếu (−) versus the target. */
  difference: number | null;
};

/**
 * PLAN §6 / SPEC §8.2 for one person: met = official points ≥ target (no target → met). Met → Khoán
 * money is paid and its credits do not count; not met → no money, Khoán credits convert into KPI points.
 */
export const settleUser = (input: SettlementInput): SettlementResult => {
  const target =
    input.targetBase === null ? null : input.prorateLeave ? prorateTarget(input.targetBase, input.workingDays, input.leaveDays) : input.targetBase;
  const met = target === null || toCents(input.pointsOfficial) >= toCents(target);
  const khoanPointsConverted = met ? 0 : input.khoanCredits;
  const totalPoints = fromCents(toCents(input.pointsOfficial) + toCents(khoanPointsConverted));
  return {
    ...input,
    target,
    met,
    khoanMoney: met ? input.khoanMoneyRaw : 0,
    khoanPointsConverted,
    totalPoints,
    percent: percentKpi(totalPoints, target),
    difference: target === null ? null : fromCents(toCents(totalPoints) - toCents(target))
  };
};

export type SettlementUserInput = {
  userId: string;
  targets: readonly TargetVersion[];
  pointsOfficial: number;
  khoanCredits: number;
  khoanMoneyRaw: number;
  leaveDays: number;
};

/** Settles every given person for a period. Deterministic: the same inputs always give the same rows. */
export const settlePeriod = (input: { period: string; closeDay: number; prorateLeave: boolean; users: readonly SettlementUserInput[] }) => {
  const { from, to } = periodRange(input.period, input.closeDay);
  const workingDays = countWorkingDays(from, to);
  return {
    period: input.period,
    from,
    to,
    workingDays,
    items: input.users.map((user) => ({
      userId: user.userId,
      ...settleUser({
        targetBase: effectiveTarget(user.targets, "MONTH", input.period),
        prorateLeave: input.prorateLeave,
        workingDays,
        leaveDays: user.leaveDays,
        pointsOfficial: user.pointsOfficial,
        khoanCredits: user.khoanCredits,
        khoanMoneyRaw: user.khoanMoneyRaw
      })
    }))
  };
};

/** SPEC §8.3: a period closes at 23:59 business time on its close day. */
export const periodCloseInstant = (period: string, closeDay: number) => new Date(`${period}-${pad(closeDay)}T23:59:00+07:00`);

/** The most recent period whose close instant is not after `now`. */
export const latestClosedPeriod = (now: Date, closeDay: number) => {
  const current = periodOfDay(businessDay(now), closeDay);
  return now.getTime() >= periodCloseInstant(current, closeDay).getTime() ? current : shiftPeriod(current, -1);
};

/** How long after the close a stopped worker still catches up automatically (older periods: Admin runs them). */
export const autoSettleCatchUpDays = 7;

/**
 * The cron settles a period once it closed, unless a run already happened at or after the close
 * (automatic or by an Admin). Runs before the close are provisional and do not count.
 */
export const shouldAutoSettle = (input: { now: Date; period: string; closeDay: number; hasFinalRun: boolean }) => {
  const elapsed = input.now.getTime() - periodCloseInstant(input.period, input.closeDay).getTime();
  return !input.hasFinalRun && elapsed >= 0 && elapsed <= autoSettleCatchUpDays * 86_400_000;
};

export type KpiReportMonth = {
  period: string;
  target: number | null;
  pointsOfficial: number;
  khoanPointsConverted: number;
  totalPoints: number;
  khoanMoney: number;
};

/** Rollup key of a monthly period: "2026-Q4" or "2026". */
export const rollupKey = (periodType: "QUARTER" | "YEAR", period: string) =>
  periodType === "YEAR" ? period.slice(0, 4) : `${period.slice(0, 4)}-Q${Math.floor((Number(period.slice(5, 7)) - 1) / 3) + 1}`;

/** SPEC §8.4: quarter / year = sum of the months, against the explicit QUARTER/YEAR target or the sum of monthly targets. */
export const rollupKpi = (months: readonly KpiReportMonth[], explicitTarget: number | null) => {
  const sum = (pick: (month: KpiReportMonth) => number) => fromCents(months.reduce((total, month) => total + toCents(pick(month)), 0));
  const monthlyTargets = months.map((month) => month.target).filter((value): value is number => value !== null);
  const target = explicitTarget ?? (monthlyTargets.length > 0 ? fromCents(monthlyTargets.reduce((total, value) => total + toCents(value), 0)) : null);
  const totalPoints = sum((month) => month.totalPoints);
  return {
    pointsOfficial: sum((month) => month.pointsOfficial),
    khoanPointsConverted: sum((month) => month.khoanPointsConverted),
    totalPoints,
    khoanMoney: months.reduce((total, month) => total + month.khoanMoney, 0) + 0,
    target,
    percent: percentKpi(totalPoints, target),
    difference: target === null ? null : fromCents(toCents(totalPoints) - toCents(target))
  };
};
