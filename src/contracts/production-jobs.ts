import { z } from "zod";

import { createCursorPageSchema } from "./pagination.js";
import { CustomFieldFiltersSchema, CustomValuesSchema, IdListQuerySchema, IsoDateInputSchema, PayModeSchema, SafeText } from "./production-catalog.js";
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

export const TaskKindSchema = z.enum(["NORMAL", "FB_WRONG", "FB_EXTRA"]);
export type TaskKind = z.infer<typeof TaskKindSchema>;

// Tasks ---------------------------------------------------------------------------------------------

export const TaskTransitionOptionSchema = z.object({
  toStatusId: Id,
  requiresNote: z.boolean(),
  /** Entering a "done" status: ask for qty_done (defaults to qty_assigned). */
  asksQty: z.boolean(),
  /** OT shift: ask for overtime hours when entering a "done" status. */
  asksOtHours: z.boolean(),
  /** Only allowed as an ADMIN override (reason required). */
  override: z.boolean()
});
export type TaskTransitionOption = z.infer<typeof TaskTransitionOptionSchema>;

export const ProductionTaskSchema = z.object({
  id: Id,
  number: z.number().int(),
  jobId: Id,
  jobCode: z.string(),
  project: z.object({ id: Id, code: z.string(), name: z.string() }),
  assignee: UserRefSchema,
  qc: UserRefSchema.nullable(),
  process: z.object({ id: Id, name: z.string(), isQc: z.boolean() }),
  shift: z.object({ id: Id, name: z.string(), payMode: PayModeSchema, requiresOtHours: z.boolean() }),
  qtyAssigned: z.number().int(),
  qtyDone: z.number().int().nullable(),
  otHours: z.number().nullable(),
  assignedAt: IsoDate,
  deadline: IsoDate,
  doneAt: IsoDate.nullable(),
  checkedAt: IsoDate.nullable(),
  status: ProductionStatusRefSchema,
  kind: TaskKindSchema,
  parentTaskId: Id.nullable(),
  feedbackId: Id.nullable(),
  note: z.string().nullable(),
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
  /** What the caller may do with this task right now (the API enforces the same rules). */
  capabilities: z.object({
    transitions: z.array(TaskTransitionOptionSchema),
    canEdit: z.boolean(),
    canAssign: z.boolean(),
    canEditQty: z.boolean()
  })
});
export type ProductionTask = z.infer<typeof ProductionTaskSchema>;
export const ProductionTaskPageSchema = createCursorPageSchema(ProductionTaskSchema);
export type ProductionTaskPage = z.infer<typeof ProductionTaskPageSchema>;

export const CreateTaskLineSchema = z
  .object({
    assigneeId: Id,
    processId: Id,
    shiftId: Id,
    qtyAssigned: z.number().int().min(1).max(1_000_000),
    qcId: Id.nullable().optional(),
    /** Default: job deadline − project QC buffer (feedback redo tasks: see "Giao lại"). */
    deadline: IsoDateInput.optional(),
    note: SafeText().trim().max(5000).optional(),
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
    qtyDone: z.number().int().min(0).max(1_000_000).optional(),
    otHours: z.number().positive().max(24).multipleOf(0.1).optional()
  })
  .strict();
export type TransitionTaskRequest = z.infer<typeof TransitionTaskRequestSchema>;

export const UpdateTaskQtyRequestSchema = z
  .object({ qtyDone: z.number().int().min(0).max(1_000_000), note: SafeText().trim().max(5000).optional() })
  .strict();

export const AssignTaskRequestSchema = z
  .object({ assigneeId: Id.optional(), qcId: Id.nullable().optional(), note: SafeText().trim().max(5000).optional() })
  .strict()
  .refine((value) => value.assigneeId !== undefined || value.qcId !== undefined, "Nothing to change.");

