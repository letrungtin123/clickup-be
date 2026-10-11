import { describe, expect, it } from "vitest";

import { AppError } from "../../lib/app-error.js";
import { canResolveComment } from "./comments.service.js";
import {
  allowedStatusIds,
  assertItemEditable,
  assertStatusAllowed,
  businessDay,
  canEditItem,
  canReadItem,
  canViewItemHistory,
  categoryPlacementProblem,
  checkExpectedVersion,
  defaultStatuses,
  effectiveSpaceLevel,
  firstDraftStatus,
  isApprovalRequest,
  isReviewDue,
  itemReaders,
  needsApproval,
  newlyMentioned,
  normalizeTags,
  planCommentNotifications,
  planItemNotifications,
  planStatusReplace,
  reasonRequired,
  resolveReason,
  spaceCapabilities,
  spaceReaders,
  type ItemChangeInput,
  type ReaderCandidate
} from "./rules.js";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const D = "dddddddd-0000-4000-8000-000000000004";
const E = "eeeeeeee-0000-4000-8000-000000000005";

const codeOf = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof AppError ? error.code : "OTHER";
  }
};

describe("access matrix (PD-031)", () => {
  const level = (visibility: "public" | "private", memberLevel: "view" | "submit" | "manage" | null, orgAdmin = false, canViewKnowledge = true) =>
    effectiveSpaceLevel({ visibility, memberLevel, orgAdmin, canViewKnowledge });

  it("public spaces: everyone with knowledge.view reads; members keep their level", () => {
    expect(level("public", null)).toBe("view");
    expect(level("public", "view")).toBe("view");
    expect(level("public", "submit")).toBe("submit");
    expect(level("public", "manage")).toBe("manage");
  });

  it("private spaces: members only (outsiders get nothing → 404)", () => {
    expect(level("private", null)).toBeNull();
    expect(level("private", "view")).toBe("view");
    expect(level("private", "submit")).toBe("submit");
  });

  it("knowledge.view is the outer layer; org admins manage every space", () => {
    expect(level("public", "manage", false, false)).toBeNull();
    expect(level("private", null, true, false)).toBe("manage");
    expect(level("public", "view", true)).toBe("manage");
  });

  it("capabilities: editing needs submit; settings / members / archive need manage plus the org permission", () => {
    const none = { update: false, delete: false, manageMembers: false };
    const all = { update: true, delete: true, manageMembers: true };
    expect(spaceCapabilities("view", all)).toMatchObject({ canRead: true, canComment: true, canEdit: false, canManage: false, canViewAudit: false });
    expect(spaceCapabilities("submit", all)).toMatchObject({ canEdit: true, canManage: false, canPurge: false, canUpdate: false });
    expect(spaceCapabilities("manage", none)).toMatchObject({
      canEdit: true,
      canManage: true,
      canViewAudit: true,
      canPurge: false,
      canUpdate: false,
      canManageMembers: false,
      canArchive: false
    });
    expect(spaceCapabilities("manage", all)).toMatchObject({ canPurge: true, canUpdate: true, canManageMembers: true, canArchive: true });
    expect(spaceCapabilities(null, all)).toMatchObject({ canRead: false, canComment: false, canEdit: false });
  });

  it("archived spaces: members and org admins only (a public one closes for the rest of the company)", () => {
    const archived = (visibility: "public" | "private", memberLevel: "view" | "submit" | "manage" | null, orgAdmin = false) =>
      effectiveSpaceLevel({ visibility, memberLevel, orgAdmin, canViewKnowledge: true, archived: true });
    expect(archived("public", null)).toBeNull();
    expect(archived("private", null)).toBeNull();
    expect(archived("public", "view")).toBe("view");
    expect(archived("public", "submit")).toBe("submit");
    expect(archived("private", "manage")).toBe("manage");
    expect(archived("public", null, true)).toBe("manage");
    expect(effectiveSpaceLevel({ visibility: "public", memberLevel: "manage", orgAdmin: false, canViewKnowledge: false, archived: true })).toBeNull();
  });

  it("archived spaces are read-only: every capability false except read, the log for managers and restore / delete", () => {
    const none = { update: false, delete: false, manageMembers: false };
    const all = { update: true, delete: true, manageMembers: true };
    const readOnly = {
      canRead: true,
      canComment: false,
      canEdit: false,
      canManage: false,
      canPurge: false,
      canUpdate: false,
      canManageMembers: false
    };
    expect(spaceCapabilities("view", all, { archived: true })).toEqual({ ...readOnly, canViewAudit: false, canArchive: false });
    expect(spaceCapabilities("submit", all, { archived: true })).toEqual({ ...readOnly, canViewAudit: false, canArchive: false });
    // A Quản lý without knowledge.delete reads it (and its log) but cannot restore it; with it they can.
    expect(spaceCapabilities("manage", none, { archived: true })).toEqual({ ...readOnly, canViewAudit: true, canArchive: false });
    expect(spaceCapabilities("manage", all, { archived: true })).toEqual({ ...readOnly, canViewAudit: true, canArchive: true });
    expect(spaceCapabilities(null, all, { archived: true })).toMatchObject({ canRead: false, canArchive: false });
    // Live spaces are unchanged by the option.
    expect(spaceCapabilities("manage", all, { archived: false })).toEqual(spaceCapabilities("manage", all));
  });

  it("drafts: submit+ and the author only; active / retired: every reader", () => {
    expect(canReadItem("view", "draft", B, A)).toBe(false);
    expect(canReadItem("view", "draft", A, A)).toBe(true);
    expect(canReadItem("submit", "draft", B, A)).toBe(true);
    expect(canReadItem("view", "active", B, A)).toBe(true);
    expect(canReadItem("view", "retired", B, A)).toBe(true);
    expect(canReadItem(null, "active", B, A)).toBe(false);
  });

  it("history and versions: members (any level) and org admins, not public readers", () => {
    expect(canViewItemHistory(true, false)).toBe(true);
    expect(canViewItemHistory(false, true)).toBe(true);
    expect(canViewItemHistory(false, false)).toBe(false);
  });

  it("comments are resolved by submit+, the item owner or the comment author (root comments only)", () => {
    const base = { isRoot: true, level: "view" as const, userId: A, authorId: B, ownerId: C };
    expect(canResolveComment(base)).toBe(false);
    expect(canResolveComment({ ...base, authorId: A })).toBe(true);
    expect(canResolveComment({ ...base, ownerId: A })).toBe(true);
    expect(canResolveComment({ ...base, level: "submit" })).toBe(true);
    expect(canResolveComment({ ...base, level: "manage", isRoot: false })).toBe(false);
  });
});

