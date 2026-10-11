import { describe, expect, it } from "vitest";

import { CustomFieldFiltersSchema, withCustomFieldFilters } from "../../contracts/production-catalog.js";
import type { QuerySql } from "../../lib/db-types.js";
import {
  customFieldFilterSql,
  foldText,
  matchesCustomFieldFilters,
  planCustomFieldFilters,
  taskLineCustomValues,
  type FieldDefinition
} from "./custom-fields.js";

const fields: FieldDefinition[] = [
  { key: "nang_luc", label: "Năng lực", type: "SELECT", options: [{ value: "a_plus_plus" }, { value: "a" }, { value: "b" }], required: false },
  { key: "chuyen_mon", label: "Chuyên môn", type: "MULTISELECT", options: [{ value: "retouch" }, { value: "color" }, { value: "model" }], required: false },
  { key: "ma_don_hang", label: "Mã đơn hàng", type: "TEXT", options: [], required: false },
  { key: "sla_gio", label: "SLA (giờ)", type: "NUMBER", options: [], required: false },
  { key: "ngay_chup", label: "Ngày chụp", type: "DATE", options: [], required: false }
];

const plan = (query: Record<string, unknown>) =>
  planCustomFieldFilters(fields, CustomFieldFiltersSchema.parse((withCustomFieldFilters(query).cf) ?? []));

const failure = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return { code: (error as { code?: string }).code, status: (error as { statusCode?: number }).statusCode, message: (error as Error).message };
  }
  return null;
};

describe("cf.<key> query parameters (PLAN §8: custom fields in the list filters)", () => {
  it("collects cf.key, repeated values and .from/.to; keeps the other parameters", () => {
    expect(withCustomFieldFilters({ q: "x", "cf.nang_luc": ["a", "b"], "cf.sla_gio.from": "4", "cf.sla_gio.to": "8", "cf.ma_don_hang": "PO-1" })).toEqual({
      q: "x",
      cf: [
        { key: "nang_luc", values: ["a", "b"] },
        { key: "sla_gio", values: [], from: "4", to: "8" },
        { key: "ma_don_hang", values: ["PO-1"] }
      ]
    });
    expect(withCustomFieldFilters({ projectId: "p" })).toEqual({ projectId: "p" });
  });

  it("rejects malformed keys and empty filters at the contract (400 by zod)", () => {
    expect(CustomFieldFiltersSchema.safeParse([{ key: "Bad Key", values: ["a"] }]).success).toBe(false);
    expect(CustomFieldFiltersSchema.safeParse([{ key: "nang_luc", values: [] }]).success).toBe(false);
    expect(CustomFieldFiltersSchema.safeParse(Array.from({ length: 11 }, (_, index) => ({ key: `k${index}`, values: ["a"] }))).success).toBe(false);
  });
});

describe("planCustomFieldFilters — keys whitelisted against the entity's active fields", () => {
  it("validates keys, option values, ranges, numbers and days", () => {
    expect(failure(() => plan({ "cf.khong_co": "a" }))).toMatchObject({ code: "CUSTOM_FIELD_FILTER_INVALID", status: 400 });
    expect(failure(() => plan({ "cf.nang_luc": "c" }))?.message).toContain("không tồn tại");
    expect(failure(() => plan({ "cf.nang_luc.from": "a" }))?.message).toContain("không lọc theo khoảng");
    expect(failure(() => plan({ "cf.sla_gio": "abc" }))?.message).toContain("cần số");
    expect(failure(() => plan({ "cf.ngay_chup.from": "2026-02-31" }))?.message).toContain("YYYY-MM-DD");
  });

  it("builds typed plans; __empty__ means 'no value'; the same key is merged", () => {
    expect(plan({ "cf.nang_luc": ["a", "__empty__"], "cf.sla_gio.from": "4", "cf.ngay_chup": "2026-10-01" })).toEqual([
      { key: "nang_luc", type: "SELECT", values: ["a"], empty: true },
      { key: "sla_gio", type: "NUMBER", values: [], from: 4, to: null, empty: false },
      { key: "ngay_chup", type: "DATE", values: ["2026-10-01"], from: null, to: null, empty: false }
    ]);
    expect(planCustomFieldFilters(fields, [{ key: "nang_luc", values: ["a"] }, { key: "nang_luc", values: ["b"] }])).toEqual([
      { key: "nang_luc", type: "SELECT", values: ["a", "b"], empty: false }
    ]);
  });
});

