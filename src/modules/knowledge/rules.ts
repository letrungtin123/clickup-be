import type {
  KnowledgeAccessLevel,
  KnowledgeImportance,
  KnowledgeSpaceCapabilities,
  KnowledgeStatusGroup,
  ReplaceKnowledgeStatusesRequest
} from "../../contracts/knowledge.js";
import { knowledgeLimits } from "../../contracts/knowledge.js";
import { AppError } from "../../lib/app-error.js";

/**
 * Knowledge base rules (PD-031) as pure functions, so the access matrix, approval step, critical-item reasons,
 * optimistic concurrency, category depth, status replacement and notification recipients are unit-tested
 * without a database. The services apply them; the database repeats the structural ones (triggers).
 */

const levelRank: Record<KnowledgeAccessLevel, number> = { view: 1, submit: 2, manage: 3 };

export const levelAtLeast = (level: KnowledgeAccessLevel | null | undefined, required: KnowledgeAccessLevel) =>
  level !== null && level !== undefined && levelRank[level] >= levelRank[required];

// Access ---------------------------------------------------------------------------------------------

export type SpaceAccessInput = {
  visibility: "public" | "private";
  /** Explicit membership level, null for non-members. */
  memberLevel: KnowledgeAccessLevel | null;
  /** Organization superadmin: sees and manages every space. */
  orgAdmin: boolean;
  /** The role grants `knowledge.view` (the outer layer: without it the whole section is closed). */
  canViewKnowledge: boolean;
  /** The space is archived: read-only, and only for its members and org admins (not the whole company). */
  archived?: boolean;
};

/**
 * Effective level in a space: org admins manage everything; members have their level; everyone else with
 * `knowledge.view` reads public spaces (view: read, comment, follow — editing needs membership); private spaces are
 * invisible to non-members (null → answered as 404, never revealing the space exists). An archived space stays
 * readable by its members and org admins only — a public one no longer opens for the rest of the company. The level
 * of an archived space only decides who reads it (and who may restore / delete it): every write is refused
 * (KNOWLEDGE_SPACE_ARCHIVED, see access.ts).
 */
export const effectiveSpaceLevel = (input: SpaceAccessInput): KnowledgeAccessLevel | null => {
  if (input.orgAdmin) {
    return "manage";
  }
  if (!input.canViewKnowledge) {
    return null;
  }
  if (input.memberLevel) {
    return input.memberLevel;
  }
  return input.visibility === "public" && !input.archived ? "view" : null;
};

export type KnowledgePermissionFlags = { update: boolean; delete: boolean; manageMembers: boolean };

/**
 * What the caller may do in a space (contract KnowledgeSpaceCapabilities). An archived space is read-only: reading
 * (and, for managers, the space log) stays; every other capability is false except `canArchive`, the right to
 * restore or delete it (manage + knowledge.delete, unchanged).
 */
export const spaceCapabilities = (
  level: KnowledgeAccessLevel | null,
  permissions: KnowledgePermissionFlags,
  options: { archived?: boolean } = {}
): KnowledgeSpaceCapabilities => {
  const manage = level === "manage";
  if (options.archived) {
    return {
      canRead: level !== null,
      canComment: false,
      canEdit: false,
      canManage: false,
      canViewAudit: manage,
      canPurge: false,
      canUpdate: false,
      canManageMembers: false,
      canArchive: manage && permissions.delete
    };
  }
  return {
    canRead: level !== null,
    canComment: level !== null,
    canEdit: levelAtLeast(level, "submit"),
    canManage: manage,
    canViewAudit: manage,
    canPurge: manage && permissions.delete,
    canUpdate: manage && permissions.update,
    canManageMembers: manage && permissions.manageMembers,
    canArchive: manage && permissions.delete
  };
};

/** Per-item history and versions: members (any level) and org admins; public readers only see the current text. */
export const canViewItemHistory = (isMember: boolean, orgAdmin: boolean) => isMember || orgAdmin;

/** Draft items are visible to submit+ and to their author only; active and retired items to every reader. */
export const canReadItem = (
  level: KnowledgeAccessLevel | null,
  group: KnowledgeStatusGroup,
  createdBy: string | null,
  userId: string
) => level !== null && (group !== "draft" || levelAtLeast(level, "submit") || createdBy === userId);

