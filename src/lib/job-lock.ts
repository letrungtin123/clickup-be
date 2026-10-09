import { randomUUID } from "node:crypto";

import { getSql } from "../db/client.js";
import { logger } from "./logger.js";
import { getOptionalRedis } from "./redis.js";

/**
 * Single-instance guard for long-running background scans without holding a database transaction
 * open for the whole run (long "idle in transaction" sessions pin a pool connection and block vacuum).
 * Uses a Redis lease (SET NX PX, compare-and-delete release); without Redis it falls back to a
 * transaction-scoped advisory lock around the work.
 */
const releaseScript = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export const withJobLock = async <T>(name: string, leaseMs: number, work: () => Promise<T>): Promise<T | null> => {
  const redis = getOptionalRedis();
  if (!redis) {
    let result: T | null = null;
    await getSql().begin(async (tx) => {
      const locked = await tx<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${name}, 0)) AS locked`;
      if (locked[0]?.locked) {
        result = await work();
      }
    });
    return result;
  }
  const key = `job-lock:${name}`;
  const token = randomUUID();
  const acquired = await redis.set(key, token, "PX", leaseMs, "NX");
  if (acquired !== "OK") {
    return null;
  }
  try {
    return await work();
  } finally {
    await redis.eval(releaseScript, 1, key, token).catch((error: unknown) => logger.warn({ err: error, name }, "Job lock release failed"));
  }
};
