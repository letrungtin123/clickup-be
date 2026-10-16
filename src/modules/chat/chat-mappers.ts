import type {
  ChannelAccess,
  ChannelKind,
  ChannelRole,
  ChatAttachment,
  ChatChannel,
  ChatChannelInfo,
  ChatChannelMember,
  ChatMessage,
  ChatSystemEvent,
  NotifyLevel,
  ReactionSummary
} from "../../contracts/chat.js";
import { chatLimits } from "../../contracts/chat.js";
import { departmentCodes, type Department } from "../../contracts/departments.js";
import type { RichTextDoc } from "../../contracts/rich-text.js";
import type { UserRef } from "../../contracts/work.js";
import { toIso, toNullableIso, type QuerySql, type SqlFragment } from "../../lib/db-types.js";
import { inlineImageTypes } from "../../lib/storage.js";
import { audienceDepartments, toSeq, unreadCount } from "./chat-rules.js";

export type UserRefJson = { id: string; display_name: string; email: string | null; avatar_url: string | null };

export const toUserRef = (row: UserRefJson | null | undefined): UserRef | null =>
  row ? { id: row.id, displayName: row.display_name, email: row.email, avatarUrl: row.avatar_url } : null;

/** json_build_object for an app_users row aliased `alias`. */
export const userJsonSql = (sql: QuerySql, alias = "au") =>
  sql`json_build_object('id', ${sql(alias)}.id, 'display_name', ${sql(alias)}.display_name, 'email', ${sql(alias)}.email, 'avatar_url', ${sql(alias)}.avatar_url)`;

// Channels ---------------------------------------------------------------------------------------

export type ChannelInfoRow = {
  id: string;
  kind: ChannelKind;
  name: string | null;
  description: string | null;
  topic: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
  last_message_seq: string | number;
  last_message_at: Date | null;
  member_count: number;
  department: Department | null;
};

/** Columns for ChannelInfoRow; expects `c` (channels) in scope. */
export const channelInfoColumnsSql = (sql: QuerySql) => sql`
  c.id, c.kind, c.name, c.description, c.topic, c.created_by, c.created_at, c.updated_at, c.archived_at,
  c.last_message_seq, c.last_message_at, c.member_count, c.department
`;

export const toChannelInfo = (row: ChannelInfoRow): ChatChannelInfo => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  description: row.description,
  topic: row.topic,
  createdBy: row.created_by,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
  archivedAt: toNullableIso(row.archived_at),
  memberCount: Number(row.member_count),
  lastMessageSeq: toSeq(row.last_message_seq),
  lastMessageAt: toNullableIso(row.last_message_at),
  department: row.department
});

/** Strips viewer-specific fields so a caller's view of a channel can be broadcast safely. */
export const pickChannelInfo = (channel: ChatChannelInfo): ChatChannelInfo => ({
  id: channel.id,
  kind: channel.kind,
  name: channel.name,
  description: channel.description,
  topic: channel.topic,
  createdBy: channel.createdBy,
  createdAt: channel.createdAt,
  updatedAt: channel.updatedAt,
  archivedAt: channel.archivedAt,
  memberCount: channel.memberCount,
  lastMessageSeq: channel.lastMessageSeq,
  lastMessageAt: channel.lastMessageAt,
  department: channel.department
});

export type ChannelViewRow = ChannelInfoRow & {
  access: ChannelAccess | null;
  role: ChannelRole | null;
  notify_level: NotifyLevel | null;
  last_read_seq: string | number | null;
  mention_count: number;
  unread_count: number;
  participants: UserRefJson[] | null;
  /** dm / group_dm: departments of the other participants (`audienceDepartmentsSql`); null for channels. */
  audience_departments?: string[] | null;
};

