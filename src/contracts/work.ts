import { z } from "zod";

import { createCursorPageSchema } from "./pagination.js";
import { RichTextDocSchema } from "./rich-text.js";
import { FileNameSchema, IsoDateInputSchema, MimeTypeSchema, SafeLineSchema, SafeMultilineSchema, SafeSearchSchema } from "./schemas.js";

/** Work management contract (projects, lists, statuses, tasks, comments, attachments). Shared FE/BE. */

const Id = z.string().uuid();
const IsoDate = z.string().datetime({ offset: true });
/** Request dates: year 1970–2100 (responses use IsoDate). */
const IsoDateInput = IsoDateInputSchema;

const atLeastOneField = (value: Record<string, unknown>) => Object.values(value).some((entry) => entry !== undefined);

export const colorTokens = [
  "slate",
  "gray",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose"
] as const;
export const ColorTokenSchema = z.enum(colorTokens);
export type ColorToken = z.infer<typeof ColorTokenSchema>;

export const ProjectIconSchema = z.string().regex(/^[a-z0-9-]{1,40}$/);
export const ProjectVisibilitySchema = z.enum(["public", "private"]);
export const ProjectAccessLevelSchema = z.enum(["view", "submit", "manage"]);
export type ProjectAccessLevel = z.infer<typeof ProjectAccessLevelSchema>;

export const UserRefSchema = z.object({
  id: Id,
  displayName: z.string(),
  email: z.string().nullable(),
  avatarUrl: z.string().nullable()
});
export type UserRef = z.infer<typeof UserRefSchema>;

/** Neighbour-based placement: the server derives the rank; clients never send raw ranks. */
export const PlacementSchema = z
  .object({
    beforeId: Id.nullable().optional(),
    afterId: Id.nullable().optional()
  })
  .strict();
export type Placement = z.infer<typeof PlacementSchema>;

// Lists -------------------------------------------------------------------------------------------

export const ListSchema = z.object({
  id: Id,
  projectId: Id,
  name: z.string(),
  description: z.string().nullable(),
  color: ColorTokenSchema.nullable(),
  rank: z.string(),
  hasStatusOverride: z.boolean()
});
export type List = z.infer<typeof ListSchema>;

export const CreateListRequestSchema = z
  .object({
    name: SafeLineSchema(160),
    description: SafeMultilineSchema(1000).nullable().optional(),
    color: ColorTokenSchema.nullable().optional()
  })
  .strict();

export const UpdateListRequestSchema = z
  .object({
    name: SafeLineSchema(160).optional(),
    description: SafeMultilineSchema(1000).nullable().optional(),
    color: ColorTokenSchema.nullable().optional(),
    placement: PlacementSchema.optional()
  })
  .strict()
  .refine(atLeastOneField, { message: "At least one field is required." });

/** GET /projects/:id/archived-lists — lists that can be restored (POST /projects/:id/lists/:listId/restore). */
export const ArchivedListSchema = ListSchema.extend({ archivedAt: IsoDate });
export type ArchivedList = z.infer<typeof ArchivedListSchema>;
export const ArchivedListCollectionSchema = z.object({ items: z.array(ArchivedListSchema) });

// Projects ----------------------------------------------------------------------------------------

export const ProjectSchema = z.object({
  id: Id,
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  visibility: ProjectVisibilitySchema,
  color: ColorTokenSchema,
  icon: z.string().nullable(),
  rank: z.string(),
  myAccess: ProjectAccessLevelSchema,
  isMember: z.boolean(),
  hasStatusOverride: z.boolean(),
  /** What the caller may do here (RBAC + project access); UI hints only — the API enforces. */
  capabilities: z.object({
    canUpdate: z.boolean(),
    canArchive: z.boolean(),
    canManageMembers: z.boolean(),
    canCreateList: z.boolean(),
    canManageLists: z.boolean(),
    canManageStatuses: z.boolean(),
    canCreateTask: z.boolean()
  }),
  lists: z.array(ListSchema),
  createdAt: IsoDate,
  updatedAt: IsoDate
});
export type Project = z.infer<typeof ProjectSchema>;

export const ProjectCollectionSchema = z.object({ items: z.array(ProjectSchema) });

export const ProjectKeySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9]{1,11}$/, "Key must be 2-12 letters/digits starting with a letter.");

