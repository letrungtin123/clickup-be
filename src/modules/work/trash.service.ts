import { Permission } from "../../contracts/permissions.js";
import type { TrashedTask } from "../../contracts/search.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { decodeCursor, encodeCursor, toIso, type QuerySql } from "../../lib/db-types.js";
import { logger } from "../../lib/logger.js";
import { removeObjects } from "../../lib/storage.js";
import { publishToRoom } from "../../realtime/publisher.js";
import type { AccessContext } from "../access/access-context.js";
import { assertPermission, assertProjectAccess, hasPermission, projectLevelAtLeast, visibleProjectsPredicate } from "../access/resource-access.js";
import { toUserRef, type UserRefJson } from "./mappers.js";
import { loadEffectiveWorkflow } from "./statuses.service.js";
import { insertActivities, selectTaskSummaries, userJsonSql } from "./tasks.repo.js";

type TrashRow = {
  id: string;
  task_key: string;
  title: string;
  project_id: string;
  project_name: string;
  list_id: string;
  list_name: string;
  subtask_count: number;
  deleted_at: Date;
  deleted_by: UserRefJson | null;
  access_level: "view" | "submit" | "manage" | null;
  visibility: "public" | "private";
};

/**
 * Trash (spec §31): roots of soft-deleted task subtrees in projects the caller can see.
 * Restoring needs `task.delete` + submit access; purging needs `task.delete` + project manage.
 */
export const listTrash = async (
  context: AccessContext,
  input: { projectId?: string | undefined; cursor?: string | undefined; limit: number }
) => {
  assertPermission(context, Permission.TaskView);
  const sql = getSql();
  if (input.projectId) {
    await assertProjectAccess(context, input.projectId, "view", sql);
  }
  const cursor = decodeCursor(input.cursor, 2);
  const rows = await sql<TrashRow[]>`
    SELECT t.id, p.key || '-' || t.number AS task_key, t.title, t.project_id, p.name AS project_name, t.list_id, l.name AS list_name,
      t.deleted_at, p.visibility, pm.access_level,
      (SELECT count(*)::int FROM public.tasks d
        WHERE d.organization_id = t.organization_id AND d.parent_task_id = t.id AND d.deleted_at = t.deleted_at) AS subtask_count,
      (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = t.deleted_by) AS deleted_by
    FROM public.tasks t
    JOIN public.projects p ON p.id = t.project_id AND p.organization_id = t.organization_id AND p.deleted_at IS NULL
    JOIN public.lists l ON l.id = t.list_id AND l.organization_id = t.organization_id
    LEFT JOIN public.project_memberships pm
      ON pm.organization_id = p.organization_id AND pm.project_id = p.id AND pm.user_id = ${context.user.id}
      AND pm.status = 'active' AND pm.deleted_at IS NULL
    LEFT JOIN public.tasks parent ON parent.id = t.parent_task_id AND parent.organization_id = t.organization_id
    WHERE t.organization_id = ${context.organization.id}
      AND t.deleted_at IS NOT NULL
      AND (parent.id IS NULL OR parent.deleted_at IS NULL OR parent.deleted_at <> t.deleted_at)
      AND ${visibleProjectsPredicate(sql, context)}
      AND (${input.projectId ?? null}::uuid IS NULL OR t.project_id = ${input.projectId ?? null}::uuid)
      AND (${cursor ? String(cursor[0]) : null}::timestamptz IS NULL
        OR (t.deleted_at, t.id) < (${cursor ? String(cursor[0]) : null}::timestamptz, ${cursor ? String(cursor[1]) : null}::uuid))
    ORDER BY t.deleted_at DESC, t.id DESC
    LIMIT ${input.limit + 1}
  `;
  const canDelete = hasPermission(context, Permission.TaskDelete);
  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  const items: TrashedTask[] = page.map((row) => {
    const level = context.hasFullOrganizationAuthority ? "manage" : (row.access_level ?? (row.visibility === "public" ? "submit" : null));
    return {
      id: row.id,
      key: row.task_key,
      title: row.title,
      projectId: row.project_id,
      projectName: row.project_name,
      listId: row.list_id,
      listName: row.list_name,
      subtaskCount: Number(row.subtask_count),
      deletedAt: toIso(row.deleted_at),
      deletedBy: toUserRef(row.deleted_by),
      canRestore: canDelete && projectLevelAtLeast(level, "submit"),
      canPurge: canDelete && projectLevelAtLeast(level, "manage")
    };
  });
  return {
    items,
    pageInfo: {
      hasMore: rows.length > input.limit,
      nextCursor: rows.length > input.limit && last ? encodeCursor([last.deleted_at.toISOString(), last.id]) : null
    }
  };
};

type DeletedRoot = {
  id: string;
  project_id: string;
  list_id: string;
  parent_task_id: string | null;
  deleted_at: Date;
  status_id: string;
};

