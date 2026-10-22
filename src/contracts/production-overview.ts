import { z } from "zod";

import { JobStatusKindSchema, ProductionRoleSchema } from "./production-catalog.js";
import { JobListScopeSchema, ProductionStatusRefSchema } from "./production-jobs.js";
import { UserRefSchema } from "./work.js";

/**
 * PD-080 — "Tổng quan" (Overview V2) of Photo Retouch for Leaders, Accounts, Quản trị and Director (GET
 * /production/overview). Replaces the PD-076 dashboard. Shared FE/BE.
 *
 * Who: holders of LEADER, ACCOUNT, ADMIN or DIRECTOR (the superadmin holds ADMIN + DIRECTOR). STAFF / QC alone → 403
 * OVERVIEW_FORBIDDEN (the app sends them to "Việc của tôi"). Which jobs: the job list's visibility (the "view" scope of the
 * job permission matrix, PD-036 — "none" → 403; live, not archived; PD-063 QA-test jobs and lines hidden from real
 * viewers). `scope=mine` = the jobs of the projects the caller (co-)owns (PD-078 / PD-079), `all` = every visible job;
 * omitted → "mine" for a caller holding LEADER but none of ADMIN / DIRECTOR / ACCOUNT, else "all" (`defaultOverviewScope`).
 *
 * Time rules (range = organization-calendar days [from, to], both included; now = the request time):
 *  1. a job whose CLIENT deadline (job "Ngày giao") is in the range is shown with ALL its task lines ("full");
 *  2. any other job shows only its lines whose TASK deadline is in the range; with none left it is hidden;
 *  3. unfinished late work always shows, whatever the range: lines past their task deadline that are not finished and
 *     not Done yet (the app's "Trễ hạn"), and client-late jobs (past the client deadline, kind not DELIVERING /
 *     DELIVERED) — a client-late job is "full" like rule 1;
 *  4. "Chưa chia" (a Job Code without any task line) counts only for "full" jobs (rule 1 or client-late).
 *
 * Task lines (subtasks are part of their line, PD-044): `stage` from the line status — Mới giao · Đang làm · Cần sửa lại ·
 * Chờ QC (Done waiting for QC included: the system moves it there) · Đang check · Feedback = group IN_PROGRESS; Đã check ·
 * Complete (and the older Đang giao client / Đã giao khách line statuses) = group DONE; a finished Checking line (Done) is
 * DONE (stage CHECKED). Images of a line = its "Số lượng" plus its subtasks' (Done quantities once finished); null when
 * unknown (PD-058). Checking lines check the same images: they count as tasks but their images are not added to image
 * totals.
 *
 * Cards: Tổng task = shown lines (images = work images, jobs = shown jobs) · Chưa chia = shown full jobs without any line
 * and not COMPLETE or later (images = their Tổng tấm) · Đang làm / Xong = lines by group · Trễ = overdue lines + client-late
 * jobs (images = overdue lines' work images).
 */

const Id = z.string().uuid();
const IsoDate = z.string().datetime({ offset: true });
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Count = z.number().int().nonnegative();
const Hours = z.number().nonnegative();

/** A calendar day "YYYY-MM-DD" in a query (impossible days such as 2026-02-31 are refused). */
const isCalendarDay = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const DayQuery = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày phải có dạng YYYY-MM-DD.")
  .refine(isCalendarDay, "Ngày không hợp lệ.");

/** Longest range, in days (both ends included): the page lists every job of the range, so a quarter at most. */
export const overviewMaxDays = 92;
/** `leader=me`: the PD-076 spelling of "Tôi quản lý", kept as an alias of `scope=mine` for older app builds. */
export const overviewLeaderMine = "me";

