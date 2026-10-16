import type { Response } from "express";
import ExcelJS from "exceljs";

import type { LeavePart, LeaveStatus } from "../../contracts/production-leave.js";
import { businessDate, contentDisposition, dayCell, numberFormats, safeText, xlsxContentType } from "./excel.js";
import {
  buildAttendanceRows,
  compareLeaveDetails,
  dayColumnLabel,
  formatViDateTime,
  formatViDay,
  isSunday,
  leaveDaysInWindow,
  leavePartLabels,
  leaveStatusLabels,
  noReasonLabel,
  weekdayLabel,
  windowDays,
  type AttendancePerson
} from "./leave-attendance.js";
import { leaveSpanDays } from "./leave-rules.js";

/**
 * The payroll attendance workbook of the leave calendar (PD-057, GET /production/leave/export): sheet "Chấm công"
 * (people × days, APPROVED requests only) and sheet "Chi tiết đơn nghỉ" (APPROVED / PENDING / REJECTED requests of
 * the window). Built in memory from plain rows (no database here), so it can be tested by reading it back; at most
 * a few hundred people × 366 days, then written with Content-Length. Text cells go through `safeText`.
 */

export type LeaveExportRequest = {
  userId: string;
  person: AttendancePerson;
  fromDate: string;
  toDate: string;
  part: LeavePart;
  status: LeaveStatus;
  note: string | null;
  deciderName: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
};

export type LeaveExportData = {
  from: string;
  to: string;
  /** The team filter's name, null for everyone. */
  teamName: string | null;
  exportedAt: Date;
  exporterName: string;
  /** Active production members (of the team when filtered), with or without leave. */
  people: AttendancePerson[];
  /** Requests overlapping the window — APPROVED, PENDING and REJECTED (CANCELLED ones are ignored). */
  requests: LeaveExportRequest[];
};

export const leaveExportFilename = (from: string, to: string) => `cham-cong-nghi-phep_${from}_${to}.xlsx`;

export const attendanceSheetName = "Chấm công";
export const detailSheetName = "Chi tiết đơn nghỉ";

const colors = {
  headerFill: "FFDDEBF7",
  sundayFill: "FFE7E6E6",
  border: "FF9E9E9E",
  note: "FF595959",
  approved: "FF2E7D32",
  pending: "FFB26A00",
  rejected: "FFC62828"
} as const;

const thin = { style: "thin" as const, color: { argb: colors.border } };
const borders: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };
const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

const styleHeader = (cell: ExcelJS.Cell, sunday = false) => {
  cell.font = { bold: true };
  cell.fill = fill(sunday ? colors.sundayFill : colors.headerFill);
  cell.border = borders;
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
};

/** "Team <name>" — without doubling the word when the team is already called "Team …". */
export const teamLabel = (name: string) => (/^team(\s|$)/i.test(name.trim()) ? name.trim() : `Team ${name.trim()}`);

const scopeLabel = (data: LeaveExportData) =>
  `${formatViDay(data.from)} – ${formatViDay(data.to)}${data.teamName ? ` · ${teamLabel(data.teamName)}` : ""}`;

const titleRows = (sheet: ExcelJS.Worksheet, title: string, note: string) => {
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = safeText(title);
  titleCell.font = { bold: true, size: 14 };
  sheet.getRow(1).height = 22;
  const noteCell = sheet.getCell(2, 1);
  noteCell.value = safeText(note);
  noteCell.font = { italic: true, size: 10, color: { argb: colors.note } };
};

const printSetup = (sheet: ExcelJS.Worksheet, pagesWide: number, titleRowsRange: string, titleColumns?: string) => {
  sheet.pageSetup = {
    paperSize: 9, // A4
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: pagesWide,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    printTitlesRow: titleRowsRange,
    ...(titleColumns ? { printTitlesColumn: titleColumns } : {})
  };
  sheet.headerFooter = { oddFooter: "&LNesso Work&RTrang &P / &N" };
};

// Sheet 1 — "Chấm công" ---------------------------------------------------------------------------------------

const fixedColumns = [
  { header: "STT", width: 5 },
  { header: "Họ tên", width: 26 },
  { header: "Team", width: 16 }
] as const;
const totalColumns = [
  { header: "Tổng ngày nghỉ", width: 10 },
  { header: "Nghỉ cả ngày", width: 9 },
  { header: "Buổi sáng", width: 9 },
  { header: "Buổi chiều", width: 9 }
] as const;