/** Unread top-level messages after a read marker, deleted ones excluded (WK-45), capped. */
export const unreadCountSql = (
  sql: QuerySql,
  organizationId: SqlFragment,
  channelId: SqlFragment,
  lastReadSeq: SqlFragment
) => sql`(
  SELECT count(*)::int FROM (
    SELECT 1 FROM public.messages um
    WHERE um.organization_id = ${organizationId} AND um.channel_id = ${channelId}
      AND um.seq IS NOT NULL AND um.seq > ${lastReadSeq} AND um.deleted_at IS NULL
    LIMIT ${chatLimits.unreadCountCap}
  ) unread_capped
)`;

/**
 * Departments a DM is shown in (PD-054): the department rows of the other active participants, every department when
 * one of them is the organization superadmin (same rule as public.is_department_member); NULL when there are none (the
 * mapper then shows it everywhere) and for named channels (the mapper uses their department). One aggregate per row
 * of the same statement, like `participants`: no extra query per conversation. Expects `c` (channels) in scope.
 */
export const audienceDepartmentsSql = (sql: QuerySql, userId: string) => sql`
  CASE WHEN c.kind IN ('dm', 'group_dm') THEN (
    SELECT array_agg(DISTINCT deps.department ORDER BY deps.department)
    FROM public.channel_members ap
    CROSS JOIN LATERAL (
      SELECT ud.department FROM public.user_departments ud
      WHERE ud.organization_id = ap.organization_id AND ud.user_id = ap.user_id
      UNION ALL
      SELECT code FROM unnest(${[...departmentCodes]}::text[]) AS code
      WHERE EXISTS (
        SELECT 1 FROM public.organization_memberships aom
        JOIN public.roles ar ON ar.id = aom.role_id AND ar.organization_id = aom.organization_id
        WHERE aom.organization_id = ap.organization_id AND aom.user_id = ap.user_id AND aom.deleted_at IS NULL
          AND ar.key = 'superadmin'
      )
    ) AS deps(department)
    WHERE ap.organization_id = c.organization_id AND ap.channel_id = c.id
      AND ap.deleted_at IS NULL AND ap.user_id <> ${userId}
  ) END AS audience_departments
`;

/**
 * Viewer columns (membership, unread mentions capped, DM participants, departments shown in); expects `c` (channels)
 * and `cm` (the caller's active channel_members row, possibly NULL via LEFT JOIN) in scope.
 */
export const channelViewerColumnsSql = (sql: QuerySql, userId: string, mentionCap: number) => sql`
  cm.access, cm.role, cm.notify_level, cm.last_read_seq,
  CASE WHEN cm.id IS NULL THEN 0 ELSE (
    SELECT count(*)::int FROM (
      SELECT 1 FROM public.message_mentions mm
      WHERE mm.organization_id = c.organization_id AND mm.user_id = ${userId} AND mm.channel_id = c.id
        AND mm.seq IS NOT NULL AND mm.seq > cm.last_read_seq
      LIMIT ${mentionCap}
    ) capped
  ) END AS mention_count,
  CASE WHEN cm.id IS NULL THEN 0 ELSE ${unreadCountSql(sql, sql`c.organization_id`, sql`c.id`, sql`cm.last_read_seq`)} END AS unread_count,
  CASE WHEN c.kind IN ('dm', 'group_dm') THEN (
    SELECT coalesce(json_agg(${userJsonSql(sql)} ORDER BY au.display_name, au.id), '[]'::json)
    FROM public.channel_members pm
    JOIN public.app_users au ON au.id = pm.user_id
    WHERE pm.organization_id = c.organization_id AND pm.channel_id = c.id
      AND pm.deleted_at IS NULL AND pm.user_id <> ${userId}
  ) ELSE '[]'::json END AS participants,
  ${audienceDepartmentsSql(sql, userId)}
`;

export const toChannel = (row: ChannelViewRow): ChatChannel => {
  const info = toChannelInfo(row);
  const isMember = row.access !== null;
  const lastReadSeq = isMember ? toSeq(row.last_read_seq) : null;
  return {
    ...info,
    isMember,
    myAccess: row.access,
    myRole: row.role,
    notifyLevel: row.notify_level,
    lastReadSeq,
    unreadCount: lastReadSeq === null ? 0 : Math.min(Number(row.unread_count), unreadCount(info.lastMessageSeq, lastReadSeq)),
    mentionCount: isMember ? Number(row.mention_count) : 0,
    participants: (row.participants ?? []).map((user) => toUserRef(user)!),
    audienceDepartments: audienceDepartments(row.kind, row.department, row.audience_departments)
  };
};

