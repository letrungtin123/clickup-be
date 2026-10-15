import { afterEach, describe, expect, it, vi } from "vitest";

import type * as DbClientModule from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import type { QuerySql } from "../../lib/db-types.js";
import type * as RedisModule from "../../lib/redis.js";
import type * as PublisherModule from "../../realtime/publisher.js";
import type { AccessContext } from "../access/access-context.js";
import { searchDirectory } from "../work/directory.service.js";
import { openDirectConversation } from "./channels.service.js";

/**
 * Staff DMs (no database): GET /directory/users?purpose=dm and POST /dms rules. A fake tagged-template `sql`
 * records each statement and answers it; nothing reaches a database, Redis or a socket.
 */

type Call = { text: string; values: unknown[] };
type Fragment = { readonly isFragment: true; text: string; values: unknown[] };

const state = vi.hoisted((): { sql: unknown } => ({ sql: undefined }));

vi.mock("../../lib/redis.js", async (importOriginal) => ({
  ...(await importOriginal<typeof RedisModule>()),
  hasRedisConfig: () => false,
  getOptionalRedis: () => undefined,
  getRedis: () => {
    throw new Error("Redis is not available in this test");
  }
}));
vi.mock("../../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof DbClientModule>()),
  getSql: () => {
    if (!state.sql) {
      throw new Error("No SQL connection in this test");
    }
    return state.sql;
  }
}));
vi.mock("../../realtime/publisher.js", async (importOriginal) => {
  const original = await importOriginal<typeof PublisherModule>();
  return Object.fromEntries(Object.entries(original).map(([name, value]) => [name, typeof value === "function" ? vi.fn() : value]));
});

/** Records every statement; `handler` answers it (default: no rows). Fragments are inlined like postgres.js does. */
const fakeSql = (handler: (call: Call) => unknown[] | undefined = () => []) => {
  const calls: Call[] = [];
  const isFragment = (value: unknown): value is Fragment =>
    typeof value === "object" && value !== null && (value as { isFragment?: unknown }).isFragment === true;
  const sql = (strings: TemplateStringsArray | string, ...values: unknown[]) => {
    if (typeof strings === "string") {
      return { isFragment: true as const, text: `"${strings}"`, values: [] as unknown[] };
    }
    let text = strings[0] ?? "";
    const flat: unknown[] = [];
    values.forEach((value, index) => {
      if (isFragment(value)) {
        text += value.text;
        flat.push(...value.values);
      } else {
        text += "$";
        flat.push(value);
      }
      text += strings[index + 1] ?? "";
    });
    return {
      isFragment: true as const,
      text,
      values: flat,
      then(resolve: (rows: unknown[]) => void, reject: (error: unknown) => void) {
        const call = { text: text.replace(/\s+/g, " ").trim(), values: flat };
        calls.push(call);
        try {
          resolve(handler(call) ?? []);
        } catch (error) {
          reject(error);
        }
      }
    };
  };
  const fake = Object.assign(sql, {
    json: (value: unknown) => value,
    begin: <T>(fn: (tx: unknown) => Promise<T>) => fn(fake),
    savepoint: <T>(fn: (tx: unknown) => Promise<T>) => fn(fake)
  });
  state.sql = fake;
  return { sql: fake as unknown as QuerySql, calls };
};

afterEach(() => {
  state.sql = undefined;
});

// Obviously fake ids and names (the repository is public).
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const org = id(1);
const me = id(2);
const colleague = id(3);
const stranger = id(4);
const third = id(5);

const contextWith = (departments: string[], options: { full?: boolean; permissions?: string[] } = {}) =>
  ({
    user: { id: me, email: null, displayName: "Nhân viên Test" },
    organization: { id: org, slug: "test-org", name: "Test org" },
    role: { id: id(9), organizationId: org, key: options.full ? "superadmin" : "member", name: "Role", permissions: options.permissions ?? [] },
    hasFullOrganizationAuthority: options.full ?? false,
    mustChangePassword: false,
    productionRoles: [],
    departments,
    canSwitchDepartment: departments.length > 1
  }) as unknown as AccessContext;

const staff = contextWith(["PHOTO_RETOUCH"]);
const manager = contextWith(["PHOTO_RETOUCH"], { permissions: ["channel.create", "member.view"] });
const superadmin = contextWith(["PHOTO_RETOUCH", "PRODUCTION"], { full: true, permissions: ["channel.create", "member.view"] });

const failure = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return error instanceof AppError ? `${error.statusCode} ${error.code}` : (error as Error).message;
  }
  return "ok";
};

