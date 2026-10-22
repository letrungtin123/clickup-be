import {
  myOverviewCoreWindowDefault,
  myOverviewDueSoonMinutes,
  myOverviewQcAlertHoursDefault
} from "../../contracts/production-my-overview.js";
import { addDays, businessDay, businessTimeZone } from "./time.js";

/**
 * PD-081 working-time clocks of "Tổng quan của tôi": minutes counted only inside the core window (default 09:30 – 16:30,
 * organization time) of working days (Monday – Saturday, as the KPI's working days). Read from the Overview V2 settings
 * (PD-080 `coreWindowStart` / `coreWindowEnd` / `alertAfterHours`) when the organization has them, else the defaults —
 * read defensively so this module works with or without those settings. Pure functions, unit tested.
 */

export type CoreClock = {
  /** "HH:MM" */
  start: string;
  end: string;
  timeZone: string;
  /** Minutes of core time before the task deadline that make a line "đến hạn" (3 h). */
  dueSoonMinutes: number;
  /** Minutes of core time in Chờ QC that raise the alert ("quá 2h"). */
  qcAlertMinutes: number;
};

const coreTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** "09:30" → 570; null for anything else. */
export const coreTimeMinutes = (value: unknown) => {
  if (typeof value !== "string" || !coreTimePattern.test(value)) {
    return null;
  }
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
};

/**
 * The clock of an organization from its settings (any object: the Overview V2 fields are read only when present and
 * valid — a window whose start is not before its end falls back to the default).
 */
export const coreClockOf = (settings: object): CoreClock => {
  const raw = settings as { coreWindowStart?: unknown; coreWindowEnd?: unknown; alertAfterHours?: unknown; timezone?: unknown };
  const start = coreTimeMinutes(raw.coreWindowStart);
  const end = coreTimeMinutes(raw.coreWindowEnd);
  const valid = start !== null && end !== null && start < end;
  const alertHours =
    typeof raw.alertAfterHours === "number" && Number.isFinite(raw.alertAfterHours) && raw.alertAfterHours > 0
      ? raw.alertAfterHours
      : myOverviewQcAlertHoursDefault;
  return {
    start: valid ? (raw.coreWindowStart as string) : myOverviewCoreWindowDefault.start,
    end: valid ? (raw.coreWindowEnd as string) : myOverviewCoreWindowDefault.end,
    timeZone: typeof raw.timezone === "string" && raw.timezone ? raw.timezone : businessTimeZone,
    dueSoonMinutes: myOverviewDueSoonMinutes,
    qcAlertMinutes: Math.round(alertHours * 60)
  };
};

const formatters = new Map<string, Intl.DateTimeFormat>();
const newFormatter = (timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
/** A cached formatter of `timeZone` (the business timezone when it is not a known zone). */
const formatterOf = (timeZone: string): Intl.DateTimeFormat => {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    try {
      formatter = newFormatter(timeZone);
    } catch {
      formatter = newFormatter(businessTimeZone);
    }
    formatters.set(timeZone, formatter);
  }
  return formatter;
};

const partsOf = (at: Date, timeZone: string) => {
  const parts = Object.fromEntries(formatterOf(timeZone).formatToParts(at).map((part) => [part.type, part.value]));
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    asUtc: Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second))
  };
};

/** Calendar day (YYYY-MM-DD) of `at` in `timeZone` (the business timezone when it is not a known zone). */
export const dayIn = (at: Date, timeZone: string) => {
  try {
    return partsOf(at, timeZone).day;
  } catch {
    return businessDay(at);
  }
};

/** The instant of `minutes` after midnight of `day` in `timeZone` (two passes settle zones with DST). */
export const zonedInstant = (day: string, minutes: number, timeZone: string) => {
  const guess = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), 0, minutes);
  const offset = (instant: number) => partsOf(new Date(instant), timeZone).asUtc - Math.floor(instant / 1000) * 1000;
  let instant = guess - offset(guess);
  instant = guess - offset(instant);
  return instant;
};

/** Working day of the core clock: Monday – Saturday. */
export const isCoreWorkingDay = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay() !== 0;

/** Days walked at most (a clock running longer than this is reported at that length). */
const maxClockDays = 400;

/**
 * Core-window minutes between two instants (0 when `to` is not after `from`): the parts of [from, to) inside the core
 * window of working days. `cap` stops counting once reached (the result is then `cap`). E.g. from 16:00 to 10:00 the
 * next working day with the 09:30 – 16:30 window: 30 + 30 = 60.
 */
export const coreMinutesBetween = (from: Date, to: Date, clock: Pick<CoreClock, "start" | "end" | "timeZone">, cap = Number.POSITIVE_INFINITY) => {
  const start = from.getTime();
  const end = to.getTime();
  if (!(end > start)) {
    return 0;
  }
  const windowStart = coreTimeMinutes(clock.start) ?? coreTimeMinutes(myOverviewCoreWindowDefault.start)!;
  const windowEnd = coreTimeMinutes(clock.end) ?? coreTimeMinutes(myOverviewCoreWindowDefault.end)!;
  const lastDay = dayIn(to, clock.timeZone);
  let total = 0;
  let day = dayIn(from, clock.timeZone);
  for (let walked = 0; day <= lastDay && walked < maxClockDays; walked += 1, day = addDays(day, 1)) {
    if (!isCoreWorkingDay(day)) {
      continue;
    }
    const open = Math.max(start, zonedInstant(day, windowStart, clock.timeZone));
    const close = Math.min(end, zonedInstant(day, windowEnd, clock.timeZone));
    if (close > open) {
      total += close - open;
      if (total / 60_000 >= cap) {
        return cap;
      }
    }
  }
  return Math.floor(total / 60_000);
};
