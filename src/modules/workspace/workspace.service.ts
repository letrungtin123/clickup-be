import type postgres from "postgres";

import { Permission, type PermissionKey } from "../../contracts/permissions.js";
import type {
  AppUser,
  CreateRoleRequest,
  EditableMembershipStatus,
  ManagedRole,
  OrganizationMemberCollection,
  PermissionCollection,
  Role,
  RoleCollection,
  UpdateOrganizationMemberRequest,
  UpdateRolePermissionsRequest,
  UpdateRoleRequest,
  WorkspaceContext
} from "../../contracts/schemas.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";

type QuerySql = postgres.Sql | postgres.TransactionSql;

type WorkspaceContextRow = {
  user_id: string;
  email: string | null;
  display_name: string;
  must_change_password: boolean;
  production_roles: string[] | null;
  organization_id: string;
  organization_slug: string;
  organization_name: string;
  role_id: string;
  role_key: string;
  role_name: string;
  permissions: string[] | null;
};

type PermissionDefinitionRow = {
  key: string;
  module: string;
  description: string;
};

type ManagedRoleRow = {
  id: string;
  organization_id: string;
  key: string;
  name: string;
  description: string | null;
  is_system: boolean;
  created_at: Date | string;
  updated_at: Date | string;
  permissions: string[] | null;
};

type OrganizationMemberRow = {
  id: string;
  organization_id: string;
  user_id: string;
  email: string | null;
  display_name: string;
  role_id: string;
  role_key: string;
  role_name: string;
  role_permissions: string[] | null;
  status: "invited" | "active" | "disabled";
  joined_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const toIso = (value: Date | string) => {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
};

const toNullableIso = (value: Date | string | null) => {
  return value === null ? null : toIso(value);
};

const nullableText = (value: string | null | undefined) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toPermissionKeys = (permissions: string[] | null): PermissionKey[] => {
  if (!permissions) {
    return [];
  }

  return permissions.filter((permission): permission is PermissionKey => {
    return Object.values(Permission).includes(permission as PermissionKey);
  });
};

const toRole = (row: Pick<ManagedRoleRow, "id" | "organization_id" | "key" | "name" | "permissions">): Role => ({
  id: row.id,
  organizationId: row.organization_id,
  key: row.key,
  name: row.name,
  permissions: toPermissionKeys(row.permissions)
});

const toManagedRole = (row: ManagedRoleRow): ManagedRole => ({
  ...toRole(row),
  description: row.description,
  isSystem: row.is_system,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at)
});

const toOrganizationMember = (row: OrganizationMemberRow) => ({
  id: row.id,
  user: {
    id: row.user_id,
    email: row.email,
    displayName: row.display_name
  },
  role: {
    id: row.role_id,
    organizationId: row.organization_id,
    key: row.role_key,
    name: row.role_name,
    permissions: toPermissionKeys(row.role_permissions)
  },
  status: row.status,
  joinedAt: toNullableIso(row.joined_at),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at)
});

const assertPermission = (context: WorkspaceContext, permission: PermissionKey) => {
  if (!context.role.permissions.includes(permission)) {
    throw new AppError("FORBIDDEN", "You do not have permission to perform this action.", 403);
  }
};

const uniquePermissionKeys = (permissions: PermissionKey[]) => {
  return [...new Set(permissions)];
};

