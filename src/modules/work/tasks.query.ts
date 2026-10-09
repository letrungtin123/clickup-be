import type postgres from "postgres";

import { Permission } from "../../contracts/permissions.js";
import type { TaskPage, TaskQuery, TaskSort } from "../../contracts/work.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { decodeCursor, encodeCursor, escapeLike, toPrefixTsQuery, type QuerySql } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { assertPermission, assertProjectAccess } from "../access/resource-access.js";
import { assertListInProject } from "./projects.service.js";
import { selectTaskSummaries } from "./tasks.repo.js";

type SortSpec = {
  expr: (sql: QuerySql) => postgres.PendingQuery<postgres.Row[]>;
  cast: (sql: QuerySql, value: string | number | null) => postgres.PendingQuery<postgres.Row[]>;
};

const sorts: Record<TaskSort, SortSpec> = {
  rank: { expr: (sql) => sql`t.rank COLLATE "C"`, cast: (sql, value) => sql`${String(value)}::text COLLATE "C"` },
  dueAt: {
    expr: (sql) => sql`coalesce(t.due_at, 'infinity'::timestamptz)`,
    cast: (sql, value) => sql`${String(value)}::timestamptz`
  },
  priority: {
    expr: (sql) => sql`public.task_priority_rank(t.priority)`,
    cast: (sql, value) => sql`${Number(value)}::int`
  },
  createdAt: { expr: (sql) => sql`t.created_at`, cast: (sql, value) => sql`${String(value)}::timestamptz` },
  updatedAt: { expr: (sql) => sql`t.updated_at`, cast: (sql, value) => sql`${String(value)}::timestamptz` },
  title: { expr: (sql) => sql`lower(t.title)`, cast: (sql, value) => sql`${String(value)}::text` },
  number: { expr: (sql) => sql`t.number`, cast: (sql, value) => sql`${Number(value)}::bigint` }
};

const keyPattern = /^([A-Za-z][A-Za-z0-9]{1,11})-(\d{1,12})$/;

/**
 * Server-side filtered, sorted, keyset-paginated task listing for List / Board / Table views.
 * Never loads more than `limit + 1` rows; every filter runs in PostgreSQL behind project access.
 */
export const listTasks = async (context: AccessContext, projectId: string, query: TaskQuery): Promise<TaskPage> => {
  assertPermission(context, Permission.TaskView);
  const sql = getSql();
  await assertProjectAccess(context, projectId, "view", sql);
  if (query.listId) {
    await assertListInProject(sql, context, projectId, query.listId);
  }

  const sort = sorts[query.sort];
  const direction = query.order === "desc" ? sql`DESC` : sql`ASC`;
  const cursor = decodeCursor(query.cursor, 2);
  if (query.cursor && !cursor) {
    throw new AppError("INVALID_CURSOR", "The pagination cursor is invalid.", 400);
  }

  let where = sql`t.organization_id = ${context.organization.id}
    AND t.project_id = ${projectId}
    AND t.deleted_at IS NULL
    AND t.archived_at IS NULL`;

  if (query.listId) {
    where = sql`${where} AND t.list_id = ${query.listId}`;
  }
  if (query.parent === "root") {
    where = sql`${where} AND t.parent_task_id IS NULL`;
  } else if (query.parent) {
    where = sql`${where} AND t.parent_task_id = ${query.parent}`;
  }
  if (query.statusIds.length > 0) {
    where = sql`${where} AND t.status_id = ANY(${query.statusIds}::uuid[])`;
  }
  if (!query.includeDone) {
    where = sql`${where} AND ts.category = 'active'`;
  }
  if (query.priorities.length > 0) {
    where = sql`${where} AND t.priority = ANY(${query.priorities}::text[])`;
  }
  if (query.assigneeIds.length > 0) {
    const ids = query.assigneeIds
      .map((id) => (id === "me" ? context.user.id : id))
      .filter((id): id is string => id !== "none");
    const wantsNone = query.assigneeIds.includes("none");
    const some = ids.length > 0
      ? sql`EXISTS (
          SELECT 1 FROM public.task_assignees fa
          WHERE fa.organization_id = t.organization_id AND fa.task_id = t.id
            AND fa.removed_at IS NULL AND fa.assignee_user_id = ANY(${ids}::uuid[])
        )`
      : sql`FALSE`;
    const none = wantsNone
      ? sql`NOT EXISTS (
          SELECT 1 FROM public.task_assignees na
          WHERE na.organization_id = t.organization_id AND na.task_id = t.id AND na.removed_at IS NULL
        )`
      : sql`FALSE`;
    where = sql`${where} AND (${some} OR ${none})`;
  }
  if (query.due === "overdue") {
    where = sql`${where} AND t.due_at < now() AND t.completed_at IS NULL`;
  } else if (query.due === "none") {
    where = sql`${where} AND t.due_at IS NULL`;
  }
  if (query.dueFrom) {
    where = sql`${where} AND t.due_at >= ${query.dueFrom}::timestamptz`;
  }
  if (query.dueTo) {
    where = sql`${where} AND t.due_at < ${query.dueTo}::timestamptz`;
  }
  if (query.q) {
    const keyMatch = keyPattern.exec(query.q);
    const tsQuery = toPrefixTsQuery(query.q);
    const like = `%${escapeLike(query.q.toLowerCase())}%`;
    const keyCondition = keyMatch ? sql`t.number = ${Number(keyMatch[2])}` : sql`FALSE`;
    const textCondition = tsQuery ? sql`t.search_vector @@ to_tsquery('simple', ${tsQuery})` : sql`FALSE`;
    where = sql`${where} AND (
      ${keyCondition}
      OR ${textCondition}
      OR public.immutable_unaccent(lower(t.title)) LIKE public.immutable_unaccent(${like})
    )`;
  }
  if (cursor) {
    const comparison = query.order === "desc" ? sql`<` : sql`>`;
    where = sql`${where} AND (${sort.expr(sql)}, t.id) ${comparison} (${sort.cast(sql, cursor[0] ?? null)}, ${String(cursor[1])}::uuid)`;
  }

  // Phase 1: narrow, index-friendly id selection. Phase 2: enrich only the page (assignees, counts).
  const rows = await sql<{ id: string; sort_value: string }[]>`
    SELECT t.id, (${sort.expr(sql)})::text AS sort_value
    FROM public.tasks t
    JOIN public.task_statuses ts ON ts.id = t.status_id AND ts.organization_id = t.organization_id
    WHERE ${where}
    ORDER BY ${sort.expr(sql)} ${direction}, t.id ${direction}
    LIMIT ${query.limit + 1}
  `;

  const pageRows = rows.slice(0, query.limit);
  const last = pageRows[pageRows.length - 1];
  const hasMore = rows.length > query.limit;
  const summaries = await selectTaskSummaries(sql, context, pageRows.map((row) => row.id));
  return {
    items: summaries,
    pageInfo: {
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor([query.sort === "priority" || query.sort === "number" ? Number(last.sort_value) : last.sort_value, last.id])
          : null
    }
  };
};
