import type { CreditImportResult, CreditRule } from "../../contracts/production-catalog.js";
import { AppError } from "../../lib/app-error.js";
import type { QuerySql } from "../../lib/db-types.js";
import { parseCsv } from "./csv.js";
import { isValidDay } from "./time.js";

export type CreditRuleRow = {
  id: string;
  project_id: string;
  process_id: string;
  credit_per_image: string;
  money_per_image: string | null;
  effective_from: string;
  effective_to: string | null;
};

const dateColumns = (sql: QuerySql) => sql`
  id, project_id, process_id, credit_per_image::text, money_per_image::text,
  to_char(effective_from, 'YYYY-MM-DD') AS effective_from, to_char(effective_to, 'YYYY-MM-DD') AS effective_to
`;

export const toCreditRule = (row: CreditRuleRow): CreditRule => ({
  id: row.id,
  projectId: row.project_id,
  processId: row.process_id,
  creditPerImage: Number(row.credit_per_image),
  moneyPerImage: row.money_per_image === null ? null : Number(row.money_per_image),
  effectiveFrom: row.effective_from,
  effectiveTo: row.effective_to
});

/** SPEC Phase 1 §3: the rule whose [effective_from, effective_to) contains `day` (business calendar day). */
export const getCreditRule = async (
  sql: QuerySql,
  organizationId: string,
  projectId: string,
  processId: string,
  day: string
): Promise<CreditRule | null> => {
  const row = (
    await sql<CreditRuleRow[]>`
      SELECT ${dateColumns(sql)}
      FROM production.credit_rules
      WHERE organization_id = ${organizationId} AND project_id = ${projectId} AND process_id = ${processId}
        AND effective_from <= ${day}::date AND (effective_to IS NULL OR ${day}::date < effective_to)
      LIMIT 1
    `
  )[0];
  return row ? toCreditRule(row) : null;
};

export const listRulesAt = async (sql: QuerySql, organizationId: string, day: string) =>
  (
    await sql<CreditRuleRow[]>`
      SELECT ${dateColumns(sql)}
      FROM production.credit_rules
      WHERE organization_id = ${organizationId}
        AND effective_from <= ${day}::date AND (effective_to IS NULL OR ${day}::date < effective_to)
    `
  ).map(toCreditRule);

export const listRuleHistory = async (sql: QuerySql, organizationId: string, projectId: string, processId: string) =>
  (
    await sql<CreditRuleRow[]>`
      SELECT ${dateColumns(sql)}
      FROM production.credit_rules
      WHERE organization_id = ${organizationId} AND project_id = ${projectId} AND process_id = ${processId}
      ORDER BY effective_from DESC
      LIMIT 200
    `
  ).map(toCreditRule);

/**
 * PR-12: a price that already priced a score is history. It is never edited in place, and a new version
 * may only start after the last business day it priced — otherwise the price list would claim another
 * price was in force on days whose scores used this one. Returns the last priced day, or null.
 */
const lastPricedDay = async (sql: QuerySql, organizationId: string, ruleId: string) =>
  (
    await sql<{ day: string | null }[]>`
      SELECT to_char(max(business_day), 'YYYY-MM-DD') AS day FROM production.score_entries
      WHERE organization_id = ${organizationId} AND credit_rule_id = ${ruleId}
    `
  )[0]?.day ?? null;

const ruleInUse = (day: string) =>
  new AppError(
    "CREDIT_RULE_IN_USE",
    `Đơn giá này đã được dùng để tính điểm đến ngày ${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)} — hãy tạo phiên bản mới bắt đầu sau ngày đó.`,
    409
  );

/**
 * Writes a new price for (project, process) starting on `effectiveFrom` without touching history:
 * the version covering that day is split (it now ends the day before), the new version inherits
 * the old end. A same-day version is corrected in place only while no score used it; a version that
 * priced scores can only be followed by a version starting after its last priced day (PR-12, 409).
 * Scores keep the values they recorded.
 */
