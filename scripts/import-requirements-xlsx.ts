/**
 * LOCAL DEVELOPMENT ONLY — puts the "general requirements" of the company's credit workbook into the knowledge base
 * ("Kho tri thức", PD-031): one public space, one published item per project with a table
 * Công đoạn | Yêu cầu | Phút/hình (ước tính). Prices and the proposed new credits are left out on purpose (money is
 * private; new prices are not in force).
 *
 *   npx tsx scripts/import-requirements-xlsx.ts --config <private config.json> [--dry-run]
 *
 * Config keys: requirementsFile (the workbook), requirementsSpace (space name), projectAliases (file code → project
 * code). Sheet layout: header row with "Project", "Yêu cầu chung", "Phút / hình"; a row holding only a code starts a
 * project, the rows below it are its processes. Items are written through the real knowledge services (versions,
 * audit log, search) as the organization's first superadmin; the outbox and realtime publisher are swapped for no-ops
 * so the import notifies nobody. Re-runs skip items whose title already exists in the space.
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

const { main } = await import("./import-requirements/engine.js");
await main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
