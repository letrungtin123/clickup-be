import type { KnowledgeAccessLevel, KnowledgeImportance, KnowledgeStatusGroup } from "../../contracts/knowledge.js";
import { Permission, type PermissionKey } from "../../contracts/permissions.js";
import { AppError } from "../../lib/app-error.js";
import type { QuerySql } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { hasPermission } from "../access/resource-access.js";
import { canReadItem, effectiveSpaceLevel, levelAtLeast, type KnowledgePermissionFlags, type ReaderCandidate } from "./rules.js";

/**
 * Knowledge access (PD-031): `knowledge.view` is the outer layer (no section without it), then the space's
 * visibility and membership decide the level; org superadmins manage every space. Missing and invisible spaces /
 * items answer 404 alike.
 */

export type SpaceAccess = {
  spaceId: string;
  name: string;
  color: string;
  visibility: "public" | "private";
  approvalRequired: boolean;
  /** Effective level (org admins: manage; public non-members: view). */
  level: KnowledgeAccessLevel;
  memberLevel: KnowledgeAccessLevel | null;
  isMember: boolean;
  orgAdmin: boolean;
  /** Archived: read-only for its members and org admins (every write answers 409 KNOWLEDGE_SPACE_ARCHIVED). */
  archived: boolean;
};

export const spaceNotFound = () => new AppError("KNOWLEDGE_SPACE_NOT_FOUND", "Không tìm thấy kho tri thức hoặc bạn không có quyền truy cập.", 404);
export const itemNotFound = () => new AppError("KNOWLEDGE_ITEM_NOT_FOUND", "Không tìm thấy mục tri thức hoặc bạn không có quyền xem.", 404);
export const spaceArchived = () =>
  new AppError(
    "KNOWLEDGE_SPACE_ARCHIVED",
    "Kho đã được lưu trữ nên chỉ xem được: không thêm, sửa, bình luận hay đổi cài đặt. Hãy nhờ Quản lý kho khôi phục kho trước.",
    409
  );

/**
 * What a call does with the space: "read" also opens archived spaces (to their members and org admins); "write" (the
 * default, so a forgotten call site fails closed) refuses them with 409 KNOWLEDGE_SPACE_ARCHIVED — after the
 * visibility check, so people who cannot read the space still get the same 404.
 */
export type SpaceIntent = "read" | "write";

const forbiddenMessages: Record<KnowledgeAccessLevel, string> = {
  view: "Bạn không có quyền xem kho tri thức này.",
  submit: "Bạn cần là Thành viên hoặc Quản lý của kho để thực hiện thao tác này.",
  manage: "Chỉ Quản lý kho mới thực hiện được thao tác này."
};

export const forbidden = (message: string) => new AppError("FORBIDDEN", message, 403);

const permissionMessages: Partial<Record<PermissionKey, string>> = {
  [Permission.KnowledgeView]: "Vai trò của bạn chưa được xem Tri thức.",
  [Permission.KnowledgeCreate]: "Vai trò của bạn chưa được tạo kho tri thức.",
  [Permission.KnowledgeUpdate]: "Vai trò của bạn chưa có quyền \"Cập nhật tri thức\" để đổi cài đặt kho.",
  [Permission.KnowledgeDelete]: "Vai trò của bạn chưa có quyền \"Xóa tri thức\".",
  [Permission.KnowledgeManageMembers]: "Vai trò của bạn chưa có quyền \"Quản lý thành viên tri thức\"."
};

/** Org-level permission (the outer layer); superadmins hold every permission. */
export const requireKnowledgePermission = (context: AccessContext, permission: PermissionKey) => {
  if (!context.hasFullOrganizationAuthority && !hasPermission(context, permission)) {
    throw forbidden(permissionMessages[permission] ?? "Bạn không có quyền thực hiện thao tác này.");
  }
};

export const knowledgePermissionFlags = (context: AccessContext): KnowledgePermissionFlags => {
  const full = context.hasFullOrganizationAuthority;
  return {
    update: full || hasPermission(context, Permission.KnowledgeUpdate),
    delete: full || hasPermission(context, Permission.KnowledgeDelete),
    manageMembers: full || hasPermission(context, Permission.KnowledgeManageMembers)
  };
};

const canViewKnowledge = (context: AccessContext) => context.hasFullOrganizationAuthority || hasPermission(context, Permission.KnowledgeView);

