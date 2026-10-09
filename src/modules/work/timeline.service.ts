import { Permission } from "../../contracts/permissions.js";
import { commentLimits, RichTextError, sanitizeRichText, type RichTextDoc } from "../../contracts/rich-text.js";
import type { Comment, CreateCommentRequest, TimelineItem, TimelinePage } from "../../contracts/work.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { decodeCursor, encodeCursor, toIso, type QuerySql } from "../../lib/db-types.js";
import { logger } from "../../lib/logger.js";
import { inlineImageTypes, removeObjects } from "../../lib/storage.js";
import { publishToRoom } from "../../realtime/publisher.js";
import type { AccessContext } from "../access/access-context.js";
import { assertPermission, projectLevelAtLeast } from "../access/resource-access.js";
import { enqueueDomainEvents, type DomainEventInput } from "../events/outbox.js";
import { toActivity, toAttachment, toUserRef, type ActivityRow, type AttachmentRow, type UserRefJson } from "./mappers.js";
import { authorizeTask, mentionEvent } from "./tasks.service.js";
import { userJsonSql } from "./tasks.repo.js";

type CommentRow = {
  id: string;
  task_id: string;
  parent_comment_id: string | null;
  author: UserRefJson | null;
  author_user_id: string;
  body_json: RichTextDoc;
  body_text: string;
  mentioned_user_ids: string[];
  reply_count: number;
  attachments: AttachmentRow[] | null;
  created_at: Date;
  edited_at: Date | null;
};

const toComment = (row: CommentRow, context: AccessContext): Comment => ({
  id: row.id,
  taskId: row.task_id,
  parentCommentId: row.parent_comment_id,
  author: toUserRef(row.author),
  body: row.body_json,
  bodyText: row.body_text,
  mentionedUserIds: row.mentioned_user_ids,
  replyCount: Number(row.reply_count),
  attachments: (row.attachments ?? []).map((attachment) =>
    toAttachment({ ...attachment, created_at: new Date(attachment.created_at) }, (mime) => inlineImageTypes.has(mime))
  ),
  createdAt: toIso(row.created_at),
  editedAt: row.edited_at ? toIso(row.edited_at) : null,
  canEdit: row.author_user_id === context.user.id
});

const commentSelect = (sql: QuerySql) => sql`
  c.id, c.task_id, c.parent_comment_id, c.author_user_id, c.body_json, c.body_text, c.mentioned_user_ids, c.created_at, c.edited_at,
  (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = c.author_user_id) AS author,
  (
    SELECT count(*)::int FROM public.task_comments r
    WHERE r.organization_id = c.organization_id AND r.parent_comment_id = c.id AND r.deleted_at IS NULL
  ) AS reply_count,
  (
    SELECT json_agg(json_build_object(
      'id', a.id, 'task_id', a.task_id, 'comment_id', a.comment_id, 'file_name', a.file_name, 'mime_type', a.mime_type,
      'size_bytes', a.size_bytes, 'created_at', a.created_at,
      'uploaded_by', (SELECT ${userJsonSql(sql, "uau")} FROM public.app_users uau WHERE uau.id = a.uploaded_by)
    ) ORDER BY a.created_at, a.id)
    FROM public.task_attachments a
    WHERE a.organization_id = c.organization_id AND a.comment_id = c.id AND a.status = 'ready' AND a.deleted_at IS NULL
  ) AS attachments
`;

const sanitizeComment = (doc: unknown) => {
  try {
    const result = sanitizeRichText(doc, commentLimits);
    if (result.text.length === 0) {
      throw new AppError("COMMENT_EMPTY", "Comment cannot be empty.", 400);
    }
    return result;
  } catch (error) {
    if (error instanceof RichTextError) {
      throw new AppError("INVALID_RICH_TEXT", error.message, 400);
    }
    throw error;
  }
};

/**
 * Unified task timeline (spec §25-26): comments and structured activity stay separate in storage
 * and are merged here, newest first, with one keyset cursor over (created_at, id).
 */
