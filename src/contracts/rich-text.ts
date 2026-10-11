import { z } from "zod";

/**
 * Rich text is stored as an allow-listed Tiptap/ProseMirror JSON document — never as HTML.
 * The server re-sanitizes every document: unknown nodes/marks/attributes are dropped, links are
 * restricted to safe protocols, and plain text + mentions are derived server-side.
 * Shared verbatim between FE and BE.
 */

/** Attribute values; `number[]` only for table cell `colwidth` (knowledge profile). */
export type RichTextAttrValue = string | number | boolean | null | number[];

export type RichTextNode = {
  type: string;
  attrs?: Record<string, RichTextAttrValue>;
  content?: RichTextNode[];
  marks?: { type: string; attrs?: Record<string, string | null> }[];
  text?: string;
};

export type RichTextDoc = { type: "doc"; content?: RichTextNode[] };

export const RichTextDocSchema = z
  .object({ type: z.literal("doc"), content: z.array(z.unknown()).optional() })
  .passthrough();

const blockTypes = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "blockquote",
  "codeBlock",
  "horizontalRule"
]);
const inlineTypes = new Set(["text", "hardBreak", "mention"]);
const listItemType: Record<string, "listItem" | "taskItem" | undefined> = {
  bulletList: "listItem",
  orderedList: "listItem",
  taskList: "taskItem"
};
const markTypes = new Set(["bold", "italic", "strike", "underline", "code", "link"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex -- control characters are rejected in links
const safeHref = /^(https?:\/\/|mailto:)[^\s<>"'\u0000-\u001f\u007f]{1,2000}$/i;
/**
 * Dropped from text: control characters other than tab / line breaks (NUL is not storable in PostgreSQL
 * text/jsonb) and bidi overrides / isolates U+202A–U+202E, U+2066–U+2069 (SEC2-12: they make a message read
 * differently from what it is). Same ranges as names, mention labels and file names.
 */
// eslint-disable-next-line no-control-regex -- stripping control characters is intended
const strayControlCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g;
// eslint-disable-next-line no-control-regex -- stripping control characters is intended
const labelControlCharacters = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g;

export type SanitizeLimits = { maxTextLength: number; maxNodes: number; maxDepth: number; maxMentions: number };

export const commentLimits: SanitizeLimits = { maxTextLength: 20_000, maxNodes: 4_000, maxDepth: 10, maxMentions: 50 };
export const descriptionLimits: SanitizeLimits = { maxTextLength: 100_000, maxNodes: 20_000, maxDepth: 12, maxMentions: 50 };
export const messageLimits: SanitizeLimits = { maxTextLength: 10_000, maxNodes: 2_000, maxDepth: 8, maxMentions: 50 };

/**
 * Knowledge item bodies (PD-031 addendum, 2026-10-11): long articles with tables. The plain text (table cells, image
 * placeholders and mention labels included) is limited to 200 000 characters (database CHECK on body_text); the
 * request body of the knowledge item endpoints may be up to 4 MB.
 */
export const knowledgeBodyLimits: SanitizeLimits = { maxTextLength: 200_000, maxNodes: 60_000, maxDepth: 16, maxMentions: 50 };

/**
 * Tables and images of the "knowledge" profile (knowledge item bodies only; task descriptions, comments and chat use
 * the shared schema). Node spec — what the server stores:
 *
 *   table        content: tableRow+ (no attrs). ≤ maxTables per document, ≤ maxRows rows, ≤ maxColumns columns
 *                (column map with colspan / rowspan, like prosemirror-tables). Not allowed inside a table cell.
 *   tableRow     content: (tableHeader | tableCell)+ (no attrs).
 *   tableHeader / tableCell
 *                attrs: { colspan: int 1–maxSpan, rowspan: int 1–maxSpan (clamped to the rows left),
 *                         colwidth: int[] (length = colspan; 1–maxColumnWidth px, 0 = no fixed width) | null }
 *                content: (paragraph | heading | bulletList | orderedList | blockquote)+ — an empty cell gets an
 *                empty paragraph; inside a cell a codeBlock becomes a paragraph, a taskList a bulletList, and tables,
 *                images and horizontal rules are dropped.
 *   image        block leaf. attrs: { attachmentId: uuid (required, lower case), alt: string ≤ imageAltLength | null,
 *                width: int imageMinWidth–imageMaxWidth | null }. Never a `src` or any other attribute (no URL is ever
 *                stored: the client asks POST /knowledge/attachments/urls). Allowed wherever a block is (document,
 *                blockquote, list items) except table cells; ≤ maxImages distinct attachments per document.
 *
 * Plain text: each table row is one line "cell | cell | cell" (cell blocks joined by spaces), an image reads
 * "[Ảnh: alt]" (or "[Ảnh]"). @mentions inside cells work as anywhere else.
 */
export const knowledgeBodySpec = {
  maxTables: 20,
  maxRows: 60,
  maxColumns: 12,
  maxSpan: 12,
  maxColumnWidth: 2000,
  maxImages: 100,
  imageAltLength: 200,
  imageMinWidth: 40,
  imageMaxWidth: 2000
} as const;

/** "default" = the shared schema; "knowledge" = also tables and images (knowledgeBodySpec). */
export type RichTextProfile = "default" | "knowledge";

export class RichTextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RichTextError";
  }
}

export type SanitizeResult = {
  doc: RichTextDoc;
  text: string;
  mentions: string[];
  /** "knowledge" profile only: attachment ids of the images, unique, in document order. */
  images?: string[];
};

export type SanitizeOptions = {
  /**
   * Server-side mention labels (user id → current display name). When given, every mention label comes
   * from here (clients cannot spoof "@CEO"), and mentions of ids missing from the map become plain text.
   */
  mentionLabels?: ReadonlyMap<string, string>;
  /** "knowledge" also keeps tables and images (knowledge item bodies only). Default: the shared schema. */
  profile?: RichTextProfile;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Blocks a table cell may hold (knowledge profile). */
const cellBlockTypes = new Set(["paragraph", "heading", "bulletList", "orderedList", "listItem", "blockquote"]);

const clampInt = (value: unknown, min: number, max: number): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : null;

/** Cell column widths: one entry per spanned column, 0 = no fixed width; null when nothing is set. */
const sanitizeColwidth = (raw: unknown, colspan: number): number[] | null => {
  if (!Array.isArray(raw)) {
    return null;
  }
  const entries: unknown[] = raw;
  const widths: number[] = [];
  for (let index = 0; index < colspan; index += 1) {
    const value = entries[index];
    widths.push(typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.min(knowledgeBodySpec.maxColumnWidth, Math.round(value)) : 0);
  }
  return widths.some((width) => width > 0) ? widths : null;
};

export const sanitizeRichText = (input: unknown, limits: SanitizeLimits, options: SanitizeOptions = {}): SanitizeResult => {
  if (!isRecord(input) || input.type !== "doc") {
    throw new RichTextError("Document must be a rich text doc.");
  }

  const knowledge = options.profile === "knowledge";
  let nodeCount = 0;
  let textLength = 0;
  let tableCount = 0;
  const mentions = new Set<string>();
  const images = new Set<string>();
  const textParts: string[] = [];

  const enter = (depth: number) => {
    nodeCount += 1;
    if (nodeCount > limits.maxNodes) {
      throw new RichTextError("Document is too large.");
    }
    if (depth > limits.maxDepth) {
      throw new RichTextError("Document is nested too deeply.");
    }
  };

  const sanitizeMarks = (raw: unknown): RichTextNode["marks"] => {
    if (!Array.isArray(raw)) {
      return undefined;
    }
    const marks: NonNullable<RichTextNode["marks"]> = [];
    for (const mark of raw.slice(0, 8)) {
      if (!isRecord(mark) || typeof mark.type !== "string" || !markTypes.has(mark.type)) {
        continue;
      }
      if (mark.type === "link") {
        const href = isRecord(mark.attrs) && typeof mark.attrs.href === "string" ? mark.attrs.href.trim() : "";
        if (!safeHref.test(href)) {
          continue;
        }
        marks.push({ type: "link", attrs: { href } });
        continue;
      }
      marks.push({ type: mark.type });
    }
    return marks.length > 0 ? marks : undefined;
  };

  /** Image block (knowledge profile): the attachment id, an optional alt text and display width — nothing else. */
  const visitImage = (raw: Record<string, unknown>): RichTextNode | null => {
    const attrs = isRecord(raw.attrs) ? raw.attrs : {};
    const id = typeof attrs.attachmentId === "string" ? attrs.attachmentId : "";
    if (!uuidPattern.test(id)) {
      return null;
    }
    const attachmentId = id.toLowerCase();
    images.add(attachmentId);
    if (images.size > knowledgeBodySpec.maxImages) {
      throw new RichTextError(`Nội dung có tối đa ${knowledgeBodySpec.maxImages} ảnh.`);
    }
    const alt =
      typeof attrs.alt === "string"
        ? attrs.alt.replace(labelControlCharacters, " ").replace(/\s+/g, " ").trim().slice(0, knowledgeBodySpec.imageAltLength).trim()
        : "";
    const width = clampInt(attrs.width, knowledgeBodySpec.imageMinWidth, knowledgeBodySpec.imageMaxWidth);
    const placeholder = alt.length > 0 ? `[Ảnh: ${alt}]` : "[Ảnh]";
    textLength += placeholder.length;
    textParts.push(placeholder, "\n");
    return { type: "image", attrs: { attachmentId, alt: alt.length > 0 ? alt : null, width } };
  };

  /** Table cell: block content (cellBlockTypes); its text becomes one entry of the row line. */
  const visitCell = (raw: Record<string, unknown>, type: string, depth: number): RichTextNode => {
    enter(depth);
    const attrs = isRecord(raw.attrs) ? raw.attrs : {};
    const colspan = clampInt(attrs.colspan, 1, knowledgeBodySpec.maxSpan) ?? 1;
    const rowspan = clampInt(attrs.rowspan, 1, knowledgeBodySpec.maxSpan) ?? 1;
    const start = textParts.length;
    const content = sanitizeChildren(raw.content, type, depth + 1, true);
    const cellText = textParts
      .splice(start)
      .join("")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join(" ");
    textParts.push(cellText);
    return {
      type,
      attrs: { colspan, rowspan, colwidth: sanitizeColwidth(attrs.colwidth, colspan) },
      content: content.length > 0 ? content : [{ type: "paragraph" }]
    };
  };

  const visitRow = (raw: Record<string, unknown>, depth: number): RichTextNode | null => {
    enter(depth);
    const start = textParts.length;
    const cells: RichTextNode[] = [];
    for (const child of Array.isArray(raw.content) ? raw.content : []) {
      if (isRecord(child) && (child.type === "tableCell" || child.type === "tableHeader")) {
        cells.push(visitCell(child, child.type, depth + 1));
      }
    }
    const cellTexts = textParts.splice(start);
    if (cells.length === 0) {
      return null;
    }
    textParts.push(`${cellTexts.join(" | ")}\n`);
    return { type: "tableRow", content: cells };
  };

  /** Table (knowledge profile): rows of cells; the column map (colspan / rowspan) is at most maxColumns wide. */
  const visitTable = (raw: Record<string, unknown>, depth: number): RichTextNode | null => {
    tableCount += 1;
    if (tableCount > knowledgeBodySpec.maxTables) {
      throw new RichTextError(`Nội dung có tối đa ${knowledgeBodySpec.maxTables} bảng.`);
    }
    const rows: RichTextNode[] = [];
    for (const child of Array.isArray(raw.content) ? raw.content : []) {
      if (!isRecord(child) || child.type !== "tableRow") {
        continue;
      }
      const row = visitRow(child, depth + 1);
      if (!row) {
        continue;
      }
      if (rows.length >= knowledgeBodySpec.maxRows) {
        throw new RichTextError(`Mỗi bảng có tối đa ${knowledgeBodySpec.maxRows} hàng.`);
      }
      rows.push(row);
    }
    if (rows.length === 0) {
      return null;
    }
    // Column map like prosemirror-tables: cells fill the first free column; row spans reserve columns below.
    const occupied: boolean[][] = rows.map(() => []);
    rows.forEach((row, rowIndex) => {
      let column = 0;
      for (const cell of row.content ?? []) {
        const attrs = cell.attrs!;
        while (occupied[rowIndex]![column]) {
          column += 1;
        }
        const colspan = attrs.colspan as number;
        const rowspan = Math.min(attrs.rowspan as number, rows.length - rowIndex);
        attrs.rowspan = rowspan;
        if (column + colspan > knowledgeBodySpec.maxColumns) {
          throw new RichTextError(`Mỗi bảng có tối đa ${knowledgeBodySpec.maxColumns} cột.`);
        }
        for (let r = rowIndex; r < rowIndex + rowspan; r += 1) {
          for (let c = column; c < column + colspan; c += 1) {
            occupied[r]![c] = true;
          }
        }
        column += colspan;
      }
    });
    textParts.push("\n");
    return { type: "table", content: rows };
  };

  const visit = (raw: unknown, depth: number, inline: boolean, inCell = false): RichTextNode | null => {
    if (!isRecord(raw) || typeof raw.type !== "string") {
      return null;
    }
    enter(depth);

    let type = raw.type;

    if (type === "text") {
      const text = typeof raw.text === "string" ? raw.text.replace(strayControlCharacters, "") : "";
      if (text.length === 0) {
        return null;
      }
      textLength += text.length;
      if (textLength > limits.maxTextLength) {
        throw new RichTextError("Text is too long.");
      }
      textParts.push(text);
      const marks = sanitizeMarks(raw.marks);
      return marks ? { type, text, marks } : { type, text };
    }

    if (type === "hardBreak") {
      textParts.push("\n");
      return { type };
    }

    if (type === "mention") {
      const attrs = isRecord(raw.attrs) ? raw.attrs : {};
      const id = typeof attrs.id === "string" ? attrs.id : "";
      if (!uuidPattern.test(id)) {
        return null;
      }
      const userId = id.toLowerCase();
      const clientLabel = typeof attrs.label === "string" ? attrs.label.replace(labelControlCharacters, "").slice(0, 160) : "";
      if (options.mentionLabels && !options.mentionLabels.has(userId)) {
        // Not a person of this organization: keep what the user typed, as plain text.
        const text = `@${clientLabel}`;
        textLength += text.length;
        textParts.push(text);
        return { type: "text", text };
      }
      const label = options.mentionLabels?.get(userId)?.replace(labelControlCharacters, "").slice(0, 160) ?? clientLabel;
      mentions.add(userId);
      if (mentions.size > limits.maxMentions) {
        throw new RichTextError("Too many mentions.");
      }
      textLength += label.length + 1;
      textParts.push(`@${label}`);
      return { type, attrs: { id: userId, label } };
    }

    if (knowledge && !inline) {
      if (type === "image") {
        return inCell ? null : visitImage(raw);
      }
      if (type === "table") {
        return inCell ? null : visitTable(raw, depth);
      }
      if (inCell) {
        // Cells hold simple blocks: code becomes a paragraph, a checklist a bullet list; the rest is dropped.
        type = type === "codeBlock" ? "paragraph" : type === "taskList" ? "bulletList" : type === "taskItem" ? "listItem" : type;
        if (!cellBlockTypes.has(type)) {
          return null;
        }
      }
    }

    if (inline || !blockTypes.has(type)) {
      return null;
    }

    const attrs: RichTextNode["attrs"] = {};
    if (type === "heading") {
      const level = isRecord(raw.attrs) && typeof raw.attrs.level === "number" ? raw.attrs.level : 2;
      attrs.level = Math.min(3, Math.max(1, Math.trunc(level)));
    }
    if (type === "taskItem") {
      attrs.checked = isRecord(raw.attrs) && raw.attrs.checked === true;
    }
    if (type === "codeBlock") {
      const language = isRecord(raw.attrs) && typeof raw.attrs.language === "string" ? raw.attrs.language : null;
      attrs.language = language && /^[a-z0-9+#-]{1,30}$/i.test(language) ? language : null;
    }
    if (type === "orderedList") {
      const start = isRecord(raw.attrs) && typeof raw.attrs.start === "number" ? raw.attrs.start : 1;
      attrs.start = Math.min(100_000, Math.max(1, Math.trunc(start)));
    }

    const content = sanitizeChildren(raw.content, type, depth + 1, inCell);
    if (type !== "horizontalRule") {
      textParts.push("\n");
    }
    // An empty list is not a valid node; drop it.
    if (listItemType[type] && content.length === 0) {
      return null;
    }

    const node: RichTextNode = { type };
    if (Object.keys(attrs).length > 0) {
      node.attrs = attrs;
    }
    if (content.length > 0) {
      node.content = content;
    }
    return node;
  };

  /**
   * Enforces the editor schema's parent/child rules so a stored document can always be loaded:
   * textblocks hold inline nodes only, code blocks plain text only, lists only their item type,
   * items start with a paragraph, and stray inline nodes at block level are wrapped in paragraphs.
   */
  function sanitizeChildren(rawChildren: unknown, parentType: string, depth: number, inCell = false): RichTextNode[] {
    const children = Array.isArray(rawChildren) ? rawChildren : [];
    const out: RichTextNode[] = [];

    if (parentType === "paragraph" || parentType === "heading") {
      for (const child of children) {
        const node = visit(child, depth, true);
        if (node) {
          out.push(node);
        }
      }
      return out;
    }
    if (parentType === "codeBlock") {
      for (const child of children) {
        if (isRecord(child) && child.type === "text") {
          const node = visit(child, depth, true);
          if (node?.text) {
            out.push({ type: "text", text: node.text });
          }
        }
      }
      return out;
    }
    if (parentType === "horizontalRule") {
      return out;
    }

    const itemType = listItemType[parentType];
    const place = (node: RichTextNode) => {
      const isItem = node.type === "listItem" || node.type === "taskItem";
      if (itemType) {
        if (node.type === itemType) {
          out.push(node);
        } else {
          const inner = isItem ? (node.content ?? []) : [node];
          out.push({ type: itemType, ...(itemType === "taskItem" ? { attrs: { checked: false } } : {}), content: inner });
        }
        return;
      }
      if (isItem) {
        // Items outside their list are flattened into their parent.
        out.push(...(node.content ?? []));
        return;
      }
      out.push(node);
    };

    let pendingInline: RichTextNode[] = [];
    const flush = () => {
      if (pendingInline.length > 0) {
        place({ type: "paragraph", content: pendingInline });
        pendingInline = [];
      }
    };
    for (const child of children) {
      const childType = isRecord(child) && typeof child.type === "string" ? child.type : "";
      if (inlineTypes.has(childType)) {
        const node = visit(child, depth, true);
        if (node) {
          pendingInline.push(node);
        }
        continue;
      }
      flush();
      const node = visit(child, depth, false, inCell);
      if (node) {
        place(node);
      }
    }
    flush();

    if (parentType === "listItem" || parentType === "taskItem") {
      if (out[0]?.type !== "paragraph") {
        out.unshift({ type: "paragraph" });
      }
      // Items inside items are only valid within a nested list.
      return out.filter((node) => node.type !== "listItem" && node.type !== "taskItem");
    }
    if (parentType === "blockquote" && out.length === 0) {
      out.push({ type: "paragraph" });
    }
    if (itemType) {
      // List items must start with a paragraph.
      for (const item of out) {
        if (item.content?.[0]?.type !== "paragraph") {
          item.content = [{ type: "paragraph" }, ...(item.content ?? [])];
        }
      }
    }
    return out;
  }

  const content = sanitizeChildren(input.content, "doc", 1);

  const text = textParts
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // The stored plain text (mention labels and line breaks included) is what the database limits (WK-24).
  if (text.length > limits.maxTextLength) {
    throw new RichTextError("Nội dung quá dài.");
  }

  const result: SanitizeResult = { doc: { type: "doc", content }, text, mentions: [...mentions] };
  if (knowledge) {
    result.images = [...images];
  }
  return result;
};

/** Knowledge item body: the "knowledge" profile (tables, images) with knowledgeBodyLimits by default. */
export const sanitizeKnowledgeBody = (
  input: unknown,
  options: Omit<SanitizeOptions, "profile"> = {},
  limits: SanitizeLimits = knowledgeBodyLimits
): SanitizeResult & { images: string[] } => {
  const result = sanitizeRichText(input, limits, { ...options, profile: "knowledge" });
  return { ...result, images: result.images ?? [] };
};

/** Builds a minimal document from plain text (used by clients that only send text). */
export const richTextFromPlainText = (text: string): RichTextDoc => ({
  type: "doc",
  content: text
    .split(/\n{2,}/)
    .filter((paragraph) => paragraph.trim().length > 0)
    .map((paragraph) => ({
      type: "paragraph",
      content: paragraph.split("\n").flatMap((line, index): RichTextNode[] =>
        index === 0 ? [{ type: "text", text: line }] : [{ type: "hardBreak" }, { type: "text", text: line }]
      ).filter((node) => node.type !== "text" || (node.text ?? "").length > 0)
    }))
});
