import { leaveLimits, type LeavePart } from "../../contracts/production-leave.js";
import { AppError } from "../../lib/app-error.js";
import { addDays, isValidDay } from "./time.js";

/**
 * Pure leave-calendar rules (SPEC §6.3). Days are inclusive business calendar days (YYYY-MM-DD,
 * Asia/Ho_Chi_Minh); they carry no time of day, so UTC arithmetic on them is exact.
 */

export type LeaveSpan = { fromDate: string; toDate: string; part: LeavePart };
export type LeaveDayOptions = {
  /** Count only working days (Monday–Saturday, SPEC §6.3 "ngày làm = T2–T7"). Default: every calendar day. */
  workdaysOnly?: boolean;
};

const dayMs = 86_400_000;

/** Calendar days from `from` to `to` (negative when `to` is earlier). */
export const dayDiff = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs);

/** Monday–Saturday are working days; Sunday is not. */
export const isWorkday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay() !== 0;

const assertDay = (day: string, name: string) => {
  if (!isValidDay(day)) {
    throw new RangeError(`${name} must be a YYYY-MM-DD calendar day`);
  }
};

/** Working days (Monday–Saturday) in the inclusive window [from, to]; 0 when `to` < `from`. */
export const workdaysBetween = (from: string, to: string) => {
  assertDay(from, "from");
  assertDay(to, "to");
  let count = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    if (isWorkday(day)) {
      count += 1;
    }
  }
  return count;
};

/** Days one request covers: every day of a FULL_DAY range, 0.5 for a half day. */
export const leaveSpanDays = (span: LeaveSpan) => (span.part === "FULL_DAY" ? dayDiff(span.fromDate, span.toDate) + 1 : 0.5);

/**
 * Leave days of `requests` inside the inclusive window [from, to], clipped to the window.
 * A half day counts 0.5; a day never counts more than 1 even if requests overlap (MORNING +
 * AFTERNOON = 1). Callers pass only the requests that should count (normally APPROVED ones).
 */
export const leaveDaysBetween = (requests: readonly LeaveSpan[], from: string, to: string, options: LeaveDayOptions = {}) => {
  assertDay(from, "from");
  assertDay(to, "to");
  const perDay = new Map<string, number>();
  for (const request of requests) {
    assertDay(request.fromDate, "fromDate");
    assertDay(request.toDate, "toDate");
    const start = request.fromDate > from ? request.fromDate : from;
    const end = request.toDate < to ? request.toDate : to;
    const share = request.part === "FULL_DAY" ? 1 : 0.5;
    for (let day = start; day <= end; day = addDays(day, 1)) {
      if (options.workdaysOnly && !isWorkday(day)) {
        continue;
      }
      perDay.set(day, Math.min(1, (perDay.get(day) ?? 0) + share));
    }
  }
  let total = 0;
  for (const value of perDay.values()) {
    total += value;
  }
  return total;
};

const invalid = (code: string, message: string) => new AppError(code, message, 400);

/** Validates a new request against `today` (business day). Throws AppError (400) with a Vietnamese message. */
export const assertValidNewLeave = (span: LeaveSpan, today: string) => {
  if (!isValidDay(span.fromDate) || !isValidDay(span.toDate)) {
    throw invalid("LEAVE_DATE_INVALID", "Ngày nghỉ không hợp lệ.");
  }
  if (span.toDate < span.fromDate) {
    throw invalid("LEAVE_RANGE_INVALID", "Ngày kết thúc phải sau hoặc trùng ngày bắt đầu.");
  }
  if (span.part !== "FULL_DAY" && span.fromDate !== span.toDate) {
    throw invalid("LEAVE_HALF_DAY_RANGE", "Nghỉ nửa ngày chỉ áp dụng cho đơn nghỉ trong một ngày.");
  }
  if (dayDiff(span.fromDate, span.toDate) + 1 > leaveLimits.maxRequestDays) {
    throw invalid("LEAVE_TOO_LONG", `Mỗi đơn nghỉ tối đa ${leaveLimits.maxRequestDays} ngày.`);
  }
  if (dayDiff(span.fromDate, today) > leaveLimits.maxPastDays) {
    // PD-051: maxPastDays is 0 — never in the past.
    throw invalid("LEAVE_TOO_OLD", "Không thể xin nghỉ cho ngày đã qua — chọn từ hôm nay trở đi.");
  }
  if (dayDiff(today, span.fromDate) > leaveLimits.maxFutureDays) {
    throw invalid("LEAVE_TOO_FAR", `Chỉ có thể xin nghỉ trước tối đa ${leaveLimits.maxFutureDays} ngày.`);
  }
};

/**
 * Validates a calendar window — the calendar (`action` "xem") and the attendance export ("xuất", PD-057), at most
 * leaveLimits.maxCalendarDays inclusive days. Throws AppError (400) with a Vietnamese message.
 */
export const assertValidCalendarWindow = (from: string, to: string, action: "xem" | "xuất" = "xem") => {
  if (!isValidDay(from) || !isValidDay(to)) {
    throw invalid("LEAVE_DATE_INVALID", "Khoảng ngày không hợp lệ.");
  }
  if (to < from) {
    throw invalid("LEAVE_RANGE_INVALID", "Ngày kết thúc phải sau hoặc trùng ngày bắt đầu.");
  }
  if (dayDiff(from, to) + 1 > leaveLimits.maxCalendarDays) {
    throw invalid("LEAVE_WINDOW_TOO_LONG", `Chỉ ${action} được tối đa ${leaveLimits.maxCalendarDays} ngày mỗi lần.`);
  }
};

/**
 * Only a leave that has not started yet can be cancelled (PD-059, owner 2026-10-16: a past or ongoing leave has
 * happened, it stays on record — ADMIN included): its owner or an ADMIN, PENDING/APPROVED requests only.
 */
export const canCancelLeave = (
  request: { status: string; fromDate: string; own: boolean },
  viewer: { admin: boolean; today: string }
) =>
  (request.status === "PENDING" || request.status === "APPROVED") &&
  request.fromDate > viewer.today &&
  (viewer.admin || request.own);

/**
 * Only the roles of the `leave_approval` feature (`decider`, PD-065; by default Quản trị, organization superadmins always)
 * decide, and only PENDING requests — their own too (PD-057: Leaders no longer approve; they still see pending requests
 * read-only).
 */
export const canDecideLeave = (request: { status: string }, viewer: { decider: boolean }) => request.status === "PENDING" && viewer.decider;
