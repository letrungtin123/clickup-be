import { z } from "zod";

import { createCursorPageSchema } from "./pagination.js";
import { CustomFieldFiltersSchema, CustomValuesSchema, IdListQuerySchema, IsoDateInputSchema, PayModeSchema, SafeText } from "./production-catalog.js";
import { textRuleMessages } from "./schemas.js";
import { colorTokens, UserRefSchema } from "./work.js";

/**
 * Production (Photo Retouch) jobs & tasks — docs/retouch/SPEC.md Phase 2. Shared FE/BE.
 * A job is a batch of images for a project; a task gives N images of it to one person for one process.
 */

const Id = z.string().uuid();
const IsoDate = z.string().datetime({ offset: true });
/** Request instants (PR-16: impossible dates are a 400, not a database error). */
const IsoDateInput = IsoDateInputSchema;
const Color = z.enum(colorTokens);
const BoolQuery = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

export const ProductionStatusRefSchema = z.object({ id: Id, code: z.string(), name: z.string(), color: Color });
export type ProductionStatusRef = z.infer<typeof ProductionStatusRefSchema>;

/** A job's manual status (PD-038, catalog in production-catalog JobStatusSchema). */
export const JobStatusRefSchema = z.object({
  id: Id,
  name: z.string(),
  color: Color,
  isClosed: z.boolean(),
  /** PD-045: chosen only when every line of the job is "Đã check" (e.g. "Đã xong"). */
  requiresAllChecked: z.boolean()
});
export type JobStatusRef = z.infer<typeof JobStatusRefSchema>;

export const TaskKindSchema = z.enum(["NORMAL", "FB_WRONG", "FB_EXTRA"]);
export type TaskKind = z.infer<typeof TaskKindSchema>;

// Tasks ---------------------------------------------------------------------------------------------

export const TaskTransitionOptionSchema = z.object({
  toStatusId: Id,
  requiresNote: z.boolean(),
  /** Entering a "done" status: ask for qty_done (defaults to qty_assigned). */
  asksQty: z.boolean(),
  /** OT shift: offer the overtime hours when entering a "done" status (optional, PD-035; prefilled with the line's). */
  asksOtHours: z.boolean(),
  /** Only allowed as an ADMIN override (reason required). */
  override: z.boolean()
});
export type TaskTransitionOption = z.infer<typeof TaskTransitionOptionSchema>;

/**
 * PD-044: a worker's request to change the quantity the Leader gave on a line ("Số lượng giao", the total of the line
 * and its subtasks). The job's Leader — or anyone with "update: all" (Account / Admin) — approves or rejects it; until
 * then the line keeps its quantity. One PENDING request per line.
 */
export const TaskQtyRequestSchema = z.object({
  id: Id,
  taskId: Id,
  /** The total when asked, and the total asked for. */
  fromQty: z.number().int(),
  toQty: z.number().int(),
  reason: z.string(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]),
  requestedBy: UserRefSchema.nullable(),
  createdAt: IsoDate,
  decidedBy: UserRefSchema.nullable(),
  decidedAt: IsoDate.nullable(),
  decisionNote: z.string().nullable()
});
export type TaskQtyRequest = z.infer<typeof TaskQtyRequestSchema>;

/**
 * PD-044: a subtask as its parent line lists it. A subtask is part of the line's images done in another process
 * ("Công đoạn"), split off by the worker with a reason: same person, QC, shift and dates as the line; its quantity is
 * taken from the line (the total the Leader gave stays the same) and its status always follows the line's.
 */
export const ProductionSubtaskSchema = z.object({
  id: Id,
  number: z.number().int(),
  /** Display code: its line's number + a letter, e.g. "1216a" (PD-045). */
  code: z.string(),
  process: z.object({ id: Id, name: z.string() }),
  /** PD-058: null = "chưa có số lượng" (the worker fills it in by Done at the latest). */
  qtyAssigned: z.number().int().nullable(),
  qtyDone: z.number().int().nullable(),
  reason: z.string().nullable(),
  createdBy: UserRefSchema.nullable(),
  createdAt: IsoDate
});
export type ProductionSubtask = z.infer<typeof ProductionSubtaskSchema>;

