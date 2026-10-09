import type { Redis } from "ioredis";

/**
 * Digest policy (PD-013, SPEC §6): at most one notification e-mail per user per window. The window
 * is a key with a TTL claimed atomically (SET NX EX) right before a digest is sent; while it lives,
 * further notifications wait for the next digest.
 */

export type WindowStore = {
  /** Claims `key` for `ttlSeconds` if nobody holds it; true when this caller got it. */
  claim(key: string, ttlSeconds: number): Promise<boolean>;
  /** Gives the window back (the digest was not sent, e.g. transient SMTP failure). */
  release(key: string): Promise<void>;
};

export const digestWindowKey = (userId: string) => `email:digest:${userId}`;

export const createRedisWindowStore = (redis: Redis): WindowStore => ({
  claim: async (key, ttlSeconds) => (await redis.set(key, "1", "EX", ttlSeconds, "NX")) === "OK",
  release: async (key) => {
    await redis.del(key);
  }
});

/** Single-process fallback when REDIS_URL is not configured (development). */
export const createMemoryWindowStore = (now: () => number = Date.now): WindowStore => {
  const expiresAt = new Map<string, number>();
  return {
    claim: (key, ttlSeconds) => {
      const current = now();
      for (const [entry, until] of expiresAt) {
        if (until <= current) {
          expiresAt.delete(entry);
        }
      }
      if (expiresAt.has(key)) {
        return Promise.resolve(false);
      }
      expiresAt.set(key, current + ttlSeconds * 1000);
      return Promise.resolve(true);
    },
    release: (key) => {
      expiresAt.delete(key);
      return Promise.resolve();
    }
  };
};

export type DigestRecipient = {
  email: string | null;
  notify_email: boolean;
  deleted_at: Date | null;
};

export type DigestSkipReason = "not_found" | "inactive" | "opted_out" | "no_address";

/** Why a recipient gets no e-mail right now (null = deliverable). Org membership is filtered per notification. */
export const recipientSkipReason = (recipient: DigestRecipient | null | undefined): DigestSkipReason | null => {
  if (!recipient) {
    return "not_found";
  }
  if (recipient.deleted_at) {
    return "inactive";
  }
  if (!recipient.notify_email) {
    return "opted_out";
  }
  if (!recipient.email?.trim()) {
    return "no_address";
  }
  return null;
};
