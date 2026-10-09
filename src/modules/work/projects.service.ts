import { Permission } from "../../contracts/permissions.js";
import type {
  CreateProjectRequest,
  List,
  Project,
  ProjectAccessLevel,
  ProjectMember,
  UpdateProjectRequest
} from "../../contracts/work.js";
import type { CreateListRequestSchema, UpdateListRequestSchema } from "../../contracts/work.js";
import type { z } from "zod";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { nullableText, toIso, type QuerySql } from "../../lib/db-types.js";
import { rankAtEnd, rankForPlacement } from "../../lib/rank.js";
import { orgRoom } from "../../contracts/realtime.js";
import { logger } from "../../lib/logger.js";
import { evictUsersFromRoom, publishToRoom, publishToRooms, publishToUsers, resetRoom } from "../../realtime/publisher.js";
import type { AccessContext } from "../access/access-context.js";
import {
  assertPermission,
  assertProjectAccess,
  hasPermission,
  visibleProjectsPredicate
} from "../access/resource-access.js";
import { enqueueDomainEvents } from "../events/outbox.js";
import { toColor, toList, toUserRef, type ListRow, type UserRefJson } from "./mappers.js";
import { insertActivities } from "./tasks.repo.js";

type ProjectRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  visibility: "public" | "private";
  color: string;
  icon: string | null;
  rank: string;
  access_level: ProjectAccessLevel | null;
  has_status_override: boolean;
  lists: ListRow[] | null;
  created_at: Date;
  updated_at: Date;
};

const toProject = (context: AccessContext, row: ProjectRow): Project => {
  const myAccess: ProjectAccessLevel = context.hasFullOrganizationAuthority
    ? "manage"
    : (row.access_level ?? "submit");
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    color: toColor(row.color, "indigo"),
    icon: row.icon,
    rank: row.rank,
    myAccess,
    isMember: row.access_level !== null,
    hasStatusOverride: row.has_status_override,
    capabilities: {
      canUpdate: myAccess === "manage" && hasPermission(context, Permission.ProjectUpdate),
      canArchive: myAccess === "manage" && hasPermission(context, Permission.ProjectDelete),
      canManageMembers: myAccess === "manage" && hasPermission(context, Permission.ProjectManageMembers),
      canCreateList: myAccess === "manage" && hasPermission(context, Permission.ListCreate),
      canManageLists: myAccess === "manage" && hasPermission(context, Permission.ListUpdate),
      canManageStatuses: myAccess === "manage" && hasPermission(context, Permission.ListManageStatus),
      canCreateTask: myAccess !== "view" && hasPermission(context, Permission.TaskCreate)
    },
    lists: hasPermission(context, Permission.ListView) ? (row.lists ?? []).map(toList) : [],
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
};

const selectProjects = (sql: QuerySql, context: AccessContext, onlyProjectId: string | null) => sql<ProjectRow[]>`
  SELECT
    p.id, p.key, p.name, p.description, p.visibility, p.color, p.icon, p.rank, p.created_at, p.updated_at,
    pm.access_level,
    EXISTS (
      SELECT 1 FROM public.task_statuses ts
      WHERE ts.organization_id = p.organization_id AND ts.scope = 'project' AND ts.project_id = p.id AND ts.deleted_at IS NULL
    ) AS has_status_override,
    (
      SELECT coalesce(json_agg(json_build_object(
        'id', l.id, 'project_id', l.project_id, 'name', l.name, 'description', l.description,
        'color', l.color, 'rank', l.rank,
        'has_status_override', EXISTS (
          SELECT 1 FROM public.task_statuses lts
          WHERE lts.organization_id = l.organization_id AND lts.scope = 'list' AND lts.list_id = l.id AND lts.deleted_at IS NULL
        )
      ) ORDER BY l.rank COLLATE "C", l.id), '[]'::json)
      FROM public.lists l
      WHERE l.organization_id = p.organization_id
        AND l.project_id = p.id
        AND l.archived_at IS NULL
        AND l.deleted_at IS NULL
    ) AS lists
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
    AND (${onlyProjectId}::uuid IS NULL OR p.id = ${onlyProjectId}::uuid)
    AND ${visibleProjectsPredicate(sql, context)}
  ORDER BY p.rank COLLATE "C", p.id
  LIMIT 500
`;

