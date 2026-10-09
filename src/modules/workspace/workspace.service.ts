import type postgres from "postgres";

import { Permission, type PermissionKey } from "../../contracts/permissions.js";
import type {
  AppUser,
  CreateRoleRequest,
  CreateListRequest,
  CreateProjectRequest,
  CreateTaskCommentRequest,
  CreateTaskRequest,
  EditableMembershipStatus,
  ListSummary,
  ManagedRole,
  OrganizationMemberCollection,
  PermissionCollection,
  ProjectAccessLevel,
  ProjectMember,
  ProjectMemberCollection,
  ProjectSummary,
  Role,
  RoleCollection,
  TaskActivityEvent,
  TaskComment,
  TaskDetail,
  TaskDetailResponse,
  TaskPage,
  TaskStatusCollection,
  TaskStatusSummary,
  TaskSummary,
  UpdateListRequest,
  UpdateOrganizationMemberRequest,
  UpdateProjectMemberRequest,
  UpdateProjectRequest,
  UpdateRolePermissionsRequest,
  UpdateRoleRequest,
  UpdateTaskRequest,
  UpsertProjectMemberRequest,
  WorkspaceContext
} from "../../contracts/schemas.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";

type QuerySql = postgres.Sql | postgres.TransactionSql;
type JsonObject = Record<string, postgres.JSONValue>;

type WorkspaceContextRow = {
  user_id: string;
  email: string | null;
  display_name: string;
  organization_id: string;
  organization_slug: string;
  organization_name: string;
  role_id: string;
  role_key: string;
  role_name: string;
  permissions: string[] | null;
};

type ProjectRow = {
  id: string;
  organization_id: string;
  key: string;
  name: string;
  description: string | null;
  updated_at: Date | string;
};

type ListRow = {
  id: string;
  organization_id: string;
  project_id: string;
  name: string;
  description: string | null;
  position: string;
};

type PermissionDefinitionRow = {
  key: string;
  module: string;
  description: string;
};

type ManagedRoleRow = {
  id: string;
  organization_id: string;
  key: string;
  name: string;
  description: string | null;
  is_system: boolean;
  created_at: Date | string;
  updated_at: Date | string;
  permissions: string[] | null;
};

type OrganizationMemberRow = {
  id: string;
  organization_id: string;
  user_id: string;
  email: string | null;
  display_name: string;
  role_id: string;
  role_key: string;
  role_name: string;
  role_permissions: string[] | null;
  status: "invited" | "active" | "disabled";
  joined_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type TaskStatusRow = {
  id: string;
  organization_id: string;
  scope: "global" | "project" | "list";
  project_id: string | null;
  list_id: string | null;
  key: string;
  name: string;
  category: "active" | "done" | "closed";
  color: string;
  is_done: boolean;
  is_initial: boolean;
  position: string;
};

type TaskRow = {
  id: string;
  organization_id: string;
  project_id: string;
  list_id: string;
  parent_task_id: string | null;
  title: string;
  priority: "low" | "normal" | "high" | "urgent";
  start_at: Date | string | null;
  due_at: Date | string | null;
  completed_at: Date | string | null;
  updated_at: Date | string;
  status_id: string;
  status_key: string;
  status_name: string;
  status_category: "active" | "done" | "closed";
  status_color: string;
  status_is_done: boolean;
  status_is_initial: boolean;
  assignee_ids: string[] | null;
  subtask_count: number | string | null;
};

type TaskDetailRow = TaskRow & {
  description_text: string | null;
  created_at: Date | string;
};

type ProjectMemberRow = {
  membership_id: string;
  user_id: string;
  email: string | null;
  display_name: string;
  access_level: ProjectAccessLevel;
  status: "invited" | "active" | "disabled";
  created_at: Date | string;
  updated_at: Date | string;
};

type TaskCommentRow = {
  id: string;
  organization_id: string;
  task_id: string;
  author_user_id: string;
  body_text: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type TaskActivityEventRow = {
  id: string;
  organization_id: string;
  task_id: string;
  actor_user_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  previous_value: unknown;
  new_value: unknown;
  created_at: Date | string;
};

const maxTaskDepth = 7;

const defaultProjectStatuses = [
  { key: "TODO", name: "Todo", category: "active", isInitial: true, isTerminal: false, color: "slate", position: "1000" },
  { key: "IN_PROGRESS", name: "In Progress", category: "active", isInitial: false, isTerminal: false, color: "blue", position: "2000" },
  { key: "DONE", name: "Done", category: "done", isInitial: false, isTerminal: true, color: "green", position: "3000" }
] as const;

const toIso = (value: Date | string) => {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
};

const toNullableIso = (value: Date | string | null) => {
  return value === null ? null : toIso(value);
};

const nullableText = (value: string | null | undefined) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toPermissionKeys = (permissions: string[] | null): PermissionKey[] => {
  if (!permissions) {
    return [];
  }

  return permissions.filter((permission): permission is PermissionKey => {
    return Object.values(Permission).includes(permission as PermissionKey);
  });
};

const toProjectSummary = (row: ProjectRow): ProjectSummary => ({
  id: row.id,
  organizationId: row.organization_id,
  key: row.key,
  name: row.name,
  description: row.description,
  updatedAt: toIso(row.updated_at)
});

const toListSummary = (row: ListRow): ListSummary => ({
  id: row.id,
  organizationId: row.organization_id,
  projectId: row.project_id,
  name: row.name,
  description: row.description,
  position: row.position
});

const toRole = (row: Pick<ManagedRoleRow, "id" | "organization_id" | "key" | "name" | "permissions">): Role => ({
  id: row.id,
  organizationId: row.organization_id,
  key: row.key,
  name: row.name,
  permissions: toPermissionKeys(row.permissions)
});

const toManagedRole = (row: ManagedRoleRow): ManagedRole => ({
  ...toRole(row),
  description: row.description,
  isSystem: row.is_system,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at)
});

const toOrganizationMember = (row: OrganizationMemberRow) => ({
  id: row.id,
  user: {
    id: row.user_id,
    email: row.email,
    displayName: row.display_name
  },
  role: {
    id: row.role_id,
    organizationId: row.organization_id,
    key: row.role_key,
    name: row.role_name,
    permissions: toPermissionKeys(row.role_permissions)
  },
  status: row.status,
  joinedAt: toNullableIso(row.joined_at),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at)
});

const toProjectMember = (row: ProjectMemberRow): ProjectMember => ({
  id: row.membership_id,
  user: {
    id: row.user_id,
    email: row.email,
    displayName: row.display_name
  },
  accessLevel: row.access_level,
  status: row.status,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at)
});

const toTaskStatusSummary = (row: TaskStatusRow): TaskStatusSummary => ({
  id: row.id,
  organizationId: row.organization_id,
  scope: row.scope,
  projectId: row.project_id,
  listId: row.list_id,
  key: row.key,
  name: row.name,
  category: row.category,
  color: row.color,
  isDone: row.is_done,
  isInitial: row.is_initial,
  position: row.position
});

const toTaskSummary = (row: TaskRow): TaskSummary => ({
  id: row.id,
  organizationId: row.organization_id,
  projectId: row.project_id,
  listId: row.list_id,
  parentTaskId: row.parent_task_id,
  title: row.title,
  status: {
    id: row.status_id,
    key: row.status_key,
    name: row.status_name,
    category: row.status_category,
    color: row.status_color,
    isDone: row.status_is_done,
    isInitial: row.status_is_initial
  },
  priority: row.priority,
  assigneeIds: row.assignee_ids ?? [],
  startAt: toNullableIso(row.start_at),
  dueAt: toNullableIso(row.due_at),
  completedAt: toNullableIso(row.completed_at),
  subtaskCount: Number(row.subtask_count ?? 0),
  updatedAt: toIso(row.updated_at)
});

const toTaskDetail = (row: TaskDetailRow): TaskDetail => ({
  ...toTaskSummary(row),
  descriptionText: row.description_text,
  createdAt: toIso(row.created_at)
});

const toTaskComment = (row: TaskCommentRow): TaskComment => ({
  id: row.id,
  organizationId: row.organization_id,
  taskId: row.task_id,
  authorUserId: row.author_user_id,
  bodyText: row.body_text,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at)
});

const toTaskActivityEvent = (row: TaskActivityEventRow): TaskActivityEvent => ({
  id: row.id,
  organizationId: row.organization_id,
  taskId: row.task_id,
  actorUserId: row.actor_user_id,
  action: row.action,
  targetType: row.target_type,
  targetId: row.target_id,
  previousValue: row.previous_value,
  newValue: row.new_value,
  createdAt: toIso(row.created_at)
});

const encodeTaskCursor = (task: TaskSummary) => {
  return Buffer.from(JSON.stringify({ updatedAt: task.updatedAt, id: task.id }), "utf8").toString("base64url");
};

