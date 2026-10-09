import { describe, expect, it } from "vitest";

import { encodeCursor } from "../../lib/db-types.js";
import { decodeTimeCursor, encodeTimeCursor, isValidCursorInstant } from "./cursor.js";

const id = "6f1c2d3e-4a5b-4c6d-8e7f-001122334455";

describe("production keyset cursors (BUG-PR-05, PR-16)", () => {
  it("round-trips the microsecond text the lists select", () => {
    const at = "2026-10-10T03:04:05.123456Z";
    expect(decodeTimeCursor(encodeTimeCursor(at, id))).toEqual({ at, id });
    // Cursors issued before the fix (milliseconds) keep working.
    expect(decodeTimeCursor(encodeCursor(["2026-10-10T03:04:05.123Z", id]))).toEqual({ at: "2026-10-10T03:04:05.123Z", id });
    expect(decodeTimeCursor(undefined)).toBeNull();
  });

  it("rejects anything the database would fail on with 400 INVALID_CURSOR", () => {
    for (const cursor of [
      "not-base64-json",
      encodeCursor(["2026-10-10T03:04:05Z"]),
      encodeCursor(["yesterday", id]),
      encodeCursor(["2026-10-10T03:04:05Z", "x"]),
      encodeCursor(["0000-01-01T00:00:00Z", id]),
      encodeCursor(["2026-02-31T00:00:00Z", id]),
      encodeCursor(["2026-10-10T25:00:00Z", id]),
      encodeCursor(["2026-10-10T03:04:05+07:00", id]),
      encodeCursor([12, id]),
      encodeCursor(["2026-10-10T03:04:05Z\u0000", id])
    ]) {
      expect(() => decodeTimeCursor(cursor), cursor).toThrowError(expect.objectContaining({ code: "INVALID_CURSOR", statusCode: 400 }) as Error);
    }
  });

  it("validates instants strictly", () => {
    expect(isValidCursorInstant("2028-02-29T23:59:59.999999Z")).toBe(true);
    expect(isValidCursorInstant("2026-02-29T00:00:00Z")).toBe(false);
    expect(isValidCursorInstant("1899-12-31T00:00:00Z")).toBe(false);
  });
});