describe("people search for a DM (purpose=dm)", () => {
  const people = () =>
    fakeSql((call) =>
      call.text.includes("FROM public.organization_memberships om")
        ? [{ user: { id: colleague, display_name: "Đồng nghiệp", email: "dong.nghiep@example.test", avatar_url: null } }]
        : []
    );

  it("lets staff without member.view search their department colleagues and superadmins, names only", async () => {
    const { calls } = people();
    const result = await searchDirectory(staff, { q: "dong", purpose: "dm", limit: 20 });
    expect(result.items).toEqual([{ id: colleague, displayName: "Đồng nghiệp", email: null, avatarUrl: null }]);
    const query = calls.at(-1)!;
    expect(query.text).toContain("public.user_departments ud");
    expect(query.text).toContain("r.key = 'superadmin'");
    expect(query.text).toContain("om.status = 'active'");
    expect(query.values).toContainEqual(["PHOTO_RETOUCH"]);
    // E-mails are neither shown nor searchable without member.view: the flag guarding the e-mail match is false.
    const parts = query.text.split("$");
    const emailFlag = parts.findIndex((part) => part.startsWith(" AND lower(au.email)")) - 1;
    expect(emailFlag).toBeGreaterThanOrEqual(0);
    expect(query.values[emailFlag]).toBe(false);
  });

  it("still refuses the organization-wide search without member.view", async () => {
    people();
    expect(await failure(() => searchDirectory(staff, { q: "dong", limit: 20 }))).toBe("403 FORBIDDEN");
  });

  it("does not limit callers who may create channels (superadmins included); e-mails follow member.view", async () => {
    for (const context of [manager, superadmin]) {
      const { calls } = people();
      const result = await searchDirectory(context, { purpose: "dm", limit: 20 });
      expect(calls.at(-1)!.text).not.toContain("user_departments");
      expect(result.items[0]?.email).toBe("dong.nghiep@example.test");
    }
  });

  it("ignores project / channel scopes for a DM search", async () => {
    const { calls } = people();
    await searchDirectory(staff, { purpose: "dm", projectId: id(70), channelId: id(71), limit: 20 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.text).not.toContain("project_memberships");
    expect(calls[0]!.text).not.toContain("channel_members");
  });
});

describe("opening a DM (POST /dms)", () => {
  /** No existing conversation; the parties' departments; stops at the INSERT (the rules let it through). */
  const dmSql = (parties: Record<string, { superadmin: boolean; departments: string[] }>) =>
    fakeSql((call) => {
      if (call.text.includes("dm_key =")) return [];
      if (call.text.includes("AS superadmin")) {
        const ids = call.values.find(Array.isArray) as string[];
        return ids.filter((user) => parties[user]).map((user) => ({ user_id: user, ...parties[user] }));
      }
      if (call.text.includes("SELECT om.user_id, au.display_name")) {
        const ids = call.values.find(Array.isArray) as string[];
        return ids.map((user) => ({ user_id: user, display_name: "Ai đó" }));
      }
      if (call.text.startsWith("INSERT INTO public.channels")) throw new Error("REACHED_INSERT");
      return [];
    });

  const parties = {
    [colleague]: { superadmin: false, departments: ["PHOTO_RETOUCH", "PRODUCTION"] },
    [stranger]: { superadmin: false, departments: ["PRODUCTION"] },
    [third]: { superadmin: true, departments: [] }
  };

  it("lets staff open a 1:1 with a colleague or the superadmin", async () => {
    dmSql(parties);
    expect(await failure(() => openDirectConversation(staff, { userIds: [colleague] }))).toBe("REACHED_INSERT");
    dmSql(parties);
    expect(await failure(() => openDirectConversation(staff, { userIds: [third] }))).toBe("REACHED_INSERT");
  });

  it("refuses staff a 1:1 outside their departments, in Vietnamese", async () => {
    const { calls } = dmSql(parties);
    let message = "";
    try {
      await openDirectConversation(staff, { userIds: [stranger] });
    } catch (error) {
      message = (error as AppError).message;
      expect(`${(error as AppError).statusCode} ${(error as AppError).code}`).toBe("403 CHAT_DM_NOT_COLLEAGUE");
    }
    expect(message).toBe("Bạn chỉ nhắn tin 1:1 được với đồng nghiệp cùng phòng ban.");
    expect(calls.some((call) => call.text.startsWith("INSERT"))).toBe(false);
  });

  it("answers 400 for someone who is not an active member", async () => {
    dmSql(parties);
    expect(await failure(() => openDirectConversation(staff, { userIds: [id(6)] }))).toBe("400 CHAT_MEMBER_INVALID");
  });

  it("refuses group DMs without the right to create channels, before writing anything", async () => {
    const { calls } = dmSql(parties);
    expect(await failure(() => openDirectConversation(staff, { userIds: [colleague, third] }))).toBe("403 CHAT_DM_GROUP_FORBIDDEN");
    expect(calls.some((call) => call.text.startsWith("INSERT"))).toBe(false);
  });

  it("keeps group DMs and any 1:1 for channel creators and superadmins", async () => {
    for (const context of [manager, superadmin]) {
      dmSql(parties);
      expect(await failure(() => openDirectConversation(context, { userIds: [colleague, stranger] }))).toBe("REACHED_INSERT");
      const { calls } = dmSql(parties);
      expect(await failure(() => openDirectConversation(context, { userIds: [stranger] }))).toBe("REACHED_INSERT");
      // No department lookup needed for them.
      expect(calls.some((call) => call.text.includes("AS superadmin"))).toBe(false);
    }
  });
});