export const setCreditRule = async (
  sql: QuerySql,
  input: {
    organizationId: string;
    projectId: string;
    processId: string;
    creditPerImage: number;
    moneyPerImage: number | null;
    effectiveFrom: string;
    userId: string | null;
  }
) => {
  if (!isValidDay(input.effectiveFrom)) {
    throw new AppError("INVALID_DATE", "Ngày hiệu lực không hợp lệ.", 400);
  }
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`credit:${input.projectId}:${input.processId}`}, 0))`;

  const sameDay = (
    await sql<{ id: string }[]>`
      SELECT id FROM production.credit_rules
      WHERE organization_id = ${input.organizationId} AND project_id = ${input.projectId}
        AND process_id = ${input.processId} AND effective_from = ${input.effectiveFrom}::date
    `
  )[0];
  if (sameDay) {
    const usedUntil = await lastPricedDay(sql, input.organizationId, sameDay.id);
    if (usedUntil) {
      throw ruleInUse(usedUntil);
    }
    await sql`
      UPDATE production.credit_rules
      SET credit_per_image = ${input.creditPerImage}, money_per_image = ${input.moneyPerImage}
      WHERE id = ${sameDay.id}
    `;
    return sameDay.id;
  }

  const covering = (
    await sql<{ id: string; effective_to: string | null }[]>`
      SELECT id, to_char(effective_to, 'YYYY-MM-DD') AS effective_to FROM production.credit_rules
      WHERE organization_id = ${input.organizationId} AND project_id = ${input.projectId} AND process_id = ${input.processId}
        AND effective_from < ${input.effectiveFrom}::date
        AND (effective_to IS NULL OR ${input.effectiveFrom}::date < effective_to)
      FOR UPDATE
    `
  )[0];
  let newEnd: string | null = null;
  if (covering) {
    const usedUntil = await lastPricedDay(sql, input.organizationId, covering.id);
    if (usedUntil && usedUntil >= input.effectiveFrom) {
      throw ruleInUse(usedUntil);
    }
    newEnd = covering.effective_to;
    await sql`UPDATE production.credit_rules SET effective_to = ${input.effectiveFrom}::date WHERE id = ${covering.id}`;
  } else {
    // Before every existing version: end where the next one starts.
    const next = (
      await sql<{ effective_from: string }[]>`
        SELECT to_char(min(effective_from), 'YYYY-MM-DD') AS effective_from FROM production.credit_rules
        WHERE organization_id = ${input.organizationId} AND project_id = ${input.projectId} AND process_id = ${input.processId}
          AND effective_from > ${input.effectiveFrom}::date
      `
    )[0];
    newEnd = next?.effective_from ?? null;
  }

  const created = (
    await sql<{ id: string }[]>`
      INSERT INTO production.credit_rules (organization_id, project_id, process_id, credit_per_image, money_per_image, effective_from, effective_to, created_by)
      VALUES (${input.organizationId}, ${input.projectId}, ${input.processId}, ${input.creditPerImage}, ${input.moneyPerImage},
              ${input.effectiveFrom}::date, ${newEnd}::date, ${input.userId})
      RETURNING id
    `
  )[0]!;
  return created.id;
};

/**
 * Removes one version of a price (e.g. created by mistake) when no score used it yet; the previous
 * version then extends over its period again. Used prices are history and stay.
 */
export const deleteCreditRuleVersion = async (sql: QuerySql, organizationId: string, ruleId: string) => {
  const rule = (
    await sql<{ project_id: string; process_id: string; effective_from: string; effective_to: string | null }[]>`
      SELECT project_id, process_id, to_char(effective_from, 'YYYY-MM-DD') AS effective_from, to_char(effective_to, 'YYYY-MM-DD') AS effective_to
      FROM production.credit_rules WHERE organization_id = ${organizationId} AND id = ${ruleId}
    `
  )[0];
  if (!rule) {
    throw new AppError("CREDIT_RULE_NOT_FOUND", "Không tìm thấy phiên bản đơn giá.", 404);
  }
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`credit:${rule.project_id}:${rule.process_id}`}, 0))`;
  const used = await sql`SELECT 1 FROM production.score_entries WHERE organization_id = ${organizationId} AND credit_rule_id = ${ruleId} LIMIT 1`;
  if (used.length > 0) {
    throw new AppError("CREDIT_RULE_IN_USE", "Đơn giá này đã được dùng để tính điểm nên không xoá được — hãy tạo phiên bản mới.", 409);
  }
  await sql`DELETE FROM production.credit_rules WHERE organization_id = ${organizationId} AND id = ${ruleId}`;
  // The version that ended where this one started takes over its period (deleted first: no overlap).
  await sql`
    UPDATE production.credit_rules SET effective_to = ${rule.effective_to}::date
    WHERE organization_id = ${organizationId} AND project_id = ${rule.project_id} AND process_id = ${rule.process_id}
      AND effective_to = ${rule.effective_from}::date
  `;
  return { projectId: rule.project_id, processId: rule.process_id };
};