/** Days from `from` to `to`, both included (1 for a single day). */
export const overviewDaySpan = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/**
 * GET /production/overview. `from` / `to` (organization-calendar days, inclusive), missing → today (one end alone: that
 * day); `from` after `to` → 400, more than `overviewMaxDays` days → 400. `scope`: "mine" | "all" (default by role, see
 * above); `leader=me` = scope mine (deprecated).
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

// Roles ------------------------------------------------------------------------------------------------------------------

/** Roles that open the Overview (STAFF / QC alone do not: they land on "Việc của tôi"). */
export const overviewRoles = ["LEADER", "ACCOUNT", "ADMIN", "DIRECTOR"] as const;
type RoleList = readonly z.infer<typeof ProductionRoleSchema>[];
export const seesOverview = (roles: RoleList) => roles.some((role) => (overviewRoles as readonly string[]).includes(role));
/** "My Projects" for a Leader; "Tất cả" for Quản trị / Director / Account (a Leader holding one of them too: "Tất cả"). */
export const defaultOverviewScope = (roles: RoleList): z.infer<typeof JobListScopeSchema> =>
  roles.includes("LEADER") && !roles.some((role) => role === "ADMIN" || role === "DIRECTOR" || role === "ACCOUNT") ? "mine" : "all";
/** The "My Projects / Tất cả" switch: holders of LEADER or ADMIN (they can own projects, PD-078). */
export const hasOverviewScopeSwitch = (roles: RoleList) => roles.includes("LEADER") || roles.includes("ADMIN");
/** Leader's "Cần bạn xử lý" items: LEADER, ADMIN or DIRECTOR. */
export const getsLeaderNeeds = (roles: RoleList) => roles.some((role) => role === "LEADER" || role === "ADMIN" || role === "DIRECTOR");
/** Account's "Cần bạn xử lý" items: ACCOUNT (the superadmin does not hold it unless given). */
export const getsAccountNeeds = (roles: RoleList) => roles.includes("ACCOUNT");
/** The At risk history report: the superadmin (ADMIN) and DIRECTOR. */
export const seesRiskHistory = (roles: RoleList) => roles.includes("DIRECTOR");

// Task lines -----------------------------------------------------------------------------------------------------------

/** Where a line stands (its workflow status, by code). */
export const overviewTaskStages = ["ASSIGNED", "PROCESSING", "REWORK", "WAITING_QC", "QC_CHECKING", "FEEDBACK", "CHECKED", "COMPLETE"] as const;
export const OverviewTaskStageSchema = z.enum(overviewTaskStages);
export type OverviewTaskStage = z.infer<typeof OverviewTaskStageSchema>;
export const OverviewTaskGroupSchema = z.enum(["IN_PROGRESS", "DONE"]);
export type OverviewTaskGroup = z.infer<typeof OverviewTaskGroupSchema>;
export const inProgressStages: readonly OverviewTaskStage[] = ["ASSIGNED", "PROCESSING", "REWORK", "WAITING_QC", "QC_CHECKING", "FEEDBACK"];
export const doneStages: readonly OverviewTaskStage[] = ["CHECKED", "COMPLETE"];
export const groupOfStage = (stage: OverviewTaskStage): OverviewTaskGroup => (doneStages.includes(stage) ? "DONE" : "IN_PROGRESS");

/** "Chờ QC" clock of a line waiting for its QC (core-window minutes since it entered Chờ QC). */
export const OverviewQcWaitSchema = z.object({
  since: IsoDate,
  minutes: Count,
  /** minutes ≥ the alert threshold, or the QC is on leave now. */
  alert: z.boolean()
});
export type OverviewQcWait = z.infer<typeof OverviewQcWaitSchema>;

export const OverviewTaskSchema = z.object({
  id: Id,
  /** Display code ("#" + code). */
  code: z.string(),
  process: z.object({ id: Id, name: z.string(), isQc: z.boolean() }),
  assignee: UserRefSchema,
  qc: UserRefSchema.nullable(),
  status: ProductionStatusRefSchema,
  stage: OverviewTaskStageSchema,
  group: OverviewTaskGroupSchema,
  deadline: IsoDate,
  /** Not finished, not Done yet and past its task deadline (the app's "Trễ hạn"). */
  overdue: z.boolean(),
  /** Line + subtasks (Done quantities once finished); null = no quantity yet (PD-058). */
  images: z.number().int().nullable(),
  note: z.string().nullable(),
  qcWait: OverviewQcWaitSchema.nullable(),
  assigneeOnLeave: z.boolean(),
  qcOnLeave: z.boolean()
});
export type OverviewTask = z.infer<typeof OverviewTaskSchema>;