/** Whether drafts of others are visible at this level (list / search / counts). */
export const seesAllDrafts = (level: KnowledgeAccessLevel | null) => levelAtLeast(level, "submit");

/** A person as a mention / notification candidate (loaded by access.ts). */
export type ReaderCandidate = {
  userId: string;
  superadmin: boolean;
  hasView: boolean;
  memberLevel: KnowledgeAccessLevel | null;
};

export const candidateLevel = (candidate: ReaderCandidate, visibility: "public" | "private") =>
  effectiveSpaceLevel({
    visibility,
    memberLevel: candidate.memberLevel,
    orgAdmin: candidate.superadmin,
    canViewKnowledge: candidate.hasView
  });

/** People among the candidates who can read the space. */
export const spaceReaders = (candidates: ReaderCandidate[], visibility: "public" | "private") =>
  candidates.filter((candidate) => candidateLevel(candidate, visibility) !== null).map((candidate) => candidate.userId);

/** People among the candidates who can read this item (drafts: submit+ and the author). */
export const itemReaders = (
  candidates: ReaderCandidate[],
  space: { visibility: "public" | "private" },
  item: { group: KnowledgeStatusGroup; createdBy: string | null }
) =>
  candidates
    .filter((candidate) => canReadItem(candidateLevel(candidate, space.visibility), item.group, item.createdBy, candidate.userId))
    .map((candidate) => candidate.userId);

// Statuses & approval --------------------------------------------------------------------------------

export type StatusLike = { id: string; group: KnowledgeStatusGroup; position: number };

/**
 * With the approval step on, leaving the draft group needs manage: an "active" status publishes the item, and a
 * "retired" one shows it to every reader too (KB-SEC-01: otherwise a member skips the review by sending a draft —
 * or creating an item — straight into "Hết hiệu lực", where nobody but a manager can take it back).
 */
export const needsApproval = (approvalRequired: boolean, targetGroup: KnowledgeStatusGroup, level: KnowledgeAccessLevel | null) =>
  approvalRequired && targetGroup !== "draft" && level !== "manage";

export const assertStatusAllowed = (approvalRequired: boolean, target: StatusLike, level: KnowledgeAccessLevel | null) => {
  if (needsApproval(approvalRequired, target.group, level)) {
    throw new AppError(
      "KNOWLEDGE_APPROVAL_REQUIRED",
      "Kho này bật bước duyệt: chỉ Quản lý kho mới chuyển mục sang trạng thái đang áp dụng (ban hành) hoặc hết hiệu lực.",
      403
    );
  }
};

/**
 * Owner decision 2026-10-11 (PD-031 addendum): with the approval step on, a published item — status in the active or
 * retired group — is changed (content, fields, importance, status, tags, category, files, trash / restore, version
 * restore) by space managers only (org admins manage every space). Members (submit) still create items, edit drafts,
 * comment and follow. Approval off: every submit+ member edits every item.
 */
export const canEditItem = (level: KnowledgeAccessLevel | null, approvalRequired: boolean, group: KnowledgeStatusGroup) =>
  levelAtLeast(level, "submit") && (!approvalRequired || group === "draft" || level === "manage");

export const assertItemEditable = (level: KnowledgeAccessLevel | null, approvalRequired: boolean, group: KnowledgeStatusGroup) => {
  if (!canEditItem(level, approvalRequired, group)) {
    throw new AppError(
      levelAtLeast(level, "submit") ? "KNOWLEDGE_PUBLISHED_LOCKED" : "FORBIDDEN",
      levelAtLeast(level, "submit")
        ? "Kho này bật bước duyệt: mục đã ban hành hoặc hết hiệu lực chỉ Quản lý kho mới sửa, xoá hoặc khôi phục được."
        : "Bạn cần là Thành viên hoặc Quản lý của kho để thực hiện thao tác này.",
      403
    );
  }
};