const publishStructure = (projectId: string, kind: "lists" | "statuses" | "members" | "project") => {
  publishToRoom({ type: "project", id: projectId }, "project:structure", {
    projectId,
    kind,
    at: new Date().toISOString()
  });
};

/**
 * Sidebar refresh hint after commit. Public projects (or a visibility change) hint the whole
 * organization; private projects only their members, superadmins, and explicitly affected users.
 */
const publishSidebar = async (
  context: AccessContext,
  projectId: string,
  kind: "project" | "lists" | "members" | "removed",
  options: { broadcast?: boolean; extraUserIds?: string[] } = {}
) => {
  const event = { projectId, kind, at: new Date().toISOString() };
  try {
    const sql = getSql();
    const project = (
      await sql<{ visibility: "public" | "private" }[]>`
        SELECT visibility FROM public.projects WHERE id = ${projectId} AND organization_id = ${context.organization.id}
      `
    )[0];
    if (options.broadcast || project?.visibility === "public") {
      publishToRooms([orgRoom(context.organization.id)], "workspace:sidebar", event);
      return;
    }
    const recipients = await sql<{ user_id: string }[]>`
      SELECT pm.user_id FROM public.project_memberships pm
      WHERE pm.organization_id = ${context.organization.id} AND pm.project_id = ${projectId}
        AND pm.status = 'active' AND pm.deleted_at IS NULL
      UNION
      SELECT om.user_id FROM public.organization_memberships om
      JOIN public.roles r ON r.id = om.role_id AND r.organization_id = om.organization_id AND r.key = 'superadmin'
      WHERE om.organization_id = ${context.organization.id} AND om.status = 'active' AND om.deleted_at IS NULL
      LIMIT 5000
    `;
    publishToUsers([...recipients.map((row) => row.user_id), ...(options.extraUserIds ?? [])], "workspace:sidebar", event);
  } catch (error) {
    logger.warn({ err: error, projectId }, "Sidebar hint failed");
  }
};

export const listProjects = async (context: AccessContext) => {
  assertPermission(context, Permission.ProjectView);
  const rows = await selectProjects(getSql(), context, null);
  return { items: rows.map((row) => toProject(context, row)) };
};

export const getProject = async (context: AccessContext, projectId: string, sql: QuerySql = getSql()) => {
  await assertProjectAccess(context, projectId, "view", sql);
  const row = (await selectProjects(sql, context, projectId))[0];
  if (!row) {
    throw new AppError("PROJECT_NOT_FOUND", "Project was not found.", 404);
  }
  return toProject(context, row);
};

/**
 * A key is free when no other live or archived project uses it now or used it before: former keys keep
 * resolving old task links ("OLD-12", WK-35), so they are never handed to another project.
 */
