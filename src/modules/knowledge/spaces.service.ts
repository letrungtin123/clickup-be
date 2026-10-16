import type { Response } from "express";
import type { z } from "zod";

import type {
  CreateKnowledgeCategoryRequestSchema,
  CreateKnowledgeSpaceRequest,
  KnowledgeAccessLevel,
  KnowledgeAuditQuery,
  KnowledgeCategory,
  KnowledgeMember,
  KnowledgeSpace,
  KnowledgeSpaceDetail,
  ReplaceKnowledgeStatusesRequest,
  UpdateKnowledgeCategoryRequestSchema,
  UpdateKnowledgeSpaceRequest
} from "../../contracts/knowledge.js";
import { KnowledgeAuditExportQuerySchema } from "../../contracts/knowledge.js";
import { Permission } from "../../contracts/permissions.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import {
  decodeTimeCursor,
  encodeTimeCursor,
  nullableText,
  timestampParamSql,
  timestampTextSql,
  toIso,
  type QuerySql
} from "../../lib/db-types.js";
import { registerUniqueViolations } from "../../lib/db-errors.js";
import { rankAtEnd, rankForPlacement } from "../../lib/rank.js";
import { evictUsersFromRoom, resetRoom } from "../../realtime/publisher.js";
import type { AccessContext } from "../access/access-context.js";
import { visibleUserSql } from "../access/test-accounts.js";
import { businessDate, exportFilename, sendWorkbook } from "../production/excel.js";
import { toColor, toUserRef, type UserRefJson } from "../work/mappers.js";
import {
  assertSpaceAccess,
  getSpaceAccess,
  knowledgePermissionFlags,
  requireKnowledgePermission,
  spaceNotFound,
  visibleSpacesPredicate,
  type SpaceAccess
} from "./access.js";
import {
  accessLevelLabel,
  auditColumnsSql,
  auditFor,
  itemVisibleSql,
  loadCategories,
  loadStatuses,
  publishKnowledge,
  publishSpaceListHint,
  toAuditEntry,
  toCategory,
  toStatus,
  userJsonSql,
  type AuditRow,
  type CategoryRow
} from "./repo.js";
import { assertCategoryPlacement, defaultStatuses, effectiveSpaceLevel, planStatusReplace, seesAllDrafts, spaceCapabilities } from "./rules.js";
import { auditActionLabel, describeAuditEntry, rawAuditJson } from "./audit-format.js";

registerUniqueViolations({
  knowledge_spaces_org_name_uidx: { code: "KNOWLEDGE_SPACE_EXISTS", message: "Đã có kho tri thức cùng tên. Hãy chọn tên khác." },
  knowledge_categories_name_uidx: { code: "KNOWLEDGE_CATEGORY_EXISTS", message: "Đã có chuyên mục cùng tên ở cấp này." }
});

// Spaces ----------------------------------------------------------------------------------------------

type SpaceRow = {
  id: string;
  name: string;
  description: string | null;
  visibility: "public" | "private";
  color: string;
  icon: string | null;
  rank: string;
  approval_required: boolean;
  access_level: KnowledgeAccessLevel | null;
  member_count: number;
  item_count: number;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

const toSpace = (context: AccessContext, row: SpaceRow): KnowledgeSpace => {
  const archived = row.archived_at !== null;
  const level = effectiveSpaceLevel({
    visibility: row.visibility,
    memberLevel: row.access_level,
    orgAdmin: context.hasFullOrganizationAuthority,
    canViewKnowledge: true,
    archived
  });
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    color: toColor(row.color, "blue"),
    icon: row.icon,
    rank: row.rank,
    approvalRequired: row.approval_required,
    myAccess: row.access_level,
    isMember: row.access_level !== null,
    memberCount: Number(row.member_count),
    itemCount: Number(row.item_count),
    capabilities: spaceCapabilities(level, knowledgePermissionFlags(context), { archived }),
    archivedAt: row.archived_at ? toIso(row.archived_at) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
};

/** `scope`: live spaces, archived ones, or both (live first, in sidebar order; then archived, newest first). */
const selectSpaces = (sql: QuerySql, context: AccessContext, filter: { spaceId?: string; scope: "live" | "archived" | "all" }) => sql<SpaceRow[]>`
  SELECT s.id, s.name, s.description, s.visibility, s.color, s.icon, s.rank, s.approval_required, s.archived_at,
    s.created_at, s.updated_at, sm.access_level,
    (SELECT count(*)::int FROM knowledge.space_members c WHERE c.space_id = s.id) AS member_count,
    (
      SELECT count(*)::int FROM knowledge.items i JOIN knowledge.statuses st ON st.id = i.status_id
      WHERE i.space_id = s.id AND i.deleted_at IS NULL
        AND (st.status_group <> 'draft' OR ${context.hasFullOrganizationAuthority} OR sm.access_level IN ('submit', 'manage')
          OR i.created_by = ${context.user.id})
    ) AS item_count
  FROM knowledge.spaces s
  LEFT JOIN knowledge.space_members sm ON sm.space_id = s.id AND sm.user_id = ${context.user.id}
  WHERE s.organization_id = ${context.organization.id} AND s.deleted_at IS NULL
    AND ${filter.scope === "all" ? sql`TRUE` : filter.scope === "archived" ? sql`s.archived_at IS NOT NULL` : sql`s.archived_at IS NULL`}
    ${filter.spaceId ? sql`AND s.id = ${filter.spaceId}` : sql``}
    AND ${visibleSpacesPredicate(sql, context)}
  ORDER BY (s.archived_at IS NOT NULL), s.archived_at DESC, s.rank COLLATE "C", s.id
  LIMIT 500
`;

/**
 * Every space the caller can open: live ones (public, member, org admin) in sidebar order, then the archived ones
 * they are a member of (org admins: all), read-only, with `archivedAt` set (FE group "Đã lưu trữ").
 */
export const listSpaces = async (context: AccessContext) => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  const rows = await selectSpaces(getSql(), context, { scope: "all" });
  return { items: rows.map((row) => toSpace(context, row)) };
};