/** Statuses the caller may pick for an item (the current one always stays selectable). */
export const allowedStatusIds = (
  statuses: StatusLike[],
  approvalRequired: boolean,
  level: KnowledgeAccessLevel | null,
  currentStatusId: string | null
) => {
  const current = statuses.find((status) => status.id === currentStatusId);
  if (current && !canEditItem(level, approvalRequired, current.group)) {
    return [];
  }
  return levelAtLeast(level, "submit")
    ? statuses.filter((status) => status.id === currentStatusId || !needsApproval(approvalRequired, status.group, level)).map((status) => status.id)
    : [];
};

/** The first draft status by position: where new items start ("Nháp"). */
export const firstDraftStatus = <Status extends StatusLike>(statuses: Status[]) =>
  [...statuses].filter((status) => status.group === "draft").sort((a, b) => a.position - b.position)[0] ?? null;

/**
 * "Gửi duyệt": a member below manage moves an item (or creates it) into a draft status other than the first draft
 * status while the space has the approval step on — the space managers are asked to review it.
 */
export const isApprovalRequest = (input: {
  approvalRequired: boolean;
  level: KnowledgeAccessLevel | null;
  target: StatusLike;
  firstDraftId: string | null;
}) => input.approvalRequired && input.level !== "manage" && input.target.group === "draft" && input.target.id !== input.firstDraftId;

// Critical items -------------------------------------------------------------------------------------

/** Any change (and delete / restore) of an item that is or becomes "Rất quan trọng" needs a reason. */
export const reasonRequired = (before: KnowledgeImportance, after: KnowledgeImportance = before) =>
  before === "critical" || after === "critical";

