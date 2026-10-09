/**
 * Business calendar helpers. Timestamps are stored in UTC; calendar days, KPI periods and
 * "today" are evaluated in the organization's timezone (Asia/Ho_Chi_Minh, UTC+7, no DST).
 */
export const businessTimeZone = "Asia/Ho_Chi_Minh";

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: businessTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

/** Calendar day (YYYY-MM-DD) of an instant in the business timezone. */
export const businessDay = (at: Date) => dayFormatter.format(at);

/** Midnight at the start of a business day, as a UTC instant. */
export const startOfBusinessDay = (day: string) => new Date(`${day}T00:00:00+07:00`);

export const addDays = (day: string, days: number) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export const isValidDay = (day: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return false;
  }
  const date = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
};
