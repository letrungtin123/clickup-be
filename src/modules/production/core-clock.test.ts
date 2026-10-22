import { describe, expect, it } from "vitest";

import {
  alertMinutesOf,
  coreDayMinutes,
  coreHoursBetween,
  coreMinutesBetween,
  coreWindowOf,
  isCoreWorkday,
  zonedDay,
  zonedInstant,
  type CoreWindow
} from "./core-clock.js";

/**
 * PD-080 — the core-window clock (Chờ QC, Không cập nhật, an Account's new job "chưa chia", At risk capacity): only minutes
 * inside 09:30 – 16:30 (settings) on Monday – Saturday, organization time (Asia/Ho_Chi_Minh = UTC+7, no DST).
 */
const window: CoreWindow = { start: "09:30", end: "16:30", timeZone: "Asia/Ho_Chi_Minh" };
/** A wall-clock time in Asia/Ho_Chi_Minh ("2026-10-21 14:05"). */
const at = (local: string) => new Date(`${local.replace(" ", "T")}:00+07:00`);

describe("core clock (PD-080)", () => {
  it("counts the minutes inside the window", () => {
    // Wednesday 21/10/2026.
    expect(coreMinutesBetween(at("2026-10-21 10:00"), at("2026-10-21 11:30"), window)).toBe(90);
    expect(coreHoursBetween(at("2026-10-21 10:00"), at("2026-10-21 11:30"), window)).toBe(1.5);
    expect(coreDayMinutes(window)).toBe(420);
  });

  it("the owner's example: Chờ QC at 16:00 → 30 minutes that day, resumes 09:30 the next day, 2 hours at 11:00", () => {
    const entered = at("2026-10-20 16:00"); // Tuesday
    expect(coreMinutesBetween(entered, at("2026-10-20 20:00"), window)).toBe(30);
    expect(coreMinutesBetween(entered, at("2026-10-21 09:30"), window)).toBe(30);
    expect(coreMinutesBetween(entered, at("2026-10-21 10:59"), window)).toBe(119);
    expect(coreMinutesBetween(entered, at("2026-10-21 11:00"), window)).toBe(120);
    expect(coreMinutesBetween(entered, at("2026-10-21 11:00"), window) >= alertMinutesOf({ alertAfterHours: 2 })).toBe(true);
  });

  it("pauses before and after the window", () => {
    expect(coreMinutesBetween(at("2026-10-21 07:00"), at("2026-10-21 09:30"), window)).toBe(0);
    expect(coreMinutesBetween(at("2026-10-21 16:30"), at("2026-10-21 23:59"), window)).toBe(0);
    expect(coreMinutesBetween(at("2026-10-21 08:00"), at("2026-10-21 10:00"), window)).toBe(30);
    expect(coreMinutesBetween(at("2026-10-21 16:00"), at("2026-10-21 18:00"), window)).toBe(30);
  });

  it("skips Sunday (working days Monday – Saturday)", () => {
    expect(isCoreWorkday("2026-10-24")).toBe(true); // Saturday
    expect(isCoreWorkday("2026-10-25")).toBe(false); // Sunday
    // Saturday 16:00 → Monday 10:00: 30 (Sat) + 0 (Sun) + 30 (Mon).
    expect(coreMinutesBetween(at("2026-10-24 16:00"), at("2026-10-26 10:00"), window)).toBe(60);
    expect(coreMinutesBetween(at("2026-10-25 08:00"), at("2026-10-25 20:00"), window)).toBe(0);
  });

  it("follows a custom window from the settings", () => {
    const custom = coreWindowOf({ coreWindowStart: "08:00", coreWindowEnd: "17:00", timezone: "Asia/Ho_Chi_Minh" });
    expect(custom).toEqual({ start: "08:00", end: "17:00", timeZone: "Asia/Ho_Chi_Minh" });
    expect(coreMinutesBetween(at("2026-10-21 07:00"), at("2026-10-21 18:00"), custom)).toBe(540);
    expect(coreDayMinutes(custom)).toBe(540);
  });

  it("cuts out excluded intervals (approved leave), overlapping ones counted once", () => {
    const leave = [
      { start: at("2026-10-21 11:00"), end: at("2026-10-21 11:30") },
      { start: at("2026-10-21 11:15"), end: at("2026-10-21 11:45") }
    ];
    expect(coreMinutesBetween(at("2026-10-21 10:00"), at("2026-10-21 12:00"), window, leave)).toBe(75);
    // A full day of leave (as the leave calendar stores it: 00:00 → next 00:00) removes the whole core day.
    const fullDay = [{ start: at("2026-10-22 00:00"), end: at("2026-10-23 00:00") }];
    expect(coreMinutesBetween(at("2026-10-21 16:00"), at("2026-10-23 10:30"), window, fullDay)).toBe(30 + 60);
  });

  it("a reversed or empty range is 0", () => {
    expect(coreMinutesBetween(at("2026-10-21 12:00"), at("2026-10-21 10:00"), window)).toBe(0);
    expect(coreMinutesBetween(at("2026-10-21 12:00"), at("2026-10-21 12:00"), window)).toBe(0);
  });

  it("settings fallbacks: defaults 09:30 – 16:30 and 2 h; a start not before the end falls back to the defaults", () => {
    expect(coreWindowOf({})).toEqual({ start: "09:30", end: "16:30", timeZone: "Asia/Ho_Chi_Minh" });
    expect(coreWindowOf({ coreWindowStart: "17:00", coreWindowEnd: "09:00", timezone: "Asia/Ho_Chi_Minh" })).toEqual(window);
    expect(coreWindowOf({ coreWindowStart: "10:00", coreWindowEnd: "10:00" })).toMatchObject({ start: "09:30", end: "16:30" });
    expect(alertMinutesOf({})).toBe(120);
    expect(alertMinutesOf({ alertAfterHours: 1.5 })).toBe(90);
  });

  it("wall-clock helpers of the organization zone", () => {
    expect(zonedInstant("2026-10-21", "09:30", "Asia/Ho_Chi_Minh").toISOString()).toBe("2026-10-21T02:30:00.000Z");
    expect(zonedDay(new Date("2026-10-21T18:00:00Z"), "Asia/Ho_Chi_Minh")).toBe("2026-10-22");
    expect(zonedDay(new Date("2026-10-21T16:59:00Z"), "Asia/Ho_Chi_Minh")).toBe("2026-10-21");
  });
});
