import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RichTextDoc } from "../../contracts/rich-text.js";
import { AppError } from "../../lib/app-error.js";
import type { AccessContext } from "../access/access-context.js";
import type * as StorageModule from "../../lib/storage.js";
import type * as AccessModule from "./access.js";

/**
 * Images in knowledge item bodies (PD-031 addendum, 2026-10-11): validation on save, version bookkeeping, and the
 * rule that a file used by any version body never leaves storage while the item exists. A fake tagged-template
 * `sql` answers the lookups and records every statement; storage and realtime are mocked.
 */
type Call = { text: string; values: unknown[] };

const db = vi.hoisted(() => {
  const state = { calls: [] as Call[], handler: (() => []) as (call: Call) => unknown[] | undefined };
  const sql = (strings: TemplateStringsArray | string, ...values: unknown[]) => {
    if (typeof strings === "string") {
      // sql("alias"): identifier helper.
      return strings;
    }
    const text = strings.join("$").replace(/\s+/g, " ").trim();
    const call = { text, values };
    state.calls.push(call);
    return Promise.resolve(state.handler(call) ?? []);
  };
  const fake = Object.assign(sql, { json: (value: unknown) => value, begin: <T>(fn: (tx: unknown) => Promise<T>) => fn(fake) });
  return { state, sql: fake };
});

const mocks = vi.hoisted(() => ({
  removeObjects: vi.fn(() => Promise.resolve()),
  authorizeItem: vi.fn(),
  publishToRoom: vi.fn()
}));

vi.mock("../../db/client.js", () => ({ getSql: () => db.sql }));
vi.mock("../../lib/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof StorageModule>()),
  removeObjects: mocks.removeObjects
}));
vi.mock("../../realtime/publisher.js", () => ({ publishToRoom: mocks.publishToRoom, publishToRooms: vi.fn(), publishToUsers: vi.fn() }));
vi.mock("./access.js", async (importOriginal) => ({
  ...(await importOriginal<typeof AccessModule>()),
  authorizeItem: mocks.authorizeItem
}));

const { assertBodyImages, bodyImageIds, insertVersion } = await import("./repo.js");
const { deleteKnowledgeAttachment } = await import("./attachments.service.js");

const orgId = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const itemId = "33333333-3333-4333-8333-333333333333";
const spaceId = "44444444-4444-4444-8444-444444444444";
const imageA = "55555555-5555-4555-8555-555555555555";
const imageB = "66666666-6666-4666-8666-666666666666";

const context = {
  user: { id: me },
  organization: { id: orgId },
  hasFullOrganizationAuthority: true,
  permissions: []
} as unknown as AccessContext;

const errorOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof AppError ? `${error.statusCode} ${error.code}` : String(error);
  }
};

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = () => [];
  mocks.removeObjects.mockClear();
  mocks.authorizeItem.mockReset();
});

describe("assertBodyImages", () => {
  it("does not query anything for a body without images", async () => {
    await assertBodyImages(db.sql as never, itemId, []);
    expect(db.state.calls).toHaveLength(0);
  });

  it("refuses images in a new item (no files yet: the draft is saved before the first upload)", async () => {
    expect(await errorOf(assertBodyImages(db.sql as never, null, [imageA]))).toBe("400 KNOWLEDGE_IMAGE_INVALID");
    expect(db.state.calls).toHaveLength(0);
  });

  it("accepts ready image files of the item itself, also hidden ones a version still uses", async () => {
    db.state.handler = (call) => (call.text.includes("FROM knowledge.item_attachments a") ? [{ id: imageA }, { id: imageB }] : []);
    expect(await errorOf(assertBodyImages(db.sql as never, itemId, [imageA, imageB]))).toBeNull();
    const query = db.state.calls.find((call) => call.text.includes("FROM knowledge.item_attachments a"))!;
    expect(query.text).toContain("a.status = 'ready' AND a.purpose = 'item'");
    expect(query.text).toContain("a.mime_type = ANY(");
    expect(query.text).toContain("a.deleted_at IS NULL OR");
    expect(query.values).toContain(itemId);
    expect(query.values).toContainEqual([imageA, imageB]);
    expect(query.values).toContainEqual(expect.arrayContaining(["image/png", "image/jpeg", "image/webp"]));
  });

  it("refuses when any image is not such a file (other item, comment file, pending, removed, not an image)", async () => {
    db.state.handler = (call) => (call.text.includes("FROM knowledge.item_attachments a") ? [{ id: imageA }] : []);
    expect(await errorOf(assertBodyImages(db.sql as never, itemId, [imageA, imageB]))).toBe("400 KNOWLEDGE_IMAGE_INVALID");
  });
});

