import type { Department } from "../../contracts/departments.js";
import { Permission, type PermissionKey } from "../../contracts/permissions.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import type { QuerySql } from "../../lib/db-types.js";
import type { AccessContext } from "./access-context.js";
import { hasDepartment } from "./departments.js";

export type ProjectAccessLevel = "view" | "submit" | "manage";

const projectLevels: ProjectAccessLevel[] = ["view", "submit", "manage"];

export const hasPermission = (context: AccessContext, permission: PermissionKey) =>
  context.role.permissions.includes(permission);

export const assertPermission = (context: AccessContext, permission: PermissionKey) => {
  if (!hasPermission(context, permission)) {
    throw new AppError("FORBIDDEN", "You do not have permission to perform this action.", 403);
  }
};

export type ProjectAccess = {
  level: ProjectAccessLevel;
  isMember: boolean;
  visibility: "public" | "private";
  /** Owning department (PD-041): a public project is open to that department's members. */
  department: Department;
  projectKey: string;
};

/**
 * Effective project access (PD-006 + PD-041): organization boundary + `project.view` + explicit (invited)
 * membership, or implicit `submit` on public projects of a department the caller belongs to. Superadmins manage
 * everything. Returns null when the project is missing or invisible — callers answer 404 either way.
 */
export const getProjectAccess = async (
  context: AccessContext,
  projectId: string,
  sql: QuerySql = getSql()
): Promise<ProjectAccess | null> => {
  if (!hasPermission(context, Permission.ProjectView)) {
    return null;
  }

  const rows = await sql<
    { key: string; visibility: "public" | "private"; department: Department; access_level: ProjectAccessLevel | null }[]
  >`
    SELECT p.key, p.visibility, p.department, pm.access_level
    FROM public.projects p
    LEFT JOIN public.project_memberships pm
      ON pm.organization_id = p.organization_id
      AND pm.project_id = p.id
      AND pm.user_id = ${context.user.id}
      AND pm.status = 'active'
      AND pm.deleted_at IS NULL
    WHERE p.id = ${projectId}
      AND p.organization_id = ${context.organization.id}
      AND p.archived_at IS NULL
      AND p.deleted_at IS NULL
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    return null;
  }

  const isMember = row.access_level !== null;
  const base = { isMember, visibility: row.visibility, department: row.department, projectKey: row.key };
  if (context.hasFullOrganizationAuthority) {
    return { ...base, level: "manage" };
  }
  if (row.access_level) {
    return { ...base, level: row.access_level };
  }
  // A public project is open to its department only (PD-041); anyone else needs an invitation.
  if (row.visibility === "public" && hasDepartment(context, row.department)) {
    return { ...base, level: "submit" };
  }
  return null;
};

export const getProjectAccessLevel = async (context: AccessContext, projectId: string, sql: QuerySql = getSql()) =>
  (await getProjectAccess(context, projectId, sql))?.level ?? null;

export const projectLevelAtLeast = (level: ProjectAccessLevel | null | undefined, required: ProjectAccessLevel) =>
  level !== null && level !== undefined && projectLevels.indexOf(level) >= projectLevels.indexOf(required);

export const assertProjectAccess = async (
  context: AccessContext,
  projectId: string,
  required: ProjectAccessLevel,
  sql: QuerySql = getSql()
): Promise<ProjectAccess> => {
  const access = await getProjectAccess(context, projectId, sql);
  if (!access) {
    throw new AppError("PROJECT_NOT_FOUND", "Project was not found.", 404);
  }
  if (!projectLevelAtLeast(access.level, required)) {
    throw new AppError("FORBIDDEN", "Project access is insufficient.", 403);
  }
  return access;
};

/**
 * SQL predicate selecting projects visible to the caller (alias `p`): explicit (invited) membership, or a public
 * project of one of the caller's departments (PD-041). Superadmins see everything.
 */
export const visibleProjectsPredicate = (sql: QuerySql, context: AccessContext) => {
  if (context.hasFullOrganizationAuthority) {
    return sql`TRUE`;
  }
  const departments: string[] = [...context.departments];
  return sql`(
    (p.visibility = 'public' AND p.department = ANY(${departments}::text[]))
    OR EXISTS (
      SELECT 1 FROM public.project_memberships vpm
      WHERE vpm.organization_id = p.organization_id
        AND vpm.project_id = p.id
        AND vpm.user_id = ${context.user.id}
        AND vpm.status = 'active'
        AND vpm.deleted_at IS NULL
    )
  )`;
};