// Members ----------------------------------------------------------------------------------------

export type MemberRow = { user: UserRefJson; access: ChannelAccess; role: ChannelRole; joined_at: Date };

export const toMember = (row: MemberRow): ChatChannelMember => ({
  user: toUserRef(row.user)!,
  access: row.access,
  role: row.role,
  joinedAt: toIso(row.joined_at)
});

// Reactions --------------------------------------------------------------------------------------

/** A reactor as aggregated in SQL (names and avatars only, never e-mails). */
export type ReactorJson = { id: string; display_name: string; avatar_url: string | null };
export type ReactionJson = { emoji: string; count: number; reacted_by_me: boolean; users?: (ReactorJson | null)[] | null };

/**
 * SQL: the first `cap` reactors of a group of reactions as a JSON array, oldest first (`[]` when none). Expects
 * `mr` (message_reactions) LEFT JOIN `au` (app_users ON au.id = mr.user_id) in scope, grouped (e.g. by emoji).
 * One aggregate per group inside the same statement: no extra query per message.
 */
export const reactorsAggSql = (sql: QuerySql, cap: number = chatLimits.reactionUsersPreview) => sql`
  coalesce(to_json((
    array_agg(json_build_object('id', au.id, 'display_name', au.display_name, 'avatar_url', au.avatar_url)
      ORDER BY mr.created_at, mr.user_id) FILTER (WHERE au.id IS NOT NULL)
  )[1:${cap}::int]), '[]'::json)`;

