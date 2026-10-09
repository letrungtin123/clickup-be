import { z } from "zod";

import { createCursorPageSchema, PageInfoSchema } from "./pagination.js";
import { RichTextDocSchema } from "./rich-text.js";
import { SignedStorageUrlSchema, UserRefSchema } from "./work.js";

/**
 * Chat contract (PD-001 / PD-002): public & private channels, 1:1 and group DMs, messages, threads,
 * reactions, mentions, attachments, read state, and search. Shared verbatim between FE and BE.
 *
 * Ordering model: every top-level message (user or system) gets a per-channel `seq` (1, 2, 3, ...).
 * Thread replies have `seq = null` and `threadRootId` set. Unread = lastMessageSeq - lastReadSeq.
 */

const Id = z.string().uuid();
const IsoDate = z.string().datetime({ offset: true });
const Seq = z.number().int().min(0);

// Enums ------------------------------------------------------------------------------------------

export const ChannelKindSchema = z.enum(["public", "private", "dm", "group_dm"]);
export type ChannelKind = z.infer<typeof ChannelKindSchema>;
export const NamedChannelKindSchema = z.enum(["public", "private"]);
export type NamedChannelKind = z.infer<typeof NamedChannelKindSchema>;
export const isDirectKind = (kind: ChannelKind) => kind === "dm" || kind === "group_dm";

export const ChannelAccessSchema = z.enum(["view", "submit"]);
export type ChannelAccess = z.infer<typeof ChannelAccessSchema>;
export const ChannelRoleSchema = z.enum(["member", "admin"]);
export type ChannelRole = z.infer<typeof ChannelRoleSchema>;
export const NotifyLevelSchema = z.enum(["all", "mentions", "none"]);
export type NotifyLevel = z.infer<typeof NotifyLevelSchema>;

/** Limits shared by FE and BE. */
export const chatLimits = {
  channelNameMax: 80,
  descriptionMax: 1000,
  topicMax: 250,
  createMembersMax: 200,
  addMembersMax: 100,
  dmOthersMax: 8,
  attachmentsPerMessage: 10,
  attachmentBytesMax: 50 * 1024 * 1024,
  reactionsDistinctMax: 50,
  emojiMaxCodePoints: 32,
  pageMax: 100,
  sidebarMax: 500,
  /** Mention badge counts are capped; clients render "99+". */
  mentionCountCap: 100
} as const;

// Text fields --------------------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex -- rejecting control characters is intended
const controlChars = /[\u0000-\u001f\u007f]/;

