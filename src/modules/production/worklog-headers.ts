/**
 * The company work-log columns (PD-035 "v2" layout). PD-078 renamed two of them in the app — "Dự án" → "Project" and
 * "Gói công việc" → "Job Code": the work-log export (exports.service.ts `workLogColumns`) writes the new names, and a work
 * log is still read with either spelling (scripts/import-worklog-v2.ts), so older files keep importing. The first name
 * of each list is the current one.
 */
export const workLogHeaders = {
  staff: ["Nhân viên thực hiện"],
  project: ["Project", "Dự án"],
  pkg: ["Job Code", "Gói công việc"],
  process: ["Quy trình"],
  received: ["Ngày nhận"],
  delivered: ["Ngày giao"],
  shift: ["Ca làm việc"],
  qty: ["Số lượng"],
  errors: ["Hình lỗi"],
  ot: ["Giờ OT"],
  note: ["Ghi chú"]
} as const satisfies Record<string, readonly [string, ...string[]]>;

export type WorkLogColumn = keyof typeof workLogHeaders;

/** The hint the export appends to the Job Code header (the company file's own wording). */
export const jobCodeHeaderHint = "Folder hình, hỏi leader nếu không rõ";

/**
 * The column a header cell names (null: none of ours): one of its spellings exactly, or followed by " (…)" — the
 * export's "Job Code (Folder hình, hỏi leader nếu không rõ)". Surrounding spaces are ignored.
 */
export const workLogColumnOf = (header: string): WorkLogColumn | null => {
  const text = header.trim();
  for (const [column, labels] of Object.entries(workLogHeaders) as [WorkLogColumn, readonly string[]][]) {
    if (labels.some((label) => text === label || text.startsWith(`${label} (`))) {
      return column;
    }
  }
  return null;
};
