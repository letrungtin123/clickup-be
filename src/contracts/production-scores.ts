import { z } from "zod";

import {
  CustomFieldFiltersSchema,
  IdListQuerySchema,
  KhoanPayPolicySchema,
  PayModeSchema,
  SafeText,
  type KpiCloseDayVersion
} from "./production-catalog.js";
import { UserRefSchema } from "./work.js";

/**
 * Production (Photo Retouch) scores & KPI — docs/retouch/SPEC.md Phase 3. Shared FE/BE.
 * Credits are decimals with 2 places (numbers); money is VND integers. Days are business calendar
 * days (YYYY-MM-DD, Asia/Ho_Chi_Minh). A KPI period "YYYY-MM" runs from the day after the previous
 * period's close day to this month's close day (e.g. 2026-10 = 26/09–25/10 with close day 25). Close day 31
 * = "Cuối tháng" (PD-032): the last day of each month, so the period is the calendar month (2026-02 = 01/02–28/02).
 * Each period's close day comes from settings.kpiCloseDays (a change applies from the next period): use
 * kpiPeriodRange / kpiPeriodOfDay below.
 */

const Id = z.string().uuid();
const IsoDate = z.string().datetime({ offset: true });
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
export const PeriodKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM.");

// KPI periods with a close-day history (G15) ----------------------------------------------------------------

/** One close day for every period, or the versions of settings.kpiCloseDays. */
export type KpiCloseDays = number | readonly KpiCloseDayVersion[];

const pad2 = (value: number) => String(value).padStart(2, "0");
const shiftMonth = (period: string, months: number) => {
  const index = Number(period.slice(0, 4)) * 12 + Number(period.slice(5, 7)) - 1 + months;
  return `${Math.floor(index / 12)}-${pad2((index % 12) + 1)}`;
};
const nextDay = (day: string) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

/** Close day of a period: the version with the latest fromPeriod ≤ period (fromPeriod null = since always). */
export const closeDayOfPeriod = (closeDays: KpiCloseDays, period: string): number => {
  if (typeof closeDays === "number") {
    return closeDays;
  }
  let best: KpiCloseDayVersion | null = null;
  let earliest: KpiCloseDayVersion | null = null;
  for (const version of closeDays) {
    const from = version.fromPeriod ?? "";
    if (from <= period && (best === null || from > (best.fromPeriod ?? ""))) {
      best = version;
    }
    if (earliest === null || from < (earliest.fromPeriod ?? "")) {
      earliest = version;
    }
  }
  return (best ?? earliest)?.closeDay ?? 25;
};

const daysInMonth = (period: string) => new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate();

/**
 * Day of the month on which a period closes: its close day clamped to the month's length, so 31 "Cuối tháng"
 * (PD-032) is the 28th/29th in February and the 30th in 30-day months; 1–28 exist in every month.
 */
export const closingDayOfPeriod = (closeDays: KpiCloseDays, period: string) => Math.min(closeDayOfPeriod(closeDays, period), daysInMonth(period));

/** Business days of a period: the day after the previous period's closing day … this period's closing day. */
export const kpiPeriodRange = (period: string, closeDays: KpiCloseDays) => {
  const previous = shiftMonth(period, -1);
  return {
    from: nextDay(`${previous}-${pad2(closingDayOfPeriod(closeDays, previous))}`),
    to: `${period}-${pad2(closingDayOfPeriod(closeDays, period))}`
  };
};

/**
 * KPI period ("YYYY-MM") of a business day: this month while the day ≤ this month's closing day, else the next one
 * (with 31 "Cuối tháng" every day stays in its own month).
 */
export const kpiPeriodOfDay = (day: string, closeDays: KpiCloseDays) => {
  const period = day.slice(0, 7);
  return Number(day.slice(8, 10)) <= closingDayOfPeriod(closeDays, period) ? period : shiftMonth(period, 1);
};

/** WORKER: a work line's assignee; QC: a Checking line's assignee (PD-037). */
export const ScoreRoleSchema = z.enum(["WORKER", "QC"]);
export type ScoreRole = z.infer<typeof ScoreRoleSchema>;
export const KpiPeriodTypeSchema = z.enum(["MONTH", "QUARTER", "YEAR"]);
export type KpiPeriodType = z.infer<typeof KpiPeriodTypeSchema>;

