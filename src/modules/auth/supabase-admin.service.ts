import { randomInt } from "node:crypto";

import { z } from "zod";

import { env } from "../../config/env.js";
import { AppError } from "../../lib/app-error.js";
import { logger } from "../../lib/logger.js";

/** GoTrue admin API (service role). Server side only. */
const adminFetch = async (path: string, init: RequestInit) => {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new AppError("AUTH_NOT_CONFIGURED", "Account administration is not configured.", 503);
  }
  const response = await fetch(new URL(`/auth/v1/admin${path}`, env.SUPABASE_URL), {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      ...init.headers
    }
  });
  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : null;
  return { status: response.status, body };
};

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** 16 characters from an unambiguous alphabet, guaranteed to contain letters and digits. */
export const generateTemporaryPassword = () => {
  for (;;) {
    let value = "";
    for (let index = 0; index < 16; index += 1) {
      value += alphabet[randomInt(alphabet.length)];
    }
    if (/[A-Za-z]/.test(value) && /[0-9]/.test(value)) {
      return value;
    }
  }
};

export const createAuthUser = async (input: { email: string; password: string; displayName: string }) => {
  const result = await adminFetch("/users", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { display_name: input.displayName }
    })
  });
  if (result.status === 422 || result.status === 409) {
    throw new AppError("ACCOUNT_EXISTS", "An account with this email already exists.", 409);
  }
  if (result.status >= 300) {
    logger.warn({ status: result.status }, "GoTrue admin create user failed");
    throw new AppError("AUTH_PROVIDER_ERROR", "Account could not be created.", 502);
  }
  const id = typeof result.body === "object" && result.body !== null && "id" in result.body ? String(result.body.id) : null;
  if (!id) {
    throw new AppError("AUTH_PROVIDER_ERROR", "Account could not be created.", 502);
  }
  return id;
};

export const setAuthUserPassword = async (userId: string, password: string) => {
  const result = await adminFetch(`/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    body: JSON.stringify({ password })
  });
  if (result.status >= 300) {
    logger.warn({ status: result.status }, "GoTrue admin password update failed");
    throw new AppError("AUTH_PROVIDER_ERROR", "Password could not be updated.", 502);
  }
};

export const setAuthUserBanned = async (userId: string, banned: boolean) => {
  const result = await adminFetch(`/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    body: JSON.stringify({ ban_duration: banned ? "876000h" : "none" })
  });
  if (result.status >= 300) {
    logger.warn({ status: result.status }, "GoTrue admin ban update failed");
    throw new AppError("AUTH_PROVIDER_ERROR", "Account status could not be updated.", 502);
  }
};

const AdminAuthUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().nullable().optional(),
  email_confirmed_at: z.string().nullable().optional(),
  banned_until: z.string().nullable().optional(),
  user_metadata: z.record(z.string(), z.unknown()).optional(),
  identities: z
    .array(
      z.object({
        provider: z.string(),
        identity_data: z.record(z.string(), z.unknown()).optional()
      })
    )
    .nullable()
    .optional()
});
export type AdminAuthUser = z.infer<typeof AdminAuthUserSchema>;

/** Authoritative GoTrue view of a user (identities, ban). Null when the user does not exist. */
export const getAuthUser = async (userId: string): Promise<AdminAuthUser | null> => {
  const result = await adminFetch(`/users/${encodeURIComponent(userId)}`, { method: "GET" });
  if (result.status === 404) {
    return null;
  }
  if (result.status >= 300) {
    logger.warn({ status: result.status }, "GoTrue admin get user failed");
    throw new AppError("AUTH_PROVIDER_ERROR", "Account could not be loaded.", 502);
  }
  return AdminAuthUserSchema.parse(result.body);
};

export const isBannedUntil = (bannedUntil: string | null | undefined, now = Date.now()) => {
  if (!bannedUntil) {
    return false;
  }
  const until = Date.parse(bannedUntil);
  return Number.isNaN(until) || until > now;
};
