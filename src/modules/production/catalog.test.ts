import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { AppError } from "../../lib/app-error.js";
import { parseCreditCsv } from "./credit-rules.js";
import { parseCsv } from "./csv.js";
import { validateCustomValues, type FieldDefinition } from "./custom-fields.js";
import { addDays, businessDay, isValidDay, startOfBusinessDay } from "./time.js";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, CRLF, BOM and multi-line cells with source lines", () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n"multi\nline",z\n');
    expect(rows).toEqual([
      { line: 1, cells: ["a", "b"] },
      { line: 2, cells: ["x, y", 'say "hi"'] },
      { line: 4, cells: ["multi\nline", "z"] }
    ]);
  });

  it("keeps a last row without a trailing newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      { line: 1, cells: ["a", "b"] },
      { line: 2, cells: ["1", "2"] }
    ]);
  });
});

describe("parseCreditCsv (SPEC Phase 1 §6)", () => {
  it("parses rows; money 0 or empty means no price; decimal comma accepted", () => {
    const { rows, errors } = parseCreditCsv(
      "project_code,process_name,credit,money\nACME,Checking,0.25,0\nACME,Normal Retouch,\"2,40\",6000\nBETA,Premium Retouch,7.5,\n"
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { line: 2, projectCode: "ACME", processName: "Checking", credit: 0.25, money: null },
      { line: 3, projectCode: "ACME", processName: "Normal Retouch", credit: 2.4, money: 6000 },
      { line: 4, projectCode: "BETA", processName: "Premium Retouch", credit: 7.5, money: null }
    ]);
  });

  it("reports every bad line with its number and returns no rows to write", () => {
    const { errors } = parseCreditCsv(
      [
        "project_code,process_name,credit,money",
        "ACME,Checking,0.25,0",
        "ACME,Checking,0.30,0",
        ",Normal Retouch,1,0",
        "BETA,Premium Retouch,1.234,0",
        "BETA,Normal Retouch,-1,0",
        "ZETA,Normal Retouch,2,abc"
      ].join("\n")
    );
    expect(errors.map((error) => error.line)).toEqual([3, 4, 5, 6, 7]);
    expect(errors[0]!.message).toContain("dòng 2");
  });

  it("rejects a file without the required columns", () => {
    const missing = parseCreditCsv("code,name\nA,B").errors;
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ line: 1 });
    expect(missing[0]!.message).toContain("project_code");
    expect(parseCreditCsv("").errors).toHaveLength(1);
    expect(parseCreditCsv("project_code,process_name,credit\n").errors[0]!.message).toBe("Không có dòng dữ liệu.");
  });

  const seedPath = new URL("../../../../docs/retouch/seed/seed_credit_rules_T5_2026.csv", import.meta.url);
  // The real price table lives only in the private monorepo (docs/retouch); skipped elsewhere.
  it.runIf(existsSync(seedPath))("accepts the seed credit table", () => {
    const { rows, errors } = parseCreditCsv(readFileSync(seedPath, "utf8"));
    expect(errors).toEqual([]);
    expect(rows.length).toBeGreaterThan(40);
  });
});

describe("validateCustomValues", () => {
  const fields: FieldDefinition[] = [
    { key: "note", label: "Ghi chú", type: "TEXT", options: [], required: false },
    { key: "deadline_extra", label: "Gia hạn", type: "NUMBER", options: [], required: false },
    { key: "start", label: "Ngày vào", type: "DATE", options: [], required: false },
    { key: "level", label: "Cấp", type: "SELECT", options: [{ value: "junior" }, { value: "senior" }], required: true },
    { key: "skills", label: "Kỹ năng", type: "MULTISELECT", options: [{ value: "skin" }, { value: "hair" }], required: false }
  ];

  it("accepts valid values and normalizes them", () => {
    expect(
      validateCustomValues(fields, { note: "  hi ", deadline_extra: "3", start: "2026-05-01", level: "senior", skills: ["skin", "skin"] }, { enforceRequired: true })
    ).toEqual({ note: "hi", deadline_extra: 3, start: "2026-05-01", level: "senior", skills: ["skin"] });
  });

  it("rejects unknown keys, wrong types, values outside the option list and missing required fields", () => {
    const run = (input: Record<string, unknown>) => () => validateCustomValues(fields, input as never, { enforceRequired: true });
    expect(run({ level: "junior", other: "x" })).toThrow(AppError);
    expect(run({ level: "lead" })).toThrow(/Cấp/);
    expect(run({ level: "junior", start: "2026-02-30" })).toThrow(/Ngày vào/);
    expect(run({ level: "junior", deadline_extra: "abc" })).toThrow(/Gia hạn/);
    expect(run({ level: "junior", skills: ["nails"] })).toThrow(/Kỹ năng/);
    expect(run({ note: "x" })).toThrow(/bắt buộc/);
  });

  it("merges partial updates with existing values and clears with null", () => {
    expect(
      validateCustomValues(fields, { note: null, skills: ["hair"] }, { existing: { note: "old", level: "junior" }, enforceRequired: true })
    ).toEqual({ level: "junior", skills: ["hair"] });
  });
});

describe("business calendar", () => {
  it("evaluates days in Asia/Ho_Chi_Minh", () => {
    expect(businessDay(new Date("2026-05-24T17:30:00Z"))).toBe("2026-05-25");
    expect(businessDay(new Date("2026-05-24T16:59:59Z"))).toBe("2026-05-24");
    expect(startOfBusinessDay("2026-05-25").toISOString()).toBe("2026-05-24T17:00:00.000Z");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(isValidDay("2026-02-29")).toBe(false);
  });
});
