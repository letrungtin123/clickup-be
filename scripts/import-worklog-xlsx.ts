/**
 * LOCAL DEVELOPMENT ONLY — imports the company's monthly work-log workbooks into the production module.
 *
 * Workbook layout (one file per month): the first sheet holds the log rows (Staff, Project, Format Job, Ngày nhận,
 * Ngày giao hàng, Ca làm việc, Volume, Error, Delivery, Credit, Credit Sum, Khoán, Amount, Team, Ghi chú) and, in
 * columns S:U, that month's credit table ("<project><process>", credit, money). Other sheets with the same header
 * are filtered copies of the first one (checked, never imported twice). The "Final" sheet carries the month's
 * official points, Khoán pay-out and the KPI target table ("Điểm", "% vs. chỉ tiêu"), used for targets and for
 * the reconciliation report.
 *
 *   npx tsx scripts/import-worklog-xlsx.ts --config <private config.json> [--phase catalog|history|all] [--dry-run]
 *
 * Phase "catalog": accounts (production roles, temporary passwords), projects, processes, one credit-rule version
 * per month in which a price changed, monthly KPI targets. Phase "history": every log row replayed through the real
 * workflow engine with its historical dates; Checking rows become the QC of tasks of the same project in the same
 * month, nearest day first (PD-010). Company data lives only in the config and the workbooks, never in this repo.
 * Temporary passwords of created accounts go to BE/.env.import-accounts (git-ignored) and are never printed.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import ExcelJS from "exceljs";

import "dotenv/config";

import { closeDatabase, getSql } from "../src/db/client.js";
import type { QuerySql } from "../src/lib/db-types.js";
import { closeRedis } from "../src/lib/redis.js";
import { type AccessContext, resolveAccessContext } from "../src/modules/access/access-context.js";
import { loadTask, loadWorkflowModel, type TaskRow } from "../src/modules/production/jobs.repo.js";
import { insertTasks, moveTask, moveTasks, settleJob } from "../src/modules/production/tasks.service.js";
import { settleMonth } from "../src/modules/production/kpi-settlement.service.js";
import { createProductionUser } from "../src/modules/production/users-admin.service.js";
import { statusByCode, type Workflow } from "../src/modules/production/workflow.js";
import { assertDevDatabase, isLoopbackUrl } from "./lib/dev-guard.js";

// Arguments & safety -------------------------------------------------------------------------------------------

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index]!;
  if (key.startsWith("--")) {
    args.set(key.slice(2), process.argv[index + 1] && !process.argv[index + 1]!.startsWith("--") ? process.argv[++index]! : "true");
  }
}
const configPath = args.get("config");
const phase = args.get("phase") ?? "all";
const dryRun = args.get("dry-run") === "true";
if (!configPath || !["catalog", "history", "settle", "all"].includes(phase)) {
  console.error("Usage: npx tsx scripts/import-worklog-xlsx.ts --config <file.json> [--phase catalog|history|settle|all] [--dry-run]");
  process.exit(1);
}
if (!isLoopbackUrl(process.env.DATABASE_URL ?? "") || !isLoopbackUrl(process.env.SUPABASE_URL ?? "")) {
  console.error("Refusing to import: SUPABASE_URL and DATABASE_URL must point at the local stack.");
  process.exit(1);
}
await assertDevDatabase();

type Config = {
  emailDomain: string;
  workbooks: string[];
  staffAliases?: Record<string, string>;
  freelancerSuffix?: string;
  leaders?: string[];
  processAliases?: Record<string, string>;
  projectAliases?: Record<string, string>;
  extraProcessNames?: string[];
  emailOverrides?: Record<string, string>;
  creditTableColumns?: [number, number, number];
  kpiDefaultMember?: number;
  kpiDefaultLeader?: number;
};
const config = JSON.parse(readFileSync(resolve(configPath), "utf8")) as Config;
const passwordFile = new URL("../.env.import-accounts", import.meta.url);

// Text helpers ---------------------------------------------------------------------------------------------------

const squash = (value: string) => value.replace(/\s+/g, " ").trim();
const fold = (value: string) => squash(value).toLowerCase();
const slug = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const round2 = (value: number) => Math.round(value * 100) / 100;
const vn = (day: string, time: string) => new Date(`${day}T${time}:00+07:00`);
const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000);
const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
const monthStart = (month: string) => `${month}-01`;

const staffName = (raw: string) => {
  const name = squash(raw);
  return config.staffAliases?.[name] ?? name;
};
const processAlias = (raw: string) => config.processAliases?.[fold(raw)] ?? squash(raw);
const projectAlias = (raw: string) => config.projectAliases?.[squash(raw)] ?? squash(raw);
const isQcName = (name: string) => fold(name).startsWith("checking");
const isPlainQc = (name: string) => fold(name) === "checking";

// Workbook reading -------------------------------------------------------------------------------------------------

const cellValue = (cell: ExcelJS.Cell): unknown => {
  const value = cell.value as unknown;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const record = value as Record<string, unknown>;
    if ("formula" in record || "sharedFormula" in record) {
      const result = record.result;
      return result && typeof result === "object" && !(result instanceof Date) ? undefined : result;
    }
    if (Array.isArray(record.richText)) return (record.richText as { text: string }[]).map((part) => part.text).join("");
    if ("text" in record) return record.text;
    if ("error" in record) return undefined;
  }
  return value;
};
const asText = (value: unknown) => (value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value));
const asNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const asDay = (value: unknown) => (value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString().slice(0, 10) : null);

type LogRow = {
  source: string;
  line: number;
  month: string;
  staff: string;
  project: string;
  process: string;
  received: string | null;
  delivered: string | null;
  rawDelivered: string;
  shift: string;
  volume: number | null;
  credit: number | null;
  creditSum: number | null;
  amount: number | null;
};
type TableEntry = { key: string; credit: number | null; money: number | null; line: number };
type FinalSheet = {
  official: Map<string, number>;
  targets: Map<string, number>;
  khoan: Map<string, { delivery: number; amount: number }>;
};
type MonthBook = { file: string; month: string; rows: LogRow[]; table: TableEntry[]; final: FinalSheet | null; notes: string[] };

const LOG_HEADERS = ["Staff", "Project", "Format Job", "Ngày nhận", "Ngày giao hàng", "Ca làm việc", "Volume", "Credit", "Credit Sum", "Amount"];

const headerIndex = (sheet: ExcelJS.Worksheet) => {
  const index = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, column) => index.set(squash(asText(cellValue(cell))), column));
  return LOG_HEADERS.every((name) => index.has(name)) ? index : null;
};

const readLogRows = (sheet: ExcelJS.Worksheet, columns: Map<string, number>, source: string) => {
  const rows: Omit<LogRow, "month">[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, line) => {
    if (line === 1) return;
    const get = (name: string) => cellValue(row.getCell(columns.get(name)!));
    const staff = squash(asText(get("Staff")));
    if (!staff) return;
    rows.push({
      source,
      line,
      staff: staffName(staff),
      project: projectAlias(asText(get("Project"))),
      process: processAlias(asText(get("Format Job"))),
      received: asDay(get("Ngày nhận")),
      delivered: asDay(get("Ngày giao hàng")),
      rawDelivered: asText(get("Ngày giao hàng")),
      shift: squash(asText(get("Ca làm việc"))),
      volume: asNumber(get("Volume")),
      credit: asNumber(get("Credit")),
      creditSum: asNumber(get("Credit Sum")),
      amount: asNumber(get("Amount"))
    });
  });
  return rows;
};

const readFinal = (sheet: ExcelJS.Worksheet, knownStaff: Set<string>): FinalSheet => {
  const official = new Map<string, number>();
  const targets = new Map<string, number>();
  const khoan = new Map<string, { delivery: number; amount: number }>();
  let bonus: { name: number; points: number; percent: number } | null = null;
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = new Map<number, unknown>();
    row.eachCell((cell, column) => values.set(column, cellValue(cell)));
    const find = (label: string) => [...values].find(([, value]) => typeof value === "string" && squash(value) === label)?.[0];
    const percentColumn = find("% vs. chỉ tiêu");
    if (percentColumn !== undefined) {
      bonus = { name: find("Team") ?? 7, points: find("Điểm") ?? percentColumn - 1, percent: percentColumn };
      return;
    }
    if (bonus) {
      const name = typeof values.get(bonus.name) === "string" ? staffName(values.get(bonus.name) as string) : null;
      const points = asNumber(values.get(bonus.points));
      const percent = asNumber(values.get(bonus.percent));
      // Anyone listed (also people without log rows that month); the first line is the company total.
      if (name && name.includes(" ") && points !== null && percent) targets.set(name, Math.round(points / percent));
      return;
    }
    const label = typeof values.get(1) === "string" ? staffName(values.get(1) as string) : null;
    const points = asNumber(values.get(2));
    if (label && knownStaff.has(label) && points !== null) official.set(label, points);
    const khoanName = typeof values.get(9) === "string" ? staffName(values.get(9) as string) : null;
    const delivery = asNumber(values.get(10));
    const amount = asNumber(values.get(12));
    if (khoanName && knownStaff.has(khoanName) && delivery !== null && amount !== null) khoan.set(khoanName, { delivery, amount });
  });
  return { official, targets, khoan };
};

const readWorkbook = async (file: string): Promise<MonthBook> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const name = file.split(/[\\/]/).pop()!;
  const notes: string[] = [];
  const logSheets = workbook.worksheets.map((sheet) => ({ sheet, columns: headerIndex(sheet) })).filter((item) => item.columns);
  if (logSheets.length === 0) throw new Error(`${name}: no sheet with the work-log header`);
  const [main, ...copies] = logSheets;
  const rows = readLogRows(main!.sheet, main!.columns!, `${name}#${main!.sheet.name}`);
  const months = new Map<string, number>();
  for (const row of rows) if (row.delivered) months.set(row.delivered.slice(0, 7), (months.get(row.delivered.slice(0, 7)) ?? 0) + 1);
  const month = [...months].sort((a, b) => b[1] - a[1])[0]![0];

  // Filtered copies (per-person sheets, pivot drill-downs) must not add rows: verify they are subsets.
  const signature = (row: Omit<LogRow, "month">) => [row.staff, fold(row.project), fold(row.process), row.received, row.delivered, row.shift, row.volume].join("|");
  const available = new Map<string, number>();
  for (const row of rows) available.set(signature(row), (available.get(signature(row)) ?? 0) + 1);
  for (const copy of copies) {
    const copyRows = readLogRows(copy.sheet, copy.columns!, `${name}#${copy.sheet.name}`);
    const pool = new Map(available);
    const missing = copyRows.filter((row) => {
      const count = pool.get(signature(row)) ?? 0;
      pool.set(signature(row), count - 1);
      return count <= 0;
    });
    notes.push(`sheet "${copy.sheet.name}": ${copyRows.length} rows, ${missing.length === 0 ? "all present in the main sheet (not imported again)" : `${missing.length} NOT in the main sheet`}`);
  }

  const [keyColumn, creditColumn, moneyColumn] = config.creditTableColumns ?? [19, 20, 21];
  const table: TableEntry[] = [];
  main!.sheet.eachRow({ includeEmpty: false }, (row, line) => {
    const key = squash(asText(cellValue(row.getCell(keyColumn))));
    if (!key) return;
    const money = asNumber(cellValue(row.getCell(moneyColumn)));
    table.push({ key, credit: asNumber(cellValue(row.getCell(creditColumn))), money: money && money > 0 ? money : null, line });
  });

  const knownStaff = new Set(rows.map((row) => row.staff));
  const finalSheet = workbook.worksheets.find((sheet) => fold(sheet.name) === "final");
  return { file: name, month, rows: rows.map((row) => ({ ...row, month })), table, final: finalSheet ? readFinal(finalSheet, knownStaff) : null, notes };
};

// Catalog model -----------------------------------------------------------------------------------------------------

type Spelling = { text: string; month: string; fromRows: boolean };
/** Processes prefer "Title Case", project codes ALL CAPS when such a spelling exists; then the latest month, rows first. */
const pickSpelling = (spellings: Spelling[], kind: "process" | "project") => {
  const score = new Map<string, number>();
  for (const item of spellings) {
    const preferred = kind === "process" ? item.text.split(" ").every((word) => !/^[a-z]/.test(word)) : item.text === item.text.toUpperCase();
    const capitalized = preferred ? 1e9 : 0;
    const value = capitalized + Number(item.month.replace("-", "")) * 10 + (item.fromRows ? 5 : 0);
    score.set(item.text, Math.max(score.get(item.text) ?? 0, value) + 1);
  }
  return [...score].sort((a, b) => b[1] - a[1])[0]![0];
};

