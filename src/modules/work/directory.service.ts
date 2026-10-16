import type { Department } from "../../contracts/departments.js";
import { Permission } from "../../contracts/permissions.js";
import type { DirectoryPurpose } from "../../contracts/work.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { escapeLike } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { assertDepartment, departmentMemberSql } from "../access/departments.js";
import { getProjectAccess, hasPermission } from "../access/resource-access.js";
import { visibleUserSql } from "../access/test-accounts.js";
import { dmCallerOf, loadChannel } from "../chat/chat-access.js";
import { dmDirectoryScope, mentionScope } from "../chat/chat-rules.js";
import { toUserRef, type UserRefJson } from "./mappers.js";
import { userJsonSql } from "./tasks.repo.js";

/**
 * People search for assignee / mention pickers. With `projectId` the result is limited to people
 * who can access that project (so pickers never suggest someone who cannot see the work);
 * without it the caller needs `member.view`. Callers without `member.view` (pickers in a project or
 * channel they can use) get names only: no e-mail addresses, and e-mails are not searchable (SEC-API-04).
 * `purpose=dm` ("Tin nhắn mới"): every active member may search the people they may message (chat-rules
 * `dmDirectoryScope`: colleagues sharing a department plus superadmins, or anyone for callers who may create
 * channels); `projectId` / `channelId` do not apply.
 * `department` (PD-054, the department switcher): on top of every other scope, only members of that department (the
 * superadmin included, public.is_department_member); it must be one of the caller's (403 DEPARTMENT_FORBIDDEN).
 * Mention pickers (`channelId` without `purpose`) follow the channel only and ignore it.
 * PD-063: temporary QA test accounts are left out for a viewer who is not one (a test account sees everyone).
 */
export const searchDirectory = async (
  context: AccessContext,
  input: {
    q?: string | undefined;
    projectId?: string | undefined;
    channelId?: string | undefined;
    purpose?: DirectoryPurpose | undefined;
    department?: Department | undefined;
    limit: number;
  }
) => {
  const sql = getSql();
  const canViewMembers = hasPermission(context, Permission.MemberView);
  const department = input.purpose === "dm" || !input.channelId ? (input.department ?? null) : null;
  if (department) {
    assertDepartment(context, department);
  }
  let projectFilter = sql`TRUE`;
  if (input.purpose === "dm") {
    const scope = dmDirectoryScope(dmCallerOf(context));
    if (!scope.everyone) {
      // PD-041: shares a department with the caller, or is the superadmin (member of every department).
      projectFilter = sql`(
        EXISTS (
          SELECT 1 FROM public.user_departments ud
          WHERE ud.organization_id = om.organization_id AND ud.user_id = om.user_id
            AND ud.department = ANY(${scope.departments}::text[])
        )
        OR EXISTS (
          SELECT 1 FROM public.roles r
          WHERE r.id = om.role_id AND r.organization_id = om.organization_id AND r.key = 'superadmin'
        )
      )`;
    }
  } else if (input.channelId) {
    // Mention pickers follow the channel's mention scope (chat-rules `mentionScope`): private channels and DMs offer
    // their current members, a department's public channel its members plus the department (PD-053, superadmin
    // included), a public channel without department the whole organization.
    const resolved = await loadChannel(sql, context, input.channelId);
    if (!resolved?.caps.canRead) {
      throw new AppError("CHANNEL_NOT_FOUND", "Channel was not found.", 404);
    }
    const { kind, department } = resolved.channel;
    const scope = mentionScope(kind, department);
    if (scope !== "organization") {
      const channelMember = sql`EXISTS (
        SELECT 1 FROM public.channel_members cm
        WHERE cm.organization_id = om.organization_id AND cm.channel_id = ${input.channelId}
          AND cm.user_id = om.user_id AND cm.deleted_at IS NULL
      )`;
      projectFilter =
        scope === "department" && department
          ? sql`(${channelMember} OR ${departmentMemberSql(sql, sql`om.organization_id`, sql`om.user_id`, department)})`
          : channelMember;
    }
  } else if (input.projectId) {
    const access = await getProjectAccess(context, input.projectId, sql);
    if (!access) {
      throw new AppError("PROJECT_NOT_FOUND", "Project was not found.", 404);
    }
    // Explicit project members; on a public project also the members of its department (PD-041, superadmin included).
    const explicitMember = sql`EXISTS (
      SELECT 1 FROM public.project_memberships pm
      WHERE pm.organization_id = om.organization_id AND pm.project_id = ${input.projectId}
        AND pm.user_id = om.user_id AND pm.status = 'active' AND pm.deleted_at IS NULL
    )`;
    projectFilter =
      access.visibility === "private"
        ? explicitMember
        : sql`(${explicitMember} OR ${departmentMemberSql(sql, sql`om.organization_id`, sql`om.user_id`, access.department)})`;
  } else if (!canViewMembers) {
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
      AND ${visibleUserSql(sql, context)}
      ${department ? sql`AND ${departmentMemberSql(sql, sql`om.organization_id`, sql`om.user_id`, department)}` : sql``}
      AND (
        ${q.length === 0}
        OR public.immutable_unaccent(lower(au.display_name)) LIKE public.immutable_unaccent(${like})
        OR (${canViewMembers} AND lower(au.email) LIKE ${like})
      )
    ORDER BY (au.id = ${context.user.id}) DESC, au.display_name, au.id
    LIMIT ${input.limit}
  `;
  return {
    items: rows.map((row) => {
      const user = toUserRef(row.user)!;
      return canViewMembers || user.id === context.user.id ? user : { ...user, email: null };
    })
  };
};
