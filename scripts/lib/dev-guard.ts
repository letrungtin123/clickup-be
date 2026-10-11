/**
 * SEC2-16 — safety net shared by every LOCAL seed script (seed-dev-users, seed-from-worklog,
 * seed-production-sim, seed-workspace). `assertDevDatabase()` must run before anything is read or written; it
 * prints the reason and exits with code 1 when
 *   - NODE_ENV is "production",
 *   - DATABASE_URL is not a loopback address (the scripts keep their own SUPABASE_URL/DATABASE_URL check too), or
 *   - the database does not carry the dev marker: one row nesso_dev.environment('dev'), created only by the
 *     LOCAL-ONLY file supabase/dev/mark-dev-database.sql (never part of the production migration chain).
 * The marker is a table rather than a database setting or startup parameter because the Supabase session pooler
 * drops startup parameters; a plain SELECT works through it. Same check for the e2e runner: tests/e2e/lib.mjs.
 */
import postgres from "postgres";

import type { QuerySql } from "../../src/lib/db-types.js";

export const isLoopbackUrl = (value: string) => {
  try {
    const host = new URL(value).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
  } catch {
    return false;
  }
};

export const isProductionNodeEnv = () => (process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";

/** Null when the connected database carries the dev marker, otherwise the reason it does not. */
export const devMarkerProblem = async (sql: QuerySql): Promise<string | null> => {
  const [table] = await sql<{ present: boolean }[]>`SELECT to_regclass('nesso_dev.environment') IS NOT NULL AS present`;
  if (!table?.present) {
    return "the database has no dev marker (table nesso_dev.environment is missing)";
  }
  const rows = await sql<{ name: string }[]>`SELECT name FROM nesso_dev.environment WHERE name = 'dev'`;
  return rows.length === 1 ? null : "the database has no dev marker (nesso_dev.environment has no 'dev' row)";
};

const refuse = (reason: string): never => {
  console.error(
    `Refusing to run: ${reason}. Seed scripts only run against a LOCAL dev database marked with ` +
      "supabase/dev/mark-dev-database.sql (docs/architecture/localhost.md, \"Dev database marker\")."
  );
  process.exit(1);
};

/** Exits the process (code 1) unless this is a non-production run against a marked local dev database. */
export const assertDevDatabase = async (databaseUrl = process.env.DATABASE_URL ?? "") => {
  if (isProductionNodeEnv()) {
    refuse("NODE_ENV is production");
  }
  if (!isLoopbackUrl(databaseUrl)) {
    refuse("DATABASE_URL does not point at the local stack");
  }
  const sql = postgres(databaseUrl, { max: 1, idle_timeout: 5, connect_timeout: 10, onnotice: () => undefined });
  let problem: string | null;
  try {
    problem = await devMarkerProblem(sql);
  } catch (error) {
    problem = `the dev marker could not be checked (${error instanceof Error ? error.message : "unknown error"})`;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
  if (problem) {
    refuse(problem);
  }
};
