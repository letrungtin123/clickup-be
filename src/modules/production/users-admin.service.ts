import type { ProductionMember, ProductionRole } from "../../contracts/production-catalog.js";
import { productionRoleCodes } from "../../contracts/production-catalog.js";
import { sortDepartments, type Department } from "../../contracts/departments.js";
import { Permission } from "../../contracts/permissions.js";
import type { CreateProductionUserRequest, LedJobs, ProductionUserChangeResult, UpdateProductionUserRequest } from "../../contracts/users-admin.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import type { QuerySql } from "../../lib/db-types.js";
import { logger } from "../../lib/logger.js";
import { disconnectUsers } from "../../realtime/publisher.js";
import { invalidateAccessContexts, type AccessContext } from "../access/access-context.js";
import { publishDepartmentChannelSync, syncDepartmentChannels, type DepartmentChannelSync } from "../chat/department-channels.js";
import {
  assertDepartmentsChangeAllowed,
  assertDepartmentsPresent,
  effectiveDepartments,
  loadDepartmentRows,
  productionRolesNotAllowed,
  productionRolesRequired,
  replaceUserDepartments,
  sameDepartments,
  type MemberDepartmentChange,
  type MemberDepartmentWriter
} from "../access/departments.js";
import { enqueueDomainEvents } from "../events/outbox.js";
import { publishDepartmentAccessRevoked, revokeDepartmentAccessEffects } from "../work/department-access.js";
import {
  afterMembershipStatusChange,
  issueTemporaryPassword,
  provisionOrganizationMember,
  writeMemberDepartments
} from "../workspace/members.service.js";
import { assertCanGrantProductionRoles } from "../workspace/workspace.service.js";
import { assertConfigEditor, assertProductionMember, assertProductionRole } from "./access.js";
import { updateMember } from "./catalog.service.js";
import { syncJobChatsForMember } from "./job-chat.service.js";
import { listOpenJobsLedBy, type LedJob } from "./member-lookups.js";
import { leaderRemovedEvent } from "./notifications.js";

/**
 * Production user administration (SPEC Phase 0 /admin/users, PD-024). Creating accounts, enabling / disabling them,
 * resetting passwords and setting departments, production roles + team reuse the workspace member services.
 * Escalation guards (see `assertAccountManageable`):
 *   - only the organization superadmin (PD-050: "Cấu hình Photo Retouch" is theirs alone; production Admins are 403)
 *     — checked first, before anything is read;
 *   - never on an organization superadmin; on organization admins (roles holding member.manage or role.*) only
 *     when the caller is a superadmin;
 *   - no organization role is chosen: new accounts get the default "member" role, which must not be an admin role;
 *   - not on yourself for deactivate / reset password; your own ADMIN cannot be removed (catalog `updateMember`);
 *   - departments (PD-041): only the ones the caller belongs to change (DEPARTMENT_ESCALATION); a superadmin's are
 *     implicit (never edited here); outside PHOTO_RETOUCH nobody holds a production role (`applyDepartmentChange`).
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
  /** Effective departments (PD-041): every department for a superadmin. */
  departments: Department[];
};