type Model = {
  books: MonthBook[];
  projects: Map<string, string>; // folded key -> canonical code
  processes: Map<string, string>; // folded key -> canonical name
  tables: Map<string, Map<string, { credit: number; money: number | null }>>; // month -> "project|process" (folded) -> price
  skippedTableEntries: string[];
  staff: Map<string, { qcRows: number; workRows: number; freelancer: boolean }>;
};

const buildModel = (books: MonthBook[], dbProcesses: string[]): Model => {
  const projectSpellings = new Map<string, Spelling[]>();
  const processSpellings = new Map<string, Spelling[]>();
  const note = (map: Map<string, Spelling[]>, text: string, month: string, fromRows: boolean) => {
    const key = fold(text);
    map.set(key, [...(map.get(key) ?? []), { text: squash(text), month, fromRows }]);
  };
  for (const book of books) {
    for (const row of book.rows) {
      note(projectSpellings, row.project, book.month, true);
      if (!isQcName(row.process) || isPlainQc(row.process)) note(processSpellings, row.process, book.month, true);
    }
  }
  // Table keys are "<project><process>" without a separator: split on the longest known process name.
  const vocabulary = [
    ...new Set([...processSpellings.keys(), ...dbProcesses.map(fold), ...(config.extraProcessNames ?? []).map(fold), ...Object.keys(config.processAliases ?? {})])
  ].sort((a, b) => b.length - a.length);
  const skippedTableEntries: string[] = [];
  const tables = new Map<string, Map<string, { credit: number; money: number | null }>>();
  for (const book of books) {
    const table = new Map<string, { credit: number; money: number | null }>();
    for (const entry of book.table) {
      const folded = fold(entry.key);
      const process = vocabulary.find((name) => folded.endsWith(name) && folded.length > name.length);
      if (!process) {
        skippedTableEntries.push(`${book.month} "${entry.key}": cannot split into project + process`);
        continue;
      }
      const projectText = projectAlias(squash(entry.key).slice(0, squash(entry.key).length - process.length));
      const processText = processAlias(squash(entry.key).slice(squash(entry.key).length - process.length));
      if (isQcName(processText) && !isPlainQc(processText)) {
        skippedTableEntries.push(`${book.month} "${entry.key}": QC variant (the app has one QC rate per project)`);
        continue;
      }
      if (entry.credit === null) {
        skippedTableEntries.push(`${book.month} "${entry.key}": no credit value`);
        continue;
      }
      note(projectSpellings, projectText, book.month, false);
      note(processSpellings, processText, book.month, false);
      const key = `${fold(projectText)}|${fold(processText)}`;
      if (!table.has(key)) table.set(key, { credit: entry.credit, money: entry.money }); // VLOOKUP: first match wins
    }
    tables.set(book.month, table);
  }
  const projects = new Map([...projectSpellings].map(([key, spellings]) => [key, pickSpelling(spellings, "project")]));
  const dbByKey = new Map(dbProcesses.map((name) => [fold(name), name]));
  const processes = new Map(
    [...processSpellings].map(([key, spellings]) => [key, dbByKey.get(key) ?? pickSpelling(spellings, "process")])
  );
  const staff = new Map<string, { qcRows: number; workRows: number; freelancer: boolean }>();
  for (const row of books.flatMap((book) => book.rows)) {
    const item = staff.get(row.staff) ?? { qcRows: 0, workRows: 0, freelancer: isFreelancer(row.staff) };
    if (isQcName(row.process)) item.qcRows += 1;
    else item.workRows += 1;
    staff.set(row.staff, item);
  }
  return { books, projects, processes, tables, skippedTableEntries, staff };
};

