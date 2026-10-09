import type { Response } from "express";
import ExcelJS from "exceljs";

import { logger } from "../../lib/logger.js";

/**
 * Excel (.xlsx) export helpers (SPEC Phase 5 §4, §6; exceljs per PD-009). Workbooks are streamed straight
 * into the response with the streaming writer. Every text cell goes through `safeText` (CSV/formula
 * injection: a leading = + - @ tab or CR gets an apostrophe), numbers stay numbers, and instants are
 * shown in business time (Asia/Ho_Chi_Minh, UTC+7 without DST).
 */

export const xlsxContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const formulaStart = /^[=+\-@\t\r]/;

/** Text that a spreadsheet would read as a formula is prefixed with an apostrophe. */
export const safeText = (value: string) => (formulaStart.test(value) ? `'${value}` : value);

export type CellValue = string | number | Date | null | undefined;

export const safeCell = (value: CellValue): string | number | Date | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return safeText(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  return value;
};

const businessOffsetMs = 7 * 3_600_000;

/**
 * Excel has no timezone: a Date is written as its UTC wall clock. Shifting by +7 h makes the cell show
 * the business (Vietnam) time.
 */
export const businessDate = (iso: string | Date | null | undefined) => {
  if (!iso) {
    return null;
  }
  const time = (iso instanceof Date ? iso : new Date(iso)).getTime();
  return Number.isNaN(time) ? null : new Date(time + businessOffsetMs);
};

/** "YYYY-MM-DD" → a date cell at midnight (no shift: already a business day). */
export const dayCell = (day: string | null | undefined) => (day ? new Date(`${day}T00:00:00Z`) : null);

/**
 * A ratio (0.1234 = 12.34 %) for a "0.00%" cell, rounded to what the format shows (PR-25): no float tails
 * such as 1.0325000000000002 in the cell value.
 */
export const percentCell = (fraction: number | null | undefined) =>
  fraction === null || fraction === undefined || !Number.isFinite(fraction) ? null : Math.round(fraction * 10_000) / 10_000;

const isMidnight = (date: Date) => date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0;

const asciiFallback = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_(?=\.)/g, "");

/** RFC 6266 / RFC 5987: an ASCII `filename` fallback plus the UTF-8 `filename*`. */
export const contentDisposition = (filename: string) => {
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${asciiFallback(filename)}"; filename*=UTF-8''${encoded}`;
};

/** Number formats per value kind (Vietnamese Excel shows its own separators). */
export const numberFormats = {
  points: "#,##0.00",
  money: "#,##0",
  count: "#,##0",
  images: "#,##0",
  percent: "0.00%",
  hours: "#,##0.00",
  decimal: "#,##0.00",
  day: "dd/mm/yyyy",
  datetime: "dd/mm/yyyy hh:mm"
} as const;

export type SheetColumn = { header: string; key: string; width?: number; numFmt?: string };
export type SheetSpec = { name: string; columns: SheetColumn[]; rows: Record<string, CellValue>[]; boldLastRow?: boolean };

/**
 * Streams a workbook to the response. All data must be loaded before calling (nothing can fail after
 * the headers are sent except the socket); a failure mid-stream destroys the response.
 */
export const sendWorkbook = async (res: Response, filename: string, sheets: SheetSpec[]) => {
  res.status(200);
  res.setHeader("Content-Type", xlsxContentType);
  res.setHeader("Content-Disposition", contentDisposition(filename));
  res.setHeader("Cache-Control", "no-store");
  try {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true, useSharedStrings: false });
    workbook.creator = "Nesso Work";
    workbook.created = new Date();
    for (const spec of sheets) {
      const sheet = workbook.addWorksheet(spec.name.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
      sheet.columns = spec.columns.map((column) => ({
        header: safeText(column.header),
        key: column.key,
        width: column.width ?? Math.min(Math.max(column.header.length + 4, 12), 48),
        ...(column.numFmt ? { style: { numFmt: column.numFmt } } : {})
      }));
      const header = sheet.getRow(1);
      header.font = { bold: true };
      header.commit();
      spec.rows.forEach((values, index) => {
        const row = sheet.addRow(Object.fromEntries(spec.columns.map((column) => [column.key, safeCell(values[column.key])])));
        // Date cells always show as dates (PR-25): columns without a format (e.g. the info sheets) get
        // dd/mm/yyyy, or dd/mm/yyyy hh:mm when the value has a time of day.
        spec.columns.forEach((column, position) => {
          const value = values[column.key];
          if (value instanceof Date && !column.numFmt) {
            row.getCell(position + 1).numFmt = isMidnight(value) ? numberFormats.day : numberFormats.datetime;
          }
        });
        if (spec.boldLastRow && index === spec.rows.length - 1) {
          row.font = { bold: true };
        }
        row.commit();
      });
      sheet.commit();
    }
    await workbook.commit();
  } catch (error) {
    logger.error({ err: error }, "Excel export failed while streaming");
    res.destroy(error instanceof Error ? error : new Error("Excel export failed"));
  }
};

/** "Báo cáo 2026-09-26_2026-10-25 (xuất 2026-10-09).xlsx" */
export const exportFilename = (title: string, scope: string | null, exportDay: string) =>
  `${title}${scope ? ` ${scope}` : ""} (xuất ${exportDay}).xlsx`;
