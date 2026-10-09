import { randomUUID } from "node:crypto";

import type {
  ChatMentionsQuery,
  ChatMessage,
  ChatSearchHit,
  ChatSearchPage,
  ChatSearchQuery,
  MessageHistory,
  MessageHistoryQuery,
  ReactionResult,
  ReadState,
  SendMessageRequest,
  ThreadPage,
  ThreadQuery,
  ThreadRootSummary
} from "../../contracts/chat.js";
import { chatLimits } from "../../contracts/chat.js";
import { Permission } from "../../contracts/permissions.js";
import { messageLimits, RichTextError } from "../../contracts/rich-text.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import {
  decodeTimeCursor,
  encodeTimeCursor,
  timestampParamSql,
  timestampTextSql,
  toIso,
  toNullableIso,
  toPrefixTsQuery,
  type QuerySql
} from "../../lib/db-types.js";
import { logger } from "../../lib/logger.js";
import { sanitizeWithMentionLabels } from "../../lib/mentions.js";
import { removeObjects } from "../../lib/storage.js";
import { publishToRoom, publishToUsers } from "../../realtime/publisher.js";
import type { AccessContext } from "../access/access-context.js";
import { hasPermission } from "../access/resource-access.js";
import { enqueueDomainEvents } from "../events/outbox.js";
import {
  assertCanPost,
  assertNotArchived,
  loadChannel,
  requireChannel,
  requireReadableChannel,
  type ResolvedChannel
} from "./chat-access.js";
import { toUserRef, unreadCountSql, userJsonSql, type UserRefJson } from "./chat-mappers.js";
import { assertChatAttachmentsEnabled } from "./chat-settings.js";
import { consumeChatQuota } from "./chat-rate-limit.js";
import {
  findInvalidMentions,
  hasMessageContent,
  mentionRecipients,
  mentionScope,
  resolveHistoryWindow,
  toSeq,
  unreadCount,
  uniqueIds
} from "./chat-rules.js";
import { channelRoom, isUniqueViolation, selectMessageById, selectMessages } from "./chat.repo.js";

const messageNotFound = () => new AppError("CHAT_MESSAGE_NOT_FOUND", "Message was not found.", 404);

/** Sanitized body; mention labels are the people's current display names (SEC-API-10 / WK-44). */
const sanitizeBody = async (sql: QuerySql, context: AccessContext, body: unknown) => {
  try {
    return await sanitizeWithMentionLabels(sql, context.organization.id, body, messageLimits);
  } catch (error) {
    if (error instanceof RichTextError) {
      throw new AppError("INVALID_RICH_TEXT", error.message, 400);
    }
    throw error;
  }
};

/** Validates mentions against the channel's mention scope (see mentionScope). */
const validateMentions = async (tx: QuerySql, context: AccessContext, resolved: ResolvedChannel, mentionIds: string[]) => {
  const ids = uniqueIds(mentionIds);
  if (ids.length === 0) {
    return ids;
  }
  const eligible =
    mentionScope(resolved.channel.kind) === "organization"
      ? await tx<{ user_id: string }[]>`
          SELECT user_id FROM public.organization_memberships
          WHERE organization_id = ${context.organization.id} AND user_id = ANY(${ids}::uuid[])
            AND status = 'active' AND deleted_at IS NULL
        `
      : await tx<{ user_id: string }[]>`
          SELECT user_id FROM public.channel_members
          WHERE organization_id = ${context.organization.id} AND channel_id = ${resolved.channel.id}
            AND user_id = ANY(${ids}::uuid[]) AND deleted_at IS NULL
        `;
  if (findInvalidMentions(ids, eligible.map((row) => row.user_id)).length > 0) {
    throw new AppError("CHAT_MENTION_INVALID", "You can only mention people who can see this conversation.", 400);
  }
  return ids;
};

const insertMentions = async (
  tx: QuerySql,
  context: AccessContext,
  input: { messageId: string; channelId: string; seq: number | null; threadRootId: string | null; userIds: string[] }
) => {
  if (input.userIds.length === 0) {
    return;
  }
  await tx`
    INSERT INTO public.message_mentions (organization_id, message_id, channel_id, user_id, seq, thread_root_id)
    SELECT ${context.organization.id}::uuid, ${input.messageId}::uuid, ${input.channelId}::uuid, u.user_id,
           ${input.seq}::bigint, ${input.threadRootId}::uuid
    FROM unnest(${input.userIds}::uuid[]) AS u(user_id)
    ON CONFLICT DO NOTHING
  `;
};

