import {
  ReportConfigSchema,
  reportMeasureInfo,
  type CreateSavedReportRequest,
  type ReportConfig,
  type SavedReport,
  type UpdateSavedReportRequest
} from "../../contracts/production-reports.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { toIso, type JsonObject, type QuerySql } from "../../lib/db-types.js";
import { logger } from "../../lib/logger.js";
import type { AccessContext } from "../access/access-context.js";
import { assertProductionRole, isProductionAdmin } from "./access.js";
import { loadSettings } from "./catalog.service.js";
import { assertReportAllowed } from "./reports.js";

/**
 * Saved report-builder configurations (SPEC Phase 5 §4, production.saved_reports). Report users are
 * ADMIN and LEADER. Visibility: own reports, plus every shared one. Only the owner edits name / config /
 * sharing; the owner or an ADMIN deletes; only an ADMIN pins (pinning shares the report, unsharing unpins).
 * A config is validated (whitelists + money rule) when saved and again whenever it runs.
 * PR-20: a report using an Admin-only measure (money) is `adminOnly` — other report users neither list nor
 * open it (it would only fail with 403 when run), even when an Admin shared it.
 */

const org = (context: AccessContext) => context.organization.id;
const listLimit = 500;

type SavedRow = {
  id: string;
  name: string;
  description: string | null;
  config: unknown;
  owner_id: string;
  owner_name: string;
  owner_email: string | null;
  owner_avatar: string | null;
  shared: boolean;
  pinned: boolean;
  pin_order: number;
  created_at: Date;
  updated_at: Date;
};

const notFound = () => new AppError("REPORT_NOT_FOUND", "Không tìm thấy báo cáo đã lưu.", 404);
/** The validated config as plain JSON (drops undefined optionals). */
const toJson = (config: ReportConfig) => JSON.parse(JSON.stringify(config)) as JsonObject;

const parseStoredConfig = (row: { id: string; config: unknown }): ReportConfig | null => {
  const parsed = ReportConfigSchema.safeParse(row.config);
  if (!parsed.success) {
    logger.warn({ savedReportId: row.id }, "Saved report config no longer matches the report contract");
    return null;
  }
  return parsed.data;
};

export const isAdminOnlyConfig = (config: Pick<ReportConfig, "measures">) => config.measures.some((measure) => reportMeasureInfo[measure].adminOnly);