/** Display name: trimmed, inner whitespace collapsed, leading "#" dropped, 1-80 chars, no control chars. */
export const ChannelNameSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim().replace(/^#+\s*/, ""))
  .pipe(
    z
      .string()
      .min(1)
      .max(chatLimits.channelNameMax)
      .refine((value) => !controlChars.test(value), "Channel name contains invalid characters.")
  );

const OptionalText = (max: number) => z.string().trim().max(max).nullable().optional();

// Reactions: unicode emoji sequences or :shortcode: -----------------------------------------------

const emojiSequencePattern =
  /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|‍|️|⃣|[#*0-9](?=️?⃣)|[\u{E0020}-\u{E007F}])+$/u;
const emojiAnchorPattern = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;
const emojiShortcodePattern = /^:[a-z0-9_+-]{1,30}:$/;

/** True for a single emoji / emoji sequence (ZWJ, skin tones, flags, keycaps) or a `:shortcode:`, ≤ 32 code points. */
export const isValidReactionEmoji = (value: string) => {
  const codePoints = [...value].length;
  if (codePoints < 1 || codePoints > chatLimits.emojiMaxCodePoints) {
    return false;
  }
  if (emojiShortcodePattern.test(value)) {
    return true;
  }
  return emojiSequencePattern.test(value) && emojiAnchorPattern.test(value);
};

export const ReactionEmojiSchema = z.string().refine(isValidReactionEmoji, "Invalid emoji.");

// Channels -----------------------------------------------------------------------------------------

/** Viewer-independent channel metadata (safe to broadcast to the channel room). */
export const ChatChannelInfoSchema = z.object({
  id: Id,
  kind: ChannelKindSchema,
  /** null for dm / group_dm (clients render participant names). */
  name: z.string().nullable(),
  description: z.string().nullable(),
  topic: z.string().nullable(),
  createdBy: Id.nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
  archivedAt: IsoDate.nullable(),
  memberCount: z.number().int(),
  lastMessageSeq: Seq,
  lastMessageAt: IsoDate.nullable()
});
export type ChatChannelInfo = z.infer<typeof ChatChannelInfoSchema>;

/** Channel as seen by the caller (sidebar entry). */
export const ChatChannelSchema = ChatChannelInfoSchema.extend({
  isMember: z.boolean(),
  myAccess: ChannelAccessSchema.nullable(),
  myRole: ChannelRoleSchema.nullable(),
  notifyLevel: NotifyLevelSchema.nullable(),
  lastReadSeq: Seq.nullable(),
  unreadCount: z.number().int().min(0),
  /** Unread top-level messages mentioning the caller, capped at chatLimits.mentionCountCap. */
  mentionCount: z.number().int().min(0),
  /** dm / group_dm: the other participants. Empty for channels. */
  participants: z.array(UserRefSchema)
});
export type ChatChannel = z.infer<typeof ChatChannelSchema>;

export const ChannelCapabilitiesSchema = z.object({
  canRead: z.boolean(),
  canPost: z.boolean(),
  canUpdate: z.boolean(),
  canChangeKind: z.boolean(),
  canArchive: z.boolean(),
  canDelete: z.boolean(),
  canManageMembers: z.boolean(),
  canModerate: z.boolean(),
  canJoin: z.boolean(),
  canLeave: z.boolean()
});
export type ChannelCapabilities = z.infer<typeof ChannelCapabilitiesSchema>;

export const ChatChannelDetailSchema = ChatChannelSchema.extend({ capabilities: ChannelCapabilitiesSchema });
export type ChatChannelDetail = z.infer<typeof ChatChannelDetailSchema>;

export const ChatChannelCollectionSchema = z.object({ items: z.array(ChatChannelSchema) });
export type ChatChannelCollection = z.infer<typeof ChatChannelCollectionSchema>;

export const ChannelBrowseQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  /** Superadmins only: also list private channels they are not a member of (for management). */
  includePrivate: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(chatLimits.pageMax).default(50)
});
export type ChannelBrowseQuery = z.infer<typeof ChannelBrowseQuerySchema>;
export const ChannelBrowsePageSchema = createCursorPageSchema(ChatChannelInfoSchema);
export type ChannelBrowsePage = z.infer<typeof ChannelBrowsePageSchema>;

export const CreateChannelRequestSchema = z
  .object({
    kind: NamedChannelKindSchema.default("public"),
    name: ChannelNameSchema,
    description: OptionalText(chatLimits.descriptionMax),
    memberIds: z.array(Id).max(chatLimits.createMembersMax).default([])
  })
  .strict();
export type CreateChannelRequest = z.infer<typeof CreateChannelRequestSchema>;

export const UpdateChannelRequestSchema = z
  .object({
    name: ChannelNameSchema.optional(),
    description: OptionalText(chatLimits.descriptionMax),
    topic: OptionalText(chatLimits.topicMax),
    /** public <-> private; channel admins (and superadmins) only. */
    kind: NamedChannelKindSchema.optional()
  })
  .strict()
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), "Nothing to update.");
export type UpdateChannelRequest = z.infer<typeof UpdateChannelRequestSchema>;

/** POST /dms — get-or-create a 1:1 (one other user) or group DM (2–8 others). The caller is implied. */
export const OpenDmRequestSchema = z
  .object({ userIds: z.array(Id).min(1).max(chatLimits.dmOthersMax) })
  .strict();
