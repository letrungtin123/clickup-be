import type postgres from "postgres";

import { AppError } from "../../lib/app-error.js";
import type { QuerySql } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { toTaskSummary, type TaskRow } from "./mappers.js";

/** JSON object for a user row aliased `au`. */
export const userJsonSql = (sql: QuerySql, alias = "au") =>
  sql`json_build_object('id', ${sql(alias)}.id, 'display_name', ${sql(alias)}.display_name, 'email', ${sql(alias)}.email, 'avatar_url', ${sql(alias)}.avatar_url)`;

/** Columns for TaskRow; expects `t` (tasks), `p` (projects), `ts` (task_statuses) in scope. */
export const taskColumnsSql = (sql: QuerySql) => sql`
  t.id, t.number, p.key AS project_key, t.project_id, t.list_id, t.parent_task_id, t.title,
  ts.id AS status_id, ts.name AS status_name, ts.color AS status_color, ts.category AS status_category,
  t.priority, t.start_at, t.due_at, t.completed_at, t.rank, t.created_at, t.updated_at,
  coalesce((
    SELECT json_agg(${userJsonSql(sql)} ORDER BY ta.assigned_at, au.id)
    FROM public.task_assignees ta
    JOIN public.app_users au ON au.id = ta.assignee_user_id
    WHERE ta.organization_id = t.organization_id AND ta.task_id = t.id AND ta.removed_at IS NULL
  ), '[]'::json) AS assignees,
  coalesce(sub.total, 0) AS subtask_count,
  coalesce(sub.open, 0) AS open_subtask_count,
  (
    SELECT count(*)::int FROM public.task_comments cm
    WHERE cm.organization_id = t.organization_id AND cm.task_id = t.id AND cm.deleted_at IS NULL
  ) AS comment_count,
  (
    -- Task files only: comment files (sent or still in a comment draft) are not task attachments (WK-28).
    SELECT count(*)::int FROM public.task_attachments a
    WHERE a.organization_id = t.organization_id AND a.task_id = t.id AND a.status = 'ready' AND a.deleted_at IS NULL
      AND a.comment_id IS NULL AND a.purpose = 'task'
  ) AS attachment_count
`;

/** FROM clause matching taskColumnsSql. */
export const taskFromSql = (sql: QuerySql) => sql`
  public.tasks t
  JOIN public.projects p ON p.id = t.project_id AND p.organization_id = t.organization_id
  JOIN public.task_statuses ts ON ts.id = t.status_id AND ts.organization_id = t.organization_id
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS total, count(*) FILTER (WHERE c.completed_at IS NULL)::int AS open
    FROM public.tasks c
    WHERE c.organization_id = t.organization_id AND c.parent_task_id = t.id
      AND c.deleted_at IS NULL AND c.archived_at IS NULL
  ) sub ON TRUE
`;

export const selectTaskSummaries = async (sql: QuerySql, context: AccessContext, taskIds: string[]) => {
  if (taskIds.length === 0) {
    return [];
  }
  const rows = await sql<TaskRow[]>`
    SELECT ${taskColumnsSql(sql)}
    FROM ${taskFromSql(sql)}
    WHERE t.organization_id = ${context.organization.id}
      AND t.id = ANY(${taskIds}::uuid[])
      AND t.deleted_at IS NULL
  `;
  const byId = new Map(rows.map((row) => [row.id, toTaskSummary(row)]));
  return taskIds.flatMap((id) => {
    const task = byId.get(id);
    return task ? [task] : [];
  });
};

export type TaskCore = {
  id: string;
  project_id: string;
  list_id: string;
  parent_task_id: string | null;
  status_id: string;
  title: string;
  priority: string;
  start_at: Date | null;
  due_at: Date | null;
  completed_at: Date | null;
  created_by: string | null;
  number: string;
};

/** Loads an active task (not in the trash, not in an archived list) inside the caller's organization, optionally locked. */
export const loadTaskCore = async (sql: QuerySql, context: AccessContext, taskId: string, lock = false) => {
  const rows = await sql<TaskCore[]>`
    SELECT t.id, t.project_id, t.list_id, t.parent_task_id, t.status_id, t.title, t.priority, t.start_at, t.due_at,
      t.completed_at, t.created_by, t.number::text
    FROM public.tasks t
    JOIN public.lists l ON l.id = t.list_id AND l.organization_id = t.organization_id
      AND l.archived_at IS NULL AND l.deleted_at IS NULL
    WHERE t.id = ${taskId} AND t.organization_id = ${context.organization.id} AND t.deleted_at IS NULL AND t.archived_at IS NULL
    ${lock ? sql`FOR UPDATE OF t` : sql``}
  `;
  const task = rows[0];
  if (!task) {
    throw new AppError("TASK_NOT_FOUND", "Task was not found.", 404);
  }
  return task;
};

export type ActivityInput = {
  taskId: string;
  action: string;
  previousValue?: Record<string, postgres.JSONValue> | null;
  newValue?: Record<string, postgres.JSONValue> | null;
  targetType?: string;
  targetId?: string | null;
};

export const insertActivities = async (sql: QuerySql, context: AccessContext, activities: ActivityInput[]) => {
  if (activities.length === 0) {
    return;
  }
  await sql`
    INSERT INTO public.task_activity_events (organization_id, task_id, actor_user_id, action, target_type, target_id, previous_value, new_value)
    SELECT ${context.organization.id}, (a->>'taskId')::uuid, ${context.user.id}, a->>'action',
      coalesce(a->>'targetType', 'task'), (a->>'targetId')::uuid, a->'previousValue', a->'newValue'
    FROM jsonb_array_elements(${sql.json(
      activities.map((activity) => ({
        taskId: activity.taskId,
        action: activity.action,
        targetType: activity.targetType ?? "task",
        targetId: activity.targetId ?? activity.taskId,
        previousValue: activity.previousValue ?? null,
        newValue: activity.newValue ?? null
      }))
    )}) AS a
  `;
};