const decodeTaskCursor = (cursor: string | undefined) => {
  if (!cursor) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      typeof decoded === "object" &&
      decoded !== null &&
      "updatedAt" in decoded &&
      "id" in decoded &&
      typeof decoded.updatedAt === "string" &&
      typeof decoded.id === "string"
    ) {
      return { updatedAt: decoded.updatedAt, id: decoded.id };
    }
  } catch {
    throw new AppError("INVALID_CURSOR", "The pagination cursor is invalid.", 400);
  }

  throw new AppError("INVALID_CURSOR", "The pagination cursor is invalid.", 400);
};

const assertPermission = (context: WorkspaceContext, permission: PermissionKey) => {
  if (!context.role.permissions.includes(permission)) {
    throw new AppError("FORBIDDEN", "You do not have permission to perform this action.", 403);
  }
};

const uniquePermissionKeys = (permissions: PermissionKey[]) => {
  return [...new Set(permissions)];
};

const getManagedRoleById = async (
  sql: QuerySql,
  context: WorkspaceContext,
  roleId: string
): Promise<ManagedRole> => {
  const rows = await sql<ManagedRoleRow[]>`
    SELECT
      r.id,
      r.organization_id,
      r.key,
      r.name,
      r.description,
      r.is_system,
      r.created_at,
      r.updated_at,
      array_remove(array_agg(rp.permission_key ORDER BY rp.permission_key), NULL) AS permissions
    FROM public.roles r
    LEFT JOIN public.role_permissions rp
      ON rp.role_id = r.id
      AND rp.organization_id = r.organization_id
    WHERE r.id = ${roleId}
      AND r.organization_id = ${context.organization.id}
      AND r.deleted_at IS NULL
    GROUP BY r.id
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    throw new AppError("ROLE_NOT_FOUND", "Role was not found.", 404);
  }

  return toManagedRole(row);
};

const assertManagedRoleEditable = (role: ManagedRole) => {
  if (role.isSystem) {
    throw new AppError("ROLE_SYSTEM_PROTECTED", "System roles cannot be modified.", 409);
  }
};

const assertRoleExists = async (sql: QuerySql, context: WorkspaceContext, roleId: string) => {
  const rows = await sql<{ id: string }[]>`
    SELECT id
    FROM public.roles
    WHERE id = ${roleId}
      AND organization_id = ${context.organization.id}
      AND deleted_at IS NULL
    LIMIT 1
  `;

  if (rows.length === 0) {
    throw new AppError("ROLE_NOT_FOUND", "Role was not found.", 404);
  }
};

const assertOrganizationWillKeepSuperadmin = async (
  sql: QuerySql,
  context: WorkspaceContext,
  targetMembershipId: string
) => {
  const rows = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count
    FROM public.organization_memberships om
    JOIN public.roles r
      ON r.id = om.role_id
      AND r.organization_id = om.organization_id
      AND r.deleted_at IS NULL
    WHERE om.organization_id = ${context.organization.id}
      AND om.id <> ${targetMembershipId}
      AND om.status = 'active'
      AND om.deleted_at IS NULL
      AND r.key = 'superadmin'
  `;

  if (Number(rows[0]?.count ?? 0) === 0) {
    throw new AppError("ORG_SUPERADMIN_REQUIRED", "At least one active superadmin is required.", 409);
  }
};

const assertActiveOrganizationMember = async (sql: QuerySql, context: WorkspaceContext, userId: string) => {
  const rows = await sql<{ id: string }[]>`
    SELECT id
    FROM public.organization_memberships
    WHERE organization_id = ${context.organization.id}
      AND user_id = ${userId}
      AND status = 'active'
      AND deleted_at IS NULL
    LIMIT 1
  `;

  if (rows.length === 0) {
    throw new AppError("ORG_MEMBER_NOT_FOUND", "Active organization member was not found.", 404);
  }
};

