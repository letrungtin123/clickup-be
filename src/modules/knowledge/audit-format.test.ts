import { describe, expect, it } from "vitest";

import { KnowledgeAuditActionSchema } from "../../contracts/knowledge.js";
import { safeText } from "../production/excel.js";
import { auditActionLabel, auditActionLabels, clip, describeAuditEntry, rawAuditJson } from "./audit-format.js";

/** The Excel export's "Chi tiết" column (BE-2): one readable Vietnamese line per audit entry. */
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const describe1 = (action: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null) =>
  describeAuditEntry({ action, before, after });

describe("audit action labels", () => {
  it("has a Vietnamese label for every action, SPACE_DELETED included", () => {
    for (const action of KnowledgeAuditActionSchema.options) {
      expect(auditActionLabels[action]).toMatch(/\S/);
    }
    expect(auditActionLabel("SPACE_DELETED")).toBe("Xoá kho");
    expect(auditActionLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(auditActionLabel("constructor")).toBe("constructor");
  });
});

describe("describeAuditEntry", () => {
  it("status, importance and category changes read as before → after", () => {
    expect(describe1("ITEM_STATUS_CHANGED", { statusId: id(1), statusName: "Nháp", group: "draft" }, { statusId: id(2), statusName: "Đã ban hành", group: "active" })).toBe(
      "Trạng thái: Nháp → Đã ban hành"
    );
    expect(describe1("ITEM_IMPORTANCE_CHANGED", { importance: "normal" }, { importance: "critical" })).toBe("Mức quan trọng: Bình thường → Rất quan trọng");
    expect(describe1("ITEM_MOVED", { categoryId: id(3), categoryName: "Retouch" }, { categoryId: null, categoryName: null })).toBe(
      "Chuyên mục: “Retouch” → Chưa phân loại"
    );
    // Status names missing (old rows): the group label stands in.
    expect(describe1("ITEM_STATUS_CHANGED", { group: "draft" }, { group: "retired" })).toBe("Trạng thái: Bản nháp → Hết hiệu lực");
  });

  it("members: name and access levels", () => {
    expect(
      describe1("MEMBER_UPDATED", { userId: id(4), userName: "Minh Nguyễn", accessLevel: "view" }, { userId: id(4), userName: "Minh Nguyễn", accessLevel: "submit" })
    ).toBe("Thành viên: Minh Nguyễn — Chỉ xem → Thành viên");
    expect(describe1("MEMBER_ADDED", null, { userId: id(4), userName: "An Trần", accessLevel: "manage" })).toBe("Thành viên: An Trần — thêm với mức Quản lý");
    expect(describe1("MEMBER_REMOVED", { userId: id(4), userName: "An Trần", accessLevel: "view" }, null)).toBe(
      "Thành viên: An Trần — gỡ khỏi kho (đang là Chỉ xem)"
    );
    // No name snapshot: resolved by id, else a neutral word.
    expect(describeAuditEntry({ action: "MEMBER_ADDED", before: null, after: { userId: id(4), accessLevel: "view" } }, { user: () => "Khoa Lê" })).toBe(
      "Thành viên: Khoa Lê — thêm với mức Chỉ xem"
    );
    expect(describe1("MEMBER_ADDED", null, { userId: id(4), accessLevel: "view" })).toBe("Thành viên: (người dùng) — thêm với mức Chỉ xem");
  });

  it("content saves name the new version, the parts changed, the new title and the note", () => {
    expect(describe1("ITEM_CONTENT_UPDATED", { version: 4 }, { version: 5, changed: ["body"], note: null })).toBe("Sửa nội dung (Nội dung) → phiên bản 5");
    expect(
      describe1("ITEM_CONTENT_UPDATED", { version: 1, title: "Cũ" }, { version: 2, title: "Mới", changed: ["title", "summary"], note: "Cập nhật\nquy định" })
    ).toBe("Sửa nội dung (Tiêu đề, Tóm tắt) → phiên bản 2; Tiêu đề: “Cũ” → “Mới”; Ghi chú: “Cập nhật quy định”");
    expect(describe1("VERSION_RESTORED", { version: 4, title: "A" }, { version: 5, restoredFrom: 1, title: "A" })).toBe("Khôi phục nội dung phiên bản 1 → phiên bản 5");
    expect(
      describe1("ITEM_CREATED", null, { title: "Quy trình", statusName: "Nháp", group: "draft", importance: "important", categoryName: "Retouch", tags: ["a", "b"] })
    ).toBe("Phiên bản 1 · Trạng thái: Nháp · Mức quan trọng: Quan trọng · Chuyên mục: “Retouch” · Tag: a, b");
  });

  it("comments: edits keep the new and the old text, deletions the author and the text", () => {
    expect(describe1("COMMENT_EDITED", { commentId: id(5), text: "Bước 3 thiếu" }, { commentId: id(5), text: "Bước 3 thiếu định dạng" })).toBe(
      "Bình luận đã sửa: “Bước 3 thiếu định dạng” (trước: “Bước 3 thiếu”)"
    );
    expect(
      describe1("COMMENT_DELETED", { commentId: id(5), authorId: id(6), authorName: "An", text: "Sai rồi", replies: 2, moderated: true }, null)
    ).toBe("Bình luận của An đã xoá: “Sai rồi”; kèm 2 trả lời; Quản lý kho xoá");
    expect(describe1("COMMENT_RESOLVED", null, { commentId: id(5), resolved: true })).toBe("Góp ý: Đã xử lý");
    expect(describe1("COMMENT_RESOLVED", null, { commentId: id(5), resolved: false })).toBe("Góp ý: Mở lại");
    // Long texts are clipped to one line.
    const long = describe1("COMMENT_EDITED", { text: "x" }, { text: "y".repeat(1000) });
    expect(long.length).toBeLessThan(400);
    expect(long).toContain("…");
  });

  it("space entries: creation, settings, archive, restore, delete (old SPACE_UPDATED {deletedAt} rows too)", () => {
    expect(describe1("SPACE_CREATED", null, { name: "Hướng dẫn IT", visibility: "public", approvalRequired: true })).toBe(
      "Kho “Hướng dẫn IT” · Chế độ: Công khai · Bước duyệt: Bật"
    );
    expect(
      describe1("SPACE_UPDATED", { visibility: "public", approvalRequired: false, rank: "a" }, { visibility: "private", approvalRequired: true, rank: "b" })
    ).toBe("Chế độ: Công khai → Riêng tư; Bước duyệt: Tắt → Bật; Đổi thứ tự trên thanh bên");
    expect(describe1("SPACE_UPDATED", { name: "A" }, { name: "B" })).toBe("Tên: “A” → “B”");
    expect(describe1("SPACE_UPDATED", { deletedAt: null }, { deletedAt: "2026-10-11T08:00:00.000Z" })).toBe("Xoá kho (ẩn vĩnh viễn, nhật ký được giữ)");
    expect(describe1("SPACE_ARCHIVED", null, null)).toContain("lưu trữ");
    expect(describe1("SPACE_RESTORED", null, null)).toContain("mở lại");
    expect(describe1("SPACE_DELETED", { name: "Kho thử", visibility: "private", archivedAt: null, itemCount: 3 }, { deletedAt: "2026-10-11T08:00:00.000Z" })).toBe(
      "Xoá kho “Kho thử” (3 mục): ẩn vĩnh viễn với mọi người, nhật ký được giữ"
    );
  });

  it("status sets: added, renamed, regrouped and removed with where the items went", () => {
    const before = {
      statuses: [
        { id: id(1), name: "Nháp", group: "draft" },
        { id: id(2), name: "Chờ duyệt", group: "draft" },
        { id: id(3), name: "Đã ban hành", group: "active" }
      ]
    };
    const after = {
      statuses: [
        { id: id(1), name: "Bản thảo", group: "draft" },
        { id: id(3), name: "Đã ban hành", group: "active" },
        { id: id(4), name: "Hết hiệu lực", group: "retired" }
      ],
      reassigned: [{ from: id(2), to: id(1), items: 3 }]
    };
    expect(describe1("STATUSES_REPLACED", before, after)).toBe(
      "Bộ trạng thái: đổi tên “Nháp” → “Bản thảo”; thêm “Hết hiệu lực” (Hết hiệu lực); xoá “Chờ duyệt” (3 mục chuyển sang “Bản thảo”)"
    );
    const reordered = { statuses: [before.statuses[1], before.statuses[0], before.statuses[2]], reassigned: [] };
    expect(describe1("STATUSES_REPLACED", before, reordered)).toBe("Bộ trạng thái: đổi thứ tự");
  });

  it("categories, fields, files, trash and purge", () => {
    const categories = { category: (value: string) => (value === id(7) ? "Quy trình" : undefined) };
    expect(describeAuditEntry({ action: "CATEGORY_CREATED", before: null, after: { categoryId: id(8), name: "Retouch", parentId: id(7) } }, categories)).toBe(
      "Chuyên mục: “Retouch” (trong “Quy trình”)"
    );
    expect(
      describeAuditEntry(
        { action: "CATEGORY_UPDATED", before: { categoryId: id(8), name: "Retouch", parentId: null, rank: "a" }, after: { categoryId: id(8), name: "Chỉnh ảnh", parentId: id(7), rank: "b" } },
        categories
      )
    ).toBe("Chuyên mục “Retouch”: Tên: “Retouch” → “Chỉnh ảnh”; Chuyên mục cha: cấp đầu → “Quy trình”; Đổi thứ tự");
    expect(
      describe1("CATEGORY_DELETED", { categoryId: id(8), name: "Retouch", parentId: null }, { movedItems: 4, itemsMovedTo: null, subcategoriesMovedToTop: [id(9)] })
    ).toBe("Xoá chuyên mục “Retouch”; 4 mục chuyển sang Chưa phân loại; 1 chuyên mục con lên cấp đầu");
    expect(
      describe1(
        "ITEM_FIELDS_UPDATED",
        { ownerId: id(1), ownerName: "Linh", tags: ["a"], reviewBy: null, pinned: false },
        { ownerId: id(2), ownerName: "Minh", tags: ["a", "b"], reviewBy: "2026-12-31", pinned: true }
      )
    ).toBe("Người phụ trách: Linh → Minh; Tag: a → a, b; Hạn rà soát: — → 31/12/2026; Ghim mục");
    expect(describe1("ATTACHMENT_ADDED", null, { attachmentId: id(1), fileName: "quy-trinh.pdf", sizeBytes: 2048 })).toBe("Tệp: “quy-trinh.pdf” (2 KB)");
    expect(describe1("ATTACHMENT_REMOVED", { attachmentId: id(1), fileName: "anh.png", sizeBytes: 3 * 1024 * 1024 }, { keptForVersions: true })).toBe(
      "Tệp: “anh.png” (3.0 MB) — ảnh vẫn được giữ cho các phiên bản cũ"
    );
    expect(describe1("ITEM_DELETED", { statusName: "Đã ban hành", importance: "critical" }, null)).toBe(
      "Chuyển vào thùng rác (giữ 30 ngày); lúc xoá: trạng thái Đã ban hành, mức Rất quan trọng"
    );
    expect(describe1("ITEM_PURGED", { title: "Cũ", version: 3, importance: "normal", statusName: "Nháp" }, null)).toBe(
      "Xoá vĩnh viễn “Cũ” (phiên bản 3, Nháp, Bình thường)"
    );
  });

  it("falls back to a generic Vietnamese list for unknown actions and odd payloads, never throws", () => {
    expect(describe1("SOMETHING_NEW", { importance: "normal", rank: "a" }, { importance: "important", rank: "b" })).toBe("Mức quan trọng: Bình thường → Quan trọng");
    expect(describe1("SOMETHING_NEW", null, { pinned: true, customKey: "x" })).toBe("Ghim: Đã ghim; customKey: x");
    expect(describe1("SOMETHING_NEW", null, null)).toBe("");
    expect(() => describe1("STATUSES_REPLACED", { statuses: "oops" }, { statuses: [null, 3], reassigned: {} })).not.toThrow();
    expect(() => describe1("ITEM_CONTENT_UPDATED", { version: "x" }, { changed: "body" })).not.toThrow();
    expect(describe1("ITEM_IMPORTANCE_CHANGED", { importance: "constructor" }, { importance: "toString" })).toBe("Mức quan trọng: — → —");
  });

  it("a detail that looks like a formula is escaped by the workbook writer", () => {
    const detail = describe1("SOMETHING_NEW", null, { customKey: "=HYPERLINK(1)" });
    expect(safeText(`=${detail}`).startsWith("'")).toBe(true);
    expect(describe1("SOMETHING_NEW", null, { "=cmd": "x" })).toBe("=cmd: x");
    expect(safeText(describe1("SOMETHING_NEW", null, { "=cmd": "x" }))).toBe("'=cmd: x");
  });
});

describe("rawAuditJson / clip", () => {
  it("keeps both payloads, capped to fit an Excel cell", () => {
    expect(rawAuditJson({ before: null, after: null })).toBeNull();
    expect(rawAuditJson({ before: { a: 1 }, after: null })).toBe('{"before":{"a":1},"after":null}');
    const huge = rawAuditJson({ before: { text: "x".repeat(40_000) }, after: null });
    expect(huge?.length).toBe(32_000);
    expect(huge?.endsWith("…")).toBe(true);
  });

  it("clips to one line", () => {
    expect(clip("a\n\n b\tc")).toBe("a b c");
    expect(clip("abcdef", 4)).toBe("abc…");
  });
});
