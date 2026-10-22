import { z } from "zod";

import { ProductionStatusRefSchema, ProductionTaskSchema } from "./production-jobs.js";

/**
 * PD-081 — "Tổng quan của tôi" (GET /production/my-overview): the signed-in member's own work at a glance — their task
 * lines, their own points / KPI and, for holders of QC, the lines waiting for their check. Every production member opens
 * it (the landing page of Staff / QC). Shared FE/BE.
 *
 * Never in the payload: the job's client deadline (Ngày giao of the Job Code), At risk, money or unit prices, anyone
 * else's points or tasks — except the lines whose QC is the caller (`qcQueue`). Task rows are the usual task DTO with
 * `myCredits` emptied and `points` null (no money, no prices); dates shown are the TASK deadline set by the Leader.
 *
 * Lines (subtasks are part of their line, PD-044) of live, not archived jobs:
 * - mine = assignee is the caller (the caller's own Checking lines included, PD-037);
 * - finished = PD-045 `isLineFinished` ("Đã check" or later — Complete, Đang giao client, Đã giao khách; a Checking line
 *   once Done) — except the retired line status Feedback, which counts as open work (as in Overview V2, PD-080);
 * - with QC = open and Done / Chờ QC / Đang check (Done waiting for the system move included);
 * - rework = open and in Cần sửa lại;
 * - late = open, not with QC, past its task deadline (a line sent back, Cần sửa lại, is late again once past it);
 * - due soon = open, not with QC, deadline not passed and at most `dueSoonMinutes` of core-window time left (the core
 *   window 09:30 – 16:30 of working days Mon–Sat, the Overview V2 settings when present).
 *
 * Range = organization-calendar days [from, to] (both included; default today, at most `myOverviewMaxDays`). A line is
 * shown when: open and its task deadline is in the range; finished and its finish time (closed_at, else checked_at, else
 * done_at) is in the range; ALWAYS (whatever the range) when it is late, rework, with QC or due soon. Tags, "Cần bạn xử
 * lý" and the list all cover the shown lines; the QC queue is never limited by the range.
 */

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
export const myOverviewMaxDays = 92;
/** "Đến hạn trong 3h": core-window minutes left before the task deadline (owner, 2026-10-22). */
export const myOverviewDueSoonMinutes = 180;
/** "Quá 2h" of a line waiting for QC when the organization has no Overview V2 alert setting (PD-080 `alertAfterHours`). */
export const myOverviewQcAlertHoursDefault = 2;
/** The core window when the organization has none configured (PD-080 default). */
export const myOverviewCoreWindowDefault = { start: "09:30", end: "16:30" } as const;
/** At most this many of my lines in `tasks` (counts always cover every shown line; `truncated` tells). */
export const myOverviewRowLimit = 300;
/** At most this many lines in the QC queue. */
export const myOverviewQcLimit = 300;

/** Days from `from` to `to`, both included (1 for a single day). */
export const myOverviewDaySpan = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/** GET /production/my-overview?from=&to= — both optional (none = today; one alone = that day). */
export const MyOverviewQuerySchema = z
  .object({
    from: DayQuery.optional(),
    to: DayQuery.optional()
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: "“Từ ngày” phải trước hoặc bằng “Đến ngày”.",
    path: ["to"]
  })
  .refine((query) => !query.from || !query.to || query.from > query.to || myOverviewDaySpan(query.from, query.to) <= myOverviewMaxDays, {
    message: `Chọn khoảng tối đa ${myOverviewMaxDays} ngày.`,
    path: ["to"]
  });
export type MyOverviewQuery = z.infer<typeof MyOverviewQuerySchema>;

/** The tags, in their fixed order ("qc" only for holders of QC). Each is a count and a filter of the list. */
export const myOverviewTagKeys = ["mine", "inProgress", "qc", "done", "late"] as const;
export const MyOverviewTagKeySchema = z.enum(myOverviewTagKeys);
export type MyOverviewTagKey = z.infer<typeof MyOverviewTagKeySchema>;
/** The tags that filter my own lines (the QC tag switches the list to the QC queue). */
export type MyOverviewListTag = Exclude<MyOverviewTagKey, "qc">;