export type OpenDmRequest = z.infer<typeof OpenDmRequestSchema>;

// Members ------------------------------------------------------------------------------------------

export const ChatChannelMemberSchema = z.object({
  user: UserRefSchema,
  access: ChannelAccessSchema,
  role: ChannelRoleSchema,
  joinedAt: IsoDate
});
export type ChatChannelMember = z.infer<typeof ChatChannelMemberSchema>;

export const ChannelMemberQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(chatLimits.pageMax).default(50)
});
export type ChannelMemberQuery = z.infer<typeof ChannelMemberQuerySchema>;
export const ChannelMemberPageSchema = createCursorPageSchema(ChatChannelMemberSchema);
export type ChannelMemberPage = z.infer<typeof ChannelMemberPageSchema>;

export const AddChannelMembersRequestSchema = z
  .object({
    userIds: z.array(Id).min(1).max(chatLimits.addMembersMax),
    access: ChannelAccessSchema.default("submit")
  })
  .strict();
export type AddChannelMembersRequest = z.infer<typeof AddChannelMembersRequestSchema>;
/** Members that were newly added (already-present members are left unchanged and omitted). */
export const AddChannelMembersResponseSchema = z.object({ items: z.array(ChatChannelMemberSchema) });
export type AddChannelMembersResponse = z.infer<typeof AddChannelMembersResponseSchema>;

export const UpdateChannelMemberRequestSchema = z
  .object({ access: ChannelAccessSchema.optional(), role: ChannelRoleSchema.optional() })
  .strict()
  .refine((value) => value.access !== undefined || value.role !== undefined, "Nothing to update.");
export type UpdateChannelMemberRequest = z.infer<typeof UpdateChannelMemberRequestSchema>;

export const UpdateMyMembershipRequestSchema = z.object({ notifyLevel: NotifyLevelSchema }).strict();
export type UpdateMyMembershipRequest = z.infer<typeof UpdateMyMembershipRequestSchema>;

export const MyMembershipSchema = z.object({
  channelId: Id,
  access: ChannelAccessSchema,
  role: ChannelRoleSchema,
  notifyLevel: NotifyLevelSchema,
  lastReadSeq: Seq
});
export type MyMembership = z.infer<typeof MyMembershipSchema>;

// Messages -----------------------------------------------------------------------------------------

export const ChatAttachmentSchema = z.object({
  id: Id,
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  /** Raster image safe to render inline; everything else downloads. */
  isImage: z.boolean()
});
export type ChatAttachment = z.infer<typeof ChatAttachmentSchema>;

export const ReactionSummarySchema = z.object({
  emoji: z.string(),
  count: z.number().int().min(1),
  reactedByMe: z.boolean()
});
export type ReactionSummary = z.infer<typeof ReactionSummarySchema>;

export const ChatSystemEventTypeSchema = z.enum([
  "created",
  "joined",
  "left",
  "members_added",
  "member_removed",
  "renamed",
  "topic_changed",
  "kind_changed",
  "archived",
  "unarchived"
]);
export type ChatSystemEventType = z.infer<typeof ChatSystemEventTypeSchema>;

export const ChatSystemEventSchema = z.object({
  type: ChatSystemEventTypeSchema,
  actorId: Id.nullable(),
  userIds: z.array(Id).optional(),
  name: z.string().optional(),
  previousName: z.string().optional(),
  topic: z.string().nullable().optional(),
  kind: ChannelKindSchema.optional()
});
export type ChatSystemEvent = z.infer<typeof ChatSystemEventSchema>;

