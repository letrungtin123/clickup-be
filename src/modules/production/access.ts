import {
  effectiveFeatures,
  productionRoleCodes,
  type FeaturePermissionKey,
  type FeaturePermissionMatrix,
  type ProductionRole
} from "../../contracts/production-catalog.js";
import { AppError } from "../../lib/app-error.js";
import type { AccessContext } from "../access/access-context.js";

/**
 * Production (retouch) authorization (PD-011): multi-valued roles from the access context.
 * Organization superadmins are always production ADMIN and DIRECTOR (PD-065). Checked server-side on every route.
 */
const known = new Set<string>(productionRoleCodes);

export const productionRolesOf = (context: AccessContext): Set<ProductionRole> => {
  const roles = new Set<ProductionRole>(
    context.productionRoles.filter((role): role is ProductionRole => known.has(role))
  );
  if (context.hasFullOrganizationAuthority) {
    roles.add("ADMIN");
    roles.add("DIRECTOR");
  }
  return roles;
};

export const hasProductionRole = (context: AccessContext, ...roles: ProductionRole[]) => {
  const mine = productionRolesOf(context);
  return roles.some((role) => mine.has(role));
};

export const isProductionAdmin = (context: AccessContext) => productionRolesOf(context).has("ADMIN");

/**
 * PD-065 data scope of the dashboards and anomalies: ADMIN and DIRECTOR (the superadmin holds both) see every job;
 * anyone else who has the feature sees the jobs they lead plus the jobs without a leader.
 */
export const seesWholeOrganization = (context: AccessContext) => hasProductionRole(context, "ADMIN", "DIRECTOR");

/**
 * PD-065: the caller's features in the feature permission matrix (union over their roles; the organization superadmin has
 * all). Services load the matrix with the settings (`loadFeatures` in features.ts) and call this.
 */
export const featuresOf = (context: AccessContext, matrix: FeaturePermissionMatrix): Set<FeaturePermissionKey> =>
  new Set(effectiveFeatures(productionRolesOf(context), matrix, context.hasFullOrganizationAuthority));

/**
 * The caller leads this job AND still holds LEADER (or ADMIN). Job-leader powers (split, reassign, correct
 * quantities, edit, private score rows, visibility through leadership) end when the LEADER role is removed,
 * even before an Account hands the job to another leader (SEC2-04). Everyone holding LEADER sees every job
 * anyway (PD-014), so `leader_id` alone never grants anything.
 */
export const leadsJob = (context: AccessContext, leaderId: string | null | undefined) =>
  Boolean(leaderId) && leaderId === context.user.id && hasProductionRole(context, "LEADER", "ADMIN");

/**
 * The caller acts as the job leader (workflow actor JOB_LEADER, "Giao lại", job chat, private score rows): they lead
 * it (`leadsJob`), or the job has no leader (PD-035) and they hold LEADER or ADMIN — an unled job belongs to every
 * Leader until one is named.
 */
export const actsAsJobLeader = (context: AccessContext, leaderId: string | null | undefined) =>
  leaderId ? leadsJob(context, leaderId) : hasProductionRole(context, "LEADER", "ADMIN");

/** Any production role: the module is invisible (404) to everyone else. */
export const assertProductionMember = (context: AccessContext) => {
  if (productionRolesOf(context).size === 0) {
    throw new AppError("PRODUCTION_NOT_FOUND", "Không tìm thấy.", 404);
  }
};

/** At least one of the given roles; ADMIN always passes (DIRECTOR does not: it has no Quản trị power, PD-065). */
export const assertProductionRole = (context: AccessContext, ...roles: ProductionRole[]) => {
  assertProductionMember(context);
  if (!isProductionAdmin(context) && !hasProductionRole(context, ...roles)) {
    throw new AppError("FORBIDDEN", "Bạn không có quyền thực hiện thao tác này.", 403);
  }
};

export const assertProductionAdmin = (context: AccessContext) => assertProductionRole(context, "ADMIN");

/**
 * Every write of "Cấu hình Photo Retouch" — settings (job permission matrix included), clients, projects, processes,
 * shifts, credit rules, statuses / order / transitions, job statuses, custom fields, tags, teams, members' production
 * profile, whitelist, production users, KPI targets and the KPI close run — is the organization superadmin's alone
 * (PD-049, PD-050). Production members get 403 (reads keep their own rules); non-members still get 404.
 */
export const assertConfigEditor = (context: AccessContext) => {
  assertProductionMember(context);
  if (!context.hasFullOrganizationAuthority) {
    throw new AppError("FORBIDDEN", "Chỉ Siêu quản trị mới sửa được Cấu hình Photo Retouch.", 403);
  }
};

export const hasAnyProductionRole = (context: AccessContext) => productionRolesOf(context).size > 0;

/** Realtime room of the organization's production module (production roles only). */
export const productionRoom = (organizationId: string) => ({ type: "production" as const, id: organizationId });
