// Copies the API contracts (source of truth: BE/src/contracts) into FE/src/contracts.
// FE and BE stay independent source trees (ADR-0001); this keeps their contracts identical.
//   node BE/scripts/sync-contracts.mjs
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = join(root, "BE", "src", "contracts");
const target = join(root, "FE", "src", "contracts");

mkdirSync(target, { recursive: true });
for (const file of readdirSync(source)) {
  if (file.endsWith(".ts") && !file.endsWith(".test.ts")) {
    copyFileSync(join(source, file), join(target, file));
    console.log(`synced contracts/${file}`);
  }
}