export const CreateProjectRequestSchema = z
  .object({
    key: ProjectKeySchema,
    name: SafeLineSchema(160),
    description: SafeMultilineSchema(1000).nullable().optional(),
    visibility: ProjectVisibilitySchema.default("private"),
    color: ColorTokenSchema.default("indigo"),
    icon: ProjectIconSchema.nullable().optional()
  })
  .strict();
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

/**
 * Changing the key keeps the old one as an alias: old task links (OLD-12) still resolve and the old key is
 * never given to another project.
 */
export const UpdateProjectRequestSchema = z
  .object({
    key: ProjectKeySchema.optional(),
    name: SafeLineSchema(160).optional(),
    description: SafeMultilineSchema(1000).nullable().optional(),
    visibility: ProjectVisibilitySchema.optional(),
    color: ColorTokenSchema.optional(),
    icon: ProjectIconSchema.nullable().optional(),
    placement: PlacementSchema.optional()
  })
  .strict()
  .refine(atLeastOneField, { message: "At least one field is required." });
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequestSchema>;

/** GET /projects/archived (project.delete + manage access); POST /projects/:id/restore brings one back. */
export const ArchivedProjectSchema = z.object({
  id: Id,
  key: z.string(),
  name: z.string(),
  color: ColorTokenSchema,
  visibility: ProjectVisibilitySchema,
  archivedAt: IsoDate
});
export type ArchivedProject = z.infer<typeof ArchivedProjectSchema>;
export const ArchivedProjectCollectionSchema = z.object({ items: z.array(ArchivedProjectSchema) });

export const ProjectMemberSchema = z.object({
  user: UserRefSchema,
  accessLevel: ProjectAccessLevelSchema,
  createdAt: IsoDate
});
export type ProjectMember = z.infer<typeof ProjectMemberSchema>;
export const ProjectMemberCollectionSchema = z.object({ items: z.array(ProjectMemberSchema) });

export const UpsertProjectMemberRequestSchema = z
  .object({ userId: Id, accessLevel: ProjectAccessLevelSchema.default("submit") })
  .strict();
export const UpdateProjectMemberRequestSchema = z.object({ accessLevel: ProjectAccessLevelSchema }).strict();

// Statuses ----------------------------------------------------------------------------------------

export const StatusCategorySchema = z.enum(["active", "done", "closed"]);
export const StatusScopeSchema = z.enum(["global", "project", "list"]);

export const TaskStatusSchema = z.object({
  id: Id,
  scope: StatusScopeSchema,
  key: z.string(),
  name: z.string(),
  category: StatusCategorySchema,
  color: ColorTokenSchema,
  isInitial: z.boolean(),
  isDone: z.boolean(),
  position: z.number()
});
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const StatusWorkflowSchema = z.object({
  scope: StatusScopeSchema,
  items: z.array(TaskStatusSchema)
});
export type StatusWorkflow = z.infer<typeof StatusWorkflowSchema>;

export const ReplaceWorkflowRequestSchema = z
  .object({
    listId: Id.nullable().default(null),
    inherit: z.boolean().default(false),
    statuses: z
      .array(
        z
          .object({
            id: Id.optional(),
            name: SafeLineSchema(80),
            category: StatusCategorySchema,
            color: ColorTokenSchema
          })
          .strict()
      )
      .max(40)
      .default([]),
    /** Where tasks on removed statuses go, by removed status id → kept status index in `statuses`. */
    remap: z.array(z.object({ fromStatusId: Id, toIndex: z.number().int().min(0).max(39) }).strict()).max(80).default([])
  })
  .strict();
export type ReplaceWorkflowRequest = z.infer<typeof ReplaceWorkflowRequestSchema>;

// Tasks -------------------------------------------------------------------------------------------

export const TaskPrioritySchema = z.enum(["urgent", "high", "normal", "low"]);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const TaskStatusRefSchema = z.object({
  id: Id,
  name: z.string(),
  color: ColorTokenSchema,
  category: StatusCategorySchema
});

export const TaskSummarySchema = z.object({
  id: Id,
  key: z.string(),
  number: z.number().int(),
  projectId: Id,
  listId: Id,
  parentTaskId: Id.nullable(),
  title: z.string(),
  status: TaskStatusRefSchema,
  priority: TaskPrioritySchema,
  startAt: IsoDate.nullable(),
  dueAt: IsoDate.nullable(),
  completedAt: IsoDate.nullable(),
  rank: z.string(),
  assignees: z.array(UserRefSchema),
  subtaskCount: z.number().int(),
  openSubtaskCount: z.number().int(),
  commentCount: z.number().int(),
  attachmentCount: z.number().int(),
  createdAt: IsoDate,
  updatedAt: IsoDate
});
export type TaskSummary = z.infer<typeof TaskSummarySchema>;