const getManagedRoleById = async (
  sql: QuerySql,
  context: WorkspaceContext,
  roleId: string
): Promise<ManagedRole> => {
  const rows = await sql<ManagedRoleRow[]>`
    SELECT
      r.id,
      r.organization_id,
      r.key,
      r.name,
      r.description,
      r.is_system,
      r.created_at,
      r.updated_at,
      array_remove(array_agg(rp.permission_key ORDER BY rp.permission_key), NULL) AS permissions
    FROM public.roles r
    LEFT JOIN public.role_permissions rp
      ON rp.role_id = r.id
      AND rp.organization_id = r.organization_id
    WHERE r.id = ${roleId}
      AND r.organization_id = ${context.organization.id}
      AND r.deleted_at IS NULL
    GROUP BY r.id
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    throw new AppError("ROLE_NOT_FOUND", "Role was not found.", 404);
  }

  return toManagedRole(row);
};

const assertManagedRoleEditable = (role: ManagedRole) => {
  if (role.isSystem) {
    throw new AppError("ROLE_SYSTEM_PROTECTED", "System roles cannot be modified.", 409);
  }
};

const assertRoleExists = async (sql: QuerySql, context: WorkspaceContext, roleId: string) => {
  const rows = await sql<{ id: string }[]>`
    SELECT id
    FROM public.roles
    WHERE id = ${roleId}
      AND organization_id = ${context.organization.id}
      AND deleted_at IS NULL
    LIMIT 1
  `;

  if (rows.length === 0) {
    throw new AppError("ROLE_NOT_FOUND", "Role was not found.", 404);
  }
};

const assertOrganizationWillKeepSuperadmin = async (
  sql: QuerySql,
  context: WorkspaceContext,
  targetMembershipId: string
) => {
  const rows = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count
    FROM public.organization_memberships om
    JOIN public.roles r
      ON r.id = om.role_id
      AND r.organization_id = om.organization_id
      AND r.deleted_at IS NULL
    WHERE om.organization_id = ${context.organization.id}
      AND om.id <> ${targetMembershipId}
      AND om.status = 'active'
      AND om.deleted_at IS NULL
      AND r.key = 'superadmin'
  `;

  if (Number(rows[0]?.count ?? 0) === 0) {
    throw new AppError("ORG_SUPERADMIN_REQUIRED", "At least one active superadmin is required.", 409);
  }
};

/**
 * Privilege-escalation guard: only superadmins may grant capabilities they do not hold themselves,
 * edit their own role, or assign/modify superadmin memberships.
 */
export const assertCanGrantPermissions = (context: WorkspaceContext, permissions: readonly string[]) => {
  if (context.hasFullOrganizationAuthority) {
    return;
  }
  const own = new Set(context.role.permissions);
  if (permissions.some((permission) => !own.has(permission))) {
    throw new AppError("PERMISSION_ESCALATION", "You cannot grant permissions you do not have.", 403);
  }
};

export const assertCanAssignRole = async (sql: QuerySql, context: WorkspaceContext, roleId: string) => {
  const role = await getManagedRoleById(sql, context, roleId);
  if (!context.hasFullOrganizationAuthority && role.key === "superadmin") {
    throw new AppError("PERMISSION_ESCALATION", "Only a superadmin can assign the superadmin role.", 403);
  }
  assertCanGrantPermissions(context, role.permissions);
  return role;
};