export const ProductionTaskSchema = z.object({
  id: Id,
  /** Internal sequence number; show `code` instead. */
  number: z.number().int(),
  /**
   * PD-045 display code ("#" + code in the UI): a line's number ("1216"); a subtask's line number + a letter in creation
   * order ("1216a", "1216b", …, letters never reused).
   */
  code: z.string(),
  jobId: Id,
  /** The job's "Gói công việc" (work package, PD-035). */
  jobCode: z.string(),
  project: z.object({ id: Id, code: z.string(), name: z.string() }),
  assignee: UserRefSchema,
  qc: UserRefSchema.nullable(),
  process: z.object({ id: Id, name: z.string(), isQc: z.boolean() }),
  shift: z.object({ id: Id, name: z.string(), payMode: PayModeSchema, requiresOtHours: z.boolean() }),
  /**
   * PD-058: null = "chưa có số lượng" — the quantity is optional until Done (the worker fills it in directly, or in the
   * Done dialog). Totals count known numbers only. Never null once the task is Done (doneAt set).
   */
  qtyAssigned: z.number().int().nullable(),
  qtyDone: z.number().int().nullable(),
  /** "Hình lỗi": display / review only, never changes points or money (PD-035). */
  errorQty: z.number().int().nullable(),
  /** "Giờ OT": optional on every shift (PD-035). */
  otHours: z.number().nullable(),
  /** "Ngày nhận" of the line (user-entered; defaults to the job's). */
  assignedAt: IsoDate,
  /** "Ngày giao" of the line (user-entered; defaults to the job's). */
  deadline: IsoDate,
  doneAt: IsoDate.nullable(),
  checkedAt: IsoDate.nullable(),
  status: ProductionStatusRefSchema,
  kind: TaskKindSchema,
  /** Feedback redo task: its source task. Subtask (PD-044, `isSubtask`): its line. */
  parentTaskId: Id.nullable(),
  /** PD-044: part of a line done in another process; status follows `parentTaskId`'s, no moves of its own. */
  isSubtask: z.boolean(),
  /** Subtask: why the worker split it off (PD-044). */
  splitReason: z.string().nullable(),
  /** A line's subtasks (always empty on a subtask or a feedback redo task), oldest first. */
  subtasks: z.array(ProductionSubtaskSchema),
  /**
   * "Số lượng Leader giao": this line's quantity plus its subtasks' (= qtyAssigned when it has none). A subtask: its
   * own quantity. PD-058: known numbers only (a task without a quantity counts 0 here — look at qtyAssigned).
   */
  allocatedQty: z.number().int(),
  /** The open quantity change request of the line (PD-044), if any. */
  pendingQtyRequest: TaskQtyRequestSchema.nullable(),
  feedbackId: Id.nullable(),
  note: z.string().nullable(),
  /** "Link chia việc" (PD-040): link or folder path of the images given to the assignee; any text, null = none. */
  workLink: z.string().nullable(),
  isLate: z.boolean(),
  /** The task's job is archived: the task is read-only (PD-014 / BUG-PR-04). */
  jobArchived: z.boolean(),
  qcFailCount: z.number().int(),
  customValues: CustomValuesSchema,
  tagIds: z.array(Id),
  /**
   * Points recorded for the CALLER on this task ("điểm từng task", PLAN §7): the score ledger per role, adjustments
   * (quantity corrections) included. Empty when nothing was recorded for the caller (not Done / not Checked yet,
   * or someone else's task).
   */
  myCredits: z.array(z.object({ role: z.enum(["WORKER", "QC"]), credits: z.number(), qty: z.number().int(), payMode: PayModeSchema })),
  /** The latest QC fail of the task ("xem note QC"): its note, when and by whom; null if QC never failed it. */
  lastQcFail: z.object({ note: z.string().nullable(), at: IsoDate, by: UserRefSchema.nullable() }).nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
  /**
   * What the caller may do with this task right now (the API enforces the same rules). Moves follow the workflow
   * (PD-014); the rest follows the job permission matrix (PD-036, "update" / "delete" scopes).
   */
  capabilities: z.object({
    transitions: z.array(TaskTransitionOptionSchema),
    /** Edit the line's fields (quy trình, ca, số lượng, ngày nhận / giao, hình lỗi, giờ OT, ghi chú, link chia việc, tag, trường). */
    canEdit: z.boolean(),
    /** Open "Đổi người làm / QC" (until Checked); the QC of an own line can be changed with "own". */
    canAssign: z.boolean(),
    /** Give the line to someone else ("update: all", before Done). */
    canChangeAssignee: z.boolean(),
    /**
     * Correct the Done quantity after Done (scores are adjusted): the assignee until the line is "Đã check" (PD-044),
     * "update: all" at any time. Subtasks have their own Done quantity.
     */
    canEditQty: z.boolean(),
    /**
     * Change "Số lượng giao" directly, before Done (PD-044): the job's Leader or "update: all". On a subtask the
     * quantity moves between it and its line (the line keeps at least 1). PD-058: a task without a quantity is filled in
     * directly by its assignee too.
     */
    canEditQtyAssigned: z.boolean(),
    /**
     * Ask the Leader to change "Số lượng giao" (PD-044): the assignee without a direct right, before Done, no open request.
     * PD-058: never while the task has no quantity (it is filled in directly).
     */
    canRequestQty: z.boolean(),
    /** Approve / reject the open quantity request: the job's Leader, or "update: all" (PD-044). */
    canDecideQtyRequest: z.boolean(),
    /** Split part of the line off as a subtask (PD-044): its assignee, Leader or "update: all"; a NORMAL work line before Done. */
    canCreateSubtask: z.boolean(),
    /** Delete the line (its points are reversed, PD-036). A subtask gives its quantity back to its line. */
    canDelete: z.boolean()
  })
});
export type ProductionTask = z.infer<typeof ProductionTaskSchema>;
export const ProductionTaskPageSchema = createCursorPageSchema(ProductionTaskSchema);
export type ProductionTaskPage = z.infer<typeof ProductionTaskPageSchema>;

