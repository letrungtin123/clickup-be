import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { failedLoginMinMs } from "./login-timing.js";

/**
 * Password sign-in hardening without GoTrue, Redis or the database: rate limits use the in-memory store
 * (Redis mocked away, so nothing touches the shared dev Redis) and GoTrue answers via a fetch stub.
 * SEC2-02 per-address failure caps, SEC2-07 failure padding, SEC2-23 CSRF rotation.
 */
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

const knownEmail = "known@example.test";
const knownPassword = "right-password";
const outageEmail = "outage@example.test";

const gotrue = vi.hoisted(() => ({ calls: 0 }));

const fakeGoTrue = (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  gotrue.calls += 1;
  if (url.includes("/auth/v1/token?grant_type=password")) {
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { email?: string; password?: string };
    if (body.email === outageEmail) {
      return Promise.resolve(Response.json({ msg: "boom" }, { status: 500 }));
    }
    if (body.email === knownEmail && body.password === knownPassword) {
      return Promise.resolve(
        Response.json({
          access_token: "test-access-token",
          refresh_token: "test-refresh-token",
          expires_in: 3600,
          user: { id: "00000000-0000-4000-8000-0000000000aa", email: knownEmail }
        })
      );
    }
    return Promise.resolve(
      Response.json({ error: "invalid_grant", error_description: "Invalid login credentials" }, { status: 400 })
    );
  }
  if (url.includes("/auth/v1/logout")) {
    return Promise.resolve(new Response(null, { status: 204 }));
  }
  return Promise.resolve(new Response(null, { status: 404 }));
};

const loadApp = async (overrides: Record<string, string> = {}): Promise<Express> => {
  vi.resetModules();
  vi.unstubAllEnvs();
  const values: Record<string, string> = {
    NODE_ENV: "test",
    SUPABASE_URL: "http://gotrue.invalid:9999",
    SUPABASE_ANON_KEY: "test-anon-key",
    SUPABASE_JWT_SECRET: "test-jwt-secret-0123456789abcdefghijklmnop",
    REDIS_URL: "redis://127.0.0.1:1/0",
    DATABASE_URL: "postgres://test:test@127.0.0.1:1/test",
    AUTH_COOKIE_SECURE: "false",
    TRUST_PROXY_HOPS: "1",
    RATE_LIMIT_MAX: "1000",
    LOGIN_RATE_LIMIT_MAX: "10",
    LOGIN_ACCOUNT_LIMIT_MAX: "20",
    LOGIN_IP_LIMIT_MAX: "30",
    LOGIN_IP_DAILY_LIMIT_MAX: "200",
    GOOGLE_AUTH_ENABLED: "false",
    ...overrides
  };
  for (const [key, value] of Object.entries(values)) {
    vi.stubEnv(key, value);
  }
  const { createApp } = await import("../../app.js");
  return createApp();
};

const setCookies = (response: request.Response) => {
  const header = response.headers["set-cookie"] as unknown;
  return Array.isArray(header) ? header.map(String) : typeof header === "string" ? [header] : [];
};

const csrfCookie = (response: request.Response) =>
  setCookies(response)
    .find((value) => value.startsWith("nesso_csrf="))
    ?.slice("nesso_csrf=".length)
    .split(";")[0];

const errorCode = (response: request.Response) => (response.body as { error?: { code?: string } }).error?.code;

/** A browser-like client behind one (proxy-reported) address; every unsafe call carries the CSRF token. */
const client = (app: Express, ip: string) => {
  const agent = request.agent(app);
  const csrf = async () => {
    const response = await agent.get("/api/v1/auth/csrf").set("x-forwarded-for", ip).expect(200);
    return (response.body as { csrfToken: string }).csrfToken;
  };
  const login = async (email: string, password = "wrong-password", token?: string) => {
    // Fetch first: the agent attaches its cookies when the request is created.
    const csrfToken = token ?? (await csrf());
    return agent
      .post("/api/v1/auth/login")
      .set("x-forwarded-for", ip)
      .set("x-csrf-token", csrfToken)
      .send({ email, password });
  };
  /** Several failures at once (they share one token: failures do not rotate it). */
  const failMany = async (emails: string[]) => {
    const token = await csrf();
    return Promise.all(emails.map((email) => login(email, "wrong-password", token)));
  };
  return { agent, csrf, login, failMany };
};

beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn(fakeGoTrue));
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  gotrue.calls = 0;
});

