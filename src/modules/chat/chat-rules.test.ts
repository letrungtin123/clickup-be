import { describe, expect, it } from "vitest";

import {
  ChannelBrowseQuerySchema,
  ChannelNameSchema,
  CreateChannelRequestSchema,
  isValidReactionEmoji,
  MessageHistoryQuerySchema,
  OpenDmRequestSchema,
  ReactionEmojiSchema,
  SendMessageRequestSchema,
  UpdateChannelRequestSchema
} from "../../contracts/chat.js";
import type { Department } from "../../contracts/departments.js";
import { DirectoryQuerySchema } from "../../contracts/work.js";
import { AppError } from "../../lib/app-error.js";
import { encodeCursor } from "../../lib/db-types.js";
import {
  areDmColleagues,
  audienceDepartments,
  assertDmColleague,
  buildDmKey,
  computeChannelCapabilities,
  dmDirectoryScope,
  dmOpenRequirement,
  decodeNameCursor,
  decodeTimeCursor,
  encodeNameCursor,
  encodeTimeCursor,
  findInvalidMentions,
  hasMessageContent,
  inChannelDepartment,
  mentionRecipients,
  mentionScope,
  nextReadSeq,
  resolveChannelDepartment,
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
    department: null,
    departments: ["PHOTO_RETOUCH"],
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

  it("keeps the channel admin role for channel admins and superadmins (SEC-API-02)", () => {
    const manager = { view: true, update: true, delete: false, manageMembers: true };
    // channel.manage_members lets you manage members, not promote yourself (or anyone) to admin.
    expect(caps({ permissions: manager, member: { access: "submit", role: "member" } })).toMatchObject({ canManageMembers: true, canManageAdmins: false });
    expect(caps({ member: { access: "submit", role: "admin" } })).toMatchObject({ canManageAdmins: true });
    expect(caps({ kind: "private", permissions: allPerms, superadmin: true })).toMatchObject({ canManageAdmins: true });
    expect(caps({ kind: "dm", member: { access: "submit", role: "member" }, permissions: allPerms })).toMatchObject({ canManageAdmins: false });
  });

  it("opens a department's public channel to that department only (PD-053)", () => {
    // In the department: preview and join as before.
    expect(caps({ department: "PHOTO_RETOUCH" })).toMatchObject({ canRead: true, canPost: false, canJoin: true, canLeave: false });
    // Another department: invisible (404), even with every global channel permission — like a private channel.
    expect(caps({ department: "PRODUCTION" })).toBeNull();
    expect(caps({ department: "PRODUCTION", permissions: allPerms })).toBeNull();
    expect(caps({ department: "PRODUCTION", departments: [] })).toBeNull();
    // The superadmin belongs to every department.
    expect(caps({ department: "PRODUCTION", departments: [], superadmin: true })).toMatchObject({ canRead: true, canJoin: true });
    // Without department (before PD-053): organization-wide.
    expect(caps({ department: null, departments: [] })).toMatchObject({ canRead: true, canJoin: true });
  });

  it("keeps a department channel for its members, who may leave and rejoin (PD-053)", () => {
    // Added by a channel admin although outside the department: a member sees it.
    expect(caps({ department: "PRODUCTION", member: { access: "submit", role: "member" } })).toMatchObject({
      canRead: true,
      canPost: true,
      canLeave: true,
      canJoin: false
    });
    expect(caps({ department: "PHOTO_RETOUCH", member: { access: "submit", role: "member" } })).toMatchObject({ canLeave: true });
    expect(caps({ department: "PHOTO_RETOUCH", archived: true })).toMatchObject({ canRead: true, canJoin: false });
  });
});

