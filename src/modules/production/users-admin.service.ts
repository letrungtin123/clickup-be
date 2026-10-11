import type { ProductionMember, ProductionRole } from "../../contracts/production-catalog.js";
import { productionRoleCodes } from "../../contracts/production-catalog.js";
import { Permission } from "../../contracts/permissions.js";
import type { CreateProductionUserRequest, LedJobs, ProductionUserChangeResult, UpdateProductionUserRequest } from "../../contracts/users-admin.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import type { QuerySql } from "../../lib/db-types.js";
import { logger } from "../../lib/logger.js";
import { disconnectUsers } from "../../realtime/publisher.js";
import { invalidateAccessContexts, type AccessContext } from "../access/access-context.js";
import { enqueueDomainEvents } from "../events/outbox.js";
import { afterMembershipStatusChange, issueTemporaryPassword, provisionOrganizationMember } from "../workspace/members.service.js";
import { assertProductionAdmin, assertProductionRole } from "./access.js";
import { updateMember } from "./catalog.service.js";
import { syncJobChatsForMember } from "./job-chat.service.js";
import { listOpenJobsLedBy, type LedJob } from "./member-lookups.js";
import { leaderRemovedEvent } from "./notifications.js";

/**
 * Production user administration (SPEC Phase 0 /admin/users, PD-024). A production ADMIN who does not hold the
 * organization's `member.manage` can create accounts, enable / disable them, reset passwords and set production
 * roles + team, reusing the workspace member services. Escalation guards (see `assertAccountManageable`):
 *   - only production ADMIN (superadmins included) — checked first, before anything is read;
 *   - never on an organization superadmin; on organization admins (roles holding member.manage or role.*) only
 *     when the caller is a superadmin;
 *   - no organization role is chosen: new accounts get the default "member" role, which must not be an admin role;
 *   - not on yourself for deactivate / reset password; your own ADMIN cannot be removed (catalog `updateMember`).
 */

/** Organization permissions that make a role an "organization admin" role (account / role management). */
export const orgAdminPermissions: readonly string[] = [
  Permission.MemberManage,
  Permission.RoleCreate,
  Permission.RoleUpdate,
  Permission.RoleDelete,
  Permission.RoleAssignPermission
];

/** Organization role given to accounts created from the production module (same as Google sign-ups). */
export const defaultMemberRoleKey = "member";

const org = (context: AccessContext) => context.organization.id;

type AccountTarget = {
  userId: string;
  status: "invited" | "active" | "disabled";
  superadmin: boolean;
  orgAdmin: boolean;
  roles: ProductionRole[];
};

const loadAccountTarget = async (sql: QuerySql, organizationId: string, userId: string): Promise<AccountTarget> => {
  const row = (
    await sql<{ status: AccountTarget["status"]; role_key: string; org_admin: boolean; roles: string[] | null }[]>`
      SELECT om.status, r.key AS role_key,
        EXISTS (
          SELECT 1 FROM public.role_permissions rp
          WHERE rp.organization_id = om.organization_id AND rp.role_id = om.role_id AND rp.permission_key = ANY(${[...orgAdminPermissions]}::text[])
        ) AS org_admin,
        (SELECT array_agg(ur.role_code) FROM production.user_roles ur WHERE ur.organization_id = om.organization_id AND ur.user_id = om.user_id) AS roles
      FROM public.organization_memberships om
      JOIN public.roles r ON r.id = om.role_id AND r.organization_id = om.organization_id
      JOIN public.app_users au ON au.id = om.user_id AND au.deleted_at IS NULL
      WHERE om.organization_id = ${organizationId} AND om.user_id = ${userId} AND om.deleted_at IS NULL
    `
  )[0];
  if (!row) {
    throw new AppError("MEMBER_NOT_FOUND", "Không tìm thấy thành viên.", 404);
  }
  const known = new Set<string>(productionRoleCodes);
  return {
    userId,
    status: row.status,
    superadmin: row.role_key === "superadmin",
    orgAdmin: row.role_key === "superadmin" || row.org_admin,
    roles: (row.roles ?? []).filter((role): role is ProductionRole => known.has(role))
  };
};

