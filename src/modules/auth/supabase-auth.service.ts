import { z } from "zod";

import { env } from "../../config/env.js";
import type { AuthUser } from "../../contracts/schemas.js";
import { permissionValues } from "../../contracts/permissions.js";
import type { PermissionKey } from "../../contracts/permissions.js";
import { AppError } from "../../lib/app-error.js";

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

  return parse(await response.json());
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

export const verifyAccessToken = async (accessToken: string): Promise<AuthUser> => {
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

  return toAuthUser(user);
};

export const revokeAuthSession = async (accessToken: string | null) => {
  if (!accessToken) {
    return;
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
