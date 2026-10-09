import type { CustomFieldEntity, CustomValues } from "../../contracts/production-catalog.js";
import { AppError } from "../../lib/app-error.js";
import type { QuerySql } from "../../lib/db-types.js";
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
