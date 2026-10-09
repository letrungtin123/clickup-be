import { AppError } from "../../lib/app-error.js";
import type { QuerySql } from "../../lib/db-types.js";

/**
 * The organization switch "chat_attachments_enabled" (PD-013, SEC-API-03 / BUG-WK-49). It is edited in the
 * production settings screen and read here directly, so chat does not depend on the production module.
 * Missing setting (or no production schema) = enabled.
 */
export const chatAttachmentsEnabled = async (sql: QuerySql, organizationId: string) => {
  try {
    const row = (
      await sql<{ value: unknown }[]>`
        SELECT value FROM production.settings WHERE organization_id = ${organizationId} AND key = 'chat_attachments_enabled'
      `
    )[0];
    return row?.value !== false;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "42P01") {
      return true;
    }
    throw error;
  }
};

export const assertChatAttachmentsEnabled = async (sql: QuerySql, organizationId: string) => {
  if (!(await chatAttachmentsEnabled(sql, organizationId))) {
    throw new AppError("CHAT_ATTACHMENTS_DISABLED", "Quản trị viên đã tắt gửi tệp trong chat.", 403);
  }
};