describe("version bookkeeping", () => {
  const body: RichTextDoc = {
    type: "doc",
    content: [
      { type: "image", attrs: { attachmentId: imageA, alt: null, width: null } },
      { type: "blockquote", content: [{ type: "image", attrs: { attachmentId: imageB, alt: "b", width: 300 } }] },
      { type: "image", attrs: { attachmentId: imageA, alt: "again", width: null } }
    ]
  };

  it("collects the images of a stored body (unique, document order)", () => {
    expect(bodyImageIds(body)).toEqual([imageA, imageB]);
    expect(bodyImageIds({ type: "doc" })).toEqual([]);
  });

  it("every version records the images of its body", async () => {
    await insertVersion(db.sql as never, context, {
      spaceId,
      itemId,
      number: 2,
      title: "T",
      summary: null,
      body,
      bodyText: "[Ảnh]",
      note: null,
      restoredFrom: null
    });
    const insert = db.state.calls.find((call) => call.text.includes("INSERT INTO knowledge.item_versions"))!;
    expect(insert.text).toContain("image_attachment_ids");
    expect(insert.values).toContainEqual([imageA, imageB]);
  });
});

describe("deleting a file used by a version body", () => {
  const attachmentRow = {
    id: imageA,
    item_id: itemId,
    comment_id: null,
    file_name: "so-do.png",
    mime_type: "image/png",
    size_bytes: "100",
    size_declared: "100",
    created_at: new Date(),
    storage_path: `org/${orgId}/knowledge/${spaceId}/${itemId}/${imageA}/so-do.png`,
    status: "ready",
    purpose: "item",
    uploaded_by_id: me,
    space_id: spaceId,
    uploaded_by: null
  };

  const setUp = (used: boolean, level: "submit" | "manage" = "manage", group: "draft" | "active" = "draft", approvalRequired = false) => {
    mocks.authorizeItem.mockResolvedValue({
      item: { id: itemId, space_id: spaceId, title: "Quy trình", status_group: group },
      access: { level, approvalRequired, spaceId }
    });
    db.state.handler = (call) => {
      if (call.text.includes("AS used")) {
        return [{ used }];
      }
      if (call.text.includes("FROM knowledge.item_attachments a WHERE a.id =")) {
        return [attachmentRow];
      }
      return [];
    };
  };

  it("only hides it: the object stays in storage (old versions keep rendering it)", async () => {
    setUp(true);
    expect(await deleteKnowledgeAttachment(context, imageA)).toEqual({ ok: true });
    expect(mocks.removeObjects).not.toHaveBeenCalled();
    expect(db.state.calls.some((call) => call.text.startsWith("UPDATE knowledge.item_attachments SET deleted_at = now()"))).toBe(true);
    const audit = db.state.calls.find((call) => call.text.includes("INSERT INTO knowledge.audit_log"))!;
    expect(JSON.stringify(audit.values)).toContain('"keptForVersions":true');
    // The item row is locked: a concurrent save cannot start using the image in between.
    expect(mocks.authorizeItem).toHaveBeenCalledWith(db.sql, context, itemId, { lock: true });
  });

  it("removes the object of a file no version uses", async () => {
    setUp(false);
    expect(await deleteKnowledgeAttachment(context, imageA)).toEqual({ ok: true });
    expect(mocks.removeObjects).toHaveBeenCalledWith([attachmentRow.storage_path]);
  });

  it("approval on: the uploader (member) cannot remove files of a published item; a manager can", async () => {
    setUp(false, "submit", "active", true);
    expect(await errorOf(deleteKnowledgeAttachment(context, imageA))).toBe("403 FORBIDDEN");
    expect(mocks.removeObjects).not.toHaveBeenCalled();
    setUp(false, "submit", "draft", true);
    expect(await errorOf(deleteKnowledgeAttachment(context, imageA))).toBeNull();
    setUp(false, "manage", "active", true);
    expect(await errorOf(deleteKnowledgeAttachment(context, imageA))).toBeNull();
  });
});
