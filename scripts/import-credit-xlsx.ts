/**
 * PD-080b — imports an official price workbook ("Credit image" layout) as a NEW price version. LOCAL dev database only
 * (same guard as the seed scripts); the production database gets the same data through the same script run by the owner's
 * operator when asked.
 *
 *   npx tsx scripts/import-credit-xlsx.ts --file <workbook.xlsx> --config <private config.json>
 *       [--effective 2026-10-26] [--source <name>] [--version-name "Đơn giá 10/2026"] [--sheet "Credit image"]
 *       [--org <organization id>] [--apply]
 *
 * Without --apply it is a DRY RUN: it reads everything and prints COUNTS only (never prices, codes or rows): project
 * blocks matched, skipped rows, price rows, rows without credit / Khoán money / hours, unknown process names (the only
 * names printed — they are process names), processes to create, rules to end, rows to write / unchanged / conflicting.
 * --apply writes everything in ONE transaction (credit-workbook.ts applyCreditImport): creates the config's missing
 * processes, ends every rule in force on the effective day (all projects — those absent from the file get no new price),
 * writes the workbook's rows from that day with `source`, records the version (production.credit_versions). Older rows
 * stay (score entries reference them). Re-running with the same workbook changes nothing. Afterwards bump the production
 * config cache (new processes): production:config:ver:<org id> (docs/product/decisions.md PD-080).
 *
 * Layout: column B = a project code (a row with no price starts that project's block) or a process name with its prices
 * (H = hours per image, J = credit per image, K = Khoán money per image); --columns overrides "B,H,J,K"; row 1 = headers.
 * Empty J = no price; empty K = no Khoán money; empty H = hours not set (credit ÷ 11 is used).
 *
 * Config (kept OUT of the repository with the workbook — process names of the company):
 *   { "processAliases": { "<name in file, any case>": "<app process name>" },
 *     "newProcesses": [ { "name": "<app process name>", "isQc": true } ] }
 * `source` defaults to the file name without extension.
 */
import { readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

import ExcelJS from "exceljs";

import "dotenv/config";

import { closeDatabase, getSql } from "../src/db/client.js";
import {
  applyCreditImport,
  loadCreditRulesForImport,
  parseCreditSheet,
  planCreditImport,
  type CreditSheetRow,
  type CreditWorkbookConfig
} from "../src/modules/production/credit-workbook.js";
import { assertDevDatabase, isLoopbackUrl } from "./lib/dev-guard.js";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index]!;
  if (key.startsWith("--")) {
    args.set(key.slice(2), process.argv[index + 1] && !process.argv[index + 1]!.startsWith("--") ? process.argv[++index]! : "true");
  }
}
const file = args.get("file");
const configPath = args.get("config");
if (!file || !configPath) {
  console.error("Usage: npx tsx scripts/import-credit-xlsx.ts --file <workbook.xlsx> --config <config.json> [--effective YYYY-MM-DD] [--apply]");
  process.exit(1);
}
const apply = args.get("apply") === "true";
const effectiveFrom = args.get("effective") ?? "2026-10-26";
const source = args.get("source") ?? basename(file, extname(file));
const versionName = args.get("version-name") ?? null;
const sheetName = args.get("sheet") ?? "Credit image";
const [codeColumn, hoursColumn, creditColumn, moneyColumn] = (args.get("columns") ?? "B,H,J,K").split(",").map((column) => column.trim());
if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || !codeColumn || !hoursColumn || !creditColumn || !moneyColumn) {
  console.error("Bad --effective or --columns.");
  process.exit(1);
}
if (!isLoopbackUrl(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing to import: DATABASE_URL must point at the local stack.");
  process.exit(1);
}
await assertDevDatabase();

const config = JSON.parse(readFileSync(resolve(configPath), "utf8")) as CreditWorkbookConfig;

/** A cell as a number (formula results included); null when empty, text or an error. */
const numberOf = (cell: ExcelJS.Cell): number | null => {
  let value = cell.value as unknown;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const record = value as Record<string, unknown>;
    value = "formula" in record || "sharedFormula" in record ? record.result : undefined;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim().replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};
const textOf = (cell: ExcelJS.Cell): string => {
  const value = cell.value as unknown;
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && !(value instanceof Date)) {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.richText)) return (record.richText as { text: string }[]).map((part) => part.text).join("");
    if ("result" in record) return record.result === undefined || record.result === null ? "" : String(record.result as string | number);
    if ("text" in record) return String(record.text as string);
    return "";
  }
  return String(value as string | number);
};

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(resolve(file));
const sheet = workbook.getWorksheet(sheetName);
if (!sheet) {
  console.error(`Sheet "${sheetName}" not found.`);
  process.exit(1);
}
const rows: CreditSheetRow[] = [];
for (let line = 2; line <= sheet.rowCount; line += 1) {
  const row = sheet.getRow(line);
  rows.push({
    line,
    code: textOf(row.getCell(codeColumn)),
    hours: numberOf(row.getCell(hoursColumn)),
    credit: numberOf(row.getCell(creditColumn)),
    money: numberOf(row.getCell(moneyColumn))
  });
}