// Jobs -----------------------------------------------------------------------------------------------------------------

/**
 * The job column "Status" and the "Tổng task" dropdown: the job status kind, except READY = every live line finished
 * ("Đã check"; a Checking line Done) with at least one line while the kind is before COMPLETE ("Ready to complete").
 */
export const overviewJobPhases = ["NEW", "IN_PROGRESS", "FEEDBACK", "READY", "COMPLETE", "DELIVERING", "DELIVERED"] as const;
export const OverviewJobPhaseSchema = z.enum(overviewJobPhases);
export type OverviewJobPhase = z.infer<typeof OverviewJobPhaseSchema>;

/** At risk (an estimate; Leaders, Accounts, Quản trị, Director only — never Staff / QC). */
export const OverviewRiskReasonSchema = z.enum(["CAPACITY", "UNASSIGNED"]);
export type OverviewRiskReason = z.infer<typeof OverviewRiskReasonSchema>;
export const OverviewRiskSchema = z.object({
  /** CAPACITY: remaining work hours > the people working × core hours left; UNASSIGNED: no task, ≤ 1 working day left. */
  reason: OverviewRiskReasonSchema,
  since: IsoDate,
  workHours: Hours,
  capacityHours: Hours,
  /** Core-window hours from the last estimate to the client deadline. */
  hoursLeft: Hours,
  people: Count,
  evaluatedAt: IsoDate
});
export type OverviewRisk = z.infer<typeof OverviewRiskSchema>;

/** "Không cập nhật": core-window minutes since the last action on a job with New / Doing / Rework lines. */
export const OverviewStaleSchema = z.object({
  minutes: Count,
  /** IDLE: no action for ≥ the threshold; STAFF_ON_LEAVE: an assignee of such a line is on leave now (at once). */
  reason: z.enum(["IDLE", "STAFF_ON_LEAVE"])
});
export type OverviewStale = z.infer<typeof OverviewStaleSchema>;

export const OverviewJobImagesSchema = z.object({
  /** Work images of the shown lines that are finished (DONE group). */
  done: Count,
  /** Work images of the shown lines still in progress. */
  inProgress: Count,
  /** Full jobs only: max(0, Tổng tấm − work images given to someone on every line). */
  unassigned: Count,
  /** done + inProgress + unassigned. */
  total: Count
});

export const OverviewJobSchema = z.object({
  id: Id,
  code: z.string(),
  name: z.string().nullable(),
  project: z.object({ id: Id, code: z.string(), name: z.string() }),
  leader: UserRefSchema.nullable(),
  receivedAt: IsoDate,
  /** Client deadline (job "Ngày giao"). */
  deadline: IsoDate,
  createdAt: IsoDate,
  status: z.object({ id: Id, name: z.string(), color: z.string(), kind: JobStatusKindSchema }),
  phase: OverviewJobPhaseSchema,
  /** "Tổng tấm". */
  totalImages: Count,
  /** Shown with every line (rule 1 or client-late). */
  full: z.boolean(),
  clientLate: z.boolean(),
  /** "Chưa chia": a full job without any live line, kind before COMPLETE. */
  noTasks: z.boolean(),
  /** Live lines of the job (all, not only the shown ones). */
  lineCount: Count,
  images: OverviewJobImagesSchema,
  /** Shown work lines without a quantity yet. */
  tasksWithoutQty: Count,
  /** Last action on the job: a line status change, quantity, edit, comment (task_logs, comments), else its creation. */
  lastActivityAt: IsoDate,
  stale: OverviewStaleSchema.nullable(),
  risk: OverviewRiskSchema.nullable(),
  /** Account: created by a member holding ACCOUNT, still without a line after the alert threshold of core time. */
  newNotSplit: z.boolean(),
  /** In a project the caller (co-)owns. */
  owned: z.boolean(),
  /** Assignees of the job's live lines (first assigned first). */
  people: z.array(UserRefSchema),
  /** The shown lines, by task deadline. */
  tasks: z.array(OverviewTaskSchema)
});
export type OverviewJob = z.infer<typeof OverviewJobSchema>;

