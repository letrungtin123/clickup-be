import { logger } from "../../lib/logger.js";
import { getOptionalRedis } from "../../lib/redis.js";

/**
 * Per-organization cache of production configuration read on almost every request — the workflow model
 * (statuses + transitions) and the settings (PERF-14).
 *
 * - Entries live in this process for at most `maxAgeMs` (a safety net for direct SQL changes such as
 *   migrations).
 * - Catalog / settings writes call `invalidateProductionConfig(org)` AFTER their transaction committed: the
 *   local entries are dropped and a Redis version key is bumped. Every read compares its entry with that
 *   version (one Redis GET, far cheaper than the two or three queries it saves), so other processes (API
 *   instances, the worker) reload on their next read instead of serving stale workflow rules or close days.
 * - Without Redis (or when Redis fails) the cache falls back to `fallbackAgeMs`, bounding how long another
 *   process can lag behind.
 */

const maxAgeMs = 60_000;
const fallbackAgeMs = 5_000;
const versionKey = (organizationId: string) => `production:config:ver:${organizationId}`;

type Entry = { version: string | null; loadedAt: number; value: Promise<unknown> };
const entries = new Map<string, Entry>();

const currentVersion = async (organizationId: string): Promise<string | null | undefined> => {
  const redis = getOptionalRedis();
  if (!redis) {
    return undefined;
  }
  try {
    return (await redis.get(versionKey(organizationId))) ?? "0";
  } catch (error) {
    logger.warn({ err: error }, "Production config cache: version read failed");
    return undefined;
  }
};

/**
 * Cached value of `kind` for an organization; `load` reads it from the database on a miss. Concurrent misses
 * share one load. A failed load is not cached.
 */
export const cachedConfig = async <T>(kind: string, organizationId: string, load: () => Promise<T>): Promise<T> => {
  const key = `${kind}:${organizationId}`;
  const version = await currentVersion(organizationId);
  const now = Date.now();
  const entry = entries.get(key);
  const fresh =
    entry !== undefined &&
    (version === undefined ? now - entry.loadedAt < fallbackAgeMs : entry.version === version && now - entry.loadedAt < maxAgeMs);
  if (fresh) {
    return (await entry.value) as T;
  }
  const value = load();
  const created: Entry = { version: version ?? null, loadedAt: now, value };
  entries.set(key, created);
  try {
    return await value;
  } catch (error) {
    if (entries.get(key) === created) {
      entries.delete(key);
    }
    throw error;
  }
};

/** Call after a committed change to statuses, transitions or settings of the organization. */
export const invalidateProductionConfig = async (organizationId: string) => {
  for (const key of [...entries.keys()]) {
    if (key.endsWith(`:${organizationId}`)) {
      entries.delete(key);
    }
  }
  const redis = getOptionalRedis();
  if (!redis) {
    return;
  }
  try {
    await redis.incr(versionKey(organizationId));
  } catch (error) {
    logger.error({ err: error }, "Production config cache: invalidation failed");
  }
};

/** Tests only. */
export const clearProductionConfigCache = () => entries.clear();