/** Reactors for the API: in the given (reaction) order, de-duplicated, at most `cap`, no e-mail. */
export const toReactors = (
  rows: readonly (ReactorJson | null | undefined)[] | null | undefined,
  cap: number = chatLimits.reactionUsersPreview
): UserRef[] => {
  const seen = new Set<string>();
  const users: UserRef[] = [];
  for (const row of rows ?? []) {
    if (users.length >= cap) {
      break;
    }
    if (!row?.id || seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
    users.push({ id: row.id, displayName: row.display_name, email: null, avatarUrl: row.avatar_url });
  }
  return users;
};

export const toReactionSummary = (row: ReactionJson): ReactionSummary => ({
  emoji: row.emoji,
  count: Number(row.count),
  reactedByMe: row.reacted_by_me,
  users: toReactors(row.users)
});

/** One reaction row (who reacted with what), rows ordered by reaction time within each emoji. */
export type ReactionUserRow = { emoji: string; user_id: string; display_name: string; avatar_url: string | null };

/**
 * Groups reaction rows into summaries: emojis in the order they first appear, `count` = every row of the emoji,
 * `reactedByMe` = the viewer is among them, `users` = the emoji's first `cap` reactors.
 */
export const groupReactionRows = (
  rows: readonly ReactionUserRow[],
  viewerId: string,
  cap: number = chatLimits.reactionUsersPreview
): ReactionSummary[] => {
  const groups = new Map<string, { emoji: string; count: number; reactedByMe: boolean; reactors: ReactorJson[] }>();
  for (const row of rows) {
    const group = groups.get(row.emoji) ?? { emoji: row.emoji, count: 0, reactedByMe: false, reactors: [] };
    group.count += 1;
    group.reactedByMe ||= row.user_id === viewerId;
    group.reactors.push({ id: row.user_id, display_name: row.display_name, avatar_url: row.avatar_url });
    groups.set(row.emoji, group);
  }
  return [...groups.values()].map((group) => ({
    emoji: group.emoji,
    count: group.count,
    reactedByMe: group.reactedByMe,
    users: toReactors(group.reactors, cap)
  }));
};

// Messages ---------------------------------------------------------------------------------------

type AttachmentJson = { id: string; file_name: string; mime_type: string; size_bytes: string | number };

export type MessageRow = {
  id: string;
  channel_id: string;
  seq: string | number | null;
  thread_root_id: string | null;
  kind: "user" | "system";
  body_json: RichTextDoc | null;
  body_text: string;
  system_event: ChatSystemEvent | null;
  client_message_id: string | null;
  mentioned_user_ids: string[] | null;
  mentions_all: boolean;
  reply_count: number;
  last_reply_at: Date | null;
  edited_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
  author: UserRefJson | null;
  reactions: ReactionJson[] | null;
  attachments: AttachmentJson[] | null;
};

/**
 * Columns for MessageRow; expects `m` (messages) in scope. Deleted messages return no reactions or
 * attachments (the body is blanked in the mapper).
 */
export const messageColumnsSql = (sql: QuerySql, viewerId: string) => sql`
  m.id, m.channel_id, m.seq, m.thread_root_id, m.kind, m.body_json, m.body_text, m.system_event,
  m.client_message_id, m.mentioned_user_ids, m.mentions_all, m.reply_count, m.last_reply_at, m.edited_at, m.deleted_at, m.created_at,
  (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = m.author_user_id) AS author,
  CASE WHEN m.deleted_at IS NOT NULL THEN '[]'::json ELSE (
    SELECT coalesce(json_agg(json_build_object('emoji', r.emoji, 'count', r.n, 'reacted_by_me', r.mine, 'users', r.users)
      ORDER BY r.first_at, r.emoji), '[]'::json)
    FROM (
      SELECT mr.emoji, count(*)::int AS n, bool_or(mr.user_id = ${viewerId}::uuid) AS mine, min(mr.created_at) AS first_at,
        ${reactorsAggSql(sql)} AS users
      FROM public.message_reactions mr
      LEFT JOIN public.app_users au ON au.id = mr.user_id
      WHERE mr.message_id = m.id
      GROUP BY mr.emoji
    ) r
  ) END AS reactions,
  CASE WHEN m.deleted_at IS NOT NULL OR m.attachment_count = 0 THEN '[]'::json ELSE (
    SELECT coalesce(json_agg(json_build_object('id', a.id, 'file_name', a.file_name, 'mime_type', a.mime_type, 'size_bytes', a.size_bytes)
      ORDER BY a.created_at, a.id), '[]'::json)
    FROM public.message_attachments a
    WHERE a.organization_id = m.organization_id AND a.message_id = m.id AND a.deleted_at IS NULL AND a.status = 'ready'
  ) END AS attachments
`;

export const isInlineImage = (mimeType: string) => inlineImageTypes.has(mimeType.toLowerCase());

export const toAttachment = (row: AttachmentJson): ChatAttachment => ({
  id: row.id,
  fileName: row.file_name,
  mimeType: row.mime_type,
  sizeBytes: Number(row.size_bytes),
  isImage: isInlineImage(row.mime_type)
});

export const toMessage = (row: MessageRow): ChatMessage => {
  const deleted = row.deleted_at !== null;
  return {
    id: row.id,
    channelId: row.channel_id,
    seq: row.seq === null ? null : toSeq(row.seq),
    threadRootId: row.thread_root_id,
    kind: row.kind,
    author: toUserRef(row.author),
    body: deleted ? null : row.body_json,
    text: deleted ? "" : row.body_text,
    systemEvent: deleted ? null : row.system_event,
    clientMessageId: row.client_message_id,
    mentions: deleted ? [] : (row.mentioned_user_ids ?? []),
    mentionsAll: !deleted && row.mentions_all === true,
    attachments: deleted ? [] : (row.attachments ?? []).map(toAttachment),
    reactions: deleted ? [] : (row.reactions ?? []).map(toReactionSummary),
    replyCount: Number(row.reply_count),
    lastReplyAt: toNullableIso(row.last_reply_at),
    isEdited: row.edited_at !== null,
    editedAt: toNullableIso(row.edited_at),
    isDeleted: deleted,
    deletedAt: toNullableIso(row.deleted_at),
    createdAt: toIso(row.created_at)
  };
};
