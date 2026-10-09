import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "../config/env.js";

let sqlClient: postgres.Sql | undefined;
let dbClient: ReturnType<typeof drizzle> | undefined;

export const hasDatabaseConfig = () => Boolean(env.DATABASE_URL);

export const getSql = () => {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }

  sqlClient ??= postgres(env.DATABASE_URL, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: env.DATABASE_SSL ? "require" : false
  });

  return sqlClient;
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

