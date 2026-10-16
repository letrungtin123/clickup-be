import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  attendanceTotals,
  buildAttendanceRows,
  compareAttendancePeople,
  dayColumnLabel,
  dayMarks,
  formatViDateTime,
  isSunday,
  leaveDaysInWindow,
  weekdayLabel,
  windowDays,
  type AttendancePerson
} from "./leave-attendance.js";
import { buildLeaveAttendanceWorkbook, leaveExportFilename, teamLabel, type LeaveExportData, type LeaveExportRequest } from "./leave-export.js";
import type { LeaveSpan } from "./leave-rules.js";

/**
 * PD-057 payroll attendance export: the pure grid / totals rules and the workbook built from fixture rows (read back
 * with exceljs). Fake names, ids and e-mails only — the repository is public.
 */

const full = (fromDate: string, toDate: string): LeaveSpan => ({ fromDate, toDate, part: "FULL_DAY" });
const half = (day: string, part: "MORNING" | "AFTERNOON"): LeaveSpan => ({ fromDate: day, toDate: day, part });

describe("day marks and totals (PD-057)", () => {
  it("marks P / S / C / S+C and clips to the window", () => {
    const marks = dayMarks(
      [full("2026-09-29", "2026-10-02"), half("2026-10-05", "MORNING"), half("2026-10-06", "MORNING"), half("2026-10-06", "AFTERNOON"), half("2026-10-07", "AFTERNOON")],
      "2026-10-01",
      "2026-10-31"
    );
    expect(Object.fromEntries(marks)).toEqual({
      "2026-10-01": "P",
      "2026-10-02": "P",
      "2026-10-05": "S",
      "2026-10-06": "S+C",
      "2026-10-07": "C"
    });
    expect(attendanceTotals(marks.values())).toEqual({ totalDays: 4, fullDays: 2, mornings: 2, afternoons: 2 });
  });

  it("a full day wins over a half day on the same day; requests outside the window add nothing", () => {
    const marks = dayMarks([full("2026-10-03", "2026-10-03"), half("2026-10-03", "AFTERNOON"), full("2026-11-01", "2026-11-03")], "2026-10-01", "2026-10-31");
    expect(Object.fromEntries(marks)).toEqual({ "2026-10-03": "P" });
    expect(attendanceTotals(marks.values())).toEqual({ totalDays: 1, fullDays: 1, mornings: 0, afternoons: 0 });
    expect(attendanceTotals([])).toEqual({ totalDays: 0, fullDays: 0, mornings: 0, afternoons: 0 });
  });

  it("counts every calendar day of a full-day range, Sundays included (same as the request's `days`)", () => {
    // 2026-10-03 is a Saturday, 2026-10-04 a Sunday.
    expect(isSunday("2026-10-04")).toBe(true);
    expect(isSunday("2026-10-03")).toBe(false);
    const marks = dayMarks([full("2026-10-03", "2026-10-05")], "2026-10-01", "2026-10-31");
    expect(attendanceTotals(marks.values()).totalDays).toBe(3);
  });

  it("days of one request inside the window", () => {
    expect(leaveDaysInWindow(full("2026-09-29", "2026-10-02"), "2026-10-01", "2026-10-31")).toBe(2);
    expect(leaveDaysInWindow(full("2026-10-30", "2026-11-04"), "2026-10-01", "2026-10-31")).toBe(2);
    expect(leaveDaysInWindow(half("2026-10-12", "AFTERNOON"), "2026-10-01", "2026-10-31")).toBe(0.5);
    expect(leaveDaysInWindow(full("2026-11-01", "2026-11-02"), "2026-10-01", "2026-10-31")).toBe(0);
  });

  it("rejects malformed days instead of looping", () => {
    expect(() => dayMarks([], "2026-10-01", "2026-10-32")).toThrow(RangeError);
    expect(() => windowDays("2026-02-30", "2026-03-01")).toThrow(RangeError);
  });
});

