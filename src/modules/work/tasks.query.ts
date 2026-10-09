import { Permission } from "../../contracts/permissions.js";
import type { MyTasksQuery, TaskPage, TaskQuery, TaskSort } from "../../contracts/work.js";
import { getSql } from "../../db/client.js";
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  escapeLike,
  timestampParamSql,
  timestampTextSql,
  toPrefixTsQuery,
  type KeysetValueKind,
  type QuerySql,
  type SqlFragment
} from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { assertPermission, assertProjectAccess, hasPermission, visibleProjectsPredicate } from "../access/resource-access.js";
import { assertListInProject } from "./projects.service.js";
import { selectTaskSummaries } from "./tasks.repo.js";

type SortSpec = {
  kind: KeysetValueKind;
  /** ORDER BY expression (index-friendly). */
  expr: (sql: QuerySql) => SqlFragment;
  /** Cursor value as written into the cursor (full precision; never through a JS Date). */
  cursorValue: (sql: QuerySql) => SqlFragment;
  /** Cursor value back as an SQL value comparable with `expr`. */
  param: (sql: QuerySql, value: string | number) => SqlFragment;
};

const timestampSort = (column: (sql: QuerySql) => SqlFragment): SortSpec => ({
  kind: "timestamp",
  expr: column,
  cursorValue: (sql) => timestampTextSql(sql, () => column(sql)),
  param: (sql, value) => timestampParamSql(sql, String(value))
});

/** Keyset sorts (BUG-WK-01): every value round-trips losslessly, `dueAt` includes "infinity" (no due date). */
export const taskSorts: Record<TaskSort, SortSpec> = {
  rank: {
    kind: "text",
    expr: (sql) => sql`t.rank COLLATE "C"`,
    cursorValue: (sql) => sql`t.rank`,
    param: (sql, value) => sql`${String(value)}::text COLLATE "C"`
  },
  dueAt: timestampSort((sql) => sql`coalesce(t.due_at, 'infinity'::timestamptz)`),
  priority: {
    kind: "integer",
    expr: (sql) => sql`public.task_priority_rank(t.priority)`,
    cursorValue: (sql) => sql`public.task_priority_rank(t.priority)`,
    param: (sql, value) => sql`${Number(value)}::int`
  },
  createdAt: timestampSort((sql) => sql`t.created_at`),
  updatedAt: timestampSort((sql) => sql`t.updated_at`),
  title: {
    kind: "text",
    expr: (sql) => sql`lower(t.title)`,
    cursorValue: (sql) => sql`lower(t.title)`,
    param: (sql, value) => sql`${String(value)}::text`
  },
  number: {
    kind: "integer",
    expr: (sql) => sql`t.number`,
    cursorValue: (sql) => sql`t.number`,
    param: (sql, value) => sql`${Number(value)}::bigint`
  }
};

const keyPattern = /^([A-Za-z][A-Za-z0-9]{1,11})-(\d{1,12})$/;

type PageRow = { id: string; sort_value: string | number };

const toPage = async (
  sql: QuerySql,
  context: AccessContext,
  rows: PageRow[],
  limit: number,
  tag: string
): Promise<TaskPage> => {
  const pageRows = rows.slice(0, limit);
  const last = pageRows[pageRows.length - 1];
  const hasMore = rows.length > limit;
  return {
    items: await selectTaskSummaries(sql, context, pageRows.map((row) => row.id)),
    pageInfo: {
      hasMore,
      nextCursor: hasMore && last ? encodeKeysetCursor(tag, last.sort_value, last.id) : null
    }
  };
};

/** Integer sort values come back from SQL as numbers (int) or strings (bigint). */
const normalizeSortValue = (sort: SortSpec, value: string | number) => (sort.kind === "integer" ? Number(value) : String(value));

/**
 * Server-side filtered, sorted, keyset-paginated task listing for List / Board / Table views.
 * Never loads more than `limit + 1` rows; every filter runs in PostgreSQL behind project access.
 */