const assertProjectWillKeepManager = async (
  sql: QuerySql,
  context: WorkspaceContext,
  projectId: string,
  targetUserId: string
) => {
  const rows = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count
    FROM public.project_memberships
    WHERE organization_id = ${context.organization.id}
      AND project_id = ${projectId}
      AND user_id <> ${targetUserId}
      AND access_level = 'manage'
      AND status = 'active'
      AND deleted_at IS NULL
  `;

  if (Number(rows[0]?.count ?? 0) === 0) {
    throw new AppError("PROJECT_MANAGER_REQUIRED", "At least one active project manager is required.", 409);
  }
};

const assertProjectAccess = async (
  sql: QuerySql,
  context: WorkspaceContext,
  projectId: string,
  requiredLevel: ProjectAccessLevel = "view"
) => {
  assertPermission(context, Permission.ProjectView);

  const projectRows = await sql<{ id: string }[]>`
    SELECT id
    FROM public.projects
    WHERE id = ${projectId}
      AND organization_id = ${context.organization.id}
      AND archived_at IS NULL
      AND deleted_at IS NULL
    LIMIT 1
  `;

  if (projectRows.length === 0) {
    throw new AppError("PROJECT_NOT_FOUND", "Project was not found.", 404);
  }

  if (context.hasFullOrganizationAuthority) {
    return;
  }

  const membershipRows = await sql<{ access_level: ProjectAccessLevel }[]>`
    SELECT access_level
    FROM public.project_memberships
    WHERE organization_id = ${context.organization.id}
      AND project_id = ${projectId}
      AND user_id = ${context.user.id}
      AND status = 'active'
      AND deleted_at IS NULL
    LIMIT 1
  `;

  const membership = membershipRows[0];
  if (!membership) {
    throw new AppError("PROJECT_NOT_FOUND", "Project was not found.", 404);
  }

  const levels: ProjectAccessLevel[] = ["view", "submit", "manage"];
  if (levels.indexOf(membership.access_level) < levels.indexOf(requiredLevel)) {
    throw new AppError("FORBIDDEN", "Project access is insufficient.", 403);
  }
};

const assertListAccess = async (sql: QuerySql, context: WorkspaceContext, projectId: string, listId: string) => {
  const rows = await sql<{ id: string }[]>`
    SELECT id
    FROM public.lists
    WHERE id = ${listId}
      AND organization_id = ${context.organization.id}
      AND project_id = ${projectId}
      AND archived_at IS NULL
      AND deleted_at IS NULL
    LIMIT 1
  `;

  if (rows.length === 0) {
    throw new AppError("LIST_NOT_FOUND", "List was not found.", 404);
  }
};

const getTaskDepth = async (sql: QuerySql, context: WorkspaceContext, taskId: string) => {
  const rows = await sql<{ depth: number | string | null }[]>`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_task_id, 1::int AS depth
      FROM public.tasks
      WHERE id = ${taskId}
        AND organization_id = ${context.organization.id}
        AND archived_at IS NULL
        AND deleted_at IS NULL

      UNION ALL

      SELECT parent.id, parent.parent_task_id, ancestors.depth + 1
      FROM public.tasks parent
      JOIN ancestors
        ON parent.id = ancestors.parent_task_id
      WHERE parent.organization_id = ${context.organization.id}
        AND parent.archived_at IS NULL
        AND parent.deleted_at IS NULL
        AND ancestors.depth < ${maxTaskDepth}
    )
    SELECT MAX(depth)::int AS depth
    FROM ancestors
  `;

  return Number(rows[0]?.depth ?? 0);
};

const assertParentTaskAllowed = async (
  sql: QuerySql,
  context: WorkspaceContext,
  input: { projectId: string; listId: string; parentTaskId?: string | null }
) => {
  if (!input.parentTaskId) {
    return;
  }

  const rows = await sql<{ project_id: string; list_id: string }[]>`
    SELECT project_id, list_id
    FROM public.tasks
    WHERE id = ${input.parentTaskId}
      AND organization_id = ${context.organization.id}
      AND archived_at IS NULL
      AND deleted_at IS NULL
    LIMIT 1
  `;

  const parent = rows[0];
  if (!parent) {
    throw new AppError("PARENT_TASK_NOT_FOUND", "Parent task was not found.", 404);
  }

  if (parent.project_id !== input.projectId || parent.list_id !== input.listId) {
    throw new AppError("PARENT_TASK_SCOPE_MISMATCH", "Parent task must belong to the same project and list.", 409);
  }

  const parentDepth = await getTaskDepth(sql, context, input.parentTaskId);
  if (parentDepth >= maxTaskDepth) {
    throw new AppError("TASK_DEPTH_EXCEEDED", `Tasks can only be nested ${maxTaskDepth} levels deep.`, 409);
  }
};

const assertTaskMoveAllowed = async (
  sql: QuerySql,
  context: WorkspaceContext,
  input: { taskId: string; projectId: string; nextListId: string; currentListId: string; parentTaskId: string | null }
) => {
  if (input.nextListId === input.currentListId) {
    return;
  }

  if (input.parentTaskId) {
    await assertParentTaskAllowed(sql, context, {
      projectId: input.projectId,
      listId: input.nextListId,
      parentTaskId: input.parentTaskId
    });
  }

  const childRows = await sql<{ id: string }[]>`
    SELECT id
    FROM public.tasks
    WHERE organization_id = ${context.organization.id}
      AND parent_task_id = ${input.taskId}
      AND archived_at IS NULL
      AND deleted_at IS NULL
    LIMIT 1
  `;

  if (childRows.length > 0) {
    throw new AppError("TASK_MOVE_BLOCKED_BY_SUBTASKS", "Move subtasks before moving their parent task.", 409);
  }
};

const getInitialStatusId = async (
  sql: QuerySql,
  context: WorkspaceContext,
  projectId: string,
  listId: string
) => {
  const rows = await sql<{ id: string }[]>`
    SELECT id
    FROM public.task_statuses
    WHERE organization_id = ${context.organization.id}
      AND deleted_at IS NULL
      AND is_initial IS TRUE
      AND (
        (scope = 'list' AND project_id = ${projectId} AND list_id = ${listId})
        OR (scope = 'project' AND project_id = ${projectId} AND list_id IS NULL)
        OR (scope = 'global' AND project_id IS NULL AND list_id IS NULL)
      )
    ORDER BY
      CASE scope
        WHEN 'list' THEN 1
        WHEN 'project' THEN 2
        ELSE 3
      END,
      position ASC,
      id ASC
    LIMIT 1
  `;

  const status = rows[0];
  if (!status) {
    throw new AppError("TASK_STATUS_REQUIRED", "No initial task status is configured.", 409);
  }

  return status.id;
};

const getTaskStatusForList = async (
  sql: QuerySql,
  context: WorkspaceContext,
  projectId: string,
  listId: string,
  statusId: string
) => {
  const rows = await sql<{ id: string; is_done: boolean }[]>`
    SELECT id, is_done
    FROM public.task_statuses
    WHERE id = ${statusId}
      AND organization_id = ${context.organization.id}
      AND deleted_at IS NULL
      AND (
        (scope = 'global' AND project_id IS NULL AND list_id IS NULL)
        OR (scope = 'project' AND project_id = ${projectId} AND list_id IS NULL)
        OR (scope = 'list' AND project_id = ${projectId} AND list_id = ${listId})
      )
    LIMIT 1
  `;

  const status = rows[0];
  if (!status) {
    throw new AppError("TASK_STATUS_NOT_FOUND", "Task status was not found for this list.", 404);
  }

  return status;
};

const getAssignableProjectUserIds = async (
  sql: QuerySql,
  context: WorkspaceContext,
  projectId: string,
  assigneeIds: string[]
) => {
  const uniqueAssigneeIds = [...new Set(assigneeIds)];
  if (uniqueAssigneeIds.length === 0) {
    return uniqueAssigneeIds;
  }

  const rows = await sql<{ user_id: string }[]>`
    SELECT pm.user_id
    FROM public.project_memberships pm
    JOIN public.organization_memberships om
      ON om.organization_id = pm.organization_id
      AND om.user_id = pm.user_id
      AND om.status = 'active'
      AND om.deleted_at IS NULL
    WHERE pm.organization_id = ${context.organization.id}
      AND pm.project_id = ${projectId}
      AND pm.user_id = ANY(${uniqueAssigneeIds}::uuid[])
      AND pm.status = 'active'
      AND pm.deleted_at IS NULL
  `;

  if (rows.length !== uniqueAssigneeIds.length) {
    throw new AppError("ASSIGNEE_NOT_FOUND", "One or more assignees are not active project members.", 404);
  }

  return uniqueAssigneeIds;
};

const insertTaskActivity = async (
  sql: QuerySql,
  context: WorkspaceContext,
  input: {
    taskId: string;
    action: string;
    previousValue?: JsonObject | null;
    newValue?: JsonObject | null;
    targetType?: string;
    targetId?: string | null;
  }
) => {
  await sql`
    INSERT INTO public.task_activity_events (
      organization_id,
      task_id,
      actor_user_id,
      action,
      target_type,
      target_id,
      previous_value,
      new_value
    )
    VALUES (
      ${context.organization.id},
      ${input.taskId},
      ${context.user.id},
      ${input.action},
      ${input.targetType ?? "task"},
      ${input.targetId ?? input.taskId},
      ${input.previousValue === undefined ? null : sql.json(input.previousValue)},
      ${input.newValue === undefined ? null : sql.json(input.newValue)}
    )
  `;
};

const getTaskSummaryById = async (
  sql: QuerySql,
  context: WorkspaceContext,
  taskId: string
): Promise<TaskSummary | null> => {
  const rows = await sql<TaskRow[]>`
    SELECT
      t.id,
      t.organization_id,
      t.project_id,
      t.list_id,
      t.parent_task_id,
      t.title,
      t.priority,
      t.start_at,
      t.due_at,
      t.completed_at,
      t.updated_at,
      ts.id AS status_id,
      ts.key AS status_key,
      ts.name AS status_name,
      ts.category AS status_category,
      ts.color AS status_color,
      ts.is_done AS status_is_done,
      ts.is_initial AS status_is_initial,
      array_remove(array_agg(ta.assignee_user_id ORDER BY ta.assigned_at ASC), NULL) AS assignee_ids,
      child_counts.subtask_count
    FROM public.tasks t
    JOIN public.task_statuses ts
      ON ts.id = t.status_id
      AND ts.organization_id = t.organization_id
      AND ts.deleted_at IS NULL
    LEFT JOIN public.task_assignees ta
      ON ta.task_id = t.id
      AND ta.organization_id = t.organization_id
      AND ta.removed_at IS NULL
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS subtask_count
      FROM public.tasks child
      WHERE child.organization_id = t.organization_id
        AND child.parent_task_id = t.id
        AND child.archived_at IS NULL
        AND child.deleted_at IS NULL
    ) child_counts ON TRUE
    WHERE t.id = ${taskId}
      AND t.organization_id = ${context.organization.id}
      AND t.deleted_at IS NULL
    GROUP BY t.id, ts.id, child_counts.subtask_count
    LIMIT 1
  `;

  const row = rows[0];
  return row ? toTaskSummary(row) : null;
};

const getTaskDetailRow = async (
  sql: QuerySql,
  context: WorkspaceContext,
  projectId: string,
  taskId: string
) => {
  const rows = await sql<TaskDetailRow[]>`
    SELECT
      t.id,
      t.organization_id,
      t.project_id,
      t.list_id,
      t.parent_task_id,
      t.title,
      t.description_text,
      t.priority,
      t.start_at,
      t.due_at,
      t.completed_at,
      t.created_at,
      t.updated_at,
      ts.id AS status_id,
      ts.key AS status_key,
      ts.name AS status_name,
      ts.category AS status_category,
      ts.color AS status_color,
      ts.is_done AS status_is_done,
      ts.is_initial AS status_is_initial,
      array_remove(array_agg(ta.assignee_user_id ORDER BY ta.assigned_at ASC), NULL) AS assignee_ids,
      child_counts.subtask_count
    FROM public.tasks t
    JOIN public.task_statuses ts
      ON ts.id = t.status_id
      AND ts.organization_id = t.organization_id
      AND ts.deleted_at IS NULL
    LEFT JOIN public.task_assignees ta
      ON ta.task_id = t.id
      AND ta.organization_id = t.organization_id
      AND ta.removed_at IS NULL
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS subtask_count
      FROM public.tasks child
      WHERE child.organization_id = t.organization_id
        AND child.parent_task_id = t.id
        AND child.archived_at IS NULL
        AND child.deleted_at IS NULL
    ) child_counts ON TRUE
    WHERE t.id = ${taskId}
      AND t.organization_id = ${context.organization.id}
      AND t.project_id = ${projectId}
      AND t.deleted_at IS NULL
    GROUP BY t.id, ts.id, child_counts.subtask_count
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    throw new AppError("TASK_NOT_FOUND", "Task was not found.", 404);
  }

  return row;
};

const listTaskComments = async (sql: QuerySql, context: WorkspaceContext, taskId: string) => {
  const rows = await sql<TaskCommentRow[]>`
    SELECT id, organization_id, task_id, author_user_id, body_text, created_at, updated_at
    FROM public.task_comments
    WHERE organization_id = ${context.organization.id}
      AND task_id = ${taskId}
      AND deleted_at IS NULL
    ORDER BY created_at ASC, id ASC
    LIMIT 200
  `;

  return rows.map(toTaskComment);
};

