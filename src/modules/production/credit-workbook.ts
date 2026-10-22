import { AppError } from "../../lib/app-error.js";
import type { QuerySql } from "../../lib/db-types.js";
import { setCreditRule } from "./credit-rules.js";

/**
 * PD-080b — importing an official price workbook (the "Credit image" layout) as a NEW price version, as pure steps plus
 * one write function (BE/scripts/import-credit-xlsx.ts reads the file and calls them; no company data in this repo:
 * process aliases and new processes come from a private config).
 *
 * Layout (columns configurable): column B holds either a PROJECT code — a row whose price cells (H hours/image, J
 * credit/image, K Khoán money/image) are all empty and whose B matches a project code starts that project's block (case and
 * spacing ignored; failing that, the one project equal on letters and digits only, e.g. "X & Y" = "XY") — or a PROCESS
 * name inside the current block, with its prices. A row with empty prices whose B is a process is an empty price line
 * (skipped, counted). A row with empty prices that is neither starts an UNMATCHED block: its price rows are refused (a
 * problem — nothing is written), never attributed to the previous project. An empty J = no price for that process (no row); an empty K = no Khoán money (null); an empty H with a J =
 * hours not set (read as credit ÷ 11). Credits are rounded to 2 decimals, hours to 4, money to whole VND.
 *
 * The version: every rule in force on the effective day (all projects, those absent from the file too) ends the day
 * before (effective_to = the effective day, exclusive end) — refused (PR-12) when such a rule priced a score on or after
 * that day —, then the workbook's rows start on the effective day with their source; older rows are kept (scores
 * reference them). Re-running with the same workbook plans nothing.
 */

export type CreditSheetRow = { line: number; code: string; hours: number | null; credit: number | null; money: number | null };

export type CreditWorkbookConfig = {
  /** Lower-case name in the file → the app's process name. */
  processAliases?: Record<string, string>;
  /** Processes to create when the file uses them and they do not exist yet. */
  newProcesses?: { name: string; isQc: boolean }[];
};

export type CatalogProject = { id: string; code: string };
export type CatalogProcess = { id: string; name: string; isQc: boolean };

export type ParsedCreditEntry = {
  line: number;
  projectId: string;
  /** The app's process name (after aliases). */
  processName: string;
  credit: number;
  money: number | null;
  hours: number | null;
};

export type ParsedCreditWorkbook = {
  blocks: number;
  /** Blocks matched on letters and digits only. */
  looseBlocks: number;
  /** Blocks whose code matches no project (their rows are problems). */
  unmatchedBlocks: number;
  /** Rows with no price that are not a project code (e.g. an empty price line). */
  skipped: number;
  entries: ParsedCreditEntry[];
  /** Process rows with no credit (J) — no price created. */
  withoutCredit: number;
  withoutMoney: number;
  withoutHours: number;
  /** Process names the catalog does not know (and the config does not create). */
  unknownProcesses: string[];
  /** Processes of the config to create (used by the file, missing in the catalog). */
  processesToCreate: { name: string; isQc: boolean }[];
  /** Lines priced before any project block, and duplicates of a project × process. */
  problems: { line: number; message: string }[];
};