export const UpdateProductionTaskRequestSchema = z
  .object({
    qtyAssigned: z.number().int().min(1).max(1_000_000).optional(),
    deadline: IsoDateInput.optional(),
    note: SafeText().trim().max(5000).nullable().optional(),
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

export const JobSummarySchema = z.object({
  id: Id,
  number: z.number().int(),
  code: z.string(),
  name: z.string().nullable(),
  project: z.object({ id: Id, code: z.string(), name: z.string(), clientName: z.string().nullable() }),
  leader: UserRefSchema,
  deadline: IsoDate,
  totalImages: z.number().int(),
  driveLink: z.string().nullable(),
  /** Private group chat of the job ("Tạo nhóm cho job này"), if created. */
  channelId: Id.nullable(),
  /** Derived from the tasks (least advanced) or FEEDBACK while client feedback is open; null = not split yet. */
  status: ProductionStatusRefSchema.nullable(),
  /** Image totals of normal tasks only (feedback redo tasks are extra work, not part of total_images). */
  qtyAssigned: z.number().int(),
  qtyDone: z.number().int(),
  qtyChecked: z.number().int(),
  taskCount: z.number().int(),
  lateTaskCount: z.number().int(),
  openFeedbackCount: z.number().int(),
  customValues: CustomValuesSchema,
  tagIds: z.array(Id),
  createdBy: UserRefSchema.nullable(),
  createdAt: IsoDate,
  archived: z.boolean()
});
export type JobSummary = z.infer<typeof JobSummarySchema>;
export const JobPageSchema = createCursorPageSchema(JobSummarySchema);
export type JobPage = z.infer<typeof JobPageSchema>;

export const JobBulkActionSchema = z.object({
  toStatusId: Id,
  name: z.string(),
  /** How many tasks of the job this would move. */
  taskCount: z.number().int()
});

export const JobDetailSchema = JobSummarySchema.extend({
  tasks: z.array(ProductionTaskSchema),
  feedbacks: z.array(FeedbackSchema),
  capabilities: z.object({
    canEdit: z.boolean(),
    canSplit: z.boolean(),
    canFeedback: z.boolean(),
    /** "Đóng feedback, không cần làm lại" on an open feedback (Account / Admin). */
    canCloseFeedback: z.boolean(),
    canArchive: z.boolean(),
    /** Job-level moves (e.g. Complete → Delivering → Delivered) the caller may apply to all eligible tasks. */
    bulkActions: z.array(JobBulkActionSchema)
  })
});
export type JobDetail = z.infer<typeof JobDetailSchema>;

export const JobQuerySchema = z.object({
  projectId: Id.optional(),
  statusId: Id.optional(),
  leaderId: Id.optional(),
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

const JobFields = {
  projectId: Id,
  code: SafeText().trim().min(1).max(160),
  name: SafeText().trim().max(300).nullable().optional(),
  leaderId: Id.optional(),
  deadline: IsoDateInput,
  totalImages: z.number().int().min(1).max(1_000_000),
  driveLink: SafeText()
    .trim()
    .max(2000)
    .regex(/^https?:\/\//i, "Link phải bắt đầu bằng http:// hoặc https://")
    .nullable()
    .optional(),
  customValues: CustomValuesSchema.optional(),
  tagIds: z.array(Id).max(50).optional()
};
export const CreateJobRequestSchema = z.object(JobFields).strict();
export type CreateJobRequest = z.infer<typeof CreateJobRequestSchema>;
export const UpdateJobRequestSchema = z
  .object({ ...JobFields, projectId: Id.optional(), code: JobFields.code.optional(), deadline: IsoDateInput.optional(), totalImages: JobFields.totalImages.optional(), archived: z.boolean().optional() })
  .strict();
export type UpdateJobRequest = z.infer<typeof UpdateJobRequestSchema>;

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
  user: UserRefSchema.nullable(),
  /**
   * JOB: an edit of the job itself (job timeline only). fromValue / toValue hold just the changed fields among
   * code, name, projectId, deadline, leaderId, totalImages, driveLink, tagIds, customValues, archived.
   * FIELD on a task may carry tagIds (tag changes) besides the edited fields.
   */
  action: z.enum(["CREATE", "STATUS", "QTY", "ASSIGN", "NOTE", "FIELD", "JOB"]),
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
  cursor: SafeText().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});