/**
 * Account-level actions (enable / disable, reset password) and production-role changes: never on a superadmin
 * (managed in Cài đặt › Thành viên with the "keep one superadmin" rule), and on organization admins only for a
 * superadmin caller. Team, custom fields and tags of anyone stay editable (profile data, not privileges).
 */
export const assertAccountManageable = (context: AccessContext, target: Pick<AccountTarget, "superadmin" | "orgAdmin">) => {
  if (target.superadmin) {
    throw new AppError("ORG_ADMIN_PROTECTED", "Tài khoản superadmin chỉ quản lý được ở Cài đặt › Thành viên.", 403);
  }
  if (target.orgAdmin && !context.hasFullOrganizationAuthority) {
    throw new AppError("ORG_ADMIN_PROTECTED", "Tài khoản quản trị tổ chức chỉ superadmin mới thao tác được.", 403);
  }
};

type MemberRow = {
  user_id: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  status: string;
  roles: string[] | null;
  team_id: string | null;
  custom_values: Record<string, unknown> | null;
  tag_ids: string[] | null;
};

/** One row of the production member list (`ProductionMember`, same shape as GET /production/members). */
const loadProductionMember = async (sql: QuerySql, organizationId: string, userId: string): Promise<ProductionMember> => {
  const row = (
    await sql<MemberRow[]>`
      SELECT au.id AS user_id, au.display_name, au.email, au.avatar_url, om.status,
        (SELECT array_agg(ur.role_code) FROM production.user_roles ur WHERE ur.organization_id = om.organization_id AND ur.user_id = au.id) AS roles,
        mp.team_id, mp.custom_values,
        (SELECT array_agg(et.tag_id) FROM production.entity_tags et
          WHERE et.organization_id = om.organization_id AND et.entity = 'USER' AND et.entity_id = au.id) AS tag_ids
      FROM public.organization_memberships om
      JOIN public.app_users au ON au.id = om.user_id AND au.deleted_at IS NULL
      LEFT JOIN production.member_profiles mp ON mp.organization_id = om.organization_id AND mp.user_id = au.id
      WHERE om.organization_id = ${organizationId} AND om.user_id = ${userId} AND om.deleted_at IS NULL
    `
  )[0];
  if (!row) {
    throw new AppError("MEMBER_NOT_FOUND", "Không tìm thấy thành viên.", 404);
  }
  const known = new Set<string>(productionRoleCodes);
  return {
    userId: row.user_id,
    displayName: row.display_name,
    email: row.email,
    avatarUrl: row.avatar_url,
    roles: (row.roles ?? [])
      .filter((role): role is ProductionRole => known.has(role))
      .sort((a, b) => productionRoleCodes.indexOf(a) - productionRoleCodes.indexOf(b)),
    teamId: row.team_id,
    active: row.status === "active",
    customValues: (row.custom_values ?? {}) as ProductionMember["customValues"],
    tagIds: row.tag_ids ?? []
  };
};

/** Open jobs the person still leads although they no longer lead (empty while they hold LEADER / ADMIN). */
const orphanedJobsOf = async (sql: QuerySql, organizationId: string, userId: string): Promise<LedJob[]> => {
  const led = await listOpenJobsLedBy(sql, organizationId, userId);
  return led.leaderActive ? [] : led.items;
};

/** GET /production/users/:userId/led-jobs — for Admins and Accounts, who hand jobs to another Leader. */
export const getLedJobs = async (context: AccessContext, userId: string): Promise<LedJobs> => {
  assertProductionRole(context, "ACCOUNT");
  const sql = getSql();
  await loadProductionMember(sql, org(context), userId);
  const led = await listOpenJobsLedBy(sql, org(context), userId);
  return { userId, displayName: led.displayName, leaderActive: led.leaderActive, items: led.items };
};

