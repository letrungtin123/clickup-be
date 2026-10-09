import { describe, expect, it } from "vitest";

import { isAlignedPeriod, parseKpiTargetCsv, parseTargetNumber } from "./kpi-targets.js";

describe("parseTargetNumber", () => {
  it("accepts plain numbers, thousands separators (vi/en) and decimal commas", () => {
    expect(parseTargetNumber("2600")).toBe(2600);
    expect(parseTargetNumber(" 2.600 ")).toBe(2600);
    expect(parseTargetNumber("1,848")).toBe(1848);
    expect(parseTargetNumber("1 848")).toBe(1848);
    expect(parseTargetNumber("2472.5")).toBe(2472.5);
    expect(parseTargetNumber("2472,5")).toBe(2472.5);
    expect(parseTargetNumber("0")).toBe(0);
  });

  it("PR-25: accepts Vietnamese (2.472,5) and English (2,472.5) grouped decimals", () => {
    expect(parseTargetNumber("2.472,5")).toBe(2472.5);
    expect(parseTargetNumber("1.234.567,25")).toBeNull(); // over 1 000 000
    expect(parseTargetNumber("12.472,25")).toBe(12472.25);
    expect(parseTargetNumber("2,472.5")).toBe(2472.5);
    expect(parseTargetNumber("2.472,555")).toBeNull();
    expect(parseTargetNumber("2.47,5")).toBeNull();
  });

  it("rejects empty, negative, non-numeric, more than 2 decimals or absurd values", () => {
    for (const bad of ["", "abc", "-5", "1.234.5", "1.2345", "2e3", "1000001"]) {
      expect(parseTargetNumber(bad), bad).toBeNull();
    }
  });
});

describe("parseKpiTargetCsv", () => {
  it("parses user_email,target (header case-insensitive, extra columns ignored, emails lowercased)", () => {
    const { rows, errors } = parseKpiTargetCsv("User_Email,Name,Target\nNV01@Test.Local,NV 01,2600\nnv02@test.local,NV 02,\"1,848\"\n");
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { line: 2, email: "nv01@test.local", target: 2600 },
      { line: 3, email: "nv02@test.local", target: 1848 }
    ]);
  });

  it("reports every bad line with its number (all-or-nothing)", () => {
    const { errors } = parseKpiTargetCsv(
      ["user_email,target", "nv01@test.local,2600", "not-an-email,2600", "nv03@test.local,abc", "NV01@test.local,2400", "nv05@test.local,"].join("\n")
    );
    expect(errors.map((error) => error.line)).toEqual([3, 4, 5, 6]);
    expect(errors[2]!.message).toContain("dòng 2");
  });

  it("rejects files without the required columns or rows", () => {
    expect(parseKpiTargetCsv("email,kpi\na@b.co,1").errors[0]).toMatchObject({ line: 1 });
    expect(parseKpiTargetCsv("").errors).toHaveLength(1);
    expect(parseKpiTargetCsv("user_email,target\n").errors[0]!.message).toBe("Không có dòng dữ liệu.");
  });
});

describe("isAlignedPeriod", () => {
  it("quarters start in Jan/Apr/Jul/Oct, years in January", () => {
    expect(isAlignedPeriod("MONTH", "2026-11")).toBe(true);
    expect(isAlignedPeriod("QUARTER", "2026-10")).toBe(true);
    expect(isAlignedPeriod("QUARTER", "2026-11")).toBe(false);
    expect(isAlignedPeriod("YEAR", "2026-01")).toBe(true);
    expect(isAlignedPeriod("YEAR", "2026-04")).toBe(false);
  });
});