const sql = getSql();
try {
  const organizations = await sql<{ id: string }[]>`
    SELECT o.id FROM public.organizations o
    WHERE o.deleted_at IS NULL AND EXISTS (SELECT 1 FROM production.projects p WHERE p.organization_id = o.id)
  `;
  const organizationId = args.get("org") ?? (organizations.length === 1 ? organizations[0]!.id : null);
  if (!organizationId) {
    throw new Error(`${organizations.length} organizations have projects — pass --org <id>.`);
  }
  const [projects, processes] = await Promise.all([
    sql<{ id: string; code: string }[]>`SELECT id, code FROM production.projects WHERE organization_id = ${organizationId}`,
    sql<{ id: string; name: string; is_qc: boolean }[]>`SELECT id, name, is_qc FROM production.processes WHERE organization_id = ${organizationId}`
  ]);
  const parsed = parseCreditSheet(rows, { projects, processes: processes.map((row) => ({ id: row.id, name: row.name, isQc: row.is_qc })) }, config);
  const processIds = new Map<string, string | null>(processes.map((row) => [row.name.trim().toLowerCase(), row.id]));
  for (const created of parsed.processesToCreate) {
    processIds.set(created.name.toLowerCase(), null);
  }
  const plan = planCreditImport(parsed, await loadCreditRulesForImport(sql, organizationId), processIds, effectiveFrom, source);
  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        effectiveFrom,
        source,
        projectBlocksMatched: parsed.blocks,
        matchedOnLettersAndDigits: parsed.looseBlocks,
        unmatchedBlocks: parsed.unmatchedBlocks,
        skippedRows: parsed.skipped,
        priceRows: parsed.entries.length,
        rowsWithoutCredit: parsed.withoutCredit,
        rowsWithoutKhoanMoney: parsed.withoutMoney,
        rowsWithoutHours: parsed.withoutHours,
        problems: parsed.problems.length,
        unknownProcesses: parsed.unknownProcesses,
        processesToCreate: parsed.processesToCreate.map((process) => `${process.name}${process.isQc ? " (QC)" : ""}`),
        rulesToEnd: plan.toEnd.length,
        rowsToWrite: plan.toWrite.length,
        rowsUnchanged: plan.unchanged,
        conflictingRows: plan.conflicting
      },
      null,
      2
    )
  );
  if (parsed.unknownProcesses.length > 0 || parsed.problems.length > 0) {
    throw new Error("Unknown process names or problems in the workbook — nothing written.");
  }
  if (apply) {
    // The plan again inside the transaction (rules locked by their writes), then everything at once.
    const done = await sql.begin(async (tx) => {
      const fresh = planCreditImport(parsed, await loadCreditRulesForImport(tx, organizationId), processIds, effectiveFrom, source);
      return await applyCreditImport(tx, { organizationId, parsed, plan: fresh, effectiveFrom, source, versionName, userId: null });
    });
    console.log(JSON.stringify({ applied: done }, null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Import failed.");
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
