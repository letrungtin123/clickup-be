import { Permission } from "../../contracts/permissions.js";
import { descriptionLimits, RichTextError, type RichTextDoc } from "../../contracts/rich-text.js";
import { sanitizeWithMentionLabels } from "../../lib/mentions.js";
import type {
  CreateTaskRequest,
  MoveTaskRequest,
  TaskDetail,
  TaskSummary,
  UpdateTaskRequest
} from "../../contracts/work.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { toIso, type QuerySql } from "../../lib/db-types.js";
import { rankForPlacement } from "../../lib/rank.js";
import { inlineImageTypes } from "../../lib/storage.js";
import { publishToRoom } from "../../realtime/publisher.js";
import type { AccessContext } from "../access/access-context.js";
import {
  assertPermission,
  assertProjectAccess,
  hasPermission,
  projectLevelAtLeast,
  type ProjectAccess
} from "../access/resource-access.js";
import { enqueueDomainEvents, type DomainEventInput } from "../events/outbox.js";
import { attachmentDeleteRule, toAttachment, toColor, toTaskSummary, toUserRef, type AttachmentRow, type TaskRow, type UserRefJson } from "./mappers.js";
import { assertListInProject } from "./projects.service.js";
import { loadEffectiveWorkflow } from "./statuses.service.js";
import {
  insertActivities,
  loadTaskCore,
  selectTaskSummaries,
  taskColumnsSql,
  taskFromSql,
  userJsonSql,
  type ActivityInput,
  type TaskCore
} from "./tasks.repo.js";

const maxDepth = 7;

const sanitizeDescription = async (sql: QuerySql, context: AccessContext, doc: unknown) => {
  try {
    return await sanitizeWithMentionLabels(sql, context.organization.id, doc, descriptionLimits);
  } catch (error) {
    if (error instanceof RichTextError) {
      throw new AppError("INVALID_RICH_TEXT", error.message, 400);
    }
    throw error;
  }
};

const isoOrNull = (value: Date | null) => (value ? toIso(value) : null);

/** JSON with sorted object keys: jsonb reorders keys, so documents are compared canonically. */
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

/** Mention ids of a stored rich text document. */
const collectMentionIds = (node: unknown, found: string[] = []): string[] => {
  if (Array.isArray(node)) {
    node.forEach((child) => collectMentionIds(child, found));
  } else if (node !== null && typeof node === "object") {
    const record = node as { type?: unknown; attrs?: { id?: unknown }; content?: unknown };
    if (record.type === "mention" && typeof record.attrs?.id === "string") {
      found.push(record.attrs.id.toLowerCase());
    }
    collectMentionIds(record.content, found);
  }
  return found;
};

/** Same instant? ("…T00:00:00Z" and "…T00:00:00.000Z" are one value: no "changed" activity for a no-op save, WK-31.) */
const sameInstant = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? null) === null || (b ?? null) === null ? (a ?? null) === (b ?? null) : new Date(a!).getTime() === new Date(b!).getTime();

const assertDates = (startAt: string | null | undefined, dueAt: string | null | undefined) => {
  if (startAt && dueAt && new Date(dueAt).getTime() < new Date(startAt).getTime()) {
    throw new AppError("TASK_DATES_INVALID", "The due date must be on or after the start date.", 400);
  }
};

const publishTaskChanged = (
  task: { id: string; projectId: string; listId: string; parentTaskId: string | null },
  kind: "created" | "updated" | "deleted" | "moved",
  actorId: string
) => {
  const at = new Date().toISOString();
  publishToRoom({ type: "project", id: task.projectId }, "task:changed", {
    projectId: task.projectId,
    listId: task.listId,
    taskId: task.id,
    parentTaskId: task.parentTaskId,
    kind,
    actorId,
    at
  });
  publishToRoom({ type: "task", id: task.id }, "task:timeline", { projectId: task.projectId, taskId: task.id, actorId, at });
};

/** Users who may be assigned in this project (PD-006): active org members, plus project membership when private. */
const assertAssignable = async (sql: QuerySql, context: AccessContext, projectId: string, userIds: string[]) => {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) {
    return unique;
  }
  const rows = await sql<{ id: string }[]>`
    SELECT om.user_id AS id
    FROM public.organization_memberships om
    JOIN public.projects p ON p.id = ${projectId} AND p.organization_id = om.organization_id
    WHERE om.organization_id = ${context.organization.id}
      AND om.user_id = ANY(${unique}::uuid[])
      AND om.status = 'active'
      AND om.deleted_at IS NULL
      AND (
        p.visibility = 'public'
        OR EXISTS (
          SELECT 1 FROM public.project_memberships pm
          WHERE pm.organization_id = om.organization_id AND pm.project_id = p.id
            AND pm.user_id = om.user_id AND pm.status = 'active' AND pm.deleted_at IS NULL
        )
      )
  `;
  if (rows.length !== unique.length) {
    throw new AppError("ASSIGNEE_NOT_ALLOWED", "One or more assignees cannot access this project.", 409);
  }
  return unique;
};

