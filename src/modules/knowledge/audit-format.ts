import type { KnowledgeAuditAction } from "../../contracts/knowledge.js";

/**
 * Vietnamese wording of the space audit log for the Excel export (the screen has its own copy in the FE,
 * `features/knowledge/model/audit.ts`). `describeAuditEntry` turns the free-form before / after payloads written by
 * the services into one readable "Chi tiết" line, e.g. "Trạng thái: Nháp → Đã ban hành" or
 * "Thành viên: Minh Nguyễn — Chỉ xem → Thành viên". Pure, so every action is unit-tested; payloads are read
 * defensively (old rows, missing keys, unexpected types never throw).
 */

export const auditActionLabels: Record<KnowledgeAuditAction, string> = {
  SPACE_CREATED: "Tạo kho",
  SPACE_UPDATED: "Sửa thông tin kho",
  SPACE_ARCHIVED: "Lưu trữ kho",
  SPACE_RESTORED: "Khôi phục kho",
  SPACE_DELETED: "Xoá kho",
  MEMBER_ADDED: "Thêm thành viên",
  MEMBER_UPDATED: "Đổi mức quyền",
  MEMBER_REMOVED: "Gỡ thành viên",
  STATUSES_REPLACED: "Sửa bộ trạng thái",
  CATEGORY_CREATED: "Tạo chuyên mục",
  CATEGORY_UPDATED: "Sửa chuyên mục",
  CATEGORY_DELETED: "Xoá chuyên mục",
  ITEM_CREATED: "Tạo mục",
  ITEM_CONTENT_UPDATED: "Sửa nội dung",
  ITEM_FIELDS_UPDATED: "Sửa thông tin mục",
  ITEM_STATUS_CHANGED: "Đổi trạng thái",
  ITEM_IMPORTANCE_CHANGED: "Đổi mức quan trọng",
  ITEM_MOVED: "Đổi chuyên mục",
  ITEM_DELETED: "Xoá vào thùng rác",
  ITEM_RESTORED: "Khôi phục từ thùng rác",
  ITEM_PURGED: "Xoá vĩnh viễn",
  VERSION_RESTORED: "Khôi phục phiên bản",
  ATTACHMENT_ADDED: "Thêm tệp",
  ATTACHMENT_REMOVED: "Xoá tệp",
  COMMENT_DELETED: "Xoá bình luận",
  COMMENT_RESOLVED: "Đánh dấu góp ý",
  COMMENT_EDITED: "Sửa bình luận"
};

/** Label of an action; unknown values (rows written by a newer server) fall back to the raw code. */
export const auditActionLabel = (action: string) =>
  Object.hasOwn(auditActionLabels, action) ? auditActionLabels[action as KnowledgeAuditAction] : action;

type Payload = Record<string, unknown> | null | undefined;

export type AuditDetailInput = { action: string; before: Payload; after: Payload };

/** Names of things the payload only knows by id (current categories of the space, people). */
export type AuditDetailResolvers = {
  category?: (id: string) => string | undefined;
  user?: (id: string) => string | undefined;
};

const importanceLabels: Record<string, string> = { normal: "Bình thường", important: "Quan trọng", critical: "Rất quan trọng" };
const accessLabels: Record<string, string> = { view: "Chỉ xem", submit: "Thành viên", manage: "Quản lý" };
const visibilityLabels: Record<string, string> = { public: "Công khai", private: "Riêng tư" };
const groupLabels: Record<string, string> = { draft: "Bản nháp", active: "Đang áp dụng", retired: "Hết hiệu lực" };
const contentParts: Record<string, string> = { title: "Tiêu đề", summary: "Tóm tắt", body: "Nội dung" };