const listTaskActivity = async (sql: QuerySql, context: WorkspaceContext, taskId: string) => {
  const rows = await sql<TaskActivityEventRow[]>`
    SELECT id, organization_id, task_id, actor_user_id, action, target_type, target_id, previous_value, new_value, created_at
    FROM public.task_activity_events
    WHERE organization_id = ${context.organization.id}
      AND task_id = ${taskId}
    ORDER BY created_at DESC, id DESC
    LIMIT 100
  `;

  return rows.map(toTaskActivityEvent);
};

const listSubtasks = async (
  sql: QuerySql,
  context: WorkspaceContext,
  input: { projectId: string; parentTaskId: string }
) => {
  const rows = await sql<TaskRow[]>`
    SELECT
      t.id,
      t.organization_id,
      t.project_id,
      t.list_id,
      t.parent_task_id,
      t.title,
      t.priority,
      t.start_at,
      t.due_at,
      t.completed_at,
      t.updated_at,
      ts.id AS status_id,
      ts.key AS status_key,
      ts.name AS status_name,
      ts.category AS status_category,
      ts.color AS status_color,
      ts.is_done AS status_is_done,
      ts.is_initial AS status_is_initial,
      array_remove(array_agg(ta.assignee_user_id ORDER BY ta.assigned_at ASC), NULL) AS assignee_ids,
      child_counts.subtask_count
    FROM public.tasks t
    JOIN public.task_statuses ts
      ON ts.id = t.status_id
      AND ts.organization_id = t.organization_id
      AND ts.deleted_at IS NULL
    LEFT JOIN public.task_assignees ta
      ON ta.task_id = t.id
      AND ta.organization_id = t.organization_id
      AND ta.removed_at IS NULL
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS subtask_count
      FROM public.tasks child
      WHERE child.organization_id = t.organization_id
        AND child.parent_task_id = t.id
        AND child.archived_at IS NULL
        AND child.deleted_at IS NULL
    ) child_counts ON TRUE
    WHERE t.organization_id = ${context.organization.id}
      AND t.project_id = ${input.projectId}
      AND t.parent_task_id = ${input.parentTaskId}
      AND t.archived_at IS NULL
      AND t.deleted_at IS NULL
    GROUP BY t.id, ts.id, child_counts.subtask_count
    ORDER BY t.sort_order ASC, t.updated_at DESC, t.id DESC
    LIMIT 100
  `;

  return rows.map(toTaskSummary);
};

export const getWorkspaceContext = async (userId: string): Promise<WorkspaceContext> => {
  const sql = getSql();
  const rows = await sql<WorkspaceContextRow[]>`
    SELECT
      au.id AS user_id,
      au.email,
      au.display_name,
      o.id AS organization_id,
      o.slug AS organization_slug,
      o.name AS organization_name,
      r.id AS role_id,
      r.key AS role_key,
      r.name AS role_name,
      array_remove(array_agg(rp.permission_key ORDER BY rp.permission_key), NULL) AS permissions
    FROM public.app_users au
    JOIN public.organization_memberships om
      ON om.user_id = au.id
      AND om.status = 'active'
      AND om.deleted_at IS NULL
    JOIN public.organizations o
      ON o.id = om.organization_id
      AND o.archived_at IS NULL
      AND o.deleted_at IS NULL
    JOIN public.roles r
      ON r.id = om.role_id
      AND r.organization_id = om.organization_id
      AND r.deleted_at IS NULL
    LEFT JOIN public.role_permissions rp
      ON rp.role_id = r.id
      AND rp.organization_id = r.organization_id
    WHERE au.id = ${userId}
      AND au.deleted_at IS NULL
    GROUP BY au.id, au.email, au.display_name, o.id, o.slug, o.name, r.id, r.key, r.name, om.joined_at, om.created_at
    ORDER BY om.joined_at ASC NULLS LAST, om.created_at ASC
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    throw new AppError("ORG_MEMBERSHIP_REQUIRED", "No active organization membership was found.", 403);
  }

  const permissions = toPermissionKeys(row.permissions);
  const user: AppUser = {
    id: row.user_id,
    email: row.email,
    displayName: row.display_name
  };
  const role: Role = {
    id: row.role_id,
    organizationId: row.organization_id,
    key: row.role_key,
    name: row.role_name,
    permissions
  };

  return {
    user,
    organization: {
      id: row.organization_id,
      slug: row.organization_slug,
      name: row.organization_name
    },
    role,
    hasFullOrganizationAuthority: row.role_key === "superadmin"
  };
};

export const listPermissions = async (context: WorkspaceContext): Promise<PermissionCollection> => {
  assertPermission(context, Permission.RoleView);
  const sql = getSql();
  const rows = await sql<PermissionDefinitionRow[]>`
    SELECT key, module, description
    FROM public.permissions
    ORDER BY module ASC, key ASC
    LIMIT 500
  `;

  return {
    items: rows.flatMap((row) => {
      const permissionKey = toPermissionKeys([row.key])[0];
      if (!permissionKey) {
        return [];
      }

      return [
        {
          key: permissionKey,
          module: row.module,
          description: row.description
        }
      ];
    })
  };
};

export const listRoles = async (context: WorkspaceContext): Promise<RoleCollection> => {
  assertPermission(context, Permission.RoleView);
  const sql = getSql();
  const rows = await sql<ManagedRoleRow[]>`
    SELECT
      r.id,
      r.organization_id,
      r.key,
      r.name,
      r.description,
      r.is_system,
      r.created_at,
      r.updated_at,
      array_remove(array_agg(rp.permission_key ORDER BY rp.permission_key), NULL) AS permissions
    FROM public.roles r
    LEFT JOIN public.role_permissions rp
      ON rp.role_id = r.id
      AND rp.organization_id = r.organization_id
    WHERE r.organization_id = ${context.organization.id}
      AND r.deleted_at IS NULL
    GROUP BY r.id
    ORDER BY r.is_system DESC, r.name ASC, r.id ASC
    LIMIT 200
  `;

  return { items: rows.map(toManagedRole) };
};

export const createRole = async (context: WorkspaceContext, input: CreateRoleRequest): Promise<ManagedRole> => {
  assertPermission(context, Permission.RoleCreate);
  const sql = getSql();
  const permissions = uniquePermissionKeys(input.permissions);
  const description = nullableText(input.description);

  if (input.key === "superadmin") {
    throw new AppError("ROLE_KEY_RESERVED", "This role key is reserved.", 409);
  }

  return await sql.begin(async (tx) => {
    const duplicateRows = await tx<{ id: string }[]>`
      SELECT id
      FROM public.roles
      WHERE organization_id = ${context.organization.id}
        AND key = ${input.key}
        AND deleted_at IS NULL
      LIMIT 1
    `;

    if (duplicateRows.length > 0) {
      throw new AppError("ROLE_KEY_EXISTS", "Role key already exists.", 409);
    }

    const roleRows = await tx<{ id: string }[]>`
      INSERT INTO public.roles (organization_id, key, name, description, is_system, created_by)
      VALUES (${context.organization.id}, ${input.key}, ${input.name}, ${description ?? null}, false, ${context.user.id})
      RETURNING id
    `;

    const roleId = roleRows[0]?.id;
    if (!roleId) {
      throw new AppError("ROLE_CREATE_FAILED", "Role could not be created.", 500);
    }

    if (permissions.length > 0) {
      await tx`
        INSERT INTO public.role_permissions (organization_id, role_id, permission_key, granted_by)
        SELECT ${context.organization.id}, ${roleId}, permission_key, ${context.user.id}
        FROM unnest(${permissions}::text[]) AS permission_key
      `;
    }

    return await getManagedRoleById(tx, context, roleId);
  });
};

export const updateRole = async (
  context: WorkspaceContext,
  roleId: string,
  input: UpdateRoleRequest
): Promise<ManagedRole> => {
  assertPermission(context, Permission.RoleUpdate);
  const sql = getSql();
  const current = await getManagedRoleById(sql, context, roleId);
  assertManagedRoleEditable(current);

  const hasName = input.name !== undefined;
  const hasDescription = input.description !== undefined;
  const description = nullableText(input.description);

  await sql`
    UPDATE public.roles
    SET name = CASE WHEN ${hasName} THEN ${input.name ?? ""} ELSE name END,
        description = CASE WHEN ${hasDescription} THEN ${description ?? null} ELSE description END,
        updated_at = now()
    WHERE id = ${roleId}
      AND organization_id = ${context.organization.id}
      AND deleted_at IS NULL
  `;

  return await getManagedRoleById(sql, context, roleId);
};

export const updateRolePermissions = async (
  context: WorkspaceContext,
  roleId: string,
  input: UpdateRolePermissionsRequest
): Promise<ManagedRole> => {
  assertPermission(context, Permission.RoleAssignPermission);
  const sql = getSql();
  const permissions = uniquePermissionKeys(input.permissions);

  return await sql.begin(async (tx) => {
    const current = await getManagedRoleById(tx, context, roleId);
    assertManagedRoleEditable(current);

    await tx`
      DELETE FROM public.role_permissions
      WHERE organization_id = ${context.organization.id}
        AND role_id = ${roleId}
    `;

    if (permissions.length > 0) {
      await tx`
        INSERT INTO public.role_permissions (organization_id, role_id, permission_key, granted_by)
        SELECT ${context.organization.id}, ${roleId}, permission_key, ${context.user.id}
        FROM unnest(${permissions}::text[]) AS permission_key
      `;
    }

    await tx`
      UPDATE public.roles
      SET updated_at = now()
      WHERE id = ${roleId}
        AND organization_id = ${context.organization.id}
        AND deleted_at IS NULL
    `;

    return await getManagedRoleById(tx, context, roleId);
  });
};

export const archiveRole = async (context: WorkspaceContext, roleId: string) => {
  assertPermission(context, Permission.RoleDelete);
  const sql = getSql();
  const current = await getManagedRoleById(sql, context, roleId);
  assertManagedRoleEditable(current);

  const usageRows = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count
    FROM public.organization_memberships
    WHERE organization_id = ${context.organization.id}
      AND role_id = ${roleId}
      AND status = 'active'
      AND deleted_at IS NULL
  `;

  if (Number(usageRows[0]?.count ?? 0) > 0) {
    throw new AppError("ROLE_IN_USE", "Role is assigned to active organization members.", 409);
  }

  await sql`
    UPDATE public.roles
    SET deleted_at = now(), deleted_by = ${context.user.id}, updated_at = now()
    WHERE id = ${roleId}
      AND organization_id = ${context.organization.id}
      AND deleted_at IS NULL
  `;

  return { ok: true as const };
};