export const getTimeline = async (
  context: AccessContext,
  taskId: string,
  input: { cursor?: string | undefined; limit: number }
): Promise<TimelinePage> => {
  const sql = getSql();
  await authorizeTask(sql, context, taskId, "view");
  const cursor = decodeCursor(input.cursor, 2);
  if (input.cursor && !cursor) {
    throw new AppError("INVALID_CURSOR", "The pagination cursor is invalid.", 400);
  }
  const before = cursor
    ? sql`AND (x.created_at, x.id) < (${String(cursor[0])}::timestamptz, ${String(cursor[1])}::uuid)`
    : sql``;
  const limit = input.limit;

  const [comments, activity] = await Promise.all([
    sql<CommentRow[]>`
      SELECT ${commentSelect(sql)}
      FROM public.task_comments c
      CROSS JOIN LATERAL (SELECT c.created_at, c.id) x
      WHERE c.organization_id = ${context.organization.id} AND c.task_id = ${taskId}
        AND c.parent_comment_id IS NULL AND c.deleted_at IS NULL ${before}
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ${limit + 1}
    `,
    sql<ActivityRow[]>`
      SELECT e.id, e.task_id, e.action, e.previous_value, e.new_value, e.created_at,
        (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = e.actor_user_id) AS actor
      FROM public.task_activity_events e
      CROSS JOIN LATERAL (SELECT e.created_at, e.id) x
      WHERE e.organization_id = ${context.organization.id} AND e.task_id = ${taskId}
        AND e.action NOT LIKE 'COMMENT_%' ${before}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ${limit + 1}
    `
  ]);

  const merged: { at: Date; id: string; item: TimelineItem }[] = [
    ...comments.map((row) => ({ at: row.created_at, id: row.id, item: { kind: "comment" as const, comment: toComment(row, context) } })),
    ...activity.map((row) => ({ at: row.created_at, id: row.id, item: { kind: "activity" as const, activity: toActivity(row) } }))
  ].sort((a, b) => b.at.getTime() - a.at.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));

  const page = merged.slice(0, limit);
  const last = page[page.length - 1];
  const hasMore = merged.length > limit;
  return {
    items: page.map((entry) => entry.item),
    pageInfo: { hasMore, nextCursor: hasMore && last ? encodeCursor([last.at.toISOString(), last.id]) : null }
  };
};

export const listReplies = async (context: AccessContext, taskId: string, commentId: string) => {
  const sql = getSql();
  await authorizeTask(sql, context, taskId, "view");
  const rows = await sql<CommentRow[]>`
    SELECT ${commentSelect(sql)}
    FROM public.task_comments c
    WHERE c.organization_id = ${context.organization.id} AND c.task_id = ${taskId}
      AND c.parent_comment_id = ${commentId} AND c.deleted_at IS NULL
    ORDER BY c.created_at, c.id
    LIMIT 200
  `;
  return { items: rows.map((row) => toComment(row, context)), pageInfo: { hasMore: rows.length === 200, nextCursor: null } };
};

const loadComment = async (sql: QuerySql, context: AccessContext, taskId: string, commentId: string) => {
  const row = (
    await sql<CommentRow[]>`
      SELECT ${commentSelect(sql)} FROM public.task_comments c
      WHERE c.id = ${commentId} AND c.organization_id = ${context.organization.id} AND c.task_id = ${taskId} AND c.deleted_at IS NULL
    `
  )[0];
  if (!row) {
    throw new AppError("COMMENT_NOT_FOUND", "Comment was not found.", 404);
  }
  return row;
};

const publishTimeline = (projectId: string, taskId: string, actorId: string) => {
  const at = new Date().toISOString();
  publishToRoom({ type: "task", id: taskId }, "task:timeline", { projectId, taskId, actorId, at });
};

export const createComment = async (context: AccessContext, taskId: string, input: CreateCommentRequest): Promise<Comment> => {
  assertPermission(context, Permission.TaskComment);
  const body = sanitizeComment(input.body);
  const sql = getSql();

  const result = await sql.begin(async (tx) => {
    const { task } = await authorizeTask(tx, context, taskId, "submit");
    let parentAuthorId: string | null = null;
    if (input.parentCommentId) {
      const parent = await loadComment(tx, context, taskId, input.parentCommentId);
      if (parent.parent_comment_id) {
        throw new AppError("COMMENT_REPLY_DEPTH", "Replies can only be added to top-level comments.", 409);
      }
      parentAuthorId = parent.author_user_id;
    }

    const mention = body.mentions.length > 0
      ? await mentionEvent(tx, context, task.project_id, taskId, task.title, body.mentions, "comment")
      : null;
    const mentionedIds = mention ? (mention.payload.userIds as string[]) : [];

    const created = (
      await tx<{ id: string }[]>`
        INSERT INTO public.task_comments (organization_id, task_id, author_user_id, parent_comment_id, body_json, body_text, mentioned_user_ids)
        VALUES (${context.organization.id}, ${taskId}, ${context.user.id}, ${input.parentCommentId ?? null},
                ${tx.json(body.doc)}, ${body.text}, ${mentionedIds}::uuid[])
        RETURNING id
      `
    )[0]!;

    if (input.attachmentIds.length > 0) {
      const attached = await tx<{ id: string }[]>`
        UPDATE public.task_attachments SET comment_id = ${created.id}
        WHERE organization_id = ${context.organization.id} AND task_id = ${taskId}
          AND id = ANY(${input.attachmentIds}::uuid[]) AND uploaded_by = ${context.user.id}
          AND comment_id IS NULL AND status = 'ready' AND deleted_at IS NULL
        RETURNING id
      `;
      if (attached.length !== new Set(input.attachmentIds).size) {
        throw new AppError("ATTACHMENT_NOT_FOUND", "One or more attachments are missing or not uploaded yet.", 409);
      }
    }

    const events: DomainEventInput[] = [
      {
        organizationId: context.organization.id,
        type: "task.comment.created",
        aggregateType: "task",
        aggregateId: taskId,
        actorUserId: context.user.id,
        payload: {
          projectId: task.project_id,
          title: task.title,
          commentId: created.id,
          parentCommentId: input.parentCommentId ?? null,
          parentAuthorId,
          mentionedUserIds: mentionedIds,
          excerpt: body.text.slice(0, 280)
        }
      }
    ];
    if (mention && mentionedIds.length > 0) {
      mention.payload.commentId = created.id;
      events.push(mention);
    }
    await enqueueDomainEvents(tx, events);
    return {
      projectId: task.project_id,
      listId: task.list_id,
      parentTaskId: task.parent_task_id,
      comment: toComment(await loadComment(tx, context, taskId, created.id), context)
    };
  });

  publishTimeline(result.projectId, taskId, context.user.id);
  publishToRoom({ type: "project", id: result.projectId }, "task:changed", {
    projectId: result.projectId,
    listId: result.listId,
    taskId,
    parentTaskId: result.parentTaskId,
    kind: "updated",
    actorId: context.user.id,
    at: new Date().toISOString()
  });
  return result.comment;
};

