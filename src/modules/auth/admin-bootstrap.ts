import { env } from "../../config/env.js";
import { getSql, hasDatabaseConfig } from "../../db/client.js";
import { logger } from "../../lib/logger.js";
import { scheduleGoogleAuthUserProvisioning } from "./google-auth.service.js";

/**
 * SPEC Phase 0 ("1 admin lấy email từ biến môi trường ADMIN_EMAIL, có trong allowed_emails"): at API start-up the
 * address in ADMIN_EMAIL is added to the sign-in whitelist if it is missing. Idempotent (ON CONFLICT DO NOTHING),
 * never removes entries and never grants roles: the account itself is still created by an Admin (PD-005) or by the
 * superadmin bootstrap. The address is never logged. No address is hard-coded anywhere.
 */

/**
 * Which organizations the address is whitelisted in: every organization where it already has a membership;
 * otherwise the only active organization (single-tenant install). With several organizations and no membership
 * the target is ambiguous → none (logged).
 */
export const chooseWhitelistOrganizations = (input: { memberOrganizationIds: string[]; activeOrganizationIds: string[] }) => {
  if (input.memberOrganizationIds.length > 0) {
    return [...new Set(input.memberOrganizationIds)];
  }
  return input.activeOrganizationIds.length === 1 ? [...input.activeOrganizationIds] : [];
};

export type AdminWhitelistOutcome =
  | { status: "skipped"; reason: "not_configured" | "no_database" | "no_organization" }
  | { status: "done"; organizations: number; added: number };

export const ensureAdminEmailWhitelisted = async (email: string | undefined = env.ADMIN_EMAIL): Promise<AdminWhitelistOutcome> => {
  if (!email) {
    return { status: "skipped", reason: "not_configured" };
  }
  if (!hasDatabaseConfig()) {
    return { status: "skipped", reason: "no_database" };
  }
  const sql = getSql();
  const [members, active] = await Promise.all([
    sql<{ organization_id: string }[]>`
      SELECT DISTINCT om.organization_id
      FROM public.organization_memberships om
      JOIN public.app_users au ON au.id = om.user_id
      JOIN public.organizations o ON o.id = om.organization_id AND o.deleted_at IS NULL AND o.archived_at IS NULL
      WHERE lower(au.email) = ${email} AND om.deleted_at IS NULL
    `,
    sql<{ id: string }[]>`SELECT id FROM public.organizations WHERE deleted_at IS NULL AND archived_at IS NULL ORDER BY created_at LIMIT 2`
  ]);
  const organizationIds = chooseWhitelistOrganizations({
    memberOrganizationIds: members.map((row) => row.organization_id),
    activeOrganizationIds: active.map((row) => row.id)
  });
  if (organizationIds.length === 0) {
    logger.warn("ADMIN_EMAIL is set but no single organization to whitelist it in was found (it has no membership yet)");
    return { status: "skipped", reason: "no_organization" };
  }
  const inserted = await sql<{ organization_id: string }[]>`
    INSERT INTO public.allowed_emails (organization_id, email, added_by)
    SELECT organization_id, ${email}, NULL FROM unnest(${organizationIds}::uuid[]) AS organization_id
    ON CONFLICT DO NOTHING
    RETURNING organization_id
  `;
  if (inserted.length > 0) {
    logger.info({ organizations: inserted.length }, "ADMIN_EMAIL added to the sign-in whitelist");
    scheduleGoogleAuthUserProvisioning([email]);
  }
  return { status: "done", organizations: organizationIds.length, added: inserted.length };
};

/** Fire-and-forget at start-up: a failure is logged and never stops the API. */
export const scheduleAdminEmailBootstrap = () => {
  ensureAdminEmailWhitelisted().catch((error: unknown) => logger.error({ err: error }, "ADMIN_EMAIL whitelist bootstrap failed"));
};
