import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createOAuthState, pkceChallenge } from "./google-oauth.js";

/**
 * Route-level checks for Google sign-in (PD-012) without Google, GoTrue, Redis or the database:
 * the flow store is in memory, Redis is absent (memory rate limits) and GoTrue answers via a fetch stub.
 */
const { flows, gotrue } = vi.hoisted(() => ({
  flows: new Map<string, { codeVerifier: string; next: string }>(),
  gotrue: { googleEnabled: true, calls: [] as string[] }
}));

vi.mock("./google-flow.store.js", () => ({
  googleFlowTtlSeconds: 600,
  saveGoogleFlow: (state: string, flow: { codeVerifier: string; next: string }) => {
    flows.set(state, flow);
    return Promise.resolve();
  },
  takeGoogleFlow: (state: string) => {
    const flow = flows.get(state) ?? null;
    flows.delete(state);
    return Promise.resolve(flow);
  }
}));

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

const fakeGoTrue = (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  gotrue.calls.push(url);
  if (url.includes("/auth/v1/settings")) {
    return Promise.resolve(Response.json({ external: { google: gotrue.googleEnabled, email: true } }));
  }
  if (url.includes("/auth/v1/token?grant_type=pkce")) {
    return Promise.resolve(Response.json({ code: 400, error_code: "flow_state_not_found" }, { status: 400 }));
  }
  return Promise.resolve(new Response(null, { status: 404 }));
};

const appUrl = "https://app.example.test";
const supabaseUrl = "https://sb.example.test";
const cookieName = "nesso_google_oauth";

const loadApp = async (overrides: Record<string, string>): Promise<Express> => {
  vi.resetModules();
  vi.unstubAllEnvs();
  const values: Record<string, string> = {
    GOOGLE_AUTH_ENABLED: "false",
    SUPABASE_PUBLIC_URL: supabaseUrl,
    APP_PUBLIC_URL: appUrl,
    SUPABASE_URL: "http://gotrue.invalid:9999",
    SUPABASE_ANON_KEY: "test-anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
    REDIS_URL: "redis://127.0.0.1:1/0",
    DATABASE_URL: "postgres://test:test@127.0.0.1:1/test",
    AUTH_COOKIE_SECURE: "true",
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

const loginError = (response: request.Response) => {
  expect(response.status).toBe(303);
  const location = new URL(String(response.headers.location));
  expect(location.origin + location.pathname).toBe(`${appUrl}/login`);
  return location.searchParams.get("error");
};

beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn(fakeGoTrue));
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  flows.clear();
  gotrue.calls.length = 0;
  gotrue.googleEnabled = true;
});

describe("Google sign-in when GOOGLE_AUTH_ENABLED is unset", () => {
  let app: Express;
  beforeAll(async () => {
    app = await loadApp({ GOOGLE_AUTH_ENABLED: "" });
  });

  it("reports the provider as off", async () => {
    const response = await request(app).get("/api/v1/auth/providers").expect(200);
    expect(response.body).toEqual({ google: false });
    expect(gotrue.calls).toEqual([]);
  });

  it("hides the start and callback endpoints", async () => {
    const start = await request(app).get("/api/v1/auth/google/start").expect(404);
    expect((start.body as { error: { code: string } }).error.code).toBe("NOT_FOUND");
    const state = createOAuthState();
    await request(app)
      .get(`/api/v1/auth/google/callback?state=${state}&code=00000000-0000-4000-8000-000000000001`)
      .set("cookie", `${cookieName}=${state}`)
      .expect(404);
    expect(flows.size).toBe(0);
  });
});

