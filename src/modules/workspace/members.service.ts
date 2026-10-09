import { Permission } from "../../contracts/permissions.js";
import type { ChangePasswordRequest, CreateOrganizationMemberRequest, WorkspaceContext } from "../../contracts/schemas.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import type { QuerySql } from "../../lib/db-types.js";
import { logger } from "../../lib/logger.js";
import { getOptionalRedis } from "../../lib/redis.js";
import { disconnectUsers } from "../../realtime/publisher.js";
import { invalidateAccessContexts } from "../access/access-context.js";
import { assertPermission } from "../access/resource-access.js";
import { createAuthUser, generateTemporaryPassword, setAuthUserBanned, setAuthUserPassword } from "../auth/supabase-admin.service.js";
import { revokeTokensIssuedBefore, signInWithPassword } from "../auth/supabase-auth.service.js";
import { enqueueDomainEvents } from "../events/outbox.js";
import { assertCanAssignRole, assertProductionRolesCovered, getOrganizationMemberByUserId } from "./workspace.service.js";

const accessTokenTtlSeconds = 3600;
/**
 * GoTrue (another container) stamps `iat` with its own clock. The user-wide "issued before" marker leaves this
 * much slack so a sign-in right after an admin reset never yields a dead session (WK-39); tokens inside the
 * slack are still ended through their session id (below).
 */
const clockSkewToleranceSeconds = 5;

const listSessionIds = async (sql: QuerySql, userId: string, keepSessionId: string | null) =>
  (
    await sql<{ id: string }[]>`
      SELECT id FROM auth.sessions
      WHERE user_id = ${userId} AND (${keepSessionId}::uuid IS NULL OR id <> ${keepSessionId}::uuid)
    `
  ).map((row) => row.id);

/**
 * Ends sessions of a user: refresh tokens are deleted and still-valid access tokens are denylisted (by
 * session id) until they expire. `knownSessionIds` are sessions listed before a password change, which may
 * already be gone from auth.sessions by now. Without `keepSessionId`, every token issued before now dies and
 * live sockets are disconnected.
 */
export const revokeUserSessions = async (userId: string, keepSessionId: string | null = null, knownSessionIds: string[] = []) => {
  const sql = getSql();
  if (!keepSessionId) {
    await revokeTokensIssuedBefore(userId, Math.floor(Date.now() / 1000) - clockSkewToleranceSeconds);
  }
  try {
    const deleted = await sql<{ id: string }[]>`
      DELETE FROM auth.sessions
      WHERE user_id = ${userId} AND (${keepSessionId}::uuid IS NULL OR id <> ${keepSessionId}::uuid)
      RETURNING id
    `;
    const sessionIds = [...new Set([...knownSessionIds, ...deleted.map((row) => row.id)])].filter((id) => id !== keepSessionId);
    const redis = getOptionalRedis();
    if (redis && sessionIds.length > 0) {
      const pipeline = redis.pipeline();
      for (const sessionId of sessionIds) {
        pipeline.set(`auth:revoked:${sessionId}`, "1", "EX", accessTokenTtlSeconds);
      }
      await pipeline.exec();
    }
  } catch (error) {
    logger.error({ err: error }, "Session revocation failed");
  }
  if (!keepSessionId) {
    disconnectUsers([userId]);
  }
};

/**
 * Changes a password through GoTrue and only then ends the other sessions: a rejected password (GoTrue
 * error) leaves every session as it was (BUG-WK-09). Sessions are listed first because GoTrue may drop them
 * on a password change, and their access tokens must still be denylisted.
 */
const changePasswordAndRevoke = async (userId: string, password: string, keepSessionId: string | null) => {
  const sql = getSql();
  const before = await listSessionIds(sql, userId, keepSessionId).catch((error: unknown) => {
    logger.warn({ err: error }, "Listing sessions before a password change failed");
    return [] as string[];
  });
  await setAuthUserPassword(userId, password);
  await revokeUserSessions(userId, keepSessionId, before);
};