describe("labels and order", () => {
  it("lists the window's days with Vietnamese weekdays", () => {
    expect(windowDays("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(windowDays("2026-10-02", "2026-10-01")).toEqual([]);
    expect(windowDays("2026-10-01", "2026-10-07").map(weekdayLabel)).toEqual(["T5", "T6", "T7", "CN", "T2", "T3", "T4"]);
    expect(dayColumnLabel("2026-10-05", "2026-10-01", "2026-10-31")).toBe("05");
    expect(dayColumnLabel("2026-11-05", "2026-10-26", "2026-11-25")).toBe("05/11");
  });

  it("formats instants in business time", () => {
    expect(formatViDateTime(new Date("2026-10-16T02:30:00Z"))).toBe("16/10/2026 09:30");
    expect(formatViDateTime(new Date("2026-10-16T17:05:00Z"))).toBe("17/10/2026 00:05");
  });

  it("sorts by team name (no team last), then name", () => {
    const person = (userId: string, displayName: string, teamName: string | null): AttendancePerson => ({ userId, displayName, email: null, teamName });
    const people = [person("1", "Bảo", null), person("2", "Đức", "Team B"), person("3", "An", "Team B"), person("4", "Yến", "Team A"), person("5", "an", null)];
    // Team A, then Team B (An before Đức), then people without a team (accents and case do not matter: "an" before "Bảo").
    expect([...people].sort(compareAttendancePeople).map((p) => p.userId)).toEqual(["4", "3", "2", "5", "1"]);
  });

  it("builds one row per member, adds people with approved leave who are not listed, ignores non-approved leave", () => {
    const member = (userId: string, displayName: string): AttendancePerson => ({ userId, displayName, email: null, teamName: null });
    const rows = buildAttendanceRows(
      [member("u1", "An"), member("u2", "Bình")],
      [
        { userId: "u1", person: member("u1", "An"), status: "PENDING", ...full("2026-10-05", "2026-10-05") },
        { userId: "u1", person: member("u1", "An"), status: "REJECTED", ...full("2026-10-06", "2026-10-06") },
        { userId: "u3", person: member("u3", "Cường"), status: "APPROVED", ...half("2026-10-07", "MORNING") },
        { userId: "u4", person: member("u4", "Dung"), status: "PENDING", ...half("2026-10-07", "MORNING") }
      ],
      "2026-10-01",
      "2026-10-31"
    );
    expect(rows.map((row) => [row.userId, row.totals.totalDays, row.marks.size])).toEqual([
      ["u1", 0, 0],
      ["u2", 0, 0],
      ["u3", 0.5, 1]
    ]);
  });
});

// Workbook ------------------------------------------------------------------------------------------------------

const ids = {
  an: "00000000-0000-4000-8000-0000000000a1",
  binh: "00000000-0000-4000-8000-0000000000b2",
  chi: "00000000-0000-4000-8000-0000000000c3",
  dung: "00000000-0000-4000-8000-0000000000d4",
  em: "00000000-0000-4000-8000-0000000000e5"
};
const person = (userId: string, displayName: string, teamName: string | null): AttendancePerson => ({
  userId,
  displayName,
  email: `${displayName.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "")}@example.test`,
  teamName
});
const an = person(ids.an, "An", "Team A");
const binh = person(ids.binh, "Bình", "Team B");
const chi = person(ids.chi, "Chi", null);
const dung = person(ids.dung, "Dũng", "Team A");
const em = person(ids.em, "Em", "Team B");

const request = (who: AttendancePerson, span: LeaveSpan, overrides: Partial<LeaveExportRequest> = {}): LeaveExportRequest => ({
  userId: who.userId,
  person: who,
  ...span,
  status: "APPROVED",
  note: "Việc gia đình",
  deciderName: "Quản trị A",
  decidedAt: new Date("2026-09-28T03:00:00Z"),
  decisionNote: null,
  createdAt: new Date("2026-09-27T01:15:00Z"),
  ...overrides
});

const fixture: LeaveExportData = {
  from: "2026-10-01",
  to: "2026-10-31",
  teamName: null,
  exportedAt: new Date("2026-10-16T02:30:00Z"),
  exporterName: "Quản trị A",
  people: [binh, chi, dung, an],
  requests: [
    request(an, full("2026-09-29", "2026-10-02")),
    request(an, half("2026-10-05", "MORNING"), { note: "  " }),
    request(an, half("2026-10-06", "MORNING")),
    request(an, half("2026-10-06", "AFTERNOON"), { note: "=HYPERLINK(\"x\")" }),
    request(dung, half("2026-10-07", "AFTERNOON")),
    request(dung, full("2026-10-20", "2026-10-21"), { status: "PENDING", deciderName: null, decidedAt: null }),
    request(binh, full("2026-10-10", "2026-10-10"), { status: "REJECTED", decisionNote: "Trùng lịch giao hàng", note: null }),
    request(binh, full("2026-10-12", "2026-10-12"), { status: "CANCELLED" }),
    // Not in `people` (left the organization mid-month) but approved leave in the window: still on the sheet.
    request(em, full("2026-10-03", "2026-10-04"))
  ]
};

const readBack = async (data: LeaveExportData) => {
  const buffer = await buildLeaveAttendanceWorkbook(data).xlsx.writeBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
};

/** Column of a day of October 2026 on the "Chấm công" sheet (A STT, B Họ tên, C Team, D = day 1). */
const dayColumn = (day: number) => 3 + day;
const totalsColumn = dayColumn(31) + 1;

describe("attendance workbook (PD-057)", () => {
  it("names the file cham-cong-nghi-phep_<from>_<to>.xlsx", () => {
    expect(leaveExportFilename("2026-10-01", "2026-10-31")).toBe("cham-cong-nghi-phep_2026-10-01_2026-10-31.xlsx");
  });

  it("sheet Chấm công: title, legend, two-line day header, one row per person, marks and totals", async () => {
    const workbook = await readBack(fixture);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Chấm công", "Chi tiết đơn nghỉ"]);
    const sheet = workbook.getWorksheet("Chấm công")!;

    expect(sheet.getCell("A1").value).toBe("BẢNG CHẤM CÔNG NGHỈ PHÉP · 01/10/2026 – 31/10/2026");
    expect(sheet.getCell("A2").value).toBe(
      "Chỉ tính đơn đã duyệt. P = nghỉ cả ngày · S = nghỉ buổi sáng · C = nghỉ buổi chiều · Chủ nhật tô xám. Xuất lúc 16/10/2026 09:30 bởi Quản trị A."
    );
    expect([sheet.getCell("A3").value, sheet.getCell("B3").value, sheet.getCell("C3").value]).toEqual(["STT", "Họ tên", "Team"]);
    expect(sheet.getCell("A4").isMerged).toBe(true);
    expect(sheet.getCell(3, dayColumn(1)).value).toBe("01");
    expect(sheet.getCell(4, dayColumn(1)).value).toBe("T5");
    expect(sheet.getCell(3, dayColumn(31)).value).toBe("31");
    expect([0, 1, 2, 3].map((offset) => sheet.getCell(3, totalsColumn + offset).value)).toEqual(["Tổng ngày nghỉ", "Nghỉ cả ngày", "Buổi sáng", "Buổi chiều"]);

    // Team A (An, Dũng), Team B (Bình, Em — not a current member), then no team (Chi).
    const names = [5, 6, 7, 8, 9].map((row) => sheet.getCell(row, 2).value);
    expect(names).toEqual(["An", "Dũng", "Bình", "Em", "Chi"]);
    expect([5, 6, 7, 8, 9].map((row) => sheet.getCell(row, 1).value)).toEqual([1, 2, 3, 4, 5]);
    expect(sheet.getCell(5, 3).value).toBe("Team A");
    expect(sheet.getCell(9, 3).value).toBeNull();

    const marksOf = (row: number) => {
      const marks: Record<number, ExcelJS.CellValue> = {};
      for (let day = 1; day <= 31; day += 1) {
        const value = sheet.getCell(row, dayColumn(day)).value;
        if (value !== null) {
          marks[day] = value;
        }
      }
      return marks;
    };
    expect(marksOf(5)).toEqual({ 1: "P", 2: "P", 5: "S", 6: "S+C" });
    expect(marksOf(6)).toEqual({ 7: "C" }); // the PENDING request is not counted
    expect(marksOf(7)).toEqual({}); // REJECTED / CANCELLED are not counted
    expect(marksOf(8)).toEqual({ 3: "P", 4: "P" });
    expect(marksOf(9)).toEqual({});

    const totalsOf = (row: number) => [0, 1, 2, 3].map((offset) => sheet.getCell(row, totalsColumn + offset).value);
    expect(totalsOf(5)).toEqual([3.5, 2, 2, 1]);
    expect(totalsOf(6)).toEqual([0.5, 0, 0, 1]);
    expect(totalsOf(7)).toEqual([0, 0, 0, 0]);
    expect(totalsOf(8)).toEqual([2, 2, 0, 0]);
    expect(totalsOf(9)).toEqual([0, 0, 0, 0]);
    expect(sheet.rowCount).toBe(9);
  });

  it("sheet Chấm công: Sundays shaded grey, borders, frozen names and header, A4 landscape", async () => {
    const sheet = (await readBack(fixture)).getWorksheet("Chấm công")!;
    const fillOf = (row: number, column: number) => (sheet.getCell(row, column).fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb;
    // 2026-10-04 is a Sunday, 2026-10-05 a Monday.
    expect(sheet.getCell(4, dayColumn(4)).value).toBe("CN");
    for (const row of [3, 4, 5, 9]) {
      expect(fillOf(row, dayColumn(4))).toBe("FFE7E6E6");
      expect(fillOf(row, dayColumn(11))).toBe("FFE7E6E6");
    }
    expect(fillOf(5, dayColumn(5))).toBeUndefined();
    expect(fillOf(3, dayColumn(5))).toBe("FFDDEBF7");
    expect(sheet.getCell(5, dayColumn(5)).border?.left?.style).toBe("thin");
    expect(sheet.views[0]).toMatchObject({ state: "frozen", xSplit: 3, ySplit: 4 });
    expect(sheet.pageSetup).toMatchObject({ paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1 });
  });

  it("sheet Chi tiết đơn nghỉ: every request but cancelled ones, by first day then name, with reason, status and approver", async () => {
    const sheet = (await readBack(fixture)).getWorksheet("Chi tiết đơn nghỉ")!;
    expect(sheet.getCell("A1").value).toBe("CHI TIẾT ĐƠN NGHỈ · 01/10/2026 – 31/10/2026");
    const header = Array.from({ length: 15 }, (_, index) => sheet.getCell(3, index + 1).value);
    expect(header).toEqual([
      "STT",
      "Họ tên",
      "Email",
      "Team",
      "Từ ngày",
      "Đến ngày",
      "Buổi nghỉ",
      "Số ngày trong kỳ",
      "Tổng số ngày của đơn",
      "Lý do",
      "Trạng thái",
      "Người duyệt",
      "Thời điểm duyệt",
      "Ghi chú khi duyệt",
      "Ngày gửi đơn"
    ]);
    const row = (index: number) => Array.from({ length: 15 }, (_, column) => sheet.getCell(4 + index, column + 1).value);
    expect(sheet.rowCount).toBe(3 + 8); // 9 requests, the CANCELLED one left out

    expect(row(0)).toEqual([
      1,
      "An",
      "an@example.test",
      "Team A",
      new Date("2026-09-29T00:00:00Z"),
      new Date("2026-10-02T00:00:00Z"),
      "Cả ngày",
      2,
      4,
      "Việc gia đình",
      "Đã duyệt",
      "Quản trị A",
      new Date("2026-09-28T10:00:00Z"), // 03:00 UTC = 10:00 in Vietnam
      null,
      new Date("2026-09-27T08:15:00Z")
    ]);
    expect(sheet.getCell(4, 5).numFmt).toBe("dd/mm/yyyy");
    expect(sheet.getCell(4, 13).numFmt).toBe("dd/mm/yyyy hh:mm");
    expect(sheet.getCell(4, 10).alignment?.wrapText).toBe(true);

    const byName = (name: string) => [...Array(8).keys()].map(row).filter((values) => values[1] === name);
    // Order: by first day, then name.
    expect([...Array(8).keys()].map((index) => [row(index)[1], (row(index)[4] as Date).toISOString().slice(0, 10)])).toEqual([
      ["An", "2026-09-29"],
      ["Em", "2026-10-03"],
      ["An", "2026-10-05"],
      ["An", "2026-10-06"],
      ["An", "2026-10-06"],
      ["Dũng", "2026-10-07"],
      ["Bình", "2026-10-10"],
      ["Dũng", "2026-10-20"]
    ]);
    const [rejected] = byName("Bình");
    expect(rejected!.slice(6, 14)).toEqual(["Cả ngày", 1, 1, "(không ghi lý do)", "Từ chối", "Quản trị A", new Date("2026-09-28T10:00:00Z"), "Trùng lịch giao hàng"]);
    const pending = byName("Dũng")[1]!;
    expect(pending.slice(6, 14)).toEqual(["Cả ngày", 2, 2, "Việc gia đình", "Chờ duyệt", null, null, null]);
    const halves = byName("An").slice(1);
    expect(halves.map((values) => [values[6], values[7], values[8], values[9]])).toEqual([
      ["Buổi sáng", 0.5, 0.5, "(không ghi lý do)"],
      ["Buổi sáng", 0.5, 0.5, "Việc gia đình"],
      // Formula-looking text is neutralised.
      ["Buổi chiều", 0.5, 0.5, "'=HYPERLINK(\"x\")"]
    ]);
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 3 });
  });

  it("states the team filter and spans months with dd/mm day headers", async () => {
    const workbook = await readBack({ ...fixture, from: "2026-09-26", to: "2026-10-25", teamName: "Team A", people: [an, dung], requests: fixture.requests.slice(0, 6) });
    const sheet = workbook.getWorksheet("Chấm công")!;
    expect(sheet.getCell("A1").value).toBe("BẢNG CHẤM CÔNG NGHỈ PHÉP · 26/09/2026 – 25/10/2026 · Team A");
    expect(sheet.getCell(3, 4).value).toBe("26/09");
    expect(sheet.getCell(4, 4).value).toBe("T7");
    expect(workbook.getWorksheet("Chi tiết đơn nghỉ")!.getCell("A1").value).toBe("CHI TIẾT ĐƠN NGHỈ · 26/09/2026 – 25/10/2026 · Team A");
    // The 29/09 – 02/10 request now counts all 4 days.
    expect(workbook.getWorksheet("Chi tiết đơn nghỉ")!.getCell(4, 8).value).toBe(4);
    // "Team <name>", without doubling the word.
    expect(teamLabel("Ảnh 1")).toBe("Team Ảnh 1");
    expect(teamLabel("team retouch")).toBe("team retouch");
    expect(teamLabel("Teamwork")).toBe("Team Teamwork");
  });

  it("handles a one-year window", async () => {
    const workbook = await readBack({ ...fixture, from: "2026-01-01", to: "2026-12-31" });
    const sheet = workbook.getWorksheet("Chấm công")!;
    expect(sheet.getCell(3, 3 + 365).value).toBe("31/12");
    expect(sheet.getCell(3, 3 + 366).value).toBe("Tổng ngày nghỉ");
    expect(sheet.pageSetup.fitToWidth).toBe(12);
  });
});
