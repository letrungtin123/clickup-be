import type postgres from "postgres";

import type {
  AddChannelMembersRequest,
  AddChannelMembersResponse,
  ChannelBrowsePage,
  ChannelBrowseQuery,
  ChannelMemberPage,
  ChannelMemberQuery,
  ChatChannelCollection,
  ChatChannelDetail,
  ChatChannelMember,
  ChatSystemEvent,
  CreateChannelRequest,
  MyMembership,
  OpenDmRequest,
  UpdateChannelMemberRequest,
  UpdateChannelRequest,
  UpdateMyMembershipRequest
} from "../../contracts/chat.js";
import { chatLimits, isDirectKind } from "../../contracts/chat.js";
import { Permission } from "../../contracts/permissions.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { escapeLike, nullableText, type QuerySql } from "../../lib/db-types.js";
import { evictUsersFromRoom } from "../../realtime/publisher.js";
import { purgeNotificationsFor } from "../notifications/notifications.service.js";
import type { AccessContext } from "../access/access-context.js";
import { assertPermission, hasPermission } from "../access/resource-access.js";
import { enqueueDomainEvents, type DomainEventInput } from "../events/outbox.js";
import {
  assertCapability,
  assertNotArchived,
  channelNotFound,
  channelPermissions,
  requireChannel,
  type ResolvedChannel
} from "./chat-access.js";
import {
  channelInfoColumnsSql,
  channelViewerColumnsSql,
  toChannel,
  toChannelInfo,
  toMember,
  userJsonSql,
  type ChannelViewRow,
  type MemberRow
} from "./chat-mappers.js";
import {
  buildDmKey,
  computeChannelCapabilities,
  decodeNameCursor,
  encodeNameCursor,
  uniqueIds
} from "./chat-rules.js";
import {
  advanceReadMarkers,
  channelRoom,
  insertSystemMessage,
  isUniqueViolation,
  publishChannelEvent,
  publishMessages,
  requireActiveOrgMembers
} from "./chat.repo.js";

const channelEvent = (
  context: AccessContext,
  type: string,
  channelId: string,
  payload: Record<string, postgres.JSONValue>
): DomainEventInput => ({
  organizationId: context.organization.id,
  type,
  aggregateType: "channel",
  aggregateId: channelId,
  actorUserId: context.user.id,
  payload: { channelId, ...payload }
});

const nameTaken = () => new AppError("CHANNEL_NAME_TAKEN", "A channel with this name already exists.", 409);

