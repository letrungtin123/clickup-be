/**
 * LOCAL DEVELOPMENT ONLY — realistic, complete test data for the work-management + chat + inbox side of
 * Nesso Work: an invented photo-retouch company that has used the app for ~6 weeks
 * (2026-08-25 → 2026-10-10, Asia/Ho_Chi_Minh).
 *
 *   cd BE
 *   npx tsx scripts/seed-workspace.ts            # (re)seed: removes the previous seed first, then replays
 *   npx tsx scripts/seed-workspace.ts --reset    # remove everything this seed created (projects, channels, DMs,
 *                                                # files, inbox entries, seed roles, ex-employee accounts)
 *   npx tsx scripts/seed-workspace.ts --relabel  # refresh @mention labels after display names changed
 *   npx tsx scripts/seed-workspace.ts --plan     # print the planned work model only (no writes besides roles)
 *   npx tsx scripts/seed-workspace.ts --disable-departed  # only make sure the ex-employees are disabled + banned
 *                                                # (the app's own disable flow; no module hooks, nothing else)
 *
 * How it works: the content in scripts/seed-workspace/content/*.ts is replayed through the real BE services
 * (projects, workflows, tasks, comments, uploads to Supabase Storage, chat channels/DMs/messages/threads/
 * reactions…) in chronological order, so numbers, ranks, activity, search vectors and read state are what the
 * app itself would write. Module hooks swap three modules for this process only: the transactional outbox
 * (historical events never reach RabbitMQ / inboxes), the realtime publisher (no live pushes to open browsers)
 * and the per-user chat quota. Afterwards every row is moved from its execution time to its planned time,
 * chat read markers are set, and the inbox is rebuilt for the last 10 days with the deadline scanner's dedupe
 * keys. Identification for --reset: project keys, channel names + seed creators, and DM messages whose
 * client_message_id starts with 5eed5eed. Ex-employee passwords go to BE/.env.seed (git-ignored, never printed).
 * Refuses NODE_ENV=production, non-loopback URLs and databases without the dev marker (scripts/lib/dev-guard.ts).
 */
import "dotenv/config";

import { register } from "node:module";

import { assertDevDatabase } from "./lib/dev-guard.js";

const isLoopback = (value: string) => {
  try {
    const host = new URL(value).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
  } catch {
    return false;
  }
};

if (!isLoopback(process.env.SUPABASE_URL ?? "") || !isLoopback(process.env.DATABASE_URL ?? "") || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Refusing to seed: SUPABASE_URL and DATABASE_URL must point at the local stack.");
  process.exit(1);
}
await assertDevDatabase();

// A small pool next to the running API + worker (the session pooler allows 20 connections per user).
process.env.DB_POOL_MAX = process.env.SEED_DB_POOL_MAX ?? "4";
process.env.LOG_LEVEL = process.env.SEED_LOG_LEVEL ?? "error";

const shims: Record<string, string> = {
  "/src/modules/events/outbox.ts": `
    export const enqueueDomainEvents = async (_tx, events) => {
      globalThis.__seedOutboxSuppressed = (globalThis.__seedOutboxSuppressed ?? 0) + events.length;
    };`,
  "/src/realtime/publisher.ts": `
    const noop = () => {};
    export const setLocalRealtimeServer = noop, publishToRooms = noop, publishToRoom = noop, publishToUsers = noop,
      disconnectRooms = noop, resetRoom = noop, disconnectUsers = noop, evictUsersFromRoom = noop;
    export const sessionRoom = (sessionId) => "session:" + sessionId;`,
  "/src/modules/chat/chat-rate-limit.ts": `
    export const chatQuotas = { send: { limit: 20, windowSeconds: 10 }, react: { limit: 60, windowSeconds: 10 }, upload: { limit: 30, windowSeconds: 60 } };
    export const consumeChatQuota = async () => {};`
};

const hooks = `
const shims = ${JSON.stringify(shims)};
export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  for (const suffix of Object.keys(shims)) {
    if (result.url.replaceAll("\\\\", "/").endsWith(suffix)) {
      return { url: "seed-shim:" + suffix, format: "module", shortCircuit: true };
    }
  }
  return result;
}
export async function load(url, context, nextLoad) {
  if (url.startsWith("seed-shim:")) {
    return { format: "module", source: shims[url.slice("seed-shim:".length)], shortCircuit: true };
  }
  return nextLoad(url, context);
}`;
// --disable-departed acts like the app itself (real outbox, realtime disconnects): no hooks for that mode.
if (!process.argv.includes("--disable-departed")) {
  register(`data:text/javascript,${encodeURIComponent(hooks)}`);
}

const { main } = await import("./seed-workspace/engine.js");
await main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
