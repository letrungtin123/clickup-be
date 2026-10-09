/**
 * Minimal RFC 4180 CSV parser (quotes, escaped quotes, CRLF/LF, BOM). Returns rows with their
 * 1-based source line numbers so import errors can point at the exact line.
 */
export const parseCsv = (text: string): { line: number; cells: string[] }[] => {
  const input = text.startsWith("﻿") ? text.slice(1) : text;
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowStartLine = 1;

  const endCell = () => {
    cells.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (!(cells.length === 1 && cells[0]!.trim() === "")) {
      rows.push({ line: rowStartLine, cells });
    }
    cells = [];
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === "\n") {
          line += 1;
        }
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell.length === 0) {
      quoted = true;
    } else if (char === ",") {
      endCell();
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") {
        index += 1;
      }
      endRow();
      line += 1;
      rowStartLine = line;
    } else {
      cell += char;
    }
  }
  if (cell.length > 0 || cells.length > 0) {
    endRow();
  }
  return rows;
};