const workflowStatus = async (sql: QuerySql, context: AccessContext, projectId: string, listId: string, statusId?: string) => {
  const workflow = await loadEffectiveWorkflow(sql, context.organization.id, projectId, listId);
  const status = statusId
    ? workflow.items.find((item) => item.id === statusId)
    : (workflow.items.find((item) => item.isInitial) ?? workflow.items[0]);
  if (!status) {
    throw new AppError(statusId ? "TASK_STATUS_NOT_FOUND" : "TASK_STATUS_REQUIRED", "Status is not available in this list.", statusId ? 400 : 409);
  }
  return { status, workflow };
};

const ancestorDepth = async (sql: QuerySql, context: AccessContext, taskId: string) => {
  const rows = await sql<{ depth: number }[]>`
    WITH RECURSIVE chain AS (
      SELECT id, parent_task_id, 1 AS depth FROM public.tasks
      WHERE id = ${taskId} AND organization_id = ${context.organization.id}
      UNION ALL
      SELECT p.id, p.parent_task_id, chain.depth + 1
      FROM public.tasks p JOIN chain ON p.id = chain.parent_task_id
      WHERE p.organization_id = ${context.organization.id} AND chain.depth < 20
    )
    SELECT max(depth)::int AS depth FROM chain
  `;
  return rows[0]?.depth ?? 1;
};

const subtreeIdsByLevel = async (sql: QuerySql, context: AccessContext, rootId: string) => {
  const rows = await sql<{ id: string; level: number }[]>`
    WITH RECURSIVE tree AS (
      SELECT id, 0 AS level FROM public.tasks
      WHERE id = ${rootId} AND organization_id = ${context.organization.id} AND deleted_at IS NULL
      UNION ALL
      SELECT c.id, tree.level + 1 FROM public.tasks c JOIN tree ON c.parent_task_id = tree.id
      WHERE c.organization_id = ${context.organization.id} AND c.deleted_at IS NULL AND tree.level < 20
    )
    SELECT id, level FROM tree ORDER BY level
  `;
  return rows;
};

const assertParentUsable = async (
  sql: QuerySql,
  context: AccessContext,
  input: { projectId: string; listId: string; parentTaskId: string; subtreeHeight: number }
) => {
  const parent = await loadTaskCore(sql, context, input.parentTaskId).catch(() => {
    throw new AppError("PARENT_TASK_NOT_FOUND", "Parent task was not found.", 404);
  });
  if (parent.project_id !== input.projectId || parent.list_id !== input.listId) {
    throw new AppError("PARENT_TASK_SCOPE_MISMATCH", "A subtask must stay in its parent's list.", 409);
  }
  const depth = await ancestorDepth(sql, context, input.parentTaskId);
  if (depth + input.subtreeHeight > maxDepth) {
    throw new AppError("TASK_DEPTH_EXCEEDED", `Tasks can be nested at most ${maxDepth} levels deep.`, 409);
  }
  return parent;
};

// Reads -------------------------------------------------------------------------------------------

/** Resolves a task and the caller's project access, hiding existence from unauthorized callers. */
export const authorizeTask = async (
  sql: QuerySql,
  context: AccessContext,
  taskId: string,
  required: "view" | "submit" | "manage",
  lock = false
): Promise<{ task: TaskCore; access: ProjectAccess }> => {
  assertPermission(context, Permission.TaskView);
  const task = await loadTaskCore(sql, context, taskId, lock);
  try {
    const access = await assertProjectAccess(context, task.project_id, required, sql);
    return { task, access };
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 404) {
      throw new AppError("TASK_NOT_FOUND", "Task was not found.", 404);
    }
    throw error;
  }
};