/** Archived spaces the caller could restore (knowledge.delete + manage). Newest first. */
export const listArchivedSpaces = async (context: AccessContext) => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  requireKnowledgePermission(context, Permission.KnowledgeDelete);
  const rows = await selectSpaces(getSql(), context, { scope: "archived" });
  return {
    items: rows
      .filter((row) => context.hasFullOrganizationAuthority || row.access_level === "manage")
      .map((row) => toSpace(context, row))
  };
};

const loadTags = (sql: QuerySql, spaceId: string, seesDrafts: boolean, userId: string) => sql<{ name: string; count: number }[]>`
  SELECT t.tag AS name, count(*)::int AS count
  FROM knowledge.items i
  JOIN knowledge.statuses st ON st.id = i.status_id
  CROSS JOIN LATERAL unnest(i.tags) AS t(tag)
  WHERE i.space_id = ${spaceId} AND i.deleted_at IS NULL AND ${itemVisibleSql(sql, seesDrafts, userId)}
  GROUP BY t.tag
  ORDER BY count(*) DESC, t.tag
  LIMIT 100
`;

export const getSpaceDetail = async (context: AccessContext, spaceId: string, sql: QuerySql = getSql()): Promise<KnowledgeSpaceDetail> => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  // Archived spaces open read-only for their members and org admins.
  const access = await assertSpaceAccess(sql, context, spaceId, "view", { intent: "read" });
  const row = (await selectSpaces(sql, context, { spaceId, scope: "all" }))[0];
  if (!row) {
    throw spaceNotFound();
  }
  const seesDrafts = seesAllDrafts(access.level);
  const [statuses, categories, tags] = await Promise.all([
    loadStatuses(sql, spaceId),
    loadCategories(sql, spaceId, seesDrafts, context.user.id),
    loadTags(sql, spaceId, seesDrafts, context.user.id)
  ]);
  return {
    ...toSpace(context, row),
    statuses: statuses.map(toStatus),
    categories,
    tags: tags.map((tag) => ({ name: tag.name, count: Number(tag.count) }))
  };
};

const lockSpaces = (sql: QuerySql, context: AccessContext) =>
  sql`SELECT pg_advisory_xact_lock(hashtextextended(${`knowledge-spaces:${context.organization.id}`}, 0))`;

export const createSpace = async (context: AccessContext, input: CreateKnowledgeSpaceRequest): Promise<KnowledgeSpaceDetail> => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  requireKnowledgePermission(context, Permission.KnowledgeCreate);
  const sql = getSql();
  const spaceId = await sql.begin(async (tx) => {
    await lockSpaces(tx, context);
    const rank = await rankAtEnd(tx, { table: "knowledge.spaces", where: { organization_id: context.organization.id } });
    const created = (
      await tx<{ id: string }[]>`
        INSERT INTO knowledge.spaces (organization_id, name, description, visibility, color, icon, rank, approval_required, created_by, updated_by)
        VALUES (${context.organization.id}, ${input.name}, ${nullableText(input.description) ?? null}, ${input.visibility}, ${input.color},
                ${input.icon ?? null}, ${rank}, ${input.approvalRequired}, ${context.user.id}, ${context.user.id})
        RETURNING id
      `
    )[0];
    if (!created) {
      throw new AppError("KNOWLEDGE_SPACE_CREATE_FAILED", "Không tạo được kho tri thức.", 500);
    }
    // The creator is the first manager (design §08).
    await tx`
      INSERT INTO knowledge.space_members (organization_id, space_id, user_id, access_level, created_by)
      VALUES (${context.organization.id}, ${created.id}, ${context.user.id}, 'manage', ${context.user.id})
    `;
    await tx`
      INSERT INTO knowledge.statuses (organization_id, space_id, name, color, status_group, position)
      SELECT ${context.organization.id}, ${created.id}, s.name, s.color, s.status_group, s.position
      FROM jsonb_to_recordset(${tx.json(defaultStatuses.map((status, position) => ({ name: status.name, color: status.color, status_group: status.group, position })))})
        AS s(name text, color text, status_group text, position int)
    `;
    await auditFor(context)(tx, [
      {
        spaceId: created.id,
        action: "SPACE_CREATED",
        after: { name: input.name, visibility: input.visibility, approvalRequired: input.approvalRequired }
      }
    ]);
    return created.id;
  });
  await publishSpaceListHint(context, spaceId, "space");
  return await getSpaceDetail(context, spaceId);
};

/**
 * Access lost because a space became private, or a member left a private space: they stop following its items
 * and lose its inbox entries (superadmins keep seeing every space). `userIds` null = every non-member.
 */
