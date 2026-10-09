import { z } from "zod";

import { permissionValues } from "./permissions.js";
export const OpaqueIdSchema = z.string().uuid();

export const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const PermissionKeySchema = z.enum(permissionValues);

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1)
  })
});

export const LoginRequestSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(4096)
});

export const AuthUserSchema = z.object({
  id: OpaqueIdSchema,
  email: z.string().email().nullable(),
  permissions: z.array(PermissionKeySchema)
});

export const AuthSessionSchema = z.object({
  user: AuthUserSchema
});

export const LogoutResponseSchema = z.object({
  ok: z.literal(true)
});

export const OrganizationSchema = z.object({
  id: OpaqueIdSchema,
  slug: z.string().min(2).max(80),
  name: z.string().min(1).max(160)
});

export const AppUserSchema = z.object({
  id: OpaqueIdSchema,
  displayName: z.string().min(1).max(160),
  email: z.string().email().nullable()
});

export const RoleSchema = z.object({
  id: OpaqueIdSchema,
  organizationId: OpaqueIdSchema,
  key: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  permissions: z.array(PermissionKeySchema)
});

export const RoleKeySchema = z.string().trim().regex(/^[a-z][a-z0-9_]{1,78}$/);

export const PermissionDefinitionSchema = z.object({
  key: PermissionKeySchema,
  module: z.string().min(1).max(80),
  description: z.string().min(1).max(240)
});

export const PermissionCollectionSchema = z.object({
  items: z.array(PermissionDefinitionSchema)
});

export const ManagedRoleSchema = RoleSchema.extend({
  description: z.string().max(1000).nullable(),
  isSystem: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema
});

export const RoleCollectionSchema = z.object({
  items: z.array(ManagedRoleSchema)
});

export const CreateRoleRequestSchema = z.object({
  key: RoleKeySchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  permissions: z.array(PermissionKeySchema).max(permissionValues.length).default([])
});

export const UpdateRoleRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).nullable().optional()
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "At least one role field is required."
  });

export const UpdateRolePermissionsRequestSchema = z.object({
  permissions: z.array(PermissionKeySchema).max(permissionValues.length).default([])
});

export const MembershipStatusSchema = z.enum(["invited", "active", "disabled"]);
export const EditableMembershipStatusSchema = z.enum(["active", "disabled"]);

export const OrganizationMemberSchema = z.object({
  id: OpaqueIdSchema,
  user: AppUserSchema,
  role: RoleSchema,
  status: MembershipStatusSchema,
  joinedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema
});

export const OrganizationMemberCollectionSchema = z.object({
  items: z.array(OrganizationMemberSchema)
});

export const UpdateOrganizationMemberRequestSchema = z
  .object({
    roleId: OpaqueIdSchema.optional(),
    status: EditableMembershipStatusSchema.optional()
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "At least one organization member field is required."
  });

export const WorkspaceContextSchema = z.object({
  user: AppUserSchema,
  organization: OrganizationSchema,
  role: RoleSchema,
  hasFullOrganizationAuthority: z.boolean()
});

export const ProjectKeySchema = z.string().trim().regex(/^[A-Z][A-Z0-9]{1,11}$/);

export const ProjectSummarySchema = z.object({
  id: OpaqueIdSchema,
  organizationId: OpaqueIdSchema,
  key: ProjectKeySchema,
  name: z.string().min(1).max(160),
  description: z.string().max(1000).nullable(),
  updatedAt: IsoDateTimeSchema
});

export const ProjectCollectionSchema = z.object({
  items: z.array(ProjectSummarySchema)
});

export const CreateProjectRequestSchema = z.object({
  key: ProjectKeySchema,
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).nullable().optional()
});

export const UpdateProjectRequestSchema = z
  .object({
    key: ProjectKeySchema.optional(),
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(1000).nullable().optional()
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "At least one project field is required."
  });

export const ListSummarySchema = z.object({
  id: OpaqueIdSchema,
  organizationId: OpaqueIdSchema,
  projectId: OpaqueIdSchema,
  name: z.string().min(1).max(160),
  description: z.string().max(1000).nullable(),
  position: z.string()
});

export const ListCollectionSchema = z.object({
  items: z.array(ListSummarySchema)
});

export const CreateListRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).nullable().optional()
});