export const ChatMessageSchema = z.object({
  id: Id,
  channelId: Id,
  /** Top-level messages only; null for thread replies. */
  seq: z.number().int().nullable(),
  threadRootId: Id.nullable(),
  kind: z.enum(["user", "system"]),
  author: UserRefSchema.nullable(),
  /** null when deleted (tombstone) or for system messages. */
  body: RichTextDocSchema.nullable(),
  /** Server-derived plain text ("" when deleted). System messages carry a readable summary. */
  text: z.string(),
  systemEvent: ChatSystemEventSchema.nullable(),
  clientMessageId: Id.nullable(),
  mentions: z.array(Id),
  attachments: z.array(ChatAttachmentSchema),
  reactions: z.array(ReactionSummarySchema),
  replyCount: z.number().int().min(0),
  lastReplyAt: IsoDate.nullable(),
  isEdited: z.boolean(),
  editedAt: IsoDate.nullable(),
  isDeleted: z.boolean(),
  deletedAt: IsoDate.nullable(),
  createdAt: IsoDate
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/**
 * History window. Exactly one of `before` (older than seq), `after` (newer than seq), `around`
 * (message id, centered) may be given; none = latest page. Items are always oldest -> newest.
 */
export const MessageHistoryQuerySchema = z
  .object({
    before: z.coerce.number().int().min(1).optional(),
    after: z.coerce.number().int().min(0).optional(),
    around: Id.optional(),
    limit: z.coerce.number().int().min(1).max(chatLimits.pageMax).default(50)
  })
  .refine(
    (value) => [value.before, value.after, value.around].filter((entry) => entry !== undefined).length <= 1,
    "Use only one of before, after, around."
  );
export type MessageHistoryQuery = z.infer<typeof MessageHistoryQuerySchema>;

export const MessageHistorySchema = z.object({
  items: z.array(ChatMessageSchema),
  hasOlder: z.boolean(),
  hasNewer: z.boolean(),
  /** Caller's read marker (null when not a member, e.g. previewing a public channel). */
  lastReadSeq: Seq.nullable()
});
export type MessageHistory = z.infer<typeof MessageHistorySchema>;

export const SendMessageRequestSchema = z
  .object({
    body: RichTextDocSchema,
    /** Client-generated id; retries with the same id never create a duplicate. */
    clientMessageId: Id,
    threadRootId: Id.nullable().optional(),
    attachmentIds: z.array(Id).max(chatLimits.attachmentsPerMessage).default([])
  })
  .strict();
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

export const EditMessageRequestSchema = z.object({ body: RichTextDocSchema }).strict();
export type EditMessageRequest = z.infer<typeof EditMessageRequestSchema>;

export const ThreadQuerySchema = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(chatLimits.pageMax).default(50)
});
export type ThreadQuery = z.infer<typeof ThreadQuerySchema>;

/** Root + replies oldest -> newest; `pageInfo.nextCursor` continues with newer replies. */
export const ThreadPageSchema = z.object({
  root: ChatMessageSchema,
  items: z.array(ChatMessageSchema),
  pageInfo: PageInfoSchema
});
export type ThreadPage = z.infer<typeof ThreadPageSchema>;

export const ReactionRequestSchema = z.object({ emoji: ReactionEmojiSchema }).strict();
export const ReactionQuerySchema = z.object({ emoji: ReactionEmojiSchema });
export const ReactionResultSchema = z.object({
  messageId: Id,
  emoji: z.string(),
  count: z.number().int().min(0),
  reactedByMe: z.boolean()
});
export type ReactionResult = z.infer<typeof ReactionResultSchema>;

// Read state ---------------------------------------------------------------------------------------

export const MarkReadRequestSchema = z.object({ seq: Seq }).strict();
export type MarkReadRequest = z.infer<typeof MarkReadRequestSchema>;

export const ReadStateSchema = z.object({
  channelId: Id,
  lastReadSeq: Seq,
  unreadCount: z.number().int().min(0),
  mentionCount: z.number().int().min(0)
});
export type ReadState = z.infer<typeof ReadStateSchema>;

// Attachments --------------------------------------------------------------------------------------

export const ChatUploadRequestSchema = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(3).max(255),
    sizeBytes: z.number().int().min(1).max(chatLimits.attachmentBytesMax)
  })
  .strict();
export type ChatUploadRequest = z.infer<typeof ChatUploadRequestSchema>;