export const TaskPageSchema = createCursorPageSchema(TaskSummarySchema);
export type TaskPage = z.infer<typeof TaskPageSchema>;

export const AttachmentSchema = z.object({
  id: Id,
  taskId: Id,
  commentId: Id.nullable(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  isImage: z.boolean(),
  uploadedBy: UserRefSchema.nullable(),
  createdAt: IsoDate,
  /** Uploader with submit access, or a project manager (mirrors DELETE /attachments/:id). */
  canDelete: z.boolean()
});
export type Attachment = z.infer<typeof AttachmentSchema>;

export const TaskCapabilitiesSchema = z.object({
  canEdit: z.boolean(),
  canAssign: z.boolean(),
  canComment: z.boolean(),
  canDelete: z.boolean(),
  canCreateSubtask: z.boolean()
});

export const TaskDetailSchema = TaskSummarySchema.extend({
  description: RichTextDocSchema.nullable(),
  descriptionText: z.string().nullable(),
  createdBy: UserRefSchema.nullable(),
  project: z.object({ id: Id, key: z.string(), name: z.string(), color: ColorTokenSchema }),
  list: z.object({ id: Id, name: z.string() }),
  ancestors: z.array(z.object({ id: Id, key: z.string(), title: z.string() })),
  subtasks: z.array(TaskSummarySchema),
  attachments: z.array(AttachmentSchema),
  capabilities: TaskCapabilitiesSchema
});
export type TaskDetail = z.infer<typeof TaskDetailSchema>;

const csv = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.length > 0
        ? value.split(",").map((entry) => entry.trim()).filter(Boolean)
        : [],
    z.array(item).max(50)
  );

export const TaskSortSchema = z.enum(["rank", "dueAt", "priority", "createdAt", "updatedAt", "title", "number"]);
export type TaskSort = z.infer<typeof TaskSortSchema>;

export const TaskQuerySchema = z.object({
  listId: Id.optional(),
  /** "root" = top-level tasks only; a task id = its direct subtasks; omitted = all levels. */
  parent: z.union([z.literal("root"), Id]).optional(),
  statusIds: csv(Id),
  assigneeIds: csv(z.union([Id, z.literal("me"), z.literal("none")])),
  priorities: csv(TaskPrioritySchema),
  /** "overdue" and "none" are timezone-independent; date windows (today/this week) come as dueFrom/dueTo from the client. */
  due: z.enum(["overdue", "none"]).optional(),
  dueFrom: IsoDateInput.optional(),
  dueTo: IsoDateInput.optional(),
  includeDone: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  q: SafeSearchSchema(200).optional(),
  sort: TaskSortSchema.default("rank"),
  order: z.enum(["asc", "desc"]).default("asc"),
  /** Opaque; title sorts carry the (lower-cased) title, so allow room for long non-ASCII titles. */
  cursor: z.string().max(2000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});
export type TaskQuery = z.infer<typeof TaskQuerySchema>;

export const AssigneeChangeSchema = z
  .object({
    add: z.array(Id).max(20).default([]),
    remove: z.array(Id).max(20).default([])
  })
  .strict();

export const CreateTaskRequestSchema = z
  .object({
    listId: Id,
    parentTaskId: Id.nullable().optional(),
    title: SafeLineSchema(240),
    description: RichTextDocSchema.nullable().optional(),
    statusId: Id.optional(),
    priority: TaskPrioritySchema.default("normal"),
    assigneeIds: z.array(Id).max(20).default([]),
    startAt: IsoDateInput.nullable().optional(),
    dueAt: IsoDateInput.nullable().optional(),
    placement: PlacementSchema.optional()
  })
  .strict();
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;

export const UpdateTaskRequestSchema = z
  .object({
    title: SafeLineSchema(240).optional(),
    description: RichTextDocSchema.nullable().optional(),
    statusId: Id.optional(),
    priority: TaskPrioritySchema.optional(),
    startAt: IsoDateInput.nullable().optional(),
    dueAt: IsoDateInput.nullable().optional(),
    assignees: AssigneeChangeSchema.optional()
  })
  .strict()
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "At least one field is required."
  });
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>;

