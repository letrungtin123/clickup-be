// Google sign-in (PD-012) against the LOCAL API with GOOGLE_AUTH_ENABLED unset (the default):
// the login page must not offer Google and every Google endpoint must be invisible.
// A real Google round trip needs an HTTPS domain + Google OAuth client (docs/architecture/google-login.md).
import { base } from "./lib.mjs";

const ok = (label, cond, extra = "") => console.log(`${cond ? "PASS" : "FAIL"}  ${label} ${extra}`);
const origin = process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:5890";
const get = (path, headers = {}) => fetch(base + path, { redirect: "manual", headers: { origin, ...headers } });

const providers = await get("/auth/providers");
const body = await providers.json().catch(() => null);
ok("GET /auth/providers answers 200", providers.status === 200, String(providers.status));
ok("google provider is off", body?.google === false, JSON.stringify(body));
ok("providers response is not cached", providers.headers.get("cache-control") === "no-store");

const start = await get("/auth/google/start?next=%2Fp%2F1");
ok("GET /auth/google/start is 404 while disabled", start.status === 404, String(start.status));
ok("start sets no state cookie", !(start.headers.getSetCookie?.() ?? []).some((cookie) => cookie.startsWith("nesso_google_oauth=")));

const state = "A".repeat(43);
const callback = await get(`/auth/google/callback?state=${state}&code=00000000-0000-4000-8000-000000000001`, {
  cookie: `nesso_google_oauth=${state}`
});
ok("GET /auth/google/callback is 404 while disabled", callback.status === 404, String(callback.status));
ok("callback sets no session cookie", !(callback.headers.getSetCookie?.() ?? []).some((cookie) => cookie.startsWith("nesso_access_token=")));

const bare = await get("/auth/google/callback");
ok("callback without state is 404 while disabled", bare.status === 404, String(bare.status));
