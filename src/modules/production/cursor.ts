import { AppError } from "../../lib/app-error.js";
import { decodeCursor, encodeCursor, type QuerySql } from "../../lib/db-types.js";

/**
 * Keyset cursors of the production lists: (timestamp, uuid) at the database's full precision.
 *
 * PostgreSQL timestamps have microseconds while a JavaScript Date keeps milliseconds: a cursor built from a
 * Date drops or repeats rows that share a millisecond (BUG-PR-05). Lists therefore select the sort timestamp
 * as fixed-width UTC text with microseconds (`cursorTextSql`), which sorts like the timestamp and casts back
 * exactly, and cursors carry that text. Decoding validates both parts, so a forged or corrupted cursor is a
 * 400, never a database cast error (PR-16).
 */

const invalidCursor = () => new AppError("INVALID_CURSOR", "Con trỏ phân trang không hợp lệ.", 400);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** UTC only (what the API emits): "2026-10-10T03:04:05Z", ".123Z" (legacy millisecond cursors) or ".123456Z". */
const utcPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?Z$/;

/** `alias.column` as fixed-width UTC text with microseconds ("2026-10-10T03:04:05.123456Z"). */
export const cursorTextSql = (sql: QuerySql, column: string) => {
  const [alias, name] = column.split(".") as [string, string];
  return sql`to_char(${sql(alias)}.${sql(name)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
};

/**
 * A cursor instant as a SQL value. Bound as text and cast in SQL: a parameter the server types as timestamptz
 * would go through the driver's Date serializer and lose its microseconds.
 */
export const cursorInstantSql = (sql: QuerySql, at: string) => sql`(${at}::text)::timestamptz`;

export const isValidCursorInstant = (value: string) => {
  const match = utcPattern.exec(value);
  if (!match) {
    return false;
  }
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  if (year < 1900 || year > 2999 || hour > 23 || minute > 59 || second > 59) {
    return false;
  }
  // Rejects impossible days (2026-02-31) that Date would silently roll over.
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

export const isUuid = (value: string) => uuidPattern.test(value);

export const encodeTimeCursor = (at: string, id: string) => encodeCursor([at, id]);

/** null without a cursor; throws 400 INVALID_CURSOR when it is not a (UTC instant, uuid) pair. */
export const decodeTimeCursor = (cursor: string | undefined): { at: string; id: string } | null => {
  if (!cursor) {
    return null;
  }
  const value = decodeCursor(cursor, 2);
  const [at, id] = value ?? [];
  if (typeof at !== "string" || typeof id !== "string" || !isValidCursorInstant(at) || !isUuid(id)) {
    throw invalidCursor();
  }
  return { at, id };
};
