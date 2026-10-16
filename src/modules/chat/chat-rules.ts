import type {
  ChannelAccess,
  ChannelCapabilities,
  ChannelKind,
  ChannelRole,
  ChatSystemEvent,
  MessageHistoryQuery,
  NamedChannelKind
} from "../../contracts/chat.js";
import { chatLimits, isDirectKind } from "../../contracts/chat.js";
import { departmentCodes, sortDepartments, type Department } from "../../contracts/departments.js";
import { sanitizeRichText, type SanitizeLimits, type SanitizeResult } from "../../contracts/rich-text.js";
import { AppError } from "../../lib/app-error.js";
import { decodeCursor, decodeTimeCursor, encodeCursor, encodeTimeCursor, invalidCursor, isUuid } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { assertDepartment } from "../access/departments.js";

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

/** A person as the DM rules see them: organization superadmin (in every department, PD-041) and department rows. */
export type DmParty = { superadmin: boolean; departments: readonly string[] };

/** The caller of a DM rule: also whether they may create channels (channel.create). */
export type DmCaller = DmParty & { canCreateChannels: boolean };

/** Colleagues for a 1:1 DM: they share a department, or either one is the superadmin (who belongs to every department). */
export const areDmColleagues = (a: DmParty, b: DmParty) =>
  a.superadmin || b.superadmin || a.departments.some((department) => b.departments.includes(department));

/** May start any conversation (groups, anyone in the organization): superadmins and holders of channel.create. */
const startsAnyDm = (caller: DmCaller) => caller.superadmin || caller.canCreateChannels;

export const dmGroupForbidden = () => new AppError("CHAT_DM_GROUP_FORBIDDEN", "Bạn chỉ nhắn được 1:1; tạo nhóm cần quyền tạo kênh.", 403);
export const dmNotColleague = () =>
  new AppError("CHAT_DM_NOT_COLLEAGUE", "Bạn chỉ nhắn tin 1:1 được với đồng nghiệp cùng phòng ban.", 403);

/**
 * What creating a new DM with `otherCount` other people requires:
 * - a group (2+ others) needs the right to create channels (channel.create; superadmins) — 403 CHAT_DM_GROUP_FORBIDDEN;
 * - 1:1: superadmins and holders of channel.create may message any active member ("ok", unchanged); every other
 *   member only a colleague ("colleague": check the other person with `assertDmColleague`).
 */
export const dmOpenRequirement = (caller: DmCaller, otherCount: number): "ok" | "colleague" => {
  if (otherCount > 1) {
    if (!startsAnyDm(caller)) {
      throw dmGroupForbidden();
    }
    return "ok";
  }
  return startsAnyDm(caller) ? "ok" : "colleague";
};

/** 403 CHAT_DM_NOT_COLLEAGUE unless the two share a department or either is the superadmin. */
export const assertDmColleague = (caller: DmParty, other: DmParty) => {
  if (!areDmColleagues(caller, other)) {
    throw dmNotColleague();
  }
};

/**
 * People search for a DM (GET /directory/users?purpose=dm): who may be listed. `everyone` for callers who may start
 * any conversation; otherwise the members of the caller's `departments` plus superadmins. (E-mails follow member.view
 * as in every other people search, SEC-API-04.)
 */
export const dmDirectoryScope = (caller: DmCaller) => ({
  everyone: startsAnyDm(caller),
  departments: [...caller.departments]
});

// Department channels (PD-053) --------------------------------------------------------------------

/**
 * A public channel's audience: the members of its department (the superadmin belongs to every department); a public
 * channel without department (created before PD-053) is organization-wide.
 */
export const inChannelDepartment = (department: string | null, caller: { superadmin: boolean; departments: readonly string[] }) =>
  department === null || caller.superadmin || caller.departments.includes(department);

export const channelDepartmentRequired = (kind: NamedChannelKind = "public") =>
  new AppError("CHANNEL_DEPARTMENT_REQUIRED", kind === "public" ? "Chọn phòng ban cho kênh public." : "Chọn phòng ban cho kênh riêng tư.", 400);

/**
 * The department of a new channel (create, private → public, a channel without department given one; public and
 * private since PD-054): the requested one, which must be one of the caller's (403 DEPARTMENT_FORBIDDEN); none
 * requested → the caller's only department, or 400 CHANNEL_DEPARTMENT_REQUIRED when they belong to several (the
 * superadmin: all) or none.
 */
export const resolveChannelDepartment = (
  context: Pick<AccessContext, "hasFullOrganizationAuthority" | "departments">,
  requested: Department | undefined,
  kind: NamedChannelKind = "public"
): Department => {
  if (requested !== undefined) {
    assertDepartment(context, requested);
    return requested;
  }
  const only = context.departments.length === 1 ? context.departments[0] : undefined;
  if (!only) {
    throw channelDepartmentRequired(kind);
  }
  return only;
};

// Department switcher (PD-054) --------------------------------------------------------------------

