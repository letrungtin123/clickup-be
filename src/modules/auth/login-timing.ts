import { randomInt } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

/** Failed sign-ins never answer faster than this (plus jitter): longer than GoTrue's bcrypt check. */
export const failedLoginMinMs = 300;
export const failedLoginJitterMs = 50;

export type FailurePaddingOptions = {
  minMs?: number;
  jitterMs?: number;
  /** Monotonic clock in milliseconds. */
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
  /** Random integer in [0, maxExclusive). */
  random?: (maxExclusive: number) => number;
};

/**
 * Runs a sign-in attempt; when it fails (throws or rejects), the error is held back until at least
 * `minMs` + random jitter has passed since the attempt started, so wrong passwords for existing and
 * unknown accounts take the same time (SEC2-07: GoTrue only runs bcrypt for real users). Successful
 * attempts return immediately.
 */
export const withFailurePadding = async <Result>(
  attempt: () => Promise<Result>,
  options: FailurePaddingOptions = {}
): Promise<Result> => {
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? ((ms: number) => delay(ms));
  const random = options.random ?? ((maxExclusive: number) => randomInt(maxExclusive));
  const minMs = options.minMs ?? failedLoginMinMs;
  const jitterMs = options.jitterMs ?? failedLoginJitterMs;

  const startedAt = now();
  try {
    return await attempt();
  } catch (error) {
    const remaining = minMs + random(jitterMs + 1) - (now() - startedAt);
    if (remaining > 0) {
      await sleep(remaining);
    }
    throw error;
  }
};
