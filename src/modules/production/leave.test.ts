import { describe, expect, it } from "vitest";

import { AppError } from "../../lib/app-error.js";
import {
  assertValidCalendarWindow,
  assertValidNewLeave,
  canCancelLeave,
  canDecideLeave,
  dayDiff,
  isWorkday,
  leaveDaysBetween,
  leaveSpanDays,
  workdaysBetween,
  type LeaveSpan
} from "./leave-rules.js";

const full = (fromDate: string, toDate: string): LeaveSpan => ({ fromDate, toDate, part: "FULL_DAY" });
const half = (day: string, part: "MORNING" | "AFTERNOON"): LeaveSpan => ({ fromDate: day, toDate: day, part });

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return { code: (error as AppError).code, status: (error as AppError).statusCode };
  }
  return null;
};

describe("leaveDaysBetween (SPEC §6.3, KPI pro-rata)", () => {
  it("counts inclusive calendar days of full-day requests", () => {
    expect(leaveDaysBetween([full("2026-10-12", "2026-10-14")], "2026-10-01", "2026-10-31")).toBe(3);
    expect(leaveDaysBetween([full("2026-10-12", "2026-10-12")], "2026-10-01", "2026-10-31")).toBe(1);
  });

  it("counts a half day as 0.5 and a morning + afternoon of the same day as 1", () => {
    expect(leaveDaysBetween([half("2026-10-12", "MORNING")], "2026-10-01", "2026-10-31")).toBe(0.5);
    expect(leaveDaysBetween([half("2026-10-12", "MORNING"), half("2026-10-12", "AFTERNOON")], "2026-10-01", "2026-10-31")).toBe(1);
    expect(leaveDaysBetween([full("2026-10-12", "2026-10-13"), half("2026-10-20", "AFTERNOON")], "2026-10-01", "2026-10-31")).toBe(2.5);
  });

  it("clips requests to the window (KPI period 26/09–25/10)", () => {
    const requests = [full("2026-09-24", "2026-09-28"), full("2026-10-24", "2026-10-30"), half("2026-09-25", "MORNING")];
    // 26, 27, 28 Sep + 24, 25 Oct; the half day on 25 Sep is outside.
    expect(leaveDaysBetween(requests, "2026-09-26", "2026-10-25")).toBe(5);
    expect(leaveDaysBetween([full("2026-10-01", "2026-10-31")], "2026-10-10", "2026-10-10")).toBe(1);
  });

  it("ignores requests outside the window and empty windows", () => {
    expect(leaveDaysBetween([full("2026-08-01", "2026-08-05")], "2026-10-01", "2026-10-31")).toBe(0);
    expect(leaveDaysBetween([full("2026-10-01", "2026-10-05")], "2026-10-10", "2026-10-01")).toBe(0);
    expect(leaveDaysBetween([], "2026-10-01", "2026-10-31")).toBe(0);
  });

  it("never counts a day twice when requests overlap", () => {
    expect(leaveDaysBetween([full("2026-10-01", "2026-10-03"), full("2026-10-02", "2026-10-04")], "2026-10-01", "2026-10-31")).toBe(4);
    expect(leaveDaysBetween([full("2026-10-02", "2026-10-02"), half("2026-10-02", "MORNING")], "2026-10-01", "2026-10-31")).toBe(1);
  });

  it("crosses month and year boundaries", () => {
    expect(leaveDaysBetween([full("2026-12-30", "2027-01-02")], "2026-12-01", "2027-01-31")).toBe(4);
    expect(leaveDaysBetween([full("2028-02-27", "2028-03-01")], "2028-02-01", "2028-02-29")).toBe(3);
  });

  it("optionally counts working days only (Monday–Saturday)", () => {
    // 2026-10-10 is a Saturday, 2026-10-11 a Sunday.
    expect(isWorkday("2026-10-10")).toBe(true);
    expect(isWorkday("2026-10-11")).toBe(false);
    expect(leaveDaysBetween([full("2026-10-09", "2026-10-12")], "2026-10-01", "2026-10-31", { workdaysOnly: true })).toBe(3);
    expect(leaveDaysBetween([half("2026-10-11", "MORNING")], "2026-10-01", "2026-10-31", { workdaysOnly: true })).toBe(0);
  });

  it("rejects malformed days instead of looping", () => {
    expect(() => leaveDaysBetween([], "2026-10-01", "2026-10-32")).toThrow(RangeError);
    expect(() => leaveDaysBetween([full("2026-02-30", "2026-03-01")], "2026-02-01", "2026-03-31")).toThrow(RangeError);
  });
});