// History ----------------------------------------------------------------------------------------

export const getMessageHistory = async (context: AccessContext, channelId: string, query: MessageHistoryQuery): Promise<MessageHistory> => {
  const sql = getSql();
  const resolved = await requireReadableChannel(sql, context, channelId);
  const lastSeq = toSeq(resolved.channel.last_message_seq);
  const window = resolveHistoryWindow(query);
  const topLevel = sql`m.channel_id = ${channelId} AND m.seq IS NOT NULL`;

  const older = (beforeSeq: number | null, limit: number) =>
    selectMessages(
      sql,
      context,
      beforeSeq === null ? topLevel : sql`${topLevel} AND m.seq < ${beforeSeq}`,
      sql`m.seq DESC`,
      limit + 1
    );
  const newer = (fromSeq: number, inclusive: boolean, limit: number) =>
    selectMessages(sql, context, inclusive ? sql`${topLevel} AND m.seq >= ${fromSeq}` : sql`${topLevel} AND m.seq > ${fromSeq}`, sql`m.seq ASC`, limit + 1);

  let items: ChatMessage[];
  let hasOlder: boolean;
  let hasNewer: boolean;

  switch (window.mode) {
    case "latest":
    case "before": {
      const rows = await older(window.mode === "before" ? window.seq : null, window.limit);
      hasOlder = rows.length > window.limit;
      items = rows.slice(0, window.limit).reverse();
      hasNewer = window.mode === "before" ? window.seq <= lastSeq : false;
      break;
    }
    case "after": {
      const rows = await newer(window.seq, false, window.limit);
      hasNewer = rows.length > window.limit;
      items = rows.slice(0, window.limit);
      hasOlder = Math.min(window.seq, lastSeq) >= 1;
      break;
    }
    case "around": {
      const anchor = (
        await sql<{ seq: string | null; root_seq: string | null }[]>`
          SELECT m.seq, root.seq AS root_seq
          FROM public.messages m
          LEFT JOIN public.messages root ON root.organization_id = m.organization_id AND root.id = m.thread_root_id
          WHERE m.organization_id = ${context.organization.id} AND m.id = ${window.messageId} AND m.channel_id = ${channelId}
        `
      )[0];
      const anchorSeq = anchor ? (anchor.seq ?? anchor.root_seq) : null;
      if (anchorSeq === null || anchorSeq === undefined) {
        throw messageNotFound();
      }
      const seq = toSeq(anchorSeq);
      const [olderRows, newerRows] = await Promise.all([older(seq, window.olderLimit), newer(seq, true, window.newerLimit)]);
      hasOlder = olderRows.length > window.olderLimit;
      hasNewer = newerRows.length > window.newerLimit;
      items = [...olderRows.slice(0, window.olderLimit).reverse(), ...newerRows.slice(0, window.newerLimit)];
      break;
    }
  }

  return { items, hasOlder, hasNewer, lastReadSeq: resolved.member?.lastReadSeq ?? null };
};

// Send -------------------------------------------------------------------------------------------

type ExistingByClientId = { id: string; channel_id: string };

const findByClientMessageId = async (sql: QuerySql, context: AccessContext, clientMessageId: string) =>
  (
    await sql<ExistingByClientId[]>`
      SELECT id, channel_id FROM public.messages
      WHERE organization_id = ${context.organization.id}
        AND author_user_id = ${context.user.id}
        AND client_message_id = ${clientMessageId}
      LIMIT 1
    `
  )[0];

const replayExisting = async (context: AccessContext, channelId: string, existing: ExistingByClientId) => {
  if (existing.channel_id !== channelId) {
    throw new AppError("CHAT_CLIENT_ID_CONFLICT", "This clientMessageId was already used for another conversation.", 409);
  }
  const sql = getSql();
  await requireReadableChannel(sql, context, channelId);
  return { created: false, message: await selectMessageById(sql, context, existing.id) };
};

