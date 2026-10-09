import type {
  ChannelAccess,
  ChannelCapabilities,
  ChannelKind,
  ChannelRole,
  ChatSystemEvent,
  MessageHistoryQuery
} from "../../contracts/chat.js";
import { chatLimits, isDirectKind } from "../../contracts/chat.js";
import { AppError } from "../../lib/app-error.js";
import { decodeCursor, decodeTimeCursor, encodeCursor, encodeTimeCursor, invalidCursor, isUuid } from "../../lib/db-types.js";

/** Pure chat rules (no I/O) so they can be unit tested in isolation. */

// DMs ---------------------------------------------------------------------------------------------

export type DmKey = { key: string; kind: "dm" | "group_dm"; participantIds: string[]; otherIds: string[] };

/**
 * Builds the get-or-create key for a DM: the sorted, de-duplicated participant set (caller included).
 * 2 participants → "dm", 3–9 → "group_dm". The caller may not DM only themselves.
 */
export const buildDmKey = (callerId: string, userIds: string[]): DmKey => {
  const caller = callerId.toLowerCase();
  const otherIds = [...new Set(userIds.map((id) => id.toLowerCase()))].filter((id) => id !== caller);
  if (otherIds.length === 0) {
    throw new AppError("CHAT_DM_INVALID", "Choose at least one other person.", 400);
  }
  if (otherIds.length > chatLimits.dmOthersMax) {
    throw new AppError("CHAT_DM_INVALID", `A group conversation can include at most ${chatLimits.dmOthersMax + 1} people.`, 400);
  }
  const participantIds = [caller, ...otherIds].sort();
  return {
    key: participantIds.join(","),
    kind: participantIds.length === 2 ? "dm" : "group_dm",
    participantIds,
    otherIds: [...otherIds].sort()
  };
};

// Capabilities ------------------------------------------------------------------------------------

export type CapabilityInput = {
  kind: ChannelKind;
  archived: boolean;
  member: { access: ChannelAccess; role: ChannelRole } | null;
  permissions: { view: boolean; update: boolean; delete: boolean; manageMembers: boolean };
  /** context.hasFullOrganizationAuthority */
  superadmin: boolean;
};

/**
 * Effective channel capabilities (PD-001 / PD-002, product §17-19). Returns null when the channel must
 * be invisible to the caller (callers answer 404).
 *
 * - dm / group_dm: participants only — never visible to anyone else, superadmins included.
 * - public: visible to holders of channel.view; reading is allowed to non-members (preview), posting
 *   requires membership with submit access.
 * - private: visible to members; superadmins can see and manage it (membership, settings) but must
 *   add themselves as a member (visible to everyone) before reading messages — no silent reads.
 * - Channel admins manage their channel without global permissions; global channel.update /
 *   channel.delete / channel.manage_members apply to channels the caller can see.
 */
export const computeChannelCapabilities = (input: CapabilityInput): ChannelCapabilities | null => {
  const { kind, archived, member, permissions, superadmin } = input;

  if (isDirectKind(kind)) {
    if (!member) {
      return null;
    }
    return {
      canRead: true,
      canPost: member.access === "submit" && !archived,
      canUpdate: false,
      canChangeKind: false,
      canArchive: false,
      canDelete: false,
      canManageMembers: false,
      canManageAdmins: false,
      canModerate: false,
      canJoin: false,
      canLeave: false
    };
  }

  if (!permissions.view) {
    return null;
  }
  const isMember = member !== null;
  if (!isMember && kind !== "public" && !superadmin) {
    return null;
  }

  const elevated = member?.role === "admin" || superadmin;
  const canRead = isMember || kind === "public";
  const canManageMembers = elevated || permissions.manageMembers;
  const canUpdate = elevated || permissions.update;
  return {
    canRead,
    canPost: isMember && member.access === "submit" && !archived,
    canUpdate,
    canChangeKind: elevated,
    canArchive: canUpdate,
    canDelete: elevated || permissions.delete,
    canManageMembers,
    // Granting / revoking the channel admin role (or removing an admin) needs an admin of the channel or a
    // superadmin: channel.manage_members alone must not self-promote (SEC-API-02).
    canManageAdmins: elevated,
    canModerate: canRead && canManageMembers,
    canJoin: !isMember && kind === "public" && !archived,
    canLeave: isMember
  };
};

// Mentions ----------------------------------------------------------------------------------------

/**
 * Who may be mentioned: in public channels any active organization member (they are notified even
 * if they have not joined); in private channels and DMs only current members.
 */