// Score entries & summaries ---------------------------------------------------------------------------

/** One immutable ledger row. Adjustments (qty corrected after Done) carry deltas and `adjustsEntryId`. */
export const ScoreEntrySchema = z.object({
  id: Id,
  role: ScoreRoleSchema,
  /** `code`: the task's display code ("1216" / subtask "1216a", PD-045). */
  task: z.object({ id: Id, number: z.number().int(), code: z.string(), jobId: Id, jobCode: z.string() }),
  project: z.object({ id: Id, code: z.string() }),
  /** Process whose price applied: the task's process (WORKER) or the QC process "Checking" (QC). */
  process: z.object({ id: Id, name: z.string() }).nullable(),
  shift: z.object({ id: Id, name: z.string() }),
  payMode: PayModeSchema,
  kind: z.enum(["NORMAL", "FB_WRONG", "FB_EXTRA"]),
  qty: z.number().int(),
  unitCredits: z.number(),
  credits: z.number(),
  money: z.number().int(),
  /** No credit rule existed for the pair that day: recorded with 0 credits (shows in anomalies). */
  missingRule: z.boolean(),
  businessDay: DateOnly,
  period: PeriodKeySchema,
  adjustsEntryId: Id.nullable(),
  note: z.string().nullable(),
  createdAt: IsoDate
});
export type ScoreEntry = z.infer<typeof ScoreEntrySchema>;

export const ScoreTotalsSchema = z.object({
  /** Credits of POINTS shifts (worker + QC): counts toward the KPI. */
  pointsOfficial: z.number(),
  /**
   * Credits of Khoán (MONEY_IF_KPI) shifts. At the close (settings.khoanPayPolicy, PD-033): ALWAYS → the money is
   * paid, the credits never count; IF_KPI → money if the KPI is met, else converted to points.
   */
  pointsKhoan: z.number(),
  moneyKhoanProvisional: z.number().int(),
  /** Images of the person's own Khoán-shift lines (Checking lines included, PD-037). */
  qtyKhoan: z.number().int(),
  /** Part of pointsOfficial earned as QC (POINTS-shift Checking lines, PD-037). */
  qcPoints: z.number()
});
export type ScoreTotals = z.infer<typeof ScoreTotalsSchema>;

export const ScoreSummarySchema = ScoreTotalsSchema.extend({
  byDay: z.array(z.object({ day: DateOnly, pointsOfficial: z.number(), pointsKhoan: z.number() })),
  byProject: z.array(z.object({ projectId: Id, projectCode: z.string(), pointsOfficial: z.number(), pointsKhoan: z.number(), qty: z.number().int() }))
});
export type ScoreSummary = z.infer<typeof ScoreSummarySchema>;

export const MyScoresQuerySchema = z.object({
  /** Default: the current KPI period. At most 366 days. */
  from: DateOnly.optional(),
  to: DateOnly.optional(),
  /** Next page of `entries` (pageInfo of the previous response); summary and cards are recomputed. */
  cursor: SafeText().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100)
});

/** GET /production/scores/me — own scores (money is always visible to its owner). */
export const MyScoresSchema = z.object({
  from: DateOnly,
  to: DateOnly,
  today: DateOnly,
  summary: ScoreSummarySchema,
  /** Fixed cards relative to today, independent of from/to. Week = Monday–Sunday. */
  cards: z.object({
    today: ScoreTotalsSchema,
    week: ScoreTotalsSchema,
    period: ScoreTotalsSchema.extend({ period: PeriodKeySchema, from: DateOnly, to: DateOnly })
  }),
  /**
   * One page of the range's entries, newest first (keyset by recording time, PERF-09); the summary always
   * covers the whole range. More pages: pass `nextCursor` as `cursor`.
   */
  entries: z.array(ScoreEntrySchema),
  /** More entries exist after this page (same as nextCursor !== null). */
  truncated: z.boolean(),
  nextCursor: z.string().nullable()
});
export type MyScores = z.infer<typeof MyScoresSchema>;