const loadDeletedRoot = async (sql: QuerySql, context: AccessContext, taskId: string) => {
  const row = (
    await sql<DeletedRoot[]>`
      SELECT id, project_id, list_id, parent_task_id, deleted_at, status_id
      FROM public.tasks
      WHERE id = ${taskId} AND organization_id = ${context.organization.id} AND deleted_at IS NOT NULL
      FOR UPDATE
    `
  )[0];
  if (!row) {
    throw new AppError("TASK_NOT_FOUND", "Task was not found in the trash.", 404);
  }
  return row;
};

/** Rows deleted together with the root (same subtree, same deletion instant). */
const deletedSubtree = (sql: QuerySql, context: AccessContext, root: DeletedRoot) => sql<{ id: string; level: number; status_id: string }[]>`
  WITH RECURSIVE tree AS (
    SELECT id, 0 AS level, status_id FROM public.tasks WHERE id = ${root.id}
    UNION ALL
    SELECT c.id, tree.level + 1, c.status_id FROM public.tasks c JOIN tree ON c.parent_task_id = tree.id
    WHERE c.organization_id = ${context.organization.id} AND tree.level < 20
      -- Compare in SQL: JS Dates lose the microsecond precision of timestamptz.
      AND c.deleted_at = (SELECT r.deleted_at FROM public.tasks r WHERE r.id = ${root.id})
  )
  SELECT id, level, status_id FROM tree ORDER BY level
`;

export const restoreTask = async (context: AccessContext, taskId: string) => {
  assertPermission(context, Permission.TaskDelete);
  const sql = getSql();
  const summary = await sql.begin(async (tx) => {
    const root = await loadDeletedRoot(tx, context, taskId);
    await assertProjectAccess(context, root.project_id, "submit", tx).catch((error: unknown) => {
      if (error instanceof AppError && error.statusCode === 404) {
        throw new AppError("TASK_NOT_FOUND", "Task was not found in the trash.", 404);
      }
      throw error;
    });
    const list = (
      await tx<{ ok: boolean }[]>`
        SELECT (archived_at IS NULL AND deleted_at IS NULL) AS ok FROM public.lists WHERE id = ${root.list_id}
      `
    )[0];
    if (!list?.ok) {
      throw new AppError("RESTORE_LIST_UNAVAILABLE", "The task's list is archived. Restore the list first.", 409);
    }
    if (root.parent_task_id) {
      const parent = (await tx<{ ok: boolean }[]>`SELECT deleted_at IS NULL AS ok FROM public.tasks WHERE id = ${root.parent_task_id}`)[0];
      if (!parent?.ok) {
        throw new AppError("RESTORE_PARENT_DELETED", "Restore the parent task first.", 409);
      }
    }

    const nodes = await deletedSubtree(tx, context, root);
    const workflow = await loadEffectiveWorkflow(tx, context.organization.id, root.project_id, root.list_id);
    const initial = workflow.items.find((item) => item.isInitial) ?? workflow.items[0];
    const valid = new Set(workflow.items.map((item) => item.id));
    for (const node of nodes) {
      // Statuses removed while the task sat in the trash fall back to the initial status.
      const statusId = valid.has(node.status_id) || !initial ? node.status_id : initial.id;
      await tx`
        UPDATE public.tasks SET deleted_at = NULL, deleted_by = NULL, status_id = ${statusId}, updated_by = ${context.user.id}
        WHERE id = ${node.id} AND organization_id = ${context.organization.id}
      `;
    }
    await insertActivities(tx, context, [{ taskId, action: "TASK_RESTORED", newValue: { subtaskCount: nodes.length - 1 } }]);
    return (await selectTaskSummaries(tx, context, [taskId]))[0]!;
  });

  publishToRoom({ type: "project", id: summary.projectId }, "task:changed", {
    projectId: summary.projectId,
    listId: summary.listId,
    taskId,
    parentTaskId: summary.parentTaskId,
    kind: "created",
    actorId: context.user.id,
    at: new Date().toISOString()
  });
  return summary;
};

/** Permanent deletion of a trashed subtree; storage objects are removed after commit. */
export const purgeTask = async (context: AccessContext, taskId: string) => {
  assertPermission(context, Permission.TaskDelete);
  const sql = getSql();
  const paths = await sql.begin(async (tx) => {
    const root = await loadDeletedRoot(tx, context, taskId);
    await assertProjectAccess(context, root.project_id, "manage", tx);
    const nodes = await deletedSubtree(tx, context, root);
    const ids = nodes.map((node) => node.id);
    const files = await tx<{ storage_path: string }[]>`
      SELECT storage_path FROM public.task_attachments WHERE organization_id = ${context.organization.id} AND task_id = ANY(${ids}::uuid[])
    `;
    // Children first: parent FK is ON DELETE RESTRICT.
    for (const node of [...nodes].sort((a, b) => b.level - a.level)) {
      await tx`DELETE FROM public.tasks WHERE id = ${node.id} AND organization_id = ${context.organization.id}`;
    }
    return files.map((file) => file.storage_path);
  });
  if (paths.length > 0) {
    removeObjects(paths).catch((error: unknown) => logger.warn({ err: error, taskId }, "Storage cleanup after purge failed"));
  }
  return { ok: true as const };
};
