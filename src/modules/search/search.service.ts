import { Permission } from "../../contracts/permissions.js";
import type { GlobalSearchQuery, GlobalSearchResult, MessageSearchHit } from "../../contracts/search.js";
import { getSql } from "../../db/client.js";
import { escapeLike, toIso, toPrefixTsQuery } from "../../lib/db-types.js";
import { logger } from "../../lib/logger.js";
import type { AccessContext } from "../access/access-context.js";
import { hasPermission, visibleProjectsPredicate } from "../access/resource-access.js";
import { searchDirectory } from "../work/directory.service.js";
import { toColor } from "../work/mappers.js";

/**
 * Message search is owned by the chat module; it registers a provider so global search can
 * include messages without coupling the modules. Providers must apply chat membership rules.
 */
type MessageSearchProvider = (context: AccessContext, q: string, limit: number) => Promise<MessageSearchHit[]>;
let messageProvider: MessageSearchProvider | undefined;
export const registerMessageSearchProvider = (provider: MessageSearchProvider) => {
  messageProvider = provider;
};

const keyPattern = /^([A-Za-z][A-Za-z0-9]{1,11})-(\d{1,12})$/;

export const globalSearch = async (context: AccessContext, query: GlobalSearchQuery): Promise<GlobalSearchResult> => {
  const sql = getSql();
  const groups = new Set(query.groups);
  const limit = query.limit;
  const like = `%${escapeLike(query.q.toLowerCase())}%`;
  const tsQuery = toPrefixTsQuery(query.q);
  const keyMatch = keyPattern.exec(query.q);
  const canSeeProjects = hasPermission(context, Permission.ProjectView);

  const tasks = async () => {
    if (!groups.has("tasks") || !canSeeProjects || !hasPermission(context, Permission.TaskView)) {
      return [];
    }
    // Phase 1: search runs exactly once (MATERIALIZED), then visibility filters the matches.
    // Without the fence the planner may re-run the full-text scan once per visible project.
    const keyCondition = keyMatch
      ? sql`(t.number = ${Number(keyMatch[2])} AND t.project_id IN (
          SELECT kp.id FROM public.projects kp
          WHERE kp.organization_id = ${context.organization.id} AND upper(kp.key) = ${keyMatch[1]!.toUpperCase()} AND kp.deleted_at IS NULL
        ))`
      : sql`FALSE`;
    const hits = await sql<{ id: string }[]>`
      WITH matches AS MATERIALIZED (
        SELECT t.id, t.project_id, t.list_id, t.completed_at, t.updated_at,
          ${keyCondition} AS is_key,
          ${tsQuery ? sql`ts_rank(t.search_vector, to_tsquery('simple', ${tsQuery}))` : sql`0::real`} AS score
        FROM public.tasks t
        WHERE t.organization_id = ${context.organization.id}
          AND t.deleted_at IS NULL AND t.archived_at IS NULL
          AND (
            ${keyCondition}
            OR ${tsQuery ? sql`t.search_vector @@ to_tsquery('simple', ${tsQuery})` : sql`FALSE`}
            OR public.immutable_unaccent(lower(t.title)) LIKE public.immutable_unaccent(${like})
          )
      )
      SELECT m.id
      FROM matches m
      JOIN public.projects p ON p.id = m.project_id AND p.organization_id = ${context.organization.id}
        AND p.deleted_at IS NULL AND p.archived_at IS NULL
      WHERE EXISTS (
          SELECT 1 FROM public.lists l
          WHERE l.id = m.list_id AND l.organization_id = p.organization_id AND l.deleted_at IS NULL AND l.archived_at IS NULL
        )
        AND ${visibleProjectsPredicate(sql, context)}
      ORDER BY m.is_key DESC, m.score DESC, (m.completed_at IS NULL) DESC, m.updated_at DESC, m.id
      LIMIT ${limit}
    `;
    if (hits.length === 0) {
      return [];
    }
    const order = new Map(hits.map((hit, index) => [hit.id, index]));
    const rows = await sql<{
      id: string;
      task_key: string;
      title: string;
      project_id: string;
      project_name: string;
      list_id: string;
      list_name: string;
      status_id: string;
      status_name: string;
      status_color: string;
      status_category: "active" | "done" | "closed";
      completed_at: Date | null;
      updated_at: Date;
    }[]>`
      SELECT t.id, p.key || '-' || t.number AS task_key, t.title, t.project_id, p.name AS project_name, t.list_id, l.name AS list_name,
        ts.id AS status_id, ts.name AS status_name, ts.color AS status_color, ts.category AS status_category, t.completed_at, t.updated_at
      FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id AND p.organization_id = t.organization_id
      JOIN public.lists l ON l.id = t.list_id AND l.organization_id = t.organization_id
      JOIN public.task_statuses ts ON ts.id = t.status_id AND ts.organization_id = t.organization_id
      WHERE t.organization_id = ${context.organization.id} AND t.id = ANY(${hits.map((hit) => hit.id)}::uuid[])
    `;
    rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    return rows.map((row) => ({
      id: row.id,
      key: row.task_key,
      title: row.title,
      projectId: row.project_id,
      projectName: row.project_name,
      listId: row.list_id,
      listName: row.list_name,
      status: { id: row.status_id, name: row.status_name, color: toColor(row.status_color), category: row.status_category },
      completedAt: row.completed_at ? toIso(row.completed_at) : null,
      updatedAt: toIso(row.updated_at)
    }));
  };

  const projects = async () => {
    if (!groups.has("projects") || !canSeeProjects) {
      return [];
    }
    const rows = await sql<{ id: string; key: string; name: string; color: string; visibility: "public" | "private" }[]>`
      SELECT p.id, p.key, p.name, p.color, p.visibility
      FROM public.projects p
      WHERE p.organization_id = ${context.organization.id} AND p.deleted_at IS NULL AND p.archived_at IS NULL
        AND ${visibleProjectsPredicate(sql, context)}
        AND (public.immutable_unaccent(lower(p.name)) LIKE public.immutable_unaccent(${like}) OR lower(p.key) LIKE ${like})
      ORDER BY (lower(p.key) = ${query.q.toLowerCase()}) DESC, p.name
      LIMIT ${limit}
    `;
    return rows.map((row) => ({ ...row, color: toColor(row.color, "indigo") }));
  };

  const lists = async () => {
    if (!groups.has("lists") || !canSeeProjects || !hasPermission(context, Permission.ListView)) {
      return [];
    }
    const rows = await sql<{ id: string; name: string; project_id: string; project_name: string }[]>`
      SELECT l.id, l.name, l.project_id, p.name AS project_name
      FROM public.lists l
      JOIN public.projects p ON p.id = l.project_id AND p.organization_id = l.organization_id AND p.deleted_at IS NULL AND p.archived_at IS NULL
      WHERE l.organization_id = ${context.organization.id} AND l.deleted_at IS NULL AND l.archived_at IS NULL
        AND ${visibleProjectsPredicate(sql, context)}
        AND public.immutable_unaccent(lower(l.name)) LIKE public.immutable_unaccent(${like})
      ORDER BY l.name
      LIMIT ${limit}
    `;
    return rows.map((row) => ({ id: row.id, name: row.name, projectId: row.project_id, projectName: row.project_name }));
  };

  const people = async () => {
    if (!groups.has("people") || !hasPermission(context, Permission.MemberView)) {
      return [];
    }
    return (await searchDirectory(context, { q: query.q, limit })).items;
  };

  const messages = async () => {
    if (!groups.has("messages") || !messageProvider) {
      return [];
    }
    try {
      return await messageProvider(context, query.q, limit);
    } catch (error) {
      logger.warn({ err: error }, "Message search provider failed");
      return [];
    }
  };

  const [taskHits, projectHits, listHits, peopleHits, messageHits] = await Promise.all([tasks(), projects(), lists(), people(), messages()]);
  return { tasks: taskHits, projects: projectHits, lists: listHits, people: peopleHits, messages: messageHits };
};