const addAttendanceSheet = (workbook: ExcelJS.Workbook, data: LeaveExportData) => {
  const days = windowDays(data.from, data.to);
  const firstDayColumn = fixedColumns.length + 1;
  const firstTotalColumn = firstDayColumn + days.length;
  const lastColumn = firstTotalColumn + totalColumns.length - 1;
  const sheet = workbook.addWorksheet(attendanceSheetName, {
    views: [{ state: "frozen", xSplit: fixedColumns.length, ySplit: 4 }]
  });
  const sameMonth = data.from.slice(0, 7) === data.to.slice(0, 7);

  titleRows(
    sheet,
    `BẢNG CHẤM CÔNG NGHỈ PHÉP · ${scopeLabel(data)}`,
    "Chỉ tính đơn đã duyệt. P = nghỉ cả ngày · S = nghỉ buổi sáng · C = nghỉ buổi chiều · Chủ nhật tô xám. " +
      `Xuất lúc ${formatViDateTime(data.exportedAt)} bởi ${data.exporterName}.`
  );

  // Header: rows 3 (day "01") and 4 (weekday "T4"); fixed and total columns span both rows (both cells styled, so
  // the merged cell keeps its borders and fill everywhere).
  const twoRowHeader = (column: number, label: string, width: number) => {
    sheet.getColumn(column).width = width;
    sheet.getCell(3, column).value = label;
    styleHeader(sheet.getCell(3, column));
    styleHeader(sheet.getCell(4, column));
    sheet.mergeCells(3, column, 4, column);
  };
  fixedColumns.forEach((column, index) => twoRowHeader(index + 1, column.header, column.width));
  days.forEach((day, index) => {
    const column = firstDayColumn + index;
    sheet.getColumn(column).width = sameMonth ? 4.3 : 6;
    const sunday = isSunday(day);
    const dayCellHeader = sheet.getCell(3, column);
    dayCellHeader.value = dayColumnLabel(day, data.from, data.to);
    styleHeader(dayCellHeader, sunday);
    const weekdayHeader = sheet.getCell(4, column);
    weekdayHeader.value = weekdayLabel(day);
    styleHeader(weekdayHeader, sunday);
  });
  totalColumns.forEach((column, index) => twoRowHeader(firstTotalColumn + index, column.header, column.width));
  sheet.getRow(3).height = 18;
  sheet.getRow(4).height = 20;

  const rows = buildAttendanceRows(data.people, data.requests, data.from, data.to);
  rows.forEach((person, index) => {
    const row = sheet.getRow(5 + index);
    row.getCell(1).value = index + 1;
    row.getCell(2).value = safeText(person.displayName);
    row.getCell(3).value = person.teamName ? safeText(person.teamName) : null;
    days.forEach((day, dayIndex) => {
      row.getCell(firstDayColumn + dayIndex).value = person.marks.get(day) ?? null;
    });
    const totals = [person.totals.totalDays, person.totals.fullDays, person.totals.mornings, person.totals.afternoons];
    totals.forEach((value, totalIndex) => {
      row.getCell(firstTotalColumn + totalIndex).value = value;
    });
    for (let column = 1; column <= lastColumn; column += 1) {
      const cell = row.getCell(column);
      cell.border = borders;
      if (column === 2 || column === 3) {
        cell.alignment = { vertical: "middle" };
        continue;
      }
      cell.alignment = { horizontal: "center", vertical: "middle" };
      const day = column >= firstDayColumn && column < firstTotalColumn ? days[column - firstDayColumn]! : null;
      if (day && isSunday(day)) {
        cell.fill = fill(colors.sundayFill);
      }
      if (day && cell.value !== null) {
        cell.font = { bold: true };
      }
      if (column === firstTotalColumn) {
        cell.font = { bold: true };
      }
    }
  });

  printSetup(sheet, Math.max(1, Math.ceil(days.length / 31)), "3:4", `A:${sheet.getColumn(fixedColumns.length).letter}`);
  return sheet;
};

// Sheet 2 — "Chi tiết đơn nghỉ" ----------------------------------------------------------------------------------

type DetailColumn = { header: string; width: number; numFmt?: string; wrap?: boolean; center?: boolean };
const detailColumns: DetailColumn[] = [
  { header: "STT", width: 5, center: true },
  { header: "Họ tên", width: 24 },
  { header: "Email", width: 28 },
  { header: "Team", width: 16 },
  { header: "Từ ngày", width: 11, numFmt: numberFormats.day, center: true },
  { header: "Đến ngày", width: 11, numFmt: numberFormats.day, center: true },
  { header: "Buổi nghỉ", width: 11, center: true },
  { header: "Số ngày trong kỳ", width: 10, center: true },
  { header: "Tổng số ngày của đơn", width: 10, center: true },
  { header: "Lý do", width: 40, wrap: true },
  { header: "Trạng thái", width: 11, center: true },
  { header: "Người duyệt", width: 22 },
  { header: "Thời điểm duyệt", width: 16, numFmt: numberFormats.datetime, center: true },
  { header: "Ghi chú khi duyệt", width: 30, wrap: true },
  { header: "Ngày gửi đơn", width: 16, numFmt: numberFormats.datetime, center: true }
];

