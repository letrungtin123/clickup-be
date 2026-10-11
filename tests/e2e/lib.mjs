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
  // The API rotates the CSRF token at sign-in (SEC2-23): fetch the new one for the requests that follow.
  csrf = (await call("GET", "/auth/csrf")).body.csrfToken;
  return { call, cookieHeader };
};

// Local-only DB/Redis access for suite setup (refuses any container outside the dev compose projects).
import { spawnSync } from "node:child_process";

const assertProject = (container, expected) => {
  const project = spawnSync("docker", ["inspect", container, "--format", '{{index .Config.Labels "com.docker.compose.project"}}'], { encoding: "utf8" }).stdout.trim();
  if (project !== expected) {
    throw new Error(`refusing: ${container} belongs to '${project}', expected '${expected}'`);
  }
};

/** Runs SQL on the LOCAL dev database and returns unaligned rows (`a|b`). */
export const localSql = (statement) => {
  assertProject("supabase-db", "clickup-supabase-selfhost");
  const result = spawnSync("docker", ["exec", "-i", "supabase-db", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-At"], {
    input: statement,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`localSql failed: ${result.stderr}`);
  }
  return result.stdout.trim().split(/\r?\n/).filter(Boolean);
};

/** Bumps the access-context cache version after direct SQL changes to authorization data. */
export const bumpAuthz = () => {
  assertProject("nesso-work-redis", "nesso-work-infra");
  const password = readFileSync(new URL("../../../infra/.env", import.meta.url), "utf8").match(/^REDIS_PASSWORD=(.*)$/m)?.[1]?.trim();
  const result = spawnSync("docker", ["exec", "-e", `REDISCLI_AUTH=${password ?? ""}`, "nesso-work-redis", "redis-cli", "INCR", "authz:ver"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error("bumpAuthz failed");
  }
};

/**
 * The suites assume the seeded dev accounts keep their original org roles (MANAGER = manager, MEMBER_A/B/C =
 * member). Demo seeds may give them other roles (seed-workspace makes some "Trưởng nhóm dự án"): pin the
 * expected roles for the run and return a function restoring what was there before.
 */
export const pinSeedRoles = () => {
  const expected = { MANAGER: "manager", MEMBER_A: "member", MEMBER_B: "member", MEMBER_C: "member" };
  const emails = Object.keys(expected)
    .map((who) => seed[`SEED_${who}_EMAIL`])
    .filter(Boolean)
    .map((email) => `'${String(email).toLowerCase().replace(/'/g, "''")}'`);
  if (emails.length === 0) return () => undefined;
  const before = localSql(`
    SELECT om.organization_id || '|' || om.user_id || '|' || om.role_id
    FROM public.organization_memberships om JOIN public.app_users u ON u.id = om.user_id
    WHERE lower(u.email) IN (${emails.join(", ")}) AND om.deleted_at IS NULL;
  `);
  const assign = Object.entries(expected)
    .filter(([who]) => seed[`SEED_${who}_EMAIL`])
    .map(
      ([who, key]) => `
        UPDATE public.organization_memberships om SET role_id = r.id
        FROM public.app_users u, public.roles r
        WHERE u.id = om.user_id AND lower(u.email) = '${String(seed[`SEED_${who}_EMAIL`]).toLowerCase().replace(/'/g, "''")}'
          AND r.organization_id = om.organization_id AND r.key = '${key}' AND r.deleted_at IS NULL
          AND om.role_id <> r.id;`
    )
    .join("\n");
  localSql(assign);
  bumpAuthz();
  return () => {
    const restore = before
      .map((line) => line.split("|"))
      .filter((parts) => parts.length === 3 && parts.every((part) => /^[0-9a-f-]{36}$/.test(part)))
      .map(
        ([organizationId, userId, roleId]) =>
          `UPDATE public.organization_memberships SET role_id = '${roleId}' WHERE organization_id = '${organizationId}' AND user_id = '${userId}' AND role_id <> '${roleId}';`
      )
      .join("\n");
    if (restore) localSql(restore);
    bumpAuthz();
  };
};

/** Signed storage URLs may be same-origin paths; resolve them against the web app (Vite proxies /storage/v1). */
export const webAppOrigin = process.env.E2E_APP_ORIGIN ?? "http://127.0.0.1:5276";
export const storageFetch = (url, init) => fetch(new URL(url, webAppOrigin), init);

/**
 * SEC2-16: the suites create and delete data, so they refuse NODE_ENV=production and any database without the dev
 * marker nesso_dev.environment('dev') (LOCAL-ONLY supabase/dev/mark-dev-database.sql; same rule as the seed scripts,
 * scripts/lib/dev-guard.ts). Returns null when the stack may be used, otherwise the reason. `run` = localSql.
 */
export const devStackProblem = (run = localSql) => {
  if ((process.env.NODE_ENV ?? "").trim().toLowerCase() === "production") {
    return "NODE_ENV is production";
  }
  try {
    if (run("SELECT to_regclass('nesso_dev.environment') IS NOT NULL")[0] !== "t") {
      return "the database has no dev marker (table nesso_dev.environment is missing)";
    }
    if (run("SELECT count(*) FROM nesso_dev.environment WHERE name = 'dev'")[0] !== "1") {
      return "the database has no dev marker (nesso_dev.environment has no 'dev' row)";
    }
  } catch (error) {
    return `the dev marker could not be checked (${error instanceof Error ? error.message.split("\n")[0] : String(error)})`;
  }
  return null;
};

let devStackChecked = false;
/** Exits the process (code 1) unless devStackProblem() is null. Checked once per process. */
export const assertDevStack = () => {
  if (devStackChecked) return;
  const problem = devStackProblem();
  if (problem) {
    console.error(`Refusing to run the e2e suites: ${problem}. See docs/architecture/localhost.md ("Dev database marker").`);
    process.exit(1);
  }
  devStackChecked = true;
};

// Every suite, cleanup.mjs and run.mjs import this file: nothing runs against an unmarked database.
assertDevStack();