/** "Hình lỗi" of a line (PD-035): display only. */
const ErrorQty = z.number().int().min(0).max(1_000_000);
/** "Giờ OT" of a line (PD-035): optional, also on the OT shift. */
const OtHours = z.number().positive().max(24).multipleOf(0.1);
// eslint-disable-next-line no-control-regex -- rejecting control characters is intended
const workLinkControls = /[\u0000-\u001f\u007f-\u009f]/;
/**
 * "Link chia việc" of a line (PD-040): the link or folder of the images given to the person. Staff paste web links and
 * folder paths (e.g. a network drive "Y:\Client\Batch 1"), so any single-line text is accepted — no http(s) rule,
 * unlike the job's driveLink. Trimmed, at most 2,000 characters, no control characters (the database CHECK is the
 * same). An empty value means none (stored as null).
 */
export const WorkLinkSchema = SafeText()
  .trim()
  .max(2000)
  .refine((value) => !workLinkControls.test(value), textRuleMessages.control);

/**
 * One work-log row (PD-035): Nhân viên thực hiện, Quy trình, Ca, Ngày nhận, Ngày giao (required; the dates default to the
 * job's), Số lượng (optional since PD-058), Hình lỗi, Giờ OT, Ghi chú, QC, Link chia việc (PD-040) (optional).
 */
export const CreateTaskLineSchema = z
  .object({
    assigneeId: Id,
    processId: Id,
    shiftId: Id,
    /** PD-058: optional — omitted / null = "chưa có số lượng" (the worker fills it in by Done at the latest). */
    qtyAssigned: z.number().int().min(1).max(1_000_000).nullable().optional(),
    qcId: Id.nullable().optional(),
    /** "Ngày nhận". Default: the job's (feedback redo tasks: now). */
    assignedAt: IsoDateInput.optional(),
    /** "Ngày giao". Default: the job's deadline (feedback redo tasks: see "Giao lại"). */
    deadline: IsoDateInput.optional(),
    errorQty: ErrorQty.nullable().optional(),
    otHours: OtHours.nullable().optional(),
    note: SafeText().trim().max(5000).optional(),
    workLink: WorkLinkSchema.nullable().optional(),
    customValues: CustomValuesSchema.optional(),
    tagIds: z.array(Id).max(50).optional()
  })
  .strict();
export type CreateTaskLine = z.infer<typeof CreateTaskLineSchema>;

export const CreateTasksRequestSchema = z.object({ tasks: z.array(CreateTaskLineSchema).min(1).max(50) }).strict();
export const CreateTasksResultSchema = z.object({ tasks: z.array(ProductionTaskSchema), warnings: z.array(z.string()) });
export type CreateTasksResult = z.infer<typeof CreateTasksResultSchema>;

export const TransitionTaskRequestSchema = z
  .object({
    toStatusId: Id,
    note: SafeText().trim().max(5000).optional(),
    /**
     * Done quantity. PD-058: required (≥ 1) when the line has no quantity yet — it becomes both its quantities; missing →
     * 400 TASK_QTY_REQUIRED (`details.taskIds`).
     */
    qtyDone: z.number().int().min(0).max(1_000_000).optional(),
    /** Optional, also on the OT shift (PD-035): omitted keeps the line's own "Giờ OT". */
    otHours: OtHours.optional(),
    /**
     * Entering Done with subtasks (PD-044): the Done quantity of each subtask (default: its qtyAssigned). Subtasks move
     * with their line; they are never moved on their own. PD-058: required (≥ 1) for each live subtask without a
     * quantity (it becomes both its quantities).
     */
    subtaskQtyDone: z
      .array(z.object({ taskId: Id, qtyDone: z.number().int().min(0).max(1_000_000) }).strict())
      .max(50)
      .optional()
  })
  .strict();
export type TransitionTaskRequest = z.infer<typeof TransitionTaskRequestSchema>;

/**
 * PD-058: `error.details` of 400 TASK_QTY_REQUIRED ("Nhập số lượng trước khi chuyển Done."): the tasks — the line and / or
 * its live subtasks — that still have no quantity. Send `qtyDone` (the line) and `subtaskQtyDone` (each subtask), ≥ 1.
 */
export const TaskQtyRequiredDetailsSchema = z.object({ taskIds: z.array(Id) });
export type TaskQtyRequiredDetails = z.infer<typeof TaskQtyRequiredDetailsSchema>;

/** POST /production/tasks/:taskId/subtasks (PD-044): split `qtyAssigned` of the line off into another process. */
export const CreateSubtaskRequestSchema = z
  .object({
    processId: Id,
    /**
     * PD-058: optional — omitted / null = "chưa có số lượng". The quantity is carved from the line only when both the
     * line and the subtask have a number.
     */
    qtyAssigned: z.number().int().min(1).max(1_000_000).nullable().optional(),
    /** Optional (PD-045); empty = none. */
    reason: SafeText().trim().max(2000).optional()
  })
  .strict();
export type CreateSubtaskRequest = z.infer<typeof CreateSubtaskRequestSchema>;

