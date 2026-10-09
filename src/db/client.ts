import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";

import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

/**
 * Per-process pool settings (PERF-06 / PERF-12). Each PM2 process has its own environment, so the API and the
 * worker are tuned independently with the same variables:
 *   DB_POOL_MAX                   connections in this process' pool (API 14, worker 5 by default)
 *   DB_STATEMENT_TIMEOUT_MS       per-statement limit (API 15 s, worker 60 s; 0 = off)
 *   DB_IDLE_TX_TIMEOUT_MS         idle-in-transaction limit (30 s; 0 = off)
 * Long legitimate work raises the limit for its own transaction with `setLocalStatementTimeout`.
 */
const PoolEnvSchema = z.object({
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).optional(),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).max(3_600_000).optional(),
  DB_IDLE_TX_TIMEOUT_MS: z.coerce.number().int().min(0).max(3_600_000).optional()
});

type DatabaseRole = "api" | "worker";
const roleDefaults: Record<DatabaseRole, { max: number; statementTimeoutMs: number }> = {
  // API + worker must fit the session pooler's per-user pool (POOLER_DEFAULT_POOL_SIZE=20 locally).
  api: { max: 14, statementTimeoutMs: 15_000 },
  worker: { max: 5, statementTimeoutMs: 60_000 }
};

let role: DatabaseRole = "api";
let sqlClient: postgres.Sql | undefined;
let dbClient: ReturnType<typeof drizzle> | undefined;
/** Set when the server ignored the startup parameters (e.g. Supavisor): limits are applied per transaction. */
let applyTimeoutsPerTransaction = false;

/** Call once at process start, before the first query (the worker uses a smaller pool, longer statements). */
export const configureDatabase = (options: { role: DatabaseRole }) => {
  if (sqlClient) {
    throw new Error("configureDatabase must run before the first database query");
  }
  role = options.role;
};

export const databaseSettings = () => {
  const parsed = PoolEnvSchema.safeParse(process.env);
  const overrides = parsed.success ? parsed.data : {};
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues.map((issue) => issue.path.join(".")) }, "Ignoring invalid DB pool settings");
  }
  return {
    max: overrides.DB_POOL_MAX ?? roleDefaults[role].max,
    statementTimeoutMs: overrides.DB_STATEMENT_TIMEOUT_MS ?? roleDefaults[role].statementTimeoutMs,
    idleInTransactionTimeoutMs: overrides.DB_IDLE_TX_TIMEOUT_MS ?? 30_000
  };
};

export const hasDatabaseConfig = () => Boolean(env.DATABASE_URL);

const timeoutsSql = (tx: postgres.TransactionSql, statementTimeoutMs: number, idleMs: number) =>
  tx`SELECT set_config('statement_timeout', ${String(statementTimeoutMs)}, true),
            set_config('idle_in_transaction_session_timeout', ${String(idleMs)}, true)`;

/**
 * Connection poolers in session/transaction mode (Supavisor, PgBouncer) drop startup parameters. Detect it
 * once and fall back to SET LOCAL at the start of every transaction (statement limits for single statements
 * outside transactions then need a role-level setting: ALTER ROLE <app role> SET statement_timeout = ...).
 */
const probeTimeouts = (client: postgres.Sql, expectedMs: number) => {
  if (expectedMs === 0) {
    return;
  }
  client<{ value: string }[]>`SELECT current_setting('statement_timeout') AS value`
    .then((rows) => {
      if (rows[0]?.value === "0") {
        applyTimeoutsPerTransaction = true;
        logger.warn("Database ignored startup parameters (connection pooler); applying timeouts per transaction");
      }
    })
    .catch(() => undefined);
};

export const getSql = () => {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }

  if (!sqlClient) {
    const settings = databaseSettings();
    const client = postgres(env.DATABASE_URL, {
      max: settings.max,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: env.DATABASE_SSL ? "require" : false,
      connection: {
        statement_timeout: settings.statementTimeoutMs,
        idle_in_transaction_session_timeout: settings.idleInTransactionTimeoutMs
      }
    });

    // Every transaction (all modules) gets the limits when the pooler stripped them from the connection.
    const begin = client.begin.bind(client) as (...args: unknown[]) => Promise<unknown>;
    (client as unknown as { begin: (...args: unknown[]) => Promise<unknown> }).begin = (...args: unknown[]) => {
      const callback = args[args.length - 1];
      if (!applyTimeoutsPerTransaction || typeof callback !== "function") {
        return begin(...args);
      }
      const wrapped = async (tx: postgres.TransactionSql) => {
        await timeoutsSql(tx, settings.statementTimeoutMs, settings.idleInTransactionTimeoutMs);
        return (callback as (tx: postgres.TransactionSql) => unknown)(tx);
      };
      return begin(...args.slice(0, -1), wrapped);
    };

    sqlClient = client;
    probeTimeouts(client, settings.statementTimeoutMs);
  }

  return sqlClient;
};

/** Raises (or lowers) the statement limit for the rest of this transaction, e.g. exports and settlements. */
export const setLocalStatementTimeout = async (tx: postgres.TransactionSql, milliseconds: number) => {
  await tx`SELECT set_config('statement_timeout', ${String(Math.max(0, Math.trunc(milliseconds)))}, true)`;
};

export const getDb = () => {
  dbClient ??= drizzle(getSql());
  return dbClient;
};

export const checkDatabase = async () => {
  if (!env.DATABASE_URL) {
    return { ok: false, reason: "DATABASE_URL is not configured" };
  }

  await getSql()`select 1`;
  return { ok: true, reason: null };
};

export const closeDatabase = async () => {
  if (sqlClient) {
    await sqlClient.end({ timeout: 5 });
    sqlClient = undefined;
    dbClient = undefined;
  }
};