/** PD-005: admins create accounts with a one-time temporary password the user must replace. */
export const createOrganizationMember = async (context: WorkspaceContext, input: CreateOrganizationMemberRequest) => {
  assertPermission(context, Permission.MemberManage);
  const sql = getSql();
  await assertCanAssignRole(sql, context, input.roleId);

  // One creation per address at a time: a double click must not hand out a password the second request
  // already replaced (WK-33). The lock is held while GoTrue is called (one short request).
  const { userId, temporaryPassword } = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`member-email:${input.email}`}, 0))`;
    const existing = await tx<{ id: string; has_membership: boolean; other_org: boolean }[]>`
      SELECT u.id,
        EXISTS (
          SELECT 1 FROM public.organization_memberships om
          WHERE om.organization_id = ${context.organization.id} AND om.user_id = u.id AND om.deleted_at IS NULL
        ) AS has_membership,
        EXISTS (
          SELECT 1 FROM public.organization_memberships oo
          WHERE oo.organization_id <> ${context.organization.id} AND oo.user_id = u.id AND oo.deleted_at IS NULL
        ) AS other_org
      FROM auth.users u
      WHERE lower(u.email) = ${input.email}
      LIMIT 1
    `;
    if (existing[0]?.has_membership) {
      throw new AppError("MEMBER_EXISTS", "This person is already a member.", 409);
    }
    if (existing[0]?.other_org) {
      // Never take over an account that belongs to another organization.
      throw new AppError("ACCOUNT_EXISTS", "An account with this email already exists.", 409);
    }

    const password = generateTemporaryPassword();
    let id = existing[0]?.id;
    if (id) {
      // Account exists without a membership here (e.g. previously removed): take it over cleanly —
      // new password, every old session revoked, any ban lifted. Leftover production roles must be covered.
      await assertProductionRolesCovered(tx, context, id);
      await changePasswordAndRevoke(id, password, null);
      await setAuthUserBanned(id, false);
    } else {
      id = await createAuthUser({ email: input.email, password, displayName: input.displayName });
    }

    await insertOrganizationMemberRecords(tx, {
      organizationId: context.organization.id,
      userId: id,
      email: input.email,
      displayName: input.displayName,
      jobTitle: input.jobTitle ?? null,
      roleId: input.roleId,
      mustChangePassword: true,
      profile: "overwrite",
      invitedBy: context.user.id,
      actorUserId: context.user.id
    });
    return { userId: id, temporaryPassword: password };
  });

  await invalidateAccessContexts();
  return { member: await getOrganizationMemberByUserId(context, userId), temporaryPassword };
};

/**
 * Writes the app profile, an active organization membership and the `member.created` event, inside
 * the caller's transaction. Shared by admin-created accounts and Google-provisioned ones (PD-012);
 * callers have already decided the role. `profile: "keep"` leaves an existing profile untouched.
 */
export const insertOrganizationMemberRecords = async (
  tx: QuerySql,
  input: {
    organizationId: string;
    userId: string;
    email: string;
    displayName: string;
    jobTitle: string | null;
    roleId: string;
    mustChangePassword: boolean;
    profile: "overwrite" | "keep";
    invitedBy: string | null;
    actorUserId: string | null;
  }
) => {
  if (input.profile === "overwrite") {
    await tx`
      INSERT INTO public.app_users (id, email, display_name, job_title, must_change_password)
      VALUES (${input.userId}, ${input.email}, ${input.displayName}, ${input.jobTitle}, ${input.mustChangePassword})
      ON CONFLICT (id) DO UPDATE
        SET email = EXCLUDED.email, display_name = EXCLUDED.display_name, job_title = EXCLUDED.job_title,
            must_change_password = EXCLUDED.must_change_password, deleted_at = NULL
    `;
  } else {
    await tx`
      INSERT INTO public.app_users (id, email, display_name, job_title, must_change_password)
      VALUES (${input.userId}, ${input.email}, ${input.displayName}, ${input.jobTitle}, ${input.mustChangePassword})
      ON CONFLICT (id) DO NOTHING
    `;
  }
  await tx`
    INSERT INTO public.organization_memberships (organization_id, user_id, role_id, status, invited_by, joined_at)
    VALUES (${input.organizationId}, ${input.userId}, ${input.roleId}, 'active', ${input.invitedBy}, now())
  `;
  await enqueueDomainEvents(tx, [
    {
      organizationId: input.organizationId,
      type: "member.created",
      aggregateType: "user",
      aggregateId: input.userId,
      actorUserId: input.actorUserId,
      payload: { email: input.email, roleId: input.roleId }
    }
  ]);
};

export const resetMemberPassword = async (context: WorkspaceContext, membershipId: string) => {
  assertPermission(context, Permission.MemberManage);
  const sql = getSql();
  const target = (
    await sql<{ user_id: string; role_id: string; role_key: string }[]>`
      SELECT om.user_id, om.role_id, r.key AS role_key
      FROM public.organization_memberships om
      JOIN public.roles r ON r.id = om.role_id AND r.organization_id = om.organization_id
      WHERE om.id = ${membershipId} AND om.organization_id = ${context.organization.id} AND om.deleted_at IS NULL
    `
  )[0];
  if (!target) {
    throw new AppError("ORG_MEMBER_NOT_FOUND", "Organization member was not found.", 404);
  }
  if (target.user_id === context.user.id) {
    throw new AppError("SELF_RESET_FORBIDDEN", "Use “Change password” for your own account.", 409);
  }
  if (target.role_key === "superadmin" && !context.hasFullOrganizationAuthority) {
    throw new AppError("PERMISSION_ESCALATION", "Only a superadmin can reset a superadmin's password.", 403);
  }
  // Resetting a password hands over the account: only for people with no more privileges than the caller,
  // in the workspace and in the production module (BUG-WK-03).
  await assertCanAssignRole(sql, context, target.role_id);
  await assertProductionRolesCovered(sql, context, target.user_id);
  logger.info({ actorId: context.user.id, targetUserId: target.user_id }, "Member password reset");

  const temporaryPassword = generateTemporaryPassword();
  await changePasswordAndRevoke(target.user_id, temporaryPassword, null);
  await sql`UPDATE public.app_users SET must_change_password = true WHERE id = ${target.user_id}`;
  await invalidateAccessContexts();
  return { temporaryPassword };
};

/** Raised when the current password is wrong: the only failure the change-password limiter counts (WK-38). */
export const currentPasswordInvalid = () => new AppError("CURRENT_PASSWORD_INVALID", "The current password is incorrect.", 400);

/** Self-service change; verifies the current password and keeps only the caller's current session. */
export const changeOwnPassword = async (
  context: WorkspaceContext,
  sessionId: string | null,
  input: ChangePasswordRequest
) => {
  if (!context.user.email) {
    throw new AppError("PASSWORD_CHANGE_UNAVAILABLE", "This account has no email password.", 409);
  }
  try {
    await signInWithPassword({ email: context.user.email, password: input.currentPassword });
  } catch {
    throw currentPasswordInvalid();
  }
  await changePasswordAndRevoke(context.user.id, input.newPassword, sessionId);
  await getSql()`UPDATE public.app_users SET must_change_password = false WHERE id = ${context.user.id}`;
  await invalidateAccessContexts();
  return { ok: true as const };
};
