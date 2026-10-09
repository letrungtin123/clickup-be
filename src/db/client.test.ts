import { afterEach, describe, expect, it } from "vitest";

import { configureDatabase, databaseSettings } from "./client.js";

const keys = ["DB_POOL_MAX", "DB_STATEMENT_TIMEOUT_MS", "DB_IDLE_TX_TIMEOUT_MS"] as const;
const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
});

describe("database pool settings (PERF-06 / PERF-12)", () => {
  it("defaults to a 14-connection API pool with 15 s statements and 30 s idle transactions", () => {
    for (const key of keys) {
      delete process.env[key];
    }
    expect(databaseSettings()).toEqual({ max: 14, statementTimeoutMs: 15_000, idleInTransactionTimeoutMs: 30_000 });
  });

  it("takes per-process overrides from the environment", () => {
    process.env.DB_POOL_MAX = "12";
    process.env.DB_STATEMENT_TIMEOUT_MS = "0";
    process.env.DB_IDLE_TX_TIMEOUT_MS = "45000";
    expect(databaseSettings()).toEqual({ max: 12, statementTimeoutMs: 0, idleInTransactionTimeoutMs: 45_000 });
  });

  it("ignores invalid overrides instead of failing to start", () => {
    process.env.DB_POOL_MAX = "lots";
    expect(databaseSettings().max).toBe(14);
  });

  it("gives the worker a small pool and longer statements", () => {
    for (const key of keys) {
      delete process.env[key];
    }
    configureDatabase({ role: "worker" });
    expect(databaseSettings()).toEqual({ max: 5, statementTimeoutMs: 60_000, idleInTransactionTimeoutMs: 30_000 });
  });
});
