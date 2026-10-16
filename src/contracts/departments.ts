import { z } from "zod";

/**
 * Departments ("Phòng ban", PD-041). One organization, two fixed departments, each with its own module:
 *   - PHOTO_RETOUCH — the production module (/production/*), still gated by production roles (PD-011);
 *   - PRODUCTION    — the ClickUp-style workspace projects (/p/*, /my-tasks).
 * A user belongs to one or both. The organization superadmin implicitly belongs to every department.
 * Shared by everyone: accounts, Hộp thư, Chat, Kho tri thức, Trang chủ, Thùng rác, Cài đặt, search of shared content.
 *
 * Endpoints (all under /api/v1):
 *   GET /workspace/context          → `departments`, `canSwitchDepartment` (access context) + `currentDepartment`
 *   PUT /workspace/department       SetCurrentDepartmentRequest → SetCurrentDepartmentResponse (remembered per user)
 */
export const departmentCodes = ["PHOTO_RETOUCH", "PRODUCTION"] as const;
export const DepartmentSchema = z.enum(departmentCodes);
export type Department = z.infer<typeof DepartmentSchema>;

/** UI labels (Vietnamese UI keeps the department names in English, as the company uses them). */
export const departmentLabels: Record<Department, string> = {
  PHOTO_RETOUCH: "Photo Retouch",
  PRODUCTION: "Production"
};

/** Short labels for tight places (phone top bar, badges). */
export const departmentShortLabels: Record<Department, string> = {
  PHOTO_RETOUCH: "Retouch",
  PRODUCTION: "Production"
};

/** Stable order: Photo Retouch first (the core module, PD-008). */
export const sortDepartments = (departments: readonly Department[]): Department[] =>
  departmentCodes.filter((code) => departments.includes(code));

/** A department list in a request: known codes, de-duplicated, stable order. */
export const DepartmentListSchema = z
  .array(DepartmentSchema)
  .max(departmentCodes.length * 2)
  .transform((departments) => sortDepartments(departments));

/**
 * Production role codes accepted where members are created / edited outside the production module (Cài đặt ›
 * Thành viên). Kept identical to `productionRoleCodes` (contracts/production-catalog.ts; a test checks it) — this file
 * must not import the production contracts (import cycle through schemas.ts).
 */
export const memberProductionRoleCodes = ["ADMIN", "ACCOUNT", "LEADER", "QC", "STAFF", "DIRECTOR"] as const;
export const MemberProductionRolesSchema = z
  .array(z.enum(memberProductionRoleCodes))
  .max(memberProductionRoleCodes.length * 2)
  .transform((roles) => [...new Set(roles)]);

export const SetCurrentDepartmentRequestSchema = z.object({ department: DepartmentSchema }).strict();
export type SetCurrentDepartmentRequest = z.infer<typeof SetCurrentDepartmentRequestSchema>;

export const SetCurrentDepartmentResponseSchema = z.object({ currentDepartment: DepartmentSchema });
export type SetCurrentDepartmentResponse = z.infer<typeof SetCurrentDepartmentResponseSchema>;

/**
 * Member create / edit rule shared by Cài đặt › Thành viên and the production users admin: production roles are
 * required when PHOTO_RETOUCH is chosen and not allowed otherwise. Returns a Vietnamese message, or null when fine.
 */
export const departmentRolesProblem = (
  departments: readonly Department[],
  productionRoles: readonly string[] | undefined
): string | null => {
  const hasRoles = (productionRoles?.length ?? 0) > 0;
  if (departments.includes("PHOTO_RETOUCH")) {
    return hasRoles ? null : "Chọn ít nhất một vai trò Photo Retouch.";
  }
  return hasRoles ? "Vai trò Photo Retouch chỉ dành cho người thuộc phòng ban Photo Retouch." : null;
};

/** At least one department, except for an organization superadmin (implicitly in all). */
export const departmentsRequiredMessage = "Chọn ít nhất một phòng ban.";
