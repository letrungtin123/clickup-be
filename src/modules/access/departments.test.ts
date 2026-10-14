import { describe, expect, it } from "vitest";

import {
  CreateOrganizationMemberRequestSchema,
  WorkspaceContextSchema,
  WorkspaceSessionSchema
} from "../../contracts/schemas.js";
import { departmentCodes, departmentRolesProblem, DepartmentListSchema, SetCurrentDepartmentRequestSchema } from "../../contracts/departments.js";
import { AppError } from "../../lib/app-error.js";
import {
  assertDepartment,
  assertDepartmentsChangeAllowed,
  assertDepartmentsPresent,
  effectiveDepartments,
  hasDepartment,
  resolveCurrentDepartment
} from "./departments.js";

const caller = (departments: ("PHOTO_RETOUCH" | "PRODUCTION")[], superadmin = false) => ({
  hasFullOrganizationAuthority: superadmin,
  departments
});

const codeOf = (run: () => unknown) => {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof AppError ? error.code : "unexpected";
  }
};

describe("departments (PD-041)", () => {
  it("gives the superadmin every department and keeps a stable order otherwise", () => {
    expect(effectiveDepartments(true, [])).toEqual([...departmentCodes]);
    expect(effectiveDepartments(false, ["PRODUCTION", "PHOTO_RETOUCH", "UNKNOWN"])).toEqual(["PHOTO_RETOUCH", "PRODUCTION"]);
    expect(effectiveDepartments(false, null)).toEqual([]);
  });

  it("checks the caller's departments (superadmin always passes)", () => {
    expect(hasDepartment(caller(["PHOTO_RETOUCH"]), "PRODUCTION")).toBe(false);
    expect(hasDepartment(caller([], true), "PRODUCTION")).toBe(true);
    expect(codeOf(() => assertDepartment(caller(["PHOTO_RETOUCH"]), "PRODUCTION"))).toBe("DEPARTMENT_FORBIDDEN");
    expect(codeOf(() => assertDepartment(caller(["PRODUCTION"]), "PRODUCTION"))).toBeNull();
  });

  it("lets a non-superadmin add or remove only the departments they belong to", () => {
    const retouchAdmin = caller(["PHOTO_RETOUCH"]);
    expect(codeOf(() => assertDepartmentsChangeAllowed(retouchAdmin, [], ["PHOTO_RETOUCH"]))).toBeNull();
    expect(codeOf(() => assertDepartmentsChangeAllowed(retouchAdmin, [], ["PRODUCTION"]))).toBe("DEPARTMENT_ESCALATION");
    expect(codeOf(() => assertDepartmentsChangeAllowed(retouchAdmin, ["PRODUCTION"], []))).toBe("DEPARTMENT_ESCALATION");
    // An unchanged department the caller lacks is fine.
    expect(codeOf(() => assertDepartmentsChangeAllowed(retouchAdmin, ["PRODUCTION"], ["PRODUCTION", "PHOTO_RETOUCH"]))).toBeNull();
    expect(codeOf(() => assertDepartmentsChangeAllowed(caller([], true), [], ["PRODUCTION"]))).toBeNull();
  });

  it("requires a department unless the member is the superadmin", () => {
    expect(codeOf(() => assertDepartmentsPresent([], false))).toBe("DEPARTMENTS_REQUIRED");
    expect(codeOf(() => assertDepartmentsPresent([], true))).toBeNull();
    expect(codeOf(() => assertDepartmentsPresent(["PRODUCTION"], false))).toBeNull();
  });

  it("restores the saved department while the user still belongs to it", () => {
    expect(resolveCurrentDepartment(["PHOTO_RETOUCH", "PRODUCTION"], "PRODUCTION")).toBe("PRODUCTION");
    expect(resolveCurrentDepartment(["PHOTO_RETOUCH"], "PRODUCTION")).toBe("PHOTO_RETOUCH");
    expect(resolveCurrentDepartment(["PRODUCTION"], null)).toBe("PRODUCTION");
    expect(resolveCurrentDepartment([], "PRODUCTION")).toBeNull();
  });

  it("requires production roles exactly when Photo Retouch is chosen", () => {
    expect(departmentRolesProblem(["PHOTO_RETOUCH"], [])).not.toBeNull();
    expect(departmentRolesProblem(["PHOTO_RETOUCH", "PRODUCTION"], ["STAFF"])).toBeNull();
    expect(departmentRolesProblem(["PRODUCTION"], ["STAFF"])).not.toBeNull();
    expect(departmentRolesProblem(["PRODUCTION"], undefined)).toBeNull();
  });

  it("validates department lists and requests", () => {
    expect(DepartmentListSchema.parse(["PRODUCTION", "PHOTO_RETOUCH", "PRODUCTION"])).toEqual(["PHOTO_RETOUCH", "PRODUCTION"]);
    expect(DepartmentListSchema.safeParse(["SALES"]).success).toBe(false);
    expect(SetCurrentDepartmentRequestSchema.safeParse({ department: "PRODUCTION", extra: 1 }).success).toBe(false);
    const base = { email: "new.person@example.test", displayName: "Người Thử", roleId: "00000000-0000-4000-8000-000000000001" };
    expect(CreateOrganizationMemberRequestSchema.safeParse({ ...base, departments: ["PRODUCTION"] }).success).toBe(true);
    expect(CreateOrganizationMemberRequestSchema.safeParse({ ...base, departments: ["PHOTO_RETOUCH"] }).success).toBe(false);
    expect(
      CreateOrganizationMemberRequestSchema.safeParse({ ...base, departments: ["PHOTO_RETOUCH"], productionRoles: ["STAFF", "STAFF"] }).data
        ?.productionRoles
    ).toEqual(["STAFF"]);
    expect(CreateOrganizationMemberRequestSchema.safeParse({ ...base, departments: ["PRODUCTION"], productionRoles: ["QC"] }).success).toBe(false);
    expect(CreateOrganizationMemberRequestSchema.safeParse(base).success).toBe(false);
  });

  it("keeps older cached contexts and sessions readable", () => {
    const context = {
      user: { id: "00000000-0000-4000-8000-000000000001", email: null, displayName: "Người A" },
      organization: { id: "00000000-0000-4000-8000-000000000002", slug: "demo", name: "Demo" },
      role: { id: "00000000-0000-4000-8000-000000000003", organizationId: "00000000-0000-4000-8000-000000000002", key: "member", name: "Thành viên", permissions: [] },
      hasFullOrganizationAuthority: false
    };
    expect(WorkspaceContextSchema.parse(context)).toMatchObject({ departments: [], canSwitchDepartment: false });
    expect(WorkspaceSessionSchema.parse(context).currentDepartment).toBeNull();
  });
});
