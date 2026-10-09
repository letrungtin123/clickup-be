// Shared helper for the live end-to-end suites (local stack only).
// Logs in as a seeded dev account (BE/.env.seed), handles cookies + CSRF, never prints secrets.
import { readFileSync } from "node:fs";

const seedFile = new URL("../../.env.seed", import.meta.url);
export const seed = Object.fromEntries(
  readFileSync(seedFile, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("SEED_"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)])
);
export const apiOrigin = process.env.E2E_API_ORIGIN ?? "http://127.0.0.1:3890";
export const base = `${apiOrigin}/api/v1`;
const origin = process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:5890";

export const session = async (who) => {
  const cookies = new Map();
  let csrf = null;
  const cookieHeader = () => [...cookies].map(([key, value]) => `${key}=${value}`).join("; ");
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", cookie: cookieHeader(), origin, ...(csrf ? { "x-csrf-token": csrf } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const index = pair.indexOf("=");
      const key = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (value) cookies.set(key, value);
      else cookies.delete(key);
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, body: json };
  };
  csrf = (await call("GET", "/auth/csrf")).body.csrfToken;
  const login = await call("POST", "/auth/login", { email: seed[`SEED_${who}_EMAIL`], password: seed[`SEED_${who}_PASSWORD`] });
  if (login.status !== 200) {
    throw new Error(`login ${who} failed ${login.status}`);
  }
  return { call, cookieHeader };
};