export const getTaskDetail = async (context: AccessContext, taskId: string, sql: QuerySql = getSql()): Promise<TaskDetail> => {
  const { access } = await authorizeTask(sql, context, taskId, "view");

  const row = (
    await sql<(TaskRow & {
      description_json: Record<string, unknown> | null;
      description_text: string | null;
      created_by_user: UserRefJson | null;
      project_name: string;
      project_color: string;
      list_name: string;
    })[]>`
      SELECT ${taskColumnsSql(sql)},
        t.description_json, t.description_text,
        p.name AS project_name, p.color AS project_color, l.name AS list_name,
        (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = t.created_by) AS created_by_user
      FROM ${taskFromSql(sql)}
      JOIN public.lists l ON l.id = t.list_id AND l.organization_id = t.organization_id
      WHERE t.id = ${taskId} AND t.organization_id = ${context.organization.id} AND t.deleted_at IS NULL
    `
  )[0];
  if (!row) {
    throw new AppError("TASK_NOT_FOUND", "Task was not found.", 404);
  }

  const [ancestors, subtasks, attachments] = await Promise.all([
    sql<{ id: string; number: string; title: string; depth: number }[]>`
      WITH RECURSIVE chain AS (
        SELECT parent_task_id AS id, 1 AS depth FROM public.tasks WHERE id = ${taskId} AND organization_id = ${context.organization.id}
        UNION ALL
        SELECT t.parent_task_id, chain.depth + 1 FROM public.tasks t JOIN chain ON t.id = chain.id
        WHERE t.organization_id = ${context.organization.id} AND chain.depth < 20
      )
      SELECT t.id, t.number::text, t.title, chain.depth
      FROM chain JOIN public.tasks t ON t.id = chain.id AND t.organization_id = ${context.organization.id}
      ORDER BY chain.depth DESC
    `,
    sql<TaskRow[]>`
      SELECT ${taskColumnsSql(sql)}
      FROM ${taskFromSql(sql)}
      WHERE t.organization_id = ${context.organization.id} AND t.parent_task_id = ${taskId}
        AND t.deleted_at IS NULL AND t.archived_at IS NULL
      ORDER BY t.rank COLLATE "C", t.id
      LIMIT 200
    `,
    sql<AttachmentRow[]>`
      SELECT a.id, a.task_id, a.comment_id, a.file_name, a.mime_type, a.size_bytes, a.created_at,
        (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = a.uploaded_by) AS uploaded_by
      FROM public.task_attachments a
      WHERE a.organization_id = ${context.organization.id} AND a.task_id = ${taskId}
        AND a.comment_id IS NULL AND a.purpose = 'task' AND a.status = 'ready' AND a.deleted_at IS NULL
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 100
    `
  ]);

  const canSubmit = projectLevelAtLeast(access.level, "submit");
  const summary = toTaskSummary(row);
  return {
    ...summary,
    description: row.description_json && Object.keys(row.description_json).length > 0 ? (row.description_json as RichTextDoc) : null,
    descriptionText: row.description_text,
    createdBy: toUserRef(row.created_by_user),
    project: { id: row.project_id, key: row.project_key, name: row.project_name, color: toColor(row.project_color, "indigo") },
    list: { id: row.list_id, name: row.list_name },
    ancestors: ancestors.map((ancestor) => ({ id: ancestor.id, key: `${row.project_key}-${ancestor.number}`, title: ancestor.title })),
    subtasks: subtasks.map(toTaskSummary),
    attachments: attachments.map((attachment) =>
      toAttachment(attachment, (mime) => inlineImageTypes.has(mime), attachmentDeleteRule(context.user.id, access.level))
    ),
    capabilities: {
      canEdit: canSubmit && hasPermission(context, Permission.TaskUpdate),
      canAssign: canSubmit && hasPermission(context, Permission.TaskAssign),
      canComment: canSubmit && hasPermission(context, Permission.TaskComment),
      canDelete: canSubmit && hasPermission(context, Permission.TaskDelete),
      canCreateSubtask: canSubmit && hasPermission(context, Permission.TaskCreate)
    }
  };
};

/**
 * Resolves "KEY-12" (current or former project key, WK-35). Every failure is the same 404 — without
 * task.view too — so the endpoint never tells which keys exist (SEC-API-11).
 */
export const lookupTaskByKey = async (context: AccessContext, key: string) => {
  const notFound = () => new AppError("TASK_NOT_FOUND", "Task was not found.", 404);
  const match = /^([A-Za-z][A-Za-z0-9]{1,11})-(\d{1,12})$/.exec(key.trim());
  if (!match || !hasPermission(context, Permission.TaskView)) {
    throw notFound();
  }
  const projectKey = match[1]!.toUpperCase();
  const sql = getSql();
  const row = (
    await sql<{ id: string; project_id: string }[]>`
      SELECT t.id, t.project_id FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id AND p.organization_id = t.organization_id
      WHERE t.organization_id = ${context.organization.id}
        AND p.deleted_at IS NULL AND t.number = ${Number(match[2])} AND t.deleted_at IS NULL
        AND (
          p.key = ${projectKey}
          OR p.id = (
            SELECT a.project_id FROM public.project_key_aliases a
            WHERE a.organization_id = ${context.organization.id} AND a.key = ${projectKey}
            LIMIT 1
          )
        )
      ORDER BY (p.key = ${projectKey}) DESC
      LIMIT 1
    `
  )[0];
  if (!row) {
    throw notFound();
  }
  try {
    await authorizeTask(sql, context, row.id, "view");
  } catch (error) {
    if (error instanceof AppError && (error.statusCode === 403 || error.statusCode === 404)) {
      throw notFound();
    }
    throw error;
  }
  return { id: row.id, projectId: row.project_id };
};

