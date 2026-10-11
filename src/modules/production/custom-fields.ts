import { customFieldEmptyValue, type CustomFieldEntity, type CustomFieldFilter, type CustomValues } from "../../contracts/production-catalog.js";
import { AppError } from "../../lib/app-error.js";
import { escapeLike, type QuerySql, type SqlFragment } from "../../lib/db-types.js";
import { isValidDay } from "./time.js";

export type FieldDefinition = {
  key: string;
  label: string;
  type: "TEXT" | "NUMBER" | "DATE" | "SELECT" | "MULTISELECT";
  options: { value: string }[];
  required: boolean;
};

export const loadFieldDefinitions = (sql: QuerySql, organizationId: string, entity: CustomFieldEntity) =>
  sql<FieldDefinition[]>`
    SELECT key, label, type, options, required
    FROM production.custom_fields
    WHERE organization_id = ${organizationId} AND entity = ${entity} AND active
    ORDER BY sort_order, key
  `;

/**
 * Validates admin-defined custom field values (SPEC Phase 1): unknown keys are rejected,
 * types and option lists enforced, required fields checked on create. Pure, so it is unit tested.
 * `existing` is merged first when updating so partial updates keep other values.
 */
export const validateCustomValues = (
  definitions: FieldDefinition[],
  input: CustomValues | undefined,
  options: { existing?: CustomValues; enforceRequired: boolean }
): CustomValues => {
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
  const result: CustomValues = { ...(options.existing ?? {}) };
  const errors: string[] = [];

  for (const [key, raw] of Object.entries(input ?? {})) {
    const definition = byKey.get(key);
    if (!definition) {
      errors.push(`Trường "${key}" không tồn tại.`);
      continue;
    }
    if (raw === null || raw === "" || (Array.isArray(raw) && raw.length === 0)) {
      delete result[key];
      continue;
    }
    const allowed = new Set(definition.options.map((option) => option.value));
    switch (definition.type) {
      case "TEXT":
        if (typeof raw !== "string" || raw.length > 2000) {
          errors.push(`"${definition.label}" phải là văn bản tối đa 2000 ký tự.`);
        } else {
          result[key] = raw.trim();
        }
        break;
      case "NUMBER": {
        const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
        if (!Number.isFinite(value) || Math.abs(value) > 1e12) {
          errors.push(`"${definition.label}" phải là số.`);
        } else {
          result[key] = value;
        }
        break;
      }
      case "DATE":
        if (typeof raw !== "string" || !isValidDay(raw)) {
          errors.push(`"${definition.label}" phải là ngày dạng YYYY-MM-DD.`);
        } else {
          result[key] = raw;
        }
        break;
      case "SELECT":
        if (typeof raw !== "string" || !allowed.has(raw)) {
          errors.push(`"${definition.label}" có giá trị không hợp lệ.`);
        } else {
          result[key] = raw;
        }
        break;
      case "MULTISELECT":
        if (!Array.isArray(raw) || raw.length > 50 || raw.some((value) => !allowed.has(value))) {
          errors.push(`"${definition.label}" có giá trị không hợp lệ.`);
        } else {
          result[key] = [...new Set(raw)];
        }
        break;
    }
  }

  if (options.enforceRequired) {
    for (const definition of definitions) {
      const value = result[definition.key];
      if (definition.required && (value === undefined || value === null || (Array.isArray(value) && value.length === 0))) {
        errors.push(`"${definition.label}" là bắt buộc.`);
      }
    }
  }

  if (errors.length > 0) {
    throw new AppError("CUSTOM_FIELDS_INVALID", errors.join(" "), 400);
  }
  return result;
};

export const resolveCustomValues = async (
  sql: QuerySql,
  organizationId: string,
  entity: CustomFieldEntity,
  input: CustomValues | undefined,
  options: { existing?: CustomValues; enforceRequired: boolean }
) => validateCustomValues(await loadFieldDefinitions(sql, organizationId, entity), input, options);

