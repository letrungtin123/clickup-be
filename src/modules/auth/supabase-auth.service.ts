import { jwtVerify } from "jose";
import { z } from "zod";

import { env } from "../../config/env.js";
import type { AuthUser } from "../../contracts/schemas.js";
import { permissionValues } from "../../contracts/permissions.js";
import type { PermissionKey } from "../../contracts/permissions.js";
import { AppError } from "../../lib/app-error.js";
import { getOptionalRedis } from "../../lib/redis.js";

const MetadataSchema = z.record(z.string(), z.unknown()).default({});

const SupabaseUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().nullable().optional(),
  app_metadata: MetadataSchema.optional(),
  user_metadata: MetadataSchema.optional()
});

const SupabaseTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  user: SupabaseUserSchema
});

type SupabaseTokenResponse = z.infer<typeof SupabaseTokenResponseSchema>;
type SupabaseUser = z.infer<typeof SupabaseUserSchema>;

type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
};

export type AuthSessionResult = {
  user: AuthUser;
  tokens: AuthTokens;
};

const getSupabaseAnonKey = () => {
  if (!env.SUPABASE_ANON_KEY) {
    throw new AppError("AUTH_NOT_CONFIGURED", "Authentication is not configured.", 503);
  }

  return env.SUPABASE_ANON_KEY;
};

const authUrl = (path: string) => new URL(`/auth/v1${path}`, env.SUPABASE_URL).toString();

const supabaseJson = async <Result>(
  path: string,
  init: RequestInit,
  parse: (value: unknown) => Result
) => {
  const response = await fetch(authUrl(path), {
    ...init,
    headers: {
      apikey: getSupabaseAnonKey(),
      accept: "application/json",
      ...init.headers
    }
  });

  if (!response.ok) {
    if (response.status === 400 || response.status === 401) {
      throw new AppError("AUTH_INVALID", "Email, password, or session is invalid.", 401);
    }

    throw new AppError("AUTH_PROVIDER_ERROR", "Authentication provider is unavailable.", 503);
  }

  // GoTrue answers some endpoints (e.g. /logout) with 204 No Content.
  const text = await response.text();
  return parse(text.length > 0 ? JSON.parse(text) : null);
};

const toPermissionKeys = (value: unknown): PermissionKey[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const allowed = new Set<string>(permissionValues);
  return value.filter((permission): permission is PermissionKey => {
    return typeof permission === "string" && allowed.has(permission);
  });
};

const firstPermissionClaim = (user: SupabaseUser) => {
  const appPermissions = toPermissionKeys(user.app_metadata?.permissions);
  if (appPermissions.length > 0) {
    return appPermissions;
  }

  return toPermissionKeys(user.user_metadata?.permissions);
};

const toAuthUser = (user: SupabaseUser): AuthUser => ({
  id: user.id,
  email: user.email ?? null,
  permissions: firstPermissionClaim(user)
});

const toAuthSession = (response: SupabaseTokenResponse): AuthSessionResult => ({
  user: toAuthUser(response.user),
  tokens: {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresInSeconds: response.expires_in
  }
});

export const signInWithPassword = async (input: { email: string; password: string }) => {
  const result = await supabaseJson(
    "/token?grant_type=password",
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(input)
    },
    (value) => SupabaseTokenResponseSchema.parse(value)
  );

  return toAuthSession(result);
};

export const refreshAuthSession = async (refreshToken: string) => {
  const result = await supabaseJson(
    "/token?grant_type=refresh_token",
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ refresh_token: refreshToken })
    },
    (value) => SupabaseTokenResponseSchema.parse(value)
  );

  return toAuthSession(result);
};

export type VerifiedSession = AuthUser & {
  sessionId: string | null;
  /** Token expiry, seconds since epoch. */
  expiresAt: number;
};

const jwtSecret = env.SUPABASE_JWT_SECRET ? new TextEncoder().encode(env.SUPABASE_JWT_SECRET) : undefined;