// Writes ------------------------------------------------------------------------------------------

export const createTask = async (context: AccessContext, projectId: string, input: CreateTaskRequest): Promise<TaskSummary> => {
  assertPermission(context, Permission.TaskCreate);
  if (input.assigneeIds.length > 0) {
    assertPermission(context, Permission.TaskAssign);
  }
  assertDates(input.startAt, input.dueAt);
  const sql = getSql();
  const description = input.description ? await sanitizeDescription(sql, context, input.description) : null;

  const created = await sql.begin(async (tx) => {
    await assertProjectAccess(context, projectId, "submit", tx);
    await assertListInProject(tx, context, projectId, input.listId);
    const parentTaskId = input.parentTaskId ?? null;
    if (parentTaskId) {
      await assertParentUsable(tx, context, { projectId, listId: input.listId, parentTaskId, subtreeHeight: 1 });
    }
    const { status } = await workflowStatus(tx, context, projectId, input.listId, input.statusId);
    const assigneeIds = await assertAssignable(tx, context, projectId, input.assigneeIds);

    const sequence = (
      await tx<{ task_seq: string }[]>`
        UPDATE public.projects SET task_seq = task_seq + 1
        WHERE id = ${projectId} AND organization_id = ${context.organization.id}
        RETURNING task_seq::text
      `
    )[0]!;
    const rank = await rankForPlacement(
      tx,
      { table: "public.tasks", where: { organization_id: context.organization.id, list_id: input.listId, parent_task_id: parentTaskId } },
      input.placement
    );

    const row = (
      await tx<{ id: string }[]>`
        INSERT INTO public.tasks (
          organization_id, project_id, list_id, parent_task_id, status_id, number, rank, title,
          description_json, description_text, priority, start_at, due_at, completed_at, created_by, updated_by
        )
        VALUES (
          ${context.organization.id}, ${projectId}, ${input.listId}, ${parentTaskId}, ${status.id}, ${sequence.task_seq}, ${rank},
          ${input.title}, ${tx.json(description?.doc ?? {})}, ${description?.text || null},
          ${input.priority}, ${input.startAt ?? null}, ${input.dueAt ?? null}, ${status.isDone ? new Date() : null},
          ${context.user.id}, ${context.user.id}
        )
        RETURNING id
      `
    )[0]!;

    if (assigneeIds.length > 0) {
      await tx`
        INSERT INTO public.task_assignees (organization_id, task_id, assignee_user_id, assigned_by)
        SELECT ${context.organization.id}, ${row.id}, user_id, ${context.user.id}
        FROM unnest(${assigneeIds}::uuid[]) AS user_id
      `;
    }

    await insertActivities(tx, context, [
      { taskId: row.id, action: "TASK_CREATED", newValue: { title: input.title, statusId: status.id, statusName: status.name } },
      ...assigneeIds.map((userId) => ({ taskId: row.id, action: "TASK_ASSIGNEE_ADDED", targetType: "user", targetId: userId }))
    ]);

    const events: DomainEventInput[] = [
      {
        organizationId: context.organization.id,
        type: "task.created",
        aggregateType: "task",
        aggregateId: row.id,
        actorUserId: context.user.id,
        payload: { projectId, listId: input.listId, parentTaskId, title: input.title, assigneeIds }
      }
    ];
    if (assigneeIds.length > 0) {
      events.push({
        organizationId: context.organization.id,
        type: "task.assigned",
        aggregateType: "task",
        aggregateId: row.id,
        actorUserId: context.user.id,
        payload: { projectId, title: input.title, assigneeIds, reopened: false }
      });
    }
    if (description && description.mentions.length > 0) {
      events.push(await mentionEvent(tx, context, projectId, row.id, input.title, description.mentions, "description"));
    }
    await enqueueDomainEvents(tx, events);

    return (await selectTaskSummaries(tx, context, [row.id]))[0]!;
  });

  publishTaskChanged(created, "created", context.user.id);
  return created;
};