const toSavedReport = (row: SavedRow, context: AccessContext): SavedReport | null => {
  const config = parseStoredConfig(row);
  if (!config) {
    return null;
  }
  const own = row.owner_id === context.user.id;
  const admin = isProductionAdmin(context);
  const adminOnly = isAdminOnlyConfig(config);
  if (adminOnly && !admin) {
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    config,
    owner: { id: row.owner_id, displayName: row.owner_name, email: row.owner_email, avatarUrl: row.owner_avatar },
    shared: row.shared,
    pinned: row.pinned,
    pinOrder: row.pin_order,
    adminOnly,
    canEdit: own,
    canDelete: own || admin,
    canPin: admin,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
};

const selectSaved = (sql: QuerySql) => sql`
  SELECT r.id, r.name, r.description, r.config, r.owner_id, u.display_name AS owner_name, u.email AS owner_email,
    u.avatar_url AS owner_avatar, r.shared, r.pinned, r.pin_order, r.created_at, r.updated_at
  FROM production.saved_reports r
  JOIN public.app_users u ON u.id = r.owner_id
`;

const loadVisible = async (sql: QuerySql, context: AccessContext, reportId: string) => {
  const row = (
    await sql<SavedRow[]>`
      ${selectSaved(sql)}
      WHERE r.organization_id = ${org(context)} AND r.id = ${reportId} AND (r.owner_id = ${context.user.id} OR r.shared)
    `
  )[0];
  if (!row) {
    throw notFound();
  }
  return row;
};

const checkConfig = async (context: AccessContext, config: ReportConfig) => {
  const settings = await loadSettings(getSql(), org(context));
  assertReportAllowed(context, config, settings.scoresPublic);
};

const assertCanPin = (context: AccessContext) => {
  if (!isProductionAdmin(context)) {
    throw new AppError("FORBIDDEN", "Chỉ Admin được ghim báo cáo lên dashboard.", 403);
  }
};

export const listSavedReports = async (context: AccessContext) => {
  assertProductionRole(context, "LEADER");
  const sql = getSql();
  const rows = await sql<SavedRow[]>`
    ${selectSaved(sql)}
    WHERE r.organization_id = ${org(context)} AND (r.owner_id = ${context.user.id} OR r.shared)
    ORDER BY r.pinned DESC, r.pin_order, r.updated_at DESC, r.id
    LIMIT ${listLimit}
  `;
  return { items: rows.map((row) => toSavedReport(row, context)).filter((item): item is SavedReport => item !== null) };
};

export const getSavedReport = async (context: AccessContext, reportId: string) => {
  assertProductionRole(context, "LEADER");
  const row = await loadVisible(getSql(), context, reportId);
  const config = parseStoredConfig(row);
  if (config && isAdminOnlyConfig(config) && !isProductionAdmin(context)) {
    throw notFound();
  }
  const report = toSavedReport(row, context);
  if (!report) {
    throw new AppError("REPORT_CONFIG_OUTDATED", "Cấu hình báo cáo không còn hợp lệ; hãy tạo lại.", 409);
  }
  return report;
};

export const createSavedReport = async (context: AccessContext, input: CreateSavedReportRequest) => {
  assertProductionRole(context, "LEADER");
  await checkConfig(context, input.config);
  if (input.pinned) {
    assertCanPin(context);
  }
  const sql = getSql();
  const id = (
    await sql<{ id: string }[]>`
      INSERT INTO production.saved_reports (organization_id, owner_id, name, description, config, shared, pinned, pin_order, pinned_by)
      VALUES (${org(context)}, ${context.user.id}, ${input.name}, ${input.description ?? null}, ${sql.json(toJson(input.config))},
        ${input.shared || input.pinned}, ${input.pinned}, ${input.pinOrder ?? 0}, ${input.pinned ? context.user.id : null})
      RETURNING id
    `
  )[0]!.id;
  return await getSavedReport(context, id);
};

export const updateSavedReport = async (context: AccessContext, reportId: string, input: UpdateSavedReportRequest) => {
  assertProductionRole(context, "LEADER");
  const sql = getSql();
  const current = await loadVisible(sql, context, reportId);
  const own = current.owner_id === context.user.id;
  const ownerFields = input.name !== undefined || input.description !== undefined || input.config !== undefined || input.shared !== undefined;
  if (ownerFields && !own) {
    throw new AppError("FORBIDDEN", "Chỉ người tạo được sửa báo cáo này.", 403);
  }
  if (input.pinned !== undefined || input.pinOrder !== undefined) {
    assertCanPin(context);
  }
  if (input.config) {
    await checkConfig(context, input.config);
  }
  let shared = input.shared ?? current.shared;
  let pinned = input.pinned ?? current.pinned;
  if (input.pinned === true) {
    shared = true;
  } else if (input.shared === false) {
    pinned = false;
  }
  const pinnedChanged = pinned !== current.pinned;
  await sql`
    UPDATE production.saved_reports SET
      ${input.config ? sql`config = ${sql.json(toJson(input.config))},` : sql``}
      ${pinnedChanged ? sql`pinned_by = ${pinned ? context.user.id : null},` : sql``}
      name = ${input.name ?? current.name},
      description = ${input.description === undefined ? current.description : input.description},
      shared = ${shared},
      pinned = ${pinned},
      pin_order = ${input.pinOrder ?? current.pin_order}
    WHERE organization_id = ${org(context)} AND id = ${reportId}
  `;
  return await getSavedReport(context, reportId);
};

export const deleteSavedReport = async (context: AccessContext, reportId: string) => {
  assertProductionRole(context, "LEADER");
  const sql = getSql();
  const current = await loadVisible(sql, context, reportId);
  if (current.owner_id !== context.user.id && !isProductionAdmin(context)) {
    throw new AppError("FORBIDDEN", "Chỉ người tạo hoặc Admin được xoá báo cáo này.", 403);
  }
  await sql`DELETE FROM production.saved_reports WHERE organization_id = ${org(context)} AND id = ${reportId}`;
  return { deleted: true };
};

/** Pinned reports for the Admin dashboard (configs only; the page runs them). */
export const listPinnedReports = async (sql: QuerySql, organizationId: string) => {
  const rows = await sql<{ id: string; name: string; config: unknown }[]>`
    SELECT id, name, config FROM production.saved_reports
    WHERE organization_id = ${organizationId} AND pinned
    ORDER BY pin_order, updated_at DESC, id
    LIMIT 50
  `;
  return rows.flatMap((row) => {
    const config = parseStoredConfig(row);
    return config ? [{ id: row.id, name: row.name, config }] : [];
  });
};
