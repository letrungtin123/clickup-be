import type { FeaturePermissionKey } from "../../contracts/production-catalog.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import type { QuerySql } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { assertProductionMember, featuresOf } from "./access.js";
import { loadSettings } from "./catalog.service.js";

/**
 * Feature permission matrix (PD-065, "Phân quyền Photo Retouch"): who uses each feature — QC queue, others' scores and
 * money, the Leader / Admin dashboards, anomalies, leave approval, clients — by production role, edited by the
 * superadmin in Cài đặt → Vai trò & phân quyền (setting `feature_permissions`, see `featurePermissionKeys`). The
 * matrix is read with the settings (cached per organization, catalog-cache.ts), like the job permission matrix.
 */

/** The caller's features. */
export const loadFeatures = async (context: AccessContext, sql: QuerySql = getSql()): Promise<Set<FeaturePermissionKey>> =>
  featuresOf(context, (await loadSettings(sql, context.organization.id)).featurePermissions);

/** The caller has `key` (the organization superadmin always). */
export const hasFeature = async (context: AccessContext, key: FeaturePermissionKey, sql: QuerySql = getSql()) =>
  (await loadFeatures(context, sql)).has(key);

/** 403 of a feature the caller lacks: code and Vietnamese message; `details.feature` names it. */
const refusals: Record<FeaturePermissionKey, { code: string; message: string }> = {
  qc_queue: { code: "FORBIDDEN", message: "Bạn không có quyền xem Hàng chờ QC." },
  view_others_scores: { code: "SCORES_PRIVATE", message: "Bạn không có quyền xem điểm của người khác." },
  view_others_money: { code: "FORBIDDEN", message: "Bạn không có quyền xem tiền Khoán của người khác." },
  leader_dashboard: { code: "FORBIDDEN", message: "Bạn không có quyền xem Bảng điều khiển." },
  admin_dashboard: { code: "FORBIDDEN", message: "Bạn không có quyền xem Quản trị số liệu." },
  anomalies: { code: "FORBIDDEN", message: "Bạn không có quyền xem Bất thường." },
  leave_approval: { code: "FORBIDDEN", message: "Bạn không có quyền duyệt đơn nghỉ." },
  clients: { code: "FORBIDDEN", message: "Bạn không có quyền xem Khách hàng." }
};

export const featureForbidden = (key: FeaturePermissionKey, message = refusals[key].message) =>
  new AppError(refusals[key].code, message, 403, { feature: key });

/** Production member (404 otherwise) holding `key` (403 otherwise; `message` overrides the default wording). */
export const assertFeature = async (context: AccessContext, key: FeaturePermissionKey, options: { sql?: QuerySql; message?: string } = {}) => {
  assertProductionMember(context);
  if (!(await hasFeature(context, key, options.sql))) {
    throw featureForbidden(key, options.message);
  }
};