// Another member's scores — "Điểm cá nhân" (PD-052) -------------------------------------------------------

const HiddenMoney = z.number().int().nullable();

/** Totals of another member: `moneyKhoanProvisional` is null while the viewer may not see that person's money. */
export const ScoreTotalsViewSchema = ScoreTotalsSchema.extend({ moneyKhoanProvisional: HiddenMoney });
export type ScoreTotalsView = z.infer<typeof ScoreTotalsViewSchema>;
/** A ledger row of another member: `money` is null while hidden. */
export const ScoreEntryViewSchema = ScoreEntrySchema.extend({ money: HiddenMoney });
export type ScoreEntryView = z.infer<typeof ScoreEntryViewSchema>;

/**
 * GET /production/scores/user/:userId — "Điểm cá nhân" of one production member (PD-052): what GET
 * /production/scores/me gives its owner (same query, same paging), for that person, plus who they are. Someone else's
 * needs the `view_others_scores` feature (PD-065; by default every role) — 403 SCORES_PRIVATE otherwise; a user who is
 * not an active production member of the organization → 404 SCORE_USER_NOT_FOUND. Money (`moneyKhoanProvisional` of
 * the summary and the cards, `money` of the entries) is null unless the person is the caller, the caller has
 * `view_others_money` (PD-065), or settings.moneyPublic (`moneyVisible`).
 */
export const UserScoresSchema = MyScoresSchema.extend({
  /** The person (e-mail only for themselves and the people who organise the work, SEC2-09). */
  user: UserRefSchema,
  teamId: Id.nullable(),
  teamName: z.string().nullable(),
  /** The caller sees this person's money. */
  moneyVisible: z.boolean(),
  summary: ScoreSummarySchema.extend({ moneyKhoanProvisional: HiddenMoney }),
  cards: z.object({
    today: ScoreTotalsViewSchema,
    week: ScoreTotalsViewSchema,
    period: ScoreTotalsViewSchema.extend({ period: PeriodKeySchema, from: DateOnly, to: DateOnly })
  }),
  entries: z.array(ScoreEntryViewSchema)
});
export type UserScores = z.infer<typeof UserScoresSchema>;

// Forecast & KPI progress ------------------------------------------------------------------------------

export const KpiProgressSchema = z.object({
  periodType: KpiPeriodTypeSchema,
  /** Monthly periods accumulated (quarter = 3, year = 12). */
  periods: z.array(PeriodKeySchema),
  points: z.number(),
  /** Explicit QUARTER/YEAR target, else the sum of monthly targets; null = no target. */
  target: z.number().nullable(),
  percent: z.number().nullable()
});
export type KpiProgress = z.infer<typeof KpiProgressSchema>;

export const ForecastToneSchema = z.enum(["MET", "ON_TRACK", "AT_RISK", "BEHIND", "NO_TARGET"]);
export type ForecastTone = z.infer<typeof ForecastToneSchema>;

export const ForecastQuerySchema = z.object({ period: PeriodKeySchema.optional() });

/** GET /production/scores/forecast — "Còn {remaining} điểm, còn {daysLeft} ngày, cần {avgPerDayNeeded}/ngày". */
export const ScoreForecastSchema = z.object({
  period: PeriodKeySchema,
  from: DateOnly,
  to: DateOnly,
  /** Configured close day of the period (31 = "Cuối tháng"); `to` is the actual closing date. */
  closeDay: z.number().int(),
  today: DateOnly,
  /** Monthly target before leave proration. */
  targetBase: z.number().nullable(),
  target: z.number().nullable(),
  pointsOfficial: z.number(),
  pointsKhoan: z.number(),
  moneyKhoanProvisional: z.number().int(),
  remaining: z.number().nullable(),
  /**
   * Calendar days left to the close day, today and the close day both included (0 once the period closed):
   * on the close day itself it is 1. `to` is the close day. (PR-24: the one convention for every screen.)
   */
  daysLeft: z.number().int(),
  /** Of which Monday–Saturday. */
  workingDaysLeft: z.number().int(),
  avgPerDayNeeded: z.number().nullable(),
  percent: z.number().nullable(),
  /** green: MET / ON_TRACK, yellow: AT_RISK, red: BEHIND. */
  tone: ForecastToneSchema,
  /** settings.kpiProrateLeave; the target is prorated only when leave days are known (leaveDays ≠ null). */
  prorateLeave: z.boolean(),
  leaveDays: z.number().nullable(),
  kpi: z.object({ month: KpiProgressSchema, quarter: KpiProgressSchema, year: KpiProgressSchema })
});
export type ScoreForecast = z.infer<typeof ScoreForecastSchema>;