export const listTasks = async (context: AccessContext, projectId: string, query: TaskQuery): Promise<TaskPage> => {
  assertPermission(context, Permission.TaskView);
  const sql = getSql();
  const access = await assertProjectAccess(context, projectId, "view", sql);
  if (query.listId) {
    await assertListInProject(sql, context, projectId, query.listId);
  }

  const sort = taskSorts[query.sort];
  const tag = `${query.sort}.${query.order}`;
  const direction = query.order === "desc" ? sql`DESC` : sql`ASC`;
  const cursor = decodeKeysetCursor(query.cursor, tag, sort.kind);

  let where = sql`t.organization_id = ${context.organization.id}
    AND t.project_id = ${projectId}
    AND t.deleted_at IS NULL
    AND t.archived_at IS NULL`;

  if (query.listId) {
    where = sql`${where} AND t.list_id = ${query.listId}`;
  } else {
    // Tasks of archived lists are archived with them (BUG-WK-07).
    where = sql`${where} AND EXISTS (
      SELECT 1 FROM public.lists l
      WHERE l.id = t.list_id AND l.organization_id = t.organization_id AND l.archived_at IS NULL AND l.deleted_at IS NULL
    )`;
  }
  if (query.parent === "root") {
    where = sql`${where} AND t.parent_task_id IS NULL`;
  } else if (query.parent) {
    where = sql`${where} AND t.parent_task_id = ${query.parent}`;
  }
  // One status (Board / List groups) as an equality so the (list, status, rank) index returns rows in order (PERF-05).
  const statusIds = [...new Set(query.statusIds)];
  if (statusIds.length === 1) {
    where = sql`${where} AND t.status_id = ${statusIds[0]!}`;
  } else if (statusIds.length > 1) {
    where = sql`${where} AND t.status_id = ANY(${statusIds}::uuid[])`;
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
    where = sql`${where} AND t.due_at >= ${timestampParamSql(sql, query.dueFrom)}`;
  }
  if (query.dueTo) {
    where = sql`${where} AND t.due_at < ${timestampParamSql(sql, query.dueTo)}`;
  }
  if (query.q) {
    const keyMatch = keyPattern.exec(query.q);
    const tsQuery = toPrefixTsQuery(query.q);
    const like = `%${escapeLike(query.q.toLowerCase())}%`;
    // "KEY-12" only matches task 12 of this project (or one of its former keys), never #12 of the query (WK-55).
    const keyCondition =
      keyMatch && (await projectAnswersToKey(sql, context, projectId, access.projectKey, keyMatch[1]!))
        ? sql`t.number = ${Number(keyMatch[2])}`
        : sql`FALSE`;
    const textCondition = tsQuery ? sql`t.search_vector @@ to_tsquery('simple', ${tsQuery})` : sql`FALSE`;
    where = sql`${where} AND (
      ${keyCondition}
      OR ${textCondition}
      OR public.immutable_unaccent(lower(t.title)) LIKE public.immutable_unaccent(${like})
    )`;
  }
  if (cursor) {
    const comparison = query.order === "desc" ? sql`<` : sql`>`;
    where = sql`${where} AND (${sort.expr(sql)}, t.id) ${comparison} (${sort.param(sql, cursor.value)}, ${cursor.id}::uuid)`;
  }

  // Phase 1: narrow, index-friendly id selection. Phase 2: enrich only the page (assignees, counts).
  const rows = await sql<PageRow[]>`
    SELECT t.id, ${sort.cursorValue(sql)} AS sort_value
    FROM public.tasks t
    JOIN public.task_statuses ts ON ts.id = t.status_id AND ts.organization_id = t.organization_id
    WHERE ${where}
    ORDER BY ${sort.expr(sql)} ${direction}, t.id ${direction}
    LIMIT ${query.limit + 1}
  `;
  return await toPage(
    sql,
    context,
    rows.map((row) => ({ id: row.id, sort_value: normalizeSortValue(sort, row.sort_value) })),
    query.limit,
    tag
  );
};