describe("mention filtering and readers", () => {
  const candidates: ReaderCandidate[] = [
    { userId: A, superadmin: false, hasView: true, memberLevel: null },
    { userId: B, superadmin: false, hasView: true, memberLevel: "view" },
    { userId: C, superadmin: false, hasView: true, memberLevel: "submit" },
    { userId: D, superadmin: true, hasView: false, memberLevel: null },
    { userId: E, superadmin: false, hasView: false, memberLevel: "manage" }
  ];

  it("private spaces: only members (with knowledge.view) and org admins keep their mention", () => {
    expect(spaceReaders(candidates, "private").sort()).toEqual([B, C, D].sort());
  });

  it("public spaces: everyone with knowledge.view", () => {
    expect(spaceReaders(candidates, "public").sort()).toEqual([A, B, C, D].sort());
  });

  it("notifications about drafts reach submit+, org admins and the author only", () => {
    expect(itemReaders(candidates, { visibility: "public" }, { group: "draft", createdBy: A }).sort()).toEqual([A, C, D].sort());
    expect(itemReaders(candidates, { visibility: "public" }, { group: "active", createdBy: A }).sort()).toEqual([A, B, C, D].sort());
  });

  it("only mentions that are new after an edit notify", () => {
    expect(newlyMentioned([A, B, B, C], [A])).toEqual([B, C]);
    expect(newlyMentioned([A], [A, B])).toEqual([]);
  });
});

