import { Permission } from "../../contracts/permissions.js";
import type { ReplaceWorkflowRequest, StatusWorkflow } from "../../contracts/work.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import type { QuerySql } from "../../lib/db-types.js";
import { publishToRoom } from "../../realtime/publisher.js";
import type { AccessContext } from "../access/access-context.js";
import { assertPermission, assertProjectAccess } from "../access/resource-access.js";
import { toStatus, type StatusRow } from "./mappers.js";
import { assertListInProject } from "./projects.service.js";

type Scope = "global" | "project" | "list";

const statusColumns = (sql: QuerySql) =>
  sql`id, scope, key, name, category, color, is_initial, is_done, position`;

/** Statuses defined exactly at one scope (no inheritance). */
const loadScopeStatuses = (sql: QuerySql, organizationId: string, scope: Scope, projectId: string | null, listId: string | null) =>
  sql<StatusRow[]>`
    SELECT ${statusColumns(sql)}
    FROM public.task_statuses
    WHERE organization_id = ${organizationId}
      AND deleted_at IS NULL
      AND scope = ${scope}
      AND (${scope} = 'global' OR project_id = ${projectId})
      AND (${scope} <> 'list' OR list_id = ${listId})
    ORDER BY position, id
  `;

/**
 * Effective workflow: list override → project override → organization defaults.
 * A lower level replaces (does not merge with) the inherited set.
 */
export const loadEffectiveWorkflow = async (
  sql: QuerySql,
  organizationId: string,
  projectId: string | null,
  listId: string | null
): Promise<StatusWorkflow> => {
  const rows = await sql<(StatusRow & { level: number })[]>`
    WITH candidates AS (
      SELECT ${statusColumns(sql)},
        CASE scope WHEN 'list' THEN 1 WHEN 'project' THEN 2 ELSE 3 END AS level
      FROM public.task_statuses
      WHERE organization_id = ${organizationId}
        AND deleted_at IS NULL
        AND (
          scope = 'global'
          OR (${projectId}::uuid IS NOT NULL AND scope = 'project' AND project_id = ${projectId}::uuid)
          OR (${listId}::uuid IS NOT NULL AND scope = 'list' AND list_id = ${listId}::uuid)
        )
    )
    SELECT * FROM candidates
    WHERE level = (SELECT min(level) FROM candidates)
    ORDER BY position, id
  `;
  const scope: Scope = rows[0]?.scope ?? "global";
  return { scope, items: rows.map(toStatus) };
};

export const getWorkflow = async (context: AccessContext, projectId: string, listId: string | null) => {
  assertPermission(context, Permission.StatusView);
  const sql = getSql();
  await assertProjectAccess(context, projectId, "view", sql);
  if (listId) {
    await assertListInProject(sql, context, projectId, listId);
  }
  return await loadEffectiveWorkflow(sql, context.organization.id, projectId, listId);
};

const toStatusKey = (name: string, taken: Set<string>) => {
  let base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "D")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  if (!/^[A-Z]/.test(base)) {
    base = `S_${base}`;
  }
  if (base.length < 2) {
    base = `${base}_X`;
  }
  let key = base;
  let suffix = 2;
  while (taken.has(key)) {
    key = `${base}_${suffix}`;
    suffix += 1;
  }
  taken.add(key);
  return key;
};

/**
 * Replaces the workflow at project or list scope (or reverts to inheritance) in one transaction.
 * Tasks on removed statuses are moved (explicit remap → same key → initial status) with
 * structured activity events, then the removed statuses are soft-deleted.
 */
