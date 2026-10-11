import { Permission } from "../../contracts/permissions.js";
import type { KnowledgeSearchHit } from "../../contracts/search.js";
import { getSql } from "../../db/client.js";
import { escapeLike, toIso, toPrefixTsQuery } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { hasPermission } from "../access/resource-access.js";
import { toColor } from "../work/mappers.js";

type HitRow = {
  id: string;
  space_id: string;
  space_name: string;
  title: string;
  summary: string | null;
  importance: "normal" | "important" | "critical";
  status_id: string;
  status_name: string;
  status_color: string;
  status_group: "draft" | "active" | "retired";
  updated_at: Date;
};

/**
 * Global search provider for knowledge items (Ctrl K and /search, PD-031): Vietnamese full text without diacritics
 * over title, summary, tags and body, plus title substrings. Only items the caller can read: live spaces they see
 * (public, member, or org admin) and, for drafts, submit+ members or the author. Active first, drafts next,
 * retired ("Hết hiệu lực") last.
 */
export const searchKnowledge = async (context: AccessContext, q: string, limit: number): Promise<KnowledgeSearchHit[]> => {
  const orgAdmin = context.hasFullOrganizationAuthority;
  if (!orgAdmin && !hasPermission(context, Permission.KnowledgeView)) {
    return [];
  }
  const sql = getSql();
  const tsQuery = toPrefixTsQuery(q);
  const like = `%${escapeLike(q.toLowerCase())}%`;
  // Search once (MATERIALIZED), then apply visibility to the matches.
  const rows = await sql<HitRow[]>`
    WITH matches AS MATERIALIZED (
      SELECT i.id, ${tsQuery ? sql`ts_rank(i.search_vector, to_tsquery('simple', ${tsQuery}))` : sql`0::real`} AS score
      FROM knowledge.items i
      WHERE i.organization_id = ${context.organization.id} AND i.deleted_at IS NULL
        AND (
          ${tsQuery ? sql`i.search_vector @@ to_tsquery('simple', ${tsQuery})` : sql`FALSE`}
          OR public.immutable_unaccent(lower(i.title)) LIKE public.immutable_unaccent(${like})
        )
      LIMIT 5000
    )
    SELECT i.id, i.space_id, s.name AS space_name, i.title, i.summary, i.importance,
      st.id AS status_id, st.name AS status_name, st.color AS status_color, st.status_group, i.updated_at
    FROM matches m
    JOIN knowledge.items i ON i.id = m.id
    JOIN knowledge.statuses st ON st.id = i.status_id
    JOIN knowledge.spaces s ON s.id = i.space_id AND s.organization_id = i.organization_id
      AND s.deleted_at IS NULL AND s.archived_at IS NULL
    LEFT JOIN knowledge.space_members sm ON sm.space_id = s.id AND sm.user_id = ${context.user.id}
    WHERE (${orgAdmin} OR s.visibility = 'public' OR sm.user_id IS NOT NULL)
      AND (st.status_group <> 'draft' OR ${orgAdmin} OR sm.access_level IN ('submit', 'manage') OR i.created_by = ${context.user.id})
    ORDER BY CASE st.status_group WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, m.score DESC, i.updated_at DESC, i.id
    LIMIT ${limit}
  `;
  return rows.map((row) => ({
    id: row.id,
    spaceId: row.space_id,
    spaceName: row.space_name,
    title: row.title,
    summary: row.summary,
    importance: row.importance,
    status: { id: row.status_id, name: row.status_name, color: toColor(row.status_color), group: row.status_group },
    updatedAt: toIso(row.updated_at)
  }));
};