/** Images of a line: "Số lượng giao" of the line plus its subtasks', and the Done quantities once Done (null = unknown). */
export const MyOverviewImagesSchema = z.object({
  assigned: z.number().int().nullable(),
  done: z.number().int().nullable()
});
export type MyOverviewImages = z.infer<typeof MyOverviewImagesSchema>;

/** One of my lines. */
export const MyOverviewTaskSchema = z.object({
  /** The task DTO (moves in `capabilities.transitions`, QC note in `lastQcFail`); `myCredits` empty, `points` null. */
  task: ProductionTaskSchema,
  /** "Copy folder": the job's drive / folder link, else the line's "Link chia việc"; null = none. */
  folderLink: z.string().nullable(),
  finished: z.boolean(),
  late: z.boolean(),
  rework: z.boolean(),
  withQc: z.boolean(),
  dueSoon: z.boolean(),
  /**
   * Core-window minutes from now to the task deadline (open work not with QC, deadline not passed; capped at a week of
   * core time); null otherwise.
   */
  dueCoreMinutes: Count.nullable(),
  /** When it became finished (the time that puts a finished line in the range); null while open. */
  finishedAt: IsoDate.nullable(),
  /** The latest time it entered Done (a line Done again after Cần sửa lại: the new time); null before Done. */
  lastDoneAt: IsoDate.nullable(),
  /** Waiting for QC (Chờ QC): since when and the core-window minutes since; null otherwise. */
  qcWait: z.object({ since: IsoDate, minutes: Count }).nullable(),
  images: MyOverviewImagesSchema
});
export type MyOverviewTask = z.infer<typeof MyOverviewTaskSchema>;

/** A line waiting for my check (Chờ QC) or that I am checking (Đang check). */
export const MyOverviewQcTaskSchema = z.object({
  task: ProductionTaskSchema,
  folderLink: z.string().nullable(),
  /** When it entered Chờ QC (latest; the Done time for lines without a history row). */
  waitingSince: IsoDate.nullable(),
  /** Core-window minutes it has waited: until now in Chờ QC, until the check started in Đang check. */
  waitMinutes: Count,
  /** In Chờ QC for at least the alert threshold of core time. */
  alert: z.boolean(),
  /** Đang check: when the check started (latest); null otherwise. */
  checkingSince: IsoDate.nullable(),
  /** Images to check: the line's Done quantity plus its subtasks' (else "Số lượng giao"); null = unknown. */
  images: z.number().int().nullable()
});
export type MyOverviewQcTask = z.infer<typeof MyOverviewQcTaskSchema>;

/** "Điểm của tôi": official points recorded (POINTS entries, worker and QC — as on Bảng điểm). Never money. */
export const MyOverviewPointsSchema = z.object({
  today: z.number(),
  week: z.object({ from: Day, to: Day, points: z.number() }),
  period: z.object({ period: z.string(), from: Day, to: Day, points: z.number() }),
  kpi: z.object({
    /** The period's MONTH target (prorated by approved leave when the setting is on); null = none. */
    target: z.number().nullable(),
    /** PD-066: the caller must have a KPI (a missing one is shown as "Chưa có KPI"). */
    required: z.boolean(),
    percent: z.number().nullable(),
    remaining: z.number().nullable(),
    /** Working days (Mon–Sat) left in the period, today included. */
    workingDaysLeft: Count,
    /** (target − points) ÷ working days left, rounded up to 2 decimals; null without a target, when met or no day left. */
    perDayNeeded: z.number().nullable()
  })
});
export type MyOverviewPoints = z.infer<typeof MyOverviewPointsSchema>;

export const MyOverviewTagSchema = z.object({
  count: Count,
  /** Known images of those lines (Done quantities for finished lines). */
  images: Count,
  /** Lines without a quantity yet (PD-058). */
  withoutQty: Count
});
export type MyOverviewTag = z.infer<typeof MyOverviewTagSchema>;