export const listOrganizationMembers = async (
  context: WorkspaceContext
): Promise<OrganizationMemberCollection> => {
  assertPermission(context, Permission.RoleView);
  const sql = getSql();
  const rows = await sql<OrganizationMemberRow[]>`
    SELECT
      om.id,
      om.organization_id,
      au.id AS user_id,
      au.email,
      au.display_name,
      r.id AS role_id,
      r.key AS role_key,
      r.name AS role_name,
      array_remove(array_agg(rp.permission_key ORDER BY rp.permission_key), NULL) AS role_permissions,
      om.status,
      om.joined_at,
      om.created_at,
      om.updated_at
    FROM public.organization_memberships om
    JOIN public.app_users au
      ON au.id = om.user_id
      AND au.deleted_at IS NULL
    JOIN public.roles r
      ON r.id = om.role_id
      AND r.organization_id = om.organization_id
      AND r.deleted_at IS NULL
    LEFT JOIN public.role_permissions rp
      ON rp.role_id = r.id
      AND rp.organization_id = r.organization_id
    WHERE om.organization_id = ${context.organization.id}
      AND om.deleted_at IS NULL
    GROUP BY om.id, au.id, r.id
    ORDER BY
      CASE om.status
        WHEN 'active' THEN 1
        WHEN 'invited' THEN 2
        ELSE 3
      END,
      au.display_name ASC,
      au.id ASC
    LIMIT 500
  `;

  return { items: rows.map(toOrganizationMember) };
};

export const updateOrganizationMember = async (
  context: WorkspaceContext,
  membershipId: string,
  input: UpdateOrganizationMemberRequest
) => {
  assertPermission(context, Permission.RoleUpdate);
  const sql = getSql();

  const currentRows = await sql<{ user_id: string; role_key: string; status: EditableMembershipStatus | "invited" }[]>`
    SELECT om.user_id, r.key AS role_key, om.status
    FROM public.organization_memberships om
    JOIN public.roles r
      ON r.id = om.role_id
      AND r.organization_id = om.organization_id
      AND r.deleted_at IS NULL
    WHERE om.id = ${membershipId}
      AND om.organization_id = ${context.organization.id}
      AND om.deleted_at IS NULL
    LIMIT 1
  `;

  const current = currentRows[0];
  if (!current) {
    throw new AppError("ORG_MEMBER_NOT_FOUND", "Organization member was not found.", 404);
  }

  if (current.user_id === context.user.id) {
    throw new AppError("SELF_MEMBERSHIP_UPDATE_FORBIDDEN", "You cannot change your own organization membership.", 409);
  }

  if (input.roleId) {
    await assertRoleExists(sql, context, input.roleId);
  }

  if (current.role_key === "superadmin" && (input.status === "disabled" || input.roleId)) {
    await assertOrganizationWillKeepSuperadmin(sql, context, membershipId);
  }

  const hasRole = input.roleId !== undefined;
  const hasStatus = input.status !== undefined;

  await sql`
    UPDATE public.organization_memberships
    SET role_id = CASE WHEN ${hasRole} THEN ${input.roleId ?? "00000000-0000-4000-8000-000000000000"}::uuid ELSE role_id END,
        status = CASE WHEN ${hasStatus} THEN ${input.status ?? "active"} ELSE status END,
        joined_at = CASE
          WHEN ${hasStatus} AND ${input.status ?? "active"} = 'active' THEN COALESCE(joined_at, now())
          ELSE joined_at
        END,
        updated_at = now()
    WHERE id = ${membershipId}
      AND organization_id = ${context.organization.id}
      AND deleted_at IS NULL
  `;

  const updatedRows = await sql<OrganizationMemberRow[]>`
    SELECT
      om.id,
      om.organization_id,
      au.id AS user_id,
      au.email,
      au.display_name,
      r.id AS role_id,
      r.key AS role_key,
      r.name AS role_name,
      array_remove(array_agg(rp.permission_key ORDER BY rp.permission_key), NULL) AS role_permissions,
      om.status,
      om.joined_at,
      om.created_at,
      om.updated_at
    FROM public.organization_memberships om
    JOIN public.app_users au
      ON au.id = om.user_id
      AND au.deleted_at IS NULL
    JOIN public.roles r
      ON r.id = om.role_id
      AND r.organization_id = om.organization_id
      AND r.deleted_at IS NULL
    LEFT JOIN public.role_permissions rp
      ON rp.role_id = r.id
      AND rp.organization_id = r.organization_id
    WHERE om.id = ${membershipId}
      AND om.organization_id = ${context.organization.id}
      AND om.deleted_at IS NULL
    GROUP BY om.id, au.id, r.id
    LIMIT 1
  `;

  const updated = updatedRows[0];
  if (!updated) {
    throw new AppError("ORG_MEMBER_NOT_FOUND", "Organization member was not found.", 404);
  }

  return toOrganizationMember(updated);
};

export const listProjects = async (context: WorkspaceContext) => {
  assertPermission(context, Permission.ProjectView);
  const sql = getSql();

  const rows = await sql<ProjectRow[]>`
    SELECT DISTINCT p.id, p.organization_id, p.key, p.name, p.description, p.updated_at
    FROM public.projects p
    LEFT JOIN public.project_memberships pm
      ON pm.organization_id = p.organization_id
      AND pm.project_id = p.id
      AND pm.user_id = ${context.user.id}
      AND pm.status = 'active'
      AND pm.deleted_at IS NULL
    WHERE p.organization_id = ${context.organization.id}
      AND p.archived_at IS NULL
      AND p.deleted_at IS NULL
      AND (${context.hasFullOrganizationAuthority} OR pm.id IS NOT NULL)
    ORDER BY p.updated_at DESC, p.id DESC
    LIMIT 100
  `;

  return { items: rows.map(toProjectSummary) };
};