/**
 * Sends a message or thread reply. Idempotent per (author, clientMessageId): a retry returns the
 * original message with created=false. Top-level messages take the next channel seq under the
 * channel row lock, so seq order equals commit order and `after=<seq>` paging never skips a message.
 */
export const sendMessage = async (
  context: AccessContext,
  channelId: string,
  input: SendMessageRequest
): Promise<{ created: boolean; message: ChatMessage }> => {
  const sql = getSql();
  const sanitized = await sanitizeBody(sql, context, input.body);
  const attachmentIds = uniqueIds(input.attachmentIds);
  if (!hasMessageContent(sanitized.text, attachmentIds.length)) {
    throw new AppError("CHAT_MESSAGE_EMPTY", "Write a message or attach a file.", 400);
  }

  const existing = await findByClientMessageId(sql, context, input.clientMessageId);
  if (existing) {
    return await replayExisting(context, channelId, existing);
  }
  if (attachmentIds.length > 0) {
    await assertChatAttachmentsEnabled(sql, context.organization.id);
  }
  await consumeChatQuota("send", context.user.id);

  const threadRootId = input.threadRootId ?? null;
  let outcome: { message: ChatMessage; threadRoot: ThreadRootSummary | null };
  try {
    outcome = await sql.begin(async (tx) => {
      const resolved = await requireChannel(tx, context, channelId, { lock: threadRootId === null });
      assertCanPost(resolved);

      let seq: number | null = null;
      let threadRoot: ThreadRootSummary | null = null;
      if (threadRootId) {
        // Row-locks the root: replies to one thread are serialized, so created_at order is commit order.
        const root = (
          await tx<{ id: string; reply_count: number; last_reply_at: Date }[]>`
            UPDATE public.messages
            SET reply_count = reply_count + 1, last_reply_at = clock_timestamp()
            WHERE organization_id = ${context.organization.id} AND id = ${threadRootId} AND channel_id = ${channelId}
              AND thread_root_id IS NULL AND kind = 'user' AND deleted_at IS NULL
            RETURNING id, reply_count, last_reply_at
          `
        )[0];
        if (!root) {
          throw new AppError("CHAT_THREAD_NOT_FOUND", "The thread was not found or can no longer be replied to.", 404);
        }
        threadRoot = { id: root.id, replyCount: Number(root.reply_count), lastReplyAt: toIso(root.last_reply_at) };
      } else {
        const row = (
          await tx<{ last_message_seq: string }[]>`
            UPDATE public.channels
            SET last_message_seq = last_message_seq + 1, last_message_at = clock_timestamp()
            WHERE organization_id = ${context.organization.id} AND id = ${channelId}
            RETURNING last_message_seq
          `
        )[0];
        seq = toSeq(row?.last_message_seq);
      }

      const mentions = await validateMentions(tx, context, resolved, sanitized.mentions);
      const messageId = randomUUID();
      await tx`
        INSERT INTO public.messages (
          id, organization_id, channel_id, seq, thread_root_id, author_user_id, kind,
          body_json, body_text, client_message_id, mentioned_user_ids, attachment_count
        )
        VALUES (
          ${messageId}, ${context.organization.id}, ${channelId}, ${seq}, ${threadRootId}, ${context.user.id}, 'user',
          ${tx.json(sanitized.doc)}, ${sanitized.text}, ${input.clientMessageId},
          ${mentions}::uuid[], ${attachmentIds.length}
        )
      `;

      if (attachmentIds.length > 0) {
        const attached = await tx<{ id: string }[]>`
          UPDATE public.message_attachments
          SET message_id = ${messageId}
          WHERE organization_id = ${context.organization.id} AND channel_id = ${channelId}
            AND id = ANY(${attachmentIds}::uuid[]) AND uploaded_by = ${context.user.id}
            AND status = 'ready' AND message_id IS NULL AND deleted_at IS NULL
          RETURNING id
        `;
        if (attached.length !== attachmentIds.length) {
          throw new AppError("CHAT_ATTACHMENT_INVALID", "One or more attachments are not ready or cannot be used here.", 400);
        }
      }

      const recipients = mentionRecipients(mentions, context.user.id);
      await insertMentions(tx, context, { messageId, channelId, seq, threadRootId, userIds: recipients });

      if (seq !== null && resolved.member) {
        // The author has read their own message.
        await tx`
          UPDATE public.channel_members SET last_read_seq = GREATEST(last_read_seq, ${seq}), last_read_at = now()
          WHERE id = ${resolved.member.id} AND organization_id = ${context.organization.id}
        `;
      }

      await enqueueDomainEvents(tx, [
        {
          organizationId: context.organization.id,
          type: "chat.message.created",
          aggregateType: "message",
          aggregateId: messageId,
          actorUserId: context.user.id,
          payload: {
            channelId,
            channelKind: resolved.channel.kind,
            messageId,
            authorId: context.user.id,
            threadRootId,
            seq,
            mentionedUserIds: recipients
          }
        }
      ]);

      return { message: await selectMessageById(tx, context, messageId), threadRoot };
    });
  } catch (error) {
    if (isUniqueViolation(error, "messages_client_id_uidx")) {
      const raced = await findByClientMessageId(sql, context, input.clientMessageId);
      if (raced) {
        return await replayExisting(context, channelId, raced);
      }
    }
    throw error;
  }

  publishToRoom(channelRoom(channelId), "chat:message", { channelId, message: outcome.message, threadRoot: outcome.threadRoot });
  return { created: true, message: outcome.message };
};