describe("department channels (PD-053)", () => {
  const caller = (departments: Department[], superadmin = false) => ({ hasFullOrganizationAuthority: superadmin, departments });
  const code = (run: () => unknown) => {
    try {
      return run();
    } catch (error) {
      return error instanceof AppError ? `${error.statusCode} ${error.code} ${error.message}` : "other";
    }
  };

  it("audience: the department's members and the superadmin; no department = everyone", () => {
    expect(inChannelDepartment("PHOTO_RETOUCH", { superadmin: false, departments: ["PHOTO_RETOUCH"] })).toBe(true);
    expect(inChannelDepartment("PRODUCTION", { superadmin: false, departments: ["PHOTO_RETOUCH"] })).toBe(false);
    expect(inChannelDepartment("PRODUCTION", { superadmin: true, departments: [] })).toBe(true);
    expect(inChannelDepartment(null, { superadmin: false, departments: [] })).toBe(true);
  });

  it("a new public channel takes the requested department, which must be the caller's", () => {
    expect(code(() => resolveChannelDepartment(caller(["PHOTO_RETOUCH", "PRODUCTION"]), "PRODUCTION"))).toBe("PRODUCTION");
    expect(code(() => resolveChannelDepartment(caller(["PHOTO_RETOUCH"]), "PRODUCTION"))).toBe(
      "403 DEPARTMENT_FORBIDDEN Bạn không thuộc phòng ban này."
    );
    // The superadmin may pick any department.
    expect(code(() => resolveChannelDepartment(caller(["PHOTO_RETOUCH", "PRODUCTION"], true), "PRODUCTION"))).toBe("PRODUCTION");
  });

  it("without a choice: the caller's only department, otherwise 400 CHANNEL_DEPARTMENT_REQUIRED", () => {
    expect(code(() => resolveChannelDepartment(caller(["PRODUCTION"]), undefined))).toBe("PRODUCTION");
    expect(code(() => resolveChannelDepartment(caller(["PHOTO_RETOUCH", "PRODUCTION"]), undefined))).toBe(
      "400 CHANNEL_DEPARTMENT_REQUIRED Chọn phòng ban cho kênh public."
    );
    expect(code(() => resolveChannelDepartment(caller(["PHOTO_RETOUCH", "PRODUCTION"], true), undefined))).toBe(
      "400 CHANNEL_DEPARTMENT_REQUIRED Chọn phòng ban cho kênh public."
    );
    expect(code(() => resolveChannelDepartment(caller([]), undefined))).toBe("400 CHANNEL_DEPARTMENT_REQUIRED Chọn phòng ban cho kênh public.");
  });

  it("the contract carries the department on create and update", () => {
    expect(CreateChannelRequestSchema.parse({ name: "chung", department: "PRODUCTION" })).toMatchObject({ kind: "public", department: "PRODUCTION" });
    expect(CreateChannelRequestSchema.parse({ name: "chung" }).department).toBeUndefined();
    expect(CreateChannelRequestSchema.safeParse({ name: "chung", department: "SALES" }).success).toBe(false);
    expect(UpdateChannelRequestSchema.parse({ kind: "public", department: "PHOTO_RETOUCH" })).toEqual({ kind: "public", department: "PHOTO_RETOUCH" });
    expect(UpdateChannelRequestSchema.safeParse({ department: "nope" }).success).toBe(false);
  });
});

describe("chat follows the department switcher (PD-054)", () => {
  const caller = (departments: Department[], superadmin = false) => ({ hasFullOrganizationAuthority: superadmin, departments });
  const code = (run: () => unknown) => {
    try {
      return run();
    } catch (error) {
      return error instanceof AppError ? `${error.statusCode} ${error.code} ${error.message}` : "other";
    }
  };

  it("a private channel resolves its department like a public one, with its own wording", () => {
    expect(code(() => resolveChannelDepartment(caller(["PRODUCTION"]), undefined, "private"))).toBe("PRODUCTION");
    expect(code(() => resolveChannelDepartment(caller(["PHOTO_RETOUCH"]), "PRODUCTION", "private"))).toBe(
      "403 DEPARTMENT_FORBIDDEN Bạn không thuộc phòng ban này."
    );
    expect(code(() => resolveChannelDepartment(caller(["PHOTO_RETOUCH", "PRODUCTION"], true), undefined, "private"))).toBe(
      "400 CHANNEL_DEPARTMENT_REQUIRED Chọn phòng ban cho kênh riêng tư."
    );
    expect(CreateChannelRequestSchema.parse({ kind: "private", name: "nhom", department: "PRODUCTION" })).toMatchObject({
      kind: "private",
      department: "PRODUCTION"
    });
  });

  it("a channel is shown in its department; without one, in every department", () => {
    expect(audienceDepartments("public", "PRODUCTION", null)).toEqual(["PRODUCTION"]);
    expect(audienceDepartments("private", "PHOTO_RETOUCH", null)).toEqual(["PHOTO_RETOUCH"]);
    expect(audienceDepartments("public", null, null)).toEqual(["PHOTO_RETOUCH", "PRODUCTION"]);
    expect(audienceDepartments("private", null, undefined)).toEqual(["PHOTO_RETOUCH", "PRODUCTION"]);
    // A named channel follows its own department, never its members'.
    expect(audienceDepartments("private", "PRODUCTION", ["PHOTO_RETOUCH"])).toEqual(["PRODUCTION"]);
  });

  it("a DM is shown in every department of the other participants (stable order); none → everywhere", () => {
    expect(audienceDepartments("dm", null, ["PRODUCTION"])).toEqual(["PRODUCTION"]);
    expect(audienceDepartments("dm", null, ["PRODUCTION", "PHOTO_RETOUCH"])).toEqual(["PHOTO_RETOUCH", "PRODUCTION"]);
    expect(audienceDepartments("group_dm", null, ["PRODUCTION", "PRODUCTION", "PHOTO_RETOUCH"])).toEqual(["PHOTO_RETOUCH", "PRODUCTION"]);
    expect(audienceDepartments("dm", null, [])).toEqual(["PHOTO_RETOUCH", "PRODUCTION"]);
    expect(audienceDepartments("group_dm", null, null)).toEqual(["PHOTO_RETOUCH", "PRODUCTION"]);
    expect(audienceDepartments("dm", null, ["SALES"])).toEqual(["PHOTO_RETOUCH", "PRODUCTION"]);
  });

  it("browse and the people search take an optional department", () => {
    expect(ChannelBrowseQuerySchema.parse({ department: "PRODUCTION" }).department).toBe("PRODUCTION");
    expect(ChannelBrowseQuerySchema.parse({}).department).toBeUndefined();
    expect(ChannelBrowseQuerySchema.safeParse({ department: "SALES" }).success).toBe(false);
    expect(DirectoryQuerySchema.parse({ purpose: "dm", department: "PHOTO_RETOUCH" })).toMatchObject({ purpose: "dm", department: "PHOTO_RETOUCH" });
    expect(DirectoryQuerySchema.safeParse({ department: "sales" }).success).toBe(false);
  });
});