const assertProjectKeyFree = async (sql: QuerySql, context: AccessContext, key: string, exceptId: string | null) => {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM public.projects
    WHERE organization_id = ${context.organization.id}
      AND key = ${key}
      AND deleted_at IS NULL
      AND (${exceptId}::uuid IS NULL OR id <> ${exceptId}::uuid)
    UNION ALL
    SELECT project_id FROM public.project_key_aliases
    WHERE organization_id = ${context.organization.id}
      AND key = ${key}
      AND (${exceptId}::uuid IS NULL OR project_id <> ${exceptId}::uuid)
    LIMIT 1
  `;
  if (rows.length > 0) {
    throw new AppError("PROJECT_KEY_EXISTS", "Project key already exists.", 409);
  }
};

const lockProjectKeys = (sql: QuerySql, context: AccessContext) =>
  sql`SELECT pg_advisory_xact_lock(hashtextextended(${`projects:${context.organization.id}`}, 0))`;

/**
 * PD-006 on access loss (BUG-WK-13 / BUG-WK-04): people who can no longer see a private project stop being
 * assignees (with an activity entry per task) and lose the inbox entries about it.
 * `userIds` null = everyone who is not an active project member.
 */
const revokeProjectAccessEffects = async (tx: QuerySql, context: AccessContext, projectId: string, userIds: string[] | null) => {
  const unassigned = await tx<{ task_id: string; assignee_user_id: string; list_id: string; parent_task_id: string | null }[]>`
    UPDATE public.task_assignees ta
    SET removed_at = now(), removed_by = ${context.user.id}
    FROM public.tasks t
    WHERE t.id = ta.task_id AND t.organization_id = ta.organization_id
      AND ta.organization_id = ${context.organization.id}
      AND t.project_id = ${projectId}
      AND ta.removed_at IS NULL
      AND ${
        userIds
          ? tx`ta.assignee_user_id = ANY(${userIds}::uuid[])`
          : tx`NOT EXISTS (
              SELECT 1 FROM public.project_memberships pm
              WHERE pm.organization_id = ta.organization_id AND pm.project_id = ${projectId}
                AND pm.user_id = ta.assignee_user_id AND pm.status = 'active' AND pm.deleted_at IS NULL
            )`
      }
    RETURNING ta.task_id, ta.assignee_user_id, t.list_id, t.parent_task_id
  `;
  await insertActivities(
    tx,
    context,
    unassigned.map((row) => ({
      taskId: row.task_id,
      action: "TASK_ASSIGNEE_REMOVED",
      targetType: "user",
      targetId: row.assignee_user_id,
      // The timeline names the user from targetId; the reason tells why nobody unassigned them by hand.
      previousValue: { reason: "project_access_revoked" }
    }))
  );
  // Superadmins keep seeing every project, so their inbox stays.
  await tx`
    DELETE FROM public.notifications n
    WHERE n.organization_id = ${context.organization.id}
      AND n.project_id = ${projectId}
      AND ${
        userIds
          ? tx`n.recipient_user_id = ANY(${userIds}::uuid[])`
          : tx`NOT EXISTS (
              SELECT 1 FROM public.project_memberships pm
              WHERE pm.organization_id = n.organization_id AND pm.project_id = ${projectId}
                AND pm.user_id = n.recipient_user_id AND pm.status = 'active' AND pm.deleted_at IS NULL
            )`
      }
      AND NOT EXISTS (
        SELECT 1 FROM public.organization_memberships om
        JOIN public.roles r ON r.id = om.role_id AND r.organization_id = om.organization_id AND r.key = 'superadmin'
        WHERE om.organization_id = n.organization_id AND om.user_id = n.recipient_user_id
          AND om.status = 'active' AND om.deleted_at IS NULL
      )
  `;
  const tasks = new Map(unassigned.map((row) => [row.task_id, { id: row.task_id, listId: row.list_id, parentTaskId: row.parent_task_id }]));
  return [...tasks.values()];
};

type ChangedTask = { id: string; listId: string; parentTaskId: string | null };

/** Live hints for tasks whose assignees were removed (a structure hint when there are many). */
const publishUnassigned = (projectId: string, tasks: ChangedTask[], actorId: string) => {
  if (tasks.length === 0) {
    return;
  }
  if (tasks.length > 100) {
    publishStructure(projectId, "statuses");
    return;
  }
  const at = new Date().toISOString();
  for (const task of tasks) {
    publishToRoom({ type: "project", id: projectId }, "task:changed", {
      projectId,
      listId: task.listId,
      taskId: task.id,
      parentTaskId: task.parentTaskId,
      kind: "updated",
      actorId,
      at
    });
  }
};

export const createProject = async (context: AccessContext, input: CreateProjectRequest): Promise<Project> => {
  assertPermission(context, Permission.ProjectCreate);
  const sql = getSql();

  const projectId = await sql.begin(async (tx) => {
    await assertProjectKeyFree(tx, context, input.key, null);
    // Serialize concurrent creates per organization so the key check and rank stay consistent.
    await lockProjectKeys(tx, context);
    await assertProjectKeyFree(tx, context, input.key, null);

    const rank = await rankAtEnd(tx, { table: "public.projects", where: { organization_id: context.organization.id } });
    const created = (
      await tx<{ id: string }[]>`
        INSERT INTO public.projects (organization_id, key, name, description, visibility, color, icon, rank, created_by)
        VALUES (
          ${context.organization.id}, ${input.key}, ${input.name}, ${nullableText(input.description) ?? null},
          ${input.visibility}, ${input.color}, ${input.icon ?? null}, ${rank}, ${context.user.id}
        )
        RETURNING id
      `
    )[0];
    if (!created) {
      throw new AppError("PROJECT_CREATE_FAILED", "Project could not be created.", 500);
    }

    await tx`
      INSERT INTO public.project_memberships (organization_id, project_id, user_id, access_level, status, created_by)
      VALUES (${context.organization.id}, ${created.id}, ${context.user.id}, 'manage', 'active', ${context.user.id})
    `;
    await tx`
      INSERT INTO public.lists (organization_id, project_id, name, rank, created_by)
      VALUES (${context.organization.id}, ${created.id}, 'List', 'a0', ${context.user.id})
    `;
    await enqueueDomainEvents(tx, [
      {
        organizationId: context.organization.id,
        type: "project.created",
        aggregateType: "project",
        aggregateId: created.id,
        actorUserId: context.user.id,
        payload: { key: input.key, name: input.name, visibility: input.visibility }
      }
    ]);
    return created.id;
  });

  await publishSidebar(context, projectId, "project");
  return await getProject(context, projectId);
};

export const updateProject = async (
  context: AccessContext,
  projectId: string,
  input: UpdateProjectRequest
): Promise<Project> => {
  assertPermission(context, Permission.ProjectUpdate);
  const sql = getSql();

  const outcome = await sql.begin(async (tx) => {
    const access = await assertProjectAccess(context, projectId, "manage", tx);
    const keyChanged = input.key !== undefined && input.key !== access.projectKey;
    if (keyChanged && input.key) {
      await lockProjectKeys(tx, context);
      await assertProjectKeyFree(tx, context, input.key, projectId);
      // The old key keeps resolving this project's task links (WK-35); taking back a former key drops its alias.
      await tx`
        INSERT INTO public.project_key_aliases (organization_id, project_id, key, created_by)
        VALUES (${context.organization.id}, ${projectId}, ${access.projectKey}, ${context.user.id})
        ON CONFLICT (organization_id, key) DO NOTHING
      `;
      await tx`
        DELETE FROM public.project_key_aliases
        WHERE organization_id = ${context.organization.id} AND project_id = ${projectId} AND key = ${input.key}
      `;
    }
    const rank = input.placement
      ? await rankForPlacement(
          tx,
          { table: "public.projects", where: { organization_id: context.organization.id }, excludeId: projectId },
          input.placement
        )
      : null;
    const description = nullableText(input.description);

    await tx`
      UPDATE public.projects
      SET key = coalesce(${input.key ?? null}, key),
          name = coalesce(${input.name ?? null}, name),
          description = CASE WHEN ${input.description !== undefined} THEN ${description ?? null} ELSE description END,
          visibility = coalesce(${input.visibility ?? null}, visibility),
          color = coalesce(${input.color ?? null}, color),
          icon = CASE WHEN ${input.icon !== undefined} THEN ${input.icon ?? null} ELSE icon END,
          rank = coalesce(${rank}, rank)
      WHERE id = ${projectId}
        AND organization_id = ${context.organization.id}
        AND deleted_at IS NULL
    `;
    const madePrivate = access.visibility === "public" && input.visibility === "private";
    const unassignedTasks = madePrivate ? await revokeProjectAccessEffects(tx, context, projectId, null) : [];
    return { madePrivate, unassignedTasks };
  });

  publishStructure(projectId, "project");
  if (outcome.madePrivate) {
    // Non-members who were watching the public project must lose its live events now.
    resetRoom({ type: "project", id: projectId });
    publishUnassigned(projectId, outcome.unassignedTasks, context.user.id);
  }
  await publishSidebar(context, projectId, "project", { broadcast: input.visibility !== undefined });
  return await getProject(context, projectId);
};

export const archiveProject = async (context: AccessContext, projectId: string) => {
  assertPermission(context, Permission.ProjectDelete);
  const sql = getSql();
  await assertProjectAccess(context, projectId, "manage", sql);
  await sql`
    UPDATE public.projects
    SET archived_at = now()
    WHERE id = ${projectId} AND organization_id = ${context.organization.id} AND archived_at IS NULL AND deleted_at IS NULL
  `;
  publishStructure(projectId, "project");
  await publishSidebar(context, projectId, "removed");
  return { ok: true as const };
};

type ArchivedProjectRow = {
  id: string;
  key: string;
  name: string;
  color: string;
  visibility: "public" | "private";
  archived_at: Date;
};

/** Archived projects the caller could restore (project.delete + manage access, WK-30). Newest first. */
export const listArchivedProjects = async (context: AccessContext) => {
  assertPermission(context, Permission.ProjectDelete);
  const sql = getSql();
  const rows = await sql<ArchivedProjectRow[]>`
    SELECT p.id, p.key, p.name, p.color, p.visibility, p.archived_at
    FROM public.projects p
    WHERE p.organization_id = ${context.organization.id}
      AND p.archived_at IS NOT NULL AND p.deleted_at IS NULL
      AND (${context.hasFullOrganizationAuthority} OR EXISTS (
        SELECT 1 FROM public.project_memberships pm
        WHERE pm.organization_id = p.organization_id AND pm.project_id = p.id AND pm.user_id = ${context.user.id}
          AND pm.access_level = 'manage' AND pm.status = 'active' AND pm.deleted_at IS NULL
      ))
    ORDER BY p.archived_at DESC, p.id
    LIMIT 500
  `;
  return {
    items: rows.map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      color: toColor(row.color, "indigo"),
      visibility: row.visibility,
      archivedAt: toIso(row.archived_at)
    }))
  };
};

/**
 * Brings an archived project back (WK-30). Its key stayed reserved while archived, so restoring never clashes;
 * to free a key for another project, restore it, change its key, and archive it again.
 */
export const restoreProject = async (context: AccessContext, projectId: string): Promise<Project> => {
  assertPermission(context, Permission.ProjectDelete);
  assertPermission(context, Permission.ProjectView);
  const sql = getSql();
  const restored = await sql<{ id: string }[]>`
    UPDATE public.projects p
    SET archived_at = NULL
    WHERE p.id = ${projectId} AND p.organization_id = ${context.organization.id}
      AND p.archived_at IS NOT NULL AND p.deleted_at IS NULL
      AND (${context.hasFullOrganizationAuthority} OR EXISTS (
        SELECT 1 FROM public.project_memberships pm
        WHERE pm.organization_id = p.organization_id AND pm.project_id = p.id AND pm.user_id = ${context.user.id}
          AND pm.access_level = 'manage' AND pm.status = 'active' AND pm.deleted_at IS NULL
      ))
    RETURNING p.id
  `;
  if (restored.length === 0) {
    throw new AppError("PROJECT_NOT_FOUND", "Project was not found.", 404);
  }
  publishStructure(projectId, "project");
  await publishSidebar(context, projectId, "project");
  return await getProject(context, projectId);
};

// Members ----------------------------------------------------------------------------------------

type MemberRow = { user: UserRefJson; access_level: ProjectAccessLevel; created_at: Date };

const toMember = (row: MemberRow): ProjectMember => ({
  user: toUserRef(row.user)!,
  accessLevel: row.access_level,
  createdAt: toIso(row.created_at)
});

const userJson = (sql: QuerySql) =>
  sql`json_build_object('id', au.id, 'display_name', au.display_name, 'email', au.email, 'avatar_url', au.avatar_url)`;

export const listProjectMembers = async (context: AccessContext, projectId: string) => {
  const sql = getSql();
  await assertProjectAccess(context, projectId, "view", sql);
  const rows = await sql<MemberRow[]>`
    SELECT ${userJson(sql)} AS user, pm.access_level, pm.created_at
    FROM public.project_memberships pm
    JOIN public.app_users au ON au.id = pm.user_id AND au.deleted_at IS NULL
    JOIN public.organization_memberships om
      ON om.organization_id = pm.organization_id AND om.user_id = pm.user_id AND om.status = 'active' AND om.deleted_at IS NULL
    WHERE pm.organization_id = ${context.organization.id}
      AND pm.project_id = ${projectId}
      AND pm.status = 'active'
      AND pm.deleted_at IS NULL
    ORDER BY CASE pm.access_level WHEN 'manage' THEN 1 WHEN 'submit' THEN 2 ELSE 3 END, au.display_name, au.id
    LIMIT 1000
  `;
  return { items: rows.map(toMember) };
};

/**
 * A project keeps at least one usable manager (BUG-WK-10): another "manage" member whose organization
 * membership is active and whose role can actually manage members (or a superadmin).
 */
const assertManagerRemains = async (sql: QuerySql, context: AccessContext, projectId: string, userId: string) => {
  const rows = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM public.project_memberships pm
    JOIN public.organization_memberships om
      ON om.organization_id = pm.organization_id AND om.user_id = pm.user_id AND om.status = 'active' AND om.deleted_at IS NULL
    JOIN public.roles r ON r.id = om.role_id AND r.organization_id = om.organization_id AND r.deleted_at IS NULL
    WHERE pm.organization_id = ${context.organization.id}
      AND pm.project_id = ${projectId}
      AND pm.user_id <> ${userId}
      AND pm.access_level = 'manage'
      AND pm.status = 'active'
      AND pm.deleted_at IS NULL
      AND (
        r.key = 'superadmin'
        OR EXISTS (
          SELECT 1 FROM public.role_permissions rp
          WHERE rp.role_id = r.id AND rp.organization_id = r.organization_id AND rp.permission_key = ${Permission.ProjectManageMembers}
        )
      )
  `;
  if ((rows[0]?.count ?? 0) === 0) {
    throw new AppError("PROJECT_MANAGER_REQUIRED", "A project needs at least one manager.", 409);
  }
};

