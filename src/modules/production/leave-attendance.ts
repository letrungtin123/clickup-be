import type { LeavePart, LeaveStatus } from "../../contracts/production-leave.js";
import { leaveDaysBetween, type LeaveSpan } from "./leave-rules.js";
import { addDays, isValidDay } from "./time.js";

/**
 * Pure rules of the payroll attendance export ("Bảng chấm công nghỉ phép", PD-057): the day marks of the grid,
 * per-person totals, the part of a request inside the window, labels and ordering. No database, no exceljs.
 * Days are inclusive business calendar days (YYYY-MM-DD, Asia/Ho_Chi_Minh) and carry no time of day.
 */

/** P = nghỉ cả ngày · S = buổi sáng · C = buổi chiều · S+C = a morning and an afternoon request (1 day). */
export type DayMark = "P" | "S" | "C" | "S+C";

export type AttendanceTotals = {
  /** Leave days (half day = 0.5; S+C = 1). */
  totalDays: number;
  /** Days marked P. */
  fullDays: number;
  /** Morning halves (S, and the morning of S+C). */
  mornings: number;
  /** Afternoon halves (C, and the afternoon of S+C). */
  afternoons: number;
};

export type AttendancePerson = { userId: string; displayName: string; email: string | null; teamName: string | null };
export type AttendanceLeave = LeaveSpan & { userId: string; status: LeaveStatus };
export type AttendanceRow = AttendancePerson & { marks: Map<string, DayMark>; totals: AttendanceTotals };

export const leavePartLabels: Record<LeavePart, string> = { FULL_DAY: "Cả ngày", MORNING: "Buổi sáng", AFTERNOON: "Buổi chiều" };
export const leaveStatusLabels: Record<LeaveStatus, string> = {
  APPROVED: "Đã duyệt",
  PENDING: "Chờ duyệt",
  REJECTED: "Từ chối",
  CANCELLED: "Đã huỷ"
};
/** Older requests may have no reason (the reason became required with PD-057). */
export const noReasonLabel = "(không ghi lý do)";

const assertDay = (day: string, name: string) => {
  if (!isValidDay(day)) {
    throw new RangeError(`${name} must be a YYYY-MM-DD calendar day`);
  }
};

/** Every day of the inclusive window [from, to]; empty when `to` < `from`. */
export const windowDays = (from: string, to: string) => {
  assertDay(from, "from");
  assertDay(to, "to");
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
};

const weekdayLabels = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"] as const;

/** "CN", "T2" … "T7" (Vietnamese short weekday of a business day). */
export const weekdayLabel = (day: string) => weekdayLabels[new Date(`${day}T00:00:00Z`).getUTCDay()]!;

export const isSunday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay() === 0;

/** "2026-10-01" → "01/10/2026". */
export const formatViDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

const pad = (value: number) => String(value).padStart(2, "0");

