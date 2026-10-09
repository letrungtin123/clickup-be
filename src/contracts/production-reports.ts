import { z } from "zod";

import { ProductionStatusRefSchema } from "./production-jobs.js";
import { PeriodKeySchema } from "./production-scores.js";
import { UserRefSchema } from "./work.js";

/**
 * Production (Photo Retouch) reports, dashboards, anomalies and Excel exports — docs/retouch/SPEC.md
 * Phase 5 (PLAN §7, §10). Shared FE/BE.
 *
 * Report builder: POST /production/reports/query with a ReportConfig returns flat, chart-ready rows
 * grouped by every chosen dimension. Dimensions and measures are whitelisted names; filters carry ids.
 *
 * Measure sources and date ranges (from/to are inclusive business days, Asia/Ho_Chi_Minh):
 *  - SCORES measures (points, points_khoan, money_khoan) sum the immutable score ledger
 *    (production.score_entries, adjustments included) by `business_day`. `user` = who earned the entry
 *    (worker or QC), `process` = the priced process (QC entries → "Checking").
 *  - TASKS measures count production.tasks anchored on `taskDate`: DONE (default) = the first Done
 *    (tasks never Done are left out), ASSIGNED = assigned_at, DEADLINE = deadline. `user` = assignee.
 *    task_count counts every task kind; fb_rate = fb_wrong_count / task_count; late_rate =
 *    late_count / task_count (late = `is_late`: not Done by its deadline).
 *  - `team` is the person's current team; `status` the task's current status; `month` the calendar
 *    month and `period` the KPI period (26 → 25 with settings.kpiCloseDay); `week` starts on Monday.
 *  - money_khoan is ADMIN only (403 otherwise). When settings.scoresPublic is off, non-admins cannot
 *    break points down by person.
 */

const Id = z.string().uuid();
const IsoDate = z.string().datetime({ offset: true });
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const BoolQuery = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

/** Hard bound of a report result (rows besides the totals). */
export const reportRowLimit = 5000;
/** Longest from → to range of one report, in days. */
export const reportMaxRangeDays = 366;

// Dimensions & measures --------------------------------------------------------------------------------

export const reportDimensions = ["user", "team", "project", "client", "process", "shift", "status", "task_kind", "job", "day", "week", "month", "period"] as const;
export const ReportDimensionSchema = z.enum(reportDimensions);
export type ReportDimension = z.infer<typeof ReportDimensionSchema>;

export const reportMeasures = [
  "points",
  "points_khoan",
  "money_khoan",
  "qty_done",
  "qty_assigned",
  "task_count",
  "late_count",
  "late_rate",
  "fb_wrong_count",
  "fb_rate",
  "qc_fail_count",
  "qc_fail_rate",
  "avg_hours_done",
  "ot_hours",
  "qty_per_worker_day"
] as const;
export const ReportMeasureSchema = z.enum(reportMeasures);
export type ReportMeasure = z.infer<typeof ReportMeasureSchema>;

export type ReportValueFormat = "text" | "day" | "week" | "month" | "points" | "money" | "count" | "images" | "percent" | "hours" | "decimal";

/** Chip labels (Vietnamese) for the builder. `time` dimensions sort chronologically. */
export const reportDimensionInfo: Record<ReportDimension, { label: string; kind: "entity" | "enum" | "time"; format: ReportValueFormat }> = {
  user: { label: "Nhân viên", kind: "entity", format: "text" },
  team: { label: "Team", kind: "entity", format: "text" },
  project: { label: "Dự án", kind: "entity", format: "text" },
  client: { label: "Client", kind: "entity", format: "text" },
  process: { label: "Quy trình", kind: "entity", format: "text" },
  shift: { label: "Ca", kind: "entity", format: "text" },
  status: { label: "Trạng thái", kind: "entity", format: "text" },
  task_kind: { label: "Loại task", kind: "enum", format: "text" },
  job: { label: "Job", kind: "entity", format: "text" },
  day: { label: "Ngày", kind: "time", format: "day" },
  week: { label: "Tuần", kind: "time", format: "week" },
  month: { label: "Tháng", kind: "time", format: "month" },
  period: { label: "Kỳ KPI", kind: "time", format: "month" }
};

