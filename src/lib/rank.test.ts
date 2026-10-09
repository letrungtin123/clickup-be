import { describe, expect, it } from "vitest";

import { rankScopeLockKey } from "./rank.js";

describe("rank placement lock (WK-25)", () => {
  it("names one lock per sibling set, whatever the key order", () => {
    const a = rankScopeLockKey({ table: "public.tasks", where: { organization_id: "o", list_id: "l", parent_task_id: null } });
    const b = rankScopeLockKey({ table: "public.tasks", where: { parent_task_id: null, list_id: "l", organization_id: "o" } });
    expect(a).toBe(b);
  });

  it("separates different sibling sets", () => {
    const root = rankScopeLockKey({ table: "public.tasks", where: { organization_id: "o", list_id: "l", parent_task_id: null } });
    const child = rankScopeLockKey({ table: "public.tasks", where: { organization_id: "o", list_id: "l", parent_task_id: "p" } });
    const lists = rankScopeLockKey({ table: "public.lists", where: { organization_id: "o", list_id: "l", parent_task_id: null } });
    expect(new Set([root, child, lists]).size).toBe(3);
  });
});
