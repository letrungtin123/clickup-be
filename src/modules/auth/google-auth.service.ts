import { randomBytes } from "node:crypto";

import { z } from "zod";

import { env } from "../../config/env.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { logger } from "../../lib/logger.js";
import { invalidateAccessContexts } from "../access/access-context.js";
import { insertOrganizationMemberRecords } from "../workspace/members.service.js";
import {
  decideGoogleAccess,
  googleDisplayName,
  isHostedDomainAllowed,
  normalizeEmail,
  parseHostedDomains,
  verifiedGoogleEmail,
  whitelistedOrganizationIds,
  type GoogleAccessDecision,
  type GoogleLoginError
} from "./google-oauth.js";
import { createAuthUser, getAuthUser, isBannedUntil } from "./supabase-admin.service.js";
import { exchangePkceCode, revokeAuthSession, verifyAccessToken, type AuthSessionResult } from "./supabase-auth.service.js";

/** Organization role every Google-provisioned member gets (never anything elevated). */
const defaultMemberRoleKey = "member";
/** SPEC §2: first Google sign-in gets the lowest production role. */
const defaultProductionRole = "STAFF";

const hostedDomains = parseHostedDomains(env.GOOGLE_AUTH_HOSTED_DOMAINS);

// Provider availability ---------------------------------------------------------------------------

const GoTrueSettingsSchema = z.object({
  external: z.object({ google: z.boolean().optional() }).partial().optional()
});

let providerCache: { value: boolean; expiresAt: number } | null = null;

/** Asks GoTrue whether its Google provider is configured (cached: 60 s when on, 15 s when off/unknown). */
const isGoTrueGoogleEnabled = async () => {
  const now = Date.now();
  if (providerCache && providerCache.expiresAt > now) {
    return providerCache.value;
  }
  let value = false;
  try {
    const response = await fetch(new URL("/auth/v1/settings", env.SUPABASE_URL), {
      headers: { apikey: env.SUPABASE_ANON_KEY ?? "", accept: "application/json" },
      signal: AbortSignal.timeout(3000)
    });
    if (response.ok) {
      value = GoTrueSettingsSchema.parse(await response.json()).external?.google === true;
    } else {
      logger.warn({ status: response.status }, "GoTrue settings probe failed");
    }
  } catch (error) {
    logger.warn({ err: error }, "GoTrue settings probe failed");
  }
  providerCache = { value, expiresAt: now + (value ? 60_000 : 15_000) };
  return value;
};

/** Whether the login page offers Google: our flag AND GoTrue's provider must both be on. */
export const isGoogleSignInAvailable = async () => env.GOOGLE_AUTH_ENABLED && (await isGoTrueGoogleEnabled());

// Account resolution -------------------------------------------------------------------------------

const resolveAccess = async (userId: string, email: string): Promise<GoogleAccessDecision> => {
  const sql = getSql();
  const [whitelist, appUsers, otherProfiles, memberships] = await Promise.all([
    sql<{ organization_id: string; email: string }[]>`
      SELECT ae.organization_id, ae.email
      FROM public.allowed_emails ae
      JOIN public.organizations o ON o.id = ae.organization_id AND o.deleted_at IS NULL AND o.archived_at IS NULL
      WHERE ae.email = ${email}
      ORDER BY ae.created_at ASC, ae.organization_id ASC
    `,
    sql<{ deleted: boolean }[]>`SELECT deleted_at IS NOT NULL AS deleted FROM public.app_users WHERE id = ${userId}`,
    sql<{ id: string }[]>`
      SELECT id FROM public.app_users WHERE email_normalized = ${email} AND deleted_at IS NULL AND id <> ${userId} LIMIT 1
    `,
    sql<{ organization_id: string; status: string }[]>`
      SELECT organization_id, status FROM public.organization_memberships WHERE user_id = ${userId} AND deleted_at IS NULL
    `
  ]);
  return decideGoogleAccess({
    whitelistedOrganizationIds: whitelistedOrganizationIds(
      email,
      whitelist.map((row) => ({ organizationId: row.organization_id, email: row.email }))
    ),
    appUser: appUsers[0] ?? null,
    memberships: memberships.map((row) => ({ organizationId: row.organization_id, status: row.status })),
    emailUsedByAnotherProfile: otherProfiles.length > 0
  });
};

/** Creates the profile (if missing) + active membership with the default role; false when the org has no such role. */
const provisionMember = async (input: { userId: string; email: string; displayName: string; organizationId: string }) => {
  const sql = getSql();
  const role = (
    await sql<{ id: string }[]>`
      SELECT id FROM public.roles
      WHERE organization_id = ${input.organizationId} AND key = ${defaultMemberRoleKey} AND deleted_at IS NULL
      LIMIT 1
    `
  )[0];
  if (!role) {
    logger.warn({ organizationId: input.organizationId }, "Google sign-in: organization has no default member role");
    return false;
  }
  await sql.begin(async (tx) => {
    await insertOrganizationMemberRecords(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      email: input.email,
      displayName: input.displayName,
      jobTitle: null,
      roleId: role.id,
      mustChangePassword: false,
      profile: "keep",
      invitedBy: null,
      actorUserId: input.userId
    });
    await tx`
      INSERT INTO production.user_roles (organization_id, user_id, role_code)
      VALUES (${input.organizationId}, ${input.userId}, ${defaultProductionRole})
      ON CONFLICT DO NOTHING
    `;
  });
  await invalidateAccessContexts();
  return true;
};