export const cleanReason = (reason: string | null | undefined) => {
  const trimmed = reason?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

/** Returns the reason to store (null when none was given and none is required). */
export const resolveReason = (required: boolean, reason: string | null | undefined) => {
  const cleaned = cleanReason(reason);
  if (required && (cleaned === null || cleaned.length < knowledgeLimits.reasonMinLength)) {
    throw new AppError(
      "KNOWLEDGE_REASON_REQUIRED",
      `Mục "Rất quan trọng": hãy ghi lý do thay đổi (ít nhất ${knowledgeLimits.reasonMinLength} ký tự).`,
      400
    );
  }
  return cleaned;
};

// Optimistic concurrency -----------------------------------------------------------------------------

export type VersionCheck = "ok" | "missing" | "conflict";

/** Content saves (title, summary, body) must name the version they were based on. */
export const checkExpectedVersion = (contentTouched: boolean, expectedVersion: number | undefined, currentVersion: number): VersionCheck => {
  if (!contentTouched) {
    return "ok";
  }
  if (expectedVersion === undefined) {
    return "missing";
  }
  return expectedVersion === currentVersion ? "ok" : "conflict";
};

// Categories -----------------------------------------------------------------------------------------

export type CategoryNode = { id: string; parentId: string | null };

/**
 * Categories are at most 2 levels deep (knowledgeLimits.categoryDepth): a parent must be a top-level category of the
 * same space, never the category itself, and a category that has sub-categories cannot move under another one.
 */
export const categoryPlacementProblem = (
  categories: CategoryNode[],
  categoryId: string | null,
  parentId: string | null
): "parent_not_found" | "self" | "depth" | "has_children" | null => {
  if (parentId === null) {
    return null;
  }
  if (categoryId !== null && parentId === categoryId) {
    return "self";
  }
  const parent = categories.find((category) => category.id === parentId);
  if (!parent) {
    return "parent_not_found";
  }
  if (parent.parentId !== null) {
    return "depth";
  }
  if (categoryId !== null && categories.some((category) => category.parentId === categoryId)) {
    return "has_children";
  }
  return null;
};

export const assertCategoryPlacement = (categories: CategoryNode[], categoryId: string | null, parentId: string | null) => {
  const problem = categoryPlacementProblem(categories, categoryId, parentId);
  if (problem === "parent_not_found") {
    throw new AppError("KNOWLEDGE_CATEGORY_NOT_FOUND", "Không tìm thấy chuyên mục cha trong kho này.", 400);
  }
  if (problem) {
    throw new AppError("KNOWLEDGE_CATEGORY_DEPTH", "Chuyên mục chỉ có tối đa 2 cấp.", 400);
  }
};

// Status replacement ---------------------------------------------------------------------------------

export type ExistingStatus = { id: string; name: string; group: KnowledgeStatusGroup; itemCount: number };

export type StatusReplacePlan = {
  /** Final order; `id` null = new status. */
  statuses: { id: string | null; name: string; color: string; group: KnowledgeStatusGroup; position: number }[];
  /** Removed statuses and where their items go (null = no items to move). */
  removed: { id: string; name: string; target: string | null; itemCount: number }[];
};

const groupLabels: Record<KnowledgeStatusGroup, string> = { draft: "Bản nháp", active: "Đang áp dụng", retired: "Hết hiệu lực" };

/**
 * Validates a full status list for a space and plans the change: existing ids keep their items; every removed
 * status that still has items (trash included) must name a kept status in `reassign`. At least one status per
 * group, names unique (case-insensitive), at most knowledgeLimits.statusesPerSpace.
 */
export const planStatusReplace = (existing: ExistingStatus[], input: ReplaceKnowledgeStatusesRequest): StatusReplacePlan => {
  const existingById = new Map(existing.map((status) => [status.id, status]));
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (const status of input.statuses) {
    if (status.id !== undefined) {
      if (!existingById.has(status.id)) {
        throw new AppError("KNOWLEDGE_STATUS_NOT_FOUND", "Một trạng thái không thuộc kho này.", 400);
      }
      if (seenIds.has(status.id)) {
        throw new AppError("KNOWLEDGE_STATUS_DUPLICATE", "Một trạng thái xuất hiện hai lần.", 400);
      }
      seenIds.add(status.id);
    }
    const key = status.name.trim().toLocaleLowerCase("vi");
    if (seenNames.has(key)) {
      throw new AppError("KNOWLEDGE_STATUS_DUPLICATE", `Tên trạng thái "${status.name}" bị trùng.`, 400);
    }
    seenNames.add(key);
  }
  if (input.statuses.length > knowledgeLimits.statusesPerSpace) {
    throw new AppError("KNOWLEDGE_STATUS_LIMIT", `Mỗi kho có tối đa ${knowledgeLimits.statusesPerSpace} trạng thái.`, 400);
  }
  for (const group of ["draft", "active", "retired"] as const) {
    if (!input.statuses.some((status) => status.group === group)) {
      throw new AppError(
        "KNOWLEDGE_STATUS_GROUPS_REQUIRED",
        `Cần ít nhất một trạng thái thuộc nhóm "${groupLabels[group]}" (mỗi nhóm Bản nháp, Đang áp dụng, Hết hiệu lực cần ít nhất một).`,
        400
      );
    }
  }
  const removed = existing
    .filter((status) => !seenIds.has(status.id))
    .map((status) => {
      const target = input.reassign[status.id] ?? null;
      if (status.itemCount > 0) {
        if (target === null) {
          throw new AppError(
            "KNOWLEDGE_STATUS_REASSIGN_REQUIRED",
            `Trạng thái "${status.name}" còn ${status.itemCount} mục: hãy chọn trạng thái để chuyển các mục này sang.`,
            400
          );
        }
        if (!seenIds.has(target)) {
          throw new AppError("KNOWLEDGE_STATUS_REASSIGN_INVALID", "Trạng thái nhận các mục phải là một trạng thái được giữ lại.", 400);
        }
      }
      return { id: status.id, name: status.name, target: status.itemCount > 0 ? target : null, itemCount: status.itemCount };
    });
  return {
    statuses: input.statuses.map((status, position) => ({
      id: status.id ?? null,
      name: status.name.trim(),
      color: status.color,
      group: status.group,
      position
    })),
    removed
  };
};

/** Defaults of every new space (design §04). */
export const defaultStatuses: { name: string; color: string; group: KnowledgeStatusGroup }[] = [
  { name: "Nháp", color: "slate", group: "draft" },
  { name: "Chờ duyệt", color: "amber", group: "draft" },
  { name: "Đã ban hành", color: "green", group: "active" },
  { name: "Cần cập nhật", color: "orange", group: "active" },
  { name: "Hết hiệu lực", color: "red", group: "retired" }
];

// Tags -----------------------------------------------------------------------------------------------

/** Trimmed, inner whitespace collapsed, duplicates (case-insensitive) dropped, first spelling kept. */
export const normalizeTags = (tags: string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, " ");
    const key = tag.toLocaleLowerCase("vi");
    if (tag.length === 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(tag);
  }
  return result.slice(0, knowledgeLimits.tagsPerItem);
};

