import { describe, expect, it, vi } from "vitest";

import { failedLoginJitterMs, failedLoginMinMs, withFailurePadding } from "./login-timing.js";

/** Manual clock: `advance` simulates the attempt taking time; `sleep` records the padding asked for. */
const fakeClock = (start = 1_000) => {
  let current = start;
  const sleeps: number[] = [];
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
    sleep: vi.fn((ms: number) => {
      sleeps.push(ms);
      current += ms;
      return Promise.resolve();
    }),
    sleeps
  };
};

describe("withFailurePadding (SEC2-07)", () => {
  it("defaults to a 300 ms floor with up to 50 ms jitter", () => {
    expect(failedLoginMinMs).toBe(300);
    expect(failedLoginJitterMs).toBe(50);
  });

  it("returns a success immediately, without padding", async () => {
    const clock = fakeClock();
    const result = await withFailurePadding(
      () => {
        clock.advance(20);
        return Promise.resolve("session");
      },
      { now: clock.now, sleep: clock.sleep, random: () => 0 }
    );

    expect(result).toBe("session");
    expect(clock.sleep).not.toHaveBeenCalled();
  });

  it("pads a fast failure up to the floor plus jitter, then rethrows the same error", async () => {
    const clock = fakeClock();
    const random = vi.fn(() => 17);
    const failure = new Error("AUTH_INVALID");

    await expect(
      withFailurePadding(
        () => {
          clock.advance(40); // unknown email: GoTrue answers without running bcrypt
          return Promise.reject(failure);
        },
        { now: clock.now, sleep: clock.sleep, random }
      )
    ).rejects.toBe(failure);

    expect(random).toHaveBeenCalledWith(failedLoginJitterMs + 1); // jitter in [0, 50]
    expect(clock.sleeps).toEqual([failedLoginMinMs + 17 - 40]);
  });

  it("makes unknown and existing accounts fail after the same total time", async () => {
    const totals: number[] = [];
    for (const checkMs of [37, 234]) {
      const clock = fakeClock();
      const start = clock.now();
      await withFailurePadding(
        () => {
          clock.advance(checkMs);
          return Promise.reject(new Error("AUTH_INVALID"));
        },
        { now: clock.now, sleep: clock.sleep, random: () => 0 }
      ).catch(() => undefined);
      totals.push(clock.now() - start);
    }

    expect(totals).toEqual([failedLoginMinMs, failedLoginMinMs]);
  });

  it("pads errors thrown synchronously before any await (e.g. invalid input)", async () => {
    const clock = fakeClock();
    const failure = new Error("VALIDATION_FAILED");

    await expect(
      withFailurePadding(
        () => {
          throw failure;
        },
        { now: clock.now, sleep: clock.sleep, random: () => 0 }
      )
    ).rejects.toBe(failure);

    expect(clock.sleeps).toEqual([failedLoginMinMs]);
  });

  it("does not add time to a failure that already took longer than the floor", async () => {
    const clock = fakeClock();

    await expect(
      withFailurePadding(
        () => {
          clock.advance(failedLoginMinMs + failedLoginJitterMs + 1);
          return Promise.reject(new Error("AUTH_PROVIDER_ERROR"));
        },
        { now: clock.now, sleep: clock.sleep, random: () => failedLoginJitterMs }
      )
    ).rejects.toThrow("AUTH_PROVIDER_ERROR");

    expect(clock.sleep).not.toHaveBeenCalled();
  });

  it("really waits with the default clock and timer", async () => {
    const startedAt = performance.now();
    await expect(
      withFailurePadding(() => Promise.reject(new Error("nope")), { minMs: 40, jitterMs: 0 })
    ).rejects.toThrow("nope");

    // Timers may fire a hair early on some platforms; allow 2 ms.
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(38);
  });
});