// Edit / delete ----------------------------------------------------------------------------------

type LockedMessage = {
  id: string;
  channel_id: string;
  author_user_id: string | null;
  kind: "user" | "system";
  thread_root_id: string | null;
  seq: string | null;
  attachment_count: number;
  mentioned_user_ids: string[] | null;
  deleted_at: Date | null;
};

/** Locks a message row and resolves its channel; 404 unless the caller can read the channel. */
const lockMessage = async (tx: QuerySql, context: AccessContext, messageId: string) => {
  const message = (
    await tx<LockedMessage[]>`
      SELECT id, channel_id, author_user_id, kind, thread_root_id, seq, attachment_count, mentioned_user_ids, deleted_at
      FROM public.messages
      WHERE organization_id = ${context.organization.id} AND id = ${messageId}
      FOR UPDATE
    `
  )[0];
  if (!message) {
    throw messageNotFound();
  }
  const resolved = await loadChannel(tx, context, message.channel_id);
  if (!resolved?.caps.canRead) {
    throw messageNotFound();
  }
  return { message, resolved };
};

export const editMessage = async (context: AccessContext, messageId: string, body: unknown): Promise<ChatMessage> => {
  const sql = getSql();
  const sanitized = await sanitizeBody(sql, context, body);

  const outcome = await sql.begin(async (tx) => {
    const { message, resolved } = await lockMessage(tx, context, messageId);
    if (message.kind !== "user" || message.author_user_id !== context.user.id) {
      throw new AppError("CHAT_NOT_AUTHOR", "You can only edit your own messages.", 403);
    }
    if (message.deleted_at) {
      throw new AppError("CHAT_MESSAGE_DELETED", "This message was deleted.", 409);
    }
    assertCanPost(resolved);
    if (!hasMessageContent(sanitized.text, message.attachment_count)) {
      throw new AppError("CHAT_MESSAGE_EMPTY", "A message cannot be empty. Delete it instead.", 400);
    }

    const mentions = await validateMentions(tx, context, resolved, sanitized.mentions);
    const editedAt = (
      await tx<{ edited_at: Date }[]>`
        UPDATE public.messages
        SET body_json = ${tx.json(sanitized.doc)}, body_text = ${sanitized.text},
            mentioned_user_ids = ${mentions}::uuid[], edited_at = now()
        WHERE id = ${messageId} AND organization_id = ${context.organization.id}
        RETURNING edited_at
      `
    )[0]!.edited_at;

    const previous = new Set(mentionRecipients(message.mentioned_user_ids ?? [], context.user.id));
    const recipients = mentionRecipients(mentions, context.user.id);
    await tx`DELETE FROM public.message_mentions WHERE message_id = ${messageId} AND NOT (user_id = ANY(${recipients}::uuid[]))`;
    await insertMentions(tx, context, {
      messageId,
      channelId: message.channel_id,
      seq: message.seq === null ? null : toSeq(message.seq),
      threadRootId: message.thread_root_id,
      userIds: recipients
    });

    await enqueueDomainEvents(tx, [
      {
        organizationId: context.organization.id,
        type: "chat.message.updated",
        aggregateType: "message",
        aggregateId: messageId,
        actorUserId: context.user.id,
        payload: {
          channelId: message.channel_id,
          channelKind: resolved.channel.kind,
          messageId,
          threadRootId: message.thread_root_id,
          addedMentionUserIds: recipients.filter((id) => !previous.has(id))
        }
      }
    ]);

    return {
      channelId: message.channel_id,
      threadRootId: message.thread_root_id,
      editedAt: toIso(editedAt),
      mentions,
      message: await selectMessageById(tx, context, messageId)
    };
  });

  publishToRoom(channelRoom(outcome.channelId), "chat:message:updated", {
    channelId: outcome.channelId,
    messageId,
    threadRootId: outcome.threadRootId,
    body: outcome.message.body,
    text: outcome.message.text,
    mentions: outcome.mentions,
    editedAt: outcome.editedAt
  });
  return outcome.message;
};