const assertNameFree = async (sql: QuerySql, context: AccessContext, name: string, exceptId: string | null) => {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM public.channels
    WHERE organization_id = ${context.organization.id}
      AND name_normalized = lower(${name})
      AND deleted_at IS NULL
      AND (${exceptId}::uuid IS NULL OR id <> ${exceptId}::uuid)
    LIMIT 1
  `;
  if (rows.length > 0) {
    throw nameTaken();
  }
};

const assertNotDirect = (resolved: ResolvedChannel) => {
  if (isDirectKind(resolved.channel.kind)) {
    throw new AppError(
      "CHAT_DM_IMMUTABLE",
      "Direct conversations cannot be changed. Start a new conversation with the people you want instead.",
      409
    );
  }
};

// Reads ------------------------------------------------------------------------------------------

/** Sidebar: every channel and DM the caller belongs to, with unread and mention counts. */
export const listMyChannels = async (context: AccessContext): Promise<ChatChannelCollection> => {
  const sql = getSql();
  const canViewChannels = hasPermission(context, Permission.ChannelView);
  const rows = await sql<ChannelViewRow[]>`
    SELECT ${channelInfoColumnsSql(sql)}, ${channelViewerColumnsSql(sql, context.user.id, chatLimits.mentionCountCap)}
    FROM public.channel_members cm
    JOIN public.channels c
      ON c.organization_id = cm.organization_id AND c.id = cm.channel_id AND c.deleted_at IS NULL
    WHERE cm.organization_id = ${context.organization.id}
      AND cm.user_id = ${context.user.id}
      AND cm.deleted_at IS NULL
      AND (c.kind IN ('dm', 'group_dm') OR ${canViewChannels})
    ORDER BY coalesce(c.last_message_at, c.created_at) DESC, c.id
    LIMIT ${chatLimits.sidebarMax}
  `;
  return { items: rows.map(toChannel) };
};

const selectChannelView = async (sql: QuerySql, context: AccessContext, channelId: string) =>
  (
    await sql<ChannelViewRow[]>`
      SELECT ${channelInfoColumnsSql(sql)}, ${channelViewerColumnsSql(sql, context.user.id, chatLimits.mentionCountCap)}
      FROM public.channels c
      LEFT JOIN public.channel_members cm
        ON cm.organization_id = c.organization_id AND cm.channel_id = c.id
        AND cm.user_id = ${context.user.id} AND cm.deleted_at IS NULL
      WHERE c.id = ${channelId} AND c.organization_id = ${context.organization.id} AND c.deleted_at IS NULL
    `
  )[0];

export const getChannel = async (context: AccessContext, channelId: string, sql: QuerySql = getSql()): Promise<ChatChannelDetail> => {
  const row = await selectChannelView(sql, context, channelId);
  if (!row) {
    throw channelNotFound();
  }
  const capabilities = computeChannelCapabilities({
    kind: row.kind,
    archived: row.archived_at !== null,
    member: row.access && row.role ? { access: row.access, role: row.role } : null,
    permissions: channelPermissions(context),
    superadmin: context.hasFullOrganizationAuthority
  });
  if (!capabilities) {
    throw channelNotFound();
  }
  return { ...toChannel(row), capabilities };
};

/** Joinable public channels the caller is not in (superadmins may include private ones to manage). */
export const browseChannels = async (context: AccessContext, query: ChannelBrowseQuery): Promise<ChannelBrowsePage> => {
  assertPermission(context, Permission.ChannelView);
  const sql = getSql();
  const kinds = query.includePrivate && context.hasFullOrganizationAuthority ? ["public", "private"] : ["public"];
  const cursor = decodeNameCursor(query.cursor);
  const q = query.q?.trim().toLowerCase() ?? "";
  const like = `%${escapeLike(q)}%`;
  const rows = await sql<(Parameters<typeof toChannelInfo>[0] & { name_normalized: string })[]>`
    SELECT ${channelInfoColumnsSql(sql)}, c.name_normalized
    FROM public.channels c
    WHERE c.organization_id = ${context.organization.id}
      AND c.kind = ANY(${kinds}::text[])
      AND c.deleted_at IS NULL
      AND c.archived_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.channel_members cm
        WHERE cm.organization_id = c.organization_id AND cm.channel_id = c.id
          AND cm.user_id = ${context.user.id} AND cm.deleted_at IS NULL
      )
      AND (${q.length === 0} OR public.immutable_unaccent(c.name_normalized) LIKE public.immutable_unaccent(${like}))
      AND (${cursor === null} OR (c.name_normalized, c.id) > (${cursor?.name ?? ""}, ${cursor?.id ?? null}::uuid))
    ORDER BY c.name_normalized, c.id
    LIMIT ${query.limit + 1}
  `;
  const hasMore = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toChannelInfo),
    pageInfo: { hasMore, nextCursor: hasMore && last ? encodeNameCursor(last.name_normalized, last.id) : null }
  };
};

// Create / update --------------------------------------------------------------------------------

export const createChannel = async (context: AccessContext, input: CreateChannelRequest): Promise<ChatChannelDetail> => {
  assertPermission(context, Permission.ChannelCreate);
  assertPermission(context, Permission.ChannelView);
  const sql = getSql();
  const memberIds = uniqueIds(input.memberIds).filter((id) => id !== context.user.id);

  let created: { channelId: string; systemMessageIds: string[] };
  try {
    created = await sql.begin(async (tx) => {
      const names = await requireActiveOrgMembers(tx, context, memberIds);
      await assertNameFree(tx, context, input.name, null);

      const channel = (
        await tx<{ id: string }[]>`
          INSERT INTO public.channels (organization_id, kind, name, description, created_by)
          VALUES (${context.organization.id}, ${input.kind}, ${input.name}, ${nullableText(input.description) ?? null}, ${context.user.id})
          RETURNING id
        `
      )[0];
      if (!channel) {
        throw new AppError("CHANNEL_CREATE_FAILED", "Channel could not be created.", 500);
      }

      await tx`
        INSERT INTO public.channel_members (organization_id, channel_id, user_id, access, role, added_by)
        SELECT ${context.organization.id}::uuid, ${channel.id}::uuid, u.user_id, 'submit',
               CASE WHEN u.user_id = ${context.user.id}::uuid THEN 'admin' ELSE 'member' END, ${context.user.id}::uuid
        FROM unnest(${[context.user.id, ...memberIds]}::uuid[]) AS u(user_id)
      `;

      const systemMessageIds = [
        (await insertSystemMessage(tx, context, channel.id, { type: "created", actorId: context.user.id, name: input.name })).id
      ];
      if (memberIds.length > 0) {
        const added = await insertSystemMessage(
          tx,
          context,
          channel.id,
          { type: "members_added", actorId: context.user.id, userIds: memberIds },
          memberIds.map((id) => names.get(id) ?? "someone")
        );
        systemMessageIds.push(added.id);
        // New members start caught up.
        await advanceReadMarkers(tx, context, channel.id, memberIds, added.seq);
      }

      await enqueueDomainEvents(tx, [
        channelEvent(context, "chat.channel.created", channel.id, { channelKind: input.kind, name: input.name }),
        ...(memberIds.length > 0
          ? [channelEvent(context, "chat.channel.member_added", channel.id, { channelKind: input.kind, userIds: memberIds, addedBy: context.user.id })]
          : [])
      ]);
      return { channelId: channel.id, systemMessageIds };
    });
  } catch (error) {
    if (isUniqueViolation(error, "channels_org_name_uidx")) {
      throw nameTaken();
    }
    throw error;
  }

  const detail = await getChannel(context, created.channelId);
  publishChannelEvent({
    kind: "joined",
    channelId: created.channelId,
    channel: detail,
    userIds: [context.user.id, ...memberIds],
    actorId: context.user.id,
    toRoom: false,
    toUsers: [context.user.id, ...memberIds]
  });
  return detail;
};

export const updateChannel = async (context: AccessContext, channelId: string, input: UpdateChannelRequest): Promise<ChatChannelDetail> => {
  const sql = getSql();
  let systemMessageIds: string[] = [];
  try {
    systemMessageIds = await sql.begin(async (tx) => {
      const resolved = await requireChannel(tx, context, channelId, { lock: true });
      assertNotDirect(resolved);
      const { channel } = resolved;
      const wantsMetadata = input.name !== undefined || input.description !== undefined || input.topic !== undefined;
      if (wantsMetadata) {
        assertCapability(resolved.caps.canUpdate);
      }
      if (input.kind !== undefined && input.kind !== channel.kind) {
        assertCapability(resolved.caps.canChangeKind, "Only channel admins can change who can find this channel.");
      }
      assertNotArchived(resolved);

      const nextName = input.name ?? channel.name;
      const renamed = nextName !== channel.name;
      if (renamed && nextName !== null) {
        await assertNameFree(tx, context, nextName, channelId);
      }
      const description = input.description === undefined ? channel.description : (nullableText(input.description) ?? null);
      const topic = input.topic === undefined ? channel.topic : (nullableText(input.topic) ?? null);
      const kind = input.kind ?? channel.kind;

      await tx`
        UPDATE public.channels
        SET name = ${nextName}, description = ${description}, topic = ${topic}, kind = ${kind}
        WHERE organization_id = ${context.organization.id} AND id = ${channelId}
      `;

      const events: ChatSystemEvent[] = [];
      if (renamed) {
        events.push({ type: "renamed", actorId: context.user.id, name: nextName ?? "", previousName: channel.name ?? "" });
      }
      if (topic !== channel.topic) {
        events.push({ type: "topic_changed", actorId: context.user.id, topic });
      }
      if (kind !== channel.kind) {
        events.push({ type: "kind_changed", actorId: context.user.id, kind });
      }
      const ids: string[] = [];
      for (const event of events) {
        ids.push((await insertSystemMessage(tx, context, channelId, event)).id);
      }

      await enqueueDomainEvents(tx, [
        channelEvent(context, "chat.channel.updated", channelId, {
          changes: [
            ...(renamed ? ["name"] : []),
            ...(description !== channel.description ? ["description"] : []),
            ...(topic !== channel.topic ? ["topic"] : []),
            ...(kind !== channel.kind ? ["kind"] : [])
          ],
          kind
        })
      ]);
      return ids;
    });
  } catch (error) {
    if (isUniqueViolation(error, "channels_org_name_uidx")) {
      throw nameTaken();
    }
    throw error;
  }

  const detail = await getChannel(context, channelId);
  await publishMessages(sql, context, channelId, systemMessageIds);
  publishChannelEvent({ kind: "updated", channelId, channel: detail, actorId: context.user.id, toRoom: true });
  return detail;
};

export const setChannelArchived = async (context: AccessContext, channelId: string, archived: boolean): Promise<ChatChannelDetail> => {
  const sql = getSql();
  const systemMessageId = await sql.begin(async (tx) => {
    const resolved = await requireChannel(tx, context, channelId, { lock: true });
    assertNotDirect(resolved);
    assertCapability(resolved.caps.canArchive);
    const isArchived = resolved.channel.archived_at !== null;
    if (isArchived === archived) {
      return null;
    }
    let messageId: string | null = null;
    if (archived) {
      // Announce first: the channel is read-only once archived.
      messageId = (await insertSystemMessage(tx, context, channelId, { type: "archived", actorId: context.user.id })).id;
      await tx`
        UPDATE public.channels SET archived_at = now(), archived_by = ${context.user.id}
        WHERE organization_id = ${context.organization.id} AND id = ${channelId}
      `;
    } else {
      await tx`
        UPDATE public.channels SET archived_at = NULL, archived_by = NULL
        WHERE organization_id = ${context.organization.id} AND id = ${channelId}
      `;
      messageId = (await insertSystemMessage(tx, context, channelId, { type: "unarchived", actorId: context.user.id })).id;
    }
    await enqueueDomainEvents(tx, [channelEvent(context, archived ? "chat.channel.archived" : "chat.channel.unarchived", channelId, {})]);
    return messageId;
  });

  const detail = await getChannel(context, channelId);
  if (systemMessageId) {
    await publishMessages(sql, context, channelId, [systemMessageId]);
    publishChannelEvent({
      kind: archived ? "archived" : "updated",
      channelId,
      channel: detail,
      actorId: context.user.id,
      toRoom: true
    });
  }
  return detail;
};

export const deleteChannel = async (context: AccessContext, channelId: string) => {
  const sql = getSql();
  const memberIds = await sql.begin(async (tx) => {
    const resolved = await requireChannel(tx, context, channelId, { lock: true });
    assertNotDirect(resolved);
    assertCapability(resolved.caps.canDelete, "You do not have permission to delete this channel.");
    await tx`
      UPDATE public.channels SET deleted_at = now(), deleted_by = ${context.user.id}
      WHERE organization_id = ${context.organization.id} AND id = ${channelId}
    `;
    const members = await tx<{ user_id: string }[]>`
      SELECT user_id FROM public.channel_members
      WHERE organization_id = ${context.organization.id} AND channel_id = ${channelId} AND deleted_at IS NULL
    `;
    await enqueueDomainEvents(tx, [channelEvent(context, "chat.channel.deleted", channelId, { name: resolved.channel.name })]);
    return members.map((member) => member.user_id);
  });

  publishChannelEvent({
    kind: "deleted",
    channelId,
    channel: null,
    actorId: context.user.id,
    toRoom: true,
    toUsers: memberIds
  });
  evictUsersFromRoom(memberIds, channelRoom(channelId));
  await purgeNotificationsFor({ organizationId: context.organization.id, userIds: memberIds, channelId });
  return { ok: true as const };
};

// Membership -------------------------------------------------------------------------------------

export const joinChannel = async (context: AccessContext, channelId: string): Promise<ChatChannelDetail> => {
  const sql = getSql();
  const systemMessageId = await sql.begin(async (tx) => {
    const resolved = await requireChannel(tx, context, channelId, { lock: true });
    if (resolved.member) {
      return null;
    }
    if (resolved.channel.kind !== "public") {
      throw new AppError("CHANNEL_NOT_JOINABLE", "Only public channels can be joined. Ask a channel admin to add you.", 403);
    }
    assertNotArchived(resolved);

    // A view-only restriction imposed by an admin survives leaving and rejoining.
    const previous = (
      await tx<{ access: "view" | "submit" }[]>`
        SELECT access FROM public.channel_members
        WHERE organization_id = ${context.organization.id} AND channel_id = ${channelId}
          AND user_id = ${context.user.id} AND deleted_at IS NOT NULL
        ORDER BY joined_at DESC
        LIMIT 1
      `
    )[0];
    const access = previous?.access === "view" ? "view" : "submit";
    await tx`
      INSERT INTO public.channel_members (organization_id, channel_id, user_id, access, role, last_read_seq, added_by)
      VALUES (${context.organization.id}, ${channelId}, ${context.user.id}, ${access}, 'member',
              ${resolved.channel.last_message_seq}, ${context.user.id})
    `;
    const message = await insertSystemMessage(tx, context, channelId, { type: "joined", actorId: context.user.id, userIds: [context.user.id] });
    await enqueueDomainEvents(tx, [
      channelEvent(context, "chat.channel.member_added", channelId, {
        channelKind: resolved.channel.kind,
        userIds: [context.user.id],
        addedBy: context.user.id
      })
    ]);
    return message.id;
  });

  const detail = await getChannel(context, channelId);
  if (systemMessageId) {
    await publishMessages(sql, context, channelId, [systemMessageId]);
    publishChannelEvent({
      kind: "joined",
      channelId,
      channel: detail,
      userIds: [context.user.id],
      actorId: context.user.id,
      toRoom: true,
      toUsers: [context.user.id]
    });
  }
  return detail;
};

/** A channel keeps at least one admin while it has other members. */
const assertAdminRemains = async (tx: QuerySql, context: AccessContext, channelId: string, leavingUserId: string) => {
  const rows = await tx<{ admins: number; others: number }[]>`
    SELECT
      count(*) FILTER (WHERE role = 'admin')::int AS admins,
      count(*)::int AS others
    FROM public.channel_members
    WHERE organization_id = ${context.organization.id} AND channel_id = ${channelId}
      AND user_id <> ${leavingUserId} AND deleted_at IS NULL
  `;
  const { admins = 0, others = 0 } = rows[0] ?? {};
  if (others > 0 && admins === 0) {
    throw new AppError("CHANNEL_ADMIN_REQUIRED", "Make someone else a channel admin first.", 409);
  }
};

const removeMembership = async (
  tx: QuerySql,
  context: AccessContext,
  resolved: ResolvedChannel,
  userId: string,
  targetName: string | null
) => {
  const channelId = resolved.channel.id;
  const target = (
    await tx<{ role: "member" | "admin" }[]>`
      SELECT role FROM public.channel_members
      WHERE organization_id = ${context.organization.id} AND channel_id = ${channelId}
        AND user_id = ${userId} AND deleted_at IS NULL
      FOR UPDATE
    `
  )[0];
  if (!target) {
    throw new AppError("CHANNEL_MEMBER_NOT_FOUND", "Channel member was not found.", 404);
  }
  if (target.role === "admin") {
    await assertAdminRemains(tx, context, channelId, userId);
  }
  await tx`
    UPDATE public.channel_members
    SET deleted_at = now(), deleted_by = ${context.user.id}
    WHERE organization_id = ${context.organization.id} AND channel_id = ${channelId}
      AND user_id = ${userId} AND deleted_at IS NULL
  `;

  let systemMessageId: string | null = null;
  if (resolved.channel.archived_at === null) {
    const self = userId === context.user.id;
    systemMessageId = (
      await insertSystemMessage(
        tx,
        context,
        channelId,
        self
          ? { type: "left", actorId: context.user.id, userIds: [userId] }
          : { type: "member_removed", actorId: context.user.id, userIds: [userId] },
        targetName ? [targetName] : []
      )
    ).id;
  }
  await enqueueDomainEvents(tx, [
    channelEvent(context, "chat.channel.member_removed", channelId, { userIds: [userId], removedBy: context.user.id })
  ]);
  return systemMessageId;
};

const afterMemberRemoved = async (context: AccessContext, channelId: string, userId: string, systemMessageId: string | null) => {
  const sql = getSql();
  await publishMessages(sql, context, channelId, systemMessageId ? [systemMessageId] : []);
  const info = (
    await sql<Parameters<typeof toChannelInfo>[0][]>`
      SELECT ${channelInfoColumnsSql(sql)} FROM public.channels c
      WHERE c.organization_id = ${context.organization.id} AND c.id = ${channelId}
    `
  )[0];
  publishChannelEvent({
    kind: "left",
    channelId,
    channel: info ? toChannelInfo(info) : null,
    userIds: [userId],
    actorId: context.user.id,
    toRoom: true,
    toUsers: [userId]
  });
  // Removed members stop receiving the channel's realtime events immediately.
  evictUsersFromRoom([userId], channelRoom(channelId));
  await purgeNotificationsFor({ organizationId: context.organization.id, userIds: [userId], channelId });
};

export const leaveChannel = async (context: AccessContext, channelId: string) => {
  const sql = getSql();
  const systemMessageId = await sql.begin(async (tx) => {
    const resolved = await requireChannel(tx, context, channelId, { lock: true });
    assertNotDirect(resolved);
    if (!resolved.member) {
      throw new AppError("CHANNEL_NOT_MEMBER", "You are not a member of this channel.", 409);
    }
    return await removeMembership(tx, context, resolved, context.user.id, null);
  });
  await afterMemberRemoved(context, channelId, context.user.id, systemMessageId);
  return { ok: true as const };
};

export const removeChannelMember = async (context: AccessContext, channelId: string, userId: string) => {
  if (userId === context.user.id) {
    return await leaveChannel(context, channelId);
  }
  const sql = getSql();
  const systemMessageId = await sql.begin(async (tx) => {
    const resolved = await requireChannel(tx, context, channelId, { lock: true });
    assertNotDirect(resolved);
    assertCapability(resolved.caps.canManageMembers);
    assertNotArchived(resolved);
    const name = (
      await tx<{ display_name: string }[]>`SELECT display_name FROM public.app_users WHERE id = ${userId}`
    )[0]?.display_name;
    return await removeMembership(tx, context, resolved, userId, name ?? null);
  });
  await afterMemberRemoved(context, channelId, userId, systemMessageId);
  return { ok: true as const };
};

export const listChannelMembers = async (context: AccessContext, channelId: string, query: ChannelMemberQuery): Promise<ChannelMemberPage> => {
  const sql = getSql();
  const resolved = await requireChannel(sql, context, channelId);
  if (!resolved.caps.canRead && !resolved.caps.canManageMembers) {
    throw channelNotFound();
  }
  const cursor = decodeNameCursor(query.cursor);
  const q = query.q?.trim().toLowerCase() ?? "";
  const like = `%${escapeLike(q)}%`;
  const rows = await sql<(MemberRow & { sort_name: string; user_id: string })[]>`
    SELECT ${userJsonSql(sql)} AS user, cm.access, cm.role, cm.joined_at, lower(au.display_name) AS sort_name, au.id AS user_id
    FROM public.channel_members cm
    JOIN public.app_users au ON au.id = cm.user_id
    WHERE cm.organization_id = ${context.organization.id}
      AND cm.channel_id = ${channelId}
      AND cm.deleted_at IS NULL
      AND (
        ${q.length === 0}
        OR public.immutable_unaccent(lower(au.display_name)) LIKE public.immutable_unaccent(${like})
        OR lower(au.email) LIKE ${like}
      )
      AND (${cursor === null} OR (lower(au.display_name), au.id) > (${cursor?.name ?? ""}, ${cursor?.id ?? null}::uuid))
    ORDER BY lower(au.display_name), au.id
    LIMIT ${query.limit + 1}
  `;
  const hasMore = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toMember),
    pageInfo: { hasMore, nextCursor: hasMore && last ? encodeNameCursor(last.sort_name, last.user_id) : null }
  };
};

const selectMembers = async (sql: QuerySql, context: AccessContext, channelId: string, userIds: string[]) => {
  const rows = await sql<MemberRow[]>`
    SELECT ${userJsonSql(sql)} AS user, cm.access, cm.role, cm.joined_at
    FROM public.channel_members cm
    JOIN public.app_users au ON au.id = cm.user_id
    WHERE cm.organization_id = ${context.organization.id} AND cm.channel_id = ${channelId}
      AND cm.user_id = ANY(${userIds}::uuid[]) AND cm.deleted_at IS NULL
    ORDER BY lower(au.display_name), au.id
  `;
  return rows.map(toMember);
};

export const addChannelMembers = async (
  context: AccessContext,
  channelId: string,
  input: AddChannelMembersRequest
): Promise<AddChannelMembersResponse> => {
  const sql = getSql();
  const userIds = uniqueIds(input.userIds);
  const outcome = await sql.begin(async (tx) => {
    const resolved = await requireChannel(tx, context, channelId, { lock: true });
    assertNotDirect(resolved);
    assertCapability(resolved.caps.canManageMembers);
    assertNotArchived(resolved);
    const names = await requireActiveOrgMembers(tx, context, userIds);

    const inserted = await tx<{ user_id: string }[]>`
      INSERT INTO public.channel_members (organization_id, channel_id, user_id, access, role, last_read_seq, added_by)
      SELECT ${context.organization.id}::uuid, ${channelId}::uuid, u.user_id, ${input.access}, 'member',
             ${resolved.channel.last_message_seq}::bigint, ${context.user.id}::uuid
      FROM unnest(${userIds}::uuid[]) AS u(user_id)
      ON CONFLICT (organization_id, channel_id, user_id) WHERE deleted_at IS NULL DO NOTHING
      RETURNING user_id
    `;
    const addedIds = inserted.map((row) => row.user_id);
    if (addedIds.length === 0) {
      return { addedIds, systemMessageId: null, kind: resolved.channel.kind };
    }
    const message = await insertSystemMessage(
      tx,
      context,
      channelId,
      { type: "members_added", actorId: context.user.id, userIds: addedIds },
      addedIds.map((id) => names.get(id) ?? "someone")
    );
    await advanceReadMarkers(tx, context, channelId, addedIds, message.seq);
    await enqueueDomainEvents(tx, [
      channelEvent(context, "chat.channel.member_added", channelId, {
        channelKind: resolved.channel.kind,
        userIds: addedIds,
        addedBy: context.user.id
      })
    ]);
    return { addedIds, systemMessageId: message.id, kind: resolved.channel.kind };
  });

  if (outcome.addedIds.length === 0) {
    return { items: [] };
  }
  await publishMessages(sql, context, channelId, outcome.systemMessageId ? [outcome.systemMessageId] : []);
  const detail = await getChannel(context, channelId);
  publishChannelEvent({
    kind: "joined",
    channelId,
    channel: detail,
    userIds: outcome.addedIds,
    actorId: context.user.id,
    toRoom: true,
    toUsers: outcome.addedIds
  });
  return { items: await selectMembers(sql, context, channelId, outcome.addedIds) };
};

export const updateChannelMember = async (
  context: AccessContext,
  channelId: string,
  userId: string,
  input: UpdateChannelMemberRequest
): Promise<ChatChannelMember> => {
  const sql = getSql();
  const outcome = await sql.begin(async (tx) => {
    const resolved = await requireChannel(tx, context, channelId, { lock: true });
    assertNotDirect(resolved);
    assertCapability(resolved.caps.canManageMembers);
    assertNotArchived(resolved);
    const target = (
      await tx<{ access: "view" | "submit"; role: "member" | "admin" }[]>`
        SELECT access, role FROM public.channel_members
        WHERE organization_id = ${context.organization.id} AND channel_id = ${channelId}
          AND user_id = ${userId} AND deleted_at IS NULL
        FOR UPDATE
      `
    )[0];
    if (!target) {
      throw new AppError("CHANNEL_MEMBER_NOT_FOUND", "Channel member was not found.", 404);
    }
    const role = input.role ?? target.role;
    const access = input.access ?? (role === "admin" ? "submit" : target.access);
    if (role === "admin" && access !== "submit") {
      throw new AppError("CHANNEL_ADMIN_REQUIRES_SUBMIT", "Channel admins always have send access.", 400);
    }
    if (target.role === "admin" && role !== "admin") {
      await assertAdminRemains(tx, context, channelId, userId);
    }
    if (role === target.role && access === target.access) {
      return { downgraded: false, changed: false };
    }
    await tx`
      UPDATE public.channel_members SET access = ${access}, role = ${role}
      WHERE organization_id = ${context.organization.id} AND channel_id = ${channelId}
        AND user_id = ${userId} AND deleted_at IS NULL
    `;
    await enqueueDomainEvents(tx, [
      channelEvent(context, "chat.channel.member_updated", channelId, {
        userId,
        access,
        role,
        previousAccess: target.access,
        previousRole: target.role
      })
    ]);
    return { downgraded: target.access === "submit" && access === "view", changed: true };
  });

  const member = (await selectMembers(sql, context, channelId, [userId]))[0];
  if (!member) {
    throw new AppError("CHANNEL_MEMBER_NOT_FOUND", "Channel member was not found.", 404);
  }
  if (outcome.changed) {
    publishChannelEvent({ kind: "updated", channelId, channel: null, userIds: [userId], actorId: context.user.id, toRoom: true, toUsers: [userId] });
  }
  if (outcome.downgraded) {
    // Drop cached "submit" room access (typing relay); the client re-joins and gets "view".
    evictUsersFromRoom([userId], channelRoom(channelId));
  }
  return member;
};

export const updateMyMembership = async (
  context: AccessContext,
  channelId: string,
  input: UpdateMyMembershipRequest
): Promise<MyMembership> => {
  const sql = getSql();
  const resolved = await requireChannel(sql, context, channelId);
  if (!resolved.member) {
    throw new AppError("CHANNEL_NOT_MEMBER", "You are not a member of this channel.", 409);
  }
  await sql`
    UPDATE public.channel_members SET notify_level = ${input.notifyLevel}
    WHERE id = ${resolved.member.id} AND organization_id = ${context.organization.id}
  `;
  return {
    channelId,
    access: resolved.member.access,
    role: resolved.member.role,
    notifyLevel: input.notifyLevel,
    lastReadSeq: resolved.member.lastReadSeq
  };
};

// Direct messages --------------------------------------------------------------------------------

/**
 * Get-or-create a 1:1 or group DM for the exact participant set (caller included). Membership of a DM
 * never changes: "adding people" to a group DM opens the conversation for the new set (Slack-like).
 */
export const openDirectConversation = async (
  context: AccessContext,
  input: OpenDmRequest
): Promise<{ created: boolean; channel: ChatChannelDetail }> => {
  const sql = getSql();
  const dm = buildDmKey(context.user.id, input.userIds);

  const findExisting = async (client: QuerySql) =>
    (
      await client<{ id: string }[]>`
        SELECT id FROM public.channels
        WHERE organization_id = ${context.organization.id} AND dm_key = ${dm.key} AND deleted_at IS NULL
        LIMIT 1
      `
    )[0]?.id ?? null;

  const existingId = await findExisting(sql);
  if (existingId) {
    return { created: false, channel: await getChannel(context, existingId) };
  }

  const outcome = await sql.begin(async (tx) => {
    await requireActiveOrgMembers(tx, context, dm.otherIds);
    const inserted = (
      await tx<{ id: string }[]>`
        INSERT INTO public.channels (organization_id, kind, dm_key, created_by)
        VALUES (${context.organization.id}, ${dm.kind}, ${dm.key}, ${context.user.id})
        ON CONFLICT (organization_id, dm_key) WHERE deleted_at IS NULL AND dm_key IS NOT NULL DO NOTHING
        RETURNING id
      `
    )[0];
    if (!inserted) {
      // Lost a concurrent get-or-create race: the other request created it.
      return { created: false, channelId: await findExisting(tx) };
    }
    await tx`
      INSERT INTO public.channel_members (organization_id, channel_id, user_id, access, role, added_by)
      SELECT ${context.organization.id}::uuid, ${inserted.id}::uuid, u.user_id, 'submit', 'member', ${context.user.id}::uuid
      FROM unnest(${dm.participantIds}::uuid[]) AS u(user_id)
    `;
    await enqueueDomainEvents(tx, [
      channelEvent(context, "chat.channel.created", inserted.id, { channelKind: dm.kind, name: null }),
      channelEvent(context, "chat.channel.member_added", inserted.id, {
        channelKind: dm.kind,
        userIds: dm.otherIds,
        addedBy: context.user.id
      })
    ]);
    return { created: true, channelId: inserted.id };
  });

  if (!outcome.channelId) {
    throw new AppError("CHAT_DM_CREATE_FAILED", "The conversation could not be opened. Please retry.", 409);
  }
  const channel = await getChannel(context, outcome.channelId);
  if (outcome.created) {
    publishChannelEvent({
      kind: "joined",
      channelId: outcome.channelId,
      channel,
      userIds: dm.participantIds,
      actorId: context.user.id,
      toRoom: false,
      toUsers: dm.participantIds
    });
  }
  return { created: outcome.created, channel };
};