export const UpdateListRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    position: z.string().regex(/^-?\d+(\.\d+)?$/).optional()
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "At least one list field is required."
  });

export const ProjectAccessLevelSchema = z.enum(["view", "submit", "manage"]);

export const ProjectMemberSchema = z.object({
  id: OpaqueIdSchema,
  user: AppUserSchema,
  accessLevel: ProjectAccessLevelSchema,
  status: MembershipStatusSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema
});

export const ProjectMemberCollectionSchema = z.object({
  items: z.array(ProjectMemberSchema)
});

export const UpsertProjectMemberRequestSchema = z.object({
  userId: OpaqueIdSchema,
  accessLevel: ProjectAccessLevelSchema
});

export const UpdateProjectMemberRequestSchema = z
  .object({
    accessLevel: ProjectAccessLevelSchema.optional(),
    status: EditableMembershipStatusSchema.optional()
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "At least one project member field is required."
  });

export const TaskPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);

export const TaskStatusSchema = z.object({
  id: OpaqueIdSchema,
  key: z.string().min(2).max(80),
  name: z.string().min(1).max(80),
  category: z.enum(["active", "done", "closed"]),
  color: z.string().min(1).max(40),
  isDone: z.boolean(),
  isInitial: z.boolean()
});

export const TaskStatusSummarySchema = TaskStatusSchema.extend({
  organizationId: OpaqueIdSchema,
  scope: z.enum(["global", "project", "list"]),
  projectId: OpaqueIdSchema.nullable(),
  listId: OpaqueIdSchema.nullable(),
  position: z.string()
});

export const TaskStatusCollectionSchema = z.object({
  items: z.array(TaskStatusSummarySchema)
});

export const TaskSummarySchema = z.object({
  id: OpaqueIdSchema,
  organizationId: OpaqueIdSchema,
  projectId: OpaqueIdSchema,
  listId: OpaqueIdSchema,
  parentTaskId: OpaqueIdSchema.nullable(),
  title: z.string().min(1).max(240),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  assigneeIds: z.array(OpaqueIdSchema),
  startAt: IsoDateTimeSchema.nullable(),
  dueAt: IsoDateTimeSchema.nullable(),
  completedAt: IsoDateTimeSchema.nullable(),
  subtaskCount: z.number().int().nonnegative(),
  updatedAt: IsoDateTimeSchema
});

export const TaskDetailSchema = TaskSummarySchema.extend({
  descriptionText: z.string().nullable(),
  createdAt: IsoDateTimeSchema
});

export const TaskPageSchema = z.object({
  items: z.array(TaskSummarySchema),
  pageInfo: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean()
  })
});

export const CreateTaskRequestSchema = z.object({
  listId: OpaqueIdSchema,
  title: z.string().trim().min(1).max(240),
  descriptionText: z.string().max(20000).optional(),
  priority: TaskPrioritySchema.default("normal"),
  statusId: OpaqueIdSchema.optional(),
  parentTaskId: OpaqueIdSchema.nullable().optional(),
  startAt: IsoDateTimeSchema.nullable().optional(),
  dueAt: IsoDateTimeSchema.nullable().optional(),
  assigneeIds: z.array(OpaqueIdSchema).max(50).default([])
});

export const UpdateTaskRequestSchema = z
  .object({
    listId: OpaqueIdSchema.optional(),
    statusId: OpaqueIdSchema.optional(),
    title: z.string().trim().min(1).max(240).optional(),
    descriptionText: z.string().max(20000).nullable().optional(),
    priority: TaskPrioritySchema.optional(),
    startAt: IsoDateTimeSchema.nullable().optional(),
    dueAt: IsoDateTimeSchema.nullable().optional(),
    assigneeIds: z.array(OpaqueIdSchema).max(50).optional()
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "At least one task field is required."
  });

export const TaskCommentSchema = z.object({
  id: OpaqueIdSchema,
  organizationId: OpaqueIdSchema,
  taskId: OpaqueIdSchema,
  authorUserId: OpaqueIdSchema,
  bodyText: z.string().min(1).max(20000),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema
});

