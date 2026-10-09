import { z } from "zod";

import { PayModeSchema, SafeText } from "./production-catalog.js";
import { UserRefSchema } from "./work.js";

/**
 * Production (Photo Retouch) scores & KPI — docs/retouch/SPEC.md Phase 3. Shared FE/BE.
 * Credits are decimals with 2 places (numbers); money is VND integers. Days are business calendar
 * days (YYYY-MM-DD, Asia/Ho_Chi_Minh). A KPI period "YYYY-MM" runs from the day after the previous
 * month's close day to this month's close day (settings.kpiCloseDay, e.g. 2026-10 = 26/09–25/10).
 */

const Id = z.string().uuid();
const IsoDate = z.string().datetime({ offset: true });
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
export const PeriodKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM.");

export const ScoreRoleSchema = z.enum(["WORKER", "QC"]);
export type ScoreRole = z.infer<typeof ScoreRoleSchema>;
export const KpiPeriodTypeSchema = z.enum(["MONTH", "QUARTER", "YEAR"]);
export type KpiPeriodType = z.infer<typeof KpiPeriodTypeSchema>;

// Score entries & summaries ---------------------------------------------------------------------------

/** One immutable ledger row. Adjustments (qty corrected after Done) carry deltas and `adjustsEntryId`. */
export const ScoreEntrySchema = z.object({
  id: Id,
  role: ScoreRoleSchema,
  task: z.object({ id: Id, number: z.number().int(), jobId: Id, jobCode: z.string() }),
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
  /** Credits of Khoán (MONEY_IF_KPI) shifts: money if the KPI is met at the close day, else converted to points. */
  pointsKhoan: z.number(),
  moneyKhoanProvisional: z.number().int(),
  qtyKhoan: z.number().int(),
  /** Part of pointsOfficial earned as QC. */
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

// Board ------------------------------------------------------------------------------------------------

export const ScoreBoardQuerySchema = z.object({ period: PeriodKeySchema.optional(), teamId: Id.optional() });

/**
 * GET /production/scores/board — public points (SPEC §5.4). `money` is null unless the row is the
 * caller's own, the caller is ADMIN, or settings.moneyPublic. The whole board is 403 when
 * settings.scoresPublic is off (ADMIN still sees it).
 */
export const ScoreBoardSchema = z.object({
  period: PeriodKeySchema,
  from: DateOnly,
  to: DateOnly,
  /** Money is visible for every row (ADMIN or money public). */
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

/** Score rows of one task (task detail). `money` is null unless the row is the caller's, the caller is ADMIN, or money is public. */
export const TaskScoreEntrySchema = ScoreEntrySchema.extend({ user: UserRefSchema, money: z.number().int().nullable() });
export type TaskScoreEntry = z.infer<typeof TaskScoreEntrySchema>;

export const TaskScoresSchema = z.object({
  taskId: Id,
  moneyVisible: z.boolean(),
  /** Oldest first: originals, then adjustments. */
  items: z.array(TaskScoreEntrySchema),
  /** Current value per role (original + adjustments). */
  totals: z.array(z.object({ role: ScoreRoleSchema, user: UserRefSchema, qty: z.number().int(), credits: z.number(), money: z.number().int().nullable() }))
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
  closeDay: z.number().int(),
  trigger: SettlementTriggerSchema,
  /** null = the scheduler. */
  runBy: UserRefSchema.nullable(),
  reason: z.string().nullable(),
  prorateLeave: z.boolean(),
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

/** One person's settled period (SPEC §8.1). Money fields are null unless the caller is ADMIN or the owner. */
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

/** Default period: the latest closed one. */
export const KpiSettlementQuerySchema = z.object({ period: PeriodKeySchema.optional() });
/** ADMIN: every row of the period plus its current run; other members: only their own row and no run. */
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

/** At most 24 periods. ADMIN sees everyone (optionally one team); other members only themselves. */
export const KpiReportQuerySchema = z.object({ from: PeriodKeySchema, to: PeriodKeySchema, teamId: Id.optional() });

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

export const KpiReportRollupSchema = z.object({
  userId: Id,
  periodType: z.enum(["QUARTER", "YEAR"]),
  /** "2026-Q4" or "2026". */
  key: z.string(),
  /** Monthly periods of the range inside this quarter/year. */
  periods: z.array(PeriodKeySchema),
  /** The target is an explicit QUARTER/YEAR target (otherwise the sum of monthly targets). */
  explicitTarget: z.boolean(),
  ...KpiFigures
});
export type KpiReportRollup = z.infer<typeof KpiReportRollupSchema>;

export const KpiReportSchema = z.object({
  from: PeriodKeySchema,
  to: PeriodKeySchema,
  periods: z.array(PeriodKeySchema),
  users: z.array(z.object({ user: UserRefSchema, teamId: Id.nullable(), teamName: z.string().nullable() })),
  rows: z.array(KpiReportRowSchema),
  rollups: z.array(KpiReportRollupSchema)
});
export type KpiReport = z.infer<typeof KpiReportSchema>;