/**
 * Departments in which a conversation is shown to the viewer (`ChatChannel.audienceDepartments`), stable order:
 * - public / private channel: its department; without one (created before PD-053 / PD-054) every department;
 * - dm / group_dm: `otherDepartments` = the effective departments of the other participants as the sidebar query
 *   gathers them (department rows, every department for a superadmin); none → every department (nobody to follow).
 * Unknown codes are dropped.
 */
export const audienceDepartments = (
  kind: ChannelKind,
  department: string | null,
  otherDepartments: readonly string[] | null | undefined
): Department[] => {
  const known = sortDepartments(
    (isDirectKind(kind) ? (otherDepartments ?? []) : department === null ? [] : [department]).filter((code): code is Department =>
      (departmentCodes as readonly string[]).includes(code)
    )
  );
  return known.length > 0 ? known : [...departmentCodes];
};

// Capabilities ------------------------------------------------------------------------------------

export type CapabilityInput = {
  kind: ChannelKind;
  archived: boolean;
  member: { access: ChannelAccess; role: ChannelRole } | null;
  permissions: { view: boolean; update: boolean; delete: boolean; manageMembers: boolean };
  /** context.hasFullOrganizationAuthority */
  superadmin: boolean;
  /** The channel's department (public channels, PD-053); null = none. */
  department: string | null;
  /** The caller's effective departments (context.departments: every department for a superadmin). */
  departments: readonly string[];
};

/**
 * Effective channel capabilities (PD-001 / PD-002, product §17-19). Returns null when the channel must
 * be invisible to the caller (callers answer 404).
 *
 * - dm / group_dm: participants only — never visible to anyone else, superadmins included.
 * - public: visible to holders of channel.view in its department (PD-053; organization-wide without department);
 *   reading is allowed to non-members of it (preview), posting requires membership with submit access. Anyone else
 *   sees it only as a member (a channel admin added them), like a private channel.
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
  // Open to non-members: public channels, for the members of their department (PD-053).
  const open = kind === "public" && inChannelDepartment(input.department, { superadmin, departments: input.departments });
  if (!isMember && !open && !superadmin) {
    return null;
  }

  const elevated = member?.role === "admin" || superadmin;
  const canRead = isMember || open;
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
    canJoin: !isMember && open && !archived,
    canLeave: isMember
  };
};

// Mentions ----------------------------------------------------------------------------------------

/**
 * Who may be mentioned (they are notified even if they are not in the channel):
 * - "department": a public channel of a department (PD-053) — its members plus the active members of the department
 *   (the superadmin included);
 * - "organization": a public channel without department (before PD-053) — any active organization member;
 * - "members": private channels and DMs — current members only.
 */
export const mentionScope = (kind: ChannelKind, department: string | null): "organization" | "department" | "members" => {
  if (kind !== "public") {
    return "members";
  }
  return department === null ? "organization" : "department";
};

/** Mentioned ids that are not eligible (order preserved, de-duplicated). */
export const findInvalidMentions = (mentionIds: string[], eligibleIds: Iterable<string>) => {
  const eligible = new Set([...eligibleIds].map((id) => id.toLowerCase()));
  return [...new Set(mentionIds.map((id) => id.toLowerCase()))].filter((id) => !eligible.has(id));
};

/** Users to notify / index for "mentions of me": everyone mentioned except the author. */
export const mentionRecipients = (mentionIds: string[], authorId: string) =>
  [...new Set(mentionIds.map((id) => id.toLowerCase()))].filter((id) => id !== authorId.toLowerCase());

/** @all (PD-061) mentions everyone in public / private channels and group DMs; in a 1:1 DM it is plain text. */
export const allowsMentionAll = (kind: ChannelKind) => kind !== "dm";

/**
 * A body sanitized with `allowMentionAll` as the conversation allows it: in a 1:1 DM an @all mention becomes the text
 * "@all" (no error). The other mentions keep their (already server-side) labels.
 */
export const applyMentionAllPolicy = (sanitized: SanitizeResult, kind: ChannelKind, limits: SanitizeLimits): SanitizeResult =>
  !sanitized.mentionsAll || allowsMentionAll(kind) ? sanitized : sanitizeRichText(sanitized.doc, limits, { allowMentionAll: false });

/**
 * Rows of message_mentions (mention badge, "mentions of me"): the people mentioned by name plus, with @all, every
 * current member of the conversation (`allMemberIds`); never the author, each person once.
 */
export const mentionRowRecipients = (mentionIds: string[], allMemberIds: readonly string[] | null, authorId: string) =>
  mentionRecipients([...mentionIds, ...(allMemberIds ?? [])], authorId);

/**
 * One `chat.mentioned` per person (PD-061). `named`: people mentioned by name who pass the usual rules (notify level,
 * channel.view); `everyone`: with @all, the current members of the conversation, whatever their notify level. Named
 * people get the personal notification; the other members the @all one (payload.all). Never the author.
 */
export const splitMentionNotifications = (named: string[], everyone: readonly string[], authorId: string | null) => {
  const author = authorId ?? "";
  const personal = mentionRecipients(named, author);
  const taken = new Set(personal);
  return { named: personal, all: mentionRecipients([...everyone], author).filter((id) => !taken.has(id)) };
};

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