export const MoveTaskRequestSchema = z
  .object({
    listId: Id.optional(),
    statusId: Id.optional(),
    parentTaskId: Id.nullable().optional(),
    placement: PlacementSchema.optional()
  })
  .strict();
export type MoveTaskRequest = z.infer<typeof MoveTaskRequestSchema>;

// Comments & timeline -----------------------------------------------------------------------------

export const CommentSchema = z.object({
  id: Id,
  taskId: Id,
  parentCommentId: Id.nullable(),
  author: UserRefSchema.nullable(),
  body: RichTextDocSchema,
  bodyText: z.string(),
  mentionedUserIds: z.array(Id),
  replyCount: z.number().int(),
  attachments: z.array(AttachmentSchema),
  createdAt: IsoDate,
  editedAt: IsoDate.nullable(),
  canEdit: z.boolean()
});
export type Comment = z.infer<typeof CommentSchema>;

export const ActivitySchema = z.object({
  id: Id,
  taskId: Id,
  actor: UserRefSchema.nullable(),
  action: z.string(),
  previousValue: z.record(z.string(), z.unknown()).nullable(),
  newValue: z.record(z.string(), z.unknown()).nullable(),
  createdAt: IsoDate
});
export type Activity = z.infer<typeof ActivitySchema>;

export const TimelineItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("comment"), comment: CommentSchema }),
  z.object({ kind: z.literal("activity"), activity: ActivitySchema })
]);
export type TimelineItem = z.infer<typeof TimelineItemSchema>;

/** Newest first; clients render reversed and page towards older items. */
export const TimelinePageSchema = createCursorPageSchema(TimelineItemSchema);
export type TimelinePage = z.infer<typeof TimelinePageSchema>;

export const CommentPageSchema = createCursorPageSchema(CommentSchema);

export const CreateCommentRequestSchema = z
  .object({
    body: RichTextDocSchema,
    parentCommentId: Id.nullable().optional(),
    attachmentIds: z.array(Id).max(10).default([])
  })
  .strict();
export type CreateCommentRequest = z.infer<typeof CreateCommentRequestSchema>;

export const UpdateCommentRequestSchema = z.object({ body: RichTextDocSchema }).strict();

// Attachments -------------------------------------------------------------------------------------

export const maxAttachmentBytes = 50 * 1024 * 1024;

export const CreateUploadRequestSchema = z
  .object({
    fileName: FileNameSchema,
    mimeType: MimeTypeSchema,
    sizeBytes: z.number().int().min(1).max(maxAttachmentBytes)
  })
  .strict();
export type CreateUploadRequest = z.infer<typeof CreateUploadRequestSchema>;

/** Signed storage URL: absolute, or a same-origin /storage/v1/ path proxied by the web server. */
export const SignedStorageUrlSchema = z
  .string()
  .max(4000)
  .refine((value) => value.startsWith("https://") || value.startsWith("http://") || value.startsWith("/storage/v1/"), "Invalid storage URL.");

export const UploadTicketSchema = z.object({
  attachmentId: Id,
  uploadUrl: SignedStorageUrlSchema,
  expiresAt: IsoDate
});
export type UploadTicket = z.infer<typeof UploadTicketSchema>;

export const CompleteUploadRequestSchema = z
  .object({ target: z.enum(["task", "comment"]).default("task") })
  .strict();

export const AttachmentUrlRequestSchema = z.object({ ids: z.array(Id).min(1).max(100) }).strict();
export const AttachmentUrlCollectionSchema = z.object({
  items: z.array(z.object({ id: Id, url: SignedStorageUrlSchema, expiresAt: IsoDate }))
});

export const TaskKeyLookupSchema = z.object({ id: Id, projectId: Id });

// Directory ---------------------------------------------------------------------------------------

export const DirectoryQuerySchema = z.object({
  q: SafeSearchSchema(120).optional(),
  projectId: Id.optional(),
  channelId: Id.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});
export const DirectoryCollectionSchema = z.object({ items: z.array(UserRefSchema) });

/** "My tasks": tasks assigned to the caller across every project they can still see. */
export const MyTasksQuerySchema = z.object({
  due: z.enum(["overdue", "none"]).optional(),
  dueFrom: IsoDateInput.optional(),
  dueTo: IsoDateInput.optional(),
  includeDone: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  sort: z.enum(["dueAt", "updatedAt", "priority"]).default("dueAt"),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});
export type MyTasksQuery = z.infer<typeof MyTasksQuerySchema>;
