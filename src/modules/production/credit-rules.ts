import type { CreditImportResult, CreditRule, CreditVersionInfo } from "../../contracts/production-catalog.js";
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
  hours_per_image: string | null;
  source: string | null;
  effective_from: string;
  effective_to: string | null;
};

const dateColumns = (sql: QuerySql) => sql`
  id, project_id, process_id, credit_per_image::text, money_per_image::text, hours_per_image::text, source,
  to_char(effective_from, 'YYYY-MM-DD') AS effective_from, to_char(effective_to, 'YYYY-MM-DD') AS effective_to
`;

export const toCreditRule = (row: CreditRuleRow): CreditRule => ({
  id: row.id,
  projectId: row.project_id,
  processId: row.process_id,
  creditPerImage: Number(row.credit_per_image),
  moneyPerImage: row.money_per_image === null ? null : Number(row.money_per_image),
  hoursPerImage: row.hours_per_image === null ? null : Number(row.hours_per_image),
  source: row.source,
  effectiveFrom: row.effective_from,
  effectiveTo: row.effective_to
});

/** SPEC Phase 1 §3: a rule is in force on `day` (business calendar day) when [effective_from, effective_to) contains it. */
const inForceSql = (sql: QuerySql, day: string) => sql`effective_from <= ${day}::date AND (effective_to IS NULL OR ${day}::date < effective_to)`;

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
        AND ${inForceSql(sql, day)}
      LIMIT 1
    `
  )[0];
  return row ? toCreditRule(row) : null;
};

/** Key of a (project, process) pair in getCreditRules' result. */
export const creditRuleKey = (projectId: string, processId: string) => `${projectId}:${processId}`;

/**
 * getCreditRule for many (project, process) pairs at once (PD-070: the expected points of a page of tasks) — the same
 * rule each pair resolves on `day`, keyed by creditRuleKey; pairs without a rule are absent. One query.
 */
export const getCreditRules = async (
  sql: QuerySql,
  organizationId: string,
  pairs: readonly { projectId: string; processId: string }[],
  day: string
): Promise<Map<string, CreditRule>> => {
  const unique = [...new Map(pairs.map((pair) => [creditRuleKey(pair.projectId, pair.processId), pair])).values()];
  const result = new Map<string, CreditRule>();
  if (unique.length === 0) {
    return result;
  }
  const rows = await sql<CreditRuleRow[]>`
    SELECT ${dateColumns(sql)}
    FROM production.credit_rules
    WHERE organization_id = ${organizationId}
      AND (project_id, process_id) IN (
        SELECT * FROM unnest(${unique.map((pair) => pair.projectId)}::uuid[], ${unique.map((pair) => pair.processId)}::uuid[])
      )
      AND ${inForceSql(sql, day)}
  `;
  for (const row of rows) {
    result.set(creditRuleKey(row.project_id, row.process_id), toCreditRule(row));
  }
  return result;
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
    /** PD-080 "Giờ/tấm": undefined keeps the value of the version in force that day (or of the same-day version). */
    hoursPerImage?: number | null | undefined;
    /** PD-080: the import file; undefined = typed in the app (no source on a new row, unchanged on a same-day fix). */
    source?: string | null | undefined;
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
      SET credit_per_image = ${input.creditPerImage}, money_per_image = ${input.moneyPerImage},
        hours_per_image = ${input.hoursPerImage === undefined ? sql`hours_per_image` : sql`${input.hoursPerImage}::numeric`},
        source = ${input.source === undefined ? sql`source` : sql`${input.source}::text`}
      WHERE id = ${sameDay.id}
    `;
    return sameDay.id;
  }

  const covering = (
    await sql<{ id: string; effective_to: string | null; hours_per_image: string | null }[]>`
      SELECT id, to_char(effective_to, 'YYYY-MM-DD') AS effective_to, hours_per_image::text FROM production.credit_rules
      WHERE organization_id = ${input.organizationId} AND project_id = ${input.projectId} AND process_id = ${input.processId}
        AND effective_from < ${input.effectiveFrom}::date
        AND (effective_to IS NULL OR ${input.effectiveFrom}::date < effective_to)
      FOR UPDATE
    `
  )[0];
  let newEnd: string | null = null;
  // PD-080: a new version keeps the hours of the one it follows unless new hours are given.
  const hours = input.hoursPerImage !== undefined ? input.hoursPerImage : covering?.hours_per_image != null ? Number(covering.hours_per_image) : null;
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
      INSERT INTO production.credit_rules
        (organization_id, project_id, process_id, credit_per_image, money_per_image, hours_per_image, source, effective_from, effective_to, created_by)
      VALUES (${input.organizationId}, ${input.projectId}, ${input.processId}, ${input.creditPerImage}, ${input.moneyPerImage},
              ${hours}, ${input.source ?? null}, ${input.effectiveFrom}::date, ${newEnd}::date, ${input.userId})
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
      hoursPerImage: rule.hoursPerImage ?? null,
      source: rule.source ?? null,
      effectiveFrom,
      userId
    });
    created += 1;
  }
  return created;
};