/** Soft delete: author, or channel moderators (channel admins / channel.manage_members / superadmin). */
export const deleteMessage = async (context: AccessContext, messageId: string) => {
  const sql = getSql();
  const outcome = await sql.begin(async (tx) => {
    const { message, resolved } = await lockMessage(tx, context, messageId);
    if (message.deleted_at) {
      return null;
    }
    const isAuthor = message.kind === "user" && message.author_user_id === context.user.id;
    if (!isAuthor && !resolved.caps.canModerate) {
      throw new AppError("FORBIDDEN", "You cannot delete this message.", 403);
    }
    assertNotArchived(resolved);

    const deletedAt = (
      await tx<{ deleted_at: Date }[]>`
        UPDATE public.messages SET deleted_at = now(), deleted_by = ${context.user.id}
        WHERE id = ${messageId} AND organization_id = ${context.organization.id}
        RETURNING deleted_at
      `
    )[0]!.deleted_at;
    await tx`DELETE FROM public.message_reactions WHERE message_id = ${messageId}`;
    await tx`DELETE FROM public.message_mentions WHERE message_id = ${messageId}`;
    const files = await tx<{ storage_path: string }[]>`
      UPDATE public.message_attachments SET deleted_at = now(), deleted_by = ${context.user.id}
      WHERE organization_id = ${context.organization.id} AND message_id = ${messageId} AND deleted_at IS NULL
      RETURNING storage_path
    `;

    let threadRoot: ThreadRootSummary | null = null;
    if (message.thread_root_id) {
      // Recounted from the live replies, so the count and "last reply" always match the thread (WK-63).
      const root = (
        await tx<{ id: string; reply_count: number; last_reply_at: Date | null }[]>`
          UPDATE public.messages root
          SET reply_count = live.n, last_reply_at = live.last_at
          FROM (
            SELECT count(*)::int AS n, max(r.created_at) AS last_at
            FROM public.messages r
            WHERE r.organization_id = ${context.organization.id} AND r.thread_root_id = ${message.thread_root_id}
              AND r.deleted_at IS NULL
          ) live
          WHERE root.organization_id = ${context.organization.id} AND root.id = ${message.thread_root_id}
          RETURNING root.id, root.reply_count, root.last_reply_at
        `
      )[0];
      if (root) {
        threadRoot = { id: root.id, replyCount: Number(root.reply_count), lastReplyAt: toNullableIso(root.last_reply_at) };
      }
    }

    await enqueueDomainEvents(tx, [
      {
        organizationId: context.organization.id,
        type: "chat.message.deleted",
        aggregateType: "message",
        aggregateId: messageId,
        actorUserId: context.user.id,
        payload: {
          channelId: message.channel_id,
          messageId,
          threadRootId: message.thread_root_id,
          authorId: message.author_user_id,
          deletedBy: context.user.id
        }
      }
    ]);
    return {
      channelId: message.channel_id,
      threadRootId: message.thread_root_id,
      deletedAt: toIso(deletedAt),
      threadRoot,
      paths: files.map((file) => file.storage_path)
    };
  });

  if (outcome) {
    publishToRoom(channelRoom(outcome.channelId), "chat:message:deleted", {
      channelId: outcome.channelId,
      messageId,
      threadRootId: outcome.threadRootId,
      deletedAt: outcome.deletedAt,
      threadRoot: outcome.threadRoot
    });
    if (outcome.paths.length > 0) {
      removeObjects(outcome.paths).catch((error: unknown) => logger.warn({ err: error, messageId }, "Chat attachment cleanup failed"));
    }
  }
  return { ok: true as const };
};

