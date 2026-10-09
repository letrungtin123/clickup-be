import { describe, expect, it } from "vitest";

import { isAllowedUploadType, sanitizeFileName, storageSafeSegment } from "./storage.js";

const char = (code: number) => String.fromCodePoint(code);

describe("file names (SEC-API-14, WK-32)", () => {
  it("never yields a dot segment, even after ASCII folding", () => {
    const combiningAcute = char(0x301);
    for (const name of [`${combiningAcute}..`, "..", ".", " ../", `${char(0x2026)}`, `${combiningAcute}.${combiningAcute}.`]) {
      const segment = storageSafeSegment(name);
      expect(segment).not.toMatch(/^\.+$/);
      expect(segment).not.toMatch(/^\./);
      expect(segment.length).toBeGreaterThan(0);
    }
    expect(sanitizeFileName("../../etc/passwd")).toBe("_.._etc_passwd");
    expect(sanitizeFileName("   ")).toBe("file");
  });

  it("strips bidi overrides and zero-width characters that disguise extensions", () => {
    const rlo = char(0x202e);
    const zwsp = char(0x200b);
    expect(sanitizeFileName(`invoice${rlo}gpj.exe`)).toBe("invoicegpj.exe");
    expect(sanitizeFileName(`re${zwsp}port.pdf`)).toBe("report.pdf");
    expect(sanitizeFileName("Báo cáo tháng 10.xlsx")).toBe("Báo cáo tháng 10.xlsx");
    expect(storageSafeSegment("Báo cáo tháng 10.xlsx")).toBe("Bao-cao-thang-10.xlsx");
  });
});

describe("upload allowlist (SEC-API-01)", () => {
  it("allows images, documents, archives and media", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp", "application/pdf", "text/csv", "application/zip", "video/mp4", "audio/mpeg",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/plain; charset=utf-8", "IMAGE/PNG"]) {
      expect(isAllowedUploadType(type)).toBe(true);
    }
  });

  it("refuses active content and anything unknown", () => {
    for (const type of ["text/html", "image/svg+xml", "application/javascript", "application/x-msdownload", "application/octet-stream",
      "application/xhtml+xml", "application/x-sh", "text/xml", "application/x-unknown"]) {
      expect(isAllowedUploadType(type)).toBe(false);
    }
  });
});
