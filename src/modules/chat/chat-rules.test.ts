import { describe, expect, it } from "vitest";

import {
  ChannelNameSchema,
  CreateChannelRequestSchema,
  isValidReactionEmoji,
  MessageHistoryQuerySchema,
  OpenDmRequestSchema,
  ReactionEmojiSchema,
  SendMessageRequestSchema,
  UpdateChannelRequestSchema
} from "../../contracts/chat.js";
import { AppError } from "../../lib/app-error.js";
import { encodeCursor } from "../../lib/db-types.js";
import {
  buildDmKey,
  computeChannelCapabilities,
  decodeNameCursor,
  decodeTimeCursor,
  encodeNameCursor,
  encodeTimeCursor,
  findInvalidMentions,
  hasMessageContent,
  mentionRecipients,
  mentionScope,
  nextReadSeq,
  resolveHistoryWindow,
  systemMessageText,
  toSeq,
  unreadCount,
  type CapabilityInput
} from "./chat-rules.js";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const D = "dddddddd-0000-4000-8000-000000000004";

const noPerms = { view: false, update: false, delete: false, manageMembers: false };
const viewOnly = { ...noPerms, view: true };
const allPerms = { view: true, update: true, delete: true, manageMembers: true };

const caps = (overrides: Partial<CapabilityInput>) =>
  computeChannelCapabilities({
    kind: "public",
    archived: false,
    member: null,
    permissions: viewOnly,
    superadmin: false,
    ...overrides
  });

describe("buildDmKey", () => {
  it("sorts and de-duplicates participants including the caller", () => {
    const first = buildDmKey(B, [A, A.toUpperCase()]);
    const second = buildDmKey(A, [B]);
    expect(first.key).toBe(`${A},${B}`);
    expect(second.key).toBe(first.key);
    expect(first.kind).toBe("dm");
    expect(first.otherIds).toEqual([A]);
  });

  it("is independent of order and the caller's position for group DMs", () => {
    const one = buildDmKey(C, [B, A]);
    const two = buildDmKey(A, [C, B]);
    expect(one.key).toBe(two.key);
    expect(one.kind).toBe("group_dm");
    expect(one.participantIds).toEqual([A, B, C]);
  });

  it("ignores the caller in the list and rejects self-only DMs", () => {
    expect(buildDmKey(A, [A, B]).participantIds).toEqual([A, B]);
    expect(() => buildDmKey(A, [A])).toThrow(AppError);
    expect(() => buildDmKey(A, [])).toThrow(AppError);
  });

  it("caps group DMs at 9 participants", () => {
    const others = Array.from({ length: 9 }, (_, index) => `00000000-0000-4000-8000-00000000001${index}`);
    expect(() => buildDmKey(A, others)).toThrow(AppError);
    expect(buildDmKey(A, others.slice(0, 8)).participantIds).toHaveLength(9);
  });
});

describe("computeChannelCapabilities", () => {
  it("never exposes DMs to non-participants, superadmins included", () => {
    expect(caps({ kind: "dm", permissions: allPerms, superadmin: true })).toBeNull();
    expect(caps({ kind: "group_dm", permissions: allPerms, superadmin: true })).toBeNull();
  });

  it("gives DM participants submit but no management", () => {
    const result = caps({ kind: "dm", member: { access: "submit", role: "member" }, permissions: noPerms });
    expect(result).toMatchObject({ canRead: true, canPost: true, canManageMembers: false, canDelete: false, canLeave: false, canModerate: false });
  });

  it("hides private channels from non-members but not from superadmins", () => {
    expect(caps({ kind: "private", permissions: allPerms })).toBeNull();
    const admin = caps({ kind: "private", permissions: allPerms, superadmin: true });
    expect(admin).toMatchObject({ canRead: false, canPost: false, canManageMembers: true, canDelete: true, canModerate: false });
  });

  it("requires channel.view for named channels", () => {
    expect(caps({ kind: "public", permissions: noPerms })).toBeNull();
    expect(caps({ kind: "private", permissions: noPerms, member: { access: "submit", role: "admin" } })).toBeNull();
  });

  it("lets anyone with channel.view preview and join public channels", () => {
    expect(caps({ kind: "public" })).toMatchObject({ canRead: true, canPost: false, canJoin: true, canLeave: false });
  });

  it("separates view and submit members", () => {
    expect(caps({ member: { access: "view", role: "member" } })).toMatchObject({ canRead: true, canPost: false, canJoin: false });
    expect(caps({ member: { access: "submit", role: "member" } })).toMatchObject({ canPost: true, canUpdate: false, canModerate: false });
  });

  it("makes archived channels read-only and not joinable", () => {
    expect(caps({ archived: true, member: { access: "submit", role: "admin" } })).toMatchObject({ canPost: false, canArchive: true });
    expect(caps({ archived: true })).toMatchObject({ canJoin: false });
  });

  it("gives channel admins management without global permissions", () => {
    const result = caps({ kind: "private", member: { access: "submit", role: "admin" } });
    expect(result).toMatchObject({ canUpdate: true, canChangeKind: true, canManageMembers: true, canDelete: true, canModerate: true });
  });

  it("applies global channel permissions to visible channels only", () => {
    const manager = { view: true, update: true, delete: false, manageMembers: true };
    expect(caps({ permissions: manager })).toMatchObject({ canUpdate: true, canManageMembers: true, canChangeKind: false, canDelete: false });
    expect(caps({ kind: "private", permissions: manager })).toBeNull();
  });
});