const revokeSpaceAccessEffects = async (tx: QuerySql, context: AccessContext, spaceId: string, userIds: string[] | null) => {
  const affected = (alias: string) =>
    userIds
      ? tx`${tx(alias)} = ANY(${userIds}::uuid[])`
      : tx`NOT EXISTS (SELECT 1 FROM knowledge.space_members m WHERE m.space_id = ${spaceId} AND m.user_id = ${tx(alias)})`;
  const notSuperadmin = (alias: string) => tx`NOT EXISTS (
    SELECT 1 FROM public.organization_memberships om
    JOIN public.roles r ON r.id = om.role_id AND r.organization_id = om.organization_id AND r.key = 'superadmin'
    WHERE om.organization_id = ${context.organization.id} AND om.user_id = ${tx(alias)} AND om.status = 'active' AND om.deleted_at IS NULL
  )`;
  await tx`
    DELETE FROM knowledge.followers f
    WHERE f.space_id = ${spaceId} AND ${affected("f.user_id")} AND ${notSuperadmin("f.user_id")}
  `;
  await tx`
    DELETE FROM public.notifications n
    WHERE n.organization_id = ${context.organization.id} AND n.type LIKE 'knowledge.%'
      AND n.payload->>'knowledgeSpaceId' = ${spaceId}
      AND ${affected("n.recipient_user_id")} AND ${notSuperadmin("n.recipient_user_id")}
  `;
};

const changedFields = (before: Record<string, unknown>, after: Record<string, unknown>) => {
  const keys = Object.keys(after).filter((key) => after[key] !== undefined && JSON.stringify(after[key]) !== JSON.stringify(before[key]));
  return {
    before: Object.fromEntries(keys.map((key) => [key, before[key] ?? null])),
    after: Object.fromEntries(keys.map((key) => [key, after[key] ?? null])),
    changed: keys.length > 0
  };
};

export const updateSpace = async (context: AccessContext, spaceId: string, input: UpdateKnowledgeSpaceRequest): Promise<KnowledgeSpaceDetail> => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  requireKnowledgePermission(context, Permission.KnowledgeUpdate);
  const sql = getSql();
  const outcome = await sql.begin(async (tx) => {
    const access = await assertSpaceAccess(tx, context, spaceId, "manage", { lock: true });
    const current = (
      await tx<{
        name: string;
        description: string | null;
        visibility: "public" | "private";
        color: string;
        icon: string | null;
        approval_required: boolean;
        rank: string;
      }[]>`
        SELECT name, description, visibility, color, icon, approval_required, rank FROM knowledge.spaces WHERE id = ${spaceId}
      `
    )[0]!;
    const rank = input.placement
      ? await rankForPlacement(
          tx,
          { table: "knowledge.spaces", where: { organization_id: context.organization.id }, excludeId: spaceId },
          input.placement
        )
      : null;
    const description = input.description !== undefined ? (nullableText(input.description) ?? null) : undefined;
    await tx`
      UPDATE knowledge.spaces
      SET name = coalesce(${input.name ?? null}, name),
          description = CASE WHEN ${description !== undefined} THEN ${description ?? null} ELSE description END,
          visibility = coalesce(${input.visibility ?? null}, visibility),
          color = coalesce(${input.color ?? null}, color),
          icon = CASE WHEN ${input.icon !== undefined} THEN ${input.icon ?? null} ELSE icon END,
          approval_required = coalesce(${input.approvalRequired ?? null}, approval_required),
          rank = coalesce(${rank}, rank),
          updated_by = ${context.user.id}
      WHERE id = ${spaceId} AND organization_id = ${context.organization.id}
    `;
    const diff = changedFields(
      {
        name: current.name,
        description: current.description,
        visibility: current.visibility,
        color: current.color,
        icon: current.icon,
        approvalRequired: current.approval_required,
        rank: current.rank
      },
      {
        name: input.name,
        description,
        visibility: input.visibility,
        color: input.color,
        icon: input.icon,
        approvalRequired: input.approvalRequired,
        // Sidebar order is shared by everyone: a reorder is a change like any other (KB-SEC-05).
        rank: rank ?? undefined
      }
    );
    if (diff.changed) {
      await auditFor(context)(tx, [{ spaceId, action: "SPACE_UPDATED", before: diff.before, after: diff.after }]);
    }
    const madePrivate = access.visibility === "public" && input.visibility === "private";
    if (madePrivate) {
      await revokeSpaceAccessEffects(tx, context, spaceId, null);
    }
    return { madePrivate, visibilityChanged: input.visibility !== undefined && input.visibility !== access.visibility };
  });
  publishKnowledge(spaceId, "space", { actorId: context.user.id });
  if (outcome.madePrivate) {
    // Non-members watching the public space lose its live events now; members re-join.
    resetRoom({ type: "knowledge", id: spaceId });
  }
  await publishSpaceListHint(context, spaceId, "space", { broadcast: outcome.visibilityChanged });
  return await getSpaceDetail(context, spaceId);
};

export const archiveSpace = async (context: AccessContext, spaceId: string) => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  requireKnowledgePermission(context, Permission.KnowledgeDelete);
  const sql = getSql();
  await sql.begin(async (tx) => {
    await assertSpaceAccess(tx, context, spaceId, "manage", { lock: true });
    await tx`
      UPDATE knowledge.spaces SET archived_at = now(), archived_by = ${context.user.id}, updated_by = ${context.user.id}
      WHERE id = ${spaceId} AND organization_id = ${context.organization.id}
    `;
    await auditFor(context)(tx, [{ spaceId, action: "SPACE_ARCHIVED" }]);
  });
  publishKnowledge(spaceId, "space", { actorId: context.user.id });
  resetRoom({ type: "knowledge", id: spaceId });
  await publishSpaceListHint(context, spaceId, "space", { broadcast: true });
  return { ok: true as const };
};