type SpaceAccessRow = {
  id: string;
  name: string;
  color: string;
  visibility: "public" | "private";
  approval_required: boolean;
  archived: boolean;
  access_level: KnowledgeAccessLevel | null;
};

/**
 * The caller's access to a space, optionally locking the space row (serializes membership / status / category
 * changes). `archived`: false (default) = live spaces only (e.g. the realtime room), true = archived only (restore),
 * "include" = either (an archived one only for its members and org admins). Null when missing or invisible.
 */
export const getSpaceAccess = async (
  sql: QuerySql,
  context: AccessContext,
  spaceId: string,
  options: { archived?: boolean | "include"; lock?: boolean } = {}
): Promise<SpaceAccess | null> => {
  if (!canViewKnowledge(context)) {
    return null;
  }
  const archivedFilter =
    options.archived === "include" ? sql`TRUE` : options.archived ? sql`s.archived_at IS NOT NULL` : sql`s.archived_at IS NULL`;
  const rows = await sql<SpaceAccessRow[]>`
    SELECT s.id, s.name, s.color, s.visibility, s.approval_required, (s.archived_at IS NOT NULL) AS archived, sm.access_level
    FROM knowledge.spaces s
    LEFT JOIN knowledge.space_members sm ON sm.space_id = s.id AND sm.user_id = ${context.user.id}
    WHERE s.id = ${spaceId} AND s.organization_id = ${context.organization.id} AND s.deleted_at IS NULL
      AND ${archivedFilter}
    ${options.lock ? sql`FOR UPDATE OF s` : sql``}
  `;
  const row = rows[0];
  if (!row) {
    return null;
  }
  const level = effectiveSpaceLevel({
    visibility: row.visibility,
    memberLevel: row.access_level,
    orgAdmin: context.hasFullOrganizationAuthority,
    canViewKnowledge: true,
    archived: row.archived
  });
  if (!level) {
    return null;
  }
  return {
    spaceId: row.id,
    name: row.name,
    color: row.color,
    visibility: row.visibility,
    approvalRequired: row.approval_required,
    level,
    memberLevel: row.access_level,
    isMember: row.access_level !== null,
    orgAdmin: context.hasFullOrganizationAuthority,
    archived: row.archived
  };
};

export const assertSpaceLevel = (access: SpaceAccess, required: KnowledgeAccessLevel) => {
  if (!levelAtLeast(access.level, required)) {
    throw forbidden(forbiddenMessages[required]);
  }
  return access;
};

/** Writes need a live space: an archived one (the caller can read) answers 409 KNOWLEDGE_SPACE_ARCHIVED. */
export const assertSpaceWritable = (access: SpaceAccess) => {
  if (access.archived) {
    throw spaceArchived();
  }
  return access;
};

/**
 * Loads the space (404 when missing or invisible), refuses writes to an archived space (`intent`, default "write")
 * and checks the level. `archived: true` = archived spaces only (restore; the intent check is skipped there).
 */
export const assertSpaceAccess = async (
  sql: QuerySql,
  context: AccessContext,
  spaceId: string,
  required: KnowledgeAccessLevel,
  options: { archived?: true; lock?: boolean; intent?: SpaceIntent } = {}
) => {
  const access = await getSpaceAccess(sql, context, spaceId, { archived: options.archived ?? "include", lock: options.lock ?? false });
  if (!access) {
    throw spaceNotFound();
  }
  if (!options.archived && (options.intent ?? "write") === "write") {
    assertSpaceWritable(access);
  }
  return assertSpaceLevel(access, required);
};

/**
 * SQL predicate: spaces visible to the caller (alias `s`): live public spaces, spaces they are a member of (live or
 * archived) and, for org admins, every space. Live / archived filtering is up to the caller.
 */
export const visibleSpacesPredicate = (sql: QuerySql, context: AccessContext) => {
  if (context.hasFullOrganizationAuthority) {
    return sql`TRUE`;
  }
  return sql`(
    (s.visibility = 'public' AND s.archived_at IS NULL)
    OR EXISTS (SELECT 1 FROM knowledge.space_members vsm WHERE vsm.space_id = s.id AND vsm.user_id = ${context.user.id})
  )`;
};

// Items ------------------------------------------------------------------------------------------------

