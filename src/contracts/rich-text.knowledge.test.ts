import { describe, expect, it } from "vitest";

import {
  commentLimits,
  descriptionLimits,
  knowledgeBodyLimits,
  knowledgeBodySpec,
  RichTextError,
  sanitizeKnowledgeBody,
  sanitizeRichText,
  type RichTextNode
} from "./rich-text.js";

/** The "knowledge" profile (PD-031 addendum, 2026-10-11): tables and images in knowledge item bodies only. */

const userId = "3f0c1d9e-8a4b-4c2d-9e1f-2a3b4c5d6e7f";
const imageId = "7d8e9f00-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
const otherImageId = "0a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d";

const text = (value: string) => ({ type: "text", text: value });
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const cell = (content: unknown[], attrs?: Record<string, unknown>, type = "tableCell") => ({ type, ...(attrs ? { attrs } : {}), content });
const row = (...cells: unknown[]) => ({ type: "tableRow", content: cells });
const table = (...rows: unknown[]) => ({ type: "table", content: rows });
const doc = (...content: unknown[]) => ({ type: "doc", content });
const plainCell = (value: string) => cell([p(text(value))]);
const storedCell = (value: string, type = "tableCell"): RichTextNode => ({
  type,
  attrs: { colspan: 1, rowspan: 1, colwidth: null },
  content: [{ type: "paragraph", content: [{ type: "text", text: value }] }]
});

describe("sanitizeRichText — default profile is unchanged", () => {
  it("still drops tables and images, and reports no images", () => {
    const result = sanitizeRichText(
      doc(p(text("trước")), table(row(plainCell("a"), plainCell("b"))), { type: "image", attrs: { attachmentId: imageId } }),
      descriptionLimits
    );
    expect(result.doc.content).toEqual([{ type: "paragraph", content: [{ type: "text", text: "trước" }] }]);
    expect(result.text).toBe("trước");
    expect("images" in result).toBe(false);
  });
});