/** POST /production/users — account + production roles + team (+ whitelist) in one transaction (PD-005, PD-024). */
export const createProductionUser = async (context: AccessContext, input: CreateProductionUserRequest) => {
  assertProductionAdmin(context);
  const sql = getSql();
  const organizationId = org(context);
  const role = (
    await sql<{ id: string; org_admin: boolean }[]>`
      SELECT r.id,
        EXISTS (
          SELECT 1 FROM public.role_permissions rp
          WHERE rp.organization_id = r.organization_id AND rp.role_id = r.id AND rp.permission_key = ANY(${[...orgAdminPermissions]}::text[])
        ) AS org_admin
      FROM public.roles r
      WHERE r.organization_id = ${organizationId} AND r.key = ${defaultMemberRoleKey} AND r.deleted_at IS NULL
      LIMIT 1
    `
  )[0];
  if (!role) {
    throw new AppError("DEFAULT_ROLE_MISSING", "Tổ chức chưa có vai trò mặc định \"member\" (Thành viên). Nhờ quản trị tổ chức tạo trước.", 409);
  }
  if (role.org_admin) {
    // The default role must never hand out account / role management (escalation through account creation).
    throw new AppError("DEFAULT_ROLE_UNSAFE", "Vai trò mặc định \"member\" đang có quyền quản trị tổ chức. Nhờ quản trị tổ chức sửa lại.", 409);
  }
  if (input.teamId) {
    const team = await sql`SELECT 1 FROM production.teams WHERE organization_id = ${organizationId} AND id = ${input.teamId}`;
    if (team.length === 0) {
      throw new AppError("TEAM_NOT_FOUND", "Không tìm thấy team.", 404);
    }
  }

  const created = await provisionOrganizationMember(
    context,
    { email: input.email, displayName: input.displayName, jobTitle: input.jobTitle ?? null, roleId: role.id },
    async (tx, userId) => {
      // A taken-over account (membership removed earlier) starts from the roles chosen now.
      await tx`DELETE FROM production.user_roles WHERE organization_id = ${organizationId} AND user_id = ${userId}`;
      await tx`
        INSERT INTO production.user_roles (organization_id, user_id, role_code, granted_by)
        SELECT ${organizationId}, ${userId}, role, ${context.user.id} FROM unnest(${input.roles}::text[]) AS role
        ON CONFLICT DO NOTHING
      `;
      await tx`
        INSERT INTO production.member_profiles (organization_id, user_id, team_id)
        VALUES (${organizationId}, ${userId}, ${input.teamId ?? null})
        ON CONFLICT (organization_id, user_id) DO UPDATE SET team_id = EXCLUDED.team_id, updated_at = now()
      `;
      if (input.allowGoogleSignIn) {
        await tx`
          INSERT INTO public.allowed_emails (organization_id, email, added_by)
          VALUES (${organizationId}, ${input.email}, ${context.user.id})
          ON CONFLICT DO NOTHING
        `;
      }
    }
  );
  logger.info({ actorId: context.user.id, userId: created.member.user.id, roles: input.roles }, "Production user created");
  return { member: await loadProductionMember(sql, organizationId, created.member.user.id), temporaryPassword: created.temporaryPassword };
};

const leadingRoles: readonly ProductionRole[] = ["LEADER", "ACCOUNT", "ADMIN"];

/**
 * PATCH /production/users/:userId — production roles, team, custom fields, tags (same body as PATCH
 * /production/members/:userId, whose rules apply too: SELF_ADMIN_REMOVAL, TEAM_NOT_FOUND, custom field checks).
 * Afterwards: sockets re-authorize with the new roles; losing LEADER / ACCOUNT / ADMIN reconciles the person's job
 * chats (PD-022); losing LEADER while still leading open jobs returns them as `orphanedJobs` and notifies the other
 * production Admins (SEC2-04 follow-up).
 */