// Summary --------------------------------------------------------------------------------------------------------------

export const OverviewCardsSchema = z.object({
  total: z.object({ tasks: Count, images: Count, jobs: Count }),
  unassigned: z.object({ jobs: Count, images: Count }),
  inProgress: z.object({ tasks: Count, images: Count }),
  done: z.object({ tasks: Count, images: Count }),
  overdue: z.object({ tasks: Count, clientJobs: Count, images: Count })
});
export type OverviewCards = z.infer<typeof OverviewCardsSchema>;

/** "Cần bạn xử lý" of a Leader (Quản trị, Director): counts over the shown jobs; zero items are hidden by the app. */
export const OverviewLeaderNeedsSchema = z.object({
  atRisk: Count,
  unassignedJobs: Count,
  /** Images of lines waiting for QC past the threshold (or whose QC is on leave). */
  qcWaitImages: Count,
  feedbackJobs: Count,
  readyJobs: Count,
  staleJobs: Count
});
export type OverviewLeaderNeeds = z.infer<typeof OverviewLeaderNeedsSchema>;
/** "Cần bạn xử lý" of an Account. */
export const OverviewAccountNeedsSchema = z.object({
  readyToDeliver: Count,
  atRisk: Count,
  clientLate: Count,
  newNotSplit: Count
});
export type OverviewAccountNeeds = z.infer<typeof OverviewAccountNeedsSchema>;

/** A task stage of the dropdowns with the organization's name for it (the workflow status names). */
export const OverviewStageNameSchema = z.object({ stage: OverviewTaskStageSchema, name: z.string() });

export const ProductionOverviewSchema = z.object({
  /** Today in the organization timezone. */
  today: Day,
  timeZone: z.string(),
  generatedAt: IsoDate,
  range: OverviewRangeSchema,
  scope: JobListScopeSchema,
  viewer: z.object({
    /** Shows the "My Projects / Tất cả" switch. */
    scopeSwitch: z.boolean(),
    defaultScope: JobListScopeSchema,
    leaderNeeds: z.boolean(),
    accountNeeds: z.boolean(),
    /** "Chia task" on project rows (a task-creating role: not an Account alone, PD-079). */
    canAssign: z.boolean(),
    /** The At risk history report (superadmin, Director). */
    riskHistory: z.boolean()
  }),
  /** Shown jobs in each scope (the switch's counts); `mine` 0 without the switch. */
  scopeCounts: z.object({ mine: Count, all: Count }),
  clock: z.object({ coreStart: z.string(), coreEnd: z.string(), alertHours: z.number() }),
  stageNames: z.array(OverviewStageNameSchema),
  cards: OverviewCardsSchema,
  leaderNeeds: OverviewLeaderNeedsSchema.nullable(),
  accountNeeds: OverviewAccountNeedsSchema.nullable(),
  /** Shown jobs; the app groups them by project (most urgent first) — see `overviewJobOrder`. */
  jobs: z.array(OverviewJobSchema)
});
export type ProductionOverview = z.infer<typeof ProductionOverviewSchema>;

/** Most urgent first: client-late, then the soonest client deadline, then code. */
export const overviewJobOrder = (a: Pick<OverviewJob, "clientLate" | "deadline" | "code">, b: Pick<OverviewJob, "clientLate" | "deadline" | "code">) =>
  Number(b.clientLate) - Number(a.clientLate) || a.deadline.localeCompare(b.deadline) || a.code.localeCompare(b.code);