/** "Tạo phiên bản mới từ ngày…": copies every rule effective on that day into a new version starting that day. */
export const startNewVersion = async (sql: QuerySql, organizationId: string, effectiveFrom: string, userId: string | null) => {
  const current = await listRulesAt(sql, organizationId, effectiveFrom);
  let created = 0;
  for (const rule of current) {
    if (rule.effectiveFrom === effectiveFrom) {
      continue;
    }
    await setCreditRule(sql, {
      organizationId,
      projectId: rule.projectId,
      processId: rule.processId,
      creditPerImage: rule.creditPerImage,
      moneyPerImage: rule.moneyPerImage,
      effectiveFrom,
      userId
    });
    created += 1;
  }
  return created;
};

export type ParsedCreditRow = { line: number; projectCode: string; processName: string; credit: number; money: number | null };

/**
 * Validates an import file (project_code, process_name, credit, money). Pure: returns either all
 * rows or every error with its line — the caller writes nothing when any error exists.
 * money 0 or empty means "no price" (null), per SPEC §10.
 */
export const parseCreditCsv = (csv: string): { rows: ParsedCreditRow[]; errors: { line: number; message: string }[] } => {
  const records = parseCsv(csv);
  const errors: { line: number; message: string }[] = [];
  const rows: ParsedCreditRow[] = [];
  if (records.length === 0) {
    return { rows, errors: [{ line: 1, message: "Tệp trống." }] };
  }
  const header = records[0]!.cells.map((cell) => cell.trim().toLowerCase());
  const column = (name: string) => header.indexOf(name);
  const indexes = { project: column("project_code"), process: column("process_name"), credit: column("credit"), money: column("money") };
  if (indexes.project < 0 || indexes.process < 0 || indexes.credit < 0) {
    return { rows, errors: [{ line: records[0]!.line, message: "Thiếu cột project_code, process_name hoặc credit." }] };
  }

  const seen = new Map<string, number>();
  for (const record of records.slice(1)) {
    const get = (index: number) => (index >= 0 ? (record.cells[index] ?? "").trim() : "");
    const projectCode = get(indexes.project);
    const processName = get(indexes.process);
    const creditText = get(indexes.credit).replace(",", ".");
    const moneyText = get(indexes.money).replace(/[.\s_]/g, "");
    const lineErrors: string[] = [];
    if (!projectCode || projectCode.length > 40) {
      lineErrors.push("project_code trống hoặc quá dài");
    }
    if (!processName || processName.length > 120) {
      lineErrors.push("process_name trống hoặc quá dài");
    }
    const credit = Number(creditText);
    const cents = credit * 100;
    if (creditText === "" || !Number.isFinite(credit) || credit < 0 || Math.abs(cents - Math.round(cents)) > 1e-6) {
      lineErrors.push(`credit "${creditText}" không hợp lệ (số ≥ 0, tối đa 2 số lẻ)`);
    }
    const money = moneyText === "" ? 0 : Number(moneyText);
    if (!Number.isInteger(money) || money < 0) {
      lineErrors.push(`money "${get(indexes.money)}" không hợp lệ (số nguyên VND ≥ 0)`);
    }
    const key = `${projectCode.toUpperCase()}|${processName.toLowerCase()}`;
    if (seen.has(key)) {
      lineErrors.push(`trùng cặp dự án × quy trình với dòng ${seen.get(key)}`);
    } else {
      seen.set(key, record.line);
    }
    if (lineErrors.length > 0) {
      errors.push({ line: record.line, message: lineErrors.join("; ") });
      continue;
    }
    rows.push({ line: record.line, projectCode, processName, credit: Math.round(credit * 100) / 100, money: money === 0 ? null : money });
  }
  if (rows.length === 0 && errors.length === 0) {
    errors.push({ line: records[0]!.line, message: "Không có dòng dữ liệu." });
  }
  return { rows, errors };
};