export const createProject = async (context: WorkspaceContext, input: CreateProjectRequest): Promise<ProjectSummary> => {
  assertPermission(context, Permission.ProjectCreate);
  const sql = getSql();
  const description = nullableText(input.description);

  return await sql.begin(async (tx) => {
    const existingRows = await tx<{ id: string }[]>`
      SELECT id
      FROM public.projects
      WHERE organization_id = ${context.organization.id}
        AND key = ${input.key}
        AND deleted_at IS NULL
      LIMIT 1
    `;

    if (existingRows.length > 0) {
      throw new AppError("PROJECT_KEY_EXISTS", "Project key already exists.", 409);
    }

    const projectRows = await tx<ProjectRow[]>`
      INSERT INTO public.projects (organization_id, key, name, description, created_by)
      VALUES (${context.organization.id}, ${input.key}, ${input.name}, ${description ?? null}, ${context.user.id})
      RETURNING id, organization_id, key, name, description, updated_at
    `;
    const project = projectRows[0];
    if (!project) {
      throw new AppError("PROJECT_CREATE_FAILED", "Project could not be created.", 500);
    }

    await tx`
      INSERT INTO public.project_memberships (organization_id, project_id, user_id, access_level, status, created_by)
      VALUES (${context.organization.id}, ${project.id}, ${context.user.id}, 'manage', 'active', ${context.user.id})
      ON CONFLICT DO NOTHING
    `;

    const listRows = await tx<{ id: string }[]>`
      INSERT INTO public.lists (organization_id, project_id, name, position, created_by)
      VALUES (${context.organization.id}, ${project.id}, 'Inbox', 1000, ${context.user.id})
      RETURNING id
    `;
    const defaultListId = listRows[0]?.id;
    if (!defaultListId) {
      throw new AppError("LIST_CREATE_FAILED", "Default list could not be created.", 500);
    }

    for (const status of defaultProjectStatuses) {
      await tx`
        INSERT INTO public.task_statuses (
          organization_id,
          scope,
          project_id,
          list_id,
          key,
          name,
          category,
          is_initial,
          is_terminal,
          color,
          position,
          created_by
        )
        VALUES (
          ${context.organization.id},
          'project',
          ${project.id},
          NULL,
          ${status.key},
          ${status.name},
          ${status.category},
          ${status.isInitial},
          ${status.isTerminal},
          ${status.color},
          ${status.position},
          ${context.user.id}
        )
      `;
    }

    return toProjectSummary(project);
  });
};

export const updateProject = async (
  context: WorkspaceContext,
  projectId: string,
  input: UpdateProjectRequest
): Promise<ProjectSummary> => {
  assertPermission(context, Permission.ProjectUpdate);
  const sql = getSql();
  await assertProjectAccess(sql, context, projectId, "manage");

  const hasKey = input.key !== undefined;
  const hasName = input.name !== undefined;
  const hasDescription = input.description !== undefined;
  const description = nullableText(input.description);

  if (input.key) {
    const duplicateRows = await sql<{ id: string }[]>`
      SELECT id
      FROM public.projects
      WHERE organization_id = ${context.organization.id}
        AND key = ${input.key}
        AND id <> ${projectId}
        AND deleted_at IS NULL
      LIMIT 1
    `;

    if (duplicateRows.length > 0) {
      throw new AppError("PROJECT_KEY_EXISTS", "Project key already exists.", 409);
    }
  }

  const rows = await sql<ProjectRow[]>`
    UPDATE public.projects
    SET key = CASE WHEN ${hasKey} THEN ${input.key ?? ""} ELSE key END,
        name = CASE WHEN ${hasName} THEN ${input.name ?? ""} ELSE name END,
        description = CASE WHEN ${hasDescription} THEN ${description ?? null} ELSE description END,
        updated_at = now()
    WHERE id = ${projectId}
      AND organization_id = ${context.organization.id}
      AND archived_at IS NULL
      AND deleted_at IS NULL
    RETURNING id, organization_id, key, name, description, updated_at
  `;

  const row = rows[0];
  if (!row) {
    throw new AppError("PROJECT_NOT_FOUND", "Project was not found.", 404);
  }

  return toProjectSummary(row);
};

export const archiveProject = async (context: WorkspaceContext, projectId: string) => {
  assertPermission(context, Permission.ProjectDelete);
  const sql = getSql();
  await assertProjectAccess(sql, context, projectId, "manage");

  await sql`
    UPDATE public.projects
    SET archived_at = now(), updated_at = now()
    WHERE id = ${projectId}
      AND organization_id = ${context.organization.id}
      AND archived_at IS NULL
      AND deleted_at IS NULL
  `;

  return { ok: true as const };
};

export const listProjectMembers = async (
  context: WorkspaceContext,
  projectId: string
): Promise<ProjectMemberCollection> => {
  const sql = getSql();
  await assertProjectAccess(sql, context, projectId, "view");

  const rows = await sql<ProjectMemberRow[]>`
    SELECT
      pm.id AS membership_id,
      au.id AS user_id,
      au.email,
      au.display_name,
      pm.access_level,
      pm.status,
      pm.created_at,
      pm.updated_at
    FROM public.project_memberships pm
    JOIN public.app_users au
      ON au.id = pm.user_id
      AND au.deleted_at IS NULL
    WHERE pm.organization_id = ${context.organization.id}
      AND pm.project_id = ${projectId}
      AND pm.status = 'active'
      AND pm.deleted_at IS NULL
    ORDER BY au.display_name ASC, au.id ASC
    LIMIT 200
  `;

  return { items: rows.map(toProjectMember) };
};

export const upsertProjectMember = async (
  context: WorkspaceContext,
  projectId: string,
  input: UpsertProjectMemberRequest
): Promise<ProjectMember> => {
  assertPermission(context, Permission.ProjectManageMembers);
  const sql = getSql();
  await assertProjectAccess(sql, context, projectId, "manage");
  await assertActiveOrganizationMember(sql, context, input.userId);

  const rows = await sql<ProjectMemberRow[]>`
    WITH upserted AS (
      INSERT INTO public.project_memberships (organization_id, project_id, user_id, access_level, status, created_by)
      VALUES (${context.organization.id}, ${projectId}, ${input.userId}, ${input.accessLevel}, 'active', ${context.user.id})
      ON CONFLICT (organization_id, project_id, user_id) WHERE deleted_at IS NULL DO UPDATE
      SET access_level = EXCLUDED.access_level,
          status = 'active',
          updated_at = now()
      RETURNING id, user_id, access_level, status, created_at, updated_at
    )
    SELECT
      upserted.id AS membership_id,
      au.id AS user_id,
      au.email,
      au.display_name,
      upserted.access_level,
      upserted.status,
      upserted.created_at,
      upserted.updated_at
    FROM upserted
    JOIN public.app_users au
      ON au.id = upserted.user_id
      AND au.deleted_at IS NULL
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    throw new AppError("PROJECT_MEMBER_SAVE_FAILED", "Project member could not be saved.", 500);
  }

  return toProjectMember(row);
};

export const updateProjectMember = async (
  context: WorkspaceContext,
  projectId: string,
  userId: string,
  input: UpdateProjectMemberRequest
): Promise<ProjectMember> => {
  assertPermission(context, Permission.ProjectManageMembers);
  const sql = getSql();
  await assertProjectAccess(sql, context, projectId, "manage");

  const currentRows = await sql<{ access_level: ProjectAccessLevel; status: "invited" | "active" | "disabled" }[]>`
    SELECT access_level, status
    FROM public.project_memberships
    WHERE organization_id = ${context.organization.id}
      AND project_id = ${projectId}
      AND user_id = ${userId}
      AND deleted_at IS NULL
    LIMIT 1
  `;

  const current = currentRows[0];
  if (!current) {
    throw new AppError("PROJECT_MEMBER_NOT_FOUND", "Project member was not found.", 404);
  }

  const nextAccessLevel = input.accessLevel ?? current.access_level;
  const nextStatus = input.status ?? current.status;
  if (current.access_level === "manage" && (nextAccessLevel !== "manage" || nextStatus !== "active")) {
    await assertProjectWillKeepManager(sql, context, projectId, userId);
  }

  const hasAccessLevel = input.accessLevel !== undefined;
  const hasStatus = input.status !== undefined;

  const rows = await sql<ProjectMemberRow[]>`
    WITH updated AS (
      UPDATE public.project_memberships
      SET access_level = CASE WHEN ${hasAccessLevel} THEN ${nextAccessLevel} ELSE access_level END,
          status = CASE WHEN ${hasStatus} THEN ${nextStatus} ELSE status END,
          updated_at = now()
      WHERE organization_id = ${context.organization.id}
        AND project_id = ${projectId}
        AND user_id = ${userId}
        AND deleted_at IS NULL
      RETURNING id, user_id, access_level, status, created_at, updated_at
    )
    SELECT
      updated.id AS membership_id,
      au.id AS user_id,
      au.email,
      au.display_name,
      updated.access_level,
      updated.status,
      updated.created_at,
      updated.updated_at
    FROM updated
    JOIN public.app_users au
      ON au.id = updated.user_id
      AND au.deleted_at IS NULL
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    throw new AppError("PROJECT_MEMBER_NOT_FOUND", "Project member was not found.", 404);
  }

  return toProjectMember(row);
};