/** An instant as "dd/mm/yyyy HH:mm" in business time (UTC+7, no DST). */
export const formatViDateTime = (at: Date) => {
  const local = new Date(at.getTime() + 7 * 3_600_000);
  return `${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)}/${local.getUTCFullYear()} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
};

/**
 * Header of one day column: "01" when the whole window is in one month, otherwise "01/11" so days of different
 * months never look alike.
 */
export const dayColumnLabel = (day: string, from: string, to: string) =>
  from.slice(0, 7) === to.slice(0, 7) ? day.slice(8, 10) : `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/**
 * Marks of one person's requests inside [from, to]. Callers pass APPROVED requests only (the sheet counts approved
 * leave). FULL_DAY → P on every day of its range; MORNING → S; AFTERNOON → C; a morning and an afternoon request on
 * the same day → S+C. A full day wins over anything else on that day.
 */
export const dayMarks = (spans: readonly LeaveSpan[], from: string, to: string) => {
  assertDay(from, "from");
  assertDay(to, "to");
  const slots = new Map<string, { full: boolean; morning: boolean; afternoon: boolean }>();
  for (const span of spans) {
    assertDay(span.fromDate, "fromDate");
    assertDay(span.toDate, "toDate");
    const start = span.fromDate > from ? span.fromDate : from;
    const end = span.toDate < to ? span.toDate : to;
    for (let day = start; day <= end; day = addDays(day, 1)) {
      const slot = slots.get(day) ?? { full: false, morning: false, afternoon: false };
      if (span.part === "FULL_DAY") {
        slot.full = true;
      } else if (span.part === "MORNING") {
        slot.morning = true;
      } else {
        slot.afternoon = true;
      }
      slots.set(day, slot);
    }
  }
  const marks = new Map<string, DayMark>();
  for (const [day, slot] of [...slots].sort(([a], [b]) => (a < b ? -1 : 1))) {
    marks.set(day, slot.full ? "P" : slot.morning && slot.afternoon ? "S+C" : slot.morning ? "S" : "C");
  }
  return marks;
};

/** Totals of a person's marks: total days (half = 0.5), full days, morning halves, afternoon halves. */
export const attendanceTotals = (marks: Iterable<DayMark>): AttendanceTotals => {
  const totals: AttendanceTotals = { totalDays: 0, fullDays: 0, mornings: 0, afternoons: 0 };
  for (const mark of marks) {
    if (mark === "P") {
      totals.fullDays += 1;
      totals.totalDays += 1;
    } else if (mark === "S") {
      totals.mornings += 1;
      totals.totalDays += 0.5;
    } else if (mark === "C") {
      totals.afternoons += 1;
      totals.totalDays += 0.5;
    } else {
      totals.mornings += 1;
      totals.afternoons += 1;
      totals.totalDays += 1;
    }
  }
  return totals;
};

/** Days of one request inside the inclusive window (half day = 0.5), whatever its status — "Số ngày trong kỳ". */
export const leaveDaysInWindow = (span: LeaveSpan, from: string, to: string) => leaveDaysBetween([span], from, to);

const collator = new Intl.Collator("vi", { sensitivity: "base", numeric: true });

/** By team name (people without a team last), then display name, then id — the order of the attendance sheet. */
export const compareAttendancePeople = (a: AttendancePerson, b: AttendancePerson) => {
  if (a.teamName !== b.teamName) {
    if (a.teamName === null) {
      return 1;
    }
    if (b.teamName === null) {
      return -1;
    }
    const byTeam = collator.compare(a.teamName, b.teamName);
    if (byTeam !== 0) {
      return byTeam;
    }
  }
  return collator.compare(a.displayName, b.displayName) || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);
};

/** By first leave day, then display name — the order of the request detail sheet. */
export const compareLeaveDetails = (
  a: { fromDate: string; displayName: string; createdAt: Date },
  b: { fromDate: string; displayName: string; createdAt: Date }
) =>
  (a.fromDate < b.fromDate ? -1 : a.fromDate > b.fromDate ? 1 : 0) ||
  collator.compare(a.displayName, b.displayName) ||
  a.createdAt.getTime() - b.createdAt.getTime();

/**
 * One attendance row per person — every member in `people` (even without leave: it is an attendance sheet) plus
 * anyone else with APPROVED leave in the window (e.g. someone who left the organization mid-month) — with the marks
 * and totals of their APPROVED requests only, sorted by team then name.
 */
export const buildAttendanceRows = (
  people: readonly AttendancePerson[],
  leaves: readonly (AttendanceLeave & { person: AttendancePerson })[],
  from: string,
  to: string
): AttendanceRow[] => {
  const everyone = new Map<string, AttendancePerson>(people.map((person) => [person.userId, person]));
  const approved = new Map<string, LeaveSpan[]>();
  for (const leave of leaves) {
    if (leave.status !== "APPROVED") {
      continue;
    }
    if (!everyone.has(leave.userId)) {
      everyone.set(leave.userId, leave.person);
    }
    const spans = approved.get(leave.userId) ?? [];
    spans.push({ fromDate: leave.fromDate, toDate: leave.toDate, part: leave.part });
    approved.set(leave.userId, spans);
  }
  return [...everyone.values()].sort(compareAttendancePeople).map((person) => {
    const marks = dayMarks(approved.get(person.userId) ?? [], from, to);
    return { ...person, marks, totals: attendanceTotals(marks.values()) };
  });
};