/**
 * POST /production/tasks/:taskId/qty-requests (PD-044): the new total ("Số lượng giao") and why. PD-058: a task without a
 * quantity answers 409 TASK_QTY_EMPTY ("Task chưa có số lượng — điền trực tiếp vào ô số lượng.").
 */
export const CreateQtyRequestSchema = z
  .object({
    qtyAssigned: z.number().int().min(1).max(1_000_000),
    reason: SafeText().trim().min(1, "Nhập lý do sửa số tấm.").max(2000)
  })
  .strict();
export type CreateQtyRequest = z.infer<typeof CreateQtyRequestSchema>;

/** POST /production/qty-requests/:requestId/decision (PD-044). A rejection should say why (note). */
export const DecideQtyRequestSchema = z.object({ approve: z.boolean(), note: SafeText().trim().max(2000).optional() }).strict();
export type DecideQtyRequest = z.infer<typeof DecideQtyRequestSchema>;

export const UpdateTaskQtyRequestSchema = z
  .object({ qtyDone: z.number().int().min(0).max(1_000_000), note: SafeText().trim().max(5000).optional() })
  .strict();

export const AssignTaskRequestSchema = z
  .object({ assigneeId: Id.optional(), qcId: Id.nullable().optional(), note: SafeText().trim().max(5000).optional() })
  .strict()
  .refine((value) => value.assigneeId !== undefined || value.qcId !== undefined, "Nothing to change.");

export const UpdateProductionTaskRequestSchema = z
  .object({
    /**
     * "Số lượng giao". PD-058: while the task has none (null), its assignee (and anyone who may already edit it) fills it
     * in directly here — never through a quantity request (POST …/qty-requests answers 409 TASK_QTY_EMPTY); the job's
     * Leader is notified (production.qty_filled). A subtask filled while its line has a number takes it from the line.
     */
    qtyAssigned: z.number().int().min(1).max(1_000_000).optional(),
    assignedAt: IsoDateInput.optional(),
    deadline: IsoDateInput.optional(),
    errorQty: ErrorQty.nullable().optional(),
    otHours: OtHours.nullable().optional(),
    note: SafeText().trim().max(5000).nullable().optional(),
    /** "Link chia việc" (PD-040): null or "" clears it. */
    workLink: WorkLinkSchema.nullable().optional(),
    processId: Id.optional(),
    shiftId: Id.optional(),
    customValues: CustomValuesSchema.optional(),
    tagIds: z.array(Id).max(50).optional()
  })
  .strict();

export const MyProductionTasksQuerySchema = z.object({
  /** assignee: tasks I do; qc: tasks I check; all: both. */
  role: z.enum(["assignee", "qc", "all"]).default("all"),
  /** Include tasks already past the QC/complete stage (terminal or delivered). */
  includeFinished: BoolQuery,
  /** TASK tags: any of them (`tagId=a&tagId=b`). */
  tagId: IdListQuerySchema,
  /** TASK custom-field filters, query `cf.<key>=…` (CustomFieldFilterSchema in production-catalog). */
  cf: CustomFieldFiltersSchema,
  cursor: SafeText().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100)
});
export type MyProductionTasksQuery = z.infer<typeof MyProductionTasksQuerySchema>;

/** GET /production/tasks/qc-queue — optional TASK tag / custom-field filters (same as "Task của tôi"). */
export const QcQueueQuerySchema = z.object({ tagId: IdListQuerySchema, cf: CustomFieldFiltersSchema });
export type QcQueueQuery = z.infer<typeof QcQueueQuerySchema>;

// Jobs ----------------------------------------------------------------------------------------------

export const FeedbackSchema = z.object({
  id: Id,
  jobId: Id,
  sourceTaskId: Id.nullable(),
  type: z.enum(["WRONG", "EXTRA"]),
  note: z.string(),
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]),
  createdBy: UserRefSchema.nullable(),
  createdAt: IsoDate,
  resolvedAt: IsoDate.nullable(),
  /** REWORKED: the re-done work was checked; CLOSED: an Account/Admin closed it without rework (BUG-PR-02). */
  resolution: z.enum(["REWORKED", "CLOSED"]).nullable(),
  resolvedBy: UserRefSchema.nullable(),
  /** Why it was closed without rework. */
  resolutionNote: z.string().nullable(),
  taskIds: z.array(Id)
});
export type Feedback = z.infer<typeof FeedbackSchema>;

/** One person working on a job ("Người làm"): images assigned over all their tasks of the job, feedback redo included. */
export const JobWorkerSchema = z.object({ user: UserRefSchema, qty: z.number().int(), taskCount: z.number().int() });
export type JobWorker = z.infer<typeof JobWorkerSchema>;

/**
 * Who works on a job, from its tasks: distinct assignees (most images first) and distinct QC people (by name).
 * Same tasks as the job detail shows the caller (PD-014: everyone who may see a job sees all its tasks).
 */
export const JobPeopleSchema = z.object({ workers: z.array(JobWorkerSchema), qc: z.array(UserRefSchema) });
export type JobPeople = z.infer<typeof JobPeopleSchema>;