export const replaceWorkflow = async (
  context: AccessContext,
  projectId: string,
  input: ReplaceWorkflowRequest
): Promise<StatusWorkflow> => {
  assertPermission(context, Permission.ListManageStatus);
  const sql = getSql();
  const listId = input.listId;
  const scope: Scope = listId ? "list" : "project";

  if (!input.inherit) {
    if (input.statuses.length === 0) {
      throw new AppError("WORKFLOW_EMPTY", "A workflow needs at least one status.", 400);
    }
    if (!input.statuses.some((status) => status.category === "active")) {
      throw new AppError("WORKFLOW_NEEDS_ACTIVE", "A workflow needs at least one open status.", 400);
    }
    if (!input.statuses.some((status) => status.category !== "active")) {
      throw new AppError("WORKFLOW_NEEDS_DONE", "A workflow needs at least one done status.", 400);
    }
    if (input.statuses[0]?.category !== "active") {
      throw new AppError("WORKFLOW_FIRST_ACTIVE", "The first status must be an open status.", 400);
    }
    const names = input.statuses.map((status) => status.name.toLocaleLowerCase("vi"));
    if (new Set(names).size !== names.length) {
      throw new AppError("WORKFLOW_DUPLICATE_NAME", "Status names must be unique.", 400);
    }
    for (const entry of input.remap) {
      if (entry.toIndex >= input.statuses.length) {
        throw new AppError("WORKFLOW_INVALID_REMAP", "A status mapping points to a missing status.", 400);
      }
    }
  }

  await sql.begin(async (tx) => {
    await assertProjectAccess(context, projectId, "manage", tx);
    if (listId) {
      await assertListInProject(tx, context, projectId, listId);
    }
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`workflow:${projectId}`}, 0))`;

    const organizationId = context.organization.id;
    const current = await loadScopeStatuses(tx, organizationId, scope, projectId, listId);
    const parent = listId
      ? await loadEffectiveWorkflow(tx, organizationId, projectId, null)
      : await loadEffectiveWorkflow(tx, organizationId, null, null);
    const before = current.length > 0 ? current.map(toStatus) : parent.items;

    // Tasks whose effective workflow is the one being edited.
    const affected = listId
      ? tx`t.list_id = ${listId}`
      : tx`t.project_id = ${projectId} AND NOT EXISTS (
          SELECT 1 FROM public.task_statuses lts
          WHERE lts.organization_id = t.organization_id AND lts.scope = 'list' AND lts.list_id = t.list_id AND lts.deleted_at IS NULL
        )`;

    const moveTasks = async (fromStatusId: string, to: { id: string; name: string; isDone: boolean }, fromName: string) => {
      if (fromStatusId === to.id) {
        return;
      }
      await tx`
        WITH moved AS (
          UPDATE public.tasks t
          SET status_id = ${to.id},
              completed_at = CASE WHEN ${to.isDone} THEN coalesce(t.completed_at, now()) ELSE NULL END,
              updated_by = ${context.user.id}
          WHERE t.organization_id = ${organizationId}
            AND t.project_id = ${projectId}
            AND t.status_id = ${fromStatusId}
            AND t.deleted_at IS NULL
            AND ${affected}
          RETURNING t.id
        )
        INSERT INTO public.task_activity_events (organization_id, task_id, actor_user_id, action, previous_value, new_value)
        SELECT ${organizationId}, moved.id, ${context.user.id}, 'TASK_STATUS_CHANGED',
          ${tx.json({ statusId: fromStatusId, name: fromName })},
          ${tx.json({ statusId: to.id, name: to.name, reason: "workflow_changed" })}
        FROM moved
      `;
    };

    if (input.inherit) {
      if (current.length === 0) {
        return;
      }
      const initial = parent.items.find((status) => status.isInitial) ?? parent.items[0];
      if (!initial) {
        throw new AppError("WORKFLOW_PARENT_EMPTY", "No inherited workflow is available.", 409);
      }
      for (const status of current) {
        const target = parent.items.find((candidate) => candidate.key === status.key) ?? initial;
        await moveTasks(status.id, target, status.name);
      }
      await tx`
        UPDATE public.task_statuses SET deleted_at = now(), deleted_by = ${context.user.id}, is_initial = false
        WHERE id = ANY(${current.map((status) => status.id)}::uuid[])
      `;
      return;
    }

    const currentById = new Map(current.map((status) => [status.id, status]));
    const parentById = new Map(parent.items.map((status) => [status.id, status]));
    const takenKeys = new Set<string>();
    for (const entry of input.statuses) {
      const existing = entry.id ? currentById.get(entry.id) : undefined;
      if (existing) {
        takenKeys.add(existing.key);
      }
    }

    // Clear the initial flag first: the partial unique index allows only one initial per scope.
    if (current.length > 0) {
      await tx`UPDATE public.task_statuses SET is_initial = false WHERE id = ANY(${current.map((status) => status.id)}::uuid[])`;
    }

    const kept: { id: string; key: string; name: string; isDone: boolean; derivedFrom: string | null }[] = [];
    for (const [index, entry] of input.statuses.entries()) {
      const existing = entry.id ? currentById.get(entry.id) : undefined;
      if (entry.id && !existing && !parentById.has(entry.id)) {
        throw new AppError("WORKFLOW_UNKNOWN_STATUS", "A status in the request does not belong to this workflow.", 400);
      }
      const isDone = entry.category !== "active";
      if (existing) {
        await tx`
          UPDATE public.task_statuses
          SET name = ${entry.name}, category = ${entry.category}, color = ${entry.color},
              position = ${index}, is_initial = ${index === 0}
          WHERE id = ${existing.id}
        `;
        kept.push({ id: existing.id, key: existing.key, name: entry.name, isDone, derivedFrom: existing.id });
        continue;
      }
      const inherited = entry.id ? parentById.get(entry.id) : undefined;
      const key = inherited && !takenKeys.has(inherited.key) ? (takenKeys.add(inherited.key), inherited.key) : toStatusKey(entry.name, takenKeys);
      const created = (
        await tx<{ id: string }[]>`
          INSERT INTO public.task_statuses (organization_id, scope, project_id, list_id, key, name, category, color, position, is_initial, created_by)
          VALUES (${organizationId}, ${scope}, ${projectId}, ${listId}, ${key}, ${entry.name}, ${entry.category}, ${entry.color},
                  ${index}, ${index === 0}, ${context.user.id})
          RETURNING id
        `
      )[0]!;
      kept.push({ id: created.id, key, name: entry.name, isDone, derivedFrom: inherited?.id ?? null });
    }

    const keptIds = new Set(kept.map((status) => status.id));
    const initial = kept[0]!;
    for (const old of before) {
      if (keptIds.has(old.id)) {
        continue;
      }
      const remap = input.remap.find((entry) => entry.fromStatusId === old.id);
      const target =
        (remap ? kept[remap.toIndex] : undefined) ??
        kept.find((status) => status.derivedFrom === old.id) ??
        kept.find((status) => status.key === old.key) ??
        initial;
      await moveTasks(old.id, target, old.name);
    }

    const removed = current.filter((status) => !keptIds.has(status.id)).map((status) => status.id);
    if (removed.length > 0) {
      await tx`
        UPDATE public.task_statuses SET deleted_at = now(), deleted_by = ${context.user.id}
        WHERE id = ANY(${removed}::uuid[])
      `;
    }
  });

  publishToRoom({ type: "project", id: projectId }, "project:structure", {
    projectId,
    kind: "statuses",
    at: new Date().toISOString()
  });
  return await loadEffectiveWorkflow(sql, context.organization.id, projectId, listId);
};