/** Mentions are only delivered to people who can see the task. */
const mentionEvent = async (
  sql: QuerySql,
  context: AccessContext,
  projectId: string,
  taskId: string,
  title: string,
  mentions: string[],
  source: "description" | "comment",
  commentId?: string
): Promise<DomainEventInput> => {
  const allowed = await sql<{ id: string }[]>`
    SELECT om.user_id AS id
    FROM public.organization_memberships om
    JOIN public.projects p ON p.id = ${projectId} AND p.organization_id = om.organization_id
    WHERE om.organization_id = ${context.organization.id} AND om.user_id = ANY(${mentions}::uuid[])
      AND om.status = 'active' AND om.deleted_at IS NULL AND om.user_id <> ${context.user.id}
      AND (p.visibility = 'public' OR EXISTS (
        SELECT 1 FROM public.project_memberships pm
        WHERE pm.organization_id = om.organization_id AND pm.project_id = p.id AND pm.user_id = om.user_id
          AND pm.status = 'active' AND pm.deleted_at IS NULL
      ))
  `;
  return {
    organizationId: context.organization.id,
    type: "task.mentioned",
    aggregateType: "task",
    aggregateId: taskId,
    actorUserId: context.user.id,
    payload: { projectId, title, source, commentId: commentId ?? null, userIds: allowed.map((row) => row.id) }
  };
};

export { mentionEvent };