export const updateProductionUser = async (
  context: AccessContext,
  userId: string,
  input: UpdateProductionUserRequest
): Promise<ProductionUserChangeResult> => {
  assertProductionAdmin(context);
  const sql = getSql();
  const organizationId = org(context);
  const target = await loadAccountTarget(sql, organizationId, userId);
  const nextRoles = input.roles ? [...new Set(input.roles)] : null;
  const rolesChange = nextRoles !== null && (nextRoles.length !== target.roles.length || nextRoles.some((role) => !target.roles.includes(role)));
  if (rolesChange && userId !== context.user.id) {
    // Your own roles: only "keep your ADMIN" applies (catalog updateMember, SELF_ADMIN_REMOVAL).
    assertAccountManageable(context, target);
  }
  const member = await updateMember(context, userId, input);
  if (!rolesChange) {
    return { member, orphanedJobs: [] };
  }
  const removed = target.roles.filter((role) => !member.roles.includes(role));
  disconnectUsers([userId]);
  if (removed.some((role) => leadingRoles.includes(role))) {
    await syncJobChatsForMember(context, userId);
  }
  const orphanedJobs = removed.includes("LEADER") || removed.includes("ADMIN") ? await orphanedJobsOf(sql, organizationId, userId) : [];
  if (orphanedJobs.length > 0) {
    await enqueueDomainEvents(sql, [leaderRemovedEvent(organizationId, userId, context.user.id, "role_removed")]);
  }
  return { member, orphanedJobs };
};

/**
 * POST /production/users/:userId/deactivate | activate. Disabling ends every session and socket at once and
 * blocks sign-in (GoTrue ban), exactly like Cài đặt › Thành viên; the person leaves the job chats they were in
 * through their production role, and open jobs they lead come back as `orphanedJobs` (Admins are notified).
 */
export const setProductionUserActive = async (context: AccessContext, userId: string, active: boolean): Promise<ProductionUserChangeResult> => {
  assertProductionAdmin(context);
  const sql = getSql();
  const organizationId = org(context);
  if (!active && userId === context.user.id) {
    throw new AppError("SELF_DEACTIVATE_FORBIDDEN", "Bạn không thể tự khoá tài khoản của mình.", 409);
  }
  const target = await loadAccountTarget(sql, organizationId, userId);
  assertAccountManageable(context, target);
  const status = active ? "active" : "disabled";
  if (target.status !== status) {
    await sql`
      UPDATE public.organization_memberships
      SET status = ${status},
          joined_at = CASE WHEN ${status} = 'active' THEN COALESCE(joined_at, now()) ELSE joined_at END,
          updated_at = now()
      WHERE organization_id = ${organizationId} AND user_id = ${userId} AND deleted_at IS NULL
    `;
    await invalidateAccessContexts();
    await afterMembershipStatusChange(userId, status);
    logger.info({ actorId: context.user.id, targetUserId: userId, status }, "Production user status changed");
  }
  let orphanedJobs: LedJob[] = [];
  if (!active) {
    await syncJobChatsForMember(context, userId);
    orphanedJobs = await orphanedJobsOf(sql, organizationId, userId);
    if (orphanedJobs.length > 0 && target.status !== status) {
      await enqueueDomainEvents(sql, [leaderRemovedEvent(organizationId, userId, context.user.id, "deactivated")]);
    }
  }
  return { member: await loadProductionMember(sql, organizationId, userId), orphanedJobs };
};

/** POST /production/users/:userId/reset-password — one-time temporary password, every session ended (PD-005). */
export const resetProductionUserPassword = async (context: AccessContext, userId: string) => {
  assertProductionAdmin(context);
  if (userId === context.user.id) {
    throw new AppError("SELF_RESET_FORBIDDEN", "Dùng “Đổi mật khẩu” cho tài khoản của chính bạn.", 409);
  }
  const target = await loadAccountTarget(getSql(), org(context), userId);
  assertAccountManageable(context, target);
  logger.info({ actorId: context.user.id, targetUserId: userId }, "Member password reset (production admin)");
  return await issueTemporaryPassword(userId);
};
