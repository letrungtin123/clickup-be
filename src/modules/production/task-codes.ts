import type { QuerySql } from "../../lib/db-types.js";

/**
 * PD-045 display codes of production tasks ("#" + code in the UI, history, notifications, exports). A line shows its
 * number ("1216"); a subtask (PD-044) shows its line's number + a letter in creation order ("1216a", "1216b", …).
 * `production.tasks.sub_seq` is the letter's index among the line's subtasks (1 = a), never reused: a deleted subtask
 * keeps its letter (migration 20261014_0300). Pure helpers; the SQL fragment only reads.
 */

/** Highest `sub_seq` (tasks_sub_seq_check): "zz". */
export const maxSubtaskSeq = 702;

/**
 * Letters of a subtask index, like spreadsheet columns in lower case: 1 → "a" … 26 → "z", 27 → "aa", 28 → "ab" …
 * 702 → "zz". Null for anything that is not a positive integer.
 */
export const subtaskLetters = (seq: number): string | null => {
  if (!Number.isSafeInteger(seq) || seq < 1) {
    return null;
  }
  let rest = seq;
  let letters = "";
  while (rest > 0) {
    const index = (rest - 1) % 26;
    letters = String.fromCharCode(97 + index) + letters;
    rest = Math.floor((rest - 1) / 26);
  }
  return letters;
};

/**
 * Display code of a task row: a subtask's line number + its letters when both are known (`parentNumber` is given for
 * subtasks only), otherwise the row's own number ("1216").
 */
export const taskCode = (row: { number: number | string; subSeq?: number | null; parentNumber?: number | string | null }) => {
  const letters = row.subSeq === null || row.subSeq === undefined ? null : subtaskLetters(Number(row.subSeq));
  return row.parentNumber !== null && row.parentNumber !== undefined && letters !== null
    ? `${Number(row.parentNumber)}${letters}`
    : String(Number(row.number));
};

/**
 * The line number of a subtask (NORMAL row with a parent line), NULL for any other row — feedback redo tasks also have a
 * parent_task_id (their source task) but keep their own number. Expects the task alias `t`.
 */
export const parentNumberSql = (sql: QuerySql) => sql`
  CASE WHEN t.kind = 'NORMAL' AND t.parent_task_id IS NOT NULL THEN (
    SELECT pt.number FROM production.tasks pt WHERE pt.organization_id = t.organization_id AND pt.id = t.parent_task_id
  ) END
`;
