import { productionRoleCodes, type ProductionRole } from "../../contracts/production-catalog.js";
import { AppError } from "../../lib/app-error.js";
import type { AccessContext } from "../access/access-context.js";

/**
 * Production (retouch) authorization (PD-011): multi-valued roles from the access context.
 * Organization superadmins are always production ADMIN. Checked server-side on every route.
 */
const known = new Set<string>(productionRoleCodes);

export const productionRolesOf = (context: AccessContext): Set<ProductionRole> => {
  const roles = new Set<ProductionRole>(
    context.productionRoles.filter((role): role is ProductionRole => known.has(role))
  );
  if (context.hasFullOrganizationAuthority) {
    roles.add("ADMIN");
  }
  return roles;
};

export const hasProductionRole = (context: AccessContext, ...roles: ProductionRole[]) => {
  const mine = productionRolesOf(context);
  return roles.some((role) => mine.has(role));
};

export const isProductionAdmin = (context: AccessContext) => productionRolesOf(context).has("ADMIN");

/** Any production role: the module is invisible (404) to everyone else. */
export const assertProductionMember = (context: AccessContext) => {
  if (productionRolesOf(context).size === 0) {
    throw new AppError("PRODUCTION_NOT_FOUND", "Không tìm thấy.", 404);
  }
};

/** At least one of the given roles; ADMIN always passes. */
export const assertProductionRole = (context: AccessContext, ...roles: ProductionRole[]) => {
  assertProductionMember(context);
  if (!isProductionAdmin(context) && !hasProductionRole(context, ...roles)) {
    throw new AppError("FORBIDDEN", "Bạn không có quyền thực hiện thao tác này.", 403);
  }
};

export const assertProductionAdmin = (context: AccessContext) => assertProductionRole(context, "ADMIN");
