import type postgres from "postgres";

import type {
  KnowledgeAccessLevel,
  KnowledgeAttachment,
  KnowledgeAuditAction,
  KnowledgeAuditEntry,
  KnowledgeCategory,
  KnowledgeChangedEvent,
  KnowledgeImportance,
  KnowledgeItemSummary,
  KnowledgeStatus,
  KnowledgeStatusGroup
} from "../../contracts/knowledge.js";
import { orgRoom } from "../../contracts/realtime.js";
import {
  descriptionLimits,
  knowledgeBodyLimits,
  RichTextError,
  type RichTextDoc,
  type RichTextNode,
  type RichTextProfile,
  type SanitizeLimits,
  sanitizeRichText
} from "../../contracts/rich-text.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { toIso, toNullableIso, type QuerySql } from "../../lib/db-types.js";
import { logger } from "../../lib/logger.js";
import { loadMentionLabels } from "../../lib/mentions.js";
import { inlineImageTypes } from "../../lib/storage.js";
import { publishToRoom, publishToRooms, publishToUsers } from "../../realtime/publisher.js";
import type { AccessContext } from "../access/access-context.js";
import { toColor, toUserRef, type UserRefJson } from "../work/mappers.js";
import { userJsonSql } from "../work/tasks.repo.js";
import { loadReaderCandidates } from "./access.js";
import { businessDay, isReviewDue, spaceReaders } from "./rules.js";

export { userJsonSql };

// Statuses & categories -------------------------------------------------------------------------------

export type StatusRow = { id: string; name: string; color: string; status_group: KnowledgeStatusGroup; position: number };

export const toStatus = (row: StatusRow): KnowledgeStatus => ({
  id: row.id,
  name: row.name,
  color: toColor(row.color),
  group: row.status_group,
  position: Number(row.position)
});

export const loadStatuses = (sql: QuerySql, spaceId: string) => sql<StatusRow[]>`
  SELECT id, name, color, status_group, position FROM knowledge.statuses WHERE space_id = ${spaceId} ORDER BY position, id
`;

export type CategoryRow = { id: string; parent_id: string | null; name: string; rank: string; item_count: number };

export const toCategory = (row: CategoryRow): KnowledgeCategory => ({
  id: row.id,
  parentId: row.parent_id,
  name: row.name,
  rank: row.rank,
  itemCount: Number(row.item_count)
});

/** Draft visibility for item counts / lists (alias `i` items, `st` statuses). */
export const itemVisibleSql = (sql: QuerySql, seesDrafts: boolean, userId: string) =>
  seesDrafts ? sql`TRUE` : sql`(st.status_group <> 'draft' OR i.created_by = ${userId})`;

/** Top-level categories first, each followed by its children, in rank order. */
export const loadCategories = async (sql: QuerySql, spaceId: string, seesDrafts: boolean, userId: string) => {
  const rows = await sql<CategoryRow[]>`
    SELECT c.id, c.parent_id, c.name, c.rank,
      (
        SELECT count(*)::int FROM knowledge.items i JOIN knowledge.statuses st ON st.id = i.status_id
        WHERE i.space_id = c.space_id AND i.category_id = c.id AND i.deleted_at IS NULL AND ${itemVisibleSql(sql, seesDrafts, userId)}
      ) AS item_count
    FROM knowledge.categories c
    LEFT JOIN knowledge.categories p ON p.id = c.parent_id
    WHERE c.space_id = ${spaceId}
    ORDER BY coalesce(p.rank, c.rank) COLLATE "C", coalesce(p.id, c.id), (c.parent_id IS NOT NULL), c.rank COLLATE "C", c.id
  `;
  return rows.map(toCategory);
};

// Items -----------------------------------------------------------------------------------------------

export type ItemRow = {
  id: string;
  space_id: string;
  category_id: string | null;
  title: string;
  summary: string | null;
  importance: KnowledgeImportance;
  status_id: string;
  status_name: string;
  status_color: string;
  status_group: KnowledgeStatusGroup;
  status_position: number;
  owner: UserRefJson | null;
  tags: string[];
  pinned: boolean;
  effective_from: string | null;
  review_by: string | null;
  version: number;
  comment_count: number;
  open_comment_count: number;
  attachment_count: number;
  created_by: UserRefJson | null;
  updated_by: UserRefJson | null;
  created_by_id: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
};

