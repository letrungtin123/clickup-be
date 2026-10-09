import { Redis } from "ioredis";

import { env } from "../config/env.js";
import { logger } from "./logger.js";

let client: Redis | undefined;
let subscriber: Redis | undefined;

const createClient = (role: string) => {
  if (!env.REDIS_URL) {
    throw new Error("REDIS_URL is not configured");
  }

  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
    enableAutoPipelining: true,
    connectionName: `nesso-api-${role}`
  });

  redis.on("error", (error: Error) => {
    logger.warn({ err: error, role }, "Redis connection error");
  });

  return redis;
};

export const hasRedisConfig = () => Boolean(env.REDIS_URL);

/** Shared command connection. Throws when Redis is not configured. */
export const getRedis = () => {
  client ??= createClient("main");
  return client;
};

/** Returns the shared connection, or undefined when Redis is not configured (dev fallback). */
export const getOptionalRedis = () => (hasRedisConfig() ? getRedis() : undefined);

/** Dedicated connection for pub/sub (Socket.IO adapter needs one that never runs normal commands). */
export const getRedisSubscriber = () => {
  subscriber ??= createClient("sub");
  return subscriber;
};

export const checkRedis = async () => {
  if (!hasRedisConfig()) {
    return { ok: false, reason: "REDIS_URL is not configured" };
  }

  try {
    const pong = await getRedis().ping();
    return { ok: pong === "PONG", reason: null };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "unknown" };
  }
};

export const closeRedis = async () => {
  await Promise.allSettled([client?.quit(), subscriber?.quit()]);
  client = undefined;
  subscriber = undefined;
};
