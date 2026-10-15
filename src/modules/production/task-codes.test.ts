import { describe, expect, it } from "vitest";

import { maxSubtaskSeq, subtaskLetters, taskCode } from "./task-codes.js";

/** PD-045 display codes: a line "1216", its subtasks "1216a", "1216b" … like spreadsheet columns in lower case. */
describe("subtask letters (PD-045)", () => {
  it("counts like spreadsheet columns, lower case", () => {
    expect(subtaskLetters(1)).toBe("a");
    expect(subtaskLetters(2)).toBe("b");
    expect(subtaskLetters(26)).toBe("z");
    expect(subtaskLetters(27)).toBe("aa");
    expect(subtaskLetters(28)).toBe("ab");
    expect(subtaskLetters(52)).toBe("az");
    expect(subtaskLetters(53)).toBe("ba");
    expect(subtaskLetters(maxSubtaskSeq)).toBe("zz");
    expect(subtaskLetters(703)).toBe("aaa");
  });

  it("has no letters for anything but a positive integer", () => {
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(subtaskLetters(value)).toBeNull();
    }
  });

  it("every index up to zz has its own letters", () => {
    const all = Array.from({ length: maxSubtaskSeq }, (_, index) => subtaskLetters(index + 1));
    expect(new Set(all).size).toBe(maxSubtaskSeq);
    expect(all.every((letters) => letters !== null && /^[a-z]{1,2}$/.test(letters))).toBe(true);
  });
});

describe("task codes (PD-045)", () => {
  it("a line shows its number; a subtask its line's number and its letters", () => {
    expect(taskCode({ number: 1216 })).toBe("1216");
    expect(taskCode({ number: "1216", subSeq: null, parentNumber: null })).toBe("1216");
    expect(taskCode({ number: 1300, subSeq: 1, parentNumber: 1216 })).toBe("1216a");
    expect(taskCode({ number: "1301", subSeq: 2, parentNumber: "1216" })).toBe("1216b");
    expect(taskCode({ number: 1400, subSeq: 27, parentNumber: 1216 })).toBe("1216aa");
  });

  it("falls back to the row's own number when a part is missing (a feedback redo task, an old row)", () => {
    expect(taskCode({ number: 1400, subSeq: null, parentNumber: 1216 })).toBe("1400");
    expect(taskCode({ number: 1400, subSeq: 3, parentNumber: null })).toBe("1400");
    expect(taskCode({ number: 1400, subSeq: 0, parentNumber: 1216 })).toBe("1400");
  });
});