/** Generic fallback: field labels (payload keys of every action) and keys never shown. */
const fieldLabels: Record<string, string> = {
  title: "Tiêu đề",
  name: "Tên",
  summary: "Tóm tắt",
  description: "Mô tả",
  statusName: "Trạng thái",
  group: "Nhóm trạng thái",
  importance: "Mức quan trọng",
  ownerName: "Người phụ trách",
  categoryName: "Chuyên mục",
  tags: "Tag",
  reviewBy: "Hạn rà soát",
  effectiveFrom: "Ngày hiệu lực",
  pinned: "Ghim",
  accessLevel: "Mức quyền",
  userName: "Người",
  visibility: "Chế độ",
  color: "Màu",
  icon: "Biểu tượng",
  approvalRequired: "Bước duyệt",
  fileName: "Tệp",
  sizeBytes: "Dung lượng",
  resolved: "Góp ý",
  version: "Phiên bản",
  restoredFrom: "Khôi phục từ phiên bản",
  note: "Ghi chú phiên bản",
  authorName: "Người viết",
  text: "Nội dung",
  itemCount: "Số mục",
  movedItems: "Số mục chuyển",
  archivedAt: "Lưu trữ",
  deletedAt: "Xoá"
};
const hiddenKeys = new Set([
  "id",
  "spaceId",
  "itemId",
  "statusId",
  "categoryId",
  "parentId",
  "ownerId",
  "userId",
  "authorId",
  "commentId",
  "attachmentId",
  "rank",
  "placement",
  "position",
  "changed",
  "statuses",
  "reassigned",
  "itemsMovedTo",
  "subcategoriesMovedToTop",
  "keptForVersions",
  "replies",
  "moderated"
]);

const own = (map: Record<string, string>, key: unknown) => (typeof key === "string" && Object.hasOwn(map, key) ? map[key] : undefined);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown) => (typeof value === "string" && value.trim().length > 0 ? value : null);

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** One line (no line breaks or runs of spaces), at most `max` characters. */
export const clip = (value: string, max = 300) => {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

const quoted = (value: string, max?: number) => `“${clip(value, max)}”`;

const dayPattern = /^(\d{4})-(\d{2})-(\d{2})$/;

const day = (value: unknown) => {
  const match = typeof value === "string" ? dayPattern.exec(value) : null;
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "—";
};

const sizeLabel = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const onOff = (value: unknown) => (value === true ? "Bật" : value === false ? "Tắt" : "—");

const arrow = (before: string, after: string) => `${before} → ${after}`;

const changed = (before: Record<string, unknown>, after: Record<string, unknown>, key: string) =>
  key in after && JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null);

const tagsLabel = (value: unknown) => {
  const tags = Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string" && tag.length > 0) : [];
  return tags.length > 0 ? clip(tags.join(", "), 200) : "—";
};

/** "Người" of a payload: its snapshot name, else the person resolved by id. */
const person = (payload: Record<string, unknown>, nameKey: string, idKey: string, resolvers: AuditDetailResolvers) => {
  const name = text(payload[nameKey]);
  if (name) {
    return clip(name, 80);
  }
  const id = text(payload[idKey]);
  return id ? (resolvers.user?.(id) ?? "(người dùng)") : "—";
};

const categoryLabel = (name: unknown, id: unknown, resolvers: AuditDetailResolvers) => {
  const known = text(name);
  if (known) {
    return quoted(known, 80);
  }
  const categoryId = text(id);
  if (!categoryId) {
    return "Chưa phân loại";
  }
  const resolved = resolvers.category?.(categoryId);
  return resolved ? quoted(resolved, 80) : "(chuyên mục đã xoá)";
};

const genericValue = (key: string, value: unknown): string => {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  if (typeof value === "boolean") {
    if (key === "pinned") {
      return value ? "Đã ghim" : "Bỏ ghim";
    }
    if (key === "resolved") {
      return value ? "Đã xử lý" : "Mở lại";
    }
    return key === "approvalRequired" ? onOff(value) : value ? "Có" : "Không";
  }
  if (typeof value === "number") {
    if (key === "sizeBytes") {
      return sizeLabel(value);
    }
    return key === "version" || key === "restoredFrom" ? `phiên bản ${value}` : String(value);
  }
  if (typeof value === "string") {
    const label =
      key === "importance"
        ? own(importanceLabels, value)
        : key === "accessLevel"
          ? own(accessLabels, value)
          : key === "visibility"
            ? own(visibilityLabels, value)
            : key === "group"
              ? own(groupLabels, value)
              : undefined;
    if (label) {
      return label;
    }
    if (dayPattern.test(value)) {
      return day(value);
    }
    if (key === "deletedAt" || key === "archivedAt") {
      return "Có";
    }
    return clip(value, 200);
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? "—" : clip(value.map((entry) => genericValue(key, entry)).join(", "), 200);
  }
  if (isRecord(value)) {
    const label = text(value.name) ?? text(value.displayName) ?? text(value.title) ?? text(value.fileName);
    return label ? clip(label, 120) : "(chi tiết)";
  }
  return "—";
};