const isFreelancer = (name: string) => {
  const suffix = config.freelancerSuffix ?? "FL";
  const words = name.split(" ");
  return words.length > 1 && (words.at(-1) === suffix || words[0] === suffix);
};
const accountOf = (name: string) => {
  const suffix = config.freelancerSuffix ?? "FL";
  const words = name.split(" ");
  if (isFreelancer(name)) {
    const given = words.filter((word) => word !== suffix).join(" ");
    return { displayName: `${given} ${suffix}`, local: `${slug(given)}.${slug(suffix)}`, jobTitle: "Freelancer" };
  }
  return { displayName: name, local: `${slug(words.at(-1)!)}.${slug(words[0]!)}`, jobTitle: null };
};

// Catalog phase -------------------------------------------------------------------------------------------------------

const loadPasswords = () => {
  const emails = new Set<string>();
  if (existsSync(passwordFile)) {
    for (const line of readFileSync(passwordFile, "utf8").split(/\r?\n/)) {
      const match = /^IMPORT_[A-Z0-9_]+_EMAIL=(.+)$/.exec(line.trim());
      if (match?.[1]) emails.add(match[1]);
    }
  } else {
    writeFileSync(passwordFile, "# Imported accounts (git-ignored): temporary passwords from scripts/import-worklog-xlsx.ts\n");
  }
  return emails;
};