/**
 * GET /production/scores/user/:userId/forecast — the KPI forecast of one production member (PD-052, same rules as
 * GET /production/scores/user/:userId); `moneyKhoanProvisional` is null unless the caller sees that person's money.
 */
export const UserScoreForecastSchema = ScoreForecastSchema.extend({ moneyKhoanProvisional: HiddenMoney });
export type UserScoreForecast = z.infer<typeof UserScoreForecastSchema>;

// Board ------------------------------------------------------------------------------------------------

/**
 * `tagId` (USER tags, any of them) and `cf.<key>=…` (USER custom fields, e.g. cf.nang_luc=A) are ADMIN only
 * (members' tags and custom values are Admin data): 403 CUSTOM_FIELDS_FORBIDDEN for others.
 */
export const ScoreBoardQuerySchema = z.object({
  period: PeriodKeySchema.optional(),
  teamId: Id.optional(),
  tagId: IdListQuerySchema,
  cf: CustomFieldFiltersSchema
});

/**
 * GET /production/scores/board — public points (SPEC §5.4) for the roles of `view_others_scores` (PD-065; by default
 * every role, the superadmin always; others 403 SCORES_PRIVATE — settings.scoresPublic stays retired, PD-052). `money`
 * is null unless the row is the caller's own, the caller has `view_others_money` (PD-065), or settings.moneyPublic.
 * Each row opens that person's "Điểm cá nhân" (GET /production/scores/user/:userId).
 */
export const ScoreBoardSchema = z.object({
  period: PeriodKeySchema,
  from: DateOnly,
  to: DateOnly,
  /** Money is visible for every row (`view_others_money` or money public). */
  moneyVisible: z.boolean(),
  items: z.array(
    z.object({
      rank: z.number().int(),
      user: UserRefSchema,
      teamId: Id.nullable(),
      teamName: z.string().nullable(),
      pointsOfficial: z.number(),
      pointsKhoan: z.number(),
      qtyKhoan: z.number().int(),
      money: z.number().int().nullable()
    })
  )
});
export type ScoreBoard = z.infer<typeof ScoreBoardSchema>;

// KPI targets (ADMIN) -----------------------------------------------------------------------------------

export const KpiTargetSchema = z.object({
  id: Id,
  userId: Id,
  periodType: KpiPeriodTypeSchema,
  targetPoints: z.number(),
  /** First KPI period the version applies to; it applies until the next version. */
  effectiveFrom: PeriodKeySchema,
  note: z.string().nullable(),
  updatedBy: UserRefSchema.nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate
});
export type KpiTarget = z.infer<typeof KpiTargetSchema>;

export const KpiTargetCellSchema = z.object({
  period: PeriodKeySchema,
  /** Target effective for the period (possibly inherited from an earlier version). */
  targetPoints: z.number().nullable(),
  targetId: Id.nullable(),
  effectiveFrom: PeriodKeySchema.nullable(),
  /** The version starts exactly at this period. */
  explicit: z.boolean()
});
export type KpiTargetCell = z.infer<typeof KpiTargetCellSchema>;

export const KpiTargetMatrixQuerySchema = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() });

/** GET /production/kpi-targets — users × the 12 monthly periods of a year, plus quarter/year targets and history. */
export const KpiTargetMatrixSchema = z.object({
  year: z.number().int(),
  periods: z.array(PeriodKeySchema),
  rows: z.array(
    z.object({
      user: UserRefSchema,
      teamId: Id.nullable(),
      roles: z.array(z.string()),
      months: z.array(KpiTargetCellSchema),
      quarters: z.array(KpiTargetCellSchema),
      year: KpiTargetCellSchema
    })
  ),
  /** Every version (newest first per user/type) with effective_from up to the end of the year. */
  history: z.array(KpiTargetSchema)
});
export type KpiTargetMatrix = z.infer<typeof KpiTargetMatrixSchema>;