// Threads ----------------------------------------------------------------------------------------

export const getThread = async (context: AccessContext, messageId: string, query: ThreadQuery): Promise<ThreadPage> => {
  const sql = getSql();
  const base = (
    await sql<{ id: string; channel_id: string; thread_root_id: string | null }[]>`
      SELECT id, channel_id, thread_root_id FROM public.messages
      WHERE organization_id = ${context.organization.id} AND id = ${messageId}
    `
  )[0];
  if (!base) {
    throw messageNotFound();
  }
  const readable = await loadChannel(sql, context, base.channel_id);
  if (!readable?.caps.canRead) {
    throw messageNotFound();
  }
  const rootId = base.thread_root_id ?? base.id;
  const cursor = decodeTimeCursor(query.cursor);

  // Deleted replies stay as tombstones (the root's replyCount counts live replies only); the keyset compares
  // microsecond-exact timestamps (BUG-WK-12).
  const [root, replyRows] = await Promise.all([
    selectMessageById(sql, context, rootId),
    sql<{ id: string; created_at_text: string }[]>`
      SELECT m.id, ${timestampTextSql(sql, () => sql`m.created_at`)} AS created_at_text
      FROM public.messages m
      WHERE m.organization_id = ${context.organization.id} AND m.thread_root_id = ${rootId}
        ${cursor ? sql`AND (m.created_at, m.id) > (${timestampParamSql(sql, cursor.at)}, ${cursor.id}::uuid)` : sql``}
      ORDER BY m.created_at, m.id
      LIMIT ${query.limit + 1}
    `
  ]);
  const hasMore = replyRows.length > query.limit;
  const pageRows = replyRows.slice(0, query.limit);
  const replies =
    pageRows.length === 0
      ? []
      : await selectMessages(
          sql,
          context,
          sql`m.id = ANY(${pageRows.map((row) => row.id)}::uuid[])`,
          sql`m.created_at, m.id`,
          pageRows.length
        );
  const last = pageRows.at(-1);
  return {
    root,
    items: replies,
    pageInfo: { hasMore, nextCursor: hasMore && last ? encodeTimeCursor(last.created_at_text, last.id) : null }
  };
};

// Reactions --------------------------------------------------------------------------------------