/** `percent` values are fractions (0.1 = 10 %). `adminOnly` measures are refused for other roles. */
export const reportMeasureInfo: Record<ReportMeasure, { label: string; source: "SCORES" | "TASKS"; format: ReportValueFormat; adminOnly: boolean }> = {
  points: { label: "Điểm", source: "SCORES", format: "points", adminOnly: false },
  points_khoan: { label: "Điểm khoán", source: "SCORES", format: "points", adminOnly: false },
  money_khoan: { label: "Tiền khoán (VND)", source: "SCORES", format: "money", adminOnly: true },
  qty_done: { label: "Số tấm done", source: "TASKS", format: "images", adminOnly: false },
  qty_assigned: { label: "Số tấm giao", source: "TASKS", format: "images", adminOnly: false },
  task_count: { label: "Số task", source: "TASKS", format: "count", adminOnly: false },
  late_count: { label: "Task trễ", source: "TASKS", format: "count", adminOnly: false },
  late_rate: { label: "Tỉ lệ trễ", source: "TASKS", format: "percent", adminOnly: false },
  fb_wrong_count: { label: "Task FB sai", source: "TASKS", format: "count", adminOnly: false },
  fb_rate: { label: "Tỉ lệ FB", source: "TASKS", format: "percent", adminOnly: false },
  qc_fail_count: { label: "Lần QC fail", source: "TASKS", format: "count", adminOnly: false },
  qc_fail_rate: { label: "Tỉ lệ QC fail", source: "TASKS", format: "percent", adminOnly: false },
  avg_hours_done: { label: "Giờ TB giao → Done", source: "TASKS", format: "hours", adminOnly: false },
  ot_hours: { label: "Giờ OT", source: "TASKS", format: "hours", adminOnly: false },
  qty_per_worker_day: { label: "Tấm/người/ngày", source: "TASKS", format: "decimal", adminOnly: false }
};

export const TaskKindSchema = z.enum(["NORMAL", "FB_WRONG", "FB_EXTRA"]);
export const taskKindLabels: Record<z.infer<typeof TaskKindSchema>, string> = { NORMAL: "Thường", FB_WRONG: "FB sai", FB_EXTRA: "FB thêm" };

// Config ------------------------------------------------------------------------------------------------

const IdList = z.array(Id).min(1).max(500);

/** Multi-select filters (ids), one per dimension, plus tags (on the job, task, person or client). */
export const ReportFiltersSchema = z
  .object({
    user: IdList.optional(),
    team: IdList.optional(),
    project: IdList.optional(),
    client: IdList.optional(),
    process: IdList.optional(),
    shift: IdList.optional(),
    status: IdList.optional(),
    job: IdList.optional(),
    taskKind: z.array(TaskKindSchema).min(1).max(3).optional(),
    tag: z.array(Id).min(1).max(50).optional(),
    /** SCORES measures only: worker and/or QC entries. */
    scoreRole: z.array(z.enum(["WORKER", "QC"])).min(1).max(2).optional(),
    /** TASKS measures only: not Done yet (OPEN) or Done (DONE). */
    taskState: z.enum(["OPEN", "DONE"]).optional()
  })
  .strict();
export type ReportFilters = z.infer<typeof ReportFiltersSchema>;

export const reportRangePresets = ["TODAY", "YESTERDAY", "THIS_WEEK", "LAST_WEEK", "LAST_7_DAYS", "LAST_30_DAYS", "THIS_MONTH", "LAST_MONTH", "THIS_PERIOD", "LAST_PERIOD"] as const;
export const ReportRangePresetSchema = z.enum(reportRangePresets);
export type ReportRangePreset = z.infer<typeof ReportRangePresetSchema>;

export const ReportTaskDateSchema = z.enum(["DONE", "ASSIGNED", "DEADLINE"]);
export const ReportChartTypeSchema = z.enum(["TABLE", "PIVOT", "BAR", "LINE", "PIE"]);

const unique = (values: readonly string[]) => new Set(values).size === values.length;