const AccessTokenClaimsSchema = z.object({
  sub: z.string().uuid(),
  exp: z.number().int(),
  iat: z.number().int().optional(),
  role: z.literal("authenticated"),
  email: z.string().email().nullable().optional(),
  session_id: z.string().uuid().nullable().optional(),
  app_metadata: MetadataSchema.optional(),
  user_metadata: MetadataSchema.optional()
});

const revokedSessionKey = (sessionId: string) => `auth:revoked:${sessionId}`;

const validAfterKey = (userId: string) => `auth:valid-after:${userId}`;

/** A token is revoked when its session was logged out, or it was issued before a user-wide revocation. */
const isTokenRevoked = async (userId: string, sessionId: string | null, issuedAt: number | undefined) => {
  const redis = getOptionalRedis();
  if (!redis) {
    return false;
  }
  const [sessionRevoked, validAfter] = await Promise.all([
    sessionId ? redis.exists(revokedSessionKey(sessionId)) : Promise.resolve(0),
    redis.get(validAfterKey(userId))
  ]);
  if (sessionRevoked === 1) {
    return true;
  }
  return validAfter !== null && (issuedAt === undefined || issuedAt < Number(validAfter));
};

/** Rejects every access token of a user issued before now (password reset, account disabled). */
export const revokeTokensIssuedBefore = async (userId: string, nowSeconds = Math.floor(Date.now() / 1000)) => {
  const redis = getOptionalRedis();
  if (!redis) {
    return;
  }
  // Access tokens live at most JWT_EXPIRY (1h); keep the marker a little longer.
  await redis.set(validAfterKey(userId), String(nowSeconds), "EX", 2 * 3600);
};

const verifyAccessTokenRemotely = async (accessToken: string): Promise<VerifiedSession> => {
  const user = await supabaseJson(
    "/user",
    {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    },
    (value) => SupabaseUserSchema.parse(value)
  );

  return { ...toAuthUser(user), sessionId: null, expiresAt: Math.floor(Date.now() / 1000) + 60 };
};

/**
 * Verifies a Supabase access token locally (HS256, issuer, audience, expiry) and rejects
 * sessions revoked at logout. Falls back to asking GoTrue when no JWT secret is configured (dev only).
 */
export const verifyAccessToken = async (accessToken: string): Promise<VerifiedSession> => {
  if (!jwtSecret) {
    return await verifyAccessTokenRemotely(accessToken);
  }

  let claims: z.infer<typeof AccessTokenClaimsSchema>;
  try {
    const { payload } = await jwtVerify(accessToken, jwtSecret, {
      algorithms: ["HS256"],
      audience: "authenticated",
      ...(env.SUPABASE_JWT_ISSUER ? { issuer: env.SUPABASE_JWT_ISSUER } : {})
    });
    claims = AccessTokenClaimsSchema.parse(payload);
  } catch {
    throw new AppError("AUTH_INVALID", "Email, password, or session is invalid.", 401);
  }

  const sessionId = claims.session_id ?? null;
  if (await isTokenRevoked(claims.sub, sessionId, claims.iat)) {
    throw new AppError("AUTH_INVALID", "Email, password, or session is invalid.", 401);
  }

  return {
    ...toAuthUser({
      id: claims.sub,
      email: claims.email ?? null,
      app_metadata: claims.app_metadata ?? {},
      user_metadata: claims.user_metadata ?? {}
    }),
    sessionId,
    expiresAt: claims.exp
  };
};

/** Marks a session as revoked until its access token would have expired anyway. */
export const denylistSession = async (session: Pick<VerifiedSession, "sessionId" | "expiresAt">) => {
  const redis = getOptionalRedis();
  if (!redis || !session.sessionId) {
    return;
  }

  const ttlSeconds = session.expiresAt - Math.floor(Date.now() / 1000);
  if (ttlSeconds > 0) {
    await redis.set(revokedSessionKey(session.sessionId), "1", "EX", ttlSeconds);
  }
};

export const revokeAuthSession = async (accessToken: string | null) => {
  if (!accessToken) {
    return;
  }

  try {
    await denylistSession(await verifyAccessToken(accessToken));
  } catch {
    // Expired or invalid tokens need no denylist entry.
  }

  await supabaseJson(
    "/logout",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    },
    () => null
  );
};