/** Every visible field: "Nhãn: trước → sau" (changed), "Nhãn: giá trị" (only on one side). */
const genericDetail = (before: Record<string, unknown>, after: Record<string, unknown>, hasBefore: boolean, hasAfter: boolean) => {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => !hiddenKeys.has(key));
  const parts: string[] = [];
  for (const key of keys) {
    const label = own(fieldLabels, key) ?? key;
    const inBefore = hasBefore && key in before;
    const inAfter = hasAfter && key in after;
    if (inBefore && inAfter) {
      if (JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)) {
        parts.push(`${label}: ${arrow(genericValue(key, before[key]), genericValue(key, after[key]))}`);
      }
    } else {
      parts.push(`${label}: ${genericValue(key, inAfter ? after[key] : before[key])}`);
    }
  }
  return parts.join("; ");
};

type StatusEntry = { id: string | null; name: string; group: string | null };

const statusList = (value: unknown): StatusEntry[] =>
  Array.isArray(value)
    ? value.filter(isRecord).map((entry) => ({ id: text(entry.id), name: text(entry.name) ?? "?", group: text(entry.group) }))
    : [];

/** "Sửa bộ trạng thái": added, renamed, regrouped, removed (with where their items went), reordered. */
const statusesDetail = (before: Record<string, unknown>, after: Record<string, unknown>) => {
  const old = statusList(before.statuses);
  const next = statusList(after.statuses);
  const oldById = new Map(old.filter((entry) => entry.id).map((entry) => [entry.id, entry]));
  const nextById = new Map(next.filter((entry) => entry.id).map((entry) => [entry.id, entry]));
  const name = (id: unknown) => {
    const key = text(id);
    const entry = key ? (nextById.get(key) ?? oldById.get(key)) : undefined;
    return entry ? quoted(entry.name, 60) : "trạng thái khác";
  };
  const moved = new Map<string, { to: unknown; items: number | null }>();
  if (Array.isArray(after.reassigned)) {
    for (const entry of after.reassigned.filter(isRecord)) {
      const from = text(entry.from);
      if (from) {
        moved.set(from, { to: entry.to, items: num(entry.items) });
      }
    }
  }
  const parts: string[] = [];
  for (const status of next) {
    const previous = status.id ? oldById.get(status.id) : undefined;
    if (!previous) {
      parts.push(`thêm ${quoted(status.name, 60)} (${own(groupLabels, status.group) ?? "?"})`);
      continue;
    }
    if (previous.name !== status.name) {
      parts.push(`đổi tên ${quoted(previous.name, 60)} → ${quoted(status.name, 60)}`);
    }
    if (previous.group !== status.group) {
      parts.push(`${quoted(status.name, 60)}: ${arrow(own(groupLabels, previous.group) ?? "?", own(groupLabels, status.group) ?? "?")}`);
    }
  }
  for (const status of old) {
    if (status.id && nextById.has(status.id)) {
      continue;
    }
    const move = status.id ? moved.get(status.id) : undefined;
    parts.push(
      `xoá ${quoted(status.name, 60)}${move ? ` (${move.items !== null ? `${move.items} mục` : "các mục"} chuyển sang ${name(move.to)})` : ""}`
    );
  }
  const keptOrder = (list: StatusEntry[], other: Map<string | null, StatusEntry>) => list.filter((entry) => entry.id && other.has(entry.id)).map((entry) => entry.id);
  if (parts.length === 0 && JSON.stringify(keptOrder(old, nextById)) !== JSON.stringify(keptOrder(next, oldById))) {
    parts.push("đổi thứ tự");
  }
  if (parts.length === 0) {
    return next.length > 0 ? `Bộ trạng thái: ${clip(next.map((entry) => entry.name).join(", "), 200)}` : "";
  }
  return `Bộ trạng thái: ${parts.join("; ")}`;
};

