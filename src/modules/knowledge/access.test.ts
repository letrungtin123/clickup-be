import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../../lib/app-error.js";
import type { AccessContext } from "../access/access-context.js";

/**
 * Archived spaces (2026-10-11): read-only for their members and org admins. `assertSpaceAccess` and `authorizeItem`
 * open them for reads (`intent: "read"`) and refuse every write — the default intent, so a forgotten call site fails
 * closed — with 409 KNOWLEDGE_SPACE_ARCHIVED, after the visibility check (others keep getting the same 404).
 * A fake tagged-template `sql` answers the space / item lookups.
 */
type Call = { text: string; values: unknown[] };

const db = vi.hoisted(() => {
  const state = { calls: [] as Call[], handler: (() => []) as (call: Call) => unknown[] | undefined };
  const sql = (strings: TemplateStringsArray | string, ...values: unknown[]) => {
    if (typeof strings === "string") {
      return strings;
    }
    const text = strings.join("$").replace(/\s+/g, " ").trim();
    const call = { text, values };
    state.calls.push(call);
    return Promise.resolve(state.handler(call) ?? []);
  };
  return { state, sql };
});

vi.mock("../../db/client.js", () => ({ getSql: () => db.sql }));

const { assertSpaceAccess, authorizeItem, getSpaceAccess } = await import("./access.js");

const orgId = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const spaceId = "44444444-4444-4444-8444-444444444444";
const itemId = "33333333-3333-4333-8333-333333333333";

const contextFor = (orgAdmin = false) =>
  ({
    user: { id: me },
    organization: { id: orgId },
    hasFullOrganizationAuthority: orgAdmin,
    role: { permissions: ["knowledge.view"] }
  }) as unknown as AccessContext;

type SpaceState = { visibility: "public" | "private"; archived: boolean; level: "view" | "submit" | "manage" | null };

/** Answers like the database would for one space (and one active item in it). */
const serve = (space: SpaceState, item: { group: "draft" | "active" } = { group: "active" }) => {
  db.state.handler = (call) => {
    if (call.text.includes("FROM knowledge.spaces s")) {
      // The archived filter is a nested fragment: "TRUE" (include), "s.archived_at IS NULL" or "IS NOT NULL".
      const lastFragment = db.state.calls.slice(0, -1).reverse().find((entry) => /archived_at|^TRUE$/.test(entry.text))?.text ?? "";
      const matches = lastFragment === "TRUE" || (lastFragment.includes("IS NOT NULL") ? space.archived : !space.archived);
      return matches
        ? [
            {
              id: spaceId,
              name: "Kho thử",
              color: "blue",
              visibility: space.visibility,
              approval_required: false,
              archived: space.archived,
              access_level: space.level
            }
          ]
        : [];
    }
    if (call.text.includes("FROM knowledge.items i")) {
      return [
        {
          id: itemId,
          space_id: spaceId,
          status_group: item.group,
          created_by: null,
          deleted_at: null,
          title: "Mục",
          version: 1
        }
      ];
    }
    return [];
  };
};

const outcome = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return error instanceof AppError ? `${error.statusCode} ${error.code}` : String(error);
  }
};

const sql = db.sql as never;

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = () => [];
});

describe("archived spaces: read-only for members and org admins", () => {
  it("members read an archived space; every write answers 409 KNOWLEDGE_SPACE_ARCHIVED", async () => {
    serve({ visibility: "private", archived: true, level: "manage" });
    expect(await outcome(assertSpaceAccess(sql, contextFor(), spaceId, "view", { intent: "read" }))).toBe("ok");
    expect(await outcome(assertSpaceAccess(sql, contextFor(), spaceId, "manage", { intent: "read" }))).toBe("ok");
    expect(await outcome(assertSpaceAccess(sql, contextFor(), spaceId, "manage"))).toBe("409 KNOWLEDGE_SPACE_ARCHIVED");
    expect(await outcome(assertSpaceAccess(sql, contextFor(), spaceId, "submit", { intent: "write" }))).toBe("409 KNOWLEDGE_SPACE_ARCHIVED");
    // A view member asking for a write is told the space is archived (not that their level is too low).
    serve({ visibility: "private", archived: true, level: "view" });
    expect(await outcome(assertSpaceAccess(sql, contextFor(), spaceId, "manage"))).toBe("409 KNOWLEDGE_SPACE_ARCHIVED");
    expect(await outcome(assertSpaceAccess(sql, contextFor(), spaceId, "manage", { intent: "read" }))).toBe("403 FORBIDDEN");
  });

  it("a public archived space no longer opens for non-members (404 for reads and writes alike)", async () => {
    serve({ visibility: "public", archived: true, level: null });
    expect(await outcome(assertSpaceAccess(sql, contextFor(), spaceId, "view", { intent: "read" }))).toBe("404 KNOWLEDGE_SPACE_NOT_FOUND");
    expect(await outcome(assertSpaceAccess(sql, contextFor(), spaceId, "view"))).toBe("404 KNOWLEDGE_SPACE_NOT_FOUND");
    expect(await outcome(authorizeItem(sql, contextFor(), itemId, { intent: "read" }))).toBe("404 KNOWLEDGE_ITEM_NOT_FOUND");
    // Org admins still read it.
    expect(await outcome(assertSpaceAccess(sql, contextFor(true), spaceId, "view", { intent: "read" }))).toBe("ok");
  });

  it("items of an archived space: read for members, 409 for any write", async () => {
    serve({ visibility: "public", archived: true, level: "submit" });
    const read = await authorizeItem(sql, contextFor(), itemId, { intent: "read" });
    expect(read.access).toMatchObject({ archived: true, level: "submit" });
    expect(await outcome(authorizeItem(sql, contextFor(), itemId))).toBe("409 KNOWLEDGE_SPACE_ARCHIVED");
    expect(await outcome(authorizeItem(sql, contextFor(), itemId, { required: "submit", lock: true }))).toBe("409 KNOWLEDGE_SPACE_ARCHIVED");
  });

  it("live spaces are unchanged: writes pass, public readers keep reading", async () => {
    serve({ visibility: "public", archived: false, level: null });
    expect(await outcome(assertSpaceAccess(sql, contextFor(), spaceId, "view"))).toBe("ok");
    expect(await outcome(authorizeItem(sql, contextFor(), itemId))).toBe("ok");
    expect(await outcome(assertSpaceAccess(sql, contextFor(), spaceId, "submit"))).toBe("403 FORBIDDEN");
  });

  it("restore looks up archived spaces only; the realtime room (default) live spaces only", async () => {
    serve({ visibility: "private", archived: true, level: "manage" });
    expect(await outcome(assertSpaceAccess(sql, contextFor(), spaceId, "manage", { archived: true }))).toBe("ok");
    expect(await getSpaceAccess(sql, contextFor(), spaceId)).toBeNull();
    serve({ visibility: "private", archived: false, level: "manage" });
    expect(await outcome(assertSpaceAccess(sql, contextFor(), spaceId, "manage", { archived: true }))).toBe("404 KNOWLEDGE_SPACE_NOT_FOUND");
  });
});