/**
 * Per-person view of the job list (`personId`): the person's own tasks of the job (feedback redo included).
 * Done / checked = qty_done of their tasks that reached Done / Checked (same rule as the job totals).
 */
const PersonQtySchema = z.object({
  taskCount: z.number().int(),
  qtyAssigned: z.number().int(),
  qtyDone: z.number().int(),
  qtyChecked: z.number().int()
});
export const JobPersonShareSchema = PersonQtySchema.extend({
  /** Distinct processes ("Công đoạn") of their tasks, in workflow order. */
  processes: z.array(z.string())
});
export type JobPersonShare = z.infer<typeof JobPersonShareSchema>;
/**
 * The person's numbers over every job matching the filters (not only the page). `personId` says whose numbers
 * the page holds (the list may still show the previous person's page while the next one loads).
 */
export const JobPersonTotalsSchema = PersonQtySchema.extend({ personId: Id, jobCount: z.number().int() });
export type JobPersonTotals = z.infer<typeof JobPersonTotalsSchema>;

export const JobSummarySchema = z.object({
  id: Id,
  number: z.number().int(),
  /** "Gói công việc" (work package: folder path / batch name), unique per project (PD-035). */
  code: z.string(),
  /** Optional free name (kept for older jobs; the forms no longer ask for it). */
  name: z.string().nullable(),
  project: z.object({ id: Id, code: z.string(), name: z.string(), clientName: z.string().nullable() }),
  /** Optional (PD-035): without a leader, any Leader / Admin acts as the job leader. */
  leader: UserRefSchema.nullable(),
  /** "Ngày nhận" of the job (default of its lines'). */
  receivedAt: IsoDate,
  /** "Ngày giao" of the job (default of its lines'). */
  deadline: IsoDate,
  /** "Tổng tấm": the sum of the NORMAL lines unless typed (`totalImagesManual`); PD-058: known numbers only. */
  totalImages: z.number().int(),
  totalImagesManual: z.boolean(),
  driveLink: z.string().nullable(),
  /** Private group chat of the job ("Tạo nhóm cho job này"), if created. */
  channelId: Id.nullable(),
  /**
   * The job's status as people set it (PD-038, "Trạng thái" everywhere in the UI: list, filter, detail, exports). Never
   * moved by the line workflow.
   */
  jobStatus: JobStatusRefSchema,
  /**
   * Internal: the workflow summary derived from the lines (least advanced, or FEEDBACK while client feedback is open;
   * null = no line yet, PD-014). Kept for the feedback logic and deadline countdowns; not shown as the job's status.
   */
  status: ProductionStatusRefSchema.nullable(),
  /**
   * PD-045: live lines (subtasks follow their line) not yet "Đã check" (a Checking line: not Done). A job status with
   * requiresAllChecked can be chosen only when this is 0 and the job has a line (taskCount > 0).
   */
  uncheckedTaskCount: z.number().int(),
  /**
   * PD-048 "Tổng tấm" per process ("Công đoạn"): images given over the live work tasks of the job, subtasks counted under
   * their own process, Checking tasks left out (same tasks as qtyAssigned) — largest first, then by name. PD-058: known
   * numbers only (tasks without a quantity are left out; a process with none known is not listed).
   */
  processTotals: z.array(z.object({ process: z.object({ id: Id, name: z.string() }), qty: z.number().int() })),
  /** Image totals of normal tasks only (feedback redo tasks are extra work, not part of total_images). PD-058: known numbers only. */
  qtyAssigned: z.number().int(),
  /** PD-058: live lines (subtasks included, Checking lines included) without a quantity yet ("chưa có số lượng"). */
  tasksWithoutQty: z.number().int(),
  qtyDone: z.number().int(),
  qtyChecked: z.number().int(),
  taskCount: z.number().int(),
  lateTaskCount: z.number().int(),
  openFeedbackCount: z.number().int(),
  people: JobPeopleSchema,
  /** The `personId` person's part of this job (job list filtered by a person); null everywhere else. */
  personShare: JobPersonShareSchema.nullable(),
  customValues: CustomValuesSchema,
  tagIds: z.array(Id),
  createdBy: UserRefSchema.nullable(),
  createdAt: IsoDate,
  archived: z.boolean()
});
export type JobSummary = z.infer<typeof JobSummarySchema>;
export const JobPageSchema = createCursorPageSchema(JobSummarySchema).extend({
  /** With `personId`, on the first page (no cursor): the person's totals over all matching jobs; otherwise null. */
  personTotals: JobPersonTotalsSchema.nullable()
});
export type JobPage = z.infer<typeof JobPageSchema>;

export const JobBulkActionSchema = z.object({
  toStatusId: Id,
  name: z.string(),
  /** How many tasks of the job this would move. */
  taskCount: z.number().int(),
  /**
   * PD-044 "Complete cả gói": only when every line is "Đã check" (a Checking line: Done; subtasks follow their line).
   * Otherwise the action is listed but blocked: why (e.g. "Còn 3 task chưa check") and which lines hold it up.
   */
  blockedReason: z.string().nullable(),
  blockedTaskIds: z.array(Id)
});