/** Replaces the tag set of one record; tag ids must belong to the organization. */
export const setEntityTags = async (
  sql: QuerySql,
  organizationId: string,
  entity: CustomFieldEntity,
  entityId: string,
  tagIds: string[]
) => {
  const unique = [...new Set(tagIds)];
  if (unique.length > 0) {
    const found = await sql<{ id: string }[]>`
      SELECT id FROM production.tags WHERE organization_id = ${organizationId} AND id = ANY(${unique}::uuid[])
    `;
    if (found.length !== unique.length) {
      throw new AppError("TAG_NOT_FOUND", "Một hoặc nhiều tag không tồn tại.", 400);
    }
  }
  await sql`
    DELETE FROM production.entity_tags
    WHERE organization_id = ${organizationId} AND entity = ${entity} AND entity_id = ${entityId}
      AND NOT (tag_id = ANY(${unique}::uuid[]))
  `;
  if (unique.length > 0) {
    await sql`
      INSERT INTO production.entity_tags (organization_id, entity, entity_id, tag_id)
      SELECT ${organizationId}, ${entity}, ${entityId}, tag_id FROM unnest(${unique}::uuid[]) AS tag_id
      ON CONFLICT DO NOTHING
    `;
  }
};

export const tagIdsSql = (sql: QuerySql, entity: CustomFieldEntity, idColumn: string) => sql`
  coalesce((
    SELECT array_agg(et.tag_id ORDER BY et.created_at)
    FROM production.entity_tags et
    WHERE et.organization_id = ${sql(idColumn.split(".")[0]!)}.organization_id
      AND et.entity = ${entity} AND et.entity_id = ${sql(idColumn)}
  ), '{}')
`;

// Filters (PLAN §8 "trường hiện trong form, bảng và bộ lọc") ----------------------------------------------

/**
 * A validated custom-field filter. Built only from the field definitions (whitelist) and the request values;
 * the SQL below binds the key and every value as parameters.
 */
export type CustomFieldFilterPlan =
  | { key: string; type: "SELECT" | "MULTISELECT" | "TEXT"; values: string[]; empty: boolean }
  | { key: string; type: "NUMBER"; values: number[]; from: number | null; to: number | null; empty: boolean }
  | { key: string; type: "DATE"; values: string[]; from: string | null; to: string | null; empty: boolean };

const filterError = (message: string) => new AppError("CUSTOM_FIELD_FILTER_INVALID", message, 400);

const parseNumber = (label: string, raw: string) => {
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(value)) {
    throw filterError(`Bộ lọc "${label}" cần số.`);
  }
  return value;
};
const parseDay = (label: string, raw: string) => {
  if (!isValidDay(raw)) {
    throw filterError(`Bộ lọc "${label}" cần ngày dạng YYYY-MM-DD.`);
  }
  return raw;
};

/**
 * Validates filters against the active field definitions of one entity: unknown keys, option values that do not
 * exist, ranges on non-range fields and malformed numbers / days are 400 CUSTOM_FIELD_FILTER_INVALID. Filters on
 * the same key are merged. Pure (unit tested).
 */