export const ReportConfigSchema = z
  .object({
    dimensions: z.array(ReportDimensionSchema).max(4).default([]),
    measures: z.array(ReportMeasureSchema).min(1).max(reportMeasures.length),
    filters: ReportFiltersSchema.default({}),
    /** Relative range, resolved at run time (pinned reports stay current). Default THIS_PERIOD. */
    preset: ReportRangePresetSchema.optional(),
    /** Fixed range (both or none; not together with `preset`). At most 366 days. */
    from: DateOnly.optional(),
    to: DateOnly.optional(),
    taskDate: ReportTaskDateSchema.default("DONE"),
    sort: z
      .object({ key: z.union([ReportDimensionSchema, ReportMeasureSchema]), direction: z.enum(["asc", "desc"]).default("desc") })
      .strict()
      .optional(),
    limit: z.number().int().min(1).max(reportRowLimit).optional(),
    /** Presentation only (FE): chart type and the pivot "Hàng" / "Cột" split of the dimensions. */
    view: z
      .object({
        type: ReportChartTypeSchema.default("TABLE"),
        rows: z.array(ReportDimensionSchema).max(4).default([]),
        columns: z.array(ReportDimensionSchema).max(4).default([])
      })
      .strict()
      .optional()
  })
  .strict()
  .superRefine((config, ctx) => {
    if (!unique(config.dimensions)) {
      ctx.addIssue({ code: "custom", path: ["dimensions"], message: "Mỗi chiều chỉ chọn một lần." });
    }
    if (!unique(config.measures)) {
      ctx.addIssue({ code: "custom", path: ["measures"], message: "Mỗi chỉ số chỉ chọn một lần." });
    }
    if ((config.from === undefined) !== (config.to === undefined)) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "Cần cả ngày bắt đầu và ngày kết thúc." });
    }
    if (config.from !== undefined && config.preset !== undefined) {
      ctx.addIssue({ code: "custom", path: ["preset"], message: "Chọn kỳ có sẵn hoặc khoảng ngày, không chọn cả hai." });
    }
    if (config.from !== undefined && config.to !== undefined && config.from > config.to) {
      ctx.addIssue({ code: "custom", path: ["from"], message: "Ngày bắt đầu phải trước ngày kết thúc." });
    }
    if (config.sort && !(config.dimensions as string[]).includes(config.sort.key) && !(config.measures as string[]).includes(config.sort.key)) {
      ctx.addIssue({ code: "custom", path: ["sort", "key"], message: "Chỉ sắp xếp theo chiều hoặc chỉ số đã chọn." });
    }
    for (const part of ["rows", "columns"] as const) {
      if (config.view?.[part].some((dimension) => !config.dimensions.includes(dimension))) {
        ctx.addIssue({ code: "custom", path: ["view", part], message: "Hàng/cột phải là chiều đã chọn." });
      }
    }
  });
export type ReportConfig = z.infer<typeof ReportConfigSchema>;
export type ReportConfigInput = z.input<typeof ReportConfigSchema>;

// Result ------------------------------------------------------------------------------------------------

export const ReportColumnSchema = z.object({
  /** Row key: the dimension / measure name. Dimensions also carry `<name>_label`. */
  key: z.string(),
  kind: z.enum(["dimension", "measure"]),
  label: z.string(),
  format: z.enum(["text", "day", "week", "month", "points", "money", "count", "images", "percent", "hours", "decimal"])
});
export type ReportColumn = z.infer<typeof ReportColumnSchema>;

/**
 * One flat row: `<dimension>` = id (uuid) or key (YYYY-MM-DD day / Monday of the week, YYYY-MM month or
 * KPI period, task kind), `<dimension>_label` = display text, `<measure>` = number (rates and averages
 * may be null when the denominator is 0). Ready for Recharts (`dataKey` = column key).
 */
export const ReportRowSchema = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));
export type ReportRow = z.infer<typeof ReportRowSchema>;

export const ReportResultSchema = z.object({
  config: ReportConfigSchema,
  /** Resolved range (preset or fixed). */
  from: DateOnly,
  to: DateOnly,
  generatedAt: IsoDate,
  columns: z.array(ReportColumnSchema),
  rows: z.array(ReportRowSchema),
  /** Every measure over all rows (rates recomputed, not summed). */
  totals: z.record(z.string(), z.number().nullable()),
  /** More groups than `rowLimit` matched; narrow the range or filters. */
  truncated: z.boolean(),
  rowLimit: z.number().int()
});
export type ReportResult = z.infer<typeof ReportResultSchema>;