describe("workdaysBetween / leaveSpanDays / dayDiff", () => {
  it("counts Monday–Saturday", () => {
    // October 2026 has 31 days and 4 Sundays (4, 11, 18, 25).
    expect(workdaysBetween("2026-10-01", "2026-10-31")).toBe(27);
    expect(workdaysBetween("2026-10-11", "2026-10-11")).toBe(0);
    expect(workdaysBetween("2026-10-12", "2026-10-11")).toBe(0);
  });

  it("measures requests", () => {
    expect(leaveSpanDays(full("2026-10-01", "2026-10-31"))).toBe(31);
    expect(leaveSpanDays(half("2026-10-01", "AFTERNOON"))).toBe(0.5);
    expect(dayDiff("2026-10-25", "2026-11-01")).toBe(7);
    expect(dayDiff("2026-11-01", "2026-10-25")).toBe(-7);
  });
});

describe("assertValidNewLeave", () => {
  const today = "2026-10-09";

  it("accepts full-day ranges and single-day half days", () => {
    expect(codeOf(() => assertValidNewLeave(full("2026-10-12", "2026-11-11"), today))).toBeNull();
    expect(codeOf(() => assertValidNewLeave(half("2026-10-12", "MORNING"), today))).toBeNull();
    expect(codeOf(() => assertValidNewLeave(full("2026-09-09", "2026-09-09"), today))).toBeNull();
  });

  it("rejects invalid or reversed dates", () => {
    expect(codeOf(() => assertValidNewLeave(full("2026-02-30", "2026-03-01"), today))).toEqual({ code: "LEAVE_DATE_INVALID", status: 400 });
    expect(codeOf(() => assertValidNewLeave(full("2026-10-12", "2026-10-11"), today))?.code).toBe("LEAVE_RANGE_INVALID");
  });

  it("allows half days only for one-day requests", () => {
    expect(codeOf(() => assertValidNewLeave({ fromDate: "2026-10-12", toDate: "2026-10-13", part: "AFTERNOON" }, today))?.code).toBe(
      "LEAVE_HALF_DAY_RANGE"
    );
  });

  it("limits length (31 days), the past (30 days) and the future (366 days)", () => {
    expect(codeOf(() => assertValidNewLeave(full("2026-10-12", "2026-11-12"), today))?.code).toBe("LEAVE_TOO_LONG");
    expect(codeOf(() => assertValidNewLeave(full("2026-09-08", "2026-09-08"), today))?.code).toBe("LEAVE_TOO_OLD");
    expect(codeOf(() => assertValidNewLeave(full("2027-10-11", "2027-10-11"), today))?.code).toBe("LEAVE_TOO_FAR");
  });
});

describe("assertValidCalendarWindow", () => {
  it("allows up to 93 days", () => {
    expect(codeOf(() => assertValidCalendarWindow("2026-10-01", "2027-01-01"))).toBeNull();
    expect(codeOf(() => assertValidCalendarWindow("2026-10-01", "2027-01-02"))?.code).toBe("LEAVE_WINDOW_TOO_LONG");
    expect(codeOf(() => assertValidCalendarWindow("2026-10-02", "2026-10-01"))?.code).toBe("LEAVE_RANGE_INVALID");
    expect(codeOf(() => assertValidCalendarWindow("2026-10-01", "2026-1-31"))?.code).toBe("LEAVE_DATE_INVALID");
  });
});

describe("cancel / decide permissions", () => {
  const today = "2026-10-09";

  it("owner cancels PENDING/APPROVED before the start day; ADMIN anytime", () => {
    expect(canCancelLeave({ status: "APPROVED", fromDate: "2026-10-10", own: true }, { admin: false, today })).toBe(true);
    expect(canCancelLeave({ status: "PENDING", fromDate: "2026-10-09", own: true }, { admin: false, today })).toBe(false);
    expect(canCancelLeave({ status: "APPROVED", fromDate: "2026-10-01", own: false }, { admin: true, today })).toBe(true);
    expect(canCancelLeave({ status: "APPROVED", fromDate: "2026-10-10", own: false }, { admin: false, today })).toBe(false);
    expect(canCancelLeave({ status: "REJECTED", fromDate: "2026-10-20", own: true }, { admin: true, today })).toBe(false);
  });

  it("LEADER decides others' PENDING requests; ADMIN also their own", () => {
    expect(canDecideLeave({ status: "PENDING", own: false }, { admin: false, leader: true })).toBe(true);
    expect(canDecideLeave({ status: "PENDING", own: true }, { admin: false, leader: true })).toBe(false);
    expect(canDecideLeave({ status: "PENDING", own: true }, { admin: true, leader: false })).toBe(true);
    expect(canDecideLeave({ status: "APPROVED", own: false }, { admin: true, leader: true })).toBe(false);
    expect(canDecideLeave({ status: "PENDING", own: false }, { admin: false, leader: false })).toBe(false);
  });
});