const squash = (value: string) => value.replace(/\s+/g, " ").trim();
const fold = (value: string) => squash(value).toLowerCase();
const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Parses the sheet's rows against the catalog (pure). */
export const parseCreditSheet = (
  rows: readonly CreditSheetRow[],
  catalog: { projects: readonly CatalogProject[]; processes: readonly CatalogProcess[] },
  config: CreditWorkbookConfig = {}
): ParsedCreditWorkbook => {
  const projects = new Map(catalog.projects.map((project) => [fold(project.code), project]));
  const processes = new Map(catalog.processes.map((process) => [fold(process.name), process]));
  const aliases = new Map(Object.entries(config.processAliases ?? {}).map(([from, to]) => [fold(from), squash(to)]));
  const creatable = new Map((config.newProcesses ?? []).map((process) => [fold(process.name), { name: squash(process.name), isQc: process.isQc }]));
  const loose = (value: string) => fold(value).replace(/[^\p{L}\p{N}]/gu, "");
  const looseProjects = new Map<string, CatalogProject | null>();
  for (const project of catalog.projects) {
    const key = loose(project.code);
    looseProjects.set(key, looseProjects.has(key) ? null : project);
  }
  const isProcessName = (value: string) => {
    const name = aliases.get(fold(value)) ?? value;
    return processes.has(fold(name)) || creatable.has(fold(name));
  };
  const result: ParsedCreditWorkbook = {
    blocks: 0,
    looseBlocks: 0,
    unmatchedBlocks: 0,
    skipped: 0,
    entries: [],
    withoutCredit: 0,
    withoutMoney: 0,
    withoutHours: 0,
    unknownProcesses: [],
    processesToCreate: [],
    problems: []
  };
  const unknown = new Set<string>();
  const toCreate = new Map<string, { name: string; isQc: boolean }>();
  const seen = new Map<string, number>();
  let block: CatalogProject | null = null;
  let unmatched = false;
  for (const row of rows) {
    const code = squash(row.code);
    if (code === "") {
      continue;
    }
    const empty = row.hours === null && row.credit === null && row.money === null;
    if (empty) {
      const exact = projects.get(fold(code));
      const near = exact ? null : (looseProjects.get(loose(code)) ?? null);
      if (exact || near) {
        block = exact ?? near;
        unmatched = false;
        result.blocks += 1;
        result.looseBlocks += near ? 1 : 0;
      } else if (isProcessName(code)) {
        result.skipped += 1;
      } else {
        block = null;
        unmatched = true;
        result.unmatchedBlocks += 1;
      }
      continue;
    }
    if (!block) {
      result.problems.push({ line: row.line, message: unmatched ? "Dòng có giá thuộc Project không có trong danh mục." : "Dòng có giá nằm trước mọi Project." });
      continue;
    }
    const name = aliases.get(fold(code)) ?? code;
    const known = processes.get(fold(name));
    const created = known ? null : creatable.get(fold(name));
    if (!known && !created) {
      unknown.add(name);
      continue;
    }
    if (created) {
      toCreate.set(fold(created.name), created);
    }
    if (row.credit === null) {
      result.withoutCredit += 1;
      continue;
    }
    const processName = known?.name ?? created!.name;
    const key = `${block.id}|${fold(processName)}`;
    if (seen.has(key)) {
      result.problems.push({ line: row.line, message: `Trùng Project × quy trình với dòng ${seen.get(key)}.` });
      continue;
    }
    seen.set(key, row.line);
    if (row.money === null) {
      result.withoutMoney += 1;
    }
    if (row.hours === null) {
      result.withoutHours += 1;
    }
    result.entries.push({
      line: row.line,
      projectId: block.id,
      processName,
      credit: round(row.credit, 2),
      money: row.money === null || row.money <= 0 ? null : Math.round(row.money),
      hours: row.hours === null ? null : round(row.hours, 4)
    });
  }
  result.unknownProcesses = [...unknown].sort((a, b) => a.localeCompare(b));
  result.processesToCreate = [...toCreate.values()];
  return result;
};

/** The database rows the plan compares with. */
export type ExistingRule = {
  id: string;
  project_id: string;
  process_id: string;
  credit_per_image: string;
  money_per_image: string | null;
  hours_per_image: string | null;
  source: string | null;
  effective_from: string;
  effective_to: string | null;
};

export type CreditImportPlan = {
  /** Rules in force on the effective day that start before it: they end on that day. */
  toEnd: string[];
  /** Workbook rows to write (new, or a same-day row with other values). */
  toWrite: (ParsedCreditEntry & { processId: string | null })[];
  /** Workbook rows already present with the same values. */
  unchanged: number;
  /** Rows starting on / after the effective day that the workbook does not have (must be removed by hand first). */
  conflicting: number;
};

const sameNumber = (stored: string | null, value: number | null) => (stored === null ? value === null : value !== null && Number(stored) === value);

/**
 * Compares the parsed workbook with the rules of the organization (pure). `processIds`: app process name (folded) → id
 * (null for a process still to create).
 */
export const planCreditImport = (
  parsed: ParsedCreditWorkbook,
  existing: readonly ExistingRule[],
  processIds: ReadonlyMap<string, string | null>,
  effectiveFrom: string,
  source: string
): CreditImportPlan => {
  const toEnd = existing
    .filter((rule) => rule.effective_from < effectiveFrom && (rule.effective_to === null || rule.effective_to > effectiveFrom))
    .map((rule) => rule.id);
  const sameDay = new Map(
    existing.filter((rule) => rule.effective_from === effectiveFrom).map((rule) => [`${rule.project_id}|${rule.process_id}`, rule])
  );
  const fileKeys = new Set<string>();
  const toWrite: CreditImportPlan["toWrite"] = [];
  let unchanged = 0;
  for (const entry of parsed.entries) {
    const processId = processIds.get(fold(entry.processName)) ?? null;
    if (processId) {
      fileKeys.add(`${entry.projectId}|${processId}`);
      const current = sameDay.get(`${entry.projectId}|${processId}`);
      if (
        current &&
        Number(current.credit_per_image) === entry.credit &&
        sameNumber(current.money_per_image, entry.money) &&
        sameNumber(current.hours_per_image, entry.hours) &&
        current.source === source
      ) {
        unchanged += 1;
        continue;
      }
    }
    toWrite.push({ ...entry, processId });
  }
  const conflicting = existing.filter(
    (rule) => rule.effective_from > effectiveFrom || (rule.effective_from === effectiveFrom && !fileKeys.has(`${rule.project_id}|${rule.process_id}`))
  ).length;
  return { toEnd, toWrite, unchanged, conflicting };
};