export const planCustomFieldFilters = (
  definitions: readonly FieldDefinition[],
  filters: readonly CustomFieldFilter[] | undefined
): CustomFieldFilterPlan[] => {
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
  const merged = new Map<string, { values: string[]; from?: string | undefined; to?: string | undefined }>();
  for (const filter of filters ?? []) {
    const current = merged.get(filter.key) ?? { values: [] };
    current.values.push(...filter.values);
    current.from = filter.from ?? current.from;
    current.to = filter.to ?? current.to;
    merged.set(filter.key, current);
  }
  const plans: CustomFieldFilterPlan[] = [];
  for (const [key, filter] of merged) {
    const definition = byKey.get(key);
    if (!definition) {
      throw filterError(`Trường lọc "${key}" không tồn tại.`);
    }
    const empty = filter.values.includes(customFieldEmptyValue);
    const values = [...new Set(filter.values.filter((value) => value !== customFieldEmptyValue))];
    const ranged = filter.from !== undefined || filter.to !== undefined;
    if (values.length === 0 && !empty && !ranged) {
      throw filterError(`Bộ lọc "${definition.label}" cần giá trị.`);
    }
    switch (definition.type) {
      case "SELECT":
      case "MULTISELECT":
      case "TEXT": {
        if (ranged) {
          throw filterError(`Bộ lọc "${definition.label}" không lọc theo khoảng.`);
        }
        if (definition.type !== "TEXT") {
          const allowed = new Set(definition.options.map((option) => option.value));
          const unknown = values.filter((value) => !allowed.has(value));
          if (unknown.length > 0) {
            throw filterError(`Bộ lọc "${definition.label}" có lựa chọn không tồn tại: ${unknown.join(", ")}.`);
          }
        }
        plans.push({ key, type: definition.type, values, empty });
        break;
      }
      case "NUMBER":
        plans.push({
          key,
          type: "NUMBER",
          values: values.map((value) => parseNumber(definition.label, value)),
          from: filter.from === undefined ? null : parseNumber(definition.label, filter.from),
          to: filter.to === undefined ? null : parseNumber(definition.label, filter.to),
          empty
        });
        break;
      case "DATE":
        plans.push({
          key,
          type: "DATE",
          values: values.map((value) => parseDay(definition.label, value)),
          from: filter.from === undefined ? null : parseDay(definition.label, filter.from),
          to: filter.to === undefined ? null : parseDay(definition.label, filter.to),
          empty
        });
        break;
    }
  }
  return plans;
};

/** Loads the entity's active definitions and validates the filters (no query when there is nothing to filter). */
export const resolveCustomFieldFilters = async (
  sql: QuerySql,
  organizationId: string,
  entity: CustomFieldEntity,
  filters: readonly CustomFieldFilter[] | undefined
): Promise<CustomFieldFilterPlan[]> =>
  filters && filters.length > 0 ? planCustomFieldFilters(await loadFieldDefinitions(sql, organizationId, entity), filters) : [];

/** Lowercase without accents (đ → d): how TEXT filters compare, like public.immutable_unaccent(lower(…)). */
export const foldText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();

const isEmptyValue = (value: unknown) => value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);

const inRange = <T extends number | string>(value: T, from: T | null, to: T | null) =>
  (from !== null || to !== null) && (from === null || value >= from) && (to === null || value <= to);

/** In-memory form of the filters (members / clients lists, people of the board and the KPI report). */
export const matchesCustomFieldFilters = (values: CustomValues | null | undefined, plans: readonly CustomFieldFilterPlan[]) =>
  plans.every((plan) => {
    const value = (values ?? {})[plan.key];
    if (isEmptyValue(value)) {
      return plan.empty;
    }
    switch (plan.type) {
      case "SELECT":
        return typeof value === "string" && plan.values.includes(value);
      case "MULTISELECT":
        return Array.isArray(value) && value.some((item) => plan.values.includes(item));
      case "TEXT": {
        const text = typeof value === "string" ? foldText(value) : "";
        return plan.values.some((needle) => text.includes(foldText(needle)));
      }
      case "NUMBER":
        return typeof value === "number" && (plan.values.includes(value) || inRange(value, plan.from, plan.to));
      case "DATE":
        return typeof value === "string" && isValidDay(value) && (plan.values.includes(value) || inRange(value, plan.from, plan.to));
    }
    return false;
  });

const joinFragments = (sql: QuerySql, parts: SqlFragment[], separator: "AND" | "OR") =>
  parts.reduce((all, part) => (separator === "AND" ? sql`${all} AND ${part}` : sql`${all} OR ${part}`));

/**
 * SQL condition (AND of the plans) on a custom_values jsonb column, e.g. `customFieldFilterSql(sql, "j.custom_values", plans)`.
 * Keys and values are bound parameters; SELECT / MULTISELECT use containment (GIN jsonb_path_ops, migration
 * 20261011_0230). TRUE without plans.
 */