export const mentionScope = (kind: ChannelKind): "organization" | "members" => (kind === "public" ? "organization" : "members");

/** Mentioned ids that are not eligible (order preserved, de-duplicated). */
export const findInvalidMentions = (mentionIds: string[], eligibleIds: Iterable<string>) => {
  const eligible = new Set([...eligibleIds].map((id) => id.toLowerCase()));
  return [...new Set(mentionIds.map((id) => id.toLowerCase()))].filter((id) => !eligible.has(id));
};

/** Users to notify / index for "mentions of me": everyone mentioned except the author. */
export const mentionRecipients = (mentionIds: string[], authorId: string) =>
  [...new Set(mentionIds.map((id) => id.toLowerCase()))].filter((id) => id !== authorId.toLowerCase());

// Read state --------------------------------------------------------------------------------------

export const unreadCount = (lastMessageSeq: number, lastReadSeq: number) => Math.max(0, lastMessageSeq - lastReadSeq);

/** Read markers only move forward and never past the newest message. */
export const nextReadSeq = (currentReadSeq: number, requestedSeq: number, lastMessageSeq: number) =>
  Math.max(currentReadSeq, Math.min(requestedSeq, lastMessageSeq));

/** postgres.js returns int8 as string. */
export const toSeq = (value: string | number | bigint | null | undefined) => (value === null || value === undefined ? 0 : Number(value));

// Messages ----------------------------------------------------------------------------------------

export const hasMessageContent = (text: string, attachmentCount: number) => text.trim().length > 0 || attachmentCount > 0;

export type HistoryWindow =
  | { mode: "latest"; limit: number }
  | { mode: "before"; seq: number; limit: number }
  | { mode: "after"; seq: number; limit: number }
  | { mode: "around"; messageId: string; limit: number; olderLimit: number; newerLimit: number };

export const resolveHistoryWindow = (query: MessageHistoryQuery): HistoryWindow => {
  const limit = Math.min(Math.max(1, query.limit), chatLimits.pageMax);
  if (query.around !== undefined) {
    // The anchor and newer messages get the larger half so the target is always included.
    const olderLimit = Math.floor(limit / 2);
    return { mode: "around", messageId: query.around, limit, olderLimit, newerLimit: limit - olderLimit };
  }
  if (query.before !== undefined) {
    return { mode: "before", seq: query.before, limit };
  }
  if (query.after !== undefined) {
    return { mode: "after", seq: query.after, limit };
  }
  return { mode: "latest", limit };
};

// Cursors -----------------------------------------------------------------------------------------

/** Keyset cursor over (timestamp with full microsecond precision as text, uuid). */
export { decodeTimeCursor, encodeTimeCursor };

/** Keyset cursor over (sort text, uuid), e.g. member lists and channel browse. */
export const encodeNameCursor = (name: string, id: string) => encodeCursor([name, id]);

export const decodeNameCursor = (cursor: string | undefined): { name: string; id: string } | null => {
  if (!cursor) {
    return null;
  }
  const values = decodeCursor(cursor, 2);
  const [name, id] = values ?? [];
  if (typeof name !== "string" || name.length > 400 || name.includes("\u0000") || !isUuid(id)) {
    throw invalidCursor();
  }
  return { name, id };
};

// System messages ---------------------------------------------------------------------------------

const listNames = (names: string[]) => {
  if (names.length <= 3) {
    return names.join(", ");
  }
  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} others`;
};

/** Readable plain-text summary stored with system messages (names as of the event). */
export const systemMessageText = (event: ChatSystemEvent, actorName: string, userNames: string[] = []) => {
  switch (event.type) {
    case "created":
      return `${actorName} created this channel`;
    case "joined":
      return `${actorName} joined`;
    case "left":
      return `${actorName} left`;
    case "members_added":
      return `${actorName} added ${listNames(userNames)}`;
    case "member_removed":
      return `${actorName} removed ${listNames(userNames)}`;
    case "renamed":
      return `${actorName} renamed the channel to "${event.name ?? ""}"`;
    case "topic_changed":
      return event.topic ? `${actorName} set the topic: ${event.topic}` : `${actorName} cleared the topic`;
    case "kind_changed":
      return `${actorName} made this channel ${event.kind ?? ""}`;
    case "archived":
      return `${actorName} archived this channel`;
    case "unarchived":
      return `${actorName} unarchived this channel`;
  }
};

export const uniqueIds = (ids: string[]) => [...new Set(ids.map((id) => id.toLowerCase()))];
