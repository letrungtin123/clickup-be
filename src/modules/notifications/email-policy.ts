import type { Redis } from "ioredis";

import { notificationTypes, type NotificationType } from "../../contracts/notifications.js";

/**
 * Which inbox entries may also go out by e-mail (SPEC §6.1 / PLAN §8, PD-013): the work events of the
 * production module and the task workspace. Chat never e-mails (SPEC: "CHAT_MESSAGE … không email") — that
 * covers chat @mentions, thread replies and being added to a channel — and system alerts stay in the app (an
 * SMTP problem must not feed its own alert loop). Web delivery is unaffected: every type is always in the inbox.
 */
const knowledgeAlwaysEmailed = new Set<string>(["knowledge.mentioned"]);

const neverEmailed = (type: string) =>
  type.startsWith("chat.") ||
  type.startsWith("channel.") ||
  type.startsWith("system.") ||
  // Knowledge base (PD-031): only @mentions always; new versions of critical items by payload (below).
  (type.startsWith("knowledge.") && !knowledgeAlwaysEmailed.has(type));

export const emailableNotificationTypes: readonly NotificationType[] = notificationTypes.filter((type) => !neverEmailed(type));

export const isEmailableNotificationType = (type: string) => (emailableNotificationTypes as readonly string[]).includes(type);

/**
 * E-mailed only with this payload (PD-031): knowledge.updated for a new version of an active "Rất quan trọng" item
 * (payload.criticalVersion = true). Every other knowledge.updated (and status / comment / approval notice) stays in
 * the inbox and the bell.
 */
export const conditionalEmailType = "knowledge.updated";
export const conditionalEmailPayload = { criticalVersion: true } as const;

/** Whether one notification row may be e-mailed: its type, or the critical-version payload of knowledge.updated. */
export const isEmailableNotification = (row: { type: string; payload?: Record<string, unknown> | null }) =>
  isEmailableNotificationType(row.type) || (row.type === conditionalEmailType && row.payload?.criticalVersion === true);

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