describe("mentions", () => {
  it("uses organization scope only for public channels", () => {
    expect(mentionScope("public")).toBe("organization");
    expect(mentionScope("private")).toBe("members");
    expect(mentionScope("dm")).toBe("members");
    expect(mentionScope("group_dm")).toBe("members");
  });

  it("reports ineligible mentions case-insensitively", () => {
    expect(findInvalidMentions([A, B, C.toUpperCase()], [A, C])).toEqual([B]);
    expect(findInvalidMentions([A, A], [A])).toEqual([]);
    expect(findInvalidMentions([D], [])).toEqual([D]);
  });

  it("never notifies the author", () => {
    expect(mentionRecipients([A, B, A], A)).toEqual([B]);
  });
});

describe("read state", () => {
  it("computes unread as a difference of sequences", () => {
    expect(unreadCount(10, 7)).toBe(3);
    expect(unreadCount(5, 5)).toBe(0);
    expect(unreadCount(5, 9)).toBe(0);
  });

  it("only moves the read marker forward and never past the newest message", () => {
    expect(nextReadSeq(5, 8, 10)).toBe(8);
    expect(nextReadSeq(5, 3, 10)).toBe(5);
    expect(nextReadSeq(5, 99, 10)).toBe(10);
  });

  it("parses int8 strings", () => {
    expect(toSeq("42")).toBe(42);
    expect(toSeq(null)).toBe(0);
  });
});

describe("reaction emoji", () => {
  it.each(["👍", "❤️", "👍🏽", "👨‍👩‍👧‍👦", "🇻🇳", "#️⃣", "🏴󠁧󠁢󠁥󠁮󠁧󠁿", ":party_parrot:", "✅"])("accepts %s", (emoji) => {
    expect(isValidReactionEmoji(emoji)).toBe(true);
  });

  it.each(["", "a", "hello", "👍 ", "<script>", "1", ":Bad Name:", "👍".repeat(33), "‍"])("rejects %j", (emoji) => {
    expect(isValidReactionEmoji(emoji)).toBe(false);
  });

  it("is enforced by the request schema", () => {
    expect(ReactionEmojiSchema.safeParse("🎉").success).toBe(true);
    expect(ReactionEmojiSchema.safeParse("lol").success).toBe(false);
  });
});