export const updateComment = async (context: AccessContext, taskId: string, commentId: string, doc: unknown): Promise<Comment> => {
  assertPermission(context, Permission.TaskComment);
  const body = sanitizeComment(doc);
  const sql = getSql();
  const result = await sql.begin(async (tx) => {
    // Editing can add mentions (notifications): same bar as commenting.
    const { task } = await authorizeTask(tx, context, taskId, "submit");
    const comment = await loadComment(tx, context, taskId, commentId);
    if (comment.author_user_id !== context.user.id) {
      throw new AppError("FORBIDDEN", "Only the author can edit this comment.", 403);
    }
    const mention = body.mentions.length > 0
      ? await mentionEvent(tx, context, task.project_id, taskId, task.title, body.mentions, "comment", commentId)
      : null;
    const mentionedIds = mention ? (mention.payload.userIds as string[]) : [];
    const newlyMentioned = mentionedIds.filter((id) => !comment.mentioned_user_ids.includes(id));
    await tx`
      UPDATE public.task_comments
      SET body_json = ${tx.json(body.doc)}, body_text = ${body.text},
          mentioned_user_ids = ${mentionedIds}::uuid[], edited_at = now()
      WHERE id = ${commentId} AND organization_id = ${context.organization.id}
    `;
    if (mention && newlyMentioned.length > 0) {
      mention.payload.userIds = newlyMentioned;
      await enqueueDomainEvents(tx, [mention]);
    }
    return { projectId: task.project_id, comment: toComment(await loadComment(tx, context, taskId, commentId), context) };
  });
  publishTimeline(result.projectId, taskId, context.user.id);
  return result.comment;
};

export const deleteComment = async (context: AccessContext, taskId: string, commentId: string) => {
  const sql = getSql();
  const result = await sql.begin(async (tx) => {
    const { task, access } = await authorizeTask(tx, context, taskId, "view");
    const comment = await loadComment(tx, context, taskId, commentId);
    const isAuthor = comment.author_user_id === context.user.id;
    if (!(isAuthor && projectLevelAtLeast(access.level, "submit")) && !projectLevelAtLeast(access.level, "manage")) {
      throw new AppError("FORBIDDEN", "You cannot delete this comment.", 403);
    }
    const removed = await tx<{ id: string }[]>`
      UPDATE public.task_comments SET deleted_at = now(), deleted_by = ${context.user.id}
      WHERE organization_id = ${context.organization.id} AND (id = ${commentId} OR parent_comment_id = ${commentId}) AND deleted_at IS NULL
      RETURNING id
    `;
    // Files of deleted comments stop being downloadable and their objects are removed.
    const files = await tx<{ storage_path: string }[]>`
      UPDATE public.task_attachments SET deleted_at = now(), deleted_by = ${context.user.id}
      WHERE organization_id = ${context.organization.id} AND comment_id = ANY(${removed.map((row) => row.id)}::uuid[]) AND deleted_at IS NULL
      RETURNING storage_path
    `;
    return { projectId: task.project_id, paths: files.map((file) => file.storage_path) };
  });
  if (result.paths.length > 0) {
    removeObjects(result.paths).catch((error: unknown) => logger.warn({ err: error, commentId }, "Comment attachment cleanup failed"));
  }
  const projectId = result.projectId;
  publishTimeline(projectId, taskId, context.user.id);
  return { ok: true as const };
};
