import { describe, expect, it } from "vitest";

import { commentLimits, RichTextError, sanitizeRichText } from "./rich-text.js";

const userId = "3f0c1d9e-8a4b-4c2d-9e1f-2a3b4c5d6e7f";

describe("sanitizeRichText", () => {
  it("wraps stray inline nodes at block level into paragraphs", () => {
    const { doc } = sanitizeRichText(
      { type: "doc", content: [{ type: "text", text: "loose" }, { type: "mention", attrs: { id: userId, label: "Minh" } }] },
      commentLimits
    );
    expect(doc.content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "loose" }, { type: "mention", attrs: { id: userId, label: "Minh" } }] }
    ]);
  });

  it("drops unsafe links, unknown marks, attributes and node types", () => {
    const { doc, text } = sanitizeRichText(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { onclick: "alert(1)" },
            content: [
              { type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }, { type: "textStyle", attrs: { style: "x" } }] },
              { type: "image", attrs: { src: "https://evil" } }
            ]
          },
          { type: "iframe", attrs: { src: "https://evil" } }
        ]
      },
      commentLimits
    );
    expect(doc.content).toEqual([{ type: "paragraph", content: [{ type: "text", text: "x" }] }]);
    expect(text).toBe("x");
  });

  it("keeps safe links", () => {
    const { doc } = sanitizeRichText(
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a", marks: [{ type: "link", attrs: { href: "https://example.com", target: "_self" } }] }] }] },
      commentLimits
    );
    expect(doc.content?.[0]?.content?.[0]?.marks).toEqual([{ type: "link", attrs: { href: "https://example.com" } }]);
  });

  it("forces list children to be items that start with a paragraph", () => {
    const { doc } = sanitizeRichText(
      {
        type: "doc",
        content: [
          { type: "bulletList", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }, { type: "listItem", content: [{ type: "bulletList", content: [] }] }] },
          { type: "bulletList", content: [] },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "orphan" }] }] }
        ]
      },
      commentLimits
    );
    expect(doc.content).toEqual([
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] },
          { type: "listItem", content: [{ type: "paragraph" }] }
        ]
      },
      { type: "paragraph", content: [{ type: "text", text: "orphan" }] }
    ]);
  });

  it("keeps only plain text inside code blocks", () => {
    const { doc } = sanitizeRichText(
      { type: "doc", content: [{ type: "codeBlock", attrs: { language: "ts\"><script>" }, content: [{ type: "text", text: "const a = 1", marks: [{ type: "bold" }] }, { type: "hardBreak" }] }] },
      commentLimits
    );
    expect(doc.content).toEqual([{ type: "codeBlock", attrs: { language: null }, content: [{ type: "text", text: "const a = 1" }] }]);
  });

  it("collects mentions and rejects invalid ids", () => {
    const { mentions } = sanitizeRichText(
      {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "mention", attrs: { id: userId.toUpperCase(), label: "M" } }, { type: "mention", attrs: { id: "not-a-uuid" } }] }]
      },
      commentLimits
    );
    expect(mentions).toEqual([userId]);
  });

  it("enforces size limits", () => {
    expect(() =>
      sanitizeRichText({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(20_001) }] }] }, commentLimits)
    ).toThrow(RichTextError);
    expect(() => sanitizeRichText({ type: "nope" }, commentLimits)).toThrow(RichTextError);
  });
});

describe("sanitizeRichText hardening", () => {
  const otherId = "4a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  const paragraph = (...content: unknown[]) => ({ type: "doc", content: [{ type: "paragraph", content }] });

  it("drops control characters (NUL is not storable) but keeps tabs and line breaks", () => {
    const nul = String.fromCharCode(0);
    const bell = String.fromCharCode(7);
    const { text, doc } = sanitizeRichText(paragraph({ type: "text", text: `a${nul}b${bell}c\td` }), commentLimits);
    expect(text).toBe("abc\td");
    expect(JSON.stringify(doc)).not.toContain(`${String.fromCharCode(92)}u0000`);
  });

  it("uses server-side mention labels: no spoofed names (SEC-API-10)", () => {
    const labels = new Map([[userId, "Minh Nguyễn"]]);
    const { doc, text, mentions } = sanitizeRichText(
      paragraph({ type: "mention", attrs: { id: userId, label: "CEO" } }, { type: "mention", attrs: { id: otherId, label: "Giám đốc" } }),
      commentLimits,
      { mentionLabels: labels }
    );
    expect(mentions).toEqual([userId]);
    expect(text).toBe("@Minh Nguyễn@Giám đốc");
    expect(doc.content?.[0]?.content).toEqual([
      { type: "mention", attrs: { id: userId, label: "Minh Nguyễn" } },
      // Not a person of the organization: plain text, not a mention chip.
      { type: "text", text: "@Giám đốc" }
    ]);
  });

  it("counts mention labels and line breaks toward the stored text limit (WK-24)", () => {
    const limits = { ...commentLimits, maxTextLength: 50 };
    const mentionsOnly = Array.from({ length: 10 }, () => ({ type: "mention", attrs: { id: userId, label: "x".repeat(10) } }));
    expect(() => sanitizeRichText(paragraph(...mentionsOnly), limits)).toThrow(RichTextError);
    const manyParagraphs = { type: "doc", content: Array.from({ length: 30 }, () => ({ type: "paragraph", content: [{ type: "text", text: "a" }] })) };
    expect(() => sanitizeRichText(manyParagraphs, limits)).toThrow(RichTextError);
  });
});