export const updateTask = async (context: AccessContext, taskId: string, input: UpdateTaskRequest): Promise<TaskDetail> => {
  const touchesFields =
    input.title !== undefined ||
    input.description !== undefined ||
    input.statusId !== undefined ||
    input.priority !== undefined ||
    input.startAt !== undefined ||
    input.dueAt !== undefined;
  if (touchesFields) {
    assertPermission(context, Permission.TaskUpdate);
  }
  const assigneeAdd = input.assignees?.add ?? [];
  const assigneeRemove = input.assignees?.remove ?? [];
  if (assigneeAdd.length > 0 || assigneeRemove.length > 0) {
    assertPermission(context, Permission.TaskAssign);
  }
  const sql = getSql();
  const description = input.description ? await sanitizeDescription(sql, context, input.description) : null;

  const result = await sql.begin(async (tx) => {
    const { task } = await authorizeTask(tx, context, taskId, "submit", true);
    const nextStart = input.startAt !== undefined ? input.startAt : isoOrNull(task.start_at);
    const nextDue = input.dueAt !== undefined ? input.dueAt : isoOrNull(task.due_at);
    assertDates(nextStart, nextDue);
    const previousDescription = input.description !== undefined
      ? (
          await tx<{ description_json: Record<string, unknown> | null }[]>`
            SELECT description_json FROM public.tasks WHERE id = ${taskId} AND organization_id = ${context.organization.id}
          `
        )[0]?.description_json ?? null
      : null;
    const descriptionChanged =
      input.description !== undefined && canonicalJson(previousDescription ?? {}) !== canonicalJson(description?.doc ?? {});

    const activities: ActivityInput[] = [];
    const events: DomainEventInput[] = [];
    const base = { organizationId: context.organization.id, aggregateType: "task", aggregateId: taskId, actorUserId: context.user.id };

    const workflow = await loadEffectiveWorkflow(tx, context.organization.id, task.project_id, task.list_id);
    const currentStatus = workflow.items.find((item) => item.id === task.status_id);
    let nextStatus = currentStatus;
    if (input.statusId !== undefined && input.statusId !== task.status_id) {
      nextStatus = workflow.items.find((item) => item.id === input.statusId);
      if (!nextStatus) {
        throw new AppError("TASK_STATUS_NOT_FOUND", "Status is not available in this list.", 400);
      }
    }

    // Spec §10: reassigning completed work to someone new reopens it to the workflow's initial status.
    // Re-adding a current assignee changes nothing and must not reopen the task (WK-20).
    const added = assigneeAdd.length > 0 ? await assertAssignable(tx, context, task.project_id, assigneeAdd) : [];
    const removed = [...new Set(assigneeRemove)].filter((id) => !added.includes(id));
    const currentAssignees = new Set(
      added.length > 0
        ? (
            await tx<{ assignee_user_id: string }[]>`
              SELECT assignee_user_id FROM public.task_assignees
              WHERE organization_id = ${context.organization.id} AND task_id = ${taskId} AND removed_at IS NULL
            `
          ).map((row) => row.assignee_user_id)
        : []
    );
    const reallyAdded = added.filter((id) => !currentAssignees.has(id));
    let reopened = false;
    if (reallyAdded.length > 0 && task.completed_at && (nextStatus?.isDone ?? true) && input.statusId === undefined) {
      const initial = workflow.items.find((item) => item.isInitial) ?? workflow.items[0];
      if (initial && !initial.isDone) {
        nextStatus = initial;
        reopened = true;
      }
    }

    const statusChanged = nextStatus !== undefined && nextStatus.id !== task.status_id;
    await tx`
      UPDATE public.tasks
      SET title = coalesce(${input.title ?? null}, title),
          description_json = CASE WHEN ${input.description !== undefined}
            THEN ${tx.json(description?.doc ?? {})} ELSE description_json END,
          description_text = CASE WHEN ${input.description !== undefined} THEN ${description?.text || null} ELSE description_text END,
          priority = coalesce(${input.priority ?? null}, priority),
          start_at = CASE WHEN ${input.startAt !== undefined} THEN ${input.startAt ?? null}::timestamptz ELSE start_at END,
          due_at = CASE WHEN ${input.dueAt !== undefined} THEN ${input.dueAt ?? null}::timestamptz ELSE due_at END,
          status_id = ${nextStatus?.id ?? task.status_id},
          completed_at = CASE
            WHEN ${statusChanged} AND ${nextStatus?.isDone ?? false} THEN coalesce(completed_at, now())
            WHEN ${statusChanged} THEN NULL
            ELSE completed_at
          END,
          updated_by = ${context.user.id}
      WHERE id = ${taskId} AND organization_id = ${context.organization.id}
    `;

    if (input.title !== undefined && input.title !== task.title) {
      activities.push({ taskId, action: "TASK_TITLE_CHANGED", previousValue: { title: task.title }, newValue: { title: input.title } });
    }
    if (descriptionChanged) {
      activities.push({ taskId, action: "TASK_DESCRIPTION_CHANGED" });
      // Only people newly mentioned by this edit are notified.
      const previouslyMentioned = new Set(collectMentionIds(previousDescription));
      const newMentions = (description?.mentions ?? []).filter((id) => !previouslyMentioned.has(id));
      if (newMentions.length > 0) {
        events.push(await mentionEvent(tx, context, task.project_id, taskId, input.title ?? task.title, newMentions, "description"));
      }
    }
    if (input.priority !== undefined && input.priority !== task.priority) {
      activities.push({ taskId, action: "TASK_PRIORITY_CHANGED", previousValue: { priority: task.priority }, newValue: { priority: input.priority } });
    }
    if (input.startAt !== undefined && !sameInstant(input.startAt, isoOrNull(task.start_at))) {
      activities.push({ taskId, action: "TASK_START_DATE_CHANGED", previousValue: { startAt: isoOrNull(task.start_at) }, newValue: { startAt: input.startAt } });
    }
    if (input.dueAt !== undefined && !sameInstant(input.dueAt, isoOrNull(task.due_at))) {
      activities.push({ taskId, action: "TASK_DUE_DATE_CHANGED", previousValue: { dueAt: isoOrNull(task.due_at) }, newValue: { dueAt: input.dueAt } });
      events.push({ ...base, type: "task.due_changed", payload: { projectId: task.project_id, title: input.title ?? task.title, dueAt: input.dueAt } });
    }
    if (statusChanged && nextStatus) {
      activities.push({
        taskId,
        action: reopened ? "TASK_REOPENED" : "TASK_STATUS_CHANGED",
        previousValue: { statusId: task.status_id, name: currentStatus?.name ?? null, color: currentStatus?.color ?? null },
        newValue: { statusId: nextStatus.id, name: nextStatus.name, color: nextStatus.color, ...(reopened ? { reason: "reassigned" } : {}) }
      });
      events.push({
        ...base,
        type: "task.status_changed",
        payload: { projectId: task.project_id, title: input.title ?? task.title, statusId: nextStatus.id, statusName: nextStatus.name, isDone: nextStatus.isDone }
      });
    }

    if (removed.length > 0) {
      const removedRows = await tx<{ assignee_user_id: string }[]>`
        UPDATE public.task_assignees SET removed_at = now(), removed_by = ${context.user.id}
        WHERE organization_id = ${context.organization.id} AND task_id = ${taskId}
          AND assignee_user_id = ANY(${removed}::uuid[]) AND removed_at IS NULL
        RETURNING assignee_user_id
      `;
      activities.push(
        ...removedRows.map((row) => ({ taskId, action: "TASK_ASSIGNEE_REMOVED", targetType: "user", targetId: row.assignee_user_id }))
      );
    }
    if (added.length > 0) {
      const addedRows = await tx<{ assignee_user_id: string }[]>`
        INSERT INTO public.task_assignees (organization_id, task_id, assignee_user_id, assigned_by)
        SELECT ${context.organization.id}, ${taskId}, user_id, ${context.user.id}
        FROM unnest(${added}::uuid[]) AS user_id
        ON CONFLICT (task_id, assignee_user_id) DO UPDATE
          SET removed_at = NULL, removed_by = NULL, assigned_by = EXCLUDED.assigned_by, assigned_at = now()
          WHERE public.task_assignees.removed_at IS NOT NULL
        RETURNING assignee_user_id
      `;
      const newlyAdded = addedRows.map((row) => row.assignee_user_id);
      activities.push(...newlyAdded.map((userId) => ({ taskId, action: "TASK_ASSIGNEE_ADDED", targetType: "user", targetId: userId })));
      if (newlyAdded.length > 0) {
        events.push({
          ...base,
          type: "task.assigned",
          payload: { projectId: task.project_id, title: input.title ?? task.title, assigneeIds: newlyAdded, reopened }
        });
      }
    }

    await insertActivities(tx, context, activities);
    await enqueueDomainEvents(tx, events);
    return { task, detail: await getTaskDetail(context, taskId, tx) };
  });

  publishTaskChanged(
    { id: taskId, projectId: result.task.project_id, listId: result.task.list_id, parentTaskId: result.task.parent_task_id },
    "updated",
    context.user.id
  );
  return result.detail;
};