describe("POST /auth/login per-address failure limit (SEC2-02)", () => {
  it("counts failures across different emails from one address and blocks the next attempt", async () => {
    const app = await loadApp({ LOGIN_IP_LIMIT_MAX: "3" });
    const sprayer = client(app, "10.250.0.1");

    const failures = await sprayer.failMany(["spray-1@example.test", "spray-2@example.test", "spray-3@example.test"]);
    expect(failures.map((response) => response.status)).toEqual([401, 401, 401]);

    const callsBefore = gotrue.calls;
    const blocked = await sprayer.login("spray-4@example.test");
    expect(blocked.status).toBe(429);
    expect(errorCode(blocked)).toBe("LOGIN_RATE_LIMITED");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    // Blocked before GoTrue is asked; the right password from that address waits too.
    const blockedValid = await sprayer.login(knownEmail, knownPassword);
    expect(blockedValid.status).toBe(429);
    expect(gotrue.calls).toBe(callsBefore);

    // Other addresses are not affected.
    const other = await client(app, "10.250.0.2").login("spray-5@example.test");
    expect(other.status).toBe(401);
  });

  it("never counts successful sign-ins (office NAT)", async () => {
    const app = await loadApp({ LOGIN_IP_LIMIT_MAX: "2" });
    const office = client(app, "10.250.0.3");

    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await office.login(knownEmail, knownPassword)).status).toBe(200);
    }
    const failures = await office.failMany(["typo-1@example.test", "typo-2@example.test"]);
    expect(failures.map((response) => response.status)).toEqual([401, 401]);
    expect((await office.login("typo-3@example.test")).status).toBe(429);
  });

  it("does not count identity-provider outages (5xx)", async () => {
    const app = await loadApp({ LOGIN_IP_LIMIT_MAX: "2" });
    const office = client(app, "10.250.0.4");

    // One after another: a request in flight still holds its slot until its status is known.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await office.login(outageEmail)).status).toBe(503);
    }

    const failures = await office.failMany(["typo-1@example.test", "typo-2@example.test"]);
    expect(failures.map((response) => response.status)).toEqual([401, 401]);
    expect((await office.login("typo-3@example.test")).status).toBe(429);
  });

  it("also caps failures per address per day", async () => {
    const app = await loadApp({ LOGIN_IP_LIMIT_MAX: "50", LOGIN_IP_DAILY_LIMIT_MAX: "2" });
    const sprayer = client(app, "10.250.0.5");

    const failures = await sprayer.failMany(["day-1@example.test", "day-2@example.test"]);
    expect(failures.map((response) => response.status)).toEqual([401, 401]);

    const blocked = await sprayer.login("day-3@example.test");
    expect(blocked.status).toBe(429);
    expect(errorCode(blocked)).toBe("LOGIN_RATE_LIMITED");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(15 * 60);
  });
});

describe("POST /auth/login failure timing (SEC2-07)", () => {
  let app: Express;
  beforeAll(async () => {
    app = await loadApp();
  });

  const timed = async (run: () => Promise<request.Response>) => {
    const startedAt = performance.now();
    const response = await run();
    return { response, ms: performance.now() - startedAt };
  };

  it("pads unknown-email, wrong-password and invalid-input failures; successes are not slowed", async () => {
    const user = client(app, "10.250.0.6");
    const token = await user.csrf();

    const unknown = await timed(() => user.login("nobody@example.test", "wrong-password", token));
    const wrong = await timed(() => user.login(knownEmail, "wrong-password", token));
    const invalid = await timed(() => user.login("not-an-email", "x", token));
    const outage = await timed(() => user.login(outageEmail, "x", token));

    expect([unknown.response.status, wrong.response.status, invalid.response.status, outage.response.status]).toEqual([
      401, 401, 400, 503
    ]);
    for (const failure of [unknown, wrong, invalid, outage]) {
      expect(failure.ms).toBeGreaterThanOrEqual(failedLoginMinMs - 5);
    }

    const success = await timed(() => user.login(knownEmail, knownPassword, token));
    expect(success.response.status).toBe(200);
    expect(success.ms).toBeLessThan(failedLoginMinMs);
  });
});

describe("CSRF token rotation at sign-in and sign-out (SEC2-23)", () => {
  let app: Express;
  beforeAll(async () => {
    app = await loadApp();
  });

  it("issues a fresh token at sign-in; the old one stops working and GET /auth/csrf hands out the new one", async () => {
    const user = client(app, "10.250.0.7");
    const before = await user.csrf();

    const login = await user.login(knownEmail, knownPassword, before);
    expect(login.status).toBe(200);
    const rotated = csrfCookie(login);
    expect(rotated).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(rotated).not.toBe(before);

    // A client still holding the pre-login token gets CSRF_INVALID (the SPA then refetches and retries).
    const stale = await user.agent.post("/api/v1/auth/socket-ticket").set("x-csrf-token", before);
    expect(stale.status).toBe(403);
    expect(errorCode(stale)).toBe("CSRF_INVALID");
    expect(await user.csrf()).toBe(rotated);
  });

  it("does not keep a planted token across sign-in", async () => {
    const planted = "a".repeat(43);
    const csrf = await request(app)
      .get("/api/v1/auth/csrf")
      .set("x-forwarded-for", "10.250.0.8")
      .set("cookie", `nesso_csrf=${planted}`)
      .expect(200);
    expect((csrf.body as { csrfToken: string }).csrfToken).toBe(planted);

    const login = await request(app)
      .post("/api/v1/auth/login")
      .set("x-forwarded-for", "10.250.0.8")
      .set("cookie", `nesso_csrf=${planted}`)
      .set("x-csrf-token", planted)
      .send({ email: knownEmail, password: knownPassword })
      .expect(200);
    const rotated = csrfCookie(login);
    expect(rotated).toBeDefined();
    expect(rotated).not.toBe(planted);
  });

  it("keeps the token on a failed sign-in", async () => {
    const user = client(app, "10.250.0.9");
    const failed = await user.login("nobody@example.test");
    expect(failed.status).toBe(401);
    expect(csrfCookie(failed)).toBeUndefined();
  });

  it("issues a fresh token at sign-out", async () => {
    const user = client(app, "10.250.0.10");
    expect((await user.login(knownEmail, knownPassword)).status).toBe(200);
    const signedIn = await user.csrf();

    const logout = await user.agent
      .post("/api/v1/auth/logout")
      .set("x-forwarded-for", "10.250.0.10")
      .set("x-csrf-token", signedIn)
      .expect(200);
    const rotated = csrfCookie(logout);
    expect(rotated).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(rotated).not.toBe(signedIn);
    expect(await user.csrf()).toBe(rotated);
  });
});
