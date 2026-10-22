import { defaultAlertAfterHours, defaultCoreWindow } from "../../contracts/production-catalog.js";
import { addDays, businessTimeZone } from "./time.js";

/**
 * PD-080 — the "core window" clock of the Overview (Chờ QC, Không cập nhật, an Account's new job "chưa chia") and of the
 * At risk capacity: only the minutes inside the core window (default 09:30 – 16:30, settings `coreWindowStart` /
 * `coreWindowEnd`) of working days (Monday – Saturday, organization timezone) count; outside it the clock pauses. Example:
 * a line enters Chờ QC at 16:00 → 30 minutes that day; the clock resumes at 09:30 the next working day and reaches 2 hours
 * at 11:00. Approved leave can be cut out (capacity of one person). Pure (unit tested); no holiday calendar.
 */

export type CoreWindow = { start: string; end: string; timeZone: string };
export type Interval = { start: Date; end: Date };

/** The organization's window from its settings (defaults 09:30 – 16:30, Asia/Ho_Chi_Minh). */
export const coreWindowOf = (settings: { coreWindowStart?: string | undefined; coreWindowEnd?: string | undefined; timezone?: string | undefined }): CoreWindow => {
  const start = settings.coreWindowStart ?? defaultCoreWindow.start;
  const end = settings.coreWindowEnd ?? defaultCoreWindow.end;
  return start < end
    ? { start, end, timeZone: settings.timezone ?? businessTimeZone }
    : { start: defaultCoreWindow.start, end: defaultCoreWindow.end, timeZone: settings.timezone ?? businessTimeZone };
};

/** Alert threshold in minutes (settings `alertAfterHours`, default 2 h). */
export const alertMinutesOf = (settings: { alertAfterHours?: number | undefined }) =>
  Math.round((settings.alertAfterHours ?? defaultAlertAfterHours) * 60);

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** Minutes of one core day (07:00 for 09:30 – 16:30). */
export const coreDayMinutes = (window: CoreWindow) => minutesOf(window.end) - minutesOf(window.start);

const formatters = new Map<string, Intl.DateTimeFormat>();
const formatterOf = (timeZone: string): Intl.DateTimeFormat => {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
    } catch {
      formatter = formatterOf(businessTimeZone);
    }
    formatters.set(timeZone, formatter);
  }
  return formatter;
};

/** Wall-clock parts of an instant in a time zone. */
const zonedParts = (at: Date, timeZone: string) => {
  const parts = Object.fromEntries(formatterOf(timeZone).formatToParts(at).map((part) => [part.type, part.value]));
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    asUtc: Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second))
  };
};

/** The calendar day of an instant in the zone. */
export const zonedDay = (at: Date, timeZone: string) => zonedParts(at, timeZone).day;

/** The instant of a wall-clock time ("YYYY-MM-DD", "HH:MM") in the zone. */
export const zonedInstant = (day: string, time: string, timeZone: string) => {
  const guess = Date.parse(`${day}T${time}:00Z`);
  const offset = zonedParts(new Date(guess), timeZone).asUtc - guess;
  const first = guess - offset;
  // One correction step covers a DST change between the guess and the answer.
  const offset2 = zonedParts(new Date(first), timeZone).asUtc - first;
  return new Date(guess - offset2);
};

/** Monday – Saturday. */
export const isCoreWorkday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay() !== 0;

const overlap = (a: Interval, b: Interval) => Math.max(0, Math.min(a.end.getTime(), b.end.getTime()) - Math.max(a.start.getTime(), b.start.getTime()));

/** Merges overlapping intervals (sorted, disjoint result). */
const mergeIntervals = (intervals: readonly Interval[]) => {
  const sorted = [...intervals].filter((item) => item.end > item.start).sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Interval[] = [];
  for (const item of sorted) {
    const last = merged[merged.length - 1];
    if (last && item.start <= last.end) {
      last.end = new Date(Math.max(last.end.getTime(), item.end.getTime()));
    } else {
      merged.push({ start: item.start, end: item.end });
    }
  }
  return merged;
};

/** Longest span walked, in days (a clock is never asked for more; older starts are capped at this). */
const maxDays = 800;

/**
 * Core-window minutes between `from` and `to` (0 when `to` ≤ `from`), minus the parts covered by `excluded` (e.g. one
 * person's approved leave). Whole minutes, rounded down.
 */
export const coreMinutesBetween = (from: Date, to: Date, window: CoreWindow, excluded: readonly Interval[] = []) => {
  if (!(to > from)) {
    return 0;
  }
  const cuts = mergeIntervals(excluded);
  let total = 0;
  const lastDay = zonedDay(to, window.timeZone);
  let day = zonedDay(from, window.timeZone);
  const capped = addDays(lastDay, -maxDays);
  if (day < capped) {
    day = capped;
  }
  for (; day <= lastDay; day = addDays(day, 1)) {
    if (!isCoreWorkday(day)) {
      continue;
    }
    const core: Interval = { start: zonedInstant(day, window.start, window.timeZone), end: zonedInstant(day, window.end, window.timeZone) };
    const span: Interval = { start: new Date(Math.max(core.start.getTime(), from.getTime())), end: new Date(Math.min(core.end.getTime(), to.getTime())) };
    if (span.end <= span.start) {
      continue;
    }
    let ms = span.end.getTime() - span.start.getTime();
    for (const cut of cuts) {
      ms -= overlap(span, cut);
    }
    total += Math.max(0, ms);
  }
  return Math.floor(total / 60_000);
};

/** Core-window hours between two instants (2 decimals). */
export const coreHoursBetween = (from: Date, to: Date, window: CoreWindow, excluded: readonly Interval[] = []) =>
  Math.round((coreMinutesBetween(from, to, window, excluded) / 60) * 100) / 100;
