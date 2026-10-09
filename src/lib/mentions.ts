import { sanitizeRichText, type SanitizeLimits, type SanitizeResult } from "../contracts/rich-text.js";
import type { QuerySql } from "./db-types.js";

/** Current display names of the given people in the organization (memberships not deleted). */
export const loadMentionLabels = async (sql: QuerySql, organizationId: string, userIds: string[]) => {
  if (userIds.length === 0) {
    return new Map<string, string>();
  }
  const rows = await sql<{ id: string; display_name: string }[]>`
    SELECT au.id, au.display_name
    FROM public.organization_memberships om
    JOIN public.app_users au ON au.id = om.user_id AND au.deleted_at IS NULL
    WHERE om.organization_id = ${organizationId} AND om.user_id = ANY(${userIds}::uuid[]) AND om.deleted_at IS NULL
  `;
  return new Map(rows.map((row) => [row.id, row.display_name]));
};

/**
 * Sanitizes a rich text document whose mention labels are server-derived (SEC-API-10): every mention shows
 * the person's current display name, mentions of ids outside the organization become plain text.
 * Throws RichTextError like `sanitizeRichText`.
 */
export const sanitizeWithMentionLabels = async (
  sql: QuerySql,
  organizationId: string,
  doc: unknown,
  limits: SanitizeLimits
): Promise<SanitizeResult> => {
  const first = sanitizeRichText(doc, limits);
  if (first.mentions.length === 0) {
    return first;
  }
  const labels = await loadMentionLabels(sql, organizationId, first.mentions);
  return sanitizeRichText(first.doc, limits, { mentionLabels: labels });
};
