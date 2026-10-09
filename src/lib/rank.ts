import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

import { AppError } from "./app-error.js";
import type { QuerySql } from "./db-types.js";

/**
 * Fractional ranks (lexicographic, COLLATE "C"). Moving one row writes one row.
 * `afterId` = place right after that sibling; `beforeId` = place right before it.
 */
export type RankScope = {
  /** Fully qualified table, e.g. "public.tasks". Never user input. */
  table: "public.tasks" | "public.lists" | "public.projects";
  /** Static SQL predicate columns and their values that define the sibling set. */
  where: Record<string, string | null>;
  /** Row being moved (excluded from neighbour lookups). */
  excludeId?: string | null;
};

type Neighbour = { rank: string } | undefined;

const buildWhere = (sql: QuerySql, scope: RankScope) => {
  const entries = Object.entries(scope.where);
  let fragment = sql`deleted_at IS NULL AND archived_at IS NULL`;
  for (const [column, value] of entries) {
    fragment =
      value === null
        ? sql`${fragment} AND ${sql(column)} IS NULL`
        : sql`${fragment} AND ${sql(column)} = ${value}`;
  }
  if (scope.excludeId) {
    fragment = sql`${fragment} AND id <> ${scope.excludeId}`;
  }
  return fragment;
};

const rankOf = async (sql: QuerySql, scope: RankScope, id: string) => {
  const rows = await sql<{ rank: string }[]>`
    SELECT rank FROM ${sql(scope.table)} WHERE id = ${id} AND ${buildWhere(sql, { ...scope, excludeId: null })} LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    throw new AppError("PLACEMENT_TARGET_NOT_FOUND", "The item to place next to was not found in this location.", 409);
  }
  return row.rank;
};

const rebalance = async (sql: QuerySql, scope: RankScope) => {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM ${sql(scope.table)}
    WHERE ${buildWhere(sql, { ...scope, excludeId: null })}
    ORDER BY rank COLLATE "C", id
    FOR UPDATE
  `;
  const keys = generateNKeysBetween(null, null, rows.length);
  if (rows.length > 0) {
    await sql`
      UPDATE ${sql(scope.table)} AS target
      SET rank = data.rank
      FROM unnest(${rows.map((row) => row.id)}::uuid[], ${keys}::text[]) AS data(id, rank)
      WHERE target.id = data.id
    `;
  }
};

/** Computes the rank for a new/moved row. Rebalances the sibling set once if ranks collide. */
export const rankForPlacement = async (
  sql: QuerySql,
  scope: RankScope,
  placement: { afterId?: string | null | undefined; beforeId?: string | null | undefined } | undefined
): Promise<string> => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const where = buildWhere(sql, scope);
    let lower: string | null = null;
    let upper: string | null = null;

    if (placement?.afterId) {
      lower = await rankOf(sql, scope, placement.afterId);
      const next: Neighbour = (
        await sql<{ rank: string }[]>`
          SELECT rank FROM ${sql(scope.table)} WHERE ${where} AND rank COLLATE "C" > ${lower} COLLATE "C"
          ORDER BY rank COLLATE "C" LIMIT 1
        `
      )[0];
      upper = next?.rank ?? null;
      if (placement.beforeId) {
        const explicitUpper = await rankOf(sql, scope, placement.beforeId);
        if (explicitUpper > lower && (upper === null || explicitUpper < upper)) {
          upper = explicitUpper;
        }
      }
    } else if (placement?.beforeId) {
      upper = await rankOf(sql, scope, placement.beforeId);
      const previous: Neighbour = (
        await sql<{ rank: string }[]>`
          SELECT rank FROM ${sql(scope.table)} WHERE ${where} AND rank COLLATE "C" < ${upper} COLLATE "C"
          ORDER BY rank COLLATE "C" DESC LIMIT 1
        `
      )[0];
      lower = previous?.rank ?? null;
    } else {
      const last: Neighbour = (
        await sql<{ rank: string }[]>`
          SELECT rank FROM ${sql(scope.table)} WHERE ${where} ORDER BY rank COLLATE "C" DESC LIMIT 1
        `
      )[0];
      lower = last?.rank ?? null;
    }

    if (lower !== null && upper !== null && lower >= upper) {
      if (attempt === 0) {
        await rebalance(sql, scope);
        continue;
      }
      throw new AppError("PLACEMENT_CONFLICT", "Could not place the item. Please retry.", 409);
    }

    return generateKeyBetween(lower, upper);
  }

  throw new AppError("PLACEMENT_CONFLICT", "Could not place the item. Please retry.", 409);
};

/** Rank for appending to the end of a sibling set. */
export const rankAtEnd = (sql: QuerySql, scope: RankScope) => rankForPlacement(sql, scope, undefined);