export const restoreSpace = async (context: AccessContext, spaceId: string): Promise<KnowledgeSpaceDetail> => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  requireKnowledgePermission(context, Permission.KnowledgeDelete);
  const sql = getSql();
  await sql.begin(async (tx) => {
    await assertSpaceAccess(tx, context, spaceId, "manage", { archived: true, lock: true });
    await lockSpaces(tx, context);
    const rank = await rankAtEnd(tx, { table: "knowledge.spaces", where: { organization_id: context.organization.id } });
    await tx`
      UPDATE knowledge.spaces SET archived_at = NULL, archived_by = NULL, rank = ${rank}, updated_by = ${context.user.id}
      WHERE id = ${spaceId} AND organization_id = ${context.organization.id}
    `;
    await auditFor(context)(tx, [{ spaceId, action: "SPACE_RESTORED" }]);
  });
  publishKnowledge(spaceId, "space", { actorId: context.user.id });
  await publishSpaceListHint(context, spaceId, "space", { broadcast: true });
  return await getSpaceDetail(context, spaceId);
};

/**
 * Deletes a space for good from the app (live or archived): it disappears everywhere, while its rows and the
 * append-only audit log stay in the database. The delete is soft (`deleted_at`), so nothing cascades: the space's
 * log — ending with SPACE_DELETED — survives in the same table (KB-SEC-04: no API path hard-deletes a space).
 */
export const deleteSpace = async (context: AccessContext, spaceId: string) => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  requireKnowledgePermission(context, Permission.KnowledgeDelete);
  const sql = getSql();
  await sql.begin(async (tx) => {
    const access = await getSpaceAccess(tx, context, spaceId, { archived: "include", lock: true });
    if (!access) {
      throw spaceNotFound();
    }
    if (access.level !== "manage") {
      throw new AppError("FORBIDDEN", "Chỉ Quản lý kho mới xoá được kho.", 403);
    }
    const deleted = (
      await tx<{ deleted_at: Date; archived_at: Date | null; item_count: number }[]>`
        UPDATE knowledge.spaces s SET deleted_at = now(), deleted_by = ${context.user.id}
        WHERE s.id = ${spaceId} AND s.organization_id = ${context.organization.id}
        RETURNING s.deleted_at, s.archived_at,
          (SELECT count(*)::int FROM knowledge.items i WHERE i.space_id = s.id AND i.deleted_at IS NULL) AS item_count
      `
    )[0];
    await auditFor(context)(tx, [
      {
        spaceId,
        action: "SPACE_DELETED",
        before: {
          name: access.name,
          visibility: access.visibility,
          archivedAt: deleted?.archived_at ? toIso(deleted.archived_at) : null,
          itemCount: Number(deleted?.item_count ?? 0)
        },
        after: { deletedAt: toIso(deleted?.deleted_at ?? new Date()) }
      }
    ]);
    await tx`
      DELETE FROM public.notifications
      WHERE organization_id = ${context.organization.id} AND type LIKE 'knowledge.%' AND payload->>'knowledgeSpaceId' = ${spaceId}
    `;
  });
  resetRoom({ type: "knowledge", id: spaceId });
  await publishSpaceListHint(context, spaceId, "space", { broadcast: true });
  return { ok: true as const };
};

// Members ---------------------------------------------------------------------------------------------

type MemberRow = { user: UserRefJson; access_level: KnowledgeAccessLevel; created_at: Date };

const toMember = (row: MemberRow): KnowledgeMember => ({
  user: toUserRef(row.user)!,
  accessLevel: row.access_level,
  createdAt: toIso(row.created_at)
});

/** A space's members. Temporary QA test accounts are left out for a viewer who is not one (PD-063). */
export const listMembers = async (context: AccessContext, spaceId: string) => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  const sql = getSql();
  await assertSpaceAccess(sql, context, spaceId, "view", { intent: "read" });
  const rows = await sql<MemberRow[]>`
    SELECT ${userJsonSql(sql)} AS user, sm.access_level, sm.created_at
    FROM knowledge.space_members sm
    JOIN public.app_users au ON au.id = sm.user_id AND au.deleted_at IS NULL
    JOIN public.organization_memberships om
      ON om.organization_id = sm.organization_id AND om.user_id = sm.user_id AND om.status = 'active' AND om.deleted_at IS NULL
    WHERE sm.space_id = ${spaceId} AND sm.organization_id = ${context.organization.id}
      AND ${visibleUserSql(sql, context)}
    ORDER BY CASE sm.access_level WHEN 'manage' THEN 1 WHEN 'submit' THEN 2 ELSE 3 END, au.display_name, au.id
    LIMIT 2000
  `;
  return { items: rows.map(toMember) };
};

