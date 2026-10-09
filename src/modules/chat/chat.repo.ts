import type postgres from "postgres";

import type { ChatChannelEvent, ChatChannelInfo, ChatMessage, ChatSystemEvent } from "../../contracts/chat.js";
import type { RealtimeRoomRef } from "../../contracts/realtime.js";
import { roomName, userRoom } from "../../contracts/realtime.js";
import { AppError } from "../../lib/app-error.js";
import type { QuerySql } from "../../lib/db-types.js";
import { publishToRoom, publishToRooms } from "../../realtime/publisher.js";
import type { AccessContext } from "../access/access-context.js";
import { messageColumnsSql, pickChannelInfo, toMessage, type MessageRow } from "./chat-mappers.js";
import { systemMessageText, toSeq, uniqueIds } from "./chat-rules.js";

export const channelRoom = (channelId: string): RealtimeRoomRef => ({ type: "channel", id: channelId });

export const isUniqueViolation = (error: unknown, constraint?: string) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "23505" &&
  (constraint === undefined || ("constraint_name" in error && error.constraint_name === constraint));

// Messages ---------------------------------------------------------------------------------------

export const selectMessages = async (
  sql: QuerySql,
  context: AccessContext,
  where: postgres.PendingQuery<postgres.Row[]>,
  order: postgres.PendingQuery<postgres.Row[]>,
  limit: number
): Promise<ChatMessage[]> => {
  const rows = await sql<MessageRow[]>`
    SELECT ${messageColumnsSql(sql, context.user.id)}
    FROM public.messages m
    WHERE m.organization_id = ${context.organization.id}
      AND ${where}
    ORDER BY ${order}
    LIMIT ${limit}
  `;
  return rows.map(toMessage);
};

export const selectMessageById = async (sql: QuerySql, context: AccessContext, messageId: string) => {
  const message = (await selectMessages(sql, context, sql`m.id = ${messageId}`, sql`m.id`, 1))[0];
  if (!message) {
    throw new AppError("CHAT_MESSAGE_NOT_FOUND", "Message was not found.", 404);
  }
  return message;
};

/** Atomically allocates the next top-level sequence number (row-locks the channel until commit). */
export const allocateSeq = async (tx: QuerySql, context: AccessContext, channelId: string) => {
  const row = (
    await tx<{ last_message_seq: string }[]>`
      UPDATE public.channels
      SET last_message_seq = last_message_seq + 1, last_message_at = clock_timestamp()
      WHERE organization_id = ${context.organization.id} AND id = ${channelId} AND deleted_at IS NULL
      RETURNING last_message_seq
    `
  )[0];
  if (!row) {
    throw new AppError("CHANNEL_NOT_FOUND", "Channel was not found.", 404);
  }
  return toSeq(row.last_message_seq);
};

/** Moves read markers forward (never backwards) for the given members. */
export const advanceReadMarkers = async (tx: QuerySql, context: AccessContext, channelId: string, userIds: string[], seq: number) => {
  if (userIds.length === 0) {
    return;
  }
  await tx`
    UPDATE public.channel_members
    SET last_read_seq = ${seq}, last_read_at = now()
    WHERE organization_id = ${context.organization.id}
      AND channel_id = ${channelId}
      AND user_id = ANY(${uniqueIds(userIds)}::uuid[])
      AND deleted_at IS NULL
      AND last_read_seq < ${seq}
  `;
};

/**
 * Inserts a system message (join/leave/rename/...) as a top-level message. The actor's read marker
 * advances past it. Returns the new message id for publishing after commit.
 */
export const insertSystemMessage = async (
  tx: QuerySql,
  context: AccessContext,
  channelId: string,
  event: ChatSystemEvent,
  userNames: string[] = []
) => {
  const seq = await allocateSeq(tx, context, channelId);
  const text = systemMessageText(event, context.user.displayName, userNames).slice(0, 2000);
  const row = (
    await tx<{ id: string }[]>`
      INSERT INTO public.messages (organization_id, channel_id, seq, author_user_id, kind, body_text, system_event)
      VALUES (${context.organization.id}, ${channelId}, ${seq}, ${context.user.id}, 'system', ${text},
              ${tx.json(event)})
      RETURNING id
    `
  )[0];
  if (!row) {
    throw new AppError("CHAT_MESSAGE_CREATE_FAILED", "Message could not be created.", 500);
  }
  await advanceReadMarkers(tx, context, channelId, [context.user.id], seq);
  return { id: row.id, seq };
};

// Organization members ---------------------------------------------------------------------------

/** Validates that every id is an active member of the caller's organization; returns display names. */
export const requireActiveOrgMembers = async (sql: QuerySql, context: AccessContext, userIds: string[]) => {
  const ids = uniqueIds(userIds);
  if (ids.length === 0) {
    return new Map<string, string>();
  }
  const rows = await sql<{ user_id: string; display_name: string }[]>`
    SELECT om.user_id, au.display_name
    FROM public.organization_memberships om
    JOIN public.app_users au ON au.id = om.user_id AND au.deleted_at IS NULL
    WHERE om.organization_id = ${context.organization.id}
      AND om.user_id = ANY(${ids}::uuid[])
      AND om.status = 'active'
      AND om.deleted_at IS NULL
  `;
  if (rows.length !== ids.length) {
    throw new AppError("CHAT_MEMBER_INVALID", "Every person must be an active member of this organization.", 400);
  }
  return new Map(rows.map((row) => [row.user_id, row.display_name]));
};

// Realtime ---------------------------------------------------------------------------------------

/** Publishes freshly committed messages (e.g. system messages) to the channel room. */
export const publishMessages = async (sql: QuerySql, context: AccessContext, channelId: string, messageIds: string[]) => {
  if (messageIds.length === 0) {
    return;
  }
  const messages = await selectMessages(sql, context, sql`m.id = ANY(${messageIds}::uuid[])`, sql`m.seq NULLS LAST, m.created_at`, messageIds.length);
  for (const message of messages) {
    publishToRoom(channelRoom(channelId), "chat:message", { channelId, message, threadRoot: null });
  }
};

/**
 * `chat:channel` to the channel room (current members) and/or specific users' rooms in one emit
 * (Socket.IO de-duplicates sockets present in several target rooms).
 */
export const publishChannelEvent = (input: {
  kind: ChatChannelEvent["kind"];
  channelId: string;
  channel: ChatChannelInfo | null;
  userIds?: string[];
  actorId: string;
  toRoom: boolean;
  toUsers?: string[];
}) => {
  const rooms = [
    ...(input.toRoom ? [roomName(channelRoom(input.channelId))] : []),
    ...uniqueIds(input.toUsers ?? []).map(userRoom)
  ];
  publishToRooms(rooms, "chat:channel", {
    kind: input.kind,
    channelId: input.channelId,
    // Never broadcast the actor's viewer-specific fields (myRole, unread, ...).
    channel: input.channel ? pickChannelInfo(input.channel) : null,
    userIds: input.userIds ?? [],
    actorId: input.actorId,
    at: new Date().toISOString()
  });
};
