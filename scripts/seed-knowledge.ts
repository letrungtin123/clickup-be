/**
 * LOCAL DEVELOPMENT ONLY — demo knowledge base ("Kho tri thức", PD-031) for the invented photo-retouch company of
 * the other seeds: 4 spaces ("Quy trình Sản xuất", "Chính sách nhân sự", "Ban điều hành" (private), "Hướng dẫn IT"),
 * 2-level categories, 32 items across every status group and importance level, versions, approval flow, comments
 * with @mentions (some resolved), one item in the trash, and a few inbox entries for the owner.
 *
 *   cd BE
 *   npx tsx scripts/seed-knowledge.ts            # (re)seed: removes the previous seed first, then replays
 *   npx tsx scripts/seed-knowledge.ts --reset    # remove everything this seed created
 *
 * The content (scripts/seed-knowledge/content.ts) is replayed through the real knowledge services, so versions, the
 * append-only audit log, followers and search vectors are what the app itself writes; each step is then dated to
 * its planned business time (Aug 20 → Oct 9, 2026). The owner is found by the superadmin role (never by e-mail) and
 * manages every seeded space; the other people are invented dev accounts (@test.local / @nesso.test). Two modules
 * are swapped for this process only: the transactional outbox (replayed history never reaches RabbitMQ / inboxes /
 * e-mail) and the realtime publisher (no pushes to open browsers). Identification for --reset: the manifest table
 * nesso_dev.seed_manifest (dev-only schema). Spaces with the same name that this seed did not create are left alone.
 * Refuses NODE_ENV=production, non-loopback URLs and databases without the dev marker (scripts/lib/dev-guard.ts).
 */
import "dotenv/config";

import { register } from "node:module";

import { assertDevDatabase, isLoopbackUrl } from "./lib/dev-guard.js";

if (!isLoopbackUrl(process.env.SUPABASE_URL ?? "") || !isLoopbackUrl(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing to seed: SUPABASE_URL and DATABASE_URL must point at the local stack.");
  process.exit(1);
}
await assertDevDatabase();

// A small pool next to the running API + worker (the session pooler allows 20 connections per user).
process.env.DB_POOL_MAX = process.env.SEED_DB_POOL_MAX ?? "3";
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
    export const sessionRoom = (sessionId) => "session:" + sessionId;`
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
register(`data:text/javascript,${encodeURIComponent(hooks)}`);

const { main } = await import("./seed-knowledge/engine.js");
await main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
