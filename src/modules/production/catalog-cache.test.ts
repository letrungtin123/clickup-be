import { afterEach, describe, expect, it, vi } from "vitest";

// A fake Redis shared by "processes": the version key is what tells other processes to reload.
const fake = vi.hoisted(() => {
  const store = new Map<string, number>();
  return {
    enabled: false,
    store,
    client: {
      get: (key: string) => Promise.resolve(store.has(key) ? String(store.get(key)) : null),
      incr: (key: string) => {
        store.set(key, (store.get(key) ?? 0) + 1);
        return Promise.resolve(store.get(key)!);
      }
    }
  };
});
vi.mock("../../lib/redis.js", () => ({ getOptionalRedis: () => (fake.enabled ? fake.client : undefined) }));

const { cachedConfig, clearProductionConfigCache, invalidateProductionConfig } = await import("./catalog-cache.js");

const org = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

describe("production config cache (PERF-14)", () => {
  afterEach(() => {
    clearProductionConfigCache();
    fake.enabled = false;
    fake.store.clear();
  });

  it("loads once per organization and kind until invalidated", async () => {
    let loads = 0;
    const load = () => Promise.resolve(++loads);
    expect(await cachedConfig("workflow", org, load)).toBe(1);
    expect(await cachedConfig("workflow", org, load)).toBe(1);
    expect(await cachedConfig("settings", org, load)).toBe(2);
    expect(await cachedConfig("workflow", other, load)).toBe(3);
    await invalidateProductionConfig(org);
    expect(await cachedConfig("workflow", org, load)).toBe(4);
    expect(await cachedConfig("settings", org, load)).toBe(5);
    // Other organizations keep their entries.
    expect(await cachedConfig("workflow", other, load)).toBe(3);
  });

  it("with Redis, a write in another process (version bump) makes this one reload", async () => {
    fake.enabled = true;
    let loads = 0;
    const load = () => Promise.resolve(++loads);
    expect(await cachedConfig("workflow", org, load)).toBe(1);
    expect(await cachedConfig("workflow", org, load)).toBe(1);
    // Another process committed a catalog change: only the shared version moves.
    await fake.client.incr(`production:config:ver:${org}`);
    expect(await cachedConfig("workflow", org, load)).toBe(2);
    expect(await cachedConfig("workflow", org, load)).toBe(2);
  });

  it("shares one in-flight load and never caches a failure", async () => {
    let loads = 0;
    const slow = () => new Promise<number>((resolve) => setTimeout(() => resolve(++loads), 5));
    const [a, b] = await Promise.all([cachedConfig("workflow", org, slow), cachedConfig("workflow", org, slow)]);
    expect([a, b, loads]).toEqual([1, 1, 1]);
    await expect(cachedConfig("settings", org, () => Promise.reject(new Error("db down")))).rejects.toThrow("db down");
    expect(await cachedConfig("settings", org, () => Promise.resolve("ok"))).toBe("ok");
  });
});
