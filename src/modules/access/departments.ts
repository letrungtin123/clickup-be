import type postgres from "postgres";

import { departmentCodes, sortDepartments, type Department, type memberProductionRoleCodes } from "../../contracts/departments.js";
import { AppError } from "../../lib/app-error.js";
import type { QuerySql } from "../../lib/db-types.js";
import type { DepartmentRevokedTask } from "../work/department-access.js";
import type { AccessContext } from "./access-context.js";

/**
 * Departments (PD-041): PHOTO_RETOUCH (production module) and PRODUCTION (workspace projects). Membership rows live in
 * public.user_departments; the organization superadmin implicitly belongs to every department (no rows).
 * The access context carries the effective list (`context.departments`), so checks on the caller need no query.
 */

const known = new Set<string>(departmentCodes);

/** A production (Photo Retouch) role code as the member endpoints accept it (same codes as `productionRoleCodes`). */
export type MemberProductionRole = (typeof memberProductionRoleCodes)[number];

/** Effective departments from stored rows: every department for a superadmin, otherwise the rows (stable order). */
export const effectiveDepartments = (superadmin: boolean, rows: readonly string[] | null | undefined): Department[] =>
  superadmin ? [...departmentCodes] : sortDepartments((rows ?? []).filter((row): row is Department => known.has(row)));

/** The caller belongs to the department (superadmins always do). */
export const hasDepartment = (context: Pick<AccessContext, "hasFullOrganizationAuthority" | "departments">, department: Department) =>
  context.hasFullOrganizationAuthority || context.departments.includes(department);

/** 403 DEPARTMENT_FORBIDDEN unless the caller belongs to the department. */
export const assertDepartment = (context: Pick<AccessContext, "hasFullOrganizationAuthority" | "departments">, department: Department) => {
  if (!hasDepartment(context, department)) {
    throw new AppError("DEPARTMENT_FORBIDDEN", "Bạn không thuộc phòng ban này.", 403);
  }
};

/**
 * SQL predicate: the user belongs to the department (superadmin included). Arguments are SQL fragments or values,
 * e.g. `departmentMemberSql(sql, sql\`om.organization_id\`, sql\`om.user_id\`, sql\`p.department\`)`.
 */
export const departmentMemberSql = (
  sql: QuerySql,
  organizationId: postgres.PendingQuery<postgres.Row[]> | string,
  userId: postgres.PendingQuery<postgres.Row[]> | string,
  department: postgres.PendingQuery<postgres.Row[]> | Department
) =>
  sql`public.is_department_member(${typeof organizationId === "string" ? sql`${organizationId}::uuid` : organizationId}, ${
    typeof userId === "string" ? sql`${userId}::uuid` : userId
  }, ${typeof department === "string" ? sql`${department}::text` : department})`;

/** Stored department rows of a user (no implicit superadmin expansion). */
export const loadDepartmentRows = async (sql: QuerySql, organizationId: string, userId: string): Promise<Department[]> =>
  effectiveDepartments(
    false,
    (
      await sql<{ department: string }[]>`
        SELECT department FROM public.user_departments
        WHERE organization_id = ${organizationId} AND user_id = ${userId}
      `
    ).map((row) => row.department)
  );

/**
 * Replaces a user's department rows inside the caller's transaction. Returns what changed. The caller has authorized
 * the change (see `assertDepartmentsChangeAllowed`) and calls `invalidateAccessContexts()` after the commit.
 */
export const replaceUserDepartments = async (
  tx: QuerySql,
  input: { organizationId: string; userId: string; departments: readonly Department[]; actorUserId: string | null }
): Promise<{ added: Department[]; removed: Department[] }> => {
  const before = await loadDepartmentRows(tx, input.organizationId, input.userId);
  const next = sortDepartments(input.departments);
  const added = next.filter((department) => !before.includes(department));
  const removed = before.filter((department) => !next.includes(department));
  if (removed.length > 0) {
    await tx`
      DELETE FROM public.user_departments
      WHERE organization_id = ${input.organizationId} AND user_id = ${input.userId} AND department = ANY(${removed}::text[])
    `;
  }
  if (added.length > 0) {
    await tx`
      INSERT INTO public.user_departments (organization_id, user_id, department, created_by)
      SELECT ${input.organizationId}, ${input.userId}, department, ${input.actorUserId}
      FROM unnest(${added}::text[]) AS department
      ON CONFLICT DO NOTHING
    `;
  }
  return { added, removed };
};