export const getWorkspaceContext = async (userId: string): Promise<WorkspaceContext> => {
  const sql = getSql();
  const rows = await sql<WorkspaceContextRow[]>`
    SELECT
      au.id AS user_id,
      au.email,
      au.display_name,
      au.must_change_password,
      (
        SELECT array_agg(pur.role_code ORDER BY pur.role_code)
        FROM production.user_roles pur
        WHERE pur.organization_id = o.id AND pur.user_id = au.id
      ) AS production_roles,
      o.id AS organization_id,
      o.slug AS organization_slug,
      o.name AS organization_name,
      r.id AS role_id,
      r.key AS role_key,
      r.name AS role_name,
      array_remove(array_agg(rp.permission_key ORDER BY rp.permission_key), NULL) AS permissions
    FROM public.app_users au
    JOIN public.organization_memberships om
      ON om.user_id = au.id
      AND om.status = 'active'
      AND om.deleted_at IS NULL
    JOIN public.organizations o
      ON o.id = om.organization_id
      AND o.archived_at IS NULL
      AND o.deleted_at IS NULL
    JOIN public.roles r
      ON r.id = om.role_id
      AND r.organization_id = om.organization_id
      AND r.deleted_at IS NULL
    LEFT JOIN public.role_permissions rp
      ON rp.role_id = r.id
      AND rp.organization_id = r.organization_id
    WHERE au.id = ${userId}
      AND au.deleted_at IS NULL
    GROUP BY au.id, au.email, au.display_name, au.must_change_password, o.id, o.slug, o.name, r.id, r.key, r.name, om.joined_at, om.created_at
    ORDER BY om.joined_at ASC NULLS LAST, om.created_at ASC
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    throw new AppError("ORG_MEMBERSHIP_REQUIRED", "No active organization membership was found.", 403);
  }

  const permissions = toPermissionKeys(row.permissions);
  const user: AppUser = {
    id: row.user_id,
    email: row.email,
    displayName: row.display_name
  };
  const role: Role = {
    id: row.role_id,
    organizationId: row.organization_id,
    key: row.role_key,
    name: row.role_name,
    permissions
  };

  return {
    user,
    organization: {
      id: row.organization_id,
      slug: row.organization_slug,
      name: row.organization_name
    },
    role,
    hasFullOrganizationAuthority: row.role_key === "superadmin",
    mustChangePassword: row.must_change_password,
    productionRoles: row.production_roles ?? []
  };
};

export const listPermissions = async (context: WorkspaceContext): Promise<PermissionCollection> => {
  assertPermission(context, Permission.RoleView);
  const sql = getSql();
  const rows = await sql<PermissionDefinitionRow[]>`
    SELECT key, module, description
    FROM public.permissions
    ORDER BY module ASC, key ASC
    LIMIT 500
  `;

  return {
    items: rows.flatMap((row) => {
      const permissionKey = toPermissionKeys([row.key])[0];
      if (!permissionKey) {
        return [];
      }

      return [
        {
          key: permissionKey,
          module: row.module,
          description: row.description
        }
      ];
    })
  };
};

export const listRoles = async (context: WorkspaceContext): Promise<RoleCollection> => {
  // Member managers need the role list to pick one when creating or editing members.
  if (!context.role.permissions.includes(Permission.MemberManage)) {
    assertPermission(context, Permission.RoleView);
  }
  const sql = getSql();
  const rows = await sql<ManagedRoleRow[]>`
    SELECT
      r.id,
      r.organization_id,
      r.key,
      r.name,
      r.description,
      r.is_system,
      r.created_at,
      r.updated_at,
      array_remove(array_agg(rp.permission_key ORDER BY rp.permission_key), NULL) AS permissions
    FROM public.roles r
    LEFT JOIN public.role_permissions rp
      ON rp.role_id = r.id
      AND rp.organization_id = r.organization_id
    WHERE r.organization_id = ${context.organization.id}
      AND r.deleted_at IS NULL
    GROUP BY r.id
    ORDER BY r.is_system DESC, r.name ASC, r.id ASC
    LIMIT 200
  `;

  return { items: rows.map(toManagedRole) };
};

export const createRole = async (context: WorkspaceContext, input: CreateRoleRequest): Promise<ManagedRole> => {
  assertPermission(context, Permission.RoleCreate);
  const sql = getSql();
  const permissions = uniquePermissionKeys(input.permissions);
  assertCanGrantPermissions(context, permissions);
  const description = nullableText(input.description);

  if (input.key === "superadmin") {
    throw new AppError("ROLE_KEY_RESERVED", "This role key is reserved.", 409);
  }

  return await sql.begin(async (tx) => {
    const duplicateRows = await tx<{ id: string }[]>`
      SELECT id
      FROM public.roles
      WHERE organization_id = ${context.organization.id}
        AND key = ${input.key}
        AND deleted_at IS NULL
      LIMIT 1
    `;

    if (duplicateRows.length > 0) {
      throw new AppError("ROLE_KEY_EXISTS", "Role key already exists.", 409);
    }

    const roleRows = await tx<{ id: string }[]>`
      INSERT INTO public.roles (organization_id, key, name, description, is_system, created_by)
      VALUES (${context.organization.id}, ${input.key}, ${input.name}, ${description ?? null}, false, ${context.user.id})
      RETURNING id
    `;

    const roleId = roleRows[0]?.id;
    if (!roleId) {
      throw new AppError("ROLE_CREATE_FAILED", "Role could not be created.", 500);
    }

    if (permissions.length > 0) {
      await tx`
        INSERT INTO public.role_permissions (organization_id, role_id, permission_key, granted_by)
        SELECT ${context.organization.id}, ${roleId}, permission_key, ${context.user.id}
        FROM unnest(${permissions}::text[]) AS permission_key
      `;
    }

    return await getManagedRoleById(tx, context, roleId);
  });
};

export const updateRole = async (
  context: WorkspaceContext,
  roleId: string,
  input: UpdateRoleRequest
): Promise<ManagedRole> => {
  assertPermission(context, Permission.RoleUpdate);
  const sql = getSql();
  const current = await getManagedRoleById(sql, context, roleId);
  assertManagedRoleEditable(current);

  const hasName = input.name !== undefined;
  const hasDescription = input.description !== undefined;
  const description = nullableText(input.description);

  await sql`
    UPDATE public.roles
    SET name = CASE WHEN ${hasName} THEN ${input.name ?? ""} ELSE name END,
        description = CASE WHEN ${hasDescription} THEN ${description ?? null} ELSE description END,
        updated_at = now()
    WHERE id = ${roleId}
      AND organization_id = ${context.organization.id}
      AND deleted_at IS NULL
  `;

  return await getManagedRoleById(sql, context, roleId);
};

export const updateRolePermissions = async (
  context: WorkspaceContext,
  roleId: string,
  input: UpdateRolePermissionsRequest
): Promise<ManagedRole> => {
  assertPermission(context, Permission.RoleAssignPermission);
  const sql = getSql();
  const permissions = uniquePermissionKeys(input.permissions);

  return await sql.begin(async (tx) => {
    const current = await getManagedRoleById(tx, context, roleId);
    assertManagedRoleEditable(current);
    if (!context.hasFullOrganizationAuthority && current.id === context.role.id) {
      throw new AppError("PERMISSION_ESCALATION", "You cannot change the permissions of your own role.", 403);
    }
    assertCanGrantPermissions(context, permissions);

    await tx`
      DELETE FROM public.role_permissions
      WHERE organization_id = ${context.organization.id}
        AND role_id = ${roleId}
    `;

    if (permissions.length > 0) {
      await tx`
        INSERT INTO public.role_permissions (organization_id, role_id, permission_key, granted_by)
        SELECT ${context.organization.id}, ${roleId}, permission_key, ${context.user.id}
        FROM unnest(${permissions}::text[]) AS permission_key
      `;
    }

    await tx`
      UPDATE public.roles
      SET updated_at = now()
      WHERE id = ${roleId}
        AND organization_id = ${context.organization.id}
        AND deleted_at IS NULL
    `;

    return await getManagedRoleById(tx, context, roleId);
  });
};

export const archiveRole = async (context: WorkspaceContext, roleId: string) => {
  assertPermission(context, Permission.RoleDelete);
  const sql = getSql();
  const current = await getManagedRoleById(sql, context, roleId);
  assertManagedRoleEditable(current);

  const usageRows = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count
    FROM public.organization_memberships
    WHERE organization_id = ${context.organization.id}
      AND role_id = ${roleId}
      AND status = 'active'
      AND deleted_at IS NULL
  `;

  if (Number(usageRows[0]?.count ?? 0) > 0) {
    throw new AppError("ROLE_IN_USE", "Role is assigned to active organization members.", 409);
  }

  await sql`
    UPDATE public.roles
    SET deleted_at = now(), deleted_by = ${context.user.id}, updated_at = now()
    WHERE id = ${roleId}
      AND organization_id = ${context.organization.id}
      AND deleted_at IS NULL
  `;

  return { ok: true as const };
};