export const ReportExportRequestSchema = z
  .object({
    config: ReportConfigSchema,
    /** Shown in the config sheet (e.g. the saved report name). */
    name: z.string().trim().min(1).max(120).optional()
  })
  .strict();

// Saved reports -----------------------------------------------------------------------------------------

export const SavedReportSchema = z.object({
  id: Id,
  name: z.string(),
  description: z.string().nullable(),
  config: ReportConfigSchema,
  owner: UserRefSchema,
  /** Readable by every ADMIN / LEADER. */
  shared: z.boolean(),
  /** On the Admin dashboard (ADMIN only; implies shared). */
  pinned: z.boolean(),
  pinOrder: z.number().int(),
  /** Owner: edit / delete. ADMIN: delete, pin. */
  canEdit: z.boolean(),
  canDelete: z.boolean(),
  canPin: z.boolean(),
  createdAt: IsoDate,
  updatedAt: IsoDate
});
export type SavedReport = z.infer<typeof SavedReportSchema>;
export const SavedReportCollectionSchema = z.object({ items: z.array(SavedReportSchema) });

export const CreateSavedReportRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).nullable().optional(),
    config: ReportConfigSchema,
    shared: z.boolean().default(false),
    pinned: z.boolean().default(false),
    pinOrder: z.number().int().min(0).max(1000).optional()
  })
  .strict();
export type CreateSavedReportRequest = z.infer<typeof CreateSavedReportRequestSchema>;

export const UpdateSavedReportRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    config: ReportConfigSchema.optional(),
    shared: z.boolean().optional(),
    pinned: z.boolean().optional(),
    pinOrder: z.number().int().min(0).max(1000).optional()
  })
  .strict();
export type UpdateSavedReportRequest = z.infer<typeof UpdateSavedReportRequestSchema>;

// Anomalies ---------------------------------------------------------------------------------------------

export const anomalyKinds = ["QTY_MISMATCH", "QC_FAIL_REPEAT", "WORKER_FAIL_RATE", "FAST_DONE", "MISSING_CREDIT_RULE"] as const;
export const AnomalyKindSchema = z.enum(anomalyKinds);
export type AnomalyKind = z.infer<typeof AnomalyKindSchema>;
export const anomalyKindLabels: Record<AnomalyKind, string> = {
  QTY_MISMATCH: "Số lượng done khác số giao",
  QC_FAIL_REPEAT: "QC fail từ 2 lần",
  WORKER_FAIL_RATE: "Nhân viên có tỉ lệ lỗi cao",
  FAST_DONE: "Done trong 5 phút sau khi giao",
  MISSING_CREDIT_RULE: "Ghi điểm khi chưa có đơn giá"
};
/** Done this many minutes or less after the assignment is suspicious (SPEC §7.5). */
export const fastDoneMinutes = 5;

/** Server-computed subject of a review: a uuid, optionally followed by the reviewed state (":n"). */
export const AnomalyKeySchema = z
  .string()
  .max(80)
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:[0-9]{1,10}){0,3}$/, "Mã bất thường không hợp lệ.");

export const AnomalyQuerySchema = z.object({
  kind: AnomalyKindSchema.optional(),
  /** Look-back window in days (tasks Done / assigned / scored in it). */
  days: z.coerce.number().int().min(1).max(180).default(30),
  /** Also list rows already marked "Đã xem". */
  includeReviewed: BoolQuery
});

const AnomalyTaskRefSchema = z.object({ id: Id, number: z.number().int(), jobId: Id, jobCode: z.string() });
const AnomalyBase = {
  /** Pass back with the kind to POST /production/anomalies/review. */
  key: z.string(),
  /** When it happened (sorting, newest first). */
  at: IsoDate,
  task: AnomalyTaskRefSchema.nullable(),
  user: UserRefSchema.nullable(),
  reviewed: z.object({ by: UserRefSchema.nullable(), at: IsoDate, note: z.string().nullable() }).nullable()
};