export type ItemCore = {
  id: string;
  space_id: string;
  category_id: string | null;
  status_id: string;
  status_name: string;
  status_group: KnowledgeStatusGroup;
  status_position: number;
  title: string;
  summary: string | null;
  importance: KnowledgeImportance;
  owner_user_id: string | null;
  tags: string[];
  pinned: boolean;
  effective_from: string | null;
  review_by: string | null;
  version: number;
  mentioned_user_ids: string[];
  created_by: string | null;
  deleted_at: Date | null;
};

const loadItemCore = async (sql: QuerySql, context: AccessContext, itemId: string, lock: boolean) =>
  (
    await sql<ItemCore[]>`
      SELECT i.id, i.space_id, i.category_id, i.status_id, st.name AS status_name, st.status_group, st.position AS status_position,
        i.title, i.summary, i.importance, i.owner_user_id, i.tags, i.pinned,
        to_char(i.effective_from, 'YYYY-MM-DD') AS effective_from, to_char(i.review_by, 'YYYY-MM-DD') AS review_by,
        i.version, i.mentioned_user_ids, i.created_by, i.deleted_at
      FROM knowledge.items i
      JOIN knowledge.statuses st ON st.id = i.status_id
      WHERE i.id = ${itemId} AND i.organization_id = ${context.organization.id}
      ${lock ? sql`FOR UPDATE OF i` : sql``}
    `
  )[0];

/**
 * Loads an item the caller can read (drafts: submit+ or its author) with the space access. Trashed items are only
 * returned with `trashed: "include"` (and then only to submit+) or `"only"`. Items of an archived space are read
 * (`intent: "read"`) by its members and org admins; any write (the default intent) answers 409
 * KNOWLEDGE_SPACE_ARCHIVED to them and 404 to everyone else.
 */
export const authorizeItem = async (
  sql: QuerySql,
  context: AccessContext,
  itemId: string,
  options: { required?: KnowledgeAccessLevel; lock?: boolean; trashed?: "exclude" | "include" | "only"; intent?: SpaceIntent } = {}
) => {
  const item = await loadItemCore(sql, context, itemId, options.lock ?? false);
  if (!item) {
    throw itemNotFound();
  }
  const access = await getSpaceAccess(sql, context, item.space_id, { archived: "include" });
  if (!access || !canReadItem(access.level, item.status_group, item.created_by, context.user.id)) {
    throw itemNotFound();
  }
  if ((options.intent ?? "write") === "write") {
    assertSpaceWritable(access);
  }
  const trashed = options.trashed ?? "exclude";
  if (item.deleted_at && (trashed === "exclude" || !levelAtLeast(access.level, "submit"))) {
    throw itemNotFound();
  }
  if (!item.deleted_at && trashed === "only") {
    throw new AppError("KNOWLEDGE_ITEM_NOT_IN_TRASH", "Mục này không nằm trong thùng rác.", 409);
  }
  if (options.required) {
    assertSpaceLevel(access, options.required);
  }
  return { item, access };
};

// People ------------------------------------------------------------------------------------------------

type CandidateRow = { user_id: string; superadmin: boolean; has_view: boolean; access_level: KnowledgeAccessLevel | null };

/** Active organization members among `userIds` with what decides their access to the space. */
export const loadReaderCandidates = async (
  sql: QuerySql,
  organizationId: string,
  spaceId: string,
  userIds: string[]
): Promise<ReaderCandidate[]> => {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) {
    return [];
  }
  const rows = await sql<CandidateRow[]>`
    SELECT om.user_id, (r.key = 'superadmin') AS superadmin,
      EXISTS (
        SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_key = ${Permission.KnowledgeView}
      ) AS has_view,
      sm.access_level
    FROM public.organization_memberships om
    JOIN public.roles r ON r.id = om.role_id AND r.organization_id = om.organization_id AND r.deleted_at IS NULL
    JOIN public.app_users au ON au.id = om.user_id AND au.deleted_at IS NULL
    LEFT JOIN knowledge.space_members sm ON sm.space_id = ${spaceId} AND sm.user_id = om.user_id
    WHERE om.organization_id = ${organizationId} AND om.user_id = ANY(${ids}::uuid[])
      AND om.status = 'active' AND om.deleted_at IS NULL
  `;
  return rows.map((row) => ({ userId: row.user_id, superadmin: row.superadmin, hasView: row.has_view, memberLevel: row.access_level }));
};