// Team load (Chia task) ------------------------------------------------------------------------------------------------

/**
 * GET /production/team-load (PD-080, "Chia task" suggestions and the assignee picker; LEADER / ADMIN). "Ảnh đang ôm" of
 * each active production member holding STAFF, QC or LEADER = images of their lines (and subtasks) in Mới giao / Đang làm
 * / Cần sửa lại over every live job (not Chờ QC), per project, biggest first; lines without a quantity are counted apart.
 * `leave`: approved leave today (`now`: covering this moment — not selectable).
 */
export const TeamMemberLoadSchema = z.object({
  user: UserRefSchema,
  roles: z.array(ProductionRoleSchema),
  leave: z.object({ part: z.enum(["FULL_DAY", "MORNING", "AFTERNOON"]), now: z.boolean() }).nullable(),
  /** Open lines (Mới giao / Đang làm / Cần sửa lại). 0 = "Rảnh". */
  openTasks: Count,
  images: Count,
  tasksWithoutQty: Count,
  byProject: z.array(z.object({ project: z.object({ id: Id, code: z.string() }), images: Count, tasks: Count }))
});
export type TeamMemberLoad = z.infer<typeof TeamMemberLoadSchema>;
export const TeamLoadSchema = z.object({ today: Day, generatedAt: IsoDate, members: z.array(TeamMemberLoadSchema) });
export type TeamLoad = z.infer<typeof TeamLoadSchema>;

// At risk history ------------------------------------------------------------------------------------------------------

/**
 * GET /production/overview/risk-history?from=&to= (PD-080; superadmin and Director): jobs with an At risk episode that
 * started in [from, to] (organization days; default the last 8 weeks, at most 400 days), per week (Monday), per Leader
 * (of the job when the episode started) and per project, and how many of them were really client-late (delivered —
 * first move to a DELIVERING / DELIVERED status — after the client deadline, or still undelivered past it).
 */
export const riskHistoryMaxDays = 400;
export const RiskHistoryQuerySchema = z
  .object({ from: DayQuery.optional(), to: DayQuery.optional() })
  .refine((query) => !query.from || !query.to || query.from <= query.to, { message: "“Từ ngày” phải trước hoặc bằng “Đến ngày”.", path: ["to"] })
  .refine((query) => !query.from || !query.to || query.from > query.to || overviewDaySpan(query.from, query.to) <= riskHistoryMaxDays, {
    message: `Chọn khoảng tối đa ${riskHistoryMaxDays} ngày.`,
    path: ["to"]
  });
export type RiskHistoryQuery = z.infer<typeof RiskHistoryQuerySchema>;
const RiskCount = z.object({ jobs: Count, clientLate: Count });
export const RiskHistoryJobSchema = z.object({
  job: z.object({ id: Id, code: z.string(), project: z.object({ id: Id, code: z.string() }) }),
  leader: UserRefSchema.nullable(),
  reason: OverviewRiskReasonSchema,
  startedAt: IsoDate,
  endedAt: IsoDate.nullable(),
  endReason: z.enum(["CLEARED", "FINISHED", "CLIENT_LATE", "REMOVED"]).nullable(),
  deadline: IsoDate,
  episodes: Count,
  clientLate: z.boolean()
});
export type RiskHistoryJob = z.infer<typeof RiskHistoryJobSchema>;
export const RiskHistorySchema = OverviewRangeSchema.extend({
  totals: RiskCount.extend({ episodes: Count, open: Count }),
  weeks: z.array(RiskCount.extend({ week: Day })),
  leaders: z.array(RiskCount.extend({ leader: UserRefSchema.nullable() })),
  projects: z.array(RiskCount.extend({ project: z.object({ id: Id, code: z.string(), name: z.string() }) })),
  /** Newest first, at most 200. */
  jobs: z.array(RiskHistoryJobSchema)
});
export type RiskHistory = z.infer<typeof RiskHistorySchema>;