export const JobDetailSchema = JobSummarySchema.extend({
  tasks: z.array(ProductionTaskSchema),
  feedbacks: z.array(FeedbackSchema),
  /** Job permission matrix (PD-036) for CRUD; feedback and job-level moves keep their role / workflow rules. */
  capabilities: z.object({
    /** Edit the job's own fields ("update: all", or "own" when every line is mine). */
    canEdit: z.boolean(),
    /** Change the leader ("update: all"). */
    canChangeLeader: z.boolean(),
    /** Add lines ("Chia task", "create" not none). */
    canSplit: z.boolean(),
    /** "create: own": the lines added are mine only (the assignee is fixed to me). */
    splitOwnOnly: z.boolean(),
    /** Delete the job and all its lines ("delete: all", or "own" when every line is mine). */
    canDelete: z.boolean(),
    /** Retired with the separate feedback feature (PD-045): always false. */
    canFeedback: z.boolean(),
    /** Retired with the separate feedback feature (PD-045): always false. */
    canCloseFeedback: z.boolean(),
    /** Archive / restore ("update: all"). */
    canArchive: z.boolean(),
    /**
     * Change the manual job status (PD-038): "update: all", or "own" when I am the assignee of a live line of the job
     * or its leader; ADMIN always. Not on archived jobs.
     */
    canChangeStatus: z.boolean(),
    /**
     * Job-level line moves. PD-045: the job's only status is the manual chip (jobStatus); the line workflow stops at
     * "Đã check", so this is always empty.
     */
    bulkActions: z.array(JobBulkActionSchema)
  })
});
export type JobDetail = z.infer<typeof JobDetailSchema>;

/** `leaderId=none`: jobs without a leader ("Chưa có leader", PD-035). */
export const noLeaderFilter = "none";

export const JobQuerySchema = z.object({
  projectId: Id.optional(),
  /** Manual job statuses (PD-038): any of them (`jobStatusId=a&jobStatusId=b`). */
  jobStatusId: IdListQuerySchema,
  leaderId: z.union([Id, z.literal(noLeaderFilter)]).optional(),
  /**
   * "Mọi nhân viên" (per-person view): only jobs where this person is the ASSIGNEE of at least one task (QC-only
   * involvement does not count); rows then carry `personShare` and the first page `personTotals`.
   */
  personId: Id.optional(),
  /** JOB tags: any of them (`tagId=a&tagId=b`; one value still works). */
  tagId: IdListQuerySchema,
  /** JOB custom-field filters, query `cf.<key>=…` / `cf.<key>.from=…` (CustomFieldFilterSchema in production-catalog). */
  cf: CustomFieldFiltersSchema,
  q: SafeText().trim().min(1).max(120).optional(),
  deadlineFrom: IsoDateInput.optional(),
  deadlineTo: IsoDateInput.optional(),
  /** Only jobs with at least one late task. */
  late: BoolQuery,
  includeArchived: BoolQuery,
  cursor: SafeText().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});
export type JobQuery = z.infer<typeof JobQuerySchema>;

/** "Gói công việc": typed by the user, usually a folder path or batch name. */
export const jobCodeMaxLength = 300;
export const JobCodeSchema = SafeText().trim().min(1).max(jobCodeMaxLength);

const JobFields = {
  projectId: Id,
  code: JobCodeSchema,
  name: SafeText().trim().max(300).nullable().optional(),
  /** null / omitted: no leader (PD-035). */
  leaderId: Id.nullable().optional(),
  /** "Ngày nhận" of the job. */
  receivedAt: IsoDateInput,
  /** "Ngày giao" of the job (its deadline). */
  deadline: IsoDateInput,
  /** "Tổng tấm" typed by the user; null / omitted = the sum of the job's NORMAL lines, kept in sync. */
  totalImages: z.number().int().min(0).max(1_000_000).nullable().optional(),
  /** "Link thư mục ảnh": a web link or a folder path (PD-046, same rule as "Link chia việc"); null / "" = none. */
  driveLink: WorkLinkSchema.nullable().optional(),
  customValues: CustomValuesSchema.optional(),
  tagIds: z.array(Id).max(50).optional()
};
export const CreateJobRequestSchema = z
  .object({
    ...JobFields,
    /** "Trạng thái" (PD-038); omitted = the first status by position ("Mới nhận"). Changed later via PATCH …/status. */
    jobStatusId: Id.optional()
  })
  .strict();
export type CreateJobRequest = z.infer<typeof CreateJobRequestSchema>;
export const UpdateJobRequestSchema = z
  .object({
    ...JobFields,
    projectId: Id.optional(),
    code: JobFields.code.optional(),
    receivedAt: IsoDateInput.optional(),
    deadline: IsoDateInput.optional(),
    archived: z.boolean().optional()
  })
  .strict();
export type UpdateJobRequest = z.infer<typeof UpdateJobRequestSchema>;

/**
 * PATCH /production/jobs/:jobId/status — the manual job status (PD-038). "update: all", or "own" when the caller is the
 * assignee of a live line of the job or its leader; ADMIN always; others 403. Logged in the job history (action JOB),
 * answers the job.
 */