/** A space keeps at least one manager whose account is active (the database trigger repeats the rule). */
const assertManagerRemains = async (sql: QuerySql, context: AccessContext, spaceId: string, userId: string) => {
  const rows = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM knowledge.space_members sm
    JOIN public.organization_memberships om
      ON om.organization_id = sm.organization_id AND om.user_id = sm.user_id AND om.status = 'active' AND om.deleted_at IS NULL
    WHERE sm.space_id = ${spaceId} AND sm.user_id <> ${userId} AND sm.access_level = 'manage'
  `;
  if ((rows[0]?.count ?? 0) === 0) {
    throw new AppError("KNOWLEDGE_MANAGER_REQUIRED", "Kho cần ít nhất một Quản lý. Hãy thêm Quản lý khác trước.", 409);
  }
};

const memberName = async (sql: QuerySql, userId: string) =>
  (await sql<{ display_name: string }[]>`SELECT display_name FROM public.app_users WHERE id = ${userId}`)[0]?.display_name ?? null;

/**
 * POST adds (or changes) a member; PATCH (`mode: "update"`) only changes an existing member and answers 404 for
 * anyone else.
 */
export const upsertMember = async (
  context: AccessContext,
  spaceId: string,
  input: { userId: string; accessLevel: KnowledgeAccessLevel },
  mode: "upsert" | "update" = "upsert"
): Promise<KnowledgeMember> => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  requireKnowledgePermission(context, Permission.KnowledgeManageMembers);
  const sql = getSql();
  const member = await sql.begin(async (tx) => {
    // The space row lock serializes membership changes, so two managers cannot demote each other to zero.
    await assertSpaceAccess(tx, context, spaceId, "manage", { lock: true });
    const target = await tx<{ id: string }[]>`
      SELECT id FROM public.organization_memberships
      WHERE organization_id = ${context.organization.id} AND user_id = ${input.userId} AND status = 'active' AND deleted_at IS NULL
    `;
    if (target.length === 0) {
      throw new AppError("ORG_MEMBER_NOT_FOUND", "Không tìm thấy thành viên đang hoạt động trong tổ chức.", 404);
    }
    const current = (
      await tx<{ access_level: KnowledgeAccessLevel }[]>`
        SELECT access_level FROM knowledge.space_members WHERE space_id = ${spaceId} AND user_id = ${input.userId} FOR UPDATE
      `
    )[0];
    if (mode === "update" && !current) {
      throw new AppError("KNOWLEDGE_MEMBER_NOT_FOUND", "Người này chưa là thành viên của kho.", 404);
    }
    if (current?.access_level === "manage" && input.accessLevel !== "manage") {
      await assertManagerRemains(tx, context, spaceId, input.userId);
    }
    await tx`
      INSERT INTO knowledge.space_members (organization_id, space_id, user_id, access_level, created_by)
      VALUES (${context.organization.id}, ${spaceId}, ${input.userId}, ${input.accessLevel}, ${context.user.id})
      ON CONFLICT (space_id, user_id) DO UPDATE SET access_level = EXCLUDED.access_level
    `;
    if (!current || current.access_level !== input.accessLevel) {
      const name = await memberName(tx, input.userId);
      await auditFor(context)(tx, [
        current
          ? {
              spaceId,
              action: "MEMBER_UPDATED",
              before: { userId: input.userId, userName: name, accessLevel: current.access_level },
              after: { userId: input.userId, userName: name, accessLevel: input.accessLevel }
            }
          : { spaceId, action: "MEMBER_ADDED", after: { userId: input.userId, userName: name, accessLevel: input.accessLevel } }
      ]);
    }
    const row = (
      await tx<MemberRow[]>`
        SELECT ${userJsonSql(tx)} AS user, sm.access_level, sm.created_at
        FROM knowledge.space_members sm JOIN public.app_users au ON au.id = sm.user_id
        WHERE sm.space_id = ${spaceId} AND sm.user_id = ${input.userId}
      `
    )[0];
    if (!row) {
      throw new AppError("KNOWLEDGE_MEMBER_SAVE_FAILED", "Không lưu được thành viên.", 500);
    }
    return toMember(row);
  });
  publishKnowledge(spaceId, "members", { actorId: context.user.id });
  await publishSpaceListHint(context, spaceId, "members", { extraUserIds: [input.userId] });
  return member;
};

export const removeMember = async (context: AccessContext, spaceId: string, userId: string) => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  requireKnowledgePermission(context, Permission.KnowledgeManageMembers);
  const sql = getSql();
  const outcome = await sql.begin(async (tx) => {
    const access = await assertSpaceAccess(tx, context, spaceId, "manage", { lock: true });
    const current = (
      await tx<{ access_level: KnowledgeAccessLevel }[]>`
        SELECT access_level FROM knowledge.space_members WHERE space_id = ${spaceId} AND user_id = ${userId} FOR UPDATE
      `
    )[0];
    if (!current) {
      throw new AppError("KNOWLEDGE_MEMBER_NOT_FOUND", "Người này chưa là thành viên của kho.", 404);
    }
    if (current.access_level === "manage") {
      await assertManagerRemains(tx, context, spaceId, userId);
    }
    await tx`DELETE FROM knowledge.space_members WHERE space_id = ${spaceId} AND user_id = ${userId}`;
    await auditFor(context)(tx, [
      { spaceId, action: "MEMBER_REMOVED", before: { userId, userName: await memberName(tx, userId), accessLevel: current.access_level } }
    ]);
    if (access.visibility === "private") {
      await revokeSpaceAccessEffects(tx, context, spaceId, [userId]);
    }
    return { visibility: access.visibility };
  });
  if (outcome.visibility === "private") {
    evictUsersFromRoom([userId], { type: "knowledge", id: spaceId });
  }
  publishKnowledge(spaceId, "members", { actorId: context.user.id });
  await publishSpaceListHint(context, spaceId, "members", { extraUserIds: [userId] });
  return { ok: true as const };
};

// Statuses --------------------------------------------------------------------------------------------

export const replaceStatuses = async (
  context: AccessContext,
  spaceId: string,
  input: ReplaceKnowledgeStatusesRequest
): Promise<KnowledgeSpaceDetail> => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  requireKnowledgePermission(context, Permission.KnowledgeUpdate);
  const sql = getSql();
  await sql.begin(async (tx) => {
    await assertSpaceAccess(tx, context, spaceId, "manage", { lock: true });
    const existing = await tx<{ id: string; name: string; color: string; status_group: "draft" | "active" | "retired"; position: number; item_count: number }[]>`
      SELECT st.id, st.name, st.color, st.status_group, st.position,
        (SELECT count(*)::int FROM knowledge.items i WHERE i.space_id = st.space_id AND i.status_id = st.id) AS item_count
      FROM knowledge.statuses st WHERE st.space_id = ${spaceId}
      ORDER BY st.position, st.id
      FOR UPDATE OF st
    `;
    const plan = planStatusReplace(
      existing.map((row) => ({ id: row.id, name: row.name, group: row.status_group, itemCount: Number(row.item_count) })),
      input
    );
    for (const status of plan.statuses.filter((entry) => entry.id !== null)) {
      await tx`
        UPDATE knowledge.statuses SET name = ${status.name}, color = ${status.color}, status_group = ${status.group}, position = ${status.position}
        WHERE id = ${status.id} AND space_id = ${spaceId}
      `;
    }
    const created = plan.statuses.filter((entry) => entry.id === null);
    if (created.length > 0) {
      await tx`
        INSERT INTO knowledge.statuses (organization_id, space_id, name, color, status_group, position)
        SELECT ${context.organization.id}, ${spaceId}, s.name, s.color, s.status_group, s.position
        FROM jsonb_to_recordset(${tx.json(created.map((status) => ({ name: status.name, color: status.color, status_group: status.group, position: status.position })))})
          AS s(name text, color text, status_group text, position int)
      `;
    }
    for (const removed of plan.removed) {
      if (removed.target) {
        const target = plan.statuses.find((status) => status.id === removed.target);
        // One history entry per moved item (trashed ones included), then the move itself.
        await tx`
          INSERT INTO knowledge.audit_log (organization_id, space_id, item_id, item_title, actor_user_id, action, before, after, reason)
          SELECT i.organization_id, i.space_id, i.id, i.title, ${context.user.id}, 'ITEM_STATUS_CHANGED',
            jsonb_build_object('statusId', ${removed.id}::uuid, 'statusName', ${removed.name}::text),
            jsonb_build_object('statusId', ${removed.target}::uuid, 'statusName', ${target?.name ?? null}::text, 'group', ${target?.group ?? null}::text),
            'Đổi bộ trạng thái của kho'
          FROM knowledge.items i WHERE i.space_id = ${spaceId} AND i.status_id = ${removed.id}
        `;
        await tx`
          UPDATE knowledge.items SET status_id = ${removed.target}, updated_at = now(), updated_by = ${context.user.id}
          WHERE space_id = ${spaceId} AND status_id = ${removed.id}
        `;
      }
      await tx`DELETE FROM knowledge.statuses WHERE id = ${removed.id} AND space_id = ${spaceId}`;
    }
    const after = await tx<{ id: string; name: string; color: string; status_group: string }[]>`
      SELECT id, name, color, status_group FROM knowledge.statuses WHERE space_id = ${spaceId} ORDER BY position, id
    `;
    await auditFor(context)(tx, [
      {
        spaceId,
        action: "STATUSES_REPLACED",
        before: { statuses: existing.map((row) => ({ id: row.id, name: row.name, color: row.color, group: row.status_group })) },
        after: {
          statuses: after.map((row) => ({ id: row.id, name: row.name, color: row.color, group: row.status_group })),
          reassigned: plan.removed.filter((entry) => entry.target).map((entry) => ({ from: entry.id, to: entry.target, items: entry.itemCount }))
        }
      }
    ]);
  });
  publishKnowledge(spaceId, "structure", { actorId: context.user.id });
  return await getSpaceDetail(context, spaceId);
};

// Categories ------------------------------------------------------------------------------------------

const loadCategoryNodes = (sql: QuerySql, spaceId: string) => sql<{ id: string; parentId: string | null; name: string; rank: string }[]>`
  SELECT id, parent_id AS "parentId", name, rank FROM knowledge.categories WHERE space_id = ${spaceId} FOR UPDATE
`;

const selectCategory = async (sql: QuerySql, access: SpaceAccess, userId: string, categoryId: string): Promise<KnowledgeCategory> => {
  const row = (
    await sql<CategoryRow[]>`
      SELECT c.id, c.parent_id, c.name, c.rank,
        (
          SELECT count(*)::int FROM knowledge.items i JOIN knowledge.statuses st ON st.id = i.status_id
          WHERE i.space_id = c.space_id AND i.category_id = c.id AND i.deleted_at IS NULL
            AND ${itemVisibleSql(sql, seesAllDrafts(access.level), userId)}
        ) AS item_count
      FROM knowledge.categories c WHERE c.id = ${categoryId} AND c.space_id = ${access.spaceId}
    `
  )[0];
  if (!row) {
    throw new AppError("KNOWLEDGE_CATEGORY_NOT_FOUND", "Không tìm thấy chuyên mục.", 404);
  }
  return toCategory(row);
};

export const createCategory = async (
  context: AccessContext,
  spaceId: string,
  input: z.infer<typeof CreateKnowledgeCategoryRequestSchema>
): Promise<KnowledgeCategory> => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  requireKnowledgePermission(context, Permission.KnowledgeUpdate);
  const sql = getSql();
  const result = await sql.begin(async (tx) => {
    const access = await assertSpaceAccess(tx, context, spaceId, "manage", { lock: true });
    const parentId = input.parentId ?? null;
    assertCategoryPlacement(await loadCategoryNodes(tx, spaceId), null, parentId);
    const rank = await rankAtEnd(tx, { table: "knowledge.categories", where: { space_id: spaceId, parent_id: parentId } });
    const created = (
      await tx<{ id: string }[]>`
        INSERT INTO knowledge.categories (organization_id, space_id, parent_id, name, rank, created_by)
        VALUES (${context.organization.id}, ${spaceId}, ${parentId}, ${input.name}, ${rank}, ${context.user.id})
        RETURNING id
      `
    )[0]!;
    await auditFor(context)(tx, [{ spaceId, action: "CATEGORY_CREATED", after: { categoryId: created.id, name: input.name, parentId } }]);
    return await selectCategory(tx, access, context.user.id, created.id);
  });
  publishKnowledge(spaceId, "structure", { actorId: context.user.id });
  return result;
};

export const updateCategory = async (
  context: AccessContext,
  spaceId: string,
  categoryId: string,
  input: z.infer<typeof UpdateKnowledgeCategoryRequestSchema>
): Promise<KnowledgeCategory> => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  requireKnowledgePermission(context, Permission.KnowledgeUpdate);
  const sql = getSql();
  const result = await sql.begin(async (tx) => {
    const access = await assertSpaceAccess(tx, context, spaceId, "manage", { lock: true });
    const nodes = await loadCategoryNodes(tx, spaceId);
    const current = nodes.find((node) => node.id === categoryId);
    if (!current) {
      throw new AppError("KNOWLEDGE_CATEGORY_NOT_FOUND", "Không tìm thấy chuyên mục.", 404);
    }
    const parentId = input.parentId !== undefined ? input.parentId : current.parentId;
    const parentChanged = parentId !== current.parentId;
    if (parentChanged) {
      assertCategoryPlacement(nodes, categoryId, parentId);
    }
    const scope = { table: "knowledge.categories" as const, where: { space_id: spaceId, parent_id: parentId }, excludeId: categoryId };
    const rank = input.placement ? await rankForPlacement(tx, scope, input.placement) : parentChanged ? await rankAtEnd(tx, scope) : null;
    await tx`
      UPDATE knowledge.categories
      SET name = coalesce(${input.name ?? null}, name), parent_id = ${parentId}, rank = coalesce(${rank}, rank)
      WHERE id = ${categoryId} AND space_id = ${spaceId}
    `;
    const diff = changedFields({ name: current.name, parentId: current.parentId }, { name: input.name, parentId: input.parentId });
    if (diff.changed || rank !== null) {
      await auditFor(context)(tx, [
        {
          spaceId,
          action: "CATEGORY_UPDATED",
          before: { categoryId, ...diff.before, ...(rank !== null ? { rank: current.rank } : {}) },
          after: { categoryId, ...diff.after, ...(rank !== null ? { rank } : {}) }
        }
      ]);
    }
    return await selectCategory(tx, access, context.user.id, categoryId);
  });
  publishKnowledge(spaceId, "structure", { actorId: context.user.id });
  return result;
};

/** Deleting a category moves its items to the parent (or out of any category) and its sub-categories to the top. */
export const deleteCategory = async (context: AccessContext, spaceId: string, categoryId: string) => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  requireKnowledgePermission(context, Permission.KnowledgeUpdate);
  const sql = getSql();
  await sql.begin(async (tx) => {
    await assertSpaceAccess(tx, context, spaceId, "manage", { lock: true });
    const nodes = await loadCategoryNodes(tx, spaceId);
    const current = nodes.find((node) => node.id === categoryId);
    if (!current) {
      throw new AppError("KNOWLEDGE_CATEGORY_NOT_FOUND", "Không tìm thấy chuyên mục.", 404);
    }
    const children = nodes.filter((node) => node.parentId === categoryId);
    for (const child of children) {
      const rank = await rankAtEnd(tx, { table: "knowledge.categories", where: { space_id: spaceId, parent_id: null }, excludeId: child.id });
      await tx`UPDATE knowledge.categories SET parent_id = NULL, rank = ${rank} WHERE id = ${child.id} AND space_id = ${spaceId}`;
    }
    const target = current.parentId;
    const targetName = target ? (nodes.find((node) => node.id === target)?.name ?? null) : null;
    await tx`
      INSERT INTO knowledge.audit_log (organization_id, space_id, item_id, item_title, actor_user_id, action, before, after, reason)
      SELECT i.organization_id, i.space_id, i.id, i.title, ${context.user.id}, 'ITEM_MOVED',
        jsonb_build_object('categoryId', ${categoryId}::uuid, 'categoryName', ${current.name}::text),
        jsonb_build_object('categoryId', ${target}::uuid, 'categoryName', ${targetName}::text),
        'Xoá chuyên mục'
      FROM knowledge.items i WHERE i.space_id = ${spaceId} AND i.category_id = ${categoryId}
    `;
    const moved = await tx`
      UPDATE knowledge.items SET category_id = ${target}, updated_at = now(), updated_by = ${context.user.id}
      WHERE space_id = ${spaceId} AND category_id = ${categoryId}
    `;
    await tx`DELETE FROM knowledge.categories WHERE id = ${categoryId} AND space_id = ${spaceId}`;
    await auditFor(context)(tx, [
      {
        spaceId,
        action: "CATEGORY_DELETED",
        before: { categoryId, name: current.name, parentId: current.parentId },
        after: { movedItems: moved.count, itemsMovedTo: target, subcategoriesMovedToTop: children.map((child) => child.id) }
      }
    ]);
  });
  publishKnowledge(spaceId, "structure", { actorId: context.user.id });
  return { ok: true as const };
};

// Audit log -------------------------------------------------------------------------------------------

const auditFilters = (sql: QuerySql, spaceId: string, query: Omit<KnowledgeAuditQuery, "cursor" | "limit">) => {
  const actions = query.action === undefined ? null : Array.isArray(query.action) ? query.action : [query.action];
  return sql`
    l.space_id = ${spaceId}
    ${query.itemId ? sql`AND l.item_id = ${query.itemId}` : sql``}
    ${query.actorId ? sql`AND l.actor_user_id = ${query.actorId}` : sql``}
    ${actions ? sql`AND l.action = ANY(${actions}::text[])` : sql``}
    ${query.from ? sql`AND l.created_at >= (${query.from}::text)::timestamptz` : sql``}
    ${query.to ? sql`AND l.created_at < (${query.to}::text)::timestamptz` : sql``}
  `;
};

/** Full space log (space managers and org admins), newest first. */
export const getSpaceAudit = async (context: AccessContext, spaceId: string, query: KnowledgeAuditQuery) => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  const sql = getSql();
  await assertSpaceAccess(sql, context, spaceId, "manage", { intent: "read" });
  const cursor = decodeTimeCursor(query.cursor);
  const rows = await sql<(AuditRow & { cursor_at: string })[]>`
    SELECT ${auditColumnsSql(sql)}, ${timestampTextSql(sql, () => sql`l.created_at`)} AS cursor_at
    FROM knowledge.audit_log l
    WHERE l.organization_id = ${context.organization.id} AND ${auditFilters(sql, spaceId, query)}
      ${cursor ? sql`AND (l.created_at, l.id) < (${timestampParamSql(sql, cursor.at)}, ${cursor.id}::uuid)` : sql``}
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT ${query.limit + 1}
  `;
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  const hasMore = rows.length > query.limit;
  return {
    items: page.map((row) => toAuditEntry(row, { redactDeletedComments: false })),
    pageInfo: { hasMore, nextCursor: hasMore && last ? encodeTimeCursor(last.cursor_at, last.id) : null }
  };
};

const exportLimit = 20_000;

/** Excel export of the space log with the same filters (space managers and org admins). */
export const exportSpaceAudit = async (context: AccessContext, spaceId: string, rawQuery: unknown, res: Response) => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  const query = KnowledgeAuditExportQuerySchema.parse(rawQuery);
  const sql = getSql();
  const access = await assertSpaceAccess(sql, context, spaceId, "manage", { intent: "read" });
  const rows = await sql<(AuditRow & { actor_name: string | null })[]>`
    SELECT ${auditColumnsSql(sql)}, (SELECT au.display_name FROM public.app_users au WHERE au.id = l.actor_user_id) AS actor_name
    FROM knowledge.audit_log l
    WHERE l.organization_id = ${context.organization.id} AND ${auditFilters(sql, spaceId, query)}
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT ${exportLimit}
  `;
  // Payloads name categories by id in a few entries (parent of a new category, where a deleted one's items went).
  const categories = new Map(
    (await sql<{ id: string; name: string }[]>`SELECT id, name FROM knowledge.categories WHERE space_id = ${spaceId}`).map((row) => [row.id, row.name])
  );
  const resolvers = { category: (id: string) => categories.get(id) };
  const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  await sendWorkbook(res, exportFilename(`Nhật ký kho ${access.name}`, null, today), [
    {
      name: "Nhật ký",
      columns: [
        { header: "Thời gian", key: "at", width: 18 },
        { header: "Người thực hiện", key: "actor", width: 24 },
        { header: "Thao tác", key: "action", width: 24 },
        { header: "Mục", key: "item", width: 40 },
        { header: "Phiên bản", key: "version", width: 10 },
        { header: "Chi tiết", key: "detail", width: 70 },
        { header: "Lý do", key: "reason", width: 40 },
        // Raw payloads last, for completeness (the readable version is "Chi tiết").
        { header: "Dữ liệu gốc (JSON)", key: "raw", width: 50 }
      ],
      rows: rows.map((row) => ({
        at: businessDate(row.created_at),
        actor: row.actor_name ?? (row.actor ? null : "Hệ thống"),
        action: auditActionLabel(row.action),
        item: row.item_title,
        version: row.version_number,
        detail: describeAuditEntry(row, resolvers),
        reason: row.reason,
        raw: rawAuditJson(row)
      }))
    }
  ]);
};

export { accessLevelLabel };