/**
 * Drag & drop and "move to": changes list, parent, status and/or position. Moving to another list
 * carries the whole subtree and maps each status by key (or the initial status) in the target list.
 */
export const moveTask = async (context: AccessContext, taskId: string, input: MoveTaskRequest): Promise<TaskSummary> => {
  assertPermission(context, Permission.TaskUpdate);
  const sql = getSql();

  const result = await sql.begin(async (tx) => {
    const { task } = await authorizeTask(tx, context, taskId, "submit", true);
    const projectId = task.project_id;
    const targetListId = input.listId ?? task.list_id;
    const listChanged = targetListId !== task.list_id;
    if (listChanged) {
      await assertListInProject(tx, context, projectId, targetListId);
    }

    let targetParentId = input.parentTaskId !== undefined ? input.parentTaskId : task.parent_task_id;
    if (listChanged && input.parentTaskId === undefined) {
      targetParentId = null;
    }

    const subtree = await subtreeIdsByLevel(tx, context, taskId);
    const subtreeIds = new Set(subtree.map((node) => node.id));
    const subtreeHeight = Math.max(...subtree.map((node) => node.level)) + 1;
    if (targetParentId) {
      if (subtreeIds.has(targetParentId)) {
        throw new AppError("TASK_PARENT_CYCLE", "A task cannot be moved under itself.", 409);
      }
      await assertParentUsable(tx, context, { projectId, listId: targetListId, parentTaskId: targetParentId, subtreeHeight });
    }

    const targetWorkflow = await loadEffectiveWorkflow(tx, context.organization.id, projectId, targetListId);
    const currentWorkflow = listChanged ? await loadEffectiveWorkflow(tx, context.organization.id, projectId, task.list_id) : targetWorkflow;
    const initial = targetWorkflow.items.find((item) => item.isInitial) ?? targetWorkflow.items[0];
    if (!initial) {
      throw new AppError("TASK_STATUS_REQUIRED", "The target list has no statuses.", 409);
    }
    const mapStatus = (statusId: string) => {
      if (targetWorkflow.items.some((item) => item.id === statusId)) {
        return targetWorkflow.items.find((item) => item.id === statusId)!;
      }
      const key = currentWorkflow.items.find((item) => item.id === statusId)?.key;
      return targetWorkflow.items.find((item) => item.key === key) ?? initial;
    };

    let rootStatus = mapStatus(task.status_id);
    if (input.statusId) {
      const requested = targetWorkflow.items.find((item) => item.id === input.statusId);
      if (!requested) {
        throw new AppError("TASK_STATUS_NOT_FOUND", "Status is not available in the target list.", 400);
      }
      rootStatus = requested;
    }

    const rank = await rankForPlacement(
      tx,
      {
        table: "public.tasks",
        where: { organization_id: context.organization.id, list_id: targetListId, parent_task_id: targetParentId },
        excludeId: taskId
      },
      input.placement
    );

    const statusChanged = rootStatus.id !== task.status_id;
    await tx`
      UPDATE public.tasks
      SET list_id = ${targetListId}, parent_task_id = ${targetParentId}, rank = ${rank}, status_id = ${rootStatus.id},
          completed_at = CASE WHEN ${statusChanged} THEN (CASE WHEN ${rootStatus.isDone} THEN coalesce(completed_at, now()) ELSE NULL END) ELSE completed_at END,
          updated_by = ${context.user.id}
      WHERE id = ${taskId} AND organization_id = ${context.organization.id}
    `;

    if (listChanged) {
      // Parents first so the parent-scope trigger always sees an already-moved parent.
      const descendants = subtree.filter((node) => node.level > 0);
      const statusRows = descendants.length
        ? await tx<{ id: string; status_id: string; level: number }[]>`
            SELECT id, status_id, 0 AS level FROM public.tasks WHERE id = ANY(${descendants.map((node) => node.id)}::uuid[])
          `
        : [];
      const levelOf = new Map(descendants.map((node) => [node.id, node.level]));
      const byLevel = new Map<number, { id: string; statusId: string }[]>();
      for (const row of statusRows) {
        const level = levelOf.get(row.id) ?? 1;
        byLevel.set(level, [...(byLevel.get(level) ?? []), { id: row.id, statusId: mapStatus(row.status_id).id }]);
      }
      for (const level of [...byLevel.keys()].sort((a, b) => a - b)) {
        const items = byLevel.get(level)!;
        await tx`
          UPDATE public.tasks AS t
          SET list_id = ${targetListId}, status_id = data.status_id, updated_by = ${context.user.id},
              completed_at = CASE WHEN data.status_id <> t.status_id THEN (
                CASE WHEN (SELECT ts.category <> 'active' FROM public.task_statuses ts WHERE ts.id = data.status_id)
                  THEN coalesce(t.completed_at, now()) ELSE NULL END
              ) ELSE t.completed_at END
          FROM unnest(${items.map((item) => item.id)}::uuid[], ${items.map((item) => item.statusId)}::uuid[]) AS data(id, status_id)
          WHERE t.id = data.id AND t.organization_id = ${context.organization.id}
        `;
      }
    }

    const activities: ActivityInput[] = [];
    if (listChanged || targetParentId !== task.parent_task_id) {
      activities.push({
        taskId,
        action: "TASK_MOVED",
        previousValue: { listId: task.list_id, parentTaskId: task.parent_task_id },
        newValue: { listId: targetListId, parentTaskId: targetParentId }
      });
    }
    if (statusChanged) {
      const previous = currentWorkflow.items.find((item) => item.id === task.status_id);
      activities.push({
        taskId,
        action: "TASK_STATUS_CHANGED",
        previousValue: { statusId: task.status_id, name: previous?.name ?? null, color: previous?.color ?? null },
        newValue: { statusId: rootStatus.id, name: rootStatus.name, color: rootStatus.color }
      });
      await enqueueDomainEvents(tx, [
        {
          organizationId: context.organization.id,
          type: "task.status_changed",
          aggregateType: "task",
          aggregateId: taskId,
          actorUserId: context.user.id,
          payload: { projectId, title: task.title, statusId: rootStatus.id, statusName: rootStatus.name, isDone: rootStatus.isDone }
        }
      ]);
    }
    await insertActivities(tx, context, activities);

    return { previous: task, summary: (await selectTaskSummaries(tx, context, [taskId]))[0]! };
  });

  publishTaskChanged(result.summary, "moved", context.user.id);
  if (result.previous.list_id !== result.summary.listId) {
    publishToRoom({ type: "project", id: result.summary.projectId }, "task:changed", {
      projectId: result.summary.projectId,
      listId: result.previous.list_id,
      taskId,
      parentTaskId: result.previous.parent_task_id,
      kind: "moved",
      actorId: context.user.id,
      at: new Date().toISOString()
    });
  }
  return result.summary;
};

export const deleteTask = async (context: AccessContext, taskId: string) => {
  assertPermission(context, Permission.TaskDelete);
  const sql = getSql();
  const task = await sql.begin(async (tx) => {
    const { task: current } = await authorizeTask(tx, context, taskId, "submit", true);
    const subtree = await subtreeIdsByLevel(tx, context, taskId);
    await tx`
      UPDATE public.tasks SET deleted_at = now(), deleted_by = ${context.user.id}
      WHERE id = ANY(${subtree.map((node) => node.id)}::uuid[]) AND organization_id = ${context.organization.id}
    `;
    await insertActivities(tx, context, [{ taskId, action: "TASK_DELETED", newValue: { subtaskCount: subtree.length - 1 } }]);
    await enqueueDomainEvents(tx, [
      {
        organizationId: context.organization.id,
        type: "task.deleted",
        aggregateType: "task",
        aggregateId: taskId,
        actorUserId: context.user.id,
        payload: { projectId: current.project_id, title: current.title, taskIds: subtree.map((node) => node.id) }
      }
    ]);
    return current;
  });
  publishTaskChanged({ id: taskId, projectId: task.project_id, listId: task.list_id, parentTaskId: task.parent_task_id }, "deleted", context.user.id);
  return { ok: true as const };
};
