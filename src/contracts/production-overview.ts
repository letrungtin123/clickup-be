import { z } from "zod";

import { JobLeaderTabsSchema, JobListScopeSchema, ProductionStatusRefSchema } from "./production-jobs.js";
import { UserRefSchema } from "./work.js";

/**
 * PD-076 — "Tổng quan" of Photo Retouch (GET /production/overview): the whole module at a glance. Shared FE/BE.
 *
 * Every number covers the task LINES (subtasks are part of their line, PD-044) of the jobs the caller may see — the
 * visibility of GET /production/jobs: the "view" scope of the job permission matrix (PD-036; "none" → 403), live jobs
 * (not deleted, not archived), PD-063 jobs created by / lines assigned to a temporary QA test account hidden from a real
 * viewer. `scope=mine` ("Tôi quản lý", PD-078) narrows them to the jobs of the projects the caller owns (strictly: a
 * job they lead in someone else's project is not among them); the older `leader=me` (PD-076) means the same.
 *
 * Definitions (one line = one row of "Việc của tôi"):
 * - Ngày nhận = the line's `assignedAt`, Ngày giao = its `deadline`; days are organization-calendar days (settings
 *   timezone, Asia/Ho_Chi_Minh), both ends of a range included.
 * - Đã xong (finished) = the workflow's finished-line rule (PD-045 `isLineFinished`): "Đã check" or a later / terminal
 *   status, or a Checking line once Done.
 * - Chưa bắt đầu = not finished and still in the workflow's initial status ("Mới giao"); Đang làm = every other line
 *   that is not finished (Đang làm, Cần sửa lại, Done / Chờ QC / Đang check waiting for QC, …).
 *   total = notStarted + inProgress + done.
 * - Quá hạn = not finished, not Done yet and its Ngày giao has passed — the app's lateness rule ("Trễ hạn"): a line Done
 *   on time and waiting for QC is not late. overdue ≤ notStarted + inProgress.
 */

const Id = z.string().uuid();
const IsoDate = z.string().datetime({ offset: true });
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Count = z.number().int().nonnegative();

/** A calendar day "YYYY-MM-DD" in a query (impossible days such as 2026-02-31 are refused). */
const isCalendarDay = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const DayQuery = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày phải có dạng YYYY-MM-DD.")
  .refine(isCalendarDay, "Ngày không hợp lệ.");

/** Longest range, in days (both ends included). */
export const overviewMaxDays = 400;
/** A range shorter than this is charted over this many days, ending on its last day ("Hôm nay" → the last 7 days). */
export const overviewChartMinDays = 7;
/** Rows per "Task sắp đến hạn" tab (each tab also says how many lines it has in all). */
export const overviewDueLimit = 50;
/** Projects of the volume donut before the rest is folded into "Khác". */
export const overviewProjectSlices = 6;
/** `leader=me`: the PD-076 spelling of "Tôi quản lý", kept as an alias of `scope=mine` (PD-078) for older app builds. */
export const overviewLeaderMine = "me";

/** Days from `from` to `to`, both included (1 for a single day). */
export const overviewDaySpan = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/**
 * GET /production/overview. `from` / `to` (organization-calendar days, inclusive): the range of Ngày nhận the stats,
 * the status and volume donuts count; missing → today (one end alone: that single day). `from` after `to` → 400, more
 * than `overviewMaxDays` days → 400. `scope`: "mine" (projects I own, PD-078) or "all"; `leader`: only "me" (= scope
 * mine, deprecated).
 */
export const ProductionOverviewQuerySchema = z
  .object({
    from: DayQuery.optional(),
    to: DayQuery.optional(),
    scope: JobListScopeSchema.optional(),
    leader: z.literal(overviewLeaderMine).optional()
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: "“Từ ngày” phải trước hoặc bằng “Đến ngày”.",
    path: ["to"]
  })
  .refine((query) => !query.from || !query.to || query.from > query.to || overviewDaySpan(query.from, query.to) <= overviewMaxDays, {
    message: `Chọn khoảng tối đa ${overviewMaxDays} ngày.`,
    path: ["to"]
  });
export type ProductionOverviewQuery = z.infer<typeof ProductionOverviewQuerySchema>;

export const OverviewRangeSchema = z.object({ from: Day, to: Day });
export type OverviewRange = z.infer<typeof OverviewRangeSchema>;

/** The lines received (Ngày nhận) in the range — see the definitions above. */
export const OverviewStatsSchema = z.object({
  total: Count,
  notStarted: Count,
  inProgress: Count,
  done: Count,
  overdue: Count
});
export type OverviewStats = z.infer<typeof OverviewStatsSchema>;

/**
 * The same counts for the days just before the range (as many days as the range has up to today), for "so với …";
 * null when the range starts after today.
 */
export const OverviewComparisonSchema = OverviewRangeSchema.extend({ total: Count, done: Count });
export type OverviewComparison = z.infer<typeof OverviewComparisonSchema>;

/** The range's lines in one workflow status (its colour from the workflow), `overdue` of them Quá hạn. */
export const OverviewStatusSliceSchema = z.object({ status: ProductionStatusRefSchema, count: Count, overdue: Count });
export type OverviewStatusSlice = z.infer<typeof OverviewStatusSliceSchema>;