export const TaskActivityEventSchema = z.object({
  id: OpaqueIdSchema,
  organizationId: OpaqueIdSchema,
  taskId: OpaqueIdSchema,
  actorUserId: OpaqueIdSchema.nullable(),
  action: z.string().min(2).max(80),
  targetType: z.string().min(1).max(80),
  targetId: OpaqueIdSchema.nullable(),
  previousValue: z.unknown().nullable(),
  newValue: z.unknown().nullable(),
  createdAt: IsoDateTimeSchema
});

export const TaskDetailResponseSchema = z.object({
  task: TaskDetailSchema,
  subtasks: z.array(TaskSummarySchema),
  comments: z.array(TaskCommentSchema),
  activity: z.array(TaskActivityEventSchema)
});

export const CreateTaskCommentRequestSchema = z.object({
  bodyText: z.string().trim().min(1).max(20000)
});

export const ArchiveResponseSchema = z.object({
  ok: z.literal(true)
});

export const ProductMetaSchema = z.object({
  name: z.literal("Nesso Work"),
  apiVersion: z.literal("v1"),
  ports: z.object({
    web: z.number().int(),
    api: z.number().int()
  }),
  permissions: z.array(PermissionKeySchema)
});

export type ApiError = z.infer<typeof ApiErrorSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type AuthUser = z.infer<typeof AuthUserSchema>;
export type AuthSession = z.infer<typeof AuthSessionSchema>;
export type Organization = z.infer<typeof OrganizationSchema>;
export type AppUser = z.infer<typeof AppUserSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type PermissionDefinition = z.infer<typeof PermissionDefinitionSchema>;
export type PermissionCollection = z.infer<typeof PermissionCollectionSchema>;
export type ManagedRole = z.infer<typeof ManagedRoleSchema>;
export type RoleCollection = z.infer<typeof RoleCollectionSchema>;
export type CreateRoleRequest = z.infer<typeof CreateRoleRequestSchema>;
export type UpdateRoleRequest = z.infer<typeof UpdateRoleRequestSchema>;
export type UpdateRolePermissionsRequest = z.infer<typeof UpdateRolePermissionsRequestSchema>;
export type MembershipStatus = z.infer<typeof MembershipStatusSchema>;
export type EditableMembershipStatus = z.infer<typeof EditableMembershipStatusSchema>;
export type OrganizationMember = z.infer<typeof OrganizationMemberSchema>;
export type OrganizationMemberCollection = z.infer<typeof OrganizationMemberCollectionSchema>;
export type UpdateOrganizationMemberRequest = z.infer<typeof UpdateOrganizationMemberRequestSchema>;
export type WorkspaceContext = z.infer<typeof WorkspaceContextSchema>;
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
export type ProjectCollection = z.infer<typeof ProjectCollectionSchema>;
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequestSchema>;
export type ListSummary = z.infer<typeof ListSummarySchema>;
export type ListCollection = z.infer<typeof ListCollectionSchema>;
export type CreateListRequest = z.infer<typeof CreateListRequestSchema>;
export type UpdateListRequest = z.infer<typeof UpdateListRequestSchema>;
export type ProjectAccessLevel = z.infer<typeof ProjectAccessLevelSchema>;
export type ProjectMember = z.infer<typeof ProjectMemberSchema>;
export type ProjectMemberCollection = z.infer<typeof ProjectMemberCollectionSchema>;
export type UpsertProjectMemberRequest = z.infer<typeof UpsertProjectMemberRequestSchema>;
export type UpdateProjectMemberRequest = z.infer<typeof UpdateProjectMemberRequestSchema>;
export type TaskStatusSummary = z.infer<typeof TaskStatusSummarySchema>;
export type TaskStatusCollection = z.infer<typeof TaskStatusCollectionSchema>;
export type TaskSummary = z.infer<typeof TaskSummarySchema>;
export type TaskDetail = z.infer<typeof TaskDetailSchema>;
export type TaskPage = z.infer<typeof TaskPageSchema>;
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>;
export type TaskComment = z.infer<typeof TaskCommentSchema>;
export type TaskActivityEvent = z.infer<typeof TaskActivityEventSchema>;
export type TaskDetailResponse = z.infer<typeof TaskDetailResponseSchema>;
export type CreateTaskCommentRequest = z.infer<typeof CreateTaskCommentRequestSchema>;
export type ArchiveResponse = z.infer<typeof ArchiveResponseSchema>;
export type ProductMeta = z.infer<typeof ProductMetaSchema>;