const statusColor: Partial<Record<LeaveStatus, string>> = { APPROVED: colors.approved, PENDING: colors.pending, REJECTED: colors.rejected };

const addDetailSheet = (workbook: ExcelJS.Workbook, data: LeaveExportData) => {
  const sheet = workbook.addWorksheet(detailSheetName, { views: [{ state: "frozen", xSplit: 2, ySplit: 3 }] });
  titleRows(
    sheet,
    `CHI TIẾT ĐƠN NGHỈ · ${scopeLabel(data)}`,
    "Đơn đã duyệt, chờ duyệt và bị từ chối có ngày nghỉ trong khoảng xuất (không gồm đơn đã huỷ). " +
      "Số ngày trong kỳ chỉ tính phần nằm trong khoảng xuất; nửa ngày = 0,5."
  );
  detailColumns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width;
    const cell = sheet.getCell(3, index + 1);
    cell.value = column.header;
    styleHeader(cell);
  });
  sheet.getRow(3).height = 30;

  const requests = data.requests
    .filter((request) => request.status !== "CANCELLED")
    .sort((a, b) => compareLeaveDetails({ ...a, displayName: a.person.displayName }, { ...b, displayName: b.person.displayName }));
  requests.forEach((request, index) => {
    const span = { fromDate: request.fromDate, toDate: request.toDate, part: request.part };
    const values: (string | number | Date | null)[] = [
      index + 1,
      safeText(request.person.displayName),
      request.person.email ? safeText(request.person.email) : null,
      request.person.teamName ? safeText(request.person.teamName) : null,
      dayCell(request.fromDate),
      dayCell(request.toDate),
      leavePartLabels[request.part],
      leaveDaysInWindow(span, data.from, data.to),
      leaveSpanDays(span),
      request.note?.trim() ? safeText(request.note.trim()) : noReasonLabel,
      leaveStatusLabels[request.status],
      request.deciderName ? safeText(request.deciderName) : null,
      request.status === "PENDING" ? null : businessDate(request.decidedAt),
      request.decisionNote?.trim() ? safeText(request.decisionNote.trim()) : null,
      businessDate(request.createdAt)
    ];
    const row = sheet.getRow(4 + index);
    values.forEach((value, column) => {
      const spec = detailColumns[column]!;
      const cell = row.getCell(column + 1);
      cell.value = value;
      cell.border = borders;
      cell.alignment = { vertical: "top", wrapText: spec.wrap ?? false, ...(spec.center ? { horizontal: "center" as const } : {}) };
      if (spec.numFmt) {
        cell.numFmt = spec.numFmt;
      }
    });
    const color = statusColor[request.status];
    if (color) {
      row.getCell(11).font = { bold: true, color: { argb: color } };
    }
    if (!request.note?.trim()) {
      row.getCell(10).font = { italic: true, color: { argb: colors.note } };
    }
  });
  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + requests.length, column: detailColumns.length } };
  printSetup(sheet, 1, "3:3");
  return sheet;
};

/** The two-sheet workbook ("Chấm công", "Chi tiết đơn nghỉ"). */
export const buildLeaveAttendanceWorkbook = (data: LeaveExportData) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Nesso Work";
  workbook.created = data.exportedAt;
  workbook.title = `Bảng chấm công nghỉ phép ${data.from} – ${data.to}`;
  addAttendanceSheet(workbook, data);
  addDetailSheet(workbook, data);
  return workbook;
};

/**
 * Builds the whole file first (any failure is still a JSON error), then sends it as an attachment named
 * cham-cong-nghi-phep_<from>_<to>.xlsx.
 */
export const sendLeaveAttendanceWorkbook = async (res: Response, data: LeaveExportData) => {
  const buffer = Buffer.from(await buildLeaveAttendanceWorkbook(data).xlsx.writeBuffer());
  res.status(200);
  res.setHeader("Content-Type", xlsxContentType);
  res.setHeader("Content-Disposition", contentDisposition(leaveExportFilename(data.from, data.to)));
  res.setHeader("Content-Length", String(buffer.length));
  res.setHeader("Cache-Control", "no-store");
  res.end(buffer);
};