/**
 * One business day of the chart: lines received that day (Ngày nhận) and lines finished that day (when they became
 * finished — `closed_at`, else checked / Done time for lines finished before PD-045), whenever they were received.
 */
export const OverviewDaySchema = z.object({ day: Day, received: Count, done: Count });
export type OverviewDay = z.infer<typeof OverviewDaySchema>;

/** Every day from `from` to `to` (zero-filled): the range, widened to `overviewChartMinDays` days when shorter. */
export const OverviewDailySchema = OverviewRangeSchema.extend({ days: z.array(OverviewDaySchema) });
export type OverviewDaily = z.infer<typeof OverviewDailySchema>;

export const OverviewProjectRefSchema = z.object({ id: Id, code: z.string(), name: z.string() });
export type OverviewProjectRef = z.infer<typeof OverviewProjectRefSchema>;

/**
 * Volume of one project in the range: `qty` = images of its work lines received in the range — "Số lượng giao" of
 * NORMAL lines and their subtasks (PD-044), Checking lines left out (they check the same images, like the job's image
 * totals), known quantities only (PD-058); `lines` = its task lines (as in `stats.total`). `project` null = "Khác" (the
 * projects after the first `overviewProjectSlices`, `projectCount` of them).
 */
export const OverviewVolumeSliceSchema = z.object({
  project: OverviewProjectRefSchema.nullable(),
  projectCount: Count,
  qty: Count,
  lines: Count
});
export type OverviewVolumeSlice = z.infer<typeof OverviewVolumeSliceSchema>;

/** Largest first, only projects with images; `withoutQty` = work lines of the range without a quantity yet. */
export const OverviewVolumeSchema = z.object({
  totalQty: Count,
  withoutQty: Count,
  slices: z.array(OverviewVolumeSliceSchema)
});
export type OverviewVolume = z.infer<typeof OverviewVolumeSchema>;

/**
 * Current progress of an ACTIVE project over its OPEN jobs (independent of the date range, follows the scope tab): open
 * = live (not deleted, not archived) and its manual job status is not "đóng" (`isClosed`, e.g. "Đã giao khách"). Only
 * projects with at least one open job in scope. `imagesTotal` = the jobs' "Tổng tấm"; `imagesDone` / `imagesChecked` =
 * Done / checked quantities of their work lines (the job list's "Tiến độ"); `lateJobs` = open jobs with a late line
 * (the job list's "Trễ hạn"). Projects with late jobs first, then the most open jobs, then by code.
 */
export const OverviewProjectProgressSchema = z.object({
  project: OverviewProjectRefSchema,
  openJobs: Count,
  lateJobs: Count,
  imagesTotal: Count,
  imagesDone: Count,
  imagesChecked: Count
});
export type OverviewProjectProgress = z.infer<typeof OverviewProjectProgressSchema>;

/** One line of "Task sắp đến hạn". `overdue`: not Done and Ngày giao passed (Quá hạn). */
export const OverviewDueTaskSchema = z.object({
  id: Id,
  /** Display code ("#" + code in the UI). */
  code: z.string(),
  jobId: Id,
  /** The job's "Gói công việc". */
  jobCode: z.string(),
  project: OverviewProjectRefSchema,
  process: z.object({ id: Id, name: z.string() }),
  assignee: UserRefSchema,
  status: ProductionStatusRefSchema,
  deadline: IsoDate,
  overdue: z.boolean(),
  /** null: no quantity yet (PD-058). */
  qtyAssigned: z.number().int().nullable()
});
export type OverviewDueTask = z.infer<typeof OverviewDueTaskSchema>;

/**
 * Open (not finished) lines whose Ngày giao falls in [from, to] (business days): soonest first, at most
 * `overviewDueLimit` of `total`. Lines of the window already past their Ngày giao stay, marked `overdue`; lines due
 * before the window are not listed (they are counted in Quá hạn / the job list's "Trễ hạn").
 */
export const OverviewDueListSchema = OverviewRangeSchema.extend({ total: Count, items: z.array(OverviewDueTaskSchema) });
export type OverviewDueList = z.infer<typeof OverviewDueListSchema>;

export const ProductionOverviewSchema = z.object({
  /** Today in the organization timezone. */
  today: Day,
  timeZone: z.string(),
  generatedAt: IsoDate,
  range: OverviewRangeSchema,
  /**
   * The "Tất cả" / "Tôi quản lý" tabs, for a caller holding LEADER or ADMIN (null otherwise): the range's lines over every
   * visible job (`all`) and over the jobs of the projects they own (`mine`, PD-078).
   */
  leaderTabs: JobLeaderTabsSchema.nullable(),
  stats: OverviewStatsSchema,
  previous: OverviewComparisonSchema.nullable(),
  /** By workflow order; statuses without lines left out. */
  byStatus: z.array(OverviewStatusSliceSchema),
  daily: OverviewDailySchema,
  volume: OverviewVolumeSchema,
  projects: z.array(OverviewProjectProgressSchema),
  /** Due today (not tied to the range). */
  dueToday: OverviewDueListSchema,
  /** Due this week, Monday – Sunday (not tied to the range). */
  dueThisWeek: OverviewDueListSchema
});
export type ProductionOverview = z.infer<typeof ProductionOverviewSchema>;