const spaceUpdateDetail = (before: Record<string, unknown>, after: Record<string, unknown>) => {
  // Deletions logged before SPACE_DELETED existed were written as SPACE_UPDATED {deletedAt}.
  if ("deletedAt" in after && after.deletedAt) {
    return "Xoá kho (ẩn vĩnh viễn, nhật ký được giữ)";
  }
  const parts: string[] = [];
  if (changed(before, after, "name")) {
    parts.push(`Tên: ${arrow(text(before.name) ? quoted(String(before.name), 120) : "—", text(after.name) ? quoted(String(after.name), 120) : "—")}`);
  }
  if (changed(before, after, "description")) {
    parts.push(text(after.description) ? `Mô tả: ${quoted(String(after.description), 200)}` : "Mô tả: xoá mô tả");
  }
  if (changed(before, after, "visibility")) {
    parts.push(`Chế độ: ${arrow(own(visibilityLabels, before.visibility) ?? "—", own(visibilityLabels, after.visibility) ?? "—")}`);
  }
  if (changed(before, after, "approvalRequired")) {
    parts.push(`Bước duyệt: ${arrow(onOff(before.approvalRequired), onOff(after.approvalRequired))}`);
  }
  if (changed(before, after, "color")) {
    parts.push("Đổi màu");
  }
  if (changed(before, after, "icon")) {
    parts.push("Đổi biểu tượng");
  }
  if (changed(before, after, "rank")) {
    parts.push("Đổi thứ tự trên thanh bên");
  }
  return parts.join("; ");
};

const itemFieldsDetail = (before: Record<string, unknown>, after: Record<string, unknown>, resolvers: AuditDetailResolvers) => {
  const parts: string[] = [];
  if (changed(before, after, "ownerId") || changed(before, after, "ownerName")) {
    parts.push(`Người phụ trách: ${arrow(person(before, "ownerName", "ownerId", resolvers), person(after, "ownerName", "ownerId", resolvers))}`);
  }
  if (changed(before, after, "tags")) {
    parts.push(`Tag: ${arrow(tagsLabel(before.tags), tagsLabel(after.tags))}`);
  }
  if (changed(before, after, "effectiveFrom")) {
    parts.push(`Ngày hiệu lực: ${arrow(day(before.effectiveFrom), day(after.effectiveFrom))}`);
  }
  if (changed(before, after, "reviewBy")) {
    parts.push(`Hạn rà soát: ${arrow(day(before.reviewBy), day(after.reviewBy))}`);
  }
  if (changed(before, after, "pinned")) {
    parts.push(after.pinned === true ? "Ghim mục" : "Bỏ ghim mục");
  }
  return parts.join("; ");
};

const statusName = (payload: Record<string, unknown>) => {
  const name = text(payload.statusName);
  if (name) {
    return clip(name, 60);
  }
  return own(groupLabels, payload.group) ?? "—";
};