const importCatalog = async (sql: QuerySql, organizationId: string, admin: AccessContext, model: Model) => {
  const leaders = new Set((config.leaders ?? []).map(staffName));
  const usedLocals = new Set<string>();
  const saved = dryRun ? new Set<string>() : loadPasswords();
  const accounts = new Map<string, string>(); // staff name -> user id
  console.log("\nAccounts:");
  for (const [name, info] of [...model.staff].sort((a, b) => a[0].localeCompare(b[0], "vi"))) {
    const account = accountOf(name);
    let local = account.local;
    for (let suffix = 2; usedLocals.has(local); suffix += 1) local = `${account.local}${suffix}`;
    usedLocals.add(local);
    const email = config.emailOverrides?.[name] ?? `${local}@${config.emailDomain}`;
    const roles = leaders.has(name) ? ["LEADER", "QC"] : info.qcRows > 0 ? ["STAFF", "QC"] : ["STAFF"];
    console.log(`  ${account.displayName.padEnd(26)} ${email.padEnd(32)} ${roles.join("+").padEnd(10)} work ${info.workRows}, checking ${info.qcRows}`);
    if (dryRun) continue;
    const existing = (await sql<{ id: string }[]>`SELECT id FROM auth.users WHERE lower(email) = ${email.toLowerCase()}`)[0];
    if (existing) {
      accounts.set(name, existing.id);
      continue;
    }
    const created = await createProductionUser(admin, {
      email,
      displayName: account.displayName,
      jobTitle: leaders.has(name) ? "Leader" : account.jobTitle,
      roles: roles as ("STAFF" | "QC" | "LEADER")[],
      allowGoogleSignIn: true
    });
    accounts.set(name, created.member.userId);
    if (!saved.has(email)) {
      const key = local.toUpperCase().replace(/[^A-Z0-9]/g, "_");
      appendFileSync(passwordFile, `IMPORT_${key}_EMAIL=${email}\nIMPORT_${key}_PASSWORD=${created.temporaryPassword}\n`);
    }
  }
  if (dryRun) return;
  const adminId = admin.user.id;

  // Processes: rename aliased defaults (e.g. "Colour Correction" → "Color Correction"), add the missing ones.
  for (const [source, target] of Object.entries(config.processAliases ?? {})) {
    await sql`
      UPDATE production.processes SET name = ${target}, updated_at = now()
      WHERE organization_id = ${organizationId} AND lower(name) = ${source}
        AND NOT EXISTS (SELECT 1 FROM production.processes WHERE organization_id = ${organizationId} AND lower(name) = ${target.toLowerCase()})
    `;
  }
  let sortOrder = (await sql<{ max: number }[]>`SELECT coalesce(max(sort_order), 0)::int AS max FROM production.processes WHERE organization_id = ${organizationId} AND NOT is_qc`)[0]!.max;
  for (const name of new Set(model.processes.values())) {
    if (isPlainQc(name)) continue;
    const inserted = await sql`
      INSERT INTO production.processes (organization_id, name, is_qc, sort_order)
      SELECT ${organizationId}, ${name}, false, ${sortOrder + 1}
      WHERE NOT EXISTS (SELECT 1 FROM production.processes WHERE organization_id = ${organizationId} AND lower(name) = ${name.toLowerCase()})
    `;
    if (inserted.count > 0) sortOrder += 1;
  }
  const processIds = new Map(
    (await sql<{ id: string; name: string }[]>`SELECT id, name FROM production.processes WHERE organization_id = ${organizationId}`).map((row) => [fold(row.name), row.id])
  );

  // KPI defaults follow the latest target table (staff / leader); explicit monthly targets come below.
  for (const [key, value] of [["kpi_default_member", config.kpiDefaultMember], ["kpi_default_leader", config.kpiDefaultLeader]] as const) {
    if (value !== undefined) {
      await sql`UPDATE production.settings SET value = ${sql.json(value)}, updated_by = ${adminId}, updated_at = now() WHERE organization_id = ${organizationId} AND key = ${key}`;
    }
  }

  // Projects: one per code (codes gone from the latest table are set inactive at the end).
  for (const [key, code] of model.projects) {
    await sql`
      INSERT INTO production.projects (organization_id, code, name, active)
      SELECT ${organizationId}, ${code}, ${code}, true
      WHERE NOT EXISTS (SELECT 1 FROM production.projects WHERE organization_id = ${organizationId} AND lower(code) = ${key})
    `;
  }
  const projectIds = new Map(
    (await sql<{ id: string; code: string }[]>`SELECT id, code FROM production.projects WHERE organization_id = ${organizationId}`).map((row) => [fold(row.code), row.id])
  );

  // Credit rules: the first month opens every price; later months add a version only where the price changed.
  const existingRules = (await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM production.credit_rules WHERE organization_id = ${organizationId}`)[0]!.count;
  if (existingRules > 0) {
    console.log(`\nCredit rules: ${existingRules} already present — not re-imported.`);
  } else {
    const open = new Map<string, { credit: number; money: number | null; from: string }>();
    let versions = 0;
    let closed = 0;
    const insertRule = async (key: string, price: { credit: number; money: number | null }, from: string, to: string | null) => {
      const [project, process] = key.split("|") as [string, string];
      await sql`
        INSERT INTO production.credit_rules (organization_id, project_id, process_id, credit_per_image, money_per_image, effective_from, effective_to, created_by)
        VALUES (${organizationId}, ${projectIds.get(project)!}, ${processIds.get(fold(model.processes.get(process)!))!}, ${price.credit}, ${price.money},
          ${from}::date, ${to}::date, ${adminId})
      `;
    };
    for (const book of model.books) {
      const table = model.tables.get(book.month)!;
      const from = monthStart(book.month);
      for (const [key, current] of [...open]) {
        const next = table.get(key);
        if (!next || next.credit !== current.credit || next.money !== current.money) {
          await insertRule(key, current, current.from, from);
          open.delete(key);
          if (!next) closed += 1;
        }
      }
      for (const [key, price] of table) {
        if (!open.has(key)) {
          open.set(key, { ...price, from });
          versions += 1;
        }
      }
    }
    for (const [key, price] of open) await insertRule(key, price, price.from, null);
    console.log(`\nCredit rules: ${versions} price versions (${open.size} current, ${closed} ended when dropped from a later table).`);
  }

  // KPI targets from the "Final" sheets: a new version whenever a person's monthly target changes; a person who
  // drops out of the target table (Khoán-only, left) gets target 0 from that month.
  const nameToId = accounts;
  let targetRows = 0;
  const previous = new Map<string, number>();
  for (const book of model.books) {
    if (!book.final) continue;
    for (const name of new Set([...book.final.targets.keys(), ...previous.keys()])) {
      const target = book.final.targets.get(name) ?? 0;
      if (previous.get(name) === target || (!previous.has(name) && target === 0)) continue;
      previous.set(name, target);
      const userId = nameToId.get(name);
      if (!userId) continue;
      await sql`
        INSERT INTO production.kpi_targets (organization_id, user_id, period_type, target_points, effective_from, note, created_by, updated_by)
        VALUES (${organizationId}, ${userId}, 'MONTH', ${target}, ${monthStart(book.month)}::date,
          ${target === 0 ? `Không có trong bảng chỉ tiêu tháng ${book.month}` : `Theo bảng chỉ tiêu tháng ${book.month}`}, ${adminId}, ${adminId})
        ON CONFLICT (organization_id, user_id, period_type, effective_from) DO UPDATE SET target_points = EXCLUDED.target_points, note = EXCLUDED.note
      `;
      targetRows += 1;
    }
  }
  console.log(`KPI targets: ${targetRows} monthly target versions.`);

  // Codes gone from the latest month's table and logs are kept (history, old prices) but inactive.
  const latest = model.books.at(-1)!;
  const active = new Set([...model.tables.get(latest.month)!.keys()].map((key) => key.split("|")[0]!).concat(latest.rows.map((row) => fold(row.project))));
  const inactive = [...model.projects.keys()].filter((key) => !active.has(key));
  if (inactive.length > 0) {
    await sql`UPDATE production.projects SET active = false, updated_at = now() WHERE organization_id = ${organizationId} AND lower(code) = ANY(${inactive}::text[])`;
    console.log(`Projects set inactive (not in the ${latest.month} table): ${inactive.map((key) => model.projects.get(key)).join(", ")}`);
  }
};

// History phase ---------------------------------------------------------------------------------------------------------

type WorkItem = { row: LogRow; day: string; assignedDay: string; qc: string | null; qcDay: string | null };

const replayHistory = async (sql: ReturnType<typeof getSql>, organizationId: string, admin: AccessContext, model: Model) => {
  const existingJobs = (await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM production.jobs WHERE organization_id = ${organizationId}`)[0]!.count;
  if (existingJobs > 0 && !dryRun) {
    throw new Error(`${existingJobs} production jobs already exist — the history import runs on an empty production module only.`);
  }
  const users = new Map<string, string>();
  for (const name of model.staff.keys()) {
    const account = accountOf(name);
    const id = (await sql<{ id: string }[]>`SELECT id FROM public.app_users WHERE display_name = ${account.displayName} AND deleted_at IS NULL`)[0]?.id;
    if (id) users.set(name, id);
    else if (!dryRun) throw new Error(`No account for ${account.displayName} — run the catalog phase first.`);
  }
  const projectIds = new Map((await sql<{ id: string; code: string }[]>`SELECT id, code FROM production.projects WHERE organization_id = ${organizationId}`).map((row) => [fold(row.code), row.id]));
  const processes = new Map((await sql<{ id: string; name: string }[]>`SELECT id, name FROM production.processes WHERE organization_id = ${organizationId}`).map((row) => [fold(row.name), row.id]));
  const shifts = new Map((await sql<{ id: string; name: string }[]>`SELECT id, name FROM production.shifts WHERE organization_id = ${organizationId} AND active`).map((row) => [fold(row.name), row.id]));
  const leaders = (config.leaders ?? []).map(staffName).filter((name) => model.staff.has(name));

  // Rows → work items and checks; skip what cannot be replayed.
  const skipped: string[] = [];
  const work: WorkItem[] = [];
  const checks: { row: LogRow; day: string; remaining: number }[] = [];
  for (const row of model.books.flatMap((book) => book.rows)) {
    if (row.volume === null || row.volume <= 0) {
      skipped.push(`${row.source} line ${row.line}: no volume`);
      continue;
    }
    const day = row.delivered ?? row.received;
    if (!day) {
      skipped.push(`${row.source} line ${row.line}: no date`);
      continue;
    }
    if (!row.delivered) skipped.push(`${row.source} line ${row.line}: delivery date "${row.rawDelivered}" unreadable → used the received date ${day} (row kept)`);
    if (!shifts.has(fold(row.shift))) throw new Error(`${row.source} line ${row.line}: unknown shift "${row.shift}"`);
    if (isQcName(row.process)) {
      checks.push({ row, day, remaining: row.volume });
      continue;
    }
    const assignedDay = row.received && row.received <= day ? row.received : day;
    work.push({ row, day, assignedDay, qc: null, qcDay: null });
  }

  // QC allocation (PD-010): each Checking row covers tasks of the same project in the same month, other people's
  // work only, nearest day first, largest tasks that still fit first, then the one task that best fills the rest.
  for (let distance = 0; distance <= 31; distance += 1) {
    for (const check of [...checks].sort((a, b) => a.day.localeCompare(b.day) || b.row.volume! - a.row.volume!)) {
      if (check.remaining <= 0) continue;
      const candidates = work
        .filter(
          (item) =>
            !item.qc &&
            item.row.month === check.row.month &&
            fold(item.row.project) === fold(check.row.project) &&
            item.row.staff !== check.row.staff &&
            Math.abs(dayNumber(item.day) - dayNumber(check.day)) === distance
        )
        .sort((a, b) => b.row.volume! - a.row.volume!);
      for (const item of candidates) {
        if (item.row.volume! <= check.remaining) {
          item.qc = check.row.staff;
          item.qcDay = check.day;
          check.remaining -= item.row.volume!;
        }
      }
      if (check.remaining > 0) {
        const pick = candidates.filter((item) => !item.qc).sort((a, b) => a.row.volume! - b.row.volume!).find((item) => item.row.volume! - check.remaining < check.remaining);
        if (pick) {
          pick.qc = check.row.staff;
          pick.qcDay = check.day;
          check.remaining -= pick.row.volume!;
        }
      }
    }
  }
  const qcWanted = checks.reduce((sum, check) => sum + check.row.volume!, 0);
  const qcUnmatched = checks.reduce((sum, check) => sum + Math.max(0, check.remaining), 0);
  console.log(`\nHistory: ${work.length} tasks, ${checks.length} Checking rows (${qcWanted} images; ${qcUnmatched} could not be matched to a task).`);
  console.log(`  ${work.filter((item) => !item.qc).length} tasks have no Checking row (delivered without a QC entry).`);
  for (const line of skipped) console.log(`  note: ${line}`);
  if (dryRun) return;

  // Jobs: (project, delivery day). Leader: the leader who checked most of the job, else who checked most of that
  // project that month / overall; never one who would QC-less self-assign (PD rule "Leader tự giao cho mình").
  const qcVolume = new Map<string, number>();
  for (const check of checks) {
    for (const key of [`${check.row.staff}|${fold(check.row.project)}|${check.row.month}`, `${check.row.staff}|${fold(check.row.project)}`]) {
      qcVolume.set(key, (qcVolume.get(key) ?? 0) + check.row.volume!);
    }
  }
  const jobs = new Map<string, WorkItem[]>();
  for (const item of work) {
    const key = `${fold(item.row.project)}|${item.day}`;
    jobs.set(key, [...(jobs.get(key) ?? []), item]);
  }
  const contexts = new Map<string, AccessContext>();
  const contextOf = async (userId: string) => contexts.get(userId) ?? contexts.set(userId, await resolveAccessContext(userId)).get(userId)!;
  const workflow: Workflow = await loadWorkflowModel(sql, organizationId);
  const status = (code: Parameters<typeof statusByCode>[1]) => statusByCode(workflow, code);
  let forcedQc = 0;
  let done = 0;
  const started = Date.now();
  const ordered = [...jobs].sort(([a], [b]) => a.split("|")[1]!.localeCompare(b.split("|")[1]!) || a.localeCompare(b));
  for (const [key, items] of ordered) {
    const [projectKey, day] = key.split("|") as [string, string];
    const month = items[0]!.row.month;
    const rank = (leader: string) =>
      items.filter((item) => item.qc === leader).length * 1e9 +
      (qcVolume.get(`${leader}|${projectKey}|${month}`) ?? 0) * 1e3 +
      (qcVolume.get(`${leader}|${projectKey}`) ?? 0) / 1e3;
    const ranked = [...leaders].sort((a, b) => rank(b) - rank(a));
    const leaderName = ranked.find((leader) => !items.some((item) => item.row.staff === leader && !item.qc)) ?? ranked[0]!;
    for (const item of items) {
      if (item.row.staff === leaderName && !item.qc) {
        // A leader's own work in a job they lead needs another QC (app rule): the other leader checks it.
        item.qc = leaders.find((leader) => leader !== leaderName) ?? null;
        item.qcDay = item.day;
        forcedQc += 1;
      }
    }
    const leaderId = users.get(leaderName)!;
    const leaderContext = await contextOf(leaderId);
    const total = items.reduce((sum, item) => sum + item.row.volume!, 0);
    const deadline = vn(day, "18:00");
    const created = items.reduce((min, item) => (item.assignedDay < min ? item.assignedDay : min), day);

    await sql.begin(async (tx) => {
      const job = (
        await tx<{ id: string }[]>`
          INSERT INTO production.jobs (organization_id, project_id, code, leader_id, deadline, total_images, created_by, created_at)
          VALUES (${organizationId}, ${projectIds.get(projectKey)!}, ${`${model.projects.get(projectKey)!} ${day.replaceAll("-", "")}`}, ${leaderId},
            ${deadline}, ${total}, ${admin.user.id}, ${vn(created, "08:00")})
          RETURNING id
        `
      )[0]!;
      const jobForTasks = { id: job.id, leader_id: leaderId, deadline, total_images: total, qc_buffer_hours: 0 };
      const tasks: { task: TaskRow; item: WorkItem }[] = [];
      for (const assignedDay of [...new Set(items.map((item) => item.assignedDay))].sort()) {
        const batch = items.filter((item) => item.assignedDay === assignedDay);
        const { ids } = await insertTasks(
          tx,
          leaderContext,
          workflow,
          jobForTasks,
          batch.map((item) => ({
            assigneeId: users.get(item.row.staff)!,
            qcId: item.qc ? users.get(item.qc)! : null,
            processId: processes.get(fold(model.processes.get(fold(item.row.process))!))!,
            shiftId: shifts.get(fold(item.row.shift))!,
            qtyAssigned: item.row.volume!,
            deadline: deadline.toISOString()
          })),
          // History may lack a QC (PD-047 requires QC on new lines; importers replay old rows).
          { kind: "NORMAL", feedbackId: null, defaultParentId: null, assignedAt: vn(assignedDay, "09:00"), historicQcOptional: true }
        );
        for (const [index, id] of ids.entries()) tasks.push({ task: await loadTask(tx, organizationId, id), item: batch[index]! });
      }
      let lastEvent = vn(day, "17:00");
      const finished: TaskRow[] = [];
      for (const { item, task: inserted } of tasks) {
        const assignee = users.get(item.row.staff)!;
        const doneAt = vn(item.day, "17:00");
        const startAt = new Date(Math.min(vn(item.assignedDay, "09:30").getTime(), addMinutes(doneAt, -30).getTime()));
        const otHours = fold(item.row.shift) === "ot" ? Math.min(24, Math.max(0.1, Math.round(((item.row.volume! * (item.row.credit ?? 0)) / 11) * 10) / 10)) : undefined;
        let task = await moveTask(tx, organizationId, workflow, inserted, status("PROCESSING"), assignee, null, { at: startAt });
        task = await moveTask(tx, organizationId, workflow, task, status("DONE"), assignee, null, { qtyDone: item.row.volume!, otHours, at: doneAt });
        if (item.qc) {
          const checkedAt = new Date(Math.max(vn(item.qcDay ?? item.day, "17:30").getTime(), addMinutes(doneAt, 30).getTime()));
          task = await moveTask(tx, organizationId, workflow, task, status("WAITING_QC"), null, "Tự động chuyển sang chờ QC.", { at: addMinutes(doneAt, 1) });
          task = await moveTask(tx, organizationId, workflow, task, status("CHECKED"), users.get(item.qc)!, null, { at: checkedAt });
          if (checkedAt > lastEvent) lastEvent = checkedAt;
        }
        finished.push(task);
      }
      const completeAt = new Date(Math.max(vn(day, "18:00").getTime(), addMinutes(lastEvent, 10).getTime()));
      let moved = await moveTasks(tx, organizationId, workflow, finished, status("COMPLETE"), leaderId, null, { at: completeAt });
      moved = await moveTasks(tx, organizationId, workflow, moved, status("DELIVERING"), admin.user.id, null, { at: addMinutes(completeAt, 5) });
      await moveTasks(tx, organizationId, workflow, moved, status("DELIVERED"), admin.user.id, "Nhập từ work log Excel.", { at: addMinutes(completeAt, 10) });
      await settleJob(tx, organizationId, workflow, job.id);
      // Historical replay must not flood inboxes: drop the events this transaction queued.
      await tx`DELETE FROM public.outbox_events WHERE created_at = now() AND published_at IS NULL`;
    });
    done += 1;
    if (done % 100 === 0) console.log(`  ${done}/${ordered.length} jobs (${Math.round((Date.now() - started) / 1000)}s)`);
  }
  console.log(`  ${ordered.length} jobs replayed; ${forcedQc} leader-own tasks checked by the other leader.`);
};