describe("mentions", () => {
  it("uses organization scope only for public channels without department", () => {
    expect(mentionScope("public", null)).toBe("organization");
    expect(mentionScope("private", null)).toBe("members");
    expect(mentionScope("dm", null)).toBe("members");
    expect(mentionScope("group_dm", null)).toBe("members");
  });

  it("a department's public channel: its members plus the department (PD-053)", () => {
    expect(mentionScope("public", "PHOTO_RETOUCH")).toBe("department");
    expect(mentionScope("public", "PRODUCTION")).toBe("department");
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

describe("DM rules (staff 1:1, PD-041 departments)", () => {
  const staff = (departments: string[]) => ({ superadmin: false, canCreateChannels: false, departments });
  const retoucher = staff(["PHOTO_RETOUCH"]);
  const producer = staff(["PRODUCTION"]);
  const both = staff(["PHOTO_RETOUCH", "PRODUCTION"]);
  const superadmin = { superadmin: true, canCreateChannels: true, departments: ["PHOTO_RETOUCH", "PRODUCTION"] };
  const manager = { ...retoucher, canCreateChannels: true };
  const code = (run: () => unknown) => {
    try {
      run();
    } catch (error) {
      return error instanceof AppError ? `${error.statusCode} ${error.code}` : "other";
    }
    return "ok";
  };

  it("colleagues share a department, or either side is the superadmin", () => {
    expect(areDmColleagues(retoucher, both)).toBe(true);
    expect(areDmColleagues(retoucher, producer)).toBe(false);
    expect(areDmColleagues(retoucher, { superadmin: true, departments: [] })).toBe(true);
    expect(areDmColleagues({ superadmin: true, departments: [] }, producer)).toBe(true);
    expect(areDmColleagues(staff([]), staff([]))).toBe(false);
  });

  it("1:1: staff need a colleague; superadmins and channel creators may message anyone", () => {
    expect(dmOpenRequirement(retoucher, 1)).toBe("colleague");
    expect(dmOpenRequirement(manager, 1)).toBe("ok");
    expect(dmOpenRequirement(superadmin, 1)).toBe("ok");
    expect(code(() => assertDmColleague(retoucher, both))).toBe("ok");
    expect(code(() => assertDmColleague(retoucher, { superadmin: true, departments: [] }))).toBe("ok");
    expect(code(() => assertDmColleague(retoucher, producer))).toBe("403 CHAT_DM_NOT_COLLEAGUE");
  });

  it("group DMs need the right to create channels (superadmins always have it)", () => {
    expect(code(() => dmOpenRequirement(retoucher, 2))).toBe("403 CHAT_DM_GROUP_FORBIDDEN");
    expect(code(() => dmOpenRequirement({ ...retoucher, superadmin: false }, 8))).toBe("403 CHAT_DM_GROUP_FORBIDDEN");
    expect(dmOpenRequirement(manager, 2)).toBe("ok");
    expect(dmOpenRequirement({ ...superadmin, canCreateChannels: false }, 3)).toBe("ok");
    try {
      dmOpenRequirement(retoucher, 2);
    } catch (error) {
      expect((error as AppError).message).toBe("Bạn chỉ nhắn được 1:1; tạo nhóm cần quyền tạo kênh.");
    }
  });

  it("directory scope for a DM: department colleagues for staff, everyone for channel creators and superadmins", () => {
    expect(dmDirectoryScope(retoucher)).toEqual({ everyone: false, departments: ["PHOTO_RETOUCH"] });
    expect(dmDirectoryScope(both)).toEqual({ everyone: false, departments: ["PHOTO_RETOUCH", "PRODUCTION"] });
    expect(dmDirectoryScope(manager)).toMatchObject({ everyone: true });
    expect(dmDirectoryScope({ ...superadmin, canCreateChannels: false })).toMatchObject({ everyone: true });
  });
});
