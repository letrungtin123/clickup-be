import { Permission } from "../../contracts/permissions.js";
import type { TrashedTask } from "../../contracts/search.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { decodeTimeCursor, encodeTimeCursor, timestampParamSql, timestampTextSql, toIso, type QuerySql } from "../../lib/db-types.js";
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
  const cursor = decodeTimeCursor(input.cursor);
  // Trash is project content: project.view is required and archived projects are out of reach (SEC-API-12).
  if (!hasPermission(context, Permission.ProjectView)) {
    return { items: [], pageInfo: { hasMore: false, nextCursor: null } };
  }
  const sql = getSql();
  if (input.projectId) {
    await assertProjectAccess(context, input.projectId, "view", sql);
  }
  const rows = await sql<(TrashRow & { cursor_at: string })[]>`
    SELECT t.id, p.key || '-' || t.number AS task_key, t.title, t.project_id, p.name AS project_name, t.list_id, l.name AS list_name,
      t.deleted_at, ${timestampTextSql(sql, () => sql`t.deleted_at`)} AS cursor_at, p.visibility, pm.access_level,
      (SELECT count(*)::int FROM public.tasks d
        WHERE d.organization_id = t.organization_id AND d.parent_task_id = t.id AND d.deleted_at = t.deleted_at) AS subtask_count,
      (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = t.deleted_by) AS deleted_by
    FROM public.tasks t
    JOIN public.projects p ON p.id = t.project_id AND p.organization_id = t.organization_id
      AND p.deleted_at IS NULL AND p.archived_at IS NULL
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
      ${cursor ? sql`AND (t.deleted_at, t.id) < (${timestampParamSql(sql, cursor.at)}, ${cursor.id}::uuid)` : sql``}
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
      nextCursor: rows.length > input.limit && last ? encodeTimeCursor(last.cursor_at, last.id) : null
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

    // A subtask lives in its parent's list. Moves only carry live rows, so the parent may have changed lists
    // while this subtree sat in the trash: the restored subtree follows its parent (BUG-WK-11).
    let targetListId = root.list_id;
    if (root.parent_task_id) {
      const parent = (
        await tx<{ deleted: boolean; list_id: string }[]>`
          SELECT deleted_at IS NOT NULL AS deleted, list_id FROM public.tasks
          WHERE id = ${root.parent_task_id} AND organization_id = ${context.organization.id}
        `
      )[0];
      if (!parent || parent.deleted) {
        throw new AppError("RESTORE_PARENT_DELETED", "Hãy khôi phục công việc cha trước.", 409);
      }
      targetListId = parent.list_id;
    }
    const list = (
      await tx<{ ok: boolean; name: string }[]>`
        SELECT (archived_at IS NULL AND deleted_at IS NULL) AS ok, name FROM public.lists
        WHERE id = ${targetListId} AND organization_id = ${context.organization.id}
      `
    )[0];
    if (!list?.ok) {
      throw new AppError(
        "RESTORE_LIST_UNAVAILABLE",
        `Danh sách "${list?.name ?? ""}" đã được lưu trữ. Hãy khôi phục danh sách (Dự án → Danh sách đã lưu trữ) trước.`,
        409
      );
    }

    const nodes = await deletedSubtree(tx, context, root);
    const workflow = await loadEffectiveWorkflow(tx, context.organization.id, root.project_id, targetListId);
    const sourceWorkflow =
      targetListId === root.list_id ? workflow : await loadEffectiveWorkflow(tx, context.organization.id, root.project_id, root.list_id);
    const initial = workflow.items.find((item) => item.isInitial) ?? workflow.items[0];
    const mapStatus = (statusId: string) => {
      const current = workflow.items.find((item) => item.id === statusId);
      if (current || !initial) {
        return current ?? null;
      }
      // Other list (same key) or a status removed while the task sat in the trash → initial status.
      const key = sourceWorkflow.items.find((item) => item.id === statusId)?.key;
      return workflow.items.find((item) => item.key === key) ?? initial;
    };
    // Parents first: the parent-scope trigger checks every restored row against its (already restored) parent.
    for (const node of nodes) {
      const status = mapStatus(node.status_id);
      const statusId = status?.id ?? node.status_id;
      await tx`
        UPDATE public.tasks
        SET deleted_at = NULL, deleted_by = NULL, list_id = ${targetListId}, status_id = ${statusId},
            completed_at = CASE
              WHEN ${statusId} = status_id::text THEN completed_at
              WHEN ${status?.isDone ?? false} THEN coalesce(completed_at, now())
              ELSE NULL
            END,
            updated_by = ${context.user.id}
        WHERE id = ${node.id} AND organization_id = ${context.organization.id}
      `;
    }
    await insertActivities(tx, context, [
      {
        taskId,
        action: "TASK_RESTORED",
        newValue: { subtaskCount: nodes.length - 1, ...(targetListId !== root.list_id ? { listId: targetListId } : {}) }
      }
    ]);
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
    // Subtasks trashed on their own earlier (another deletion instant) are separate trash items: they are
    // detached and stay restorable as top-level tasks instead of blocking the purge (WK-27).
    await tx`
      UPDATE public.tasks SET parent_task_id = NULL, updated_by = ${context.user.id}
      WHERE organization_id = ${context.organization.id} AND parent_task_id = ANY(${ids}::uuid[]) AND NOT (id = ANY(${ids}::uuid[]))
    `;
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
