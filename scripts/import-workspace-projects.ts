/**
 * LOCAL DEVELOPMENT ONLY — mirrors the production module into workspace projects (ClickUp-style), so the work
 * history imported into "Sản xuất" can also be browsed as projects / lists / tasks:
 *   - one public project per production project code (inactive codes end archived);
 *   - one list per month ("T7/2026");
 *   - one done task per production job (assignees = its workers, due = job deadline);
 *   - one done subtask per production task (process · images · shift · credit · QC).
 * People who worked on or checked a code become project members (leaders manage, others submit).
 *
 *   npx tsx scripts/import-workspace-projects.ts [--dry-run]
 *
 * Everything is read from the production tables, never from files, so the two modules match 1-1. Writes go through
 * the real workspace services (task numbers, ranks, search, activity) as the organization's first superadmin. The
 * outbox and the realtime publisher are swapped for no-ops so nobody is notified. Timestamps are then set to the
 * production history. Re-runs skip projects whose key already exists. Money (Khoán prices) is left out: it is
 * private to its owner and Admins.
 */
import "dotenv/config";

import { register } from "node:module";

import { assertDevDatabase, isLoopbackUrl } from "./lib/dev-guard.js";

if (!isLoopbackUrl(process.env.SUPABASE_URL ?? "") || !isLoopbackUrl(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing to import: SUPABASE_URL and DATABASE_URL must point at the local stack.");
  process.exit(1);
}
await assertDevDatabase();
process.env.DB_POOL_MAX = process.env.SEED_DB_POOL_MAX ?? "3";
process.env.LOG_LEVEL = process.env.SEED_LOG_LEVEL ?? "error";

const shims: Record<string, string> = {
  "/src/modules/events/outbox.ts": "export const enqueueDomainEvents = async () => {};",
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
      return { url: "import-shim:" + suffix, format: "module", shortCircuit: true };
    }
  }
  return result;
}
export async function load(url, context, nextLoad) {
  if (url.startsWith("import-shim:")) {
    return { format: "module", source: shims[url.slice("import-shim:".length)], shortCircuit: true };
  }
  return nextLoad(url, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);

const { main } = await import("./import-workspace-projects/engine.js");
await main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
