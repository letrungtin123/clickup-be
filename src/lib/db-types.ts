import type postgres from "postgres";

import { AppError } from "./app-error.js";

export type QuerySql = postgres.Sql | postgres.TransactionSql;
export type JsonObject = Record<string, postgres.JSONValue>;
export type SqlFragment = postgres.PendingQuery<postgres.Row[]>;

export const toIso = (value: Date | string) => (value instanceof Date ? value : new Date(value)).toISOString();

export const toNullableIso = (value: Date | string | null | undefined) => (value ? toIso(value) : null);

export const nullableText = (value: string | null | undefined) => {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

/** Opaque, URL-safe keyset cursor. */
export const encodeCursor = (values: (string | number | null)[]) =>
  Buffer.from(JSON.stringify(values), "utf8").toString("base64url");

export const decodeCursor = (cursor: string | undefined, length: number): (string | number | null)[] | null => {
  if (!cursor || cursor.length > 2000) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      Array.isArray(value) &&
      value.length === length &&
      value.every((entry) => entry === null || typeof entry === "string" || typeof entry === "number")
    ) {
      return value as (string | number | null)[];
    }
  } catch {
    // fall through
  }
  return null;
};

export const invalidCursor = () => new AppError("INVALID_CURSOR", "Con trỏ phân trang không hợp lệ.", 400);

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string => typeof value === "string" && uuidPattern.test(value);

/**
 * Timestamp texts accepted in cursors: the UTC ISO text written by `timestampTextSql` (microseconds), plus
 * PostgreSQL / ISO texts of older cursors, and ±infinity (task due-date sort).
 */
const cursorTimestampPattern =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[T ]([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?(Z|[+-]([01]\d|2[0-3])(:?[0-5]\d)?)$/;

export const isCursorTimestamp = (value: unknown): value is string =>
  typeof value === "string" &&
  (value === "infinity" || value === "-infinity" || (cursorTimestampPattern.test(value) && Number(value.slice(0, 4)) >= 1));

/**
 * Full-precision timestamp text for keyset cursors: UTC ISO-8601 with microseconds (sorts like the timestamp),
 * "infinity"/"-infinity" kept as such. JS Dates only hold milliseconds, so cursors must never round-trip
 * through `Date` — rows sharing a millisecond would be skipped or repeated.
 */
export const timestampTextSql = (sql: QuerySql, expression: () => SqlFragment) =>
  sql`(CASE WHEN isfinite(${expression()})
    THEN to_char((${expression()}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ELSE (${expression()})::text END)`;

/**
 * A cursor timestamp as SQL timestamptz. The parameter is sent as text and cast in SQL: a `::timestamptz`
 * parameter would be serialized through a JS Date (microseconds lost, "infinity" throws).
 */
export const timestampParamSql = (sql: QuerySql, value: string) => sql`(${value}::text)::timestamptz`;

export type TimeCursor = { at: string; id: string };

/** Keyset cursor over (timestamp text from timestampTextSql, uuid). */
export const encodeTimeCursor = (timestampText: string, id: string) => encodeCursor([timestampText, id]);

export const decodeTimeCursor = (cursor: string | undefined): TimeCursor | null => {
  if (!cursor) {
    return null;
  }
  const [at, id] = decodeCursor(cursor, 2) ?? [];
  if (!isCursorTimestamp(at) || !isUuid(id)) {
    throw invalidCursor();
  }
  return { at, id };
};

export type KeysetValueKind = "text" | "timestamp" | "integer";

/**
 * Typed keyset cursor `[tag, value, id]`: `tag` names the sort it belongs to (a cursor of another sort is
 * rejected), `value` is validated for its kind so bad input answers 400 instead of failing in SQL.
 */
export const encodeKeysetCursor = (tag: string, value: string | number, id: string) => encodeCursor([tag, value, id]);

export const decodeKeysetCursor = (
  cursor: string | undefined,
  tag: string,
  kind: KeysetValueKind
): { value: string | number; id: string } | null => {
  if (!cursor) {
    return null;
  }
  const [cursorTag, value, id] = decodeCursor(cursor, 3) ?? [];
  if (cursorTag !== tag || !isUuid(id)) {
    throw invalidCursor();
  }
  const valid =
    kind === "integer"
      ? typeof value === "number" && Number.isSafeInteger(value)
      : kind === "timestamp"
        ? isCursorTimestamp(value)
        : typeof value === "string" && value.length <= 1000 && !value.includes("\u0000");
  if (!valid) {
    throw invalidCursor();
  }
  return { value: value as string | number, id };
};

/** Escapes LIKE wildcards in user input. */
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, (match) => `\\${match}`);

/** Builds a safe prefix tsquery string ("foo:* & bar:*") from free text. */
export const toPrefixTsQuery = (value: string) => {
  const terms = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 0)
    .slice(0, 8);
  return terms.length > 0 ? terms.map((term) => `${term}:*`).join(" & ") : null;
};