export const removeProjectMember = async (
  context: WorkspaceContext,
  projectId: string,
  userId: string
) => {
  assertPermission(context, Permission.ProjectManageMembers);
  const sql = getSql();
  await assertProjectAccess(sql, context, projectId, "manage");

  const currentRows = await sql<{ access_level: ProjectAccessLevel; status: "invited" | "active" | "disabled" }[]>`
    SELECT access_level, status
    FROM public.project_memberships
    WHERE organization_id = ${context.organization.id}
      AND project_id = ${projectId}
      AND user_id = ${userId}
      AND deleted_at IS NULL
    LIMIT 1
  `;

  const current = currentRows[0];
  if (!current) {
    throw new AppError("PROJECT_MEMBER_NOT_FOUND", "Project member was not found.", 404);
  }

  if (current.access_level === "manage" && current.status === "active") {
    await assertProjectWillKeepManager(sql, context, projectId, userId);
  }

  await sql`
    UPDATE public.project_memberships
    SET status = 'disabled',
        deleted_at = now(),
        deleted_by = ${context.user.id},
        updated_at = now()
    WHERE organization_id = ${context.organization.id}
      AND project_id = ${projectId}
      AND user_id = ${userId}
      AND deleted_at IS NULL
  `;

  return { ok: true as const };
};

export const listProjectLists = async (context: WorkspaceContext, projectId: string) => {
  const sql = getSql();
  await assertProjectAccess(sql, context, projectId, "view");
  assertPermission(context, Permission.ListView);

  const rows = await sql<ListRow[]>`
    SELECT id, organization_id, project_id, name, description, position::text AS position
    FROM public.lists
    WHERE organization_id = ${context.organization.id}
      AND project_id = ${projectId}
      AND archived_at IS NULL
      AND deleted_at IS NULL
    ORDER BY position ASC, id ASC
    LIMIT 200
  `;

  return { items: rows.map(toListSummary) };
};

export const createProjectList = async (
  context: WorkspaceContext,
  projectId: string,
  input: CreateListRequest
): Promise<ListSummary> => {
  assertPermission(context, Permission.ListCreate);
  const sql = getSql();
  await assertProjectAccess(sql, context, projectId, "manage");
  const description = nullableText(input.description);

  const rows = await sql<ListRow[]>`
    INSERT INTO public.lists (organization_id, project_id, name, description, position, created_by)
    SELECT ${context.organization.id}, ${projectId}, ${input.name}, ${description ?? null}, COALESCE(MAX(position), 0) + 1000, ${context.user.id}
    FROM public.lists
    WHERE organization_id = ${context.organization.id}
      AND project_id = ${projectId}
      AND deleted_at IS NULL
    RETURNING id, organization_id, project_id, name, description, position::text AS position
  `;

  const row = rows[0];
  if (!row) {
    throw new AppError("LIST_CREATE_FAILED", "List could not be created.", 500);
  }

  return toListSummary(row);
};

export const updateProjectList = async (
  context: WorkspaceContext,
  projectId: string,
  listId: string,
  input: UpdateListRequest
): Promise<ListSummary> => {
  assertPermission(context, Permission.ListUpdate);
  const sql = getSql();
  await assertProjectAccess(sql, context, projectId, "manage");

  const hasName = input.name !== undefined;
  const hasDescription = input.description !== undefined;
  const hasPosition = input.position !== undefined;
  const description = nullableText(input.description);

  const rows = await sql<ListRow[]>`
    UPDATE public.lists
    SET name = CASE WHEN ${hasName} THEN ${input.name ?? ""} ELSE name END,
        description = CASE WHEN ${hasDescription} THEN ${description ?? null} ELSE description END,
        position = CASE WHEN ${hasPosition} THEN ${input.position ?? "0"}::numeric ELSE position END,
        updated_at = now()
    WHERE id = ${listId}
      AND organization_id = ${context.organization.id}
      AND project_id = ${projectId}
      AND archived_at IS NULL
      AND deleted_at IS NULL
    RETURNING id, organization_id, project_id, name, description, position::text AS position
  `;

  const row = rows[0];
  if (!row) {
    throw new AppError("LIST_NOT_FOUND", "List was not found.", 404);
  }

  return toListSummary(row);
};

export const archiveProjectList = async (context: WorkspaceContext, projectId: string, listId: string) => {
  assertPermission(context, Permission.ListDelete);
  const sql = getSql();
  await assertProjectAccess(sql, context, projectId, "manage");

  await sql`
    UPDATE public.lists
    SET archived_at = now(), updated_at = now()
    WHERE id = ${listId}
      AND organization_id = ${context.organization.id}
      AND project_id = ${projectId}
      AND archived_at IS NULL
      AND deleted_at IS NULL
  `;

  return { ok: true as const };
};

export const listProjectStatuses = async (
  context: WorkspaceContext,
  projectId: string,
  input: { listId?: string }
): Promise<TaskStatusCollection> => {
  assertPermission(context, Permission.StatusView);
  const sql = getSql();
  await assertProjectAccess(sql, context, projectId, "view");

  if (input.listId) {
    await assertListAccess(sql, context, projectId, input.listId);
  }

  const rows = await sql<TaskStatusRow[]>`
    SELECT
      id,
      organization_id,
      scope,
      project_id,
      list_id,
      key,
      name,
      category,
      color,
      is_done,
      is_initial,
      position::text AS position
    FROM public.task_statuses
    WHERE organization_id = ${context.organization.id}
      AND deleted_at IS NULL
      AND (
        (scope = 'global' AND project_id IS NULL AND list_id IS NULL)
        OR (scope = 'project' AND project_id = ${projectId} AND list_id IS NULL)
        OR (${input.listId ?? null}::uuid IS NOT NULL AND scope = 'list' AND project_id = ${projectId} AND list_id = ${input.listId ?? null}::uuid)
      )
    ORDER BY
      CASE scope
        WHEN 'list' THEN 1
        WHEN 'project' THEN 2
        ELSE 3
      END,
      position ASC,
      id ASC
    LIMIT 200
  `;

  return { items: rows.map(toTaskStatusSummary) };
};

export const listProjectTasks = async (
  context: WorkspaceContext,
  input: { projectId: string; listId?: string; limit: number; cursor?: string }
): Promise<TaskPage> => {
  const sql = getSql();
  await assertProjectAccess(sql, context, input.projectId, "view");
  assertPermission(context, Permission.TaskView);

  const decodedCursor = decodeTaskCursor(input.cursor);
  const limit = Math.min(input.limit, 100);
  const rows = await sql<TaskRow[]>`
    SELECT
      t.id,
      t.organization_id,
      t.project_id,
      t.list_id,
      t.parent_task_id,
      t.title,
      t.priority,
      t.start_at,
      t.due_at,
      t.completed_at,
      t.updated_at,
      ts.id AS status_id,
      ts.key AS status_key,
      ts.name AS status_name,
      ts.category AS status_category,
      ts.color AS status_color,
      ts.is_done AS status_is_done,
      ts.is_initial AS status_is_initial,
      array_remove(array_agg(ta.assignee_user_id ORDER BY ta.assigned_at ASC), NULL) AS assignee_ids,
      child_counts.subtask_count
    FROM public.tasks t
    JOIN public.task_statuses ts
      ON ts.id = t.status_id
      AND ts.organization_id = t.organization_id
      AND ts.deleted_at IS NULL
    LEFT JOIN public.task_assignees ta
      ON ta.task_id = t.id
      AND ta.organization_id = t.organization_id
      AND ta.removed_at IS NULL
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS subtask_count
      FROM public.tasks child
      WHERE child.organization_id = t.organization_id
        AND child.parent_task_id = t.id
        AND child.archived_at IS NULL
        AND child.deleted_at IS NULL
    ) child_counts ON TRUE
    WHERE t.organization_id = ${context.organization.id}
      AND t.project_id = ${input.projectId}
      AND t.deleted_at IS NULL
      AND (${input.listId ?? null}::uuid IS NULL OR t.list_id = ${input.listId ?? null}::uuid)
      AND (${decodedCursor?.updatedAt ?? null}::timestamptz IS NULL OR (t.updated_at, t.id) < (${decodedCursor?.updatedAt ?? null}::timestamptz, ${decodedCursor?.id ?? null}::uuid))
    GROUP BY t.id, ts.id, child_counts.subtask_count
    ORDER BY t.updated_at DESC, t.id DESC
    LIMIT ${limit + 1}
  `;

  const summaries = rows.map(toTaskSummary);
  const pageItems = summaries.slice(0, limit);
  const hasMore = summaries.length > limit;

  return {
    items: pageItems,
    pageInfo: {
      hasMore,
      nextCursor: hasMore && pageItems.length > 0 ? encodeTaskCursor(pageItems[pageItems.length - 1]!) : null
    }
  };
};

export const getTaskDetail = async (
  context: WorkspaceContext,
  projectId: string,
  taskId: string
): Promise<TaskDetailResponse> => {
  const sql = getSql();
  await assertProjectAccess(sql, context, projectId, "view");
  assertPermission(context, Permission.TaskView);

  const task = toTaskDetail(await getTaskDetailRow(sql, context, projectId, taskId));
  const subtasks = await listSubtasks(sql, context, { projectId, parentTaskId: taskId });
  const comments = await listTaskComments(sql, context, taskId);
  const activity = await listTaskActivity(sql, context, taskId);

  return { task, subtasks, comments, activity };
};