export const MyOverviewStatusCountSchema = z.object({ status: ProductionStatusRefSchema, count: Count });
export type MyOverviewStatusCount = z.infer<typeof MyOverviewStatusCountSchema>;

export const MyOverviewSchema = z.object({
  today: Day,
  timeZone: z.string(),
  generatedAt: IsoDate,
  range: z.object({ from: Day, to: Day }),
  viewer: z.object({
    /** Holds the production role QC: the "Chờ tôi QC" tag, its "Cần bạn xử lý" item and the QC queue. */
    qc: z.boolean()
  }),
  clock: z.object({ coreStart: z.string(), coreEnd: z.string(), dueSoonMinutes: Count, qcAlertMinutes: Count }),
  points: MyOverviewPointsSchema,
  tags: z.object({
    mine: MyOverviewTagSchema,
    inProgress: MyOverviewTagSchema,
    done: MyOverviewTagSchema,
    late: MyOverviewTagSchema,
    /** QC holders only (else null): the queue, the lines waiting past the alert and the longest wait (core minutes). */
    qc: z.object({ count: Count, overAlert: Count, longestWaitMinutes: Count }).nullable()
  }),
  /** "Cần bạn xử lý": 0 hides an item; the QC items are null without QC. */
  needs: z.object({
    rework: Count,
    late: Count,
    dueSoon: Count,
    qcWaiting: Count.nullable(),
    qcOverAlert: Count.nullable()
  }),
  /** The statuses present in each tag (workflow order) with their counts — the list's "Trạng thái" filter. */
  statusCounts: z.object({
    mine: z.array(MyOverviewStatusCountSchema),
    inProgress: z.array(MyOverviewStatusCountSchema),
    done: z.array(MyOverviewStatusCountSchema),
    late: z.array(MyOverviewStatusCountSchema)
  }),
  /**
   * My shown lines in list order (`myOverviewOrder`): Cần sửa lại, late, open by soonest task deadline, finished (latest
   * first) — at most `myOverviewRowLimit`.
   */
  tasks: z.array(MyOverviewTaskSchema),
  truncated: z.boolean(),
  /** QC holders only (else null): longest wait first. */
  qcQueue: z.array(MyOverviewQcTaskSchema).nullable()
});
export type MyOverview = z.infer<typeof MyOverviewSchema>;

/** List rank of a line: 0 Cần sửa lại, 1 late, 2 other open work, 3 finished. */
export const myOverviewRank = (line: Pick<MyOverviewTask, "finished" | "late" | "rework">) =>
  line.rework ? 0 : line.late ? 1 : line.finished ? 3 : 2;

/**
 * The list order: rank (myOverviewRank), then the soonest task deadline (open lines) or the latest finish (finished
 * lines), then the code.
 */
export const myOverviewOrder = (
  a: Pick<MyOverviewTask, "finished" | "late" | "rework" | "finishedAt"> & { task: Pick<MyOverviewTask["task"], "deadline" | "number"> },
  b: Pick<MyOverviewTask, "finished" | "late" | "rework" | "finishedAt"> & { task: Pick<MyOverviewTask["task"], "deadline" | "number"> }
) => {
  const rank = myOverviewRank(a) - myOverviewRank(b);
  if (rank !== 0) {
    return rank;
  }
  if (a.finished) {
    const byFinish = Date.parse(b.finishedAt ?? b.task.deadline) - Date.parse(a.finishedAt ?? a.task.deadline);
    return byFinish || b.task.number - a.task.number;
  }
  return Date.parse(a.task.deadline) - Date.parse(b.task.deadline) || a.task.number - b.task.number;
};

/** Which list tags a line belongs to ("mine" always). */
export const myOverviewTagsOf = (line: Pick<MyOverviewTask, "finished" | "late">): MyOverviewListTag[] => [
  "mine",
  ...(line.finished ? (["done"] as const) : (["inProgress"] as const)),
  ...(line.late ? (["late"] as const) : [])
];