describe("approval step", () => {
  const statuses = defaultStatuses.map((status, position) => ({ id: `s${position}`, group: status.group, position }));

  it("leaving the draft group (active or retired) needs manage when approval is on", () => {
    expect(needsApproval(true, "active", "submit")).toBe(true);
    expect(needsApproval(true, "active", "manage")).toBe(false);
    expect(needsApproval(false, "active", "submit")).toBe(false);
    // KB-SEC-01: "Hết hiệu lực" is shown to every reader too, so a member cannot skip the review through it.
    expect(needsApproval(true, "retired", "submit")).toBe(true);
    expect(needsApproval(true, "retired", "manage")).toBe(false);
    expect(needsApproval(false, "retired", "submit")).toBe(false);
    expect(needsApproval(true, "draft", "submit")).toBe(false);
    let refusal: unknown = null;
    try {
      assertStatusAllowed(true, { id: "s4", group: "retired", position: 4 }, "submit");
    } catch (error) {
      refusal = error;
    }
    expect(refusal instanceof AppError && refusal.statusCode === 403 && refusal.code === "KNOWLEDGE_APPROVAL_REQUIRED").toBe(true);
  });

  it("allowed statuses leave out active and retired ones for submit members (current status stays)", () => {
    expect(allowedStatusIds(statuses, true, "submit", "s0")).toEqual(["s0", "s1"]);
    expect(allowedStatusIds(statuses, true, "submit", "s1")).toEqual(["s0", "s1"]);
    expect(allowedStatusIds(statuses, true, "manage", "s0")).toEqual(["s0", "s1", "s2", "s3", "s4"]);
    expect(allowedStatusIds(statuses, false, "submit", "s0")).toHaveLength(5);
    expect(allowedStatusIds(statuses, false, "view", "s0")).toEqual([]);
  });

  it("approval on: published items (active / retired) are for managers only (owner decision 2026-10-11)", () => {
    // Members keep drafts; a published or retired item offers them nothing.
    expect(allowedStatusIds(statuses, true, "submit", "s2")).toEqual([]);
    expect(allowedStatusIds(statuses, true, "submit", "s4")).toEqual([]);
    expect(allowedStatusIds(statuses, true, "manage", "s2")).toEqual(["s0", "s1", "s2", "s3", "s4"]);
    // Approval off: unchanged — members move published items anywhere.
    expect(allowedStatusIds(statuses, false, "submit", "s2")).toEqual(["s0", "s1", "s2", "s3", "s4"]);

    for (const group of ["draft", "active", "retired"] as const) {
      expect(canEditItem("manage", true, group)).toBe(true);
      expect(canEditItem("submit", false, group)).toBe(true);
      expect(canEditItem("view", false, group)).toBe(false);
      expect(canEditItem("view", true, group)).toBe(false);
      expect(canEditItem(null, false, group)).toBe(false);
    }
    expect(canEditItem("submit", true, "draft")).toBe(true);
    expect(canEditItem("submit", true, "active")).toBe(false);
    expect(canEditItem("submit", true, "retired")).toBe(false);

    const refused = (fn: () => void) => {
      try {
        fn();
        return null;
      } catch (error) {
        return error instanceof AppError ? `${error.statusCode} ${error.code}` : "other";
      }
    };
    expect(refused(() => assertItemEditable("submit", true, "active"))).toBe("403 KNOWLEDGE_PUBLISHED_LOCKED");
    expect(refused(() => assertItemEditable("view", true, "draft"))).toBe("403 FORBIDDEN");
    expect(refused(() => assertItemEditable("submit", true, "draft"))).toBeNull();
    expect(refused(() => assertItemEditable("manage", true, "retired"))).toBeNull();
  });

  it("new items start in the first draft status; another draft status is a request for approval", () => {
    const first = firstDraftStatus(statuses);
    expect(first?.id).toBe("s0");
    const target = statuses[1]!;
    expect(isApprovalRequest({ approvalRequired: true, level: "submit", target, firstDraftId: "s0" })).toBe(true);
    expect(isApprovalRequest({ approvalRequired: true, level: "manage", target, firstDraftId: "s0" })).toBe(false);
    expect(isApprovalRequest({ approvalRequired: false, level: "submit", target, firstDraftId: "s0" })).toBe(false);
    expect(isApprovalRequest({ approvalRequired: true, level: "submit", target: statuses[0]!, firstDraftId: "s0" })).toBe(false);
    expect(isApprovalRequest({ approvalRequired: true, level: "submit", target: statuses[4]!, firstDraftId: "s0" })).toBe(false);
  });
});

describe("critical items need a reason", () => {
  it("before or after the change", () => {
    expect(reasonRequired("critical")).toBe(true);
    expect(reasonRequired("important", "critical")).toBe(true);
    expect(reasonRequired("critical", "normal")).toBe(true);
    expect(reasonRequired("important", "normal")).toBe(false);
  });

  it("at least 3 characters when required; optional reasons are kept trimmed", () => {
    expect(codeOf(() => resolveReason(true, undefined))).toBe("KNOWLEDGE_REASON_REQUIRED");
    expect(codeOf(() => resolveReason(true, "  ok "))).toBe("KNOWLEDGE_REASON_REQUIRED");
    expect(resolveReason(true, " Sửa bước 3 ")).toBe("Sửa bước 3");
    expect(resolveReason(false, "   ")).toBeNull();
    expect(resolveReason(false, "x")).toBe("x");
  });
});