// Settlement ---------------------------------------------------------------------------------------------------------------

/** Settles every imported month with the current settings (close day, Khoán policy); the KPI_SETTLED notifications are dropped. */
const settleImportedMonths = async (sql: ReturnType<typeof getSql>, organizationId: string, admin: AccessContext, model: Model) => {
  for (const book of model.books) {
    const result = await sql.begin(async (tx) => {
      const settled = await settleMonth(tx, organizationId, book.month, { trigger: "MANUAL", runBy: admin.user.id, reason: "Chốt KPI lịch sử khi nhập work log Excel" });
      await tx`DELETE FROM public.outbox_events WHERE created_at = now() AND published_at IS NULL`;
      return settled;
    });
    const met = result.items.filter((item) => item.met).length;
    console.log(`  ${book.month}: ${result.items.length} people, ${met} met KPI, Khoán money ${result.items.reduce((sum, item) => sum + item.khoanMoney, 0).toLocaleString("vi-VN")}`);
  }
};

// Reconciliation ------------------------------------------------------------------------------------------------------------

const reconcile = async (sql: QuerySql, organizationId: string, model: Model) => {
  const users = new Map<string, string>();
  for (const name of model.staff.keys()) {
    const id = (await sql<{ id: string }[]>`SELECT id FROM public.app_users WHERE display_name = ${accountOf(name).displayName} AND deleted_at IS NULL`)[0]?.id;
    if (id) users.set(id, name);
  }
  const ledger = await sql<{ user_id: string; month: string; role: string; pay_mode: string; credits: string; money: string }[]>`
    SELECT user_id, to_char(business_day, 'YYYY-MM') AS month, role, pay_mode, sum(credits)::text AS credits, sum(coalesce(money, 0))::text AS money
    FROM production.score_entries WHERE organization_id = ${organizationId}
    GROUP BY 1, 2, 3, 4
  `;
  const get = (name: string, month: string, filter: (row: (typeof ledger)[number]) => boolean, field: "credits" | "money") =>
    round2(ledger.filter((row) => users.get(row.user_id) === name && row.month === month && filter(row)).reduce((sum, row) => sum + Number(row[field]), 0));
  const lines: string[] = ["| Tháng | Người | Điểm thợ Excel | App | Điểm QC Excel | App | Điểm KPI (Final) | App (CT+OT+QC) | Khoán Final | App |", "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|"];
  let workerMismatch = 0;
  for (const book of model.books) {
    for (const name of [...new Set(book.rows.map((row) => row.staff))].sort((a, b) => a.localeCompare(b, "vi"))) {
      const rows = book.rows.filter((row) => row.staff === name && row.volume);
      const workerExcel = round2(rows.filter((row) => !isQcName(row.process)).reduce((sum, row) => sum + (row.creditSum ?? 0), 0));
      const qcExcel = round2(rows.filter((row) => isQcName(row.process)).reduce((sum, row) => sum + (row.creditSum ?? 0), 0));
      const workerApp = get(name, book.month, (row) => row.role === "WORKER", "credits");
      const qcApp = get(name, book.month, (row) => row.role === "QC", "credits");
      const officialApp = get(name, book.month, (row) => row.pay_mode === "POINTS", "credits");
      const khoanApp = get(name, book.month, (row) => row.pay_mode === "MONEY_IF_KPI", "money");
      if (Math.abs(workerExcel - workerApp) > 0.011) workerMismatch += 1;
      const official = book.final?.official.get(name);
      const khoan = book.final?.khoan.get(name)?.amount;
      lines.push(
        `| ${book.month} | ${accountOf(name).displayName} | ${workerExcel} | ${workerApp} | ${qcExcel} | ${qcApp} | ${official === undefined ? "–" : round2(official)} | ${officialApp} | ${khoan === undefined ? "–" : khoan.toLocaleString("vi-VN")} | ${khoanApp.toLocaleString("vi-VN")} |`
      );
    }
  }
  console.log(`\nReconciliation: worker credits ${workerMismatch === 0 ? "match Excel for every person and month" : `differ for ${workerMismatch} person-months`}.`);
  return lines;
};

