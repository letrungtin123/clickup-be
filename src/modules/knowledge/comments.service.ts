import type { z } from "zod";

import type { CreateKnowledgeCommentRequestSchema, KnowledgeAccessLevel, KnowledgeComment } from "../../contracts/knowledge.js";
import { Permission } from "../../contracts/permissions.js";
import { commentLimits, type RichTextDoc } from "../../contracts/rich-text.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { decodeTimeCursor, encodeTimeCursor, timestampParamSql, timestampTextSql, toIso, type QuerySql } from "../../lib/db-types.js";
import { logger } from "../../lib/logger.js";
import { removeObjects } from "../../lib/storage.js";
import type { AccessContext } from "../access/access-context.js";
import { enqueueDomainEvents } from "../events/outbox.js";
import { knowledgeCommentEvents } from "./events.js";
import { toUserRef, type UserRefJson } from "../work/mappers.js";
import { authorizeItem, forbidden, requireKnowledgePermission, type ItemCore, type SpaceAccess } from "./access.js";
import {
  attachmentsJsonSql,
  auditFor,
  publishKnowledge,
  sanitizeForSpace,
  toKnowledgeAttachment,
  userJsonSql,
  type AttachmentRow
} from "./repo.js";
import { levelAtLeast, newlyMentioned } from "./rules.js";

type CommentRow = {
  id: string;
  item_id: string;
  parent_comment_id: string | null;
  author: UserRefJson | null;
  author_user_id: string;
  body_json: RichTextDoc;
  body_text: string;
  mentioned_user_ids: string[];
  reply_count: number;
  resolved_at: Date | null;
  resolved_by: UserRefJson | null;
  attachments: AttachmentRow[];
  created_at: Date;
  edited_at: Date | null;
};

const commentSelect = (sql: QuerySql) => sql`
  c.id, c.item_id, c.parent_comment_id, c.author_user_id, c.body_json, c.body_text, c.mentioned_user_ids,
  c.resolved_at, c.created_at, c.edited_at,
  (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = c.author_user_id) AS author,
  (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = c.resolved_by) AS resolved_by,
  (SELECT count(*)::int FROM knowledge.comments r WHERE r.parent_comment_id = c.id AND r.item_id = c.item_id AND r.deleted_at IS NULL) AS reply_count,
  ${attachmentsJsonSql(sql, sql`a.item_id = c.item_id AND a.comment_id = c.id`)} AS attachments
`;

/** "Đã xử lý": top-level comments, by members who edit (submit+), the item's owner or the comment's author. */
export const canResolveComment = (input: {
  isRoot: boolean;
  level: KnowledgeAccessLevel;
  userId: string;
  authorId: string;
  ownerId: string | null;
}) => input.isRoot && (levelAtLeast(input.level, "submit") || input.userId === input.authorId || input.userId === input.ownerId);

const toComment = (row: CommentRow, context: AccessContext, access: SpaceAccess, item: ItemCore): KnowledgeComment => {
  const isAuthor = row.author_user_id === context.user.id;
  // Trashed items and archived spaces are read-only: no edit, delete, resolve or file removal.
  const live = item.deleted_at === null && !access.archived;
  return {
    id: row.id,
    itemId: row.item_id,
    parentCommentId: row.parent_comment_id,
    author: toUserRef(row.author),
    body: row.body_json,
    bodyText: row.body_text,
    mentionedUserIds: row.mentioned_user_ids,
    replyCount: Number(row.reply_count),
    resolvedAt: row.resolved_at ? toIso(row.resolved_at) : null,
    resolvedBy: toUserRef(row.resolved_by),
    attachments: (row.attachments ?? []).map((attachment) =>
      toKnowledgeAttachment(attachment, live && (attachment.uploaded_by?.id === context.user.id || access.level === "manage"))
    ),
    createdAt: toIso(row.created_at),
    editedAt: row.edited_at ? toIso(row.edited_at) : null,
    canEdit: live && isAuthor,
    canDelete: live && (isAuthor || access.level === "manage"),
    canResolve:
      live &&
      canResolveComment({
        isRoot: row.parent_comment_id === null,
        level: access.level,
        userId: context.user.id,
        authorId: row.author_user_id,
        ownerId: item.owner_user_id
      })
  };
};