/** True when `key` is the project's current key or one it used before (old task links keep working). */
const projectAnswersToKey = async (sql: QuerySql, context: AccessContext, projectId: string, currentKey: string, key: string) => {
  const wanted = key.toUpperCase();
  if (wanted === currentKey) {
    return true;
  }
  const rows = await sql<{ ok: number }[]>`
    SELECT 1 AS ok FROM public.project_key_aliases
    WHERE organization_id = ${context.organization.id} AND project_id = ${projectId} AND key = ${wanted}
    LIMIT 1
  `;
  return rows.length > 0;
};

const myTaskSorts: Record<MyTasksQuery["sort"], { spec: SortSpec; ascending: boolean }> = {
  dueAt: { spec: taskSorts.dueAt, ascending: true },
  updatedAt: { spec: taskSorts.updatedAt, ascending: false },
  priority: { spec: taskSorts.priority, ascending: false }
};

/** Tasks assigned to the caller in projects they can still see (membership may have changed since assignment). */
export const listMyTasks = async (context: AccessContext, query: MyTasksQuery): Promise<TaskPage> => {
  assertPermission(context, Permission.TaskView);
  const { spec: sort, ascending } = myTaskSorts[query.sort];
  const tag = `mine.${query.sort}`;
  const cursor = decodeKeysetCursor(query.cursor, tag, sort.kind);
  if (!hasPermission(context, Permission.ProjectView)) {
    return { items: [], pageInfo: { hasMore: false, nextCursor: null } };
  }
  const sql = getSql();
  const direction = ascending ? sql`ASC` : sql`DESC`;
  const comparison = ascending ? sql`>` : sql`<`;

  const rows = await sql<PageRow[]>`
    SELECT t.id, ${sort.cursorValue(sql)} AS sort_value
    FROM public.task_assignees ta
    JOIN public.tasks t ON t.id = ta.task_id AND t.organization_id = ta.organization_id
    JOIN public.projects p ON p.id = t.project_id AND p.organization_id = t.organization_id
      AND p.deleted_at IS NULL AND p.archived_at IS NULL
    JOIN public.lists l ON l.id = t.list_id AND l.organization_id = t.organization_id
      AND l.deleted_at IS NULL AND l.archived_at IS NULL
    JOIN public.task_statuses ts ON ts.id = t.status_id AND ts.organization_id = t.organization_id
    WHERE ta.organization_id = ${context.organization.id}
      AND ta.assignee_user_id = ${context.user.id}
      AND ta.removed_at IS NULL
      AND t.deleted_at IS NULL AND t.archived_at IS NULL
      AND ${visibleProjectsPredicate(sql, context)}
      AND ${query.includeDone ? sql`TRUE` : sql`ts.category = 'active'`}
      AND ${query.due === "overdue" ? sql`t.due_at < now() AND t.completed_at IS NULL` : query.due === "none" ? sql`t.due_at IS NULL` : sql`TRUE`}
      AND ${query.dueFrom ? sql`t.due_at >= ${timestampParamSql(sql, query.dueFrom)}` : sql`TRUE`}
      AND ${query.dueTo ? sql`t.due_at < ${timestampParamSql(sql, query.dueTo)}` : sql`TRUE`}
      ${cursor ? sql`AND (${sort.expr(sql)}, t.id) ${comparison} (${sort.param(sql, cursor.value)}, ${cursor.id}::uuid)` : sql``}
    ORDER BY ${sort.expr(sql)} ${direction}, t.id ${direction}
    LIMIT ${query.limit + 1}
  `;
  return await toPage(
    sql,
    context,
    rows.map((row) => ({ id: row.id, sort_value: normalizeSortValue(sort, row.sort_value) })),
    query.limit,
    tag
  );
};