/** Columns of ItemRow; expects `i` (items) and `st` (statuses) in scope. */
export const itemColumnsSql = (sql: QuerySql) => sql`
  i.id, i.space_id, i.category_id, i.title, i.summary, i.importance,
  st.id AS status_id, st.name AS status_name, st.color AS status_color, st.status_group, st.position AS status_position,
  (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = i.owner_user_id) AS owner,
  i.tags, i.pinned, to_char(i.effective_from, 'YYYY-MM-DD') AS effective_from, to_char(i.review_by, 'YYYY-MM-DD') AS review_by,
  i.version,
  (SELECT count(*)::int FROM knowledge.comments c WHERE c.item_id = i.id AND c.deleted_at IS NULL) AS comment_count,
  (
    SELECT count(*)::int FROM knowledge.comments c
    WHERE c.item_id = i.id AND c.deleted_at IS NULL AND c.parent_comment_id IS NULL AND c.resolved_at IS NULL
  ) AS open_comment_count,
  (
    SELECT count(*)::int FROM knowledge.item_attachments a
    WHERE a.item_id = i.id AND a.deleted_at IS NULL AND a.status = 'ready' AND a.purpose = 'item'
  ) AS attachment_count,
  (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = i.created_by) AS created_by,
  (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = i.updated_by) AS updated_by,
  i.created_by AS created_by_id, i.created_at, i.updated_at, i.deleted_at
`;

export const toItemSummary = (row: ItemRow, today = businessDay()): KnowledgeItemSummary => ({
  id: row.id,
  spaceId: row.space_id,
  categoryId: row.category_id,
  title: row.title,
  summary: row.summary,
  importance: row.importance,
  status: toStatus({
    id: row.status_id,
    name: row.status_name,
    color: row.status_color,
    status_group: row.status_group,
    position: row.status_position
  }),
  owner: toUserRef(row.owner),
  tags: row.tags ?? [],
  pinned: row.pinned,
  effectiveFrom: row.effective_from,
  reviewBy: row.review_by,
  reviewDue: isReviewDue(row.review_by, row.status_group, today),
  version: Number(row.version),
  commentCount: Number(row.comment_count),
  openCommentCount: Number(row.open_comment_count),
  attachmentCount: Number(row.attachment_count),
  createdBy: toUserRef(row.created_by),
  updatedBy: toUserRef(row.updated_by),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at)
});

// Attachments -----------------------------------------------------------------------------------------

export type AttachmentRow = {
  id: string;
  item_id: string;
  comment_id: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: string | number;
  uploaded_by: UserRefJson | null;
  created_at: Date | string;
};

export const toKnowledgeAttachment = (row: AttachmentRow, canDelete: boolean): KnowledgeAttachment => ({
  id: row.id,
  itemId: row.item_id,
  commentId: row.comment_id,
  fileName: row.file_name,
  mimeType: row.mime_type,
  sizeBytes: Number(row.size_bytes),
  isImage: inlineImageTypes.has(row.mime_type),
  uploadedBy: toUserRef(row.uploaded_by),
  createdAt: toIso(row.created_at),
  canDelete
});

/** JSON array of AttachmentRow for the attachments matching `where` (alias `a`). */
export const attachmentsJsonSql = (sql: QuerySql, where: postgres.PendingQuery<postgres.Row[]>) => sql`
  coalesce((
    SELECT json_agg(json_build_object(
      'id', a.id, 'item_id', a.item_id, 'comment_id', a.comment_id, 'file_name', a.file_name, 'mime_type', a.mime_type,
      'size_bytes', a.size_bytes, 'created_at', a.created_at,
      'uploaded_by', (SELECT ${userJsonSql(sql, "uau")} FROM public.app_users uau WHERE uau.id = a.uploaded_by)
    ) ORDER BY a.created_at, a.id)
    FROM knowledge.item_attachments a
    WHERE a.status = 'ready' AND a.deleted_at IS NULL AND ${where}
  ), '[]'::json)
`;

// Audit log & versions --------------------------------------------------------------------------------

export type AuditInput = {
  spaceId: string;
  itemId?: string | null;
  itemTitle?: string | null;
  action: KnowledgeAuditAction;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  versionNumber?: number | null;
};

/** Appends audit entries (same transaction as the change). `actorId` null = the system. */
export const insertAudit = async (sql: QuerySql, organizationId: string, actorId: string | null, entries: AuditInput[]) => {
  if (entries.length === 0) {
    return;
  }
  const payload = entries.map((entry) => ({
    spaceId: entry.spaceId,
    itemId: entry.itemId ?? null,
    itemTitle: entry.itemTitle ? entry.itemTitle.slice(0, 200) : null,
    action: entry.action,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ? entry.reason.slice(0, 500) : null,
    versionNumber: entry.versionNumber ?? null
  }));
  await sql`
    INSERT INTO knowledge.audit_log (organization_id, space_id, item_id, item_title, actor_user_id, action, before, after, reason, version_number)
    SELECT ${organizationId}, (e->>'spaceId')::uuid, (e->>'itemId')::uuid, e->>'itemTitle', ${actorId}, e->>'action',
      CASE WHEN jsonb_typeof(e->'before') = 'object' THEN e->'before' END,
      CASE WHEN jsonb_typeof(e->'after') = 'object' THEN e->'after' END,
      e->>'reason', (e->>'versionNumber')::int
    FROM jsonb_array_elements(${sql.json(payload as unknown as postgres.JSONValue)}) AS e
  `;
};