const loadComment = async (sql: QuerySql, itemId: string, commentId: string) => {
  const row = (
    await sql<CommentRow[]>`
      SELECT ${commentSelect(sql)} FROM knowledge.comments c
      WHERE c.id = ${commentId} AND c.item_id = ${itemId} AND c.deleted_at IS NULL
    `
  )[0];
  if (!row) {
    throw new AppError("KNOWLEDGE_COMMENT_NOT_FOUND", "Không tìm thấy bình luận.", 404);
  }
  return row;
};

const sanitizeComment = async (sql: QuerySql, context: AccessContext, access: SpaceAccess, doc: unknown) => {
  const body = await sanitizeForSpace(sql, context, access, doc, commentLimits);
  if (body.text.length === 0) {
    throw new AppError("COMMENT_EMPTY", "Bình luận không được để trống.", 400);
  }
  return body;
};

/**
 * Comments per person per minute (KB-SEC-03). Every reader of a public space comments and @mentions (up to 50
 * people per comment, mentions are e-mailed): without a quota the only bound was the global API limiter
 * (hundreds of requests a minute), enough to flood colleagues' inboxes.
 */
export const knowledgeCommentQuota = { perMinute: 20 } as const;

export const assertCommentQuota = async (sql: QuerySql, userId: string) => {
  const rows = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM knowledge.comments
    WHERE author_user_id = ${userId} AND created_at > now() - interval '1 minute'
  `;
  if (Number(rows[0]?.count ?? 0) >= knowledgeCommentQuota.perMinute) {
    throw new AppError("KNOWLEDGE_RATE_LIMITED", "Bạn đang bình luận quá nhanh. Thử lại sau một phút.", 429);
  }
};

/** Top-level comments, newest first (replies: listReplies). */
export const listComments = async (context: AccessContext, itemId: string, query: { cursor?: string | undefined; limit: number }) => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  const sql = getSql();
  const { item, access } = await authorizeItem(sql, context, itemId, { trashed: "include", intent: "read" });
  const cursor = decodeTimeCursor(query.cursor);
  const rows = await sql<(CommentRow & { cursor_at: string })[]>`
    SELECT ${commentSelect(sql)}, ${timestampTextSql(sql, () => sql`c.created_at`)} AS cursor_at
    FROM knowledge.comments c
    WHERE c.item_id = ${itemId} AND c.parent_comment_id IS NULL AND c.deleted_at IS NULL
      ${cursor ? sql`AND (c.created_at, c.id) < (${timestampParamSql(sql, cursor.at)}, ${cursor.id}::uuid)` : sql``}
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT ${query.limit + 1}
  `;
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  const hasMore = rows.length > query.limit;
  return {
    items: page.map((row) => toComment(row, context, access, item)),
    pageInfo: { hasMore, nextCursor: hasMore && last ? encodeTimeCursor(last.cursor_at, last.id) : null }
  };
};

/** Replies of a top-level comment, oldest first (at most 500). */
export const listReplies = async (context: AccessContext, itemId: string, commentId: string) => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  const sql = getSql();
  const { item, access } = await authorizeItem(sql, context, itemId, { trashed: "include", intent: "read" });
  const rows = await sql<CommentRow[]>`
    SELECT ${commentSelect(sql)} FROM knowledge.comments c
    WHERE c.item_id = ${itemId} AND c.parent_comment_id = ${commentId} AND c.deleted_at IS NULL
    ORDER BY c.created_at, c.id
    LIMIT 500
  `;
  return { items: rows.map((row) => toComment(row, context, access, item)), pageInfo: { hasMore: rows.length === 500, nextCursor: null } };
};

export const createComment = async (
  context: AccessContext,
  itemId: string,
  input: z.infer<typeof CreateKnowledgeCommentRequestSchema>
): Promise<KnowledgeComment> => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  const sql = getSql();
  const result = await sql.begin(async (tx) => {
    // Everyone who reads the item may comment (public spaces: readers too).
    const { item, access } = await authorizeItem(tx, context, itemId);
    await assertCommentQuota(tx, context.user.id);
    let parentAuthorId: string | null = null;
    if (input.parentCommentId) {
      const parent = await loadComment(tx, itemId, input.parentCommentId);
      if (parent.parent_comment_id) {
        throw new AppError("COMMENT_REPLY_DEPTH", "Chỉ trả lời được bình luận gốc.", 409);
      }
      parentAuthorId = parent.author_user_id;
    }
    const body = await sanitizeComment(tx, context, access, input.body);
    const created = (
      await tx<{ id: string }[]>`
        INSERT INTO knowledge.comments (organization_id, space_id, item_id, parent_comment_id, author_user_id, body_json, body_text, mentioned_user_ids)
        VALUES (${context.organization.id}, ${item.space_id}, ${itemId}, ${input.parentCommentId ?? null}, ${context.user.id},
                ${tx.json(body.doc)}, ${body.text}, ${body.mentions}::uuid[])
        RETURNING id
      `
    )[0]!;
    if (input.attachmentIds.length > 0) {
      const attached = await tx<{ id: string }[]>`
        UPDATE knowledge.item_attachments SET comment_id = ${created.id}
        WHERE item_id = ${itemId} AND id = ANY(${input.attachmentIds}::uuid[]) AND uploaded_by = ${context.user.id}
          AND purpose = 'comment' AND comment_id IS NULL AND status = 'ready' AND deleted_at IS NULL
        RETURNING id
      `;
      if (attached.length !== new Set(input.attachmentIds).size) {
        throw new AppError("ATTACHMENT_NOT_FOUND", "Một số tệp đính kèm chưa tải lên xong hoặc không còn.", 409);
      }
    }
    // Commenters follow the item (design §07).
    await tx`
      INSERT INTO knowledge.followers (organization_id, space_id, item_id, user_id)
      VALUES (${context.organization.id}, ${item.space_id}, ${itemId}, ${context.user.id})
      ON CONFLICT (item_id, user_id) DO NOTHING
    `;
    await enqueueDomainEvents(tx, [
      {
        organizationId: context.organization.id,
        type: knowledgeCommentEvents.created,
        aggregateType: "knowledge_item",
        aggregateId: itemId,
        actorUserId: context.user.id,
        payload: {
          spaceId: item.space_id,
          itemId,
          commentId: created.id,
          parentCommentId: input.parentCommentId ?? null,
          parentAuthorId,
          mentionedUserIds: body.mentions.filter((id) => id !== context.user.id),
          excerpt: body.text.slice(0, 280)
        }
      }
    ]);
    return { spaceId: item.space_id, comment: toComment(await loadComment(tx, itemId, created.id), context, access, item) };
  });
  publishKnowledge(result.spaceId, "comment", { itemId, actorId: context.user.id });
  return result.comment;
};

export const updateComment = async (context: AccessContext, itemId: string, commentId: string, doc: unknown): Promise<KnowledgeComment> => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  const sql = getSql();
  const result = await sql.begin(async (tx) => {
    const { item, access } = await authorizeItem(tx, context, itemId);
    const comment = await loadComment(tx, itemId, commentId);
    if (comment.author_user_id !== context.user.id) {
      throw forbidden("Chỉ người viết mới sửa được bình luận này.");
    }
    const body = await sanitizeComment(tx, context, access, doc);
    await tx`
      UPDATE knowledge.comments
      SET body_json = ${tx.json(body.doc)}, body_text = ${body.text},
          mentioned_user_ids = ${body.mentions}::uuid[], edited_at = now()
      WHERE id = ${commentId} AND item_id = ${itemId}
    `;
    // Edits leave a trace (PD-031: every change is logged): old and new text, visible to managers and org admins.
    await auditFor(context)(tx, [
      {
        spaceId: item.space_id,
        itemId,
        itemTitle: item.title,
        action: "COMMENT_EDITED",
        before: { commentId, text: comment.body_text.slice(0, 5000) },
        after: { commentId, text: body.text.slice(0, 5000) }
      }
    ]);
    await enqueueDomainEvents(tx, [
      {
        organizationId: context.organization.id,
        type: knowledgeCommentEvents.updated,
        aggregateType: "knowledge_item",
        aggregateId: itemId,
        actorUserId: context.user.id,
        payload: {
          spaceId: item.space_id,
          itemId,
          commentId,
          addedMentionUserIds: newlyMentioned(body.mentions, comment.mentioned_user_ids).filter((id) => id !== context.user.id),
          excerpt: body.text.slice(0, 280)
        }
      }
    ]);
    return { spaceId: item.space_id, comment: toComment(await loadComment(tx, itemId, commentId), context, access, item) };
  });
  publishKnowledge(result.spaceId, "comment", { itemId, actorId: context.user.id });
  return result.comment;
};

/**
 * Authors delete their own comment; space managers delete anyone's (moderation). A top-level comment takes its
 * replies along — only when they are all the caller's own, or the caller manages the space. The text stays in the
 * audit log (visible to managers and org admins only).
 */
export const deleteComment = async (context: AccessContext, itemId: string, commentId: string) => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  const sql = getSql();
  const result = await sql.begin(async (tx) => {
    const { item, access } = await authorizeItem(tx, context, itemId);
    const comment = await loadComment(tx, itemId, commentId);
    const isAuthor = comment.author_user_id === context.user.id;
    const moderates = access.level === "manage";
    if (!isAuthor && !moderates) {
      throw forbidden("Bạn chỉ xoá được bình luận của mình.");
    }
    if (!moderates) {
      const others = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM knowledge.comments
        WHERE item_id = ${itemId} AND parent_comment_id = ${commentId} AND deleted_at IS NULL AND author_user_id <> ${context.user.id}
      `;
      if ((others[0]?.n ?? 0) > 0) {
        throw new AppError("COMMENT_HAS_OTHER_REPLIES", "Bình luận này có trả lời của người khác; chỉ Quản lý kho mới xoá được cả chuỗi.", 409);
      }
    }
    const removed = await tx<{ id: string }[]>`
      UPDATE knowledge.comments SET deleted_at = now(), deleted_by = ${context.user.id}
      WHERE item_id = ${itemId} AND (id = ${commentId} OR parent_comment_id = ${commentId}) AND deleted_at IS NULL
      RETURNING id
    `;
    const removedIds = removed.map((row) => row.id);
    const files = await tx<{ storage_path: string }[]>`
      UPDATE knowledge.item_attachments SET deleted_at = now(), deleted_by = ${context.user.id}
      WHERE item_id = ${itemId} AND comment_id = ANY(${removedIds}::uuid[]) AND deleted_at IS NULL
      RETURNING storage_path
    `;
    const authorName = comment.author?.display_name ?? null;
    await auditFor(context)(tx, [
      {
        spaceId: item.space_id,
        itemId,
        itemTitle: item.title,
        action: "COMMENT_DELETED",
        before: {
          commentId,
          authorId: comment.author_user_id,
          authorName,
          text: comment.body_text.slice(0, 5000),
          replies: removedIds.length - 1,
          moderated: !isAuthor
        }
      }
    ]);
    await enqueueDomainEvents(tx, [
      {
        organizationId: context.organization.id,
        type: knowledgeCommentEvents.deleted,
        aggregateType: "knowledge_item",
        aggregateId: itemId,
        actorUserId: context.user.id,
        payload: { spaceId: item.space_id, itemId, commentIds: removedIds }
      }
    ]);
    return { spaceId: item.space_id, paths: files.map((file) => file.storage_path) };
  });
  if (result.paths.length > 0) {
    removeObjects(result.paths).catch((error: unknown) => logger.warn({ err: error, commentId }, "Knowledge comment file cleanup failed"));
  }
  publishKnowledge(result.spaceId, "comment", { itemId, actorId: context.user.id });
  return { ok: true as const };
};