const specificDetail = (
  action: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  resolvers: AuditDetailResolvers
): string => {
  switch (action) {
    case "SPACE_CREATED":
      return [
        text(after.name) ? `Kho ${quoted(String(after.name), 120)}` : "",
        own(visibilityLabels, after.visibility) ? `Chế độ: ${own(visibilityLabels, after.visibility)}` : "",
        "approvalRequired" in after ? `Bước duyệt: ${onOff(after.approvalRequired)}` : ""
      ]
        .filter(Boolean)
        .join(" · ");
    case "SPACE_UPDATED":
      return spaceUpdateDetail(before, after);
    case "SPACE_ARCHIVED":
      return "Kho chuyển sang lưu trữ: chỉ thành viên xem được, không ai sửa";
    case "SPACE_RESTORED":
      return "Kho được mở lại để dùng như trước";
    case "SPACE_DELETED": {
      const count = num(before.itemCount);
      const name = text(before.name);
      return `Xoá kho${name ? ` ${quoted(name, 120)}` : ""}${count !== null ? ` (${count} mục)` : ""}: ẩn vĩnh viễn với mọi người, nhật ký được giữ`;
    }
    case "MEMBER_ADDED":
      return `Thành viên: ${person(after, "userName", "userId", resolvers)} — thêm với mức ${own(accessLabels, after.accessLevel) ?? "—"}`;
    case "MEMBER_UPDATED":
      return `Thành viên: ${person(after.userName ? after : before, "userName", "userId", resolvers)} — ${arrow(
        own(accessLabels, before.accessLevel) ?? "—",
        own(accessLabels, after.accessLevel) ?? "—"
      )}`;
    case "MEMBER_REMOVED":
      return `Thành viên: ${person(before, "userName", "userId", resolvers)} — gỡ khỏi kho${
        own(accessLabels, before.accessLevel) ? ` (đang là ${own(accessLabels, before.accessLevel)})` : ""
      }`;
    case "STATUSES_REPLACED":
      return statusesDetail(before, after);
    case "CATEGORY_CREATED": {
      const parent = text(after.parentId);
      return `Chuyên mục: ${text(after.name) ? quoted(String(after.name), 120) : "—"}${parent ? ` (trong ${categoryLabel(null, parent, resolvers)})` : ""}`;
    }
    case "CATEGORY_UPDATED": {
      const current = text(before.name) ?? text(after.name);
      const subject = current ? quoted(current, 120) : categoryLabel(null, before.categoryId ?? after.categoryId, resolvers);
      const parts: string[] = [];
      if (changed(before, after, "name")) {
        parts.push(`Tên: ${arrow(text(before.name) ? quoted(String(before.name), 120) : "—", text(after.name) ? quoted(String(after.name), 120) : "—")}`);
      }
      if (changed(before, after, "parentId")) {
        const parentName = (id: unknown) => (text(id) ? categoryLabel(null, id, resolvers) : "cấp đầu");
        parts.push(`Chuyên mục cha: ${arrow(parentName(before.parentId), parentName(after.parentId))}`);
      }
      if (changed(before, after, "rank")) {
        parts.push("Đổi thứ tự");
      }
      return `Chuyên mục ${subject}${parts.length > 0 ? `: ${parts.join("; ")}` : ""}`;
    }
    case "CATEGORY_DELETED": {
      const movedItems = num(after.movedItems) ?? 0;
      const subcategories = Array.isArray(after.subcategoriesMovedToTop) ? after.subcategoriesMovedToTop.length : 0;
      return [
        `Xoá chuyên mục ${text(before.name) ? quoted(String(before.name), 120) : "—"}`,
        movedItems > 0 ? `${movedItems} mục chuyển sang ${text(after.itemsMovedTo) ? categoryLabel(null, after.itemsMovedTo, resolvers) : "Chưa phân loại"}` : "",
        subcategories > 0 ? `${subcategories} chuyên mục con lên cấp đầu` : ""
      ]
        .filter(Boolean)
        .join("; ");
    }
    case "ITEM_CREATED":
      return [
        "Phiên bản 1",
        `Trạng thái: ${statusName(after)}`,
        own(importanceLabels, after.importance) ? `Mức quan trọng: ${own(importanceLabels, after.importance)}` : "",
        text(after.categoryName) ? `Chuyên mục: ${quoted(String(after.categoryName), 80)}` : "",
        tagsLabel(after.tags) !== "—" ? `Tag: ${tagsLabel(after.tags)}` : ""
      ]
        .filter(Boolean)
        .join(" · ");
    case "ITEM_CONTENT_UPDATED": {
      const parts = Array.isArray(after.changed)
        ? after.changed.map((part) => own(contentParts, part)).filter((part): part is string => Boolean(part))
        : [];
      const version = num(after.version);
      return [
        `Sửa nội dung${parts.length > 0 ? ` (${parts.join(", ")})` : ""}${version !== null ? ` → phiên bản ${version}` : ""}`,
        changed(before, after, "title") && text(after.title)
          ? `Tiêu đề: ${arrow(text(before.title) ? quoted(String(before.title), 120) : "—", quoted(String(after.title), 120))}`
          : "",
        text(after.note) ? `Ghi chú: ${quoted(String(after.note), 200)}` : ""
      ]
        .filter(Boolean)
        .join("; ");
    }
    case "ITEM_FIELDS_UPDATED":
      return itemFieldsDetail(before, after, resolvers);
    case "ITEM_STATUS_CHANGED":
      return `Trạng thái: ${arrow(statusName(before), statusName(after))}`;
    case "ITEM_IMPORTANCE_CHANGED":
      return `Mức quan trọng: ${arrow(own(importanceLabels, before.importance) ?? "—", own(importanceLabels, after.importance) ?? "—")}`;
    case "ITEM_MOVED":
      return `Chuyên mục: ${arrow(categoryLabel(before.categoryName, before.categoryId, resolvers), categoryLabel(after.categoryName, after.categoryId, resolvers))}`;
    case "ITEM_DELETED": {
      const facts = [
        text(before.statusName) ? `trạng thái ${clip(String(before.statusName), 60)}` : "",
        own(importanceLabels, before.importance) ? `mức ${own(importanceLabels, before.importance)}` : ""
      ].filter(Boolean);
      return `Chuyển vào thùng rác (giữ 30 ngày)${facts.length > 0 ? `; lúc xoá: ${facts.join(", ")}` : ""}`;
    }
    case "ITEM_RESTORED":
      return "Khôi phục từ thùng rác về chuyên mục cũ";
    case "ITEM_PURGED": {
      const facts = [
        num(before.version) !== null ? `phiên bản ${num(before.version)}` : "",
        text(before.statusName) ? clip(String(before.statusName), 60) : "",
        own(importanceLabels, before.importance) ?? ""
      ].filter(Boolean);
      return `Xoá vĩnh viễn${text(before.title) ? ` ${quoted(String(before.title), 120)}` : ""}${facts.length > 0 ? ` (${facts.join(", ")})` : ""}`;
    }
    case "VERSION_RESTORED": {
      const from = num(after.restoredFrom);
      const version = num(after.version);
      return `Khôi phục nội dung${from !== null ? ` phiên bản ${from}` : ""}${version !== null ? ` → phiên bản ${version}` : ""}`;
    }
    case "ATTACHMENT_ADDED":
    case "ATTACHMENT_REMOVED": {
      const file = action === "ATTACHMENT_ADDED" ? after : before;
      const size = num(file.sizeBytes);
      const kept = action === "ATTACHMENT_REMOVED" && after.keptForVersions === true;
      return `Tệp: ${text(file.fileName) ? quoted(String(file.fileName), 120) : "—"}${size !== null ? ` (${sizeLabel(size)})` : ""}${
        kept ? " — ảnh vẫn được giữ cho các phiên bản cũ" : ""
      }`;
    }
    case "COMMENT_DELETED": {
      const replies = num(before.replies) ?? 0;
      return [
        `Bình luận của ${person(before, "authorName", "authorId", resolvers)} đã xoá${text(before.text) ? `: ${quoted(String(before.text))}` : ""}`,
        replies > 0 ? `kèm ${replies} trả lời` : "",
        before.moderated === true ? "Quản lý kho xoá" : ""
      ]
        .filter(Boolean)
        .join("; ");
    }
    case "COMMENT_RESOLVED":
      return `Góp ý: ${after.resolved === true ? "Đã xử lý" : after.resolved === false ? "Mở lại" : "—"}`;
    case "COMMENT_EDITED":
      return `Bình luận đã sửa: ${text(after.text) ? quoted(String(after.text)) : "—"}${text(before.text) ? ` (trước: ${quoted(String(before.text))})` : ""}`;
    default:
      return "";
  }
};

/**
 * "Chi tiết" of one audit entry in Vietnamese. Falls back to a generic "Nhãn: trước → sau" list for actions or
 * payload shapes without a dedicated wording; never throws.
 */
export const describeAuditEntry = (entry: AuditDetailInput, resolvers: AuditDetailResolvers = {}): string => {
  const before = isRecord(entry.before) ? entry.before : {};
  const after = isRecord(entry.after) ? entry.after : {};
  try {
    const specific = specificDetail(entry.action, before, after, resolvers);
    if (specific) {
      return specific;
    }
  } catch {
    // Unexpected payload shape: the generic rendering below still says what changed.
  }
  return genericDetail(before, after, isRecord(entry.before), isRecord(entry.after));
};

const rawJsonLimit = 32_000;

/** The raw payloads, for completeness (last column of the export): `{"before":…,"after":…}`, capped to fit a cell. */
export const rawAuditJson = (entry: { before: Payload; after: Payload }) => {
  if (!entry.before && !entry.after) {
    return null;
  }
  const json = JSON.stringify({ before: entry.before ?? null, after: entry.after ?? null });
  return json.length > rawJsonLimit ? `${json.slice(0, rawJsonLimit - 1)}…` : json;
};