const TargetPoints = z.number().min(0).max(1_000_000).multipleOf(0.01);

export const PutKpiTargetsRequestSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            userId: Id,
            periodType: KpiPeriodTypeSchema.default("MONTH"),
            /** QUARTER: 01/04/07/10; YEAR: 01. A version for the same start replaces it. */
            effectiveFrom: PeriodKeySchema,
            targetPoints: TargetPoints,
            note: SafeText().trim().max(500).optional()
          })
          .strict()
      )
      .min(1)
      .max(500)
  })
  .strict();
export const KpiTargetCollectionSchema = z.object({ items: z.array(KpiTargetSchema) });

export const KpiTargetImportRequestSchema = z
  .object({
    /** Columns user_email,target (header required; other columns ignored). */
    csv: SafeText().min(1).max(1_000_000),
    period: PeriodKeySchema,
    periodType: KpiPeriodTypeSchema.default("MONTH")
  })
  .strict();
export const KpiTargetImportResultSchema = z.object({
  ok: z.boolean(),
  imported: z.number().int(),
  errors: z.array(z.object({ line: z.number().int(), message: z.string() }))
});
export type KpiTargetImportResult = z.infer<typeof KpiTargetImportResultSchema>;

export const ApplyDefaultKpiRequestSchema = z.object({ period: PeriodKeySchema }).strict();
/** Members (STAFF/LEADER/QC) without a MONTH target for the period get kpiDefaultLeader (LEADER) or kpiDefaultMember. */
export const ApplyDefaultKpiResultSchema = z.object({
  period: PeriodKeySchema,
  created: z.number().int(),
  skipped: z.number().int(),
  items: z.array(z.object({ userId: Id, targetPoints: z.number() }))
});
export type ApplyDefaultKpiResult = z.infer<typeof ApplyDefaultKpiResultSchema>;

// Task scores ------------------------------------------------------------------------------------------------

/**
 * Score rows of one task (task detail): everyone's rows, for whoever may see the task (PD-052) — only the caller's own
 * without `view_others_scores` (PD-065). `money` is null unless the row is the caller's, the caller has
 * `view_others_money`, or money is public.
 */
export const TaskScoreEntrySchema = ScoreEntrySchema.extend({ user: UserRefSchema, money: z.number().int().nullable() });
export type TaskScoreEntry = z.infer<typeof TaskScoreEntrySchema>;

export const TaskScoresSchema = z.object({
  taskId: Id,
  moneyVisible: z.boolean(),
  /**
   * Oldest first: originals, then adjustments. PD-048: a task's page also lists the rows of its subtasks (each scored by
   * its own process and quantity) — `item.task.code` tells which.
   */
  items: z.array(TaskScoreEntrySchema),
  /** Current value per role (original + adjustments), the task and its subtasks together. */
  totals: z.array(z.object({ role: ScoreRoleSchema, user: UserRefSchema, qty: z.number().int(), credits: z.number(), money: z.number().int().nullable() })),
  /**
   * PD-048: the same visible rows grouped by process ("Công đoạn") — the task's own process and each subtask's — in
   * workflow order of first appearance: images, credits, the unit price of the originals (null when they differ) and
   * whether a price was missing (recorded with 0 credits).
   */
  byProcess: z.array(
    z.object({
      process: z.object({ id: Id, name: z.string() }).nullable(),
      qty: z.number().int(),
      credits: z.number(),
      unitCredits: z.number().nullable(),
      missingRule: z.boolean()
    })
  )
});
export type TaskScores = z.infer<typeof TaskScoresSchema>;

// KPI settlement (Phase 6) --------------------------------------------------------------------------------------

export const SettlementTriggerSchema = z.enum(["AUTO", "MANUAL"]);

