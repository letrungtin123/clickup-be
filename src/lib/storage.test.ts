import { afterEach, describe, expect, it, vi } from "vitest";

import { env } from "../config/env.js";
import {
  createSignedUploadUrl,
  fallbackUploadTtlSeconds,
  isAllowedUploadType,
  sanitizeFileName,
  signedUploadExpiry,
  storageSafeSegment
} from "./storage.js";

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

/** A token shaped like storage-api's signed-upload JWT (the signature is never checked when reading exp). */
const unsignedJwt = (claims: Record<string, unknown>) =>
  `${[{ alg: "HS256", typ: "JWT" }, claims].map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".")}.signature`;

describe("signed upload expiry (SEC2-26)", () => {
  const now = Date.parse("2026-10-11T00:00:00.000Z");
  const savedKey = env.SUPABASE_SERVICE_ROLE_KEY;

  afterEach(() => {
    vi.unstubAllGlobals();
    env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
  });

  it("reports the token's own exp claim", () => {
    const iat = now / 1000;
    expect(signedUploadExpiry(unsignedJwt({ url: "bucket/a.pdf", iat, exp: iat + 60 }), now).toISOString()).toBe("2026-10-11T00:01:00.000Z");
    expect(signedUploadExpiry(unsignedJwt({ exp: iat + 7200 }), now).toISOString()).toBe("2026-10-11T02:00:00.000Z");
  });

  it("falls back to storage's default lifetime when the token cannot be read", () => {
    const fallback = new Date(now + fallbackUploadTtlSeconds * 1000).toISOString();
    for (const token of [undefined, null, "", "not-a-jwt", "a.%%%.c", unsignedJwt({ url: "bucket/a.pdf" }), unsignedJwt({ exp: "soon" }), unsignedJwt({ exp: 1e20 })]) {
      expect(signedUploadExpiry(token, now).toISOString()).toBe(fallback);
    }
  });

  it("returns the browser upload URL with the real expiry of its token", async () => {
    env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-key";
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = unsignedJwt({ url: `${env.STORAGE_BUCKET}/org/x/a.pdf`, iat: exp - 60, exp });
    const fetchMock = vi.fn((input: string | URL) => {
      const url = input.toString();
      if (url.includes("/object/upload/sign/")) {
        // No separate "token" field: the expiry is read from the URL's token.
        return Promise.resolve(Response.json({ url: `/object/upload/sign/${env.STORAGE_BUCKET}/org/x/a.pdf?token=${token}` }));
      }
      return Promise.resolve(Response.json({ id: env.STORAGE_BUCKET }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const ticket = await createSignedUploadUrl("org/x/a.pdf");
    expect(ticket.url).toContain(`/storage/v1/object/upload/sign/${env.STORAGE_BUCKET}/org/x/a.pdf?token=${token}`);
    expect(ticket.expiresAt).toBe(new Date(exp * 1000).toISOString());
  });
});