describe("optimistic concurrency", () => {
  it("content saves need the version they were based on", () => {
    expect(checkExpectedVersion(false, undefined, 3)).toBe("ok");
    expect(checkExpectedVersion(true, undefined, 3)).toBe("missing");
    expect(checkExpectedVersion(true, 2, 3)).toBe("conflict");
    expect(checkExpectedVersion(true, 3, 3)).toBe("ok");
  });
});

describe("category depth (max 2 levels)", () => {
  const categories = [
    { id: "root", parentId: null },
    { id: "child", parentId: "root" },
    { id: "other", parentId: null }
  ];

  it("top level and children of a top category are fine", () => {
    expect(categoryPlacementProblem(categories, null, null)).toBeNull();
    expect(categoryPlacementProblem(categories, null, "root")).toBeNull();
    expect(categoryPlacementProblem(categories, "other", "root")).toBeNull();
  });

  it("no third level, no self-parent, no moving a parent under another, parents of this space only", () => {
    expect(categoryPlacementProblem(categories, null, "child")).toBe("depth");
    expect(categoryPlacementProblem(categories, "root", "root")).toBe("self");
    expect(categoryPlacementProblem(categories, "root", "other")).toBe("has_children");
    expect(categoryPlacementProblem(categories, null, "missing")).toBe("parent_not_found");
  });
});

describe("status replacement", () => {
  const existing = [
    { id: A, name: "Nháp", group: "draft" as const, itemCount: 2 },
    { id: B, name: "Đã ban hành", group: "active" as const, itemCount: 5 },
    { id: C, name: "Cần cập nhật", group: "active" as const, itemCount: 0 },
    { id: D, name: "Hết hiệu lực", group: "retired" as const, itemCount: 1 }
  ];
  const keep = (id: string, name: string, group: "draft" | "active" | "retired") => ({ id, name, color: "slate" as const, group });

  it("keeps ids, adds new ones, removes unused statuses without a reassignment", () => {
    const plan = planStatusReplace(existing, {
      statuses: [keep(A, "Nháp", "draft"), keep(B, "Ban hành", "active"), { name: "Lưu trữ", color: "gray", group: "retired" }, keep(D, "Hết hiệu lực", "retired")],
      reassign: {}
    });
    expect(plan.statuses.map((status) => [status.id, status.position])).toEqual([
      [A, 0],
      [B, 1],
      [null, 2],
      [D, 3]
    ]);
    expect(plan.removed).toEqual([{ id: C, name: "Cần cập nhật", target: null, itemCount: 0 }]);
  });

  it("a removed status with items must name a kept status", () => {
    const statuses = [keep(A, "Nháp", "draft"), keep(C, "Cần cập nhật", "active"), keep(D, "Hết hiệu lực", "retired")];
    expect(codeOf(() => planStatusReplace(existing, { statuses, reassign: {} }))).toBe("KNOWLEDGE_STATUS_REASSIGN_REQUIRED");
    expect(codeOf(() => planStatusReplace(existing, { statuses, reassign: { [B]: E } }))).toBe("KNOWLEDGE_STATUS_REASSIGN_INVALID");
    expect(planStatusReplace(existing, { statuses, reassign: { [B]: C } }).removed).toEqual([{ id: B, name: "Đã ban hành", target: C, itemCount: 5 }]);
  });

  it("at least one status per group, unique names, ids of this space only", () => {
    expect(
      codeOf(() => planStatusReplace(existing, { statuses: [keep(A, "Nháp", "draft"), keep(B, "A", "active"), keep(C, "B", "active")], reassign: { [D]: B } }))
    ).toBe("KNOWLEDGE_STATUS_GROUPS_REQUIRED");
    expect(
      codeOf(() =>
        planStatusReplace(existing, { statuses: [keep(A, "Nháp", "draft"), keep(B, "nháp", "active"), keep(D, "X", "retired")], reassign: { [C]: B } })
      )
    ).toBe("KNOWLEDGE_STATUS_DUPLICATE");
    expect(
      codeOf(() => planStatusReplace(existing, { statuses: [keep(E, "Nháp", "draft"), keep(B, "A", "active"), keep(D, "X", "retired")], reassign: {} }))
    ).toBe("KNOWLEDGE_STATUS_NOT_FOUND");
  });

  it("the default set has one status per group at least", () => {
    expect(new Set(defaultStatuses.map((status) => status.group)).size).toBe(3);
    expect(defaultStatuses.map((status) => status.name)).toEqual(["Nháp", "Chờ duyệt", "Đã ban hành", "Cần cập nhật", "Hết hiệu lực"]);
  });
});

