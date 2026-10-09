import { PassThrough } from "node:stream";

import ExcelJS from "exceljs";
import type { Response } from "express";
import { describe, expect, it } from "vitest";

import { businessDate, contentDisposition, numberFormats, percentCell, safeCell, safeText, sendWorkbook } from "./excel.js";

describe("excel helpers", () => {
  it("neutralises formula-looking text with an apostrophe", () => {
    for (const value of ["=1+1", "+SUM(A1)", "-2+3", "@cmd", "\t=1", "\r=1"]) {
      expect(safeText(value)).toBe(`'${value}`);
    }
    expect(safeText("BL JO020320 = batch")).toBe("BL JO020320 = batch");
    expect(safeCell(-5)).toBe(-5);
    expect(safeCell(Number.NaN)).toBeNull();
    expect(safeCell(null)).toBeNull();
  });

  it("builds an RFC 5987 Content-Disposition with an ASCII fallback", () => {
    const header = contentDisposition("Báo cáo 2026-09-26_2026-10-25 (xuất 2026-10-09).xlsx");
    expect(header).toBe(
      "attachment; filename=\"Bao_cao_2026-09-26_2026-10-25_xuat_2026-10-09.xlsx\"; filename*=UTF-8''B%C3%A1o%20c%C3%A1o%202026-09-26_2026-10-25%20%28xu%E1%BA%A5t%202026-10-09%29.xlsx"
    );
    expect(contentDisposition('a"b\r\n.xlsx')).not.toMatch(/[\r\n]|filename="a"/);
  });

  it("PR-25: percent cells are rounded to what 0.00% shows", () => {
    expect(percentCell(103.25 / 100)).toBe(1.0325);
    expect(String(percentCell(103.25 / 100))).toBe("1.0325");
    expect(percentCell(0.123456)).toBe(0.1235);
    expect(percentCell(null)).toBeNull();
    expect(percentCell(Number.NaN)).toBeNull();
  });

  it("PR-25: date cells without a column format still show as dates", async () => {
    const stream = new PassThrough();
    const res = Object.assign(stream, { status: () => res, setHeader: () => undefined }) as unknown as Response;
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise((resolve) => stream.on("end", resolve));
    await sendWorkbook(res, "x.xlsx", [
      {
        name: "Thông tin",
        columns: [
          { header: "Mục", key: "item" },
          { header: "Giá trị", key: "value" }
        ],
        rows: [
          { item: "Thời điểm xuất", value: businessDate("2026-10-09T17:30:00.000Z") },
          { item: "Ngày", value: new Date("2026-10-09T00:00:00Z") },
          { item: "Số", value: 3 }
        ]
      }
    ]);
    await done;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.concat(chunks) as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet("Thông tin")!;
    expect(sheet.getRow(2).getCell(2).numFmt).toBe(numberFormats.datetime);
    expect(sheet.getRow(3).getCell(2).numFmt).toBe(numberFormats.day);
    expect(sheet.getRow(4).getCell(2).numFmt).toBeFalsy();
  });

  it("shows instants in business time", () => {
    expect(businessDate("2026-10-09T17:30:00.000Z")?.toISOString()).toBe("2026-10-10T00:30:00.000Z");
    expect(businessDate(null)).toBeNull();
  });

  it("streams a workbook whose text cells cannot run formulas", async () => {
    const stream = new PassThrough();
    const headers: Record<string, string> = {};
    const res = Object.assign(stream, {
      status: () => res,
      setHeader: (name: string, value: string) => {
        headers[name.toLowerCase()] = value;
      }
    }) as unknown as Response;
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise((resolve) => stream.on("end", resolve));
    await sendWorkbook(res, "Danh sách job (xuất 2026-10-09).xlsx", [
      {
        name: "Job",
        columns: [
          { header: "Mã job", key: "code" },
          { header: "Tổng tấm", key: "total", numFmt: "#,##0" }
        ],
        rows: [
          { code: "=HYPERLINK(\"http://x\")", total: 10 },
          { code: "BL 01", total: -3 }
        ]
      },
      { name: "Thông tin", columns: [{ header: "Mục", key: "item" }], rows: [{ item: "@SUM(1)" }] }
    ]);
    await done;
    expect(headers["content-type"]).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(headers["content-disposition"]).toContain("filename*=UTF-8''Danh%20s%C3%A1ch%20job");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.concat(chunks) as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet("Job")!;
    expect(sheet.getRow(1).getCell(1).value).toBe("Mã job");
    expect(sheet.getRow(2).getCell(1).value).toBe("'=HYPERLINK(\"http://x\")");
    expect(sheet.getRow(2).getCell(1).formula).toBeUndefined();
    expect(sheet.getRow(3).getCell(2).value).toBe(-3);
    expect(workbook.getWorksheet("Thông tin")!.getRow(2).getCell(1).value).toBe("'@SUM(1)");
  });
});