export const customFieldFilterSql = (sql: QuerySql, column: string, plans: readonly CustomFieldFilterPlan[]) => {
  if (plans.length === 0) {
    return sql`TRUE`;
  }
  const col = sql(column);
  const conditions = plans.map((plan) => {
    const alternatives: SqlFragment[] = [];
    if (plan.empty) {
      alternatives.push(sql`(NOT (${col} ? ${plan.key}) OR ${col} -> ${plan.key} IN ('null'::jsonb, '""'::jsonb, '[]'::jsonb))`);
    }
    switch (plan.type) {
      case "SELECT":
        alternatives.push(...plan.values.map((value) => sql`${col} @> ${sql.json({ [plan.key]: value })}`));
        break;
      case "MULTISELECT":
        alternatives.push(...plan.values.map((value) => sql`${col} @> ${sql.json({ [plan.key]: [value] })}`));
        break;
      case "TEXT":
        if (plan.values.length > 0) {
          const patterns = plan.values.map((value) => `%${escapeLike(value.toLowerCase())}%`);
          alternatives.push(
            sql`public.immutable_unaccent(lower(${col} ->> ${plan.key})) LIKE ANY (SELECT public.immutable_unaccent(p) FROM unnest(${patterns}::text[]) AS p)`
          );
        }
        break;
      case "NUMBER": {
        const number = sql`(CASE WHEN jsonb_typeof(${col} -> ${plan.key}) = 'number' THEN (${col} ->> ${plan.key})::numeric END)`;
        if (plan.values.length > 0) {
          alternatives.push(sql`${number} = ANY(${plan.values.map(String)}::numeric[])`);
        }
        if (plan.from !== null || plan.to !== null) {
          alternatives.push(
            sql`(${number} IS NOT NULL ${plan.from !== null ? sql`AND ${number} >= ${String(plan.from)}::numeric` : sql``} ${
              plan.to !== null ? sql`AND ${number} <= ${String(plan.to)}::numeric` : sql``
            })`
          );
        }
        break;
      }
      case "DATE": {
        const day = sql`(CASE WHEN jsonb_typeof(${col} -> ${plan.key}) = 'string' THEN ${col} ->> ${plan.key} END)`;
        if (plan.values.length > 0) {
          alternatives.push(sql`${day} = ANY(${plan.values}::text[])`);
        }
        if (plan.from !== null || plan.to !== null) {
          alternatives.push(
            sql`(${day} IS NOT NULL ${plan.from !== null ? sql`AND ${day} >= ${plan.from}` : sql``} ${plan.to !== null ? sql`AND ${day} <= ${plan.to}` : sql``})`
          );
        }
        break;
      }
    }
    return alternatives.length > 0 ? sql`(${joinFragments(sql, alternatives, "OR")})` : sql`FALSE`;
  });
  return sql`(${joinFragments(sql, conditions, "AND")})`;
};

/** `EXISTS` condition: the record carries at least one of the tags (any-of). */
export const anyTagSql = (sql: QuerySql, entity: CustomFieldEntity, idColumn: string, organizationColumn: string, tagIds: readonly string[]) =>
  sql`EXISTS (
    SELECT 1 FROM production.entity_tags et
    WHERE et.organization_id = ${sql(organizationColumn)} AND et.entity = ${entity} AND et.entity_id = ${sql(idColumn)}
      AND et.tag_id = ANY(${[...tagIds]}::uuid[])
  )`;

// New task lines (Chia task / Giao lại) -----------------------------------------------------------------

/**
 * Custom values of a new task line, validated with required fields enforced (SPEC Phase 1). A feedback redo task
 * ("Giao lại") starts from its source task's values: the line's values are merged over them, so a required TASK
 * field already set on the source task need not be sent again. Inherited values of fields no longer active are
 * dropped. Throws CUSTOM_FIELDS_INVALID like validateCustomValues.
 */
export const taskLineCustomValues = (
  definitions: readonly FieldDefinition[],
  line: CustomValues | undefined,
  inherited: CustomValues | null
): CustomValues => {
  const active = new Set(definitions.map((definition) => definition.key));
  const base = Object.fromEntries(Object.entries(inherited ?? {}).filter(([key]) => active.has(key)));
  return validateCustomValues([...definitions], line, { existing: base, enforceRequired: true });
};