/**
 * POST adds (or updates) a member; PATCH (`mode: "update"`) only changes an existing member's level and
 * answers 404 for anyone else instead of silently adding them (WK-36).
 */
export const upsertProjectMember = async (
  context: AccessContext,
  projectId: string,
  input: { userId: string; accessLevel: ProjectAccessLevel },
  mode: "upsert" | "update" = "upsert"
) => {
  assertPermission(context, Permission.ProjectManageMembers);
  const sql = getSql();

  const member = await sql.begin(async (tx) => {
    await assertProjectAccess(context, projectId, "manage", tx);
    // Serialize membership changes per project so two managers cannot demote each other to zero.
    await tx`SELECT 1 FROM public.projects WHERE id = ${projectId} AND organization_id = ${context.organization.id} FOR UPDATE`;
    const target = await tx<{ id: string }[]>`
      SELECT id FROM public.organization_memberships
      WHERE organization_id = ${context.organization.id} AND user_id = ${input.userId} AND status = 'active' AND deleted_at IS NULL
      LIMIT 1
    `;
    if (target.length === 0) {
      throw new AppError("ORG_MEMBER_NOT_FOUND", "Active organization member was not found.", 404);
    }

    const current = await tx<{ access_level: ProjectAccessLevel }[]>`
      SELECT access_level FROM public.project_memberships
      WHERE organization_id = ${context.organization.id} AND project_id = ${projectId} AND user_id = ${input.userId} AND deleted_at IS NULL
      FOR UPDATE
    `;
    if (mode === "update" && current.length === 0) {
      throw new AppError("PROJECT_MEMBER_NOT_FOUND", "Project member was not found.", 404);
    }
    if (current[0]?.access_level === "manage" && input.accessLevel !== "manage") {
      await assertManagerRemains(tx, context, projectId, input.userId);
    }

    await tx`
      INSERT INTO public.project_memberships (organization_id, project_id, user_id, access_level, status, created_by)
      VALUES (${context.organization.id}, ${projectId}, ${input.userId}, ${input.accessLevel}, 'active', ${context.user.id})
      ON CONFLICT (organization_id, project_id, user_id) WHERE deleted_at IS NULL
      DO UPDATE SET access_level = EXCLUDED.access_level, status = 'active'
    `;
    await enqueueDomainEvents(tx, [
      {
        organizationId: context.organization.id,
        type: "project.member_added",
        aggregateType: "project",
        aggregateId: projectId,
        actorUserId: context.user.id,
        payload: { userId: input.userId, accessLevel: input.accessLevel, isNew: current.length === 0 }
      }
    ]);

    const row = (
      await tx<MemberRow[]>`
        SELECT ${userJson(tx)} AS user, pm.access_level, pm.created_at
        FROM public.project_memberships pm
        JOIN public.app_users au ON au.id = pm.user_id
        WHERE pm.organization_id = ${context.organization.id} AND pm.project_id = ${projectId}
          AND pm.user_id = ${input.userId} AND pm.deleted_at IS NULL
        LIMIT 1
      `
    )[0];
    if (!row) {
      throw new AppError("PROJECT_MEMBER_SAVE_FAILED", "Project member could not be saved.", 500);
    }
    return toMember(row);
  });

  publishStructure(projectId, "members");
  await publishSidebar(context, projectId, "members", { extraUserIds: [input.userId] });
  return member;
};