// Main ---------------------------------------------------------------------------------------------------------------------

const main = async () => {
  const sql = getSql();
  const organizationId = (await sql<{ id: string }[]>`SELECT id FROM public.organizations WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`)[0]?.id;
  if (!organizationId) throw new Error("No organization found.");
  const adminId = (
    await sql<{ user_id: string }[]>`
      SELECT om.user_id FROM public.organization_memberships om
      JOIN public.roles r ON r.id = om.role_id AND r.key = 'superadmin'
      WHERE om.organization_id = ${organizationId} AND om.deleted_at IS NULL AND om.status = 'active'
      ORDER BY om.created_at LIMIT 1
    `
  )[0]?.user_id;
  if (!adminId) throw new Error("No active superadmin found.");
  const admin = await resolveAccessContext(adminId);

  const books: MonthBook[] = [];
  for (const file of config.workbooks) books.push(await readWorkbook(file));
  books.sort((a, b) => a.month.localeCompare(b.month));
  const dbProcesses = (await sql<{ name: string }[]>`SELECT name FROM production.processes WHERE organization_id = ${organizationId}`).map((row) => row.name);
  const model = buildModel(books, dbProcesses);

  console.log("Workbooks:");
  for (const book of books) {
    console.log(`  ${book.month}  ${book.file}: ${book.rows.length} rows, credit table ${book.table.length} entries, Final ${book.final ? `${book.final.targets.size} targets` : "missing"}`);
    for (const line of book.notes) console.log(`    ${line}`);
  }
  console.log(`Projects: ${model.projects.size}; processes: ${new Set(model.processes.values()).size}; people: ${model.staff.size}`);
  const merged = (map: Map<string, string>, books: MonthBook[], pick: (row: LogRow) => string) => {
    const spellings = new Map<string, Set<string>>();
    for (const row of books.flatMap((book) => book.rows)) spellings.set(fold(pick(row)), (spellings.get(fold(pick(row))) ?? new Set()).add(pick(row)));
    return [...spellings].filter(([, set]) => set.size > 1).map(([key, set]) => `${[...set].join("/")} → ${map.get(key)}`);
  };
  console.log(`  merged spellings: ${[...merged(model.projects, books, (row) => row.project), ...merged(model.processes, books, (row) => row.process)].join("; ") || "none"}`);
  const skippedByKey = new Map<string, string[]>();
  for (const line of model.skippedTableEntries) {
    const [month, ...rest] = line.split(" ");
    skippedByKey.set(rest.join(" "), [...(skippedByKey.get(rest.join(" ")) ?? []), month!]);
  }
  for (const [entry, months] of skippedByKey) console.log(`  credit table skipped: ${entry} [${months.join(", ")}]`);
  // Every log row's credit must equal its month's table (VLOOKUP) price.
  for (const book of books) {
    for (const row of book.rows) {
      const price = model.tables.get(book.month)!.get(`${fold(row.project)}|${fold(row.process)}`);
      if (!isQcName(row.process) || isPlainQc(row.process)) {
        if (!price) console.log(`  WARN ${row.source} line ${row.line}: no ${book.month} price for ${row.project} / ${row.process}`);
        else if (row.credit !== null && Math.abs(price.credit - row.credit) > 0.0001) {
          console.log(`  WARN ${row.source} line ${row.line}: row credit ${row.credit} ≠ table ${price.credit} (${row.project} / ${row.process}); the table price is used`);
        }
      }
    }
  }

  if (phase === "catalog" || phase === "all") await importCatalog(sql, organizationId, admin, model);
  if (phase === "history" || phase === "all") await replayHistory(sql, organizationId, admin, model);
  if ((phase === "settle" || phase === "all") && !dryRun) {
    console.log("\nKPI settlement:");
    await settleImportedMonths(sql, organizationId, admin, model);
  }
  if (phase !== "catalog") {
    if (!dryRun) {
      const lines = await reconcile(sql, organizationId, model);
      const report = resolve(configPath, "..", "reconciliation.md");
      writeFileSync(report, `# Đối chiếu nhập work log\n\nTạo lúc ${new Date().toISOString()}.\n\n${lines.join("\n")}\n`);
      console.log(`Report: ${report}`);
    }
  }
};

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
    await closeRedis();
  });