export const createTask = async (
  context: WorkspaceContext,
  projectId: string,
  input: CreateTaskRequest
): Promise<TaskSummary> => {
  assertPermission(context, Permission.TaskCreate);
  const sql = getSql();
  await assertProjectAccess(sql, context, projectId, "submit");

  return await sql.begin(async (tx) => {
    await assertListAccess(tx, context, projectId, input.listId);
    await assertParentTaskAllowed(tx, context, {
      projectId,
      listId: input.listId,
      parentTaskId: input.parentTaskId ?? null
    });

    const statusId = input.statusId ?? (await getInitialStatusId(tx, context, projectId, input.listId));
    await getTaskStatusForList(tx, context, projectId, input.listId, statusId);

    const taskRows = await tx<{ id: string }[]>`
      INSERT INTO public.tasks (
        organization_id,
        project_id,
        list_id,
        parent_task_id,
        status_id,
        title,
        description_text,
        priority,
        start_at,
        due_at,
        created_by,
        updated_by
      )
      VALUES (
        ${context.organization.id},
        ${projectId},
        ${input.listId},
        ${input.parentTaskId ?? null},
        ${statusId},
        ${input.title},
        ${input.descriptionText ?? null},
        ${input.priority},
        ${input.startAt ?? null},
        ${input.dueAt ?? null},
        ${context.user.id},
        ${context.user.id}
      )
      RETURNING id
    `;

    const taskId = taskRows[0]?.id;
    if (!taskId) {
      throw new AppError("TASK_CREATE_FAILED", "Task could not be created.", 500);
    }

    if (input.assigneeIds.length > 0) {
      assertPermission(context, Permission.TaskAssign);
      const assigneeIds = await getAssignableProjectUserIds(tx, context, projectId, input.assigneeIds);
      await tx`
        INSERT INTO public.task_assignees (organization_id, task_id, assignee_user_id, assigned_by)
        SELECT ${context.organization.id}, ${taskId}, assignee_id, ${context.user.id}
        FROM unnest(${assigneeIds}::uuid[]) AS assignee_id
        ON CONFLICT (task_id, assignee_user_id) DO UPDATE
        SET removed_at = NULL,
            removed_by = NULL,
            assigned_by = EXCLUDED.assigned_by,
            assigned_at = now()
      `;
    }

    await insertTaskActivity(tx, context, {
      taskId,
      action: "TASK_CREATED",
      newValue: { title: input.title }
    });

    const task = await getTaskSummaryById(tx, context, taskId);
    if (!task) {
      throw new AppError("TASK_CREATE_FAILED", "Created task could not be loaded.", 500);
    }

    return task;
  });
};

export const updateTask = async (
  context: WorkspaceContext,
  projectId: string,
  taskId: string,
  input: UpdateTaskRequest
): Promise<TaskDetailResponse> => {
  assertPermission(context, Permission.TaskUpdate);
  const sql = getSql();
  await assertProjectAccess(sql, context, projectId, "submit");

  return await sql.begin(async (tx) => {
    const current = await getTaskDetailRow(tx, context, projectId, taskId);
    const nextListId = input.listId ?? current.list_id;

    if (input.listId) {
      await assertListAccess(tx, context, projectId, input.listId);
      await assertTaskMoveAllowed(tx, context, {
        taskId,
        projectId,
        nextListId,
        currentListId: current.list_id,
        parentTaskId: current.parent_task_id
      });
    }

    const nextStatusId = input.statusId ?? (input.listId ? await getInitialStatusId(tx, context, projectId, nextListId) : current.status_id);
    const nextStatus = await getTaskStatusForList(tx, context, projectId, nextListId, nextStatusId);

    if (input.assigneeIds) {
      assertPermission(context, Permission.TaskAssign);
      await getAssignableProjectUserIds(tx, context, projectId, input.assigneeIds);
    }

    const hasList = input.listId !== undefined;
    const hasStatus = input.statusId !== undefined || input.listId !== undefined;
    const hasTitle = input.title !== undefined;
    const hasDescription = input.descriptionText !== undefined;
    const hasPriority = input.priority !== undefined;
    const hasStart = input.startAt !== undefined;
    const hasDue = input.dueAt !== undefined;

    await tx`
      UPDATE public.tasks
      SET list_id = CASE WHEN ${hasList} THEN ${nextListId} ELSE list_id END,
          status_id = CASE WHEN ${hasStatus} THEN ${nextStatusId} ELSE status_id END,
          title = CASE WHEN ${hasTitle} THEN ${input.title ?? ""} ELSE title END,
          description_text = CASE WHEN ${hasDescription} THEN ${input.descriptionText ?? null} ELSE description_text END,
          priority = CASE WHEN ${hasPriority} THEN ${input.priority ?? "normal"} ELSE priority END,
          start_at = CASE WHEN ${hasStart} THEN ${input.startAt ?? null}::timestamptz ELSE start_at END,
          due_at = CASE WHEN ${hasDue} THEN ${input.dueAt ?? null}::timestamptz ELSE due_at END,
          completed_at = CASE
            WHEN ${hasStatus} AND ${nextStatus.is_done} THEN COALESCE(completed_at, now())
            WHEN ${hasStatus} AND ${!nextStatus.is_done} THEN NULL
            ELSE completed_at
          END,
          updated_by = ${context.user.id},
          updated_at = now()
      WHERE id = ${taskId}
        AND organization_id = ${context.organization.id}
        AND project_id = ${projectId}
        AND deleted_at IS NULL
    `;

    if (input.assigneeIds) {
      const assigneeIds = [...new Set(input.assigneeIds)];
      await tx`
        UPDATE public.task_assignees
        SET removed_at = now(), removed_by = ${context.user.id}
        WHERE organization_id = ${context.organization.id}
          AND task_id = ${taskId}
          AND removed_at IS NULL
          AND assignee_user_id <> ALL(${assigneeIds}::uuid[])
      `;

      if (assigneeIds.length > 0) {
        await tx`
          INSERT INTO public.task_assignees (organization_id, task_id, assignee_user_id, assigned_by)
          SELECT ${context.organization.id}, ${taskId}, assignee_id, ${context.user.id}
          FROM unnest(${assigneeIds}::uuid[]) AS assignee_id
          ON CONFLICT (task_id, assignee_user_id) DO UPDATE
          SET removed_at = NULL,
              removed_by = NULL,
              assigned_by = EXCLUDED.assigned_by,
              assigned_at = now()
        `;
      }
    }

    await insertTaskActivity(tx, context, {
      taskId,
      action: "TASK_UPDATED",
      previousValue: {
        title: current.title,
        listId: current.list_id,
        statusId: current.status_id,
        priority: current.priority,
        dueAt: current.due_at ? toIso(current.due_at) : null
      },
      newValue: {
        title: input.title ?? current.title,
        listId: nextListId,
        statusId: nextStatusId,
        priority: input.priority ?? current.priority,
        dueAt: input.dueAt !== undefined ? input.dueAt : current.due_at ? toIso(current.due_at) : null
      }
    });

    const task = toTaskDetail(await getTaskDetailRow(tx, context, projectId, taskId));
    const subtasks = await listSubtasks(tx, context, { projectId, parentTaskId: taskId });
    const comments = await listTaskComments(tx, context, taskId);
    const activity = await listTaskActivity(tx, context, taskId);

    return { task, subtasks, comments, activity };
  });
};

export const createTaskComment = async (
  context: WorkspaceContext,
  projectId: string,
  taskId: string,
  input: CreateTaskCommentRequest
): Promise<TaskDetailResponse> => {
  assertPermission(context, Permission.TaskUpdate);
  const sql = getSql();
  await assertProjectAccess(sql, context, projectId, "submit");

  return await sql.begin(async (tx) => {
    await getTaskDetailRow(tx, context, projectId, taskId);

    await tx`
      INSERT INTO public.task_comments (organization_id, task_id, author_user_id, body_text)
      VALUES (${context.organization.id}, ${taskId}, ${context.user.id}, ${input.bodyText})
    `;

    await insertTaskActivity(tx, context, {
      taskId,
      action: "COMMENT_CREATED",
      targetType: "comment",
      targetId: null,
      newValue: { bodyText: input.bodyText }
    });

    const task = toTaskDetail(await getTaskDetailRow(tx, context, projectId, taskId));
    const subtasks = await listSubtasks(tx, context, { projectId, parentTaskId: taskId });
    const comments = await listTaskComments(tx, context, taskId);
    const activity = await listTaskActivity(tx, context, taskId);

    return { task, subtasks, comments, activity };
  });
};