export const removeProjectMember = async (context: AccessContext, projectId: string, userId: string) => {
  assertPermission(context, Permission.ProjectManageMembers);
  const sql = getSql();

  const outcome = await sql.begin(async (tx) => {
    const access = await assertProjectAccess(context, projectId, "manage", tx);
    // Serialize membership changes per project so two managers cannot demote each other to zero.
    await tx`SELECT 1 FROM public.projects WHERE id = ${projectId} AND organization_id = ${context.organization.id} FOR UPDATE`;
    const current = await tx<{ access_level: ProjectAccessLevel }[]>`
      SELECT access_level FROM public.project_memberships
      WHERE organization_id = ${context.organization.id} AND project_id = ${projectId} AND user_id = ${userId} AND deleted_at IS NULL
      FOR UPDATE
    `;
    if (current.length === 0) {
      throw new AppError("PROJECT_MEMBER_NOT_FOUND", "Project member was not found.", 404);
    }
    if (current[0]?.access_level === "manage") {
      await assertManagerRemains(tx, context, projectId, userId);
    }
    await tx`
      UPDATE public.project_memberships
      SET status = 'disabled', deleted_at = now(), deleted_by = ${context.user.id}
      WHERE organization_id = ${context.organization.id} AND project_id = ${projectId} AND user_id = ${userId} AND deleted_at IS NULL
    `;
    // Leaving a private project ends assignments there and its inbox entries (PD-006, BUG-WK-13 / BUG-WK-04).
    const unassignedTasks = access.visibility === "private" ? await revokeProjectAccessEffects(tx, context, projectId, [userId]) : [];
    return { visibility: access.visibility, unassignedTasks };
  });

  // Losing membership of a private project revokes live access immediately.
  if (outcome.visibility === "private") {
    evictUsersFromRoom([userId], { type: "project", id: projectId });
    publishUnassigned(projectId, outcome.unassignedTasks, context.user.id);
  }
  publishStructure(projectId, "members");
  await publishSidebar(context, projectId, "members", { extraUserIds: [userId] });
  return { ok: true as const };
};