/** All-or-nothing import inside the caller's transaction. */
export const importCreditRules = async (
  sql: QuerySql,
  input: { organizationId: string; csv: string; effectiveFrom: string; createMissing: boolean; userId: string | null }
): Promise<CreditImportResult> => {
  if (!isValidDay(input.effectiveFrom)) {
    throw new AppError("INVALID_DATE", "Ngày hiệu lực không hợp lệ.", 400);
  }
  const { rows, errors } = parseCreditCsv(input.csv);
  const result: CreditImportResult = { ok: false, imported: 0, createdProjects: [], createdProcesses: [], errors };
  if (errors.length > 0) {
    return result;
  }

  const projects = new Map(
    (await sql<{ id: string; code: string }[]>`SELECT id, code FROM production.projects WHERE organization_id = ${input.organizationId}`).map(
      (row) => [row.code.toUpperCase(), row.id]
    )
  );
  const processes = new Map(
    (await sql<{ id: string; name: string }[]>`SELECT id, name FROM production.processes WHERE organization_id = ${input.organizationId}`).map(
      (row) => [row.name.toLowerCase(), row.id]
    )
  );

  for (const row of rows) {
    if (!projects.has(row.projectCode.toUpperCase()) && !input.createMissing) {
      errors.push({ line: row.line, message: `Dự án "${row.projectCode}" chưa có (bật "Tạo mới nếu chưa có" để tạo).` });
    }
    if (!processes.has(row.processName.toLowerCase()) && !input.createMissing) {
      errors.push({ line: row.line, message: `Quy trình "${row.processName}" chưa có.` });
    }
  }
  if (errors.length > 0) {
    return { ...result, errors: errors.sort((a, b) => a.line - b.line) };
  }

  for (const row of rows) {
    const code = row.projectCode.toUpperCase();
    if (!projects.has(code)) {
      const created = (
        await sql<{ id: string }[]>`
          INSERT INTO production.projects (organization_id, code, name) VALUES (${input.organizationId}, ${row.projectCode}, ${row.projectCode})
          RETURNING id
        `
      )[0]!;
      projects.set(code, created.id);
      result.createdProjects.push(row.projectCode);
    }
    const processKey = row.processName.toLowerCase();
    if (!processes.has(processKey)) {
      const isQc = processKey === "checking";
      const created = (
        await sql<{ id: string }[]>`
          INSERT INTO production.processes (organization_id, name, is_qc, sort_order)
          VALUES (${input.organizationId}, ${row.processName}, ${isQc && !(await hasQcProcess(sql, input.organizationId))}, 50)
          RETURNING id
        `
      )[0]!;
      processes.set(processKey, created.id);
      result.createdProcesses.push(row.processName);
    }
    try {
      await setCreditRule(sql, {
        organizationId: input.organizationId,
        projectId: projects.get(code)!,
        processId: processes.get(processKey)!,
        creditPerImage: row.credit,
        moneyPerImage: row.money,
        effectiveFrom: input.effectiveFrom,
        userId: input.userId
      });
    } catch (error) {
      // A price that already priced scores on/after that day (PR-12): reported on its line, nothing is written.
      if (error instanceof AppError && error.code === "CREDIT_RULE_IN_USE") {
        errors.push({ line: row.line, message: error.message });
        continue;
      }
      throw error;
    }
    result.imported += 1;
  }
  if (errors.length > 0) {
    return { ...result, imported: 0, errors };
  }
  return { ...result, ok: true };
};

const hasQcProcess = async (sql: QuerySql, organizationId: string) =>
  (await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM production.processes WHERE organization_id = ${organizationId} AND is_qc AND active`)[0]!
    .count > 0;