export type ParsedCreditRow = { line: number; projectCode: string; processName: string; credit: number; money: number | null; hours: number | null };

/** PD-080: header names accepted for the optional "Giờ/tấm" column. */
export const creditHoursHeaders = ["hours", "hours_per_image", "gio_tam"];

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
  const indexes = {
    project: column("project_code"),
    process: column("process_name"),
    credit: column("credit"),
    money: column("money"),
    hours: creditHoursHeaders.map(column).find((index) => index >= 0) ?? -1
  };
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
    const hoursText = get(indexes.hours).replace(",", ".");
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
    const hours = hoursText === "" ? null : Number(hoursText);
    if (hours !== null && (!Number.isFinite(hours) || hours < 0 || hours > 1000)) {
      lineErrors.push(`hours "${hoursText}" không hợp lệ (số giờ/tấm từ 0 đến 1000)`);
    }
    const key = `${projectCode.toUpperCase()}|${processName.toLowerCase()}`;
    if (seen.has(key)) {
      lineErrors.push(`trùng cặp Project × quy trình với dòng ${seen.get(key)}`);
    } else {
      seen.set(key, record.line);
    }
    if (lineErrors.length > 0) {
      errors.push({ line: record.line, message: lineErrors.join("; ") });
      continue;
    }
    rows.push({
      line: record.line,
      projectCode,
      processName,
      credit: Math.round(credit * 100) / 100,
      money: money === 0 ? null : money,
      hours: hours === null ? null : Math.round(hours * 10_000) / 10_000
    });
  }
  if (rows.length === 0 && errors.length === 0) {
    errors.push({ line: records[0]!.line, message: "Không có dòng dữ liệu." });
  }
  return { rows, errors };
};

/** All-or-nothing import inside the caller's transaction. */
export const importCreditRules = async (
  sql: QuerySql,
  input: {
    organizationId: string;
    csv: string;
    effectiveFrom: string;
    createMissing: boolean;
    userId: string | null;
    /** PD-080: the import file (stored on every row and on the version) and an optional version name. */
    source?: string | undefined;
    versionName?: string | undefined;
  }
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
      errors.push({ line: row.line, message: `Project "${row.projectCode}" chưa có (bật "Tạo mới nếu chưa có" để tạo).` });
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
          INSERT INTO production.projects (organization_id, code, name, created_by)
          VALUES (${input.organizationId}, ${row.projectCode}, ${row.projectCode}, ${input.userId})
          RETURNING id
        `
      )[0]!;
      projects.set(code, created.id);
      result.createdProjects.push(row.projectCode);
    }
    const processKey = row.processName.toLowerCase();
    if (!processes.has(processKey)) {
      // PD-080b: several QC-type processes may be active ("Checking", "Checking Clipping"…): a new "Checking…" process is one.
      const isQc = processKey === "checking" || processKey.startsWith("checking ");
      const created = (
        await sql<{ id: string }[]>`
          INSERT INTO production.processes (organization_id, name, is_qc, sort_order)
          VALUES (${input.organizationId}, ${row.processName}, ${isQc}, 50)
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
        hoursPerImage: row.hours,
        source: input.source ?? null,
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
  // PD-080: name the version (its day, the file it came from); a later import of the same day renames it.
  if (input.source || input.versionName) {
    await sql`
      INSERT INTO production.credit_versions (organization_id, effective_from, name, source, created_by)
      VALUES (${input.organizationId}, ${input.effectiveFrom}::date, ${input.versionName ?? null}, ${input.source ?? null}, ${input.userId})
      ON CONFLICT (organization_id, effective_from) DO UPDATE
      SET name = coalesce(EXCLUDED.name, production.credit_versions.name), source = coalesce(EXCLUDED.source, production.credit_versions.source),
        created_by = EXCLUDED.created_by, created_at = now()
    `;
  }
  return { ...result, ok: true };
};

/** PD-080: the named version in force on `day` (the latest one starting on or before it), null when none is named. */
export const versionInfoAt = async (sql: QuerySql, organizationId: string, day: string): Promise<CreditVersionInfo | null> => {
  const row = (
    await sql<{ effective_from: string; name: string | null; source: string | null }[]>`
      SELECT to_char(effective_from, 'YYYY-MM-DD') AS effective_from, name, source FROM production.credit_versions
      WHERE organization_id = ${organizationId} AND effective_from <= ${day}::date
      ORDER BY effective_from DESC LIMIT 1
    `
  )[0];
  return row ? { effectiveFrom: row.effective_from, name: row.name, source: row.source } : null;
};