describe("matchesCustomFieldFilters (members, clients, board / KPI people)", () => {
  const values = { nang_luc: "a", chuyen_mon: ["retouch", "color"], ma_don_hang: "Đơn PO-Ánh 2026", sla_gio: 6, ngay_chup: "2026-10-05" };

  it("SELECT one of, MULTISELECT any of, TEXT contains (case and accent insensitive)", () => {
    expect(matchesCustomFieldFilters(values, plan({ "cf.nang_luc": ["a", "b"] }))).toBe(true);
    expect(matchesCustomFieldFilters(values, plan({ "cf.nang_luc": "b" }))).toBe(false);
    expect(matchesCustomFieldFilters(values, plan({ "cf.chuyen_mon": ["model", "color"] }))).toBe(true);
    expect(matchesCustomFieldFilters(values, plan({ "cf.chuyen_mon": "model" }))).toBe(false);
    expect(matchesCustomFieldFilters(values, plan({ "cf.ma_don_hang": "po-anh" }))).toBe(true);
    expect(foldText("Đơn PO-Ánh")).toBe("don po-anh");
  });

  it("NUMBER / DATE values and inclusive ranges; filters combine with AND", () => {
    expect(matchesCustomFieldFilters(values, plan({ "cf.sla_gio.from": "6", "cf.sla_gio.to": "8" }))).toBe(true);
    expect(matchesCustomFieldFilters(values, plan({ "cf.sla_gio.from": "7" }))).toBe(false);
    expect(matchesCustomFieldFilters(values, plan({ "cf.sla_gio": "6" }))).toBe(true);
    expect(matchesCustomFieldFilters(values, plan({ "cf.ngay_chup.to": "2026-10-05" }))).toBe(true);
    expect(matchesCustomFieldFilters(values, plan({ "cf.ngay_chup.from": "2026-10-06" }))).toBe(false);
    expect(matchesCustomFieldFilters(values, plan({ "cf.nang_luc": "a", "cf.sla_gio.from": "7" }))).toBe(false);
  });

  it("__empty__ matches records without the value (missing profile included); no plans match everything", () => {
    expect(matchesCustomFieldFilters({}, plan({ "cf.nang_luc": "__empty__" }))).toBe(true);
    expect(matchesCustomFieldFilters(null, plan({ "cf.nang_luc": "__empty__" }))).toBe(true);
    expect(matchesCustomFieldFilters({ chuyen_mon: [] }, plan({ "cf.chuyen_mon": "__empty__" }))).toBe(true);
    expect(matchesCustomFieldFilters(values, plan({ "cf.nang_luc": "__empty__" }))).toBe(false);
    expect(matchesCustomFieldFilters(null, [])).toBe(true);
  });
});

/** Minimal postgres.js stand-in: records the text and the bound values of a fragment tree. */
const fakeSql = (() => {
  type Fragment = { isFragment: true; text: string; values: unknown[] };
  const isFragment = (value: unknown): value is Fragment => typeof value === "object" && value !== null && (value as Fragment).isFragment === true;
  const sql = (strings: TemplateStringsArray | string, ...values: unknown[]): Fragment => {
    if (typeof strings === "string") {
      return { isFragment: true, text: strings.split(".").map((part) => `"${part}"`).join("."), values: [] };
    }
    let text = strings[0] ?? "";
    const flat: unknown[] = [];
    values.forEach((value, index) => {
      if (isFragment(value)) {
        text += value.text;
        flat.push(...value.values);
      } else {
        text += "$";
        flat.push(value);
      }
      text += strings[index + 1] ?? "";
    });
    return { isFragment: true, text: text.replace(/\s+/g, " "), values: flat };
  };
  return Object.assign(sql, { json: (value: unknown) => ({ json: value }) }) as unknown as QuerySql;
})();

describe("customFieldFilterSql — keys and values are bound, never concatenated", () => {
  it("SELECT / MULTISELECT use containment per value; TEXT unaccented LIKE; NUMBER typed ranges; __empty__", () => {
    const fragment = customFieldFilterSql(
      fakeSql,
      "j.custom_values",
      plan({ "cf.nang_luc": ["a", "__empty__"], "cf.chuyen_mon": "color", "cf.ma_don_hang": "x'; DROP TABLE x; --", "cf.sla_gio.from": "4" })
    ) as unknown as { text: string; values: unknown[] };
    expect(fragment.text).toContain('"j"."custom_values" @> $');
    expect(fragment.text).toContain("public.immutable_unaccent(lower(");
    expect(fragment.text).toContain("::numeric");
    expect(fragment.text).toContain("NOT (");
    expect(fragment.text).not.toContain("DROP TABLE");
    expect(fragment.text).not.toContain("nang_luc");
    expect(fragment.values).toContainEqual({ json: { nang_luc: "a" } });
    expect(fragment.values).toContainEqual({ json: { chuyen_mon: ["color"] } });
    expect(fragment.values).toContainEqual(["%x'; drop table x; --%"]);
    expect(fragment.values).toContain("4");
  });

  it("no plans → TRUE", () => {
    expect((customFieldFilterSql(fakeSql, "t.custom_values", []) as unknown as { text: string }).text).toBe("TRUE");
  });
});

describe("taskLineCustomValues — Chia task / Giao lại validate required TASK fields the same way", () => {
  const taskFields: FieldDefinition[] = [
    { key: "do_kho", label: "Độ khó", type: "SELECT", options: [{ value: "de" }, { value: "kho" }], required: true },
    { key: "ghi_chu", label: "Ghi chú kỹ thuật", type: "TEXT", options: [], required: false }
  ];

  it("a new task line must carry the required fields (400 CUSTOM_FIELDS_INVALID)", () => {
    expect(failure(() => taskLineCustomValues(taskFields, undefined, null))).toMatchObject({ code: "CUSTOM_FIELDS_INVALID", status: 400 });
    expect(taskLineCustomValues(taskFields, { do_kho: "kho" }, null)).toEqual({ do_kho: "kho" });
  });

  it("a feedback redo task inherits its source task's values; the line's values win; inactive keys are dropped", () => {
    expect(taskLineCustomValues(taskFields, undefined, { do_kho: "de", ghi_chu: "giữ nền", old_field: "x" })).toEqual({ do_kho: "de", ghi_chu: "giữ nền" });
    expect(taskLineCustomValues(taskFields, { do_kho: "kho", ghi_chu: null }, { do_kho: "de", ghi_chu: "giữ nền" })).toEqual({ do_kho: "kho" });
    expect(failure(() => taskLineCustomValues(taskFields, { do_kho: null }, { do_kho: "de" }))).toMatchObject({ code: "CUSTOM_FIELDS_INVALID" });
  });
});
