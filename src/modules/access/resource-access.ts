import type postgres from "postgres";

import { Permission, type PermissionKey } from "../../contracts/permissions.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import type { AccessContext } from "./access-context.js";

type QuerySql = postgres.Sql | postgres.TransactionSql;

export type ProjectAccessLevel = "view" | "submit" | "manage";

const projectLevels: ProjectAccessLevel[] = ["view", "submit", "manage"];

export const hasPermission = (context: AccessContext, permission: PermissionKey) =>
  context.role.permissions.includes(permission);

export const assertPermission = (context: AccessContext, permission: PermissionKey) => {
  if (!hasPermission(context, permission)) {
    throw new AppError("FORBIDDEN", "You do not have permission to perform this action.", 403);
  }
};

/**
 * Effective access to a project: organization boundary + `project.view` + active membership.
 * Superadmins have full authority. Returns null when the project is missing or invisible.
 */
export const getProjectAccessLevel = async (
  context: AccessContext,
  projectId: string,
  sql: QuerySql = getSql()
): Promise<ProjectAccessLevel | null> => {
  if (!hasPermission(context, Permission.ProjectView)) {
    return null;
  }

  const rows = await sql<{ access_level: ProjectAccessLevel | null }[]>`
    SELECT pm.access_level
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
  if (context.hasFullOrganizationAuthority) {
    return "manage";
  }
  return row.access_level;
};

export const assertProjectAccessLevel = async (
  context: AccessContext,
  projectId: string,
  required: ProjectAccessLevel,
  sql: QuerySql = getSql()
) => {
  const level = await getProjectAccessLevel(context, projectId, sql);
  if (!level) {
    throw new AppError("PROJECT_NOT_FOUND", "Project was not found.", 404);
  }
  if (projectLevels.indexOf(level) < projectLevels.indexOf(required)) {
    throw new AppError("FORBIDDEN", "Project access is insufficient.", 403);
  }
  return level;
};

export const projectLevelAtLeast = (level: ProjectAccessLevel | null, required: ProjectAccessLevel) =>
  level !== null && projectLevels.indexOf(level) >= projectLevels.indexOf(required);