describe("history window", () => {
  it("defaults to the latest page", () => {
    expect(resolveHistoryWindow(MessageHistoryQuerySchema.parse({}))).toEqual({ mode: "latest", limit: 50 });
  });

  it("parses before/after from query strings", () => {
    expect(resolveHistoryWindow(MessageHistoryQuerySchema.parse({ before: "20", limit: "10" }))).toEqual({ mode: "before", seq: 20, limit: 10 });
    expect(resolveHistoryWindow(MessageHistoryQuerySchema.parse({ after: "0" }))).toEqual({ mode: "after", seq: 0, limit: 50 });
  });

  it("splits an around window so the anchor side gets the larger half", () => {
    const window = resolveHistoryWindow(MessageHistoryQuerySchema.parse({ around: A, limit: "5" }));
    expect(window).toEqual({ mode: "around", messageId: A, limit: 5, olderLimit: 2, newerLimit: 3 });
  });

  it("rejects ambiguous or unbounded queries", () => {
    expect(MessageHistoryQuerySchema.safeParse({ before: "5", after: "1" }).success).toBe(false);
    expect(MessageHistoryQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(MessageHistoryQuerySchema.safeParse({ before: "-1" }).success).toBe(false);
    expect(MessageHistoryQuerySchema.safeParse({ around: "not-a-uuid" }).success).toBe(false);
  });
});

describe("cursors", () => {
  it("round-trips microsecond timestamp cursors", () => {
    const cursor = encodeTimeCursor("2026-10-09 10:11:12.123456+00", A);
    expect(decodeTimeCursor(cursor)).toEqual({ at: "2026-10-09 10:11:12.123456+00", id: A });
    expect(decodeTimeCursor(undefined)).toBeNull();
  });

  it("rejects tampered cursors", () => {
    expect(() => decodeTimeCursor("garbage")).toThrow(AppError);
    expect(() => decodeTimeCursor(encodeCursor(["1; DROP TABLE x", A]))).toThrow(AppError);
    expect(() => decodeTimeCursor(encodeCursor(["2026-10-09 10:11:12+00", "nope"]))).toThrow(AppError);
    expect(() => decodeNameCursor(encodeCursor([1, A]))).toThrow(AppError);
  });

  it("round-trips name cursors", () => {
    expect(decodeNameCursor(encodeNameCursor("general", B))).toEqual({ name: "general", id: B });
  });
});

describe("contract validation", () => {
  it("normalizes channel names", () => {
    expect(ChannelNameSchema.parse("  #  Dự   án   A ")).toBe("Dự án A");
    expect(ChannelNameSchema.safeParse("   ").success).toBe(false);
    expect(ChannelNameSchema.safeParse("x".repeat(81)).success).toBe(false);
    expect(ChannelNameSchema.safeParse("bad\u0007name").success).toBe(false);
  });

  it("bounds channel creation and DM requests", () => {
    expect(CreateChannelRequestSchema.parse({ name: "general" })).toMatchObject({ kind: "public", memberIds: [] });
    expect(CreateChannelRequestSchema.safeParse({ name: "x", kind: "dm" }).success).toBe(false);
    expect(CreateChannelRequestSchema.safeParse({ name: "x", memberIds: Array(201).fill(A) }).success).toBe(false);
    expect(OpenDmRequestSchema.safeParse({ userIds: [] }).success).toBe(false);
    expect(OpenDmRequestSchema.safeParse({ userIds: Array(9).fill(A) }).success).toBe(false);
    expect(UpdateChannelRequestSchema.safeParse({}).success).toBe(false);
  });

  it("requires a client message id and bounds attachments", () => {
    const body = { type: "doc", content: [] };
    expect(SendMessageRequestSchema.safeParse({ body }).success).toBe(false);
    expect(SendMessageRequestSchema.safeParse({ body, clientMessageId: A, attachmentIds: Array(11).fill(B) }).success).toBe(false);
    expect(SendMessageRequestSchema.parse({ body, clientMessageId: A }).attachmentIds).toEqual([]);
  });
});

describe("messages", () => {
  it("requires text or an attachment", () => {
    expect(hasMessageContent("  ", 0)).toBe(false);
    expect(hasMessageContent("", 1)).toBe(true);
    expect(hasMessageContent("hi", 0)).toBe(true);
  });

  it("summarizes system events", () => {
    expect(systemMessageText({ type: "members_added", actorId: A }, "Linh", ["An", "Minh", "Khoa", "Tín"])).toBe(
      "Linh added An, Minh, Khoa and 1 others"
    );
    expect(systemMessageText({ type: "renamed", actorId: A, name: "design" }, "Linh")).toBe('Linh renamed the channel to "design"');
    expect(systemMessageText({ type: "topic_changed", actorId: A, topic: null }, "Linh")).toBe("Linh cleared the topic");
  });
});
