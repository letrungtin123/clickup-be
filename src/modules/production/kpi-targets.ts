import { parseCsv } from "./csv.js";
import type { KpiPeriodType } from "./scoring.js";

/**
 * KPI target import rules (SPEC Phase 3 §4, CSV `user_email,target`) as pure functions.
 * The service resolves emails and writes all rows or none.
 */

const emailPattern = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
export const maxTargetPoints = 1_000_000;

/**
 * Target points from a sheet cell: "2600", "2.600" / "2,600" (thousands separators), "2472,5"
 * (decimal comma), "2.472,5" (Vietnamese: dot thousands, comma decimals — PR-25) and "2,472.5" (English).
 * At most 2 decimals, 0 … 1 000 000. Null when invalid.
 */
export const parseTargetNumber = (text: string): number | null => {
  const compact = text.trim().replace(/[\s_]/g, "");
  if (compact === "") {
    return null;
  }
  const normalized = /^\d{1,3}([.,]\d{3})+$/.test(compact)
    ? compact.replace(/[.,]/g, "")
    : /^\d{1,3}(\.\d{3})+,\d+$/.test(compact)
      ? compact.replace(/\./g, "").replace(",", ".")
      : /^\d{1,3}(,\d{3})+\.\d+$/.test(compact)
        ? compact.replace(/,/g, "")
        : compact.replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }
  const value = Number(normalized);
  return value <= maxTargetPoints ? value : null;
};

export type ParsedTargetRow = { line: number; email: string; target: number };

/** Validates every line; the caller writes nothing when any error exists. */
export const parseKpiTargetCsv = (csv: string): { rows: ParsedTargetRow[]; errors: { line: number; message: string }[] } => {
  const records = parseCsv(csv);
  const errors: { line: number; message: string }[] = [];
  const rows: ParsedTargetRow[] = [];
  if (records.length === 0) {
    return { rows, errors: [{ line: 1, message: "Tệp trống." }] };
  }
  const header = records[0]!.cells.map((cell) => cell.trim().toLowerCase());
  const emailIndex = header.indexOf("user_email");
  const targetIndex = header.indexOf("target");
  if (emailIndex < 0 || targetIndex < 0) {
    return { rows, errors: [{ line: records[0]!.line, message: "Thiếu cột user_email hoặc target." }] };
  }

  const seen = new Map<string, number>();
  for (const record of records.slice(1)) {
    const email = (record.cells[emailIndex] ?? "").trim().toLowerCase();
    const targetText = (record.cells[targetIndex] ?? "").trim();
    const lineErrors: string[] = [];
    if (!emailPattern.test(email) || email.length > 254) {
      lineErrors.push(`user_email "${email}" không hợp lệ`);
    } else if (seen.has(email)) {
      lineErrors.push(`trùng email với dòng ${seen.get(email)}`);
    } else {
      seen.set(email, record.line);
    }
    const target = parseTargetNumber(targetText);
    if (target === null) {
      lineErrors.push(`target "${targetText}" không hợp lệ (số ≥ 0, tối đa 2 số lẻ)`);
    }
    if (lineErrors.length > 0) {
      errors.push({ line: record.line, message: lineErrors.join("; ") });
      continue;
    }
    rows.push({ line: record.line, email, target: target! });
  }
  if (rows.length === 0 && errors.length === 0) {
    errors.push({ line: records[0]!.line, message: "Không có dòng dữ liệu." });
  }
  return { rows, errors };
};

/** QUARTER targets start in January/April/July/October; YEAR targets in January. */
export const isAlignedPeriod = (periodType: KpiPeriodType, period: string) => {
  const month = Number(period.slice(5, 7));
  if (periodType === "QUARTER") {
    return month % 3 === 1;
  }
  return periodType === "YEAR" ? month === 1 : true;
};
