// Runs every live end-to-end suite against the LOCAL stack (API on 127.0.0.1:3890, seeded accounts).
//   cd BE && node tests/e2e/run.mjs [filter]
// Suites print "PASS <label>" / "FAIL <label>" lines; the runner exits non-zero on any failure.
// Each suite removes the data it creates; the runner also sweeps leftovers of crashed runs before and after.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dbNow, settleOutbox, sweepLeftovers } from "./cleanup.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(here, "..", "..");
const filter = process.argv[2] ?? "";
const suites = readdirSync(here)
  .filter((file) => file.endsWith(".e2e.mjs") && file.includes(filter))
  .sort();

const sweep = async (when) => {
  try {
    const swept = await sweepLeftovers();
    if (swept) console.log(`swept ${when}: ${swept}`);
  } catch (error) {
    console.log(`WARN sweep ${when} failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
};

let startedAt = null;
try {
  startedAt = dbNow();
} catch {
  // No local database: suites that need it report their own failure.
}
if (startedAt) await sweep("leftovers of earlier runs");

let failed = 0;
for (const suite of suites) {
  const result = spawnSync(process.execPath, [join(here, suite)], { cwd: backendRoot, encoding: "utf8", timeout: 180_000 });
  const output = `${result.stdout}${result.stderr}`;
  const passes = (output.match(/^PASS/gm) ?? []).length;
  const failures = output.split(/\r?\n/).filter((line) => line.startsWith("FAIL"));
  const crashed = result.status !== 0 && failures.length === 0;
  failed += failures.length + (crashed ? 1 : 0);
  console.log(`${failures.length === 0 && !crashed ? "ok  " : "FAIL"} ${suite.padEnd(28)} ${passes} passed${failures.length ? `, ${failures.length} failed` : ""}${crashed ? " (crashed)" : ""}`);
  for (const line of failures) {
    console.log(`     ${line}`);
  }
  if (crashed) {
    console.log(output.split(/\r?\n/).slice(-6).map((line) => `     ${line}`).join("\n"));
  }
}

// Late notifications of this run land after the suites' own cleanup at worst: sweep them once more.
if (startedAt) {
  await settleOutbox(startedAt);
  await sweep("late leftovers of this run");
}
process.exit(failed > 0 ? 1 : 0);