export const resolveComment = async (context: AccessContext, itemId: string, commentId: string, resolved: boolean): Promise<KnowledgeComment> => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  const sql = getSql();
  const result = await sql.begin(async (tx) => {
    const { item, access } = await authorizeItem(tx, context, itemId);
    const comment = await loadComment(tx, itemId, commentId);
    if (comment.parent_comment_id) {
      throw new AppError("KNOWLEDGE_COMMENT_NOT_ROOT", "Chỉ bình luận gốc mới đánh dấu Đã xử lý được.", 400);
    }
    if (
      !canResolveComment({
        isRoot: true,
        level: access.level,
        userId: context.user.id,
        authorId: comment.author_user_id,
        ownerId: item.owner_user_id
      })
    ) {
      throw forbidden("Chỉ thành viên kho, người phụ trách mục hoặc người viết mới đánh dấu được bình luận.");
    }
    if ((comment.resolved_at !== null) !== resolved) {
      await tx`
        UPDATE knowledge.comments
        SET resolved_at = ${resolved ? tx`now()` : null}, resolved_by = ${resolved ? context.user.id : null}
        WHERE id = ${commentId} AND item_id = ${itemId}
      `;
      await auditFor(context)(tx, [
        { spaceId: item.space_id, itemId, itemTitle: item.title, action: "COMMENT_RESOLVED", after: { commentId, resolved } }
      ]);
    }
    return { spaceId: item.space_id, comment: toComment(await loadComment(tx, itemId, commentId), context, access, item) };
  });
  publishKnowledge(result.spaceId, "comment", { itemId, actorId: context.user.id });
  return result.comment;
};