// Lists ------------------------------------------------------------------------------------------

const selectList = (sql: QuerySql, context: AccessContext, listId: string) => sql<ListRow[]>`
  SELECT l.id, l.project_id, l.name, l.description, l.color, l.rank,
    EXISTS (
      SELECT 1 FROM public.task_statuses ts
      WHERE ts.organization_id = l.organization_id AND ts.scope = 'list' AND ts.list_id = l.id AND ts.deleted_at IS NULL
    ) AS has_status_override
  FROM public.lists l
  WHERE l.id = ${listId} AND l.organization_id = ${context.organization.id} AND l.deleted_at IS NULL AND l.archived_at IS NULL
  LIMIT 1
`;

export const assertListInProject = async (sql: QuerySql, context: AccessContext, projectId: string, listId: string) => {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM public.lists
    WHERE id = ${listId} AND organization_id = ${context.organization.id} AND project_id = ${projectId}
      AND archived_at IS NULL AND deleted_at IS NULL
    LIMIT 1
  `;
  if (rows.length === 0) {
    throw new AppError("LIST_NOT_FOUND", "List was not found.", 404);
  }
};

export const createList = async (
  context: AccessContext,
  projectId: string,
  input: z.infer<typeof CreateListRequestSchema>
): Promise<List> => {
  assertPermission(context, Permission.ListCreate);
  const sql = getSql();
  const listId = await sql.begin(async (tx) => {
    await assertProjectAccess(context, projectId, "manage", tx);
    const rank = await rankAtEnd(tx, {
      table: "public.lists",
      where: { organization_id: context.organization.id, project_id: projectId }
    });
    const row = (
      await tx<{ id: string }[]>`
        INSERT INTO public.lists (organization_id, project_id, name, description, color, rank, created_by)
        VALUES (${context.organization.id}, ${projectId}, ${input.name}, ${nullableText(input.description) ?? null},
                ${input.color ?? null}, ${rank}, ${context.user.id})
        RETURNING id
      `
    )[0];
    if (!row) {
      throw new AppError("LIST_CREATE_FAILED", "List could not be created.", 500);
    }
    return row.id;
  });
  publishStructure(projectId, "lists");
  await publishSidebar(context, projectId, "lists");
  const row = (await selectList(sql, context, listId))[0]!;
  return toList(row);
};

export const updateList = async (
  context: AccessContext,
  projectId: string,
  listId: string,
  input: z.infer<typeof UpdateListRequestSchema>
): Promise<List> => {
  assertPermission(context, Permission.ListUpdate);
  const sql = getSql();
  await sql.begin(async (tx) => {
    await assertProjectAccess(context, projectId, "manage", tx);
    await assertListInProject(tx, context, projectId, listId);
    const rank = input.placement
      ? await rankForPlacement(
          tx,
          { table: "public.lists", where: { organization_id: context.organization.id, project_id: projectId }, excludeId: listId },
          input.placement
        )
      : null;
    const description = nullableText(input.description);
    await tx`
      UPDATE public.lists
      SET name = coalesce(${input.name ?? null}, name),
          description = CASE WHEN ${input.description !== undefined} THEN ${description ?? null} ELSE description END,
          color = CASE WHEN ${input.color !== undefined} THEN ${input.color ?? null} ELSE color END,
          rank = coalesce(${rank}, rank)
      WHERE id = ${listId} AND organization_id = ${context.organization.id} AND project_id = ${projectId}
    `;
  });
  publishStructure(projectId, "lists");
  await publishSidebar(context, projectId, "lists");
  return toList((await selectList(sql, context, listId))[0]!);
};

export const archiveList = async (context: AccessContext, projectId: string, listId: string) => {
  assertPermission(context, Permission.ListDelete);
  const sql = getSql();
  await sql.begin(async (tx) => {
    await assertProjectAccess(context, projectId, "manage", tx);
    await assertListInProject(tx, context, projectId, listId);
    const remaining = await tx<{ count: number }[]>`
      SELECT count(*)::int AS count FROM public.lists
      WHERE organization_id = ${context.organization.id} AND project_id = ${projectId}
        AND archived_at IS NULL AND deleted_at IS NULL AND id <> ${listId}
    `;
    if ((remaining[0]?.count ?? 0) === 0) {
      throw new AppError("LAST_LIST", "A project needs at least one list.", 409);
    }
    await tx`
      UPDATE public.lists SET archived_at = now()
      WHERE id = ${listId} AND organization_id = ${context.organization.id} AND project_id = ${projectId}
    `;
  });
  // Its tasks leave every view with it (list/board/table, My tasks, search, reminders) until it is restored.
  publishStructure(projectId, "lists");
  publishStructure(projectId, "statuses");
  await publishSidebar(context, projectId, "lists");
  return { ok: true as const };
};

/** Archived lists of a project, newest first (for "Restore list"). */
export const listArchivedLists = async (context: AccessContext, projectId: string) => {
  assertPermission(context, Permission.ListView);
  const sql = getSql();
  await assertProjectAccess(context, projectId, "view", sql);
  const rows = await sql<(ListRow & { archived_at: Date })[]>`
    SELECT l.id, l.project_id, l.name, l.description, l.color, l.rank, l.archived_at,
      EXISTS (
        SELECT 1 FROM public.task_statuses ts
        WHERE ts.organization_id = l.organization_id AND ts.scope = 'list' AND ts.list_id = l.id AND ts.deleted_at IS NULL
      ) AS has_status_override
    FROM public.lists l
    WHERE l.organization_id = ${context.organization.id} AND l.project_id = ${projectId}
      AND l.archived_at IS NOT NULL AND l.deleted_at IS NULL
    ORDER BY l.archived_at DESC, l.id
    LIMIT 500
  `;
  return { items: rows.map((row) => ({ ...toList(row), archivedAt: toIso(row.archived_at) })) };
};

/** Restores an archived list (BUG-WK-07) at the end of the project's lists; its tasks come back with it. */
export const restoreList = async (context: AccessContext, projectId: string, listId: string): Promise<List> => {
  assertPermission(context, Permission.ListDelete);
  const sql = getSql();
  await sql.begin(async (tx) => {
    await assertProjectAccess(context, projectId, "manage", tx);
    const current = (
      await tx<{ archived: boolean }[]>`
        SELECT archived_at IS NOT NULL AS archived FROM public.lists
        WHERE id = ${listId} AND organization_id = ${context.organization.id} AND project_id = ${projectId} AND deleted_at IS NULL
        FOR UPDATE
      `
    )[0];
    if (!current) {
      throw new AppError("LIST_NOT_FOUND", "List was not found.", 404);
    }
    if (!current.archived) {
      return;
    }
    const rank = await rankAtEnd(tx, { table: "public.lists", where: { organization_id: context.organization.id, project_id: projectId } });
    await tx`
      UPDATE public.lists SET archived_at = NULL, rank = ${rank}
      WHERE id = ${listId} AND organization_id = ${context.organization.id} AND project_id = ${projectId}
    `;
  });
  publishStructure(projectId, "lists");
  publishStructure(projectId, "statuses");
  await publishSidebar(context, projectId, "lists");
  return toList((await selectList(sql, context, listId))[0]!);
};