describe("tags and dates", () => {
  it("normalizes tags: trimmed, single spaces, case-insensitive duplicates dropped, at most 10", () => {
    expect(normalizeTags([" Retouch ", "retouch", "chân   dung", ""])).toEqual(["Retouch", "chân dung"]);
    expect(normalizeTags(Array.from({ length: 15 }, (_, index) => `t${index}`))).toHaveLength(10);
  });

  it("review is due on the day itself for active items only (business day, UTC+7)", () => {
    expect(isReviewDue("2026-10-11", "active", "2026-10-11")).toBe(true);
    expect(isReviewDue("2026-10-12", "active", "2026-10-11")).toBe(false);
    expect(isReviewDue("2026-10-01", "draft", "2026-10-11")).toBe(false);
    expect(isReviewDue(null, "active", "2026-10-11")).toBe(false);
    expect(businessDay(new Date("2026-10-11T18:30:00Z"))).toBe("2026-10-12");
  });
});

describe("notification recipients", () => {
  const base: ItemChangeInput = {
    actorId: A,
    created: false,
    followers: [A, B],
    members: [
      { userId: A, level: "submit" },
      { userId: C, level: "manage" },
      { userId: D, level: "view" }
    ],
    mentioned: [],
    approvalRequested: false,
    statusChanged: false,
    newVersion: false,
    published: false,
    importance: "normal",
    group: "active"
  };

  it("new version: followers except the writer; normal items do not reach every member", () => {
    const plan = planItemNotifications({ ...base, newVersion: true });
    expect(plan.updated).toEqual([B]);
    expect(plan.broadcast).toEqual([]);
    expect(plan.criticalVersion).toBe(false);
  });

  it("important / critical item published or with a new official version: every member, once", () => {
    const published = planItemNotifications({ ...base, statusChanged: true, published: true, importance: "important" });
    expect(published.statusChanged).toEqual([B]);
    expect(published.broadcast.sort()).toEqual([C, D].sort());
    const critical = planItemNotifications({ ...base, newVersion: true, importance: "critical" });
    expect(critical.updated).toEqual([B]);
    expect(critical.broadcast.sort()).toEqual([C, D].sort());
    expect(critical.criticalVersion).toBe(true);
    expect(planItemNotifications({ ...base, newVersion: true, importance: "critical", group: "draft" }).criticalVersion).toBe(false);
    expect(planItemNotifications({ ...base, newVersion: true, importance: "critical", group: "draft" }).broadcast).toEqual([]);
  });

  it("mentions win over every other notice; approval requests go to managers", () => {
    const plan = planItemNotifications({ ...base, mentioned: [B, A], approvalRequested: true, statusChanged: true, newVersion: true });
    expect(plan.mentioned).toEqual([B]);
    expect(plan.approval).toEqual([C]);
    expect(plan.statusChanged).toEqual([]);
    expect(plan.updated).toEqual([]);
  });

  it("creating an item notifies mentions / approval / broadcast but not followers", () => {
    const plan = planItemNotifications({ ...base, created: true, newVersion: true, published: true, importance: "important", followers: [A] });
    expect(plan.updated).toEqual([]);
    expect(plan.statusChanged).toEqual([]);
    expect(plan.broadcast.sort()).toEqual([C, D].sort());
  });

  it("comments: mentions, then the parent author (reply), then followers; never the writer", () => {
    expect(planCommentNotifications({ actorId: A, followers: [A, B, C, D], mentioned: [C, A], parentAuthorId: B })).toEqual({
      mentioned: [C],
      replied: [B],
      commented: [D]
    });
    expect(planCommentNotifications({ actorId: B, followers: [A, B], mentioned: [], parentAuthorId: B })).toEqual({
      mentioned: [],
      replied: [],
      commented: [A]
    });
    expect(planCommentNotifications({ actorId: A, followers: [B], mentioned: [B], parentAuthorId: B })).toEqual({
      mentioned: [B],
      replied: [],
      commented: []
    });
  });
});