export const listOrganizationMembers = async (
  context: WorkspaceContext
): Promise<OrganizationMemberCollection> => {
  assertPermission(context, Permission.MemberView);
  const sql = getSql();
  const rows = await sql<OrganizationMemberRow[]>`
    SELECT
      om.id,
      om.organization_id,
      au.id AS user_id,
      au.email,
      au.display_name,
      r.id AS role_id,
      r.key AS role_key,
      r.name AS role_name,
      array_remove(array_agg(rp.permission_key ORDER BY rp.permission_key), NULL) AS role_permissions,
      om.status,
      om.joined_at,
      om.created_at,
      om.updated_at
    FROM public.organization_memberships om
    JOIN public.app_users au
      ON au.id = om.user_id
      AND au.deleted_at IS NULL
    JOIN public.roles r
      ON r.id = om.role_id
      AND r.organization_id = om.organization_id
      AND r.deleted_at IS NULL
    LEFT JOIN public.role_permissions rp
      ON rp.role_id = r.id
      AND rp.organization_id = r.organization_id
    WHERE om.organization_id = ${context.organization.id}
      AND om.deleted_at IS NULL
    GROUP BY om.id, au.id, r.id
    ORDER BY
      CASE om.status
        WHEN 'active' THEN 1
        WHEN 'invited' THEN 2
        ELSE 3
      END,
      au.display_name ASC,
      au.id ASC
    LIMIT 500
  `;

  return { items: rows.map(toOrganizationMember) };
};

