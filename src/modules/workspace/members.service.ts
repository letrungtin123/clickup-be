import { Permission } from "../../contracts/permissions.js";
import type { ChangePasswordRequest, CreateOrganizationMemberRequest, WorkspaceContext } from "../../contracts/schemas.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { logger } from "../../lib/logger.js";
import { getOptionalRedis } from "../../lib/redis.js";
import { disconnectUsers } from "../../realtime/publisher.js";
import { invalidateAccessContexts } from "../access/access-context.js";
import { assertPermission } from "../access/resource-access.js";
import { createAuthUser, generateTemporaryPassword, setAuthUserBanned, setAuthUserPassword } from "../auth/supabase-admin.service.js";
import { revokeTokensIssuedBefore, signInWithPassword } from "../auth/supabase-auth.service.js";
import { enqueueDomainEvents } from "../events/outbox.js";
import { assertCanAssignRole, listOrganizationMembers } from "./workspace.service.js";

const accessTokenTtlSeconds = 3600;

/**
 * Ends every session of a user: refresh tokens are deleted and still-valid access tokens are
 * denylisted until they expire. Live sockets are disconnected.
 */
export const revokeUserSessions = async (userId: string, keepSessionId: string | null = null) => {
  const sql = getSql();
  if (!keepSessionId) {
    // Admin reset / disable: every access token issued up to and including this second dies.
    // (JWT iat has one-second resolution; the user signs in again later, never within this second.)
    await revokeTokensIssuedBefore(userId, Math.floor(Date.now() / 1000) + 1);
  }
  try {
    const sessions = await sql<{ id: string }[]>`
      DELETE FROM auth.sessions
      WHERE user_id = ${userId} AND (${keepSessionId}::uuid IS NULL OR id <> ${keepSessionId}::uuid)
      RETURNING id
    `;
    const redis = getOptionalRedis();
    if (redis && sessions.length > 0) {
      const pipeline = redis.pipeline();
      for (const session of sessions) {
        pipeline.set(`auth:revoked:${session.id}`, "1", "EX", accessTokenTtlSeconds);
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

const findMemberById = async (context: WorkspaceContext, userId: string) => {
  const members = await listOrganizationMembers(context);
  const member = members.items.find((item) => item.user.id === userId);
  if (!member) {
    throw new AppError("ORG_MEMBER_NOT_FOUND", "Organization member was not found.", 404);
  }
  return member;
};

/** PD-005: admins create accounts with a one-time temporary password the user must replace. */
export const createOrganizationMember = async (context: WorkspaceContext, input: CreateOrganizationMemberRequest) => {
  assertPermission(context, Permission.MemberManage);
  const sql = getSql();
  await assertCanAssignRole(sql, context, input.roleId);

  const existing = await sql<{ id: string; has_membership: boolean; other_org: boolean }[]>`
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

  const temporaryPassword = generateTemporaryPassword();
  let userId = existing[0]?.id;
  if (userId) {
    // Account exists without a membership here (e.g. previously removed): take it over cleanly —
    // new password, every old session revoked, any ban lifted.
    await setAuthUserPassword(userId, temporaryPassword);
    await setAuthUserBanned(userId, false);
    await revokeUserSessions(userId);
  } else {
    userId = await createAuthUser({ email: input.email, password: temporaryPassword, displayName: input.displayName });
  }

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO public.app_users (id, email, display_name, job_title, must_change_password)
      VALUES (${userId}, ${input.email}, ${input.displayName}, ${input.jobTitle ?? null}, true)
      ON CONFLICT (id) DO UPDATE
        SET email = EXCLUDED.email, display_name = EXCLUDED.display_name, job_title = EXCLUDED.job_title,
            must_change_password = true, deleted_at = NULL
    `;
    await tx`
      INSERT INTO public.organization_memberships (organization_id, user_id, role_id, status, invited_by, joined_at)
      VALUES (${context.organization.id}, ${userId}, ${input.roleId}, 'active', ${context.user.id}, now())
    `;
    await enqueueDomainEvents(tx, [
      {
        organizationId: context.organization.id,
        type: "member.created",
        aggregateType: "user",
        aggregateId: userId,
        actorUserId: context.user.id,
        payload: { email: input.email, roleId: input.roleId }
      }
    ]);
  });

  await invalidateAccessContexts();
  return { member: await findMemberById(context, userId), temporaryPassword };
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
  // Resetting a password hands over the account: only for people with no more privileges than the caller.
  await assertCanAssignRole(sql, context, target.role_id);
  logger.info({ actorId: context.user.id, targetUserId: target.user_id }, "Member password reset");

  const temporaryPassword = generateTemporaryPassword();
  await setAuthUserPassword(target.user_id, temporaryPassword);
  await sql`UPDATE public.app_users SET must_change_password = true WHERE id = ${target.user_id}`;
  await revokeUserSessions(target.user_id);
  await invalidateAccessContexts();
  return { temporaryPassword };
};

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
    throw new AppError("CURRENT_PASSWORD_INVALID", "The current password is incorrect.", 400);
  }
  // Denylist the other sessions first: changing the password makes GoTrue drop them before we could list them.
  await revokeUserSessions(context.user.id, sessionId);
  await setAuthUserPassword(context.user.id, input.newPassword);
  await getSql()`UPDATE public.app_users SET must_change_password = false WHERE id = ${context.user.id}`;
  await invalidateAccessContexts();
  return { ok: true as const };
};
