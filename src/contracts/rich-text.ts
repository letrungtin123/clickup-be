import { z } from "zod";

/**
 * Rich text is stored as an allow-listed Tiptap/ProseMirror JSON document — never as HTML.
 * The server re-sanitizes every document: unknown nodes/marks/attributes are dropped, links are
 * restricted to safe protocols, and plain text + mentions are derived server-side.
 * Shared verbatim between FE and BE.
 */

export type RichTextNode = {
  type: string;
  attrs?: Record<string, string | number | boolean | null>;
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
const safeHref = /^(https?:\/\/|mailto:)[^\s<>"']{1,2000}$/i;

export type SanitizeLimits = { maxTextLength: number; maxNodes: number; maxDepth: number; maxMentions: number };

export const commentLimits: SanitizeLimits = { maxTextLength: 20_000, maxNodes: 4_000, maxDepth: 10, maxMentions: 50 };
export const descriptionLimits: SanitizeLimits = { maxTextLength: 100_000, maxNodes: 20_000, maxDepth: 12, maxMentions: 50 };
export const messageLimits: SanitizeLimits = { maxTextLength: 10_000, maxNodes: 2_000, maxDepth: 8, maxMentions: 50 };

export class RichTextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RichTextError";
  }
}

type SanitizeResult = { doc: RichTextDoc; text: string; mentions: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const sanitizeRichText = (input: unknown, limits: SanitizeLimits): SanitizeResult => {
  if (!isRecord(input) || input.type !== "doc") {
    throw new RichTextError("Document must be a rich text doc.");
  }

  let nodeCount = 0;
  let textLength = 0;
  const mentions = new Set<string>();
  const textParts: string[] = [];

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

  const visit = (raw: unknown, depth: number, inline: boolean): RichTextNode | null => {
    if (!isRecord(raw) || typeof raw.type !== "string") {
      return null;
    }
    nodeCount += 1;
    if (nodeCount > limits.maxNodes) {
      throw new RichTextError("Document is too large.");
    }
    if (depth > limits.maxDepth) {
      throw new RichTextError("Document is nested too deeply.");
    }

    const type = raw.type;

    if (type === "text") {
      const text = typeof raw.text === "string" ? raw.text : "";
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
      const label = typeof attrs.label === "string" ? attrs.label.slice(0, 160) : "";
      mentions.add(id.toLowerCase());
      if (mentions.size > limits.maxMentions) {
        throw new RichTextError("Too many mentions.");
      }
      textParts.push(`@${label}`);
      return { type, attrs: { id: id.toLowerCase(), label } };
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

    const content = sanitizeChildren(raw.content, type, depth + 1);
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
  function sanitizeChildren(rawChildren: unknown, parentType: string, depth: number): RichTextNode[] {
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
      const node = visit(child, depth, false);
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

  return { doc: { type: "doc", content }, text, mentions: [...mentions] };
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