/** One run of the settlement for a period (cron at 23:59 on the close day, or an Admin re-run with a reason). */
export const KpiSettlementRunSchema = z.object({
  id: Id,
  period: PeriodKeySchema,
  from: DateOnly,
  to: DateOnly,
  /** Close day the run used (31 = "Cuối tháng"). */
  closeDay: z.number().int(),
  trigger: SettlementTriggerSchema,
  /** null = the scheduler. */
  runBy: UserRefSchema.nullable(),
  reason: z.string().nullable(),
  prorateLeave: z.boolean(),
  /** Khoán pay policy the run used (settings.khoanPayPolicy at run time; runs before PD-033 used IF_KPI). */
  khoanPolicy: KhoanPayPolicySchema,
  userCount: z.number().int(),
  metCount: z.number().int(),
  notMetCount: z.number().int(),
  khoanMoneyTotal: z.number().int(),
  khoanPointsConvertedTotal: z.number(),
  replacedCount: z.number().int(),
  startedAt: IsoDate,
  finishedAt: IsoDate.nullable(),
  /** The period's current rows come from this run (later runs replace them). */
  current: z.boolean()
});
export type KpiSettlementRun = z.infer<typeof KpiSettlementRunSchema>;

/**
 * One person's settled period (SPEC §8.1). Money fields are null unless the caller has `view_others_money` (PD-065) or is
 * the owner, or settings.moneyPublic.
 */
export const KpiSettlementSchema = z.object({
  id: Id,
  user: UserRefSchema,
  period: PeriodKeySchema,
  from: DateOnly,
  to: DateOnly,
  targetBase: z.number().nullable(),
  /** Applied target (prorated by approved leave when prorateLeave). null = no KPI → met. */
  target: z.number().nullable(),
  prorateLeave: z.boolean(),
  workingDays: z.number().int(),
  leaveDays: z.number(),
  pointsOfficial: z.number(),
  met: z.boolean(),
  khoanCredits: z.number(),
  khoanMoneyRaw: z.number().int().nullable(),
  khoanMoney: z.number().int().nullable(),
  khoanPointsConverted: z.number(),
  /** pointsOfficial + khoanPointsConverted. */
  totalPoints: z.number(),
  percent: z.number().nullable(),
  /** Vượt (+) / thiếu (−) versus the target. */
  difference: z.number().nullable(),
  /** Khoán pay policy of the run that produced the row (PD-033). */
  khoanPolicy: KhoanPayPolicySchema,
  runId: Id,
  runAt: IsoDate,
  note: z.string().nullable()
});
export type KpiSettlement = z.infer<typeof KpiSettlementSchema>;

export const RunKpiSettlementRequestSchema = z
  .object({ period: PeriodKeySchema, reason: SafeText().trim().min(3, "Nhập lý do (ít nhất 3 ký tự).").max(500) })
  .strict();
export const KpiSettlementRunResultSchema = z.object({ run: KpiSettlementRunSchema, items: z.array(KpiSettlementSchema) });
export type KpiSettlementRunResult = z.infer<typeof KpiSettlementRunResultSchema>;

/**
 * Default period: the latest closed one. `userId` (PD-052, "Điểm cá nhân"): only that production member's row (someone
 * else's needs `view_others_scores`, PD-065: 403 SCORES_PRIVATE), for
 * any production member (404 SCORE_USER_NOT_FOUND when the user is not an active production member).
 */
export const KpiSettlementQuerySchema = z.object({ period: PeriodKeySchema.optional(), userId: Id.optional() });
/** ADMIN: every row of the period plus its current run; other members: only their own row (or `userId`'s) and no run. */
export const KpiSettlementListSchema = z.object({
  period: PeriodKeySchema,
  run: KpiSettlementRunSchema.nullable(),
  items: z.array(KpiSettlementSchema)
});
export type KpiSettlementList = z.infer<typeof KpiSettlementListSchema>;

export const KpiSettlementRunQuerySchema = z.object({
  period: PeriodKeySchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});
export const KpiSettlementRunCollectionSchema = z.object({ items: z.array(KpiSettlementRunSchema) });

// KPI report --------------------------------------------------------------------------------------------------