export const UpdateJobStatusRequestSchema = z.object({ statusId: Id }).strict();
export type UpdateJobStatusRequest = z.infer<typeof UpdateJobStatusRequestSchema>;

/**
 * GET /production/jobs/options — the "Gói công việc" picker of "Nhập công việc" (PD-035 / PD-038): every job of the
 * project that is neither archived nor deleted, closed statuses included, open statuses first then Ngày giao (newest
 * first). Anyone whose "create" scope is own or all may call it — also for jobs they cannot open — so it answers only
 * these few fields. `q`: package text, accents and case ignored; `statusIds`: manual statuses (any of them).
 */
export const JobOptionsQuerySchema = z.object({
  projectId: Id,
  q: z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), SafeText().trim().max(120).optional()),
  statusIds: IdListQuerySchema,
  limit: z.coerce.number().int().min(1).max(100).default(50)
});
export type JobOptionsQuery = z.infer<typeof JobOptionsQuerySchema>;
export const JobOptionSchema = z.object({
  id: Id,
  /** Gói công việc. */
  code: z.string(),
  projectId: Id,
  /** Ngày giao. */
  deadline: IsoDate,
  jobStatus: JobStatusRefSchema
});
export type JobOption = z.infer<typeof JobOptionSchema>;
export const JobOptionsSchema = z.object({
  items: z.array(JobOptionSchema),
  /** More jobs match than `limit`: type to narrow ("Gõ để tìm thêm"). */
  truncated: z.boolean()
});
export type JobOptions = z.infer<typeof JobOptionsSchema>;

/**
 * POST /production/work-entries — "Nhập công việc" (PD-035): one work-log Excel row typed by a staff member, added to an
 * EXISTING job of the project (`jobId`, picked from GET /production/jobs/options). The quick entry never creates a job
 * (PD-038): jobs are created with "Tạo job" only. The line starts in the initial status; the normal workflow applies
 * afterwards. `assigneeId` omitted = me.
 */
export const CreateWorkEntryRequestSchema = z
  .object({
    projectId: Id,
    /** Gói công việc: a job of `projectId` (not archived, not deleted). */
    jobId: Id,
    assigneeId: Id.optional(),
    processId: Id,
    shiftId: Id,
    /** PD-058: optional — omitted / null = "chưa có số lượng" (same rule as "Chia task"). */
    qtyAssigned: z.number().int().min(1).max(1_000_000).nullable().optional(),
    /** Ngày nhận. */
    assignedAt: IsoDateInput,
    /** Ngày giao. */
    deadline: IsoDateInput,
    errorQty: ErrorQty.nullable().optional(),
    otHours: OtHours.nullable().optional(),
    note: SafeText().trim().max(5000).optional(),
    /** "Link chia việc" (PD-040). */
    workLink: WorkLinkSchema.nullable().optional(),
    qcId: Id.nullable().optional(),
    /** TASK custom fields (required ones are enforced like on "Chia task"). */
    customValues: CustomValuesSchema.optional()
  })
  .strict();
export type CreateWorkEntryRequest = z.infer<typeof CreateWorkEntryRequestSchema>;
export const WorkEntryResultSchema = z.object({
  jobId: Id,
  task: ProductionTaskSchema,
  warnings: z.array(z.string())
});
export type WorkEntryResult = z.infer<typeof WorkEntryResultSchema>;

/**
 * GET /production/jobs/export — the GET /production/jobs filters (cursor / limit ignored). `view=worklog`: one row per
 * line with exactly the work-log Excel columns (+ Trạng thái, QC) instead of one row per job.
 */
export const jobExportViews = ["jobs", "worklog"] as const;
export const JobExportQuerySchema = JobQuerySchema.extend({ view: z.enum(jobExportViews).default("jobs") });
export type JobExportQuery = z.infer<typeof JobExportQuerySchema>;

/**
 * DELETE /production/tasks/:taskId and DELETE /production/jobs/:jobId (PD-036): the line(s) are hidden and kept for
 * audit; points / money already recorded are reversed with adjustment entries so their totals drop to zero.
 */
export const DeleteTaskResultSchema = z.object({ taskId: Id, jobId: Id, reversedEntries: z.number().int() });
export type DeleteTaskResult = z.infer<typeof DeleteTaskResultSchema>;
export const DeleteJobResultSchema = z.object({ jobId: Id, deletedTasks: z.number().int(), reversedEntries: z.number().int() });
export type DeleteJobResult = z.infer<typeof DeleteJobResultSchema>;

export const JobChatResultSchema = z.object({ channelId: Id, created: z.boolean() });

export const JobTransitionRequestSchema = z.object({ toStatusId: Id, note: SafeText().trim().max(5000).optional() }).strict();
export const JobTransitionResultSchema = z.object({ moved: z.number().int(), job: JobDetailSchema });

export const CreateFeedbackRequestSchema = z
  .object({ type: z.enum(["WRONG", "EXTRA"]), note: SafeText().trim().min(1).max(5000), sourceTaskId: Id.optional() })
  .strict();

