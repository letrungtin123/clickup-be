import { Permission } from "../../contracts/permissions.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { escapeLike } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { getProjectAccess, hasPermission } from "../access/resource-access.js";
import { toUserRef, type UserRefJson } from "./mappers.js";
import { userJsonSql } from "./tasks.repo.js";

/**
 * People search for assignee / mention pickers. With `projectId` the result is limited to people
 * who can access that project (so pickers never suggest someone who cannot see the work);
 * without it the caller needs `member.view`.
 */
export const searchDirectory = async (
  context: AccessContext,
  input: { q?: string | undefined; projectId?: string | undefined; limit: number }
) => {
  const sql = getSql();
  let projectFilter = sql`TRUE`;
  if (input.projectId) {
    const access = await getProjectAccess(context, input.projectId, sql);
    if (!access) {
      throw new AppError("PROJECT_NOT_FOUND", "Project was not found.", 404);
    }
    if (access.visibility === "private") {
      projectFilter = sql`EXISTS (
        SELECT 1 FROM public.project_memberships pm
        WHERE pm.organization_id = om.organization_id AND pm.project_id = ${input.projectId}
          AND pm.user_id = om.user_id AND pm.status = 'active' AND pm.deleted_at IS NULL
      )`;
    }
  } else if (!hasPermission(context, Permission.MemberView)) {
    throw new AppError("FORBIDDEN", "You do not have permission to browse members.", 403);
  }

  const q = input.q?.trim().toLowerCase() ?? "";
  const like = `%${escapeLike(q)}%`;
  const rows = await sql<{ user: UserRefJson }[]>`
    SELECT ${userJsonSql(sql)} AS user
    FROM public.organization_memberships om
    JOIN public.app_users au ON au.id = om.user_id AND au.deleted_at IS NULL
    WHERE om.organization_id = ${context.organization.id}
      AND om.status = 'active'
      AND om.deleted_at IS NULL
      AND ${projectFilter}
      AND (
        ${q.length === 0}
        OR public.immutable_unaccent(lower(au.display_name)) LIKE public.immutable_unaccent(${like})
        OR lower(au.email) LIKE ${like}
      )
    ORDER BY (au.id = ${context.user.id}) DESC, au.display_name, au.id
    LIMIT ${input.limit}
  `;
  return { items: rows.map((row) => toUserRef(row.user)!) };
};
