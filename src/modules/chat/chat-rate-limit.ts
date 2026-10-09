import { AppError } from "../../lib/app-error.js";
import { logger } from "../../lib/logger.js";
import { getOptionalRedis } from "../../lib/redis.js";

/**
 * Per-user chat quotas (fixed windows) shared across API instances through Redis, with an in-memory
 * fallback for single-instance development. Applied in addition to the global per-IP limiter.
 */
export const chatQuotas = {
  send: { limit: 20, windowSeconds: 10 },
  react: { limit: 60, windowSeconds: 10 },
  upload: { limit: 30, windowSeconds: 60 }
} as const;

export type ChatQuota = keyof typeof chatQuotas;

const memory = new Map<string, { count: number; expiresAt: number }>();

const incrementInMemory = (key: string, windowSeconds: number) => {
  const now = Date.now();
  if (memory.size > 10_000) {
    for (const [entryKey, entry] of memory) {
      if (entry.expiresAt <= now) {
        memory.delete(entryKey);
      }
    }
  }
  const entry = memory.get(key);
  if (!entry || entry.expiresAt <= now) {
    memory.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 });
    return 1;
  }
  entry.count += 1;
  return entry.count;
};

export const consumeChatQuota = async (quota: ChatQuota, userId: string) => {
  const rule = chatQuotas[quota];
  const window = Math.floor(Date.now() / (rule.windowSeconds * 1000));
  const key = `chat:rl:${quota}:${userId}:${window}`;

  let count: number;
  const redis = getOptionalRedis();
  if (redis) {
    try {
      const result = await redis.multi().incr(key).expire(key, rule.windowSeconds + 1).exec();
      count = Number(result?.[0]?.[1] ?? 0);
    } catch (error) {
      logger.warn({ err: error }, "Chat rate limit check failed; using in-memory fallback");
      count = incrementInMemory(key, rule.windowSeconds);
    }
  } else {
    count = incrementInMemory(key, rule.windowSeconds);
  }

  if (count > rule.limit) {
    throw new AppError("CHAT_RATE_LIMITED", "You are sending too fast. Please wait a moment.", 429);
  }
};