export const setReaction = async (context: AccessContext, messageId: string, emoji: string, add: boolean): Promise<ReactionResult> => {
  await consumeChatQuota("react", context.user.id);
  const sql = getSql();
  const outcome = await sql.begin(async (tx) => {
    // The message row lock serializes reactions per message (distinct-emoji cap).
    const { message, resolved } = await lockMessage(tx, context, messageId);
    if (message.deleted_at) {
      throw new AppError("CHAT_MESSAGE_DELETED", "This message was deleted.", 409);
    }
    assertCanPost(resolved);

    let changed: boolean;
    if (add) {
      const inserted = await tx`
        INSERT INTO public.message_reactions (organization_id, channel_id, message_id, user_id, emoji)
        VALUES (${context.organization.id}, ${message.channel_id}, ${messageId}, ${context.user.id}, ${emoji})
        ON CONFLICT DO NOTHING
        RETURNING 1
      `;
      changed = inserted.length > 0;
      if (changed) {
        const distinct = (
          await tx<{ n: number }[]>`SELECT count(DISTINCT emoji)::int AS n FROM public.message_reactions WHERE message_id = ${messageId}`
        )[0]?.n ?? 0;
        if (distinct > chatLimits.reactionsDistinctMax) {
          throw new AppError("CHAT_REACTION_LIMIT", "This message has too many different reactions.", 409);
        }
      }
    } else {
      const removed = await tx`
        DELETE FROM public.message_reactions
        WHERE message_id = ${messageId} AND emoji = ${emoji} AND user_id = ${context.user.id}
        RETURNING 1
      `;
      changed = removed.length > 0;
    }
    const count =
      (await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM public.message_reactions WHERE message_id = ${messageId} AND emoji = ${emoji}`)[0]
        ?.n ?? 0;
    return { changed, count, channelId: message.channel_id, threadRootId: message.thread_root_id };
  });

  if (outcome.changed) {
    publishToRoom(channelRoom(outcome.channelId), "chat:reaction", {
      channelId: outcome.channelId,
      messageId,
      threadRootId: outcome.threadRootId,
      emoji,
      count: outcome.count,
      userId: context.user.id,
      added: add
    });
  }
  return { messageId, emoji, count: outcome.count, reactedByMe: add };
};

// Read state -------------------------------------------------------------------------------------

const countUnreadMentions = async (sql: QuerySql, context: AccessContext, channelId: string, lastReadSeq: number) =>
  (
    await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM (
        SELECT 1 FROM public.message_mentions
        WHERE organization_id = ${context.organization.id} AND user_id = ${context.user.id}
          AND channel_id = ${channelId} AND seq IS NOT NULL AND seq > ${lastReadSeq}
        LIMIT ${chatLimits.mentionCountCap}
      ) capped
    `
  )[0]?.n ?? 0;

/** Moves the caller's read marker forward (never backwards, never past the newest message). */
export const markRead = async (context: AccessContext, channelId: string, seq: number): Promise<ReadState> => {
  const sql = getSql();
  const resolved = await requireChannel(sql, context, channelId);
  if (!resolved.member) {
    throw new AppError("CHANNEL_NOT_MEMBER", "You are not a member of this channel.", 409);
  }
  const moved = (
    await sql<{ last_read_seq: string; last_message_seq: string }[]>`
      UPDATE public.channel_members cm
      SET last_read_seq = LEAST(${seq}::bigint, c.last_message_seq), last_read_at = now()
      FROM public.channels c
      WHERE cm.id = ${resolved.member.id} AND cm.organization_id = ${context.organization.id}
        AND c.organization_id = cm.organization_id AND c.id = cm.channel_id
        AND cm.last_read_seq < LEAST(${seq}::bigint, c.last_message_seq)
      RETURNING cm.last_read_seq, c.last_message_seq
    `
  )[0];

  const lastReadSeq = moved ? toSeq(moved.last_read_seq) : resolved.member.lastReadSeq;
  const lastMessageSeq = moved ? toSeq(moved.last_message_seq) : toSeq(resolved.channel.last_message_seq);
  // Deleted messages are not unread (WK-45).
  const liveUnread =
    unreadCount(lastMessageSeq, lastReadSeq) === 0
      ? 0
      : ((
          await sql<{ n: number }[]>`
            SELECT ${unreadCountSql(sql, sql`${context.organization.id}::uuid`, sql`${channelId}::uuid`, sql`${lastReadSeq}::bigint`)} AS n
          `
        )[0]?.n ?? 0);
  const state: ReadState = {
    channelId,
    lastReadSeq,
    unreadCount: liveUnread,
    mentionCount: await countUnreadMentions(sql, context, channelId, lastReadSeq)
  };
  if (moved) {
    publishToUsers([context.user.id], "chat:read", state);
  }
  return state;
};

// Search & mentions ------------------------------------------------------------------------------

type HitRow = {
  id: string;
  channel_id: string;
  channel_kind: ChatSearchHit["channelKind"];
  channel_name: string | null;
  seq: string | null;
  thread_root_id: string | null;
  text: string;
  author: UserRefJson | null;
  created_at: Date;
  cursor_at: string;
};

const toHit = (row: HitRow): ChatSearchHit => ({
  messageId: row.id,
  channelId: row.channel_id,
  channelKind: row.channel_kind,
  channelName: row.channel_name,
  seq: row.seq === null ? null : toSeq(row.seq),
  threadRootId: row.thread_root_id,
  author: toUserRef(row.author),
  text: row.text,
  createdAt: toIso(row.created_at)
});

const hitPage = (rows: HitRow[], limit: number, cursorId: (row: HitRow) => string): ChatSearchPage => {
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(toHit),
    pageInfo: { hasMore, nextCursor: hasMore && last ? encodeTimeCursor(last.cursor_at, cursorId(last)) : null }
  };
};

/**
 * Full-text search restricted at the database to conversations the caller is a member of
 * (joined public channels, private channels, DMs). Newest first, keyset paged.
 */
export const searchMessages = async (context: AccessContext, query: ChatSearchQuery): Promise<ChatSearchPage> => {
  const tsQuery = toPrefixTsQuery(query.q);
  if (!tsQuery) {
    return { items: [], pageInfo: { hasMore: false, nextCursor: null } };
  }
  const sql = getSql();
  const cursor = decodeTimeCursor(query.cursor);
  const canViewChannels = hasPermission(context, Permission.ChannelView);
  const rows = await sql<HitRow[]>`
    SELECT m.id, m.channel_id, c.kind AS channel_kind, c.name AS channel_name, m.seq, m.thread_root_id,
      left(m.body_text, 500) AS text, m.created_at, ${timestampTextSql(sql, () => sql`m.created_at`)} AS cursor_at,
      (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = m.author_user_id) AS author
    FROM public.messages m
    JOIN public.channel_members cm
      ON cm.organization_id = m.organization_id AND cm.channel_id = m.channel_id
      AND cm.user_id = ${context.user.id} AND cm.deleted_at IS NULL
    JOIN public.channels c
      ON c.organization_id = m.organization_id AND c.id = m.channel_id AND c.deleted_at IS NULL
    WHERE m.organization_id = ${context.organization.id}
      AND m.deleted_at IS NULL
      AND m.kind = 'user'
      AND m.search_vector @@ to_tsquery('simple', ${tsQuery})
      AND (c.kind IN ('dm', 'group_dm') OR ${canViewChannels})
      AND (${query.channelId ?? null}::uuid IS NULL OR m.channel_id = ${query.channelId ?? null}::uuid)
      ${cursor ? sql`AND (m.created_at, m.id) < (${timestampParamSql(sql, cursor.at)}, ${cursor.id}::uuid)` : sql``}
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT ${query.limit + 1}
  `;
  return hitPage(rows, query.limit, (row) => row.id);
};

/** "Mentions of me", newest first: conversations the caller is still in, plus public channels. */
export const listMyMentions = async (context: AccessContext, query: ChatMentionsQuery): Promise<ChatSearchPage> => {
  const sql = getSql();
  const cursor = decodeTimeCursor(query.cursor);
  const canViewChannels = hasPermission(context, Permission.ChannelView);
  const rows = await sql<HitRow[]>`
    SELECT m.id, m.channel_id, c.kind AS channel_kind, c.name AS channel_name, m.seq, m.thread_root_id,
      left(m.body_text, 500) AS text, m.created_at, ${timestampTextSql(sql, () => sql`mm.created_at`)} AS cursor_at,
      (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = m.author_user_id) AS author
    FROM public.message_mentions mm
    JOIN public.messages m ON m.organization_id = mm.organization_id AND m.id = mm.message_id AND m.deleted_at IS NULL
    JOIN public.channels c ON c.organization_id = mm.organization_id AND c.id = mm.channel_id AND c.deleted_at IS NULL
    WHERE mm.organization_id = ${context.organization.id}
      AND mm.user_id = ${context.user.id}
      AND (
        EXISTS (
          SELECT 1 FROM public.channel_members cm
          WHERE cm.organization_id = mm.organization_id AND cm.channel_id = mm.channel_id
            AND cm.user_id = ${context.user.id} AND cm.deleted_at IS NULL
            AND (c.kind IN ('dm', 'group_dm') OR ${canViewChannels})
        )
        OR (c.kind = 'public' AND ${canViewChannels})
      )
      ${cursor ? sql`AND (mm.created_at, mm.message_id) < (${timestampParamSql(sql, cursor.at)}, ${cursor.id}::uuid)` : sql``}
    ORDER BY mm.created_at DESC, mm.message_id DESC
    LIMIT ${query.limit + 1}
  `;
  return hitPage(rows, query.limit, (row) => row.id);
};
