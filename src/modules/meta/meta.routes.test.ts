import type { Express } from "express";
import { SignJWT } from "jose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ProductMetaSchema } from "../../contracts/schemas.js";

/** GET /meta (SEC2-20): anonymous callers get name + version only; the catalog is for signed-in clients. */
vi.mock("../../lib/redis.js", () => ({
  hasRedisConfig: () => false,
  getOptionalRedis: () => undefined,
  getRedis: () => {
    throw new Error("Redis is not available in this test");
  },
  getRedisSubscriber: () => {
    throw new Error("Redis is not available in this test");
  },
  checkRedis: () => Promise.resolve({ ok: false, reason: "test" }),
  closeRedis: () => Promise.resolve()
}));

const jwtSecret = "test-jwt-secret-0123456789abcdefghijklmnop";
const jwtIssuer = "http://gotrue.invalid:9999/auth/v1";

const accessToken = (overrides: { secret?: string; expiresIn?: string } = {}) =>
  new SignJWT({ role: "authenticated", email: "member@example.test", session_id: "00000000-0000-4000-8000-0000000000b1" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("00000000-0000-4000-8000-0000000000a1")
    .setAudience("authenticated")
    .setIssuer(jwtIssuer)
    .setIssuedAt()
    .setExpirationTime(overrides.expiresIn ?? "10m")
    .sign(new TextEncoder().encode(overrides.secret ?? jwtSecret));

let app: Express;

beforeAll(async () => {
  vi.resetModules();
  const values: Record<string, string> = {
    NODE_ENV: "test",
    SUPABASE_URL: "http://gotrue.invalid:9999",
    SUPABASE_ANON_KEY: "test-anon-key",
    SUPABASE_JWT_SECRET: jwtSecret,
    SUPABASE_JWT_ISSUER: jwtIssuer,
    REDIS_URL: "redis://127.0.0.1:1/0",
    DATABASE_URL: "postgres://test:test@127.0.0.1:1/test",
    GOOGLE_AUTH_ENABLED: "false"
  };
  for (const [key, value] of Object.entries(values)) {
    vi.stubEnv(key, value);
  }
  const { createApp } = await import("../../app.js");
  app = createApp();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/v1/meta", () => {
  it("tells anonymous callers only the product name and API version", async () => {
    const response = await request(app).get("/api/v1/meta").expect(200);

    expect(response.body).toEqual({ name: "Nesso Work", apiVersion: "v1" });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("treats an invalid or forged session as anonymous", async () => {
    const forged = await accessToken({ secret: "another-secret-0123456789abcdefghijklmnop" });
    const viaCookie = await request(app).get("/api/v1/meta").set("cookie", `nesso_access_token=${forged}`).expect(200);
    const viaHeader = await request(app).get("/api/v1/meta").set("authorization", "Bearer not-a-jwt").expect(200);

    expect(viaCookie.body).toEqual({ name: "Nesso Work", apiVersion: "v1" });
    expect(viaHeader.body).toEqual({ name: "Nesso Work", apiVersion: "v1" });
  });

  it("returns ports and the permission catalog to signed-in callers", async () => {
    const token = await accessToken();
    const viaCookie = await request(app).get("/api/v1/meta").set("cookie", `nesso_access_token=${token}`).expect(200);
    const viaHeader = await request(app).get("/api/v1/meta").set("authorization", `Bearer ${token}`).expect(200);

    for (const response of [viaCookie, viaHeader]) {
      const body = ProductMetaSchema.parse(response.body);
      expect(body.ports).toEqual({ web: 5890, api: 3890 });
      expect(body.permissions.length).toBeGreaterThan(0);
    }
  });
});