describe("sanitizeKnowledgeBody — tables", () => {
  it("keeps header and body cells with normalized attributes, one text line per row", () => {
    const { doc: out, text: plain } = sanitizeKnowledgeBody(
      doc(
        p(text("Bảng giá")),
        table(
          row(cell([p(text("Hạng mục"))], undefined, "tableHeader"), cell([p(text("Giá"))], { colspan: 1, rowspan: 1, colwidth: [180] }, "tableHeader")),
          row(plainCell("Retouch"), cell([p(text("50"), { type: "hardBreak" }, text("nghìn"))], { onclick: "x", style: "color:red" }))
        ),
        p(text("Sau bảng"))
      )
    );
    expect(out.content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "Bảng giá" }] },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [storedCell("Hạng mục", "tableHeader"), { ...storedCell("Giá", "tableHeader"), attrs: { colspan: 1, rowspan: 1, colwidth: [180] } }]
          },
          {
            type: "tableRow",
            content: [
              storedCell("Retouch"),
              {
                type: "tableCell",
                attrs: { colspan: 1, rowspan: 1, colwidth: null },
                content: [{ type: "paragraph", content: [{ type: "text", text: "50" }, { type: "hardBreak" }, { type: "text", text: "nghìn" }] }]
              }
            ]
          }
        ]
      },
      { type: "paragraph", content: [{ type: "text", text: "Sau bảng" }] }
    ]);
    expect(plain).toBe("Bảng giá\nHạng mục | Giá\nRetouch | 50 nghìn\n\nSau bảng");
  });

  it("clamps spans, fits column widths to the span and clamps row spans to the rows left", () => {
    const { doc: out } = sanitizeKnowledgeBody(
      doc(
        table(
          row(cell([p(text("a"))], { colspan: 2.4, rowspan: 99, colwidth: [0, 5000, 300] }), plainCell("b")),
          row(plainCell("c")),
          row(cell([p(text("d"))], { colspan: "3", rowspan: -1, colwidth: "120px" }), cell([p(text("e"))], { colwidth: [0] }))
        )
      )
    );
    const rows = out.content?.[0]?.content ?? [];
    // colspan 2.4 → 2 (rounded), rowspan 99 → 12, then 3 rows in the table → 3; colwidth cut to the span, max 2000.
    expect(rows[0]?.content?.[0]?.attrs).toEqual({ colspan: 2, rowspan: 3, colwidth: [0, 2000] });
    expect(rows[2]?.content?.[0]?.attrs).toEqual({ colspan: 1, rowspan: 1, colwidth: null });
    // Only zeros = no width set.
    expect(rows[2]?.content?.[1]?.attrs).toEqual({ colspan: 1, rowspan: 1, colwidth: null });
  });

  it("gives empty cells an empty paragraph and drops empty rows and tables", () => {
    const { doc: out } = sanitizeKnowledgeBody(
      doc(table(row(cell([]), cell([{ type: "iframe" }])), row(), { type: "paragraph" }), table(row()), table())
    );
    expect(out.content).toEqual([
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: "paragraph" }] },
              { type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: "paragraph" }] }
            ]
          }
        ]
      }
    ]);
  });

  it("keeps simple blocks in cells: code → paragraph, checklist → bullet list; images, tables and rules are dropped", () => {
    const { doc: out, images } = sanitizeKnowledgeBody(
      doc(
        table(
          row(
            cell([
              { type: "heading", attrs: { level: 3 }, content: [text("Tiêu đề")] },
              { type: "codeBlock", attrs: { language: "js" }, content: [text("x = 1")] },
              { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [p(text("Xong"))] }] },
              { type: "blockquote", content: [p(text("Lưu ý")), { type: "image", attrs: { attachmentId: imageId } }] },
              { type: "image", attrs: { attachmentId: imageId } },
              table(row(plainCell("lồng"))),
              { type: "horizontalRule" },
              text("lẻ")
            ])
          )
        )
      )
    );
    expect(out.content?.[0]?.content?.[0]?.content?.[0]?.content).toEqual([
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Tiêu đề" }] },
      { type: "paragraph", content: [{ type: "text", text: "x = 1" }] },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Xong" }] }] }] },
      { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "Lưu ý" }] }] },
      { type: "paragraph", content: [{ type: "text", text: "lẻ" }] }
    ]);
    expect(images).toEqual([]);
  });

  it("drops rows and cells outside their parents", () => {
    const { doc: out } = sanitizeKnowledgeBody(doc(row(plainCell("a")), plainCell("b"), table(plainCell("c"), p(text("d")))));
    expect(out.content).toEqual([]);
  });

  it("keeps mentions inside cells (server labels, mention list, text)", () => {
    const { doc: out, mentions, text: plain } = sanitizeKnowledgeBody(
      doc(table(row(cell([p(text("Phụ trách: "), { type: "mention", attrs: { id: userId, label: "CEO" } })]), plainCell("x")))),
      { mentionLabels: new Map([[userId, "Minh Nguyễn"]]) }
    );
    expect(mentions).toEqual([userId]);
    expect(plain).toBe("Phụ trách: @Minh Nguyễn | x");
    expect(JSON.stringify(out)).toContain('"label":"Minh Nguyễn"');
  });

  it("allows tables wherever blocks go except cells (list item, blockquote)", () => {
    const { doc: out } = sanitizeKnowledgeBody(
      doc({ type: "bulletList", content: [{ type: "listItem", content: [p(text("Bước")), table(row(plainCell("a")))] }] })
    );
    expect(out.content?.[0]?.content?.[0]?.content?.[1]?.type).toBe("table");
  });

  it(`refuses more than ${knowledgeBodySpec.maxRows} rows, ${knowledgeBodySpec.maxColumns} columns or ${knowledgeBodySpec.maxTables} tables`, () => {
    const rows = (count: number) => Array.from({ length: count }, (_, index) => row(plainCell(String(index))));
    expect(() => sanitizeKnowledgeBody(doc(table(...rows(knowledgeBodySpec.maxRows))))).not.toThrow();
    expect(() => sanitizeKnowledgeBody(doc(table(...rows(knowledgeBodySpec.maxRows + 1))))).toThrow(/60 hàng/);

    const cells = (count: number) => Array.from({ length: count }, (_, index) => plainCell(String(index)));
    expect(() => sanitizeKnowledgeBody(doc(table(row(...cells(12)))))).not.toThrow();
    expect(() => sanitizeKnowledgeBody(doc(table(row(...cells(13)))))).toThrow(/12 cột/);
    // Spans count: 6 cells of colspan 2 fill 12 columns; one more column is too many.
    const wide = Array.from({ length: 6 }, () => cell([p(text("w"))], { colspan: 2 }));
    expect(() => sanitizeKnowledgeBody(doc(table(row(...wide))))).not.toThrow();
    expect(() => sanitizeKnowledgeBody(doc(table(row(...wide, plainCell("x")))))).toThrow(RichTextError);
    // Row spans reserve columns of the rows below (column map like prosemirror-tables).
    const tall = Array.from({ length: 12 }, () => cell([p(text("t"))], { rowspan: 2 }));
    expect(() => sanitizeKnowledgeBody(doc(table(row(...tall), row(plainCell("x")))))).toThrow(/12 cột/);

    const tables = (count: number) => Array.from({ length: count }, () => table(row(plainCell("t"))));
    expect(() => sanitizeKnowledgeBody(doc(...tables(knowledgeBodySpec.maxTables)))).not.toThrow();
    expect(() => sanitizeKnowledgeBody(doc(...tables(knowledgeBodySpec.maxTables + 1)))).toThrow(/20 bảng/);
  });
});