export const sameStringSet = (a: string[], b: string[]) => a.length === b.length && a.every((value, index) => value === b[index]);

// Dates ----------------------------------------------------------------------------------------------

/** "YYYY-MM-DD" of an instant in business time (Asia/Ho_Chi_Minh, UTC+7, no DST). */
export const businessDay = (now: Date = new Date()) => new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

/** reviewBy is today or earlier and the item is active. */
export const isReviewDue = (reviewBy: string | null, group: KnowledgeStatusGroup, today: string) =>
  group === "active" && reviewBy !== null && reviewBy <= today;

// Notifications --------------------------------------------------------------------------------------

const unique = (ids: (string | null | undefined)[]) => [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];

export type ItemChangeInput = {
  actorId: string | null;
  /** The item was just created (no "updated" / "status changed" notices then). */
  created: boolean;
  followers: string[];
  /** Explicit space members with their level. */
  members: { userId: string; level: KnowledgeAccessLevel }[];
  /** People newly @mentioned in the body. */
  mentioned: string[];
  approvalRequested: boolean;
  statusChanged: boolean;
  newVersion: boolean;
  /** The item became active (or was created active). */
  published: boolean;
  importance: KnowledgeImportance;
  group: KnowledgeStatusGroup;
};

export type ItemChangePlan = {
  mentioned: string[];
  approval: string[];
  statusChanged: string[];
  updated: string[];
  /** Every member: important / critical item published or with a new official version. */
  broadcast: string[];
  /** knowledge.updated may be e-mailed: a new version of an active critical item (PD-031 / PD-025). */
  criticalVersion: boolean;
};

/**
 * Who hears about an item change. Each person gets at most one notification per change, the most specific one
 * (mention > approval request > status change > new version > broadcast); the actor never notifies themselves.
 * Callers still filter by who can read the item (drafts: submit+ and the author).
 */
export const planItemNotifications = (input: ItemChangeInput): ItemChangePlan => {
  const taken = new Set<string>(input.actorId ? [input.actorId] : []);
  const take = (ids: string[]) => {
    const result = unique(ids).filter((id) => !taken.has(id));
    result.forEach((id) => taken.add(id));
    return result;
  };
  const mentioned = take(input.mentioned);
  const approval = input.approvalRequested ? take(input.members.filter((member) => member.level === "manage").map((member) => member.userId)) : [];
  const statusChanged = input.statusChanged && !input.created ? take(input.followers) : [];
  const updated = input.newVersion && !input.created ? take(input.followers) : [];
  const broadcastWorthy = input.importance !== "normal" && input.group === "active" && (input.published || input.newVersion);
  const broadcast = broadcastWorthy ? take([...input.members.map((member) => member.userId), ...input.followers]) : [];
  return {
    mentioned,
    approval,
    statusChanged,
    updated,
    broadcast,
    criticalVersion: input.newVersion && input.importance === "critical" && input.group === "active"
  };
};

export type CommentPlanInput = {
  actorId: string | null;
  followers: string[];
  mentioned: string[];
  parentAuthorId: string | null;
};

/** Comment recipients: mentions first, then the parent comment's author (reply), then followers. Never the writer. */
export const planCommentNotifications = (input: CommentPlanInput) => {
  const taken = new Set<string>(input.actorId ? [input.actorId] : []);
  const mentioned = unique(input.mentioned).filter((id) => !taken.has(id));
  mentioned.forEach((id) => taken.add(id));
  const replied = input.parentAuthorId && !taken.has(input.parentAuthorId) ? [input.parentAuthorId] : [];
  replied.forEach((id) => taken.add(id));
  const commented = unique(input.followers).filter((id) => !taken.has(id));
  return { mentioned, replied, commented };
};

/** Mentions kept as mentions (the rest became plain text) minus the ones already in the previous text. */
export const newlyMentioned = (current: string[], previous: string[]) => {
  const before = new Set(previous);
  return unique(current).filter((id) => !before.has(id));
};
