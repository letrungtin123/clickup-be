import { describe, expect, it } from "vitest";

import { AppError } from "./app-error.js";
import {
  decodeKeysetCursor,
  decodeTimeCursor,
  encodeCursor,
  encodeKeysetCursor,
  encodeTimeCursor,
  isCursorTimestamp
} from "./db-types.js";

const id = "3f0c1d9e-8a4b-4c2d-9e1f-2a3b4c5d6e7f";

const expectInvalidCursor = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(400);
    expect((error as AppError).code).toBe("INVALID_CURSOR");
    return;
  }
  throw new Error("expected INVALID_CURSOR");
};

describe("cursor timestamps (BUG-WK-12)", () => {
  it("accepts full-precision UTC texts, PostgreSQL texts and infinity", () => {
    expect(isCursorTimestamp("2026-10-10T01:02:03.123456Z")).toBe(true);
    expect(isCursorTimestamp("2026-10-10 01:02:03.123456+00")).toBe(true);
    expect(isCursorTimestamp("2026-10-10T01:02:03Z")).toBe(true);
    expect(isCursorTimestamp("infinity")).toBe(true);
    expect(isCursorTimestamp("-infinity")).toBe(true);
  });

  it("rejects malformed or out-of-range timestamps", () => {
    for (const value of ["2026-13-01T00:00:00Z", "2026-10-10T25:00:00Z", "0000-01-01T00:00:00Z", "yesterday", "", 42, null, "2026-10-10T01:02:03.1234567Z"]) {
      expect(isCursorTimestamp(value)).toBe(false);
    }
  });

  it("round-trips a time cursor without losing microseconds", () => {
    const cursor = encodeTimeCursor("2026-10-10T01:02:03.123456Z", id);
    expect(decodeTimeCursor(cursor)).toEqual({ at: "2026-10-10T01:02:03.123456Z", id });
    expect(decodeTimeCursor(undefined)).toBeNull();
  });

  it("answers 400 for garbage, injection attempts and wrong shapes", () => {
    expectInvalidCursor(() => decodeTimeCursor("garbage"));
    expectInvalidCursor(() => decodeTimeCursor(encodeCursor(["2026-10-10T01:02:03Z'; DROP TABLE x", id])));
    expectInvalidCursor(() => decodeTimeCursor(encodeCursor(["2026-10-10T01:02:03Z", "not-a-uuid"])));
    expectInvalidCursor(() => decodeTimeCursor(encodeCursor(["2026-10-10T01:02:03Z"])));
    expectInvalidCursor(() => decodeTimeCursor("x".repeat(3000)));
  });
});

describe("typed keyset cursors (BUG-WK-01)", () => {
  it("round-trips every sort kind, including infinity due dates", () => {
    expect(decodeKeysetCursor(encodeKeysetCursor("dueAt.asc", "infinity", id), "dueAt.asc", "timestamp")).toEqual({ value: "infinity", id });
    expect(decodeKeysetCursor(encodeKeysetCursor("rank.asc", "a0V", id), "rank.asc", "text")).toEqual({ value: "a0V", id });
    expect(decodeKeysetCursor(encodeKeysetCursor("priority.desc", 3, id), "priority.desc", "integer")).toEqual({ value: 3, id });
  });

  it("rejects a cursor of another sort or with a value of the wrong kind", () => {
    expectInvalidCursor(() => decodeKeysetCursor(encodeKeysetCursor("dueAt.asc", "infinity", id), "dueAt.desc", "timestamp"));
    expectInvalidCursor(() => decodeKeysetCursor(encodeKeysetCursor("createdAt.asc", "not a date", id), "createdAt.asc", "timestamp"));
    expectInvalidCursor(() => decodeKeysetCursor(encodeKeysetCursor("number.asc", "12", id), "number.asc", "integer"));
    expectInvalidCursor(() => decodeKeysetCursor(encodeKeysetCursor("number.asc", 1.5, id), "number.asc", "integer"));
    expectInvalidCursor(() => decodeKeysetCursor(encodeKeysetCursor("title.asc", `a${String.fromCharCode(0)}b`, id), "title.asc", "text"));
    expectInvalidCursor(() => decodeKeysetCursor(encodeCursor(["rank.asc", "a0"]), "rank.asc", "text"));
  });

  it("returns null without a cursor", () => {
    expect(decodeKeysetCursor(undefined, "rank.asc", "text")).toBeNull();
  });
});
