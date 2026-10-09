import { env } from "../../config/env.js";
import { WorkspaceContextSchema, type WorkspaceContext } from "../../contracts/schemas.js";
import { AppError } from "../../lib/app-error.js";
import { logger } from "../../lib/logger.js";
import { getOptionalRedis } from "../../lib/redis.js";
import { getWorkspaceContext } from "../workspace/workspace.service.js";

export type AccessContext = WorkspaceContext;

const versionKey = "authz:ver";
const contextKey = (version: string, userId: string) => `authz:ctx:${version}:${userId}`;

/**
 * Resolves the caller's organization, role, and permissions from PostgreSQL, cached in Redis
 * for a short TTL. Any authorization change bumps a global version so stale entries are never read.
 */
export const resolveAccessContext = async (userId: string): Promise<AccessContext> => {
  const redis = getOptionalRedis();
  const ttl = env.ACCESS_CONTEXT_CACHE_TTL_SECONDS;
  if (!redis || ttl === 0) {
    return await getWorkspaceContext(userId);
  }

  let key: string | undefined;
  try {
    const version = (await redis.get(versionKey)) ?? "0";
    key = contextKey(version, userId);
    const cached = await redis.get(key);
    if (cached) {
      const parsed = WorkspaceContextSchema.safeParse(JSON.parse(cached));
      if (parsed.success) {
        return parsed.data;
      }
    }
  } catch (error) {
    logger.warn({ err: error }, "Access context cache read failed; falling back to database");
  }

  const context = await getWorkspaceContext(userId);

  if (key) {
    redis.set(key, JSON.stringify(context), "EX", ttl).catch((error: unknown) => {
      logger.warn({ err: error }, "Access context cache write failed");
    });
  }

  return context;
};

/**
 * Accounts created with a temporary password (PD-005) may only read their context and change
 * the password until they do; every business endpoint calls this.
 */
export const assertPasswordCurrent = (context: AccessContext) => {
  if (context.mustChangePassword) {
    throw new AppError("PASSWORD_CHANGE_REQUIRED", "Please change your temporary password to continue.", 403);
  }
  return context;
};

/** Call after any change to roles, role permissions, or organization memberships. */
export const invalidateAccessContexts = async () => {
  const redis = getOptionalRedis();
  if (!redis) {
    return;
  }

  try {
    await redis.incr(versionKey);
  } catch (error) {
    logger.error({ err: error }, "Access context cache invalidation failed");
  }
};