/** Every rule of the organization (for the plan). */
export const loadCreditRulesForImport = (sql: QuerySql, organizationId: string) => sql<ExistingRule[]>`
  SELECT id, project_id, process_id, credit_per_image::text, money_per_image::text, hours_per_image::text, source,
    to_char(effective_from, 'YYYY-MM-DD') AS effective_from, to_char(effective_to, 'YYYY-MM-DD') AS effective_to
  FROM production.credit_rules WHERE organization_id = ${organizationId}
`;

/**
 * Writes a plan inside the caller's transaction: creates the config's missing processes, ends the rules in force (PR-12:
 * refused when one priced a score on / after the effective day), writes the workbook rows from the effective day, and
 * records the version (name, source). Returns what it did.
 */
export const applyCreditImport = async (
  sql: QuerySql,
  input: {
    organizationId: string;
    parsed: ParsedCreditWorkbook;
    plan: CreditImportPlan;
    effectiveFrom: string;
    source: string;
    versionName: string | null;
    userId: string | null;
  }
) => {
  const { organizationId, parsed, plan, effectiveFrom } = input;
  if (plan.conflicting > 0) {
    throw new AppError("CREDIT_IMPORT_CONFLICT", `${plan.conflicting} đơn giá bắt đầu từ ngày hiệu lực trở đi không có trong file — xoá trước khi nhập.`, 409);
  }
  const processIds = new Map<string, string>();
  let createdProcesses = 0;
  const maxOrder = (
    await sql<{ max: number | null }[]>`SELECT max(sort_order)::int AS max FROM production.processes WHERE organization_id = ${organizationId}`
  )[0]?.max ?? 0;
  for (const [index, process] of parsed.processesToCreate.entries()) {
    const row = (
      await sql<{ id: string }[]>`
        INSERT INTO production.processes (organization_id, name, is_qc, sort_order)
        VALUES (${organizationId}, ${process.name}, ${process.isQc}, ${maxOrder + index + 1})
        ON CONFLICT (organization_id, lower(name)) DO NOTHING
        RETURNING id
      `
    )[0];
    if (row) {
      createdProcesses += 1;
    }
  }
  for (const row of await sql<{ id: string; name: string }[]>`SELECT id, name FROM production.processes WHERE organization_id = ${organizationId}`) {
    processIds.set(fold(row.name), row.id);
  }
  if (plan.toEnd.length > 0) {
    const used = await sql<{ count: number }[]>`
      SELECT count(DISTINCT s.credit_rule_id)::int AS count FROM production.score_entries s
      WHERE s.organization_id = ${organizationId} AND s.credit_rule_id = ANY(${plan.toEnd}::uuid[]) AND s.business_day >= ${effectiveFrom}::date
    `;
    if ((used[0]?.count ?? 0) > 0) {
      throw new AppError("CREDIT_RULE_IN_USE", `${used[0]!.count} đơn giá đã tính điểm từ ngày hiệu lực trở đi — không kết thúc được.`, 409);
    }
    await sql`
      UPDATE production.credit_rules SET effective_to = ${effectiveFrom}::date
      WHERE organization_id = ${organizationId} AND id = ANY(${plan.toEnd}::uuid[])
    `;
  }
  let written = 0;
  for (const entry of plan.toWrite) {
    const processId = entry.processId ?? processIds.get(fold(entry.processName));
    if (!processId) {
      throw new AppError("PROCESS_NOT_FOUND", "Quy trình chưa có trong danh mục.", 400);
    }
    await setCreditRule(sql, {
      organizationId,
      projectId: entry.projectId,
      processId,
      creditPerImage: entry.credit,
      moneyPerImage: entry.money,
      hoursPerImage: entry.hours,
      source: input.source,
      effectiveFrom,
      userId: input.userId
    });
    written += 1;
  }
  const version = await sql<{ changed: boolean }[]>`
    INSERT INTO production.credit_versions (organization_id, effective_from, name, source, created_by)
    VALUES (${organizationId}, ${effectiveFrom}::date, ${input.versionName}, ${input.source}, ${input.userId})
    ON CONFLICT (organization_id, effective_from) DO UPDATE
    SET name = EXCLUDED.name, source = EXCLUDED.source, created_by = EXCLUDED.created_by, created_at = now()
    WHERE production.credit_versions.name IS DISTINCT FROM EXCLUDED.name OR production.credit_versions.source IS DISTINCT FROM EXCLUDED.source
    RETURNING true AS changed
  `;
  return { createdProcesses, ended: plan.toEnd.length, written, versionChanged: version.length > 0 };
};
