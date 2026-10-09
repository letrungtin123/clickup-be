import type { ChannelAccess, ChannelCapabilities, ChannelRole, NotifyLevel } from "../../contracts/chat.js";
import { Permission } from "../../contracts/permissions.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import type { QuerySql } from "../../lib/db-types.js";
import type { RoomAccess } from "../../realtime/room-authorizers.js";
import type { AccessContext } from "../access/access-context.js";
import { hasPermission } from "../access/resource-access.js";
import { channelInfoColumnsSql, type ChannelInfoRow } from "./chat-mappers.js";
import { computeChannelCapabilities, toSeq } from "./chat-rules.js";

export type ChannelMembership = {
  id: string;
  access: ChannelAccess;
  role: ChannelRole;
  notifyLevel: NotifyLevel;
  lastReadSeq: number;
};

export type ResolvedChannel = {
  channel: ChannelInfoRow;
  member: ChannelMembership | null;
  caps: ChannelCapabilities;
};

type AccessRow = ChannelInfoRow & {
  member_id: string | null;
  access: ChannelAccess | null;
  role: ChannelRole | null;
  notify_level: NotifyLevel | null;
  last_read_seq: string | null;
};

export const channelPermissions = (context: AccessContext) => ({
  view: hasPermission(context, Permission.ChannelView),
  update: hasPermission(context, Permission.ChannelUpdate),
  delete: hasPermission(context, Permission.ChannelDelete),
  manageMembers: hasPermission(context, Permission.ChannelManageMembers)
});

/**
 * Loads a channel with the caller's membership and effective capabilities (org boundary, RBAC,
 * membership). Returns null when it does not exist or must stay invisible to the caller.
 * `lock` takes a row lock on the channel (serializes membership changes and message sequencing).
 */
export const loadChannel = async (
  sql: QuerySql,
  context: AccessContext,
  channelId: string,
  options: { lock?: boolean } = {}
): Promise<ResolvedChannel | null> => {
  const rows = await sql<AccessRow[]>`
    SELECT ${channelInfoColumnsSql(sql)},
      cm.id AS member_id, cm.access, cm.role, cm.notify_level, cm.last_read_seq
    FROM public.channels c
    LEFT JOIN public.channel_members cm
      ON cm.organization_id = c.organization_id
      AND cm.channel_id = c.id
      AND cm.user_id = ${context.user.id}
      AND cm.deleted_at IS NULL
    WHERE c.id = ${channelId}
      AND c.organization_id = ${context.organization.id}
      AND c.deleted_at IS NULL
    ${options.lock ? sql`FOR UPDATE OF c` : sql``}
  `;
  const row = rows[0];
  if (!row) {
    return null;
  }

  const member: ChannelMembership | null =
    row.member_id && row.access && row.role && row.notify_level
      ? {
          id: row.member_id,
          access: row.access,
          role: row.role,
          notifyLevel: row.notify_level,
          lastReadSeq: toSeq(row.last_read_seq)
        }
      : null;

  const caps = computeChannelCapabilities({
    kind: row.kind,
    archived: row.archived_at !== null,
    member,
    permissions: channelPermissions(context),
    superadmin: context.hasFullOrganizationAuthority
  });
  if (!caps) {
    return null;
  }
  return { channel: row, member, caps };
};

export const channelNotFound = () => new AppError("CHANNEL_NOT_FOUND", "Channel was not found.", 404);

/** Visible channel or 404. */
export const requireChannel = async (sql: QuerySql, context: AccessContext, channelId: string, options: { lock?: boolean } = {}) => {
  const resolved = await loadChannel(sql, context, channelId, options);
  if (!resolved) {
    throw channelNotFound();
  }
  return resolved;
};

/** Channel whose messages the caller may read, or 404 / 403. */
export const requireReadableChannel = async (sql: QuerySql, context: AccessContext, channelId: string, options: { lock?: boolean } = {}) => {
  const resolved = await requireChannel(sql, context, channelId, options);
  if (!resolved.caps.canRead) {
    throw new AppError("CHANNEL_MEMBERSHIP_REQUIRED", "Join this channel to read its messages.", 403);
  }
  return resolved;
};

export const assertNotArchived = (resolved: ResolvedChannel) => {
  if (resolved.channel.archived_at !== null) {
    throw new AppError("CHANNEL_ARCHIVED", "This channel is archived and read-only.", 409);
  }
};

/** The caller may post / react / upload (member with submit access, channel not archived). */
export const assertCanPost = (resolved: ResolvedChannel) => {
  if (resolved.caps.canPost) {
    return;
  }
  assertNotArchived(resolved);
  if (!resolved.member) {
    throw new AppError("CHANNEL_MEMBERSHIP_REQUIRED", "Join this channel to post.", 403);
  }
  throw new AppError("CHANNEL_SUBMIT_REQUIRED", "You have view-only access to this channel.", 403);
};

export const assertCapability = (allowed: boolean, message = "You do not have permission to manage this channel.") => {
  if (!allowed) {
    throw new AppError("FORBIDDEN", message, 403);
  }
};

/**
 * Realtime room authorizer for `channel:<id>`: members only (public non-members must join first).
 * Archived channels and view-only members get "view" (typing relay requires "submit").
 */
export const authorizeChannelRoom = async (context: AccessContext, channelId: string): Promise<RoomAccess> => {
  const resolved = await loadChannel(getSql(), context, channelId);
  if (!resolved?.member) {
    return null;
  }
  return resolved.caps.canPost ? "submit" : "view";
};