export const AnomalySchema = z.discriminatedUnion("kind", [
  z.object({
    ...AnomalyBase,
    kind: z.literal("QTY_MISMATCH"),
    qtyAssigned: z.number().int(),
    qtyDone: z.number().int(),
    /** qtyDone − qtyAssigned. */
    difference: z.number().int(),
    /** Who set the current quantity: the worker at Done or the Leader/Admin correction. */
    changedBy: UserRefSchema.nullable(),
    changedAt: IsoDate.nullable(),
    source: z.enum(["DONE", "CORRECTION"]).nullable()
  }),
  z.object({ ...AnomalyBase, kind: z.literal("QC_FAIL_REPEAT"), qcFailCount: z.number().int(), status: ProductionStatusRefSchema }),
  z.object({
    ...AnomalyBase,
    kind: z.literal("WORKER_FAIL_RATE"),
    /** Tasks Done in the window. */
    taskCount: z.number().int(),
    fbWrongCount: z.number().int(),
    fbRate: z.number(),
    /** Tasks failed by QC at least once. */
    qcFailedCount: z.number().int(),
    qcFailRate: z.number(),
    threshold: z.number()
  }),
  z.object({ ...AnomalyBase, kind: z.literal("FAST_DONE"), assignedAt: IsoDate, doneAt: IsoDate, minutes: z.number(), qtyDone: z.number().int().nullable() }),
  z.object({
    ...AnomalyBase,
    kind: z.literal("MISSING_CREDIT_RULE"),
    role: z.enum(["WORKER", "QC"]),
    projectCode: z.string(),
    processName: z.string().nullable(),
    qty: z.number().int(),
    businessDay: DateOnly
  })
]);
export type Anomaly = z.infer<typeof AnomalySchema>;

export const AnomalyListSchema = z.object({
  since: IsoDate,
  days: z.number().int(),
  /** settings.anomalyFailRate. */
  threshold: z.number(),
  /** null = every job (ADMIN); otherwise the jobs led by this user. */
  leaderId: Id.nullable(),
  /** Unreviewed rows per kind (whatever includeReviewed is). */
  counts: z.record(AnomalyKindSchema, z.number().int()),
  items: z.array(AnomalySchema),
  /** A kind hit its row bound (500). */
  truncated: z.boolean()
});
export type AnomalyList = z.infer<typeof AnomalyListSchema>;

export const ReviewAnomalyRequestSchema = z
  .object({ kind: AnomalyKindSchema, key: AnomalyKeySchema, note: z.string().trim().max(500).optional() })
  .strict();
export const UnreviewAnomalyRequestSchema = z.object({ kind: AnomalyKindSchema, key: AnomalyKeySchema }).strict();
export const AnomalyReviewResultSchema = z.object({ kind: AnomalyKindSchema, key: z.string(), reviewedAt: IsoDate.nullable() });

// Dashboards --------------------------------------------------------------------------------------------

export const DashboardTaskSchema = z.object({
  id: Id,
  number: z.number().int(),
  job: z.object({ id: Id, code: z.string() }),
  assignee: UserRefSchema,
  qc: UserRefSchema.nullable(),
  status: ProductionStatusRefSchema,
  qtyAssigned: z.number().int(),
  deadline: IsoDate,
  /** Late: minutes past the deadline. Due soon: minutes left. */
  minutes: z.number().int()
});
export type DashboardTask = z.infer<typeof DashboardTaskSchema>;

export const LeaderDashboardQuerySchema = z.object({
  /** ADMIN only: another leader's view; ADMIN without it sees every job. */
  leaderId: Id.optional()
});

export const WorkloadRowSchema = z.object({
  user: UserRefSchema,
  teamId: Id.nullable(),
  teamName: z.string().nullable(),
  /** Images in tasks not started yet (Đã giao). */
  qtyNotStarted: z.number().int(),
  /** Images in tasks being worked on (Đang làm). */
  qtyProcessing: z.number().int(),
  openTasks: z.number().int(),
  /** Images / tasks first Done today (business day). */
  qtyDoneToday: z.number().int(),
  tasksDoneToday: z.number().int(),
  /** Approved leave today. */
  leaveToday: z.enum(["FULL_DAY", "MORNING", "AFTERNOON"]).nullable()
});

