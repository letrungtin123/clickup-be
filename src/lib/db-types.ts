import type postgres from "postgres";

export type QuerySql = postgres.Sql | postgres.TransactionSql;
export type JsonObject = Record<string, postgres.JSONValue>;

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
  if (!cursor) {
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