export const auditFor = (context: AccessContext) => (sql: QuerySql, entries: AuditInput[]) =>
  insertAudit(sql, context.organization.id, context.user.id, entries);

export type VersionInput = {
  spaceId: string;
  itemId: string;
  number: number;
  title: string;
  summary: string | null;
  body: RichTextDoc;
  bodyText: string;
  note: string | null;
  restoredFrom: number | null;
};

/** Every version records the images of its body: those files are never removed from storage while the item exists. */
export const insertVersion = async (sql: QuerySql, context: AccessContext, input: VersionInput) => {
  await sql`
    INSERT INTO knowledge.item_versions (
      organization_id, space_id, item_id, number, title, summary, body_json, body_text, note, author_user_id, restored_from,
      image_attachment_ids
    )
    VALUES (${context.organization.id}, ${input.spaceId}, ${input.itemId}, ${input.number}, ${input.title}, ${input.summary},
            ${sql.json(input.body)}, ${input.bodyText}, ${input.note}, ${context.user.id}, ${input.restoredFrom},
            ${bodyImageIds(input.body)}::uuid[])
  `;
};

/** Attachment ids of the image nodes of a stored body (unique, document order). */
export const bodyImageIds = (doc: RichTextDoc): string[] => {
  const ids = new Set<string>();
  const visit = (nodes: RichTextNode[] | undefined) => {
    for (const node of nodes ?? []) {
      const id = node.type === "image" ? node.attrs?.attachmentId : undefined;
      if (typeof id === "string") {
        ids.add(id);
      }
      visit(node.content);
    }
  };
  visit(doc.content);
  return [...ids];
};

/**
 * SQL predicate (alias `a` = knowledge.item_attachments): the file is an image of a version body of its item. Such
 * files stay in storage until the item is purged; deleting them only hides them from the attachment list.
 */
export const usedInVersionsSql = (sql: QuerySql) => sql`
  EXISTS (SELECT 1 FROM knowledge.item_versions uv WHERE uv.item_id = a.item_id AND a.id = ANY(uv.image_attachment_ids))
`;

export const imageInvalid = (message = "Ảnh trong nội dung phải là ảnh đã tải lên cho chính mục này (PNG, JPEG, GIF, WebP hoặc AVIF).") =>
  new AppError("KNOWLEDGE_IMAGE_INVALID", message, 400);

/**
 * Images of a body being saved: each must be a completed image file of this item (not a comment file). A file
 * hidden from the list still counts while a version uses it (it is kept in storage), so restoring an old version or
 * saving the current text after hiding the file works; a removed file does not.
 */
export const assertBodyImages = async (sql: QuerySql, itemId: string | null, images: string[]) => {
  if (images.length === 0) {
    return;
  }
  if (!itemId) {
    throw imageInvalid("Hãy lưu mục (bản nháp) trước khi chèn ảnh: ảnh được tải lên vào chính mục này.");
  }
  const rows = await sql<{ id: string }[]>`
    SELECT a.id FROM knowledge.item_attachments a
    WHERE a.item_id = ${itemId} AND a.id = ANY(${images}::uuid[]) AND a.status = 'ready' AND a.purpose = 'item'
      AND a.mime_type = ANY(${[...inlineImageTypes]}::text[])
      AND (a.deleted_at IS NULL OR ${usedInVersionsSql(sql)})
  `;
  if (rows.length !== new Set(images).size) {
    throw imageInvalid();
  }
};

export type AuditRow = {
  id: string;
  space_id: string;
  item_id: string | null;
  item_title: string | null;
  actor: UserRefJson | null;
  action: KnowledgeAuditAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  version_number: number | null;
  created_at: Date;
};

export const auditColumnsSql = (sql: QuerySql) => sql`
  l.id, l.space_id, l.item_id, l.item_title, l.action, l.before, l.after, l.reason, l.version_number, l.created_at,
  (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = l.actor_user_id) AS actor
`;