/** GET /production/dashboard/leader — LEADER (own jobs) or ADMIN. */
export const LeaderDashboardSchema = z.object({
  generatedAt: IsoDate,
  today: DateOnly,
  dueSoonHours: z.number().int(),
  leaderId: Id.nullable(),
  counts: z.object({ late: z.number().int(), dueSoon: z.number().int() }),
  /** Open (not Done) tasks past their deadline — red; most overdue first (≤ 200). */
  late: z.array(DashboardTaskSchema),
  /** Open tasks due within dueSoonHours — amber; soonest first (≤ 200). */
  dueSoon: z.array(DashboardTaskSchema),
  /** Every worker (STAFF / LEADER) and anyone with open tasks; all jobs. */
  workload: z.array(WorkloadRowSchema),
  /** Points (POINTS shifts) and Khoán points per team for the last 8 weeks (Monday keys), aligned with `weeks`. */
  teamPoints: z.object({
    weeks: z.array(DateOnly),
    series: z.array(z.object({ teamId: Id.nullable(), teamName: z.string(), points: z.array(z.number()), pointsKhoan: z.array(z.number()) }))
  })
});
export type LeaderDashboard = z.infer<typeof LeaderDashboardSchema>;

const ReportCardSchema = z.object({ title: z.string(), config: ReportConfigSchema, result: ReportResultSchema });

export const LateJobSchema = z.object({
  job: z.object({ id: Id, number: z.number().int(), code: z.string() }),
  projectCode: z.string(),
  leader: UserRefSchema,
  deadline: IsoDate,
  lateTaskCount: z.number().int(),
  /** Earliest deadline among its late open tasks. */
  oldestDeadline: IsoDate
});

export const KpiBucketSchema = z.object({
  key: z.enum(["LT50", "LT80", "LT100", "MET"]),
  label: z.string(),
  count: z.number().int()
});

/** GET /production/dashboard/admin — ADMIN. Every card carries the report-builder config that reproduces it. */
export const AdminDashboardSchema = z.object({
  generatedAt: IsoDate,
  today: DateOnly,
  period: z.object({ key: PeriodKeySchema, from: DateOnly, to: DateOnly }),
  cards: z.object({
    /** Điểm hôm nay toàn team (by team; totals = everyone). */
    pointsToday: ReportCardSchema,
    /** Job đang trễ: jobs with open tasks past their deadline. */
    lateJobs: z.object({
      title: z.string(),
      config: ReportConfigSchema,
      jobCount: z.number().int(),
      taskCount: z.number().int(),
      items: z.array(LateJobSchema)
    }),
    /** Tỉ lệ FB tháng theo NV (top 5). */
    fbRateByUser: ReportCardSchema,
    /** Tỉ lệ FB theo client (top 5). */
    fbRateByClient: ReportCardSchema,
    /** Năng suất theo ca (tấm/người/ngày). */
    productivityByShift: ReportCardSchema,
    /**
     * % đạt KPI kỳ hiện tại (phân bố) — GET /production/kpi/report figures for the current period
     * (settled, or what a settlement would give now): total points / target. Members without a target
     * are counted in withoutTarget, not in the buckets.
     */
    kpiAttainment: z.object({
      title: z.string(),
      config: ReportConfigSchema,
      period: PeriodKeySchema,
      members: z.number().int(),
      withoutTarget: z.number().int(),
      averagePercent: z.number().nullable(),
      buckets: z.array(KpiBucketSchema)
    })
  }),
  /** Saved reports pinned by an Admin (run them with POST /production/reports/query). */
  pinned: z.array(z.object({ id: Id, name: z.string(), config: ReportConfigSchema }))
});
export type AdminDashboard = z.infer<typeof AdminDashboardSchema>;

// Exports -----------------------------------------------------------------------------------------------
// GET /production/jobs/export          — query = JobQuerySchema (production-jobs), cursor/limit ignored, ≤ 5000 jobs.
// GET /production/scores/board/export  — query = ScoreBoardQuerySchema (production-scores); board visibility.
// GET /production/kpi/export           — query = KpiReportQuerySchema (production-scores); KPI report visibility.
// POST /production/reports/export      — body = ReportExportRequestSchema; report query permissions.
// Responses: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, attachment with an
// RFC 5987 UTF-8 filename* ("<title> <scope> (xuất YYYY-MM-DD).xlsx"). Errors before streaming are JSON.