const loadAccountTarget = async (sql: QuerySql, organizationId: string, userId: string): Promise<AccountTarget> => {
  const row = (
    await sql<{ status: AccountTarget["status"]; role_key: string; org_admin: boolean; roles: string[] | null; departments: string[] | null }[]>`
      SELECT om.status, r.key AS role_key,
        EXISTS (
          SELECT 1 FROM public.role_permissions rp
          WHERE rp.organization_id = om.organization_id AND rp.role_id = om.role_id AND rp.permission_key = ANY(${[...orgAdminPermissions]}::text[])
        ) AS org_admin,
        (SELECT array_agg(ur.role_code) FROM production.user_roles ur WHERE ur.organization_id = om.organization_id AND ur.user_id = om.user_id) AS roles,
        (SELECT array_agg(ud.department) FROM public.user_departments ud WHERE ud.organization_id = om.organization_id AND ud.user_id = om.user_id) AS departments
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
    roles: (row.roles ?? []).filter((role): role is ProductionRole => known.has(role)),
    departments: effectiveDepartments(row.role_key === "superadmin", row.departments)
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
  superadmin: boolean;
  departments: string[] | null;
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
        (r.key = 'superadmin') AS superadmin,
        (SELECT array_agg(ud.department) FROM public.user_departments ud WHERE ud.organization_id = om.organization_id AND ud.user_id = au.id) AS departments,
        mp.team_id, mp.custom_values,
        (SELECT array_agg(et.tag_id) FROM production.entity_tags et
          WHERE et.organization_id = om.organization_id AND et.entity = 'USER' AND et.entity_id = au.id) AS tag_ids
      FROM public.organization_memberships om
      JOIN public.app_users au ON au.id = om.user_id AND au.deleted_at IS NULL
      JOIN public.roles r ON r.id = om.role_id AND r.organization_id = om.organization_id
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
    departments: effectiveDepartments(row.superadmin, row.departments),
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

/**
 * GET /production/users/:userId/led-jobs — for Admins and Accounts, who hand jobs to another Leader; anyone may read
 * their own list ("Job tôi phụ trách" in Việc của tôi).
 */
export const getLedJobs = async (context: AccessContext, userId: string): Promise<LedJobs> => {
  if (userId === context.user.id) {
    assertProductionMember(context);
  } else {
    assertProductionRole(context, "ACCOUNT");
  }
  const sql = getSql();
  await loadProductionMember(sql, org(context), userId);
  const led = await listOpenJobsLedBy(sql, org(context), userId);
  return { userId, displayName: led.displayName, leaderActive: led.leaderActive, items: led.items };
};

/**
 * POST /production/users — account + departments + production roles + team (+ whitelist) in one transaction (PD-005,
 * PD-024, PD-041). Departments: at least one (400 DEPARTMENTS_REQUIRED), only ones the caller belongs to unless
 * superadmin (403 DEPARTMENT_ESCALATION); production roles with PHOTO_RETOUCH only (the contract checks it too).
 */
export const createProductionUser = async (context: AccessContext, input: CreateProductionUserRequest) => {
  assertConfigEditor(context);
  const departments = sortDepartments(input.departments);
  assertDepartmentsPresent(departments, false);
  assertDepartmentsChangeAllowed(context, [], departments);
  const roles = departments.includes("PHOTO_RETOUCH") ? input.roles : [];
  if (roles.length === 0 && departments.includes("PHOTO_RETOUCH")) {
    throw productionRolesRequired();
  }
  if (input.roles.length > 0 && !departments.includes("PHOTO_RETOUCH")) {
    throw productionRolesNotAllowed();
  }
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

  const captured: { channels: DepartmentChannelSync | null } = { channels: null };
  const created = await provisionOrganizationMember(
    context,
    { email: input.email, displayName: input.displayName, jobTitle: input.jobTitle ?? null, roleId: role.id },
    async (tx, userId) => {
      // A taken-over account (membership removed earlier) starts from the departments and roles chosen now.
      captured.channels = await writeMemberDepartments(tx, context, { userId, departments, productionRoles: roles });
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
  // PD-053: the department channels they joined.
  await publishDepartmentChannelSync(captured.channels);
  logger.info({ actorId: context.user.id, userId: created.member.user.id, roles, departments }, "Production user created");
  return { member: await loadProductionMember(sql, organizationId, created.member.user.id), temporaryPassword: created.temporaryPassword };
};

const leadingRoles: readonly ProductionRole[] = ["LEADER", "ACCOUNT", "ADMIN"];

/** Known production role codes, de-duplicated, in the stable order of `productionRoleCodes`. */
const sortRoles = (roles: readonly string[]): ProductionRole[] => productionRoleCodes.filter((code) => roles.includes(code));

const loadProductionRoleRows = async (sql: QuerySql, organizationId: string, userId: string) =>
  sortRoles(
    (
      await sql<{ role_code: string }[]>`
        SELECT role_code FROM production.user_roles WHERE organization_id = ${organizationId} AND user_id = ${userId}
      `
    ).map((row) => row.role_code)
  );

/**
 * PD-024 follow-ups of production roles someone lost (role or department change), after the commit: their job chats
 * are reconciled when a leading role went (PD-022); open jobs they still lead although they no longer lead come back as
 * `orphanedJobs` and the other production Admins are notified (SEC2-04 follow-up).
 */
const afterProductionRolesRemoved = async (context: AccessContext, userId: string, removed: readonly string[]): Promise<LedJob[]> => {
  if (removed.some((role) => (leadingRoles as readonly string[]).includes(role))) {
    await syncJobChatsForMember(context, userId);
  }
  if (!removed.includes("LEADER") && !removed.includes("ADMIN")) {
    return [];
  }
  const sql = getSql();
  const orphanedJobs = await orphanedJobsOf(sql, org(context), userId);
  if (orphanedJobs.length > 0) {
    await enqueueDomainEvents(sql, [leaderRemovedEvent(org(context), userId, context.user.id, "role_removed")]);
  }
  return orphanedJobs;
};

/**
 * PD-041 department change of a member, inside the caller's transaction — the ONE implementation shared by Cài đặt ›
 * Thành viên (PATCH /organization/members/:id, injected into the workspace member update after the membership row is
 * updated) and the production users admin (PATCH /production/users/:userId, inside the catalog member update).
 *   - `departments` replaces the rows: at least one (400 DEPARTMENTS_REQUIRED — also for a demoted superadmin without
 *     rows); only departments the caller belongs to may change unless superadmin (403 DEPARTMENT_ESCALATION);
 *   - invariant: outside PHOTO_RETOUCH nobody (but the superadmin) holds a production role — leaving it deletes the
 *     roles, sending some is 400 PRODUCTION_ROLES_NOT_ALLOWED; joining it without roles needs `productionRoles`
 *     (400 PRODUCTION_ROLES_REQUIRED) and gets a production profile row;
 *   - granted or removed roles need the superadmin (PD-050, 403 PRODUCTION_ROLE_ESCALATION); your own ADMIN
 *     cannot go (409 SELF_ADMIN_REMOVAL);
 *   - each department the person effectively leaves runs `revokeDepartmentAccessEffects` (task assignments in its
 *     public workspace projects);
 *   - PD-053: they join the public chat channels of each department gained and leave those of each department lost
 *     (`syncDepartmentChannels`, a promotion to superadmin included).
 * A resulting superadmin belongs to every department implicitly: rows and roles are left untouched. After the commit
 * call `afterDepartmentChange` (or the equivalent follow-ups, as `updateProductionUser` does).
 */
export const applyDepartmentChange: MemberDepartmentWriter = async (tx, context, input) => {
  const organizationId = org(context);
  const rows = await loadDepartmentRows(tx, organizationId, input.userId);
  const before = effectiveDepartments(input.superadminBefore, rows);
  const rolesBefore = await loadProductionRoleRows(tx, organizationId, input.userId);
  if (input.superadminAfter) {
    const departments = effectiveDepartments(true, rows);
    const added = departments.filter((department) => !before.includes(department));
    const channels = await syncDepartmentChannels(tx, { organizationId, userId: input.userId, actorUserId: context.user.id, join: added, leave: [] });
    return { departments, added, removed: [], revoked: [], rolesBefore, rolesAfter: rolesBefore, removedRoles: [], channels, changed: added.length > 0 };
  }
  const next = input.departments ? sortDepartments(input.departments) : rows;
  assertDepartmentsPresent(next, false);
  assertDepartmentsChangeAllowed(context, before, next);

  const inRetouch = next.includes("PHOTO_RETOUCH");
  const requested = input.productionRoles ? sortRoles(input.productionRoles) : undefined;
  if (!inRetouch && requested && requested.length > 0) {
    throw productionRolesNotAllowed();
  }
  const rolesAfter = inRetouch ? (requested ?? rolesBefore) : [];
  if (inRetouch && rolesAfter.length === 0 && !rows.includes("PHOTO_RETOUCH")) {
    throw productionRolesRequired();
  }
  const granted = rolesAfter.filter((role) => !rolesBefore.includes(role));
  const deleted = rolesBefore.filter((role) => !rolesAfter.includes(role));
  // PD-050: granting or taking away a Photo Retouch role is the superadmin's alone.
  assertCanGrantProductionRoles(context, [...granted, ...deleted]);
  // A demoted superadmin also loses the implicit production ADMIN (PD-011).
  const removedRoles = (input.superadminBefore ? sortRoles([...rolesBefore, "ADMIN"]) : rolesBefore).filter((role) => !rolesAfter.includes(role));
  if (input.userId === context.user.id && !context.hasFullOrganizationAuthority && removedRoles.includes("ADMIN")) {
    throw new AppError("SELF_ADMIN_REMOVAL", "Bạn không thể tự bỏ quyền Quản trị của mình.", 409);
  }

  if (input.departments) {
    await replaceUserDepartments(tx, { organizationId, userId: input.userId, departments: next, actorUserId: context.user.id });
  }
  if (deleted.length > 0) {
    await tx`
      DELETE FROM production.user_roles
      WHERE organization_id = ${organizationId} AND user_id = ${input.userId} AND role_code = ANY(${deleted}::text[])
    `;
  }
  if (granted.length > 0) {
    await tx`
      INSERT INTO production.user_roles (organization_id, user_id, role_code, granted_by)
      SELECT ${organizationId}, ${input.userId}, role, ${context.user.id} FROM unnest(${granted}::text[]) AS role
      ON CONFLICT DO NOTHING
    `;
  }
  if (inRetouch && !rows.includes("PHOTO_RETOUCH")) {
    await tx`
      INSERT INTO production.member_profiles (organization_id, user_id)
      VALUES (${organizationId}, ${input.userId})
      ON CONFLICT (organization_id, user_id) DO NOTHING
    `;
  }
  const added = next.filter((department) => !before.includes(department));
  const removed = before.filter((department) => !next.includes(department));
  const revoked: MemberDepartmentChange["revoked"] = [];
  for (const department of removed) {
    revoked.push({ department, tasks: await revokeDepartmentAccessEffects(tx, context, input.userId, department) });
  }
  // PD-053: they join the public channels of the departments gained and leave those of the departments lost.
  const channels = await syncDepartmentChannels(tx, { organizationId, userId: input.userId, actorUserId: context.user.id, join: added, leave: removed });
  return {
    departments: next,
    added,
    removed,
    revoked,
    rolesBefore,
    rolesAfter,
    removedRoles,
    channels,
    changed: added.length > 0 || removed.length > 0 || granted.length > 0 || deleted.length > 0
  };
};

/**
 * After the commit of `applyDepartmentChange` (Cài đặt › Thành viên): access contexts are refreshed, the person's
 * sockets re-authorize, unassigned tasks get live hints, and the PD-024 follow-ups of lost production roles run.
 * Returns the open jobs they still lead although they no longer lead (the admins are notified).
 */
export const afterDepartmentChange = async (context: AccessContext, userId: string, change: MemberDepartmentChange | null): Promise<LedJob[]> => {
  if (!change?.changed) {
    return [];
  }
  for (const { department, tasks } of change.revoked) {
    await publishDepartmentAccessRevoked(context, userId, department, tasks);
  }
  await invalidateAccessContexts();
  await publishDepartmentChannelSync(change.channels);
  // The reconnect re-authorizes every room (the production room too when PHOTO_RETOUCH went).
  disconnectUsers([userId]);
  return await afterProductionRolesRemoved(context, userId, change.removedRoles);
};

/**
 * PATCH /production/users/:userId — departments (PD-041), production roles, team, custom fields, tags (same body as
 * PATCH /production/members/:userId, whose rules apply too: SELF_ADMIN_REMOVAL, TEAM_NOT_FOUND, custom field checks,
 * PRODUCTION_ROLES_NOT_ALLOWED). Department and role changes follow `assertAccountManageable` (a superadmin's
 * departments are implicit: never here); the department change itself is `applyDepartmentChange`, in the same
 * transaction as the rest. Afterwards: sockets re-authorize with the new roles; losing LEADER / ACCOUNT / ADMIN
 * reconciles the person's job chats (PD-022); losing LEADER while still leading open jobs returns them as
 * `orphanedJobs` and notifies the other production Admins (SEC2-04 follow-up).
 */
export const updateProductionUser = async (
  context: AccessContext,
  userId: string,
  input: UpdateProductionUserRequest
): Promise<ProductionUserChangeResult> => {
  assertConfigEditor(context);
  const sql = getSql();
  const organizationId = org(context);
  const target = await loadAccountTarget(sql, organizationId, userId);
  const nextRoles = input.roles ? [...new Set(input.roles)] : null;
  const rolesChange = nextRoles !== null && (nextRoles.length !== target.roles.length || nextRoles.some((role) => !target.roles.includes(role)));
  const departments = input.departments ? sortDepartments(input.departments) : null;
  const departmentsChange = departments !== null && !sameDepartments(departments, target.departments);
  if (departmentsChange && target.superadmin) {
    // Every department implicitly (managed in Cài đặt › Thành viên) — not even on yourself.
    assertAccountManageable(context, target);
  }
  if ((rolesChange || departmentsChange) && userId !== context.user.id) {
    // Your own roles / departments: only "keep your ADMIN" applies (SELF_ADMIN_REMOVAL).
    assertAccountManageable(context, target);
  }
  const captured: { change: MemberDepartmentChange | null } = { change: null };
  const member = await updateMember(
    context,
    userId,
    input,
    departmentsChange && departments
      ? async (tx) => {
          captured.change = await applyDepartmentChange(tx, context, {
            userId,
            superadminBefore: false,
            superadminAfter: false,
            departments,
            productionRoles: input.roles
          });
        }
      : undefined
  );
  if (!rolesChange && !departmentsChange) {
    return { member, orphanedJobs: [] };
  }
  // `updateMember` refreshed the access contexts after its commit.
  for (const { department, tasks } of captured.change?.revoked ?? []) {
    await publishDepartmentAccessRevoked(context, userId, department, tasks);
  }
  await publishDepartmentChannelSync(captured.change?.channels);
  disconnectUsers([userId]);
  const removed = target.roles.filter((role) => !member.roles.includes(role));
  return { member, orphanedJobs: await afterProductionRolesRemoved(context, userId, removed) };
};

/**
 * POST /production/users/:userId/deactivate | activate. Disabling ends every session and socket at once and
 * blocks sign-in (GoTrue ban), exactly like Cài đặt › Thành viên; the person leaves the job chats they were in
 * through their production role, and open jobs they lead come back as `orphanedJobs` (Admins are notified).
 */
export const setProductionUserActive = async (context: AccessContext, userId: string, active: boolean): Promise<ProductionUserChangeResult> => {
  assertConfigEditor(context);
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
  assertConfigEditor(context);
  if (userId === context.user.id) {
    throw new AppError("SELF_RESET_FORBIDDEN", "Dùng “Đổi mật khẩu” cho tài khoản của chính bạn.", 409);
  }
  const target = await loadAccountTarget(getSql(), org(context), userId);
  assertAccountManageable(context, target);
  logger.info({ actorId: context.user.id, targetUserId: userId }, "Member password reset (production admin)");
  return await issueTemporaryPassword(userId);
};