export const toAuditEntry = (row: AuditRow, options: { redactDeletedComments: boolean }): KnowledgeAuditEntry => {
  // The text of a deleted or edited comment stays in the log for space managers and org admins only (design §06).
  const redact = options.redactDeletedComments && (row.action === "COMMENT_DELETED" || row.action === "COMMENT_EDITED");
  const redactSide = (value: Record<string, unknown> | null) =>
    redact && value ? { commentId: value.commentId ?? null, ...(value.authorId !== undefined ? { authorId: value.authorId } : {}) } : value;
  return {
    id: row.id,
    spaceId: row.space_id,
    itemId: row.item_id,
    itemTitle: row.item_title,
    actor: toUserRef(row.actor),
    action: row.action,
    before: redactSide(row.before),
    after: row.action === "COMMENT_EDITED" ? redactSide(row.after) : row.after,
    reason: row.reason,
    versionNumber: row.version_number === null ? null : Number(row.version_number),
    createdAt: toIso(row.created_at)
  };
};

// Rich text -------------------------------------------------------------------------------------------

/**
 * Sanitizes rich text for a space: mention labels are the people's current names, and @mentions of people who
 * cannot read the space become plain text (no notification, nothing revealed) — like chat.
 */
export const sanitizeForSpace = async (
  sql: QuerySql,
  context: AccessContext,
  space: { spaceId: string; visibility: "public" | "private" },
  doc: unknown,
  limits: SanitizeLimits = descriptionLimits,
  profile: RichTextProfile = "default"
) => {
  try {
    const first = sanitizeRichText(doc, limits, { profile });
    if (first.mentions.length === 0) {
      return first;
    }
    const candidates = await loadReaderCandidates(sql, context.organization.id, space.spaceId, first.mentions);
    const readers = new Set(spaceReaders(candidates, space.visibility));
    const labels = await loadMentionLabels(sql, context.organization.id, first.mentions.filter((id) => readers.has(id)));
    return sanitizeRichText(first.doc, limits, { mentionLabels: labels, profile });
  } catch (error) {
    if (error instanceof RichTextError) {
      throw new AppError("INVALID_RICH_TEXT", error.message, 400);
    }
    throw error;
  }
};

/** Knowledge item body (create, update, version restore): the "knowledge" profile — tables and images (PD-031). */
export const sanitizeItemBody = async (
  sql: QuerySql,
  context: AccessContext,
  space: { spaceId: string; visibility: "public" | "private" },
  doc: unknown
) => {
  const result = await sanitizeForSpace(sql, context, space, doc, knowledgeBodyLimits, "knowledge");
  return { ...result, images: result.images ?? [] };
};

/** Stable JSON text (sorted keys) to compare documents. */
export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
};

// Realtime --------------------------------------------------------------------------------------------

/** Cache hint to everyone watching the space (after commit; never content). */
export const publishKnowledge = (
  spaceId: string,
  kind: KnowledgeChangedEvent["kind"],
  options: { itemId?: string | null; actorId?: string | null; version?: number | null } = {}
) => {
  publishToRoom({ type: "knowledge", id: spaceId }, "knowledge:changed", {
    spaceId,
    itemId: options.itemId ?? null,
    kind,
    actorId: options.actorId ?? null,
    version: options.version ?? null,
    at: new Date().toISOString()
  });
};

/**
 * Sidebar hint (space list changed): public spaces (or a visibility change) hint the whole organization; private
 * spaces their members, superadmins and explicitly affected people. Ids only.
 */
export const publishSpaceListHint = async (
  context: AccessContext,
  spaceId: string,
  kind: "space" | "members",
  options: { broadcast?: boolean; extraUserIds?: string[] } = {}
) => {
  const event: KnowledgeChangedEvent = { spaceId, itemId: null, kind, actorId: context.user.id, version: null, at: new Date().toISOString() };
  try {
    const sql = getSql();
    const space = (
      await sql<{ visibility: "public" | "private" }[]>`
        SELECT visibility FROM knowledge.spaces WHERE id = ${spaceId} AND organization_id = ${context.organization.id}
      `
    )[0];
    if (options.broadcast || space?.visibility === "public") {
      publishToRooms([orgRoom(context.organization.id)], "knowledge:changed", event);
      return;
    }
    const recipients = await sql<{ user_id: string }[]>`
      SELECT sm.user_id FROM knowledge.space_members sm WHERE sm.space_id = ${spaceId}
      UNION
      SELECT om.user_id FROM public.organization_memberships om
      JOIN public.roles r ON r.id = om.role_id AND r.organization_id = om.organization_id AND r.key = 'superadmin'
      WHERE om.organization_id = ${context.organization.id} AND om.status = 'active' AND om.deleted_at IS NULL
      LIMIT 5000
    `;
    publishToUsers([...recipients.map((row) => row.user_id), ...(options.extraUserIds ?? [])], "knowledge:changed", event);
  } catch (error) {
    logger.warn({ err: error, spaceId }, "Knowledge sidebar hint failed");
  }
};

export const accessLevelLabel: Record<KnowledgeAccessLevel, string> = { view: "Chỉ xem", submit: "Thành viên", manage: "Quản lý" };

export { toNullableIso };