/** POST /production/feedbacks/:feedbackId/close — "Đóng feedback, không cần làm lại" (Account / Admin, note required). */
export const CloseFeedbackRequestSchema = z.object({ note: SafeText().trim().min(1).max(5000) }).strict();

export const ReassignFeedbackRequestSchema = z
  .object({ tasks: z.array(CreateTaskLineSchema.extend({ sourceTaskId: Id.optional() }).strict()).min(1).max(50) })
  .strict();

// Comments & timeline ----------------------------------------------------------------------------------

export const ProductionCommentSchema = z.object({
  id: Id,
  entity: z.enum(["JOB", "TASK"]),
  entityId: Id,
  jobId: Id,
  author: UserRefSchema.nullable(),
  body: z.string(),
  mentionedUserIds: z.array(Id),
  createdAt: IsoDate,
  editedAt: IsoDate.nullable(),
  canEdit: z.boolean()
});
export type ProductionComment = z.infer<typeof ProductionCommentSchema>;

export const CreateProductionCommentRequestSchema = z
  .object({ body: SafeText().trim().min(1).max(5000), mentionedUserIds: z.array(Id).max(50).default([]) })
  .strict();
export const UpdateProductionCommentRequestSchema = z.object({ body: SafeText().trim().min(1).max(5000) }).strict();

export const TaskLogSchema = z.object({
  id: Id,
  /** null for a job-level row (action JOB). */
  taskId: Id.nullable(),
  taskNumber: z.number().int().nullable(),
  /** The task's display code ("1216" / "1216a", PD-045); null for a job-level row. */
  taskCode: z.string().nullable(),
  user: UserRefSchema.nullable(),
  /**
   * JOB: an edit of the job itself (job timeline only). fromValue / toValue hold just the changed fields among
   * code, name, projectId, receivedAt, deadline, leaderId (null = no leader), totalImages, totalImagesManual,
   * driveLink, tagIds, customValues, archived.
   * A manual status change (PD-038) is a JOB row with { jobStatusId, jobStatusName, jobStatusColor } on both sides; when
   * an Admin deleted the status, toValue also holds { statusDeleted: true }.
   * FIELD on a task may carry tagIds (tag changes) besides the edited fields (workLink — "Link chia việc", PD-040 — among
   * them).
   * DELETE: the line was deleted (PD-036); toValue holds { reversedEntries } (score rows brought back to zero) and,
   * when it was part of deleting the whole job, { withJob: true }. A deleted job adds a JOB row { deleted: true }.
   * SUBTASK (PD-044), on the LINE's history (taskId = the line): toValue { op: "created" | "updated" | "deleted",
   * subtaskId, subtaskNumber, subtaskCode ("1216a", PD-045; older rows may lack it), processId, processName, qtyAssigned,
   * parentQtyAssigned } (fromValue the values before for "updated"); note = the reason given when it was created (may be
   * null, PD-045).
   * FIELD rows hold the changed fields' old / new values on both sides, e.g. { workLink: "old" } → { workLink: "new" }.
   * QTY_REQUEST (PD-044): toValue { op: "requested" | "approved" | "rejected" | "cancelled", requestId, fromQty, toQty };
   * note = the worker's reason ("requested") or the decision note.
   * STATUS into REWORK carries { qcFail: true } and the QC's reason as note (unchanged from the QC fail of PD-014).
   * PD-058: a quantity may be null ("chưa có số lượng") in CREATE / FIELD / SUBTASK / DELETE values. Filling it in is a
   * FIELD row { qtyAssigned: null } → { qtyAssigned: 120 } (PATCH; a subtask filled from its line: a SUBTASK "updated"
   * row on the line too), or, at Done, the STATUS row { …status, qtyAssigned: null } → { …status, qtyAssigned: 120,
   * qtyDone: 120 }.
   */
  action: z.enum(["CREATE", "STATUS", "QTY", "ASSIGN", "NOTE", "FIELD", "JOB", "DELETE", "SUBTASK", "QTY_REQUEST"]),
  fromValue: z.record(z.string(), z.unknown()).nullable(),
  toValue: z.record(z.string(), z.unknown()).nullable(),
  note: z.string().nullable(),
  createdAt: IsoDate
});
export type TaskLog = z.infer<typeof TaskLogSchema>;

/** Comments and task history interleaved by time, newest first (PLAN §8). */
export const ProductionTimelineItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("comment"), comment: ProductionCommentSchema }),
  z.object({ kind: z.literal("log"), log: TaskLogSchema })
]);
export const ProductionTimelinePageSchema = createCursorPageSchema(ProductionTimelineItemSchema);
export type ProductionTimelinePage = z.infer<typeof ProductionTimelinePageSchema>;
export const ProductionTimelineQuerySchema = z.object({
  /** "logs": history rows only (the job page's "Nhật ký", PD-044); default both comments and history. */
  only: z.enum(["all", "logs"]).default("all"),
  /** Job timeline, "logs" only: one line's history (its subtasks' SUBTASK rows are on the line already). */
  taskId: Id.optional(),
  cursor: SafeText().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});