export const updateOrganizationMember = async (
  context: WorkspaceContext,
  membershipId: string,
  input: UpdateOrganizationMemberRequest
) => {
  assertPermission(context, Permission.MemberManage);
  const sql = getSql();

  const currentRows = await sql<{ user_id: string; role_id: string; role_key: string; status: EditableMembershipStatus | "invited" }[]>`
    SELECT om.user_id, om.role_id, r.key AS role_key, om.status
    FROM public.organization_memberships om
    JOIN public.roles r
      ON r.id = om.role_id
      AND r.organization_id = om.organization_id
      AND r.deleted_at IS NULL
    WHERE om.id = ${membershipId}
      AND om.organization_id = ${context.organization.id}
      AND om.deleted_at IS NULL
    LIMIT 1
  `;

  const current = currentRows[0];
  if (!current) {
    throw new AppError("ORG_MEMBER_NOT_FOUND", "Organization member was not found.", 404);
  }

  if (current.user_id === context.user.id) {
    throw new AppError("SELF_MEMBERSHIP_UPDATE_FORBIDDEN", "You cannot change your own organization membership.", 409);
  }

  if (input.roleId) {
    await assertRoleExists(sql, context, input.roleId);
    await assertCanAssignRole(sql, context, input.roleId);
  }

  if (current.role_key === "superadmin" && !context.hasFullOrganizationAuthority) {
    throw new AppError("PERMISSION_ESCALATION", "Only a superadmin can change a superadmin membership.", 403);
  }
  // Nobody may disable or re-role someone who holds capabilities they do not hold themselves.
  assertCanGrantPermissions(context, (await getManagedRoleById(sql, context, current.role_id)).permissions);

  if (current.role_key === "superadmin" && (input.status === "disabled" || input.roleId)) {
    await assertOrganizationWillKeepSuperadmin(sql, context, membershipId);
  }

  const hasRole = input.roleId !== undefined;
  const hasStatus = input.status !== undefined;

  await sql`
    UPDATE public.organization_memberships
    SET role_id = CASE WHEN ${hasRole} THEN ${input.roleId ?? "00000000-0000-4000-8000-000000000000"}::uuid ELSE role_id END,
        status = CASE WHEN ${hasStatus} THEN ${input.status ?? "active"} ELSE status END,
        joined_at = CASE
          WHEN ${hasStatus} AND ${input.status ?? "active"} = 'active' THEN COALESCE(joined_at, now())
          ELSE joined_at
        END,
        updated_at = now()
    WHERE id = ${membershipId}
      AND organization_id = ${context.organization.id}
      AND deleted_at IS NULL
  `;

  const updatedRows = await sql<OrganizationMemberRow[]>`
    SELECT
      om.id,
      om.organization_id,
      au.id AS user_id,
      au.email,
      au.display_name,
      r.id AS role_id,
      r.key AS role_key,
      r.name AS role_name,
      array_remove(array_agg(rp.permission_key ORDER BY rp.permission_key), NULL) AS role_permissions,
      om.status,
      om.joined_at,
      om.created_at,
      om.updated_at
    FROM public.organization_memberships om
    JOIN public.app_users au
      ON au.id = om.user_id
      AND au.deleted_at IS NULL
    JOIN public.roles r
      ON r.id = om.role_id
      AND r.organization_id = om.organization_id
      AND r.deleted_at IS NULL
    LEFT JOIN public.role_permissions rp
      ON rp.role_id = r.id
      AND rp.organization_id = r.organization_id
    WHERE om.id = ${membershipId}
      AND om.organization_id = ${context.organization.id}
      AND om.deleted_at IS NULL
    GROUP BY om.id, au.id, r.id
    LIMIT 1
  `;

  const updated = updatedRows[0];
  if (!updated) {
    throw new AppError("ORG_MEMBER_NOT_FOUND", "Organization member was not found.", 404);
  }

  return toOrganizationMember(updated);
};