const isUniqueViolation = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "23505";

/** Applies the decision; a concurrent callback that provisioned first is re-read once and then signs in. */
const admitAccount = async (input: { userId: string; email: string; displayName: string }) => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const decision = await resolveAccess(input.userId, input.email);
    if (decision.kind !== "provision") {
      return decision;
    }
    try {
      const provisioned = await provisionMember({ ...input, organizationId: decision.organizationId });
      if (!provisioned) {
        return { kind: "reject", reason: "google_not_provisioned" } as const;
      }
      logger.info({ userId: input.userId, organizationId: decision.organizationId }, "Google sign-in provisioned a member");
      return decision;
    } catch (error) {
      if (!isUniqueViolation(error) || attempt > 0) {
        throw error;
      }
    }
  }
  return { kind: "reject", reason: "google_failed" } as const;
};

export type GoogleSignInResult =
  | { ok: true; tokens: AuthSessionResult["tokens"] }
  | { ok: false; reason: GoogleLoginError };

/**
 * Callback core: exchange the code (PKCE), verify the token, then enforce verified e-mail, hosted
 * domain, ban, whitelist and membership rules. Any rejection revokes the fresh GoTrue session.
 */
export const completeGoogleSignIn = async (input: { authCode: string; codeVerifier: string }): Promise<GoogleSignInResult> => {
  let session: AuthSessionResult;
  try {
    session = await exchangePkceCode(input);
  } catch (error) {
    logger.warn({ code: error instanceof AppError ? error.code : "unknown" }, "Google sign-in: code exchange failed");
    return { ok: false, reason: "google_failed" };
  }

  const reject = async (reason: GoogleLoginError): Promise<GoogleSignInResult> => {
    try {
      await revokeAuthSession(session.tokens.accessToken, { scope: "local" });
    } catch (error) {
      logger.error({ err: error, userId: session.user.id }, "Google sign-in: revoking a rejected session failed");
    }
    logger.info({ userId: session.user.id, reason }, "Google sign-in rejected");
    return { ok: false, reason };
  };

  try {
    const verified = await verifyAccessToken(session.tokens.accessToken);
    if (verified.id !== session.user.id) {
      return await reject("google_failed");
    }
    const user = await getAuthUser(verified.id);
    if (!user) {
      return await reject("google_failed");
    }
    if (isBannedUntil(user.banned_until)) {
      return await reject("google_account_disabled");
    }
    const google = verifiedGoogleEmail(user);
    if (!google) {
      return await reject("google_email_unverified");
    }
    if (!isHostedDomainAllowed(google.hostedDomain, hostedDomains)) {
      return await reject("google_not_allowed");
    }
    const decision = await admitAccount({
      userId: user.id,
      email: google.email,
      displayName: googleDisplayName(user.user_metadata, google.email)
    });
    if (decision.kind === "reject") {
      return await reject(decision.reason);
    }
    logger.info({ userId: user.id, organizationId: decision.organizationId }, "Google sign-in succeeded");
    return { ok: true, tokens: session.tokens };
  } catch (error) {
    logger.error({ err: error }, "Google sign-in failed");
    return await reject("google_failed");
  }
};

// GoTrue user provisioning -----------------------------------------------------------------------

/**
 * GoTrue runs with DISABLE_SIGNUP=true, which also refuses brand-new OAuth users. A whitelisted
 * address therefore gets a GoTrue user up front (confirmed e-mail, random password nobody knows);
 * GoTrue then links the Google identity to it by verified e-mail on first sign-in. Idempotent.
 */
export const provisionGoogleAuthUsers = async (emails: readonly string[]) => {
  const wanted = [...new Set(emails.map((email) => normalizeEmail(email)).filter((email): email is string => email !== null))];
  const summary = { created: 0, existing: 0, failed: 0 };
  if (wanted.length === 0) {
    return summary;
  }
  const present = new Set(
    (
      await getSql()<{ email: string }[]>`
        SELECT lower(email) AS email FROM auth.users WHERE lower(email) = ANY(${wanted}::text[])
      `
    ).map((row) => row.email)
  );
  summary.existing = present.size;
  const missing = wanted.filter((email) => !present.has(email));
  for (let index = 0; index < missing.length; index += 4) {
    const batch = missing.slice(index, index + 4);
    const results = await Promise.allSettled(
      batch.map((email) =>
        createAuthUser({
          email,
          password: randomBytes(32).toString("base64url"),
          displayName: (email.split("@")[0] ?? email).slice(0, 160)
        })
      )
    );
    for (const result of results) {
      if (result.status === "fulfilled") {
        summary.created += 1;
      } else if (result.reason instanceof AppError && result.reason.code === "ACCOUNT_EXISTS") {
        summary.existing += 1;
      } else {
        summary.failed += 1;
      }
    }
  }
  if (summary.failed > 0) {
    logger.warn(summary, "Google sign-in: some whitelisted accounts could not be provisioned in GoTrue");
  }
  return summary;
};

/** Fire-and-forget hook for whitelist additions; a no-op unless Google sign-in is enabled. */
export const scheduleGoogleAuthUserProvisioning = (emails: readonly string[]) => {
  if (!env.GOOGLE_AUTH_ENABLED || emails.length === 0) {
    return;
  }
  void provisionGoogleAuthUsers(emails).catch((error: unknown) => {
    logger.error({ err: error }, "Google sign-in: GoTrue account provisioning failed");
  });
};