/**
 * Escalation guard (PD-041): a caller who is not the superadmin may only add or remove departments they belong to
 * themselves ("an admin only sees the departments assigned to them"). 403 DEPARTMENT_ESCALATION otherwise.
 */
export const assertDepartmentsChangeAllowed = (
  context: Pick<AccessContext, "hasFullOrganizationAuthority" | "departments">,
  before: readonly Department[],
  after: readonly Department[]
) => {
  if (context.hasFullOrganizationAuthority) {
    return;
  }
  const changed = departmentCodes.filter((department) => before.includes(department) !== after.includes(department));
  if (changed.some((department) => !context.departments.includes(department))) {
    throw new AppError("DEPARTMENT_ESCALATION", "Bạn chỉ thêm hoặc bỏ được phòng ban mà bạn thuộc về.", 403);
  }
};

/** At least one department unless the (resulting) organization role is superadmin. 400 DEPARTMENTS_REQUIRED. */
export const assertDepartmentsPresent = (departments: readonly Department[], superadmin: boolean) => {
  if (!superadmin && departments.length === 0) {
    throw new AppError("DEPARTMENTS_REQUIRED", "Chọn ít nhất một phòng ban.", 400);
  }
};

/** The department to show: the saved choice while the user still belongs to it, otherwise the first one. */
export const resolveCurrentDepartment = (departments: readonly Department[], saved: string | null | undefined): Department | null =>
  departments.find((department) => department === saved) ?? departments[0] ?? null;

/** Same set of departments (order-insensitive; both lists are de-duplicated). */
export const sameDepartments = (a: readonly Department[], b: readonly Department[]) =>
  a.length === b.length && a.every((department) => b.includes(department));

/** 400 PRODUCTION_ROLES_REQUIRED: Photo Retouch members need at least one production role (PD-041). */
export const productionRolesRequired = () => new AppError("PRODUCTION_ROLES_REQUIRED", "Chọn ít nhất một vai trò Photo Retouch.", 400);

/** 400 PRODUCTION_ROLES_NOT_ALLOWED: production roles only exist inside the PHOTO_RETOUCH department (PD-041). */
export const productionRolesNotAllowed = () =>
  new AppError("PRODUCTION_ROLES_NOT_ALLOWED", "Vai trò Photo Retouch chỉ dành cho người thuộc phòng ban Photo Retouch.", 400);

/** A member's department / production-role change request (PD-041), see `MemberDepartmentWriter`. */
export type MemberDepartmentChangeInput = {
  userId: string;
  /** The member's organization role before / after this request is superadmin (implicitly in every department). */
  superadminBefore: boolean;
  superadminAfter: boolean;
  /** Replaces the department rows; undefined = unchanged. */
  departments?: readonly Department[] | undefined;
  /** Replaces the production roles; undefined = unchanged. */
  productionRoles?: readonly MemberProductionRole[] | undefined;
};

/** What a department change did (effective departments; production roles as stored, `removedRoles` effective). */
export type MemberDepartmentChange = {
  departments: Department[];
  added: Department[];
  removed: Department[];
  /** Tasks unassigned per department left (`revokeDepartmentAccessEffects`), published after the commit. */
  revoked: { department: Department; tasks: DepartmentRevokedTask[] }[];
  rolesBefore: MemberProductionRole[];
  rolesAfter: MemberProductionRole[];
  /** Production roles the person lost (a demoted superadmin also loses the implicit ADMIN). */
  removedRoles: MemberProductionRole[];
  /** Anything effective changed: caches, sockets and the PD-024 follow-ups must run after the commit. */
  changed: boolean;
};

/**
 * Writes a department change inside the caller's transaction (implemented by the production users admin,
 * `applyDepartmentChange`, and handed to the workspace member update so the workspace module does not import the
 * production module at load time).
 */
export type MemberDepartmentWriter = (tx: QuerySql, context: AccessContext, input: MemberDepartmentChangeInput) => Promise<MemberDepartmentChange>;