/** Browser PUTs the file body to `uploadUrl`, then calls POST /chat-attachments/:id/complete. */
export const ChatUploadTicketSchema = z.object({
  attachmentId: Id,
  uploadUrl: SignedStorageUrlSchema,
  expiresAt: IsoDate
});
export type ChatUploadTicket = z.infer<typeof ChatUploadTicketSchema>;

export const ChatAttachmentUrlRequestSchema = z.object({ ids: z.array(Id).min(1).max(50) }).strict();
/** Unauthorized or unknown ids are silently omitted. */
export const ChatAttachmentUrlCollectionSchema = z.object({
  items: z.array(z.object({ id: Id, url: SignedStorageUrlSchema, expiresAt: IsoDate }))
});
export type ChatAttachmentUrlCollection = z.infer<typeof ChatAttachmentUrlCollectionSchema>;

// Search & mentions --------------------------------------------------------------------------------

export const ChatSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
  channelId: Id.optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});
export type ChatSearchQuery = z.infer<typeof ChatSearchQuerySchema>;

export const ChatMentionsQuerySchema = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(chatLimits.pageMax).default(30)
});
export type ChatMentionsQuery = z.infer<typeof ChatMentionsQuerySchema>;

export const ChatSearchHitSchema = z.object({
  messageId: Id,
  channelId: Id,
  channelKind: ChannelKindSchema,
  /** null for DMs. */
  channelName: z.string().nullable(),
  seq: z.number().int().nullable(),
  threadRootId: Id.nullable(),
  author: UserRefSchema.nullable(),
  /** Plain text, truncated to 500 characters. */
  text: z.string(),
  createdAt: IsoDate
});
export type ChatSearchHit = z.infer<typeof ChatSearchHitSchema>;
export const ChatSearchPageSchema = createCursorPageSchema(ChatSearchHitSchema);
export type ChatSearchPage = z.infer<typeof ChatSearchPageSchema>;

export const ChatOkSchema = z.object({ ok: z.literal(true) });

// Realtime payloads (see contracts/realtime.ts) ----------------------------------------------------

export type ThreadRootSummary = { id: string; replyCount: number; lastReplyAt: string | null };

/** `chat:message` → room channel:<id>. Thread replies carry the updated root summary. */
export type ChatMessageEvent = {
  channelId: string;
  message: ChatMessage;
  threadRoot: ThreadRootSummary | null;
};

/** `chat:message:updated` → room channel:<id>. Viewer-independent subset (merge into the cached message). */
export type ChatMessageUpdatedEvent = {
  channelId: string;
  messageId: string;
  threadRootId: string | null;
  body: ChatMessage["body"];
  text: string;
  mentions: string[];
  editedAt: string;
};

/** `chat:message:deleted` → room channel:<id>. */
export type ChatMessageDeletedEvent = {
  channelId: string;
  messageId: string;
  threadRootId: string | null;
  deletedAt: string;
  threadRoot: ThreadRootSummary | null;
};

/** `chat:reaction` → room channel:<id>. `count` is the new total for that emoji. */
export type ChatReactionEvent = {
  channelId: string;
  messageId: string;
  threadRootId: string | null;
  emoji: string;
  count: number;
  userId: string;
  added: boolean;
};

/**
 * `chat:channel` → affected users' rooms (joined/left) and the channel room (updated/archived/deleted).
 * On "joined" clients room:join channel:<id> and refetch the sidebar entry; on "left"/"deleted" they
 * drop it (the server also evicts their sockets from the room).
 */
export type ChatChannelEvent = {
  kind: "joined" | "left" | "updated" | "archived" | "deleted";
  channelId: string;
  channel: ChatChannelInfo | null;
  /** Users the change is about (joined/left); empty for metadata changes. */
  userIds: string[];
  actorId: string;
  at: string;
};

/** `chat:read` → the reader's own user room (multi-device sync). */
export type ChatReadEvent = ReadState;
