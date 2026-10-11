/**
 * Mini-markup (see types.ts) → the app's rich-text JSON (Tiptap/ProseMirror shape accepted by
 * src/contracts/rich-text.ts). Mentions resolve persona keys to user ids; labels are re-derived by the server.
 */
import type { RichTextDoc, RichTextNode } from "../../src/contracts/rich-text.js";

/** id null → plain text "@label" (person not mentionable here). */
export type MentionResolver = (key: string) => { id: string | null; label: string } | null;

const inlinePattern = /(@\{[a-z0-9]+\})|(\*\*[^*]+\*\*)|(`[^`]+`)|(\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;

export const parseInline = (text: string, resolve: MentionResolver): RichTextNode[] => {
  const nodes: RichTextNode[] = [];
  const pushText = (value: string, marks?: RichTextNode["marks"]) => {
    if (value.length === 0) {
      return;
    }
    nodes.push(marks ? { type: "text", text: value, marks } : { type: "text", text: value });
  };
  const lines = text.split("\n");
  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) {
      nodes.push({ type: "hardBreak" });
    }
    let last = 0;
    for (const match of line.matchAll(inlinePattern)) {
      const index = match.index ?? 0;
      pushText(line.slice(last, index));
      const token = match[0];
      if (match[1]) {
        const key = token.slice(2, -1);
        const person = resolve(key);
        if (person?.id) {
          nodes.push({ type: "mention", attrs: { id: person.id, label: person.label } });
        } else if (person) {
          pushText(`@${person.label}`);
        } else {
          pushText(`@${key}`);
        }
      } else if (match[2]) {
        pushText(token.slice(2, -2), [{ type: "bold" }]);
      } else if (match[3]) {
        pushText(token.slice(1, -1), [{ type: "code" }]);
      } else if (match[4]) {
        const label = token.slice(1, token.indexOf("]("));
        const href = token.slice(token.indexOf("](") + 2, -1);
        pushText(label, [{ type: "link", attrs: { href } }]);
      }
      last = index + token.length;
    }
    pushText(line.slice(last));
  });
  return nodes;
};

type Block =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "bullet"; items: string[] }
  | { kind: "ordered"; items: string[] }
  | { kind: "task"; items: { text: string; checked: boolean }[] }
  | { kind: "heading"; text: string }
  | { kind: "quote"; lines: string[] };

const parseBlocks = (source: string): Block[] => {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let current: Block | null = null;
  const flush = () => {
    if (current) {
      blocks.push(current);
      current = null;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim().length === 0) {
      flush();
      continue;
    }
    const bullet = /^\s*[-•]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const task = /^\s*\[( |x|X)\]\s+(.*)$/.exec(line);
    const heading = /^#{1,3}\s+(.*)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);
    if (task) {
      if (current?.kind !== "task") {
        flush();
        current = { kind: "task", items: [] };
      }
      (current as Extract<Block, { kind: "task" }>).items.push({ text: task[2] ?? "", checked: task[1] !== " " });
    } else if (bullet) {
      if (current?.kind !== "bullet") {
        flush();
        current = { kind: "bullet", items: [] };
      }
      (current as Extract<Block, { kind: "bullet" }>).items.push(bullet[1] ?? "");
    } else if (ordered) {
      if (current?.kind !== "ordered") {
        flush();
        current = { kind: "ordered", items: [] };
      }
      (current as Extract<Block, { kind: "ordered" }>).items.push(ordered[1] ?? "");
    } else if (heading) {
      flush();
      blocks.push({ kind: "heading", text: heading[1] ?? "" });
    } else if (quote) {
      if (current?.kind !== "quote") {
        flush();
        current = { kind: "quote", lines: [] };
      }
      (current as Extract<Block, { kind: "quote" }>).lines.push(quote[1] ?? "");
    } else {
      if (current?.kind !== "paragraph") {
        flush();
        current = { kind: "paragraph", lines: [] };
      }
      (current as Extract<Block, { kind: "paragraph" }>).lines.push(line);
    }
  }
  flush();
  return blocks;
};

const paragraph = (text: string, resolve: MentionResolver): RichTextNode => {
  const content = parseInline(text, resolve);
  return content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" };
};

/** Converts mini-markup into a rich-text document. */
export const toDoc = (source: string, resolve: MentionResolver): RichTextDoc => {
  const content: RichTextNode[] = [];
  for (const block of parseBlocks(source)) {
    switch (block.kind) {
      case "paragraph":
        content.push(paragraph(block.lines.join("\n"), resolve));
        break;
      case "heading":
        content.push({ type: "heading", attrs: { level: 3 }, content: parseInline(block.text, resolve) });
        break;
      case "quote":
        content.push({ type: "blockquote", content: [paragraph(block.lines.join("\n"), resolve)] });
        break;
      case "bullet":
      case "ordered":
        content.push({
          type: block.kind === "bullet" ? "bulletList" : "orderedList",
          content: block.items.map((item) => ({ type: "listItem", content: [paragraph(item, resolve)] }))
        });
        break;
      case "task":
        content.push({
          type: "taskList",
          content: block.items.map((item) => ({
            type: "taskItem",
            attrs: { checked: item.checked },
            content: [paragraph(item.text, resolve)]
          }))
        });
        break;
    }
  }
  return { type: "doc", content: content.length > 0 ? content : [{ type: "paragraph" }] };
};

/** Persona keys mentioned in a text (`@{key}`). */
export const mentionedKeys = (source: string | undefined) =>
  source ? [...source.matchAll(/@\{([a-z0-9]+)\}/g)].map((match) => match[1]!) : [];