/**
 * At most 24 periods. ADMIN sees everyone (optionally one team, USER tags `tagId` and USER custom fields
 * `cf.<key>=…`); other members only themselves (tag / custom-field filters → 403 CUSTOM_FIELDS_FORBIDDEN).
 * `userId` (PD-052, "Điểm cá nhân"): only that production member — someone else needs `view_others_scores` (PD-065,
 * 403 SCORES_PRIVATE); 404 SCORE_USER_NOT_FOUND when the user is not an active production member. Khoán money:
 * `view_others_money` (PD-065), the owner, or settings.moneyPublic.
 */
export const KpiReportQuerySchema = z.object({
  from: PeriodKeySchema,
  to: PeriodKeySchema,
  userId: Id.optional(),
  teamId: Id.optional(),
  tagId: IdListQuerySchema,
  cf: CustomFieldFiltersSchema
});

const KpiFigures = {
  target: z.number().nullable(),
  pointsOfficial: z.number(),
  khoanPointsConverted: z.number(),
  totalPoints: z.number(),
  percent: z.number().nullable(),
  difference: z.number().nullable(),
  khoanMoney: z.number().int().nullable()
};

export const KpiReportRowSchema = z.object({
  userId: Id,
  period: PeriodKeySchema,
  /** false = not settled yet: figures are what a settlement would give now (provisional). */
  settled: z.boolean(),
  targetBase: z.number().nullable(),
  khoanCredits: z.number(),
  met: z.boolean(),
  leaveDays: z.number(),
  ...KpiFigures
});
export type KpiReportRow = z.infer<typeof KpiReportRowSchema>;

/**
 * Quarter / year of one person (SPEC §8.4 "Quý/năm = cộng các tháng"): ALWAYS the whole quarter/year, whatever
 * the selected range — the sum of its monthly periods that have started (settled, or provisional), against the
 * explicit QUARTER/YEAR target, else the sum of the monthly targets of all its months. `complete` = every month
 * of it has started; `settled` = every month of it is settled.
 */
export const KpiReportRollupSchema = z.object({
  userId: Id,
  periodType: z.enum(["QUARTER", "YEAR"]),
  /** "2026-Q4" or "2026". */
  key: z.string(),
  /** Monthly periods summed: the started months of the quarter/year (also those outside the selected range). */
  periods: z.array(PeriodKeySchema),
  /** The target is an explicit QUARTER/YEAR target (otherwise the sum of monthly targets). */
  explicitTarget: z.boolean(),
  complete: z.boolean(),
  settled: z.boolean(),
  ...KpiFigures
});
export type KpiReportRollup = z.infer<typeof KpiReportRollupSchema>;

/**
 * Total rows of the KPI report (PLAN §6 "theo NV, team"): per team (scope TEAM; teamId null = people without a
 * team) and for everyone shown (scope ORG), per month of the range (periodType MONTH, key "YYYY-MM") and per
 * quarter / year (keys as the rollups). Sums over the people shown: target = Σ targets (null when nobody has
 * one), points, converted Khoán points, total; percent = total / target; difference = total − target;
 * khoanMoney = Σ (null unless the caller sees everyone's money: `view_others_money` or moneyPublic, PD-065). ADMIN only
 * ([] for others).
 */
export const KpiReportTotalSchema = z.object({
  scope: z.enum(["TEAM", "ORG"]),
  teamId: Id.nullable(),
  teamName: z.string().nullable(),
  periodType: z.enum(["MONTH", "QUARTER", "YEAR"]),
  key: z.string(),
  memberCount: z.number().int(),
  /** People with a target among memberCount. */
  withTargetCount: z.number().int(),
  /** MONTH: people who met the KPI that month; QUARTER/YEAR: people at ≥ 100 %. */
  metCount: z.number().int(),
  ...KpiFigures
});
export type KpiReportTotal = z.infer<typeof KpiReportTotalSchema>;

export const KpiReportSchema = z.object({
  from: PeriodKeySchema,
  to: PeriodKeySchema,
  periods: z.array(PeriodKeySchema),
  users: z.array(z.object({ user: UserRefSchema, teamId: Id.nullable(), teamName: z.string().nullable() })),
  rows: z.array(KpiReportRowSchema),
  rollups: z.array(KpiReportRollupSchema),
  /** Team and organization totals (ADMIN; [] for others). */
  totals: z.array(KpiReportTotalSchema)
});
export type KpiReport = z.infer<typeof KpiReportSchema>;