describe("sanitizeKnowledgeBody — images", () => {
  it("keeps only attachmentId, alt and width — never src, title or other attributes", () => {
    const { doc: out, images, text: plain } = sanitizeKnowledgeBody(
      doc(
        {
          type: "image",
          attrs: {
            attachmentId: imageId.toUpperCase(),
            src: "https://evil.example/x.png",
            title: "t",
            alt: "  Sơ đồ‮  quy trình ",
            width: 12.6,
            onerror: "alert(1)"
          }
        },
        { type: "image", attrs: { attachmentId: otherImageId, alt: "", width: 99_999 } },
        { type: "image", attrs: { attachmentId: imageId, alt: "x".repeat(500), width: "300" } }
      )
    );
    expect(out.content).toEqual([
      { type: "image", attrs: { attachmentId: imageId, alt: "Sơ đồ quy trình", width: 40 } },
      { type: "image", attrs: { attachmentId: otherImageId, alt: null, width: 2000 } },
      { type: "image", attrs: { attachmentId: imageId, alt: "x".repeat(knowledgeBodySpec.imageAltLength), width: null } }
    ]);
    expect(JSON.stringify(out)).not.toMatch(/src|title|onerror|https?:/);
    expect(images).toEqual([imageId, otherImageId]);
    expect(plain).toBe(`[Ảnh: Sơ đồ quy trình]\n[Ảnh]\n[Ảnh: ${"x".repeat(knowledgeBodySpec.imageAltLength)}]`);
  });

  it("removes images without a valid attachment id, and inline images", () => {
    const { doc: out, images } = sanitizeKnowledgeBody(
      doc(
        { type: "image", attrs: { src: "https://example.com/a.png" } },
        { type: "image", attrs: { attachmentId: "not-a-uuid" } },
        { type: "image" },
        p(text("a"), { type: "image", attrs: { attachmentId: imageId } })
      )
    );
    expect(out.content).toEqual([{ type: "paragraph", content: [{ type: "text", text: "a" }] }]);
    expect(images).toEqual([]);
  });

  it("keeps images in blockquotes and list items", () => {
    const image = { type: "image", attrs: { attachmentId: imageId, alt: "Ảnh 1" } };
    const { doc: out, images } = sanitizeKnowledgeBody(
      doc({ type: "blockquote", content: [image] }, { type: "orderedList", content: [{ type: "listItem", content: [p(text("Bước 1")), image] }] })
    );
    expect(out.content?.[0]).toEqual({ type: "blockquote", content: [{ type: "image", attrs: { attachmentId: imageId, alt: "Ảnh 1", width: null } }] });
    expect(out.content?.[1]?.content?.[0]?.content?.[1]?.type).toBe("image");
    expect(images).toEqual([imageId]);
  });

  it(`refuses more than ${knowledgeBodySpec.maxImages} different images`, () => {
    const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    const many = (count: number) => doc(...Array.from({ length: count }, (_, index) => ({ type: "image", attrs: { attachmentId: id(index) } })));
    expect(sanitizeKnowledgeBody(many(knowledgeBodySpec.maxImages)).images).toHaveLength(knowledgeBodySpec.maxImages);
    expect(() => sanitizeKnowledgeBody(many(knowledgeBodySpec.maxImages + 1))).toThrow(/100 ảnh/);
  });
});

describe("sanitizeKnowledgeBody — limits and stability", () => {
  it("allows longer articles than task descriptions", () => {
    const long = doc(...Array.from({ length: 150 }, () => p(text("x".repeat(1000)))));
    expect(() => sanitizeRichText(long, descriptionLimits)).toThrow(RichTextError);
    expect(sanitizeKnowledgeBody(long).text.length).toBeGreaterThan(descriptionLimits.maxTextLength);
    const tooLong = doc(...Array.from({ length: 201 }, () => p(text("x".repeat(1000)))));
    expect(() => sanitizeKnowledgeBody(tooLong)).toThrow(RichTextError);
    expect(knowledgeBodyLimits.maxTextLength).toBe(200_000);
  });

  it("is idempotent (the server sanitizes twice: once more with mention labels)", () => {
    const input = doc(
      p(text("Mở đầu")),
      table(row(cell([p(text("a"))], { colspan: 2, rowspan: 5, colwidth: [100] })), row(plainCell("b"), plainCell("c"))),
      { type: "image", attrs: { attachmentId: imageId, alt: "Ảnh", width: 640 } }
    );
    const first = sanitizeKnowledgeBody(input);
    const second = sanitizeKnowledgeBody(first.doc);
    expect(second.doc).toEqual(first.doc);
    expect(second.text).toBe(first.text);
    expect(second.images).toEqual(first.images);
  });

  it("comments keep the shared schema (no tables, no images)", () => {
    const result = sanitizeRichText(doc(table(row(plainCell("a"))), { type: "image", attrs: { attachmentId: imageId } }, p(text("ok"))), commentLimits);
    expect(result.doc.content).toEqual([{ type: "paragraph", content: [{ type: "text", text: "ok" }] }]);
  });
});