describe("Google sign-in when enabled", () => {
  let app: Express;
  beforeAll(async () => {
    app = await loadApp({ GOOGLE_AUTH_ENABLED: "true" });
  });

  const start = async (next?: string) => {
    const response = await request(app)
      .get("/api/v1/auth/google/start")
      .query(next === undefined ? {} : { next })
      .expect(303);
    const location = new URL(String(response.headers.location));
    const redirectTo = new URL(location.searchParams.get("redirect_to") ?? "");
    const state = redirectTo.searchParams.get("state") ?? "";
    return { response, location, redirectTo, state, flow: flows.get(state) };
  };

  it("reports the provider as on when GoTrue has Google configured", async () => {
    const response = await request(app).get("/api/v1/auth/providers").expect(200);
    expect(response.body).toEqual({ google: true });
  });

  it("starts the PKCE flow at GoTrue and binds the state to the browser", async () => {
    const { response, location, redirectTo, state, flow } = await start("/p/1/l/2?task=3");
    expect(location.origin + location.pathname).toBe(`${supabaseUrl}/auth/v1/authorize`);
    expect(location.searchParams.get("provider")).toBe("google");
    expect(location.searchParams.get("code_challenge_method")).toBe("s256");
    expect(redirectTo.origin + redirectTo.pathname).toBe(`${appUrl}/api/v1/auth/google/callback`);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(flow?.next).toBe("/p/1/l/2?task=3");
    expect(location.searchParams.get("code_challenge")).toBe(pkceChallenge(flow?.codeVerifier ?? ""));
    // The verifier never leaves the server.
    expect(String(response.headers.location)).not.toContain(flow?.codeVerifier ?? "-");

    const cookie = setCookies(response).find((value) => value.startsWith(`${cookieName}=`)) ?? "";
    expect(cookie).toContain(`${cookieName}=${state};`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/api/v1/auth/google");
    expect(cookie).toContain("Max-Age=600");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it.each(["//evil.test", "https://evil.test/x", "/\\evil.test", "/login?next=/x"])("drops the unsafe next target %s", async (next) => {
    const { flow } = await start(next);
    expect(flow?.next).toBe("/");
  });

  it("rejects a callback without state", async () => {
    const response = await request(app).get("/api/v1/auth/google/callback?code=00000000-0000-4000-8000-000000000001");
    expect(loginError(response)).toBe("google_state_invalid");
    expect(setCookies(response).some((value) => value.startsWith(`${cookieName}=;`))).toBe(true);
  });

  it("rejects a callback whose state has no matching cookie", async () => {
    const { state } = await start();
    const response = await request(app).get(`/api/v1/auth/google/callback?state=${state}&code=00000000-0000-4000-8000-000000000001`);
    expect(loginError(response)).toBe("google_state_invalid");
  });

  it("rejects a callback whose state differs from the cookie", async () => {
    const { state } = await start();
    const response = await request(app)
      .get(`/api/v1/auth/google/callback?state=${state}&code=00000000-0000-4000-8000-000000000001`)
      .set("cookie", `${cookieName}=${createOAuthState()}`);
    expect(loginError(response)).toBe("google_state_invalid");
    expect(gotrue.calls.some((url) => url.includes("grant_type=pkce"))).toBe(false);
  });

  it("rejects a forged state that was never issued", async () => {
    const forged = createOAuthState();
    const response = await request(app)
      .get(`/api/v1/auth/google/callback?state=${forged}&code=00000000-0000-4000-8000-000000000001`)
      .set("cookie", `${cookieName}=${forged}`);
    expect(loginError(response)).toBe("google_state_invalid");
  });

  it("maps a cancelled consent and consumes the state (no replay)", async () => {
    const { state } = await start();
    const cancelled = await request(app)
      .get(`/api/v1/auth/google/callback?state=${state}&error=access_denied&error_description=denied`)
      .set("cookie", `${cookieName}=${state}`);
    expect(loginError(cancelled)).toBe("google_cancelled");
    const replay = await request(app)
      .get(`/api/v1/auth/google/callback?state=${state}&code=00000000-0000-4000-8000-000000000001`)
      .set("cookie", `${cookieName}=${state}`);
    expect(loginError(replay)).toBe("google_state_invalid");
  });

  it("maps GoTrue's signup_disabled (no provisioned account) to not allowed", async () => {
    const { state } = await start();
    const response = await request(app)
      .get(`/api/v1/auth/google/callback?state=${state}&error=access_denied&error_code=signup_disabled`)
      .set("cookie", `${cookieName}=${state}`);
    expect(loginError(response)).toBe("google_not_allowed");
  });

  it("fails closed when GoTrue rejects the code exchange", async () => {
    const { state } = await start();
    const response = await request(app)
      .get(`/api/v1/auth/google/callback?state=${state}&code=00000000-0000-4000-8000-000000000001`)
      .set("cookie", `${cookieName}=${state}`);
    expect(loginError(response)).toBe("google_failed");
    expect(gotrue.calls.some((url) => url.includes("grant_type=pkce"))).toBe(true);
    expect(setCookies(response).some((value) => value.startsWith("nesso_access_token="))).toBe(false);
  });

  it("refuses malformed codes without calling GoTrue", async () => {
    const { state } = await start();
    const response = await request(app)
      .get(`/api/v1/auth/google/callback?state=${state}&code=${encodeURIComponent("<script>")}`)
      .set("cookie", `${cookieName}=${state}`);
    expect(loginError(response)).toBe("google_failed");
    expect(gotrue.calls.some((url) => url.includes("grant_type=pkce"))).toBe(false);
  });
});

describe("Google sign-in when enabled but GoTrue's provider is off", () => {
  let app: Express;
  beforeAll(async () => {
    gotrue.googleEnabled = false;
    app = await loadApp({ GOOGLE_AUTH_ENABLED: "true" });
  });

  it("hides the button and sends a started flow back to the login page", async () => {
    gotrue.googleEnabled = false;
    expect((await request(app).get("/api/v1/auth/providers").expect(200)).body).toEqual({ google: false });
    expect(loginError(await request(app).get("/api/v1/auth/google/start"))).toBe("google_unavailable");
    expect(flows.size).toBe(0);
  });
});

describe("Google sign-in rate limit", () => {
  let app: Express;
  beforeAll(async () => {
    app = await loadApp({ GOOGLE_AUTH_ENABLED: "true", GOOGLE_AUTH_RATE_LIMIT_MAX: "2" });
  });

  it("redirects to the login page once the per-address budget is used", async () => {
    await request(app).get("/api/v1/auth/google/start").expect(303);
    await request(app).get("/api/v1/auth/google/start").expect(303);
    expect(loginError(await request(app).get("/api/v1/auth/google/start"))).toBe("google_rate_limited");
  });
});
