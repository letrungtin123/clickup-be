import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatChannelInfoSchema, ChatChannelSchema } from "../../contracts/chat.js";
import { roomName, userRoom } from "../../contracts/realtime.js";
import type * as DbClientModule from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import type { QuerySql } from "../../lib/db-types.js";
import type * as RedisModule from "../../lib/redis.js";
import { evictUsersFromRoom, publishToRooms } from "../../realtime/publisher.js";
import type * as PublisherModule from "../../realtime/publisher.js";
import type { AccessContext } from "../access/access-context.js";
import { searchDirectory } from "../work/directory.service.js";
import { browseChannels, createChannel, getChannel, listMyChannels, updateChannel } from "./channels.service.js";
import { pickChannelInfo } from "./chat-mappers.js";
import { publishDepartmentChannelSync, syncDepartmentChannels } from "./department-channels.js";

/**
 * Department channels (PD-053), no database: a fake tagged-template `sql` records each statement and answers it;
 * nothing reaches a database, Redis or a socket (the publisher is mocked).
 *   - a public channel takes a department on create / private → public and gets every member of it;
 *   - a department change joins / leaves the department's public channels (sync) and publishes after the commit;
 *   - browse and the mention picker follow the department;
 *   - PD-054: private channels carry a department too, the sidebar says where each conversation is shown, browse and
 *     the people search narrow to the selected department.
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

beforeEach(() => {
  vi.mocked(publishToRooms).mockClear();
  vi.mocked(evictUsersFromRoom).mockClear();
});
afterEach(() => {
  state.sql = undefined;
});

// Obviously fake ids and names (the repository is public).
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const org = id(1);
const me = id(2);
const person = id(3);
const colleague = id(4);
const channelA = id(51);
const channelB = id(52);
const channelC = id(53);

const contextWith = (departments: string[], options: { full?: boolean; permissions?: string[] } = {}) =>
  ({
    user: { id: me, email: null, displayName: "Quản trị Test" },
    organization: { id: org, slug: "test-org", name: "Test org" },
    role: {
      id: id(9),
      organizationId: org,
      key: options.full ? "superadmin" : "member",
      name: "Role",
      permissions: options.permissions ?? ["channel.view", "channel.create"]
    },
    hasFullOrganizationAuthority: options.full ?? false,
    mustChangePassword: false,
    productionRoles: [],
    departments,
    canSwitchDepartment: departments.length > 1
  }) as unknown as AccessContext;

const retoucher = contextWith(["PHOTO_RETOUCH"]);
const both = contextWith(["PHOTO_RETOUCH", "PRODUCTION"]);
const superadmin = contextWith(["PHOTO_RETOUCH", "PRODUCTION"], { full: true });

const failure = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return error instanceof AppError ? `${error.statusCode} ${error.code}` : (error as Error).message;
  }
  return "ok";
};

/** Answers the statements every chat write makes (actor, names, sequence numbers, system messages). */
const chatAnswers = (call: Call): unknown[] | undefined => {
  if (call.text.includes("JOIN public.organizations o")) {
    return [{ display_name: "Quản trị Test", email: null, slug: "test-org", name: "Test org" }];
  }
  if (call.text.startsWith("SELECT display_name FROM public.app_users WHERE id")) {
    return [{ display_name: "Nhân viên Test" }];
  }
  if (call.text.startsWith("UPDATE public.channels SET last_message_seq")) {
    return [{ last_message_seq: "7" }];
  }
  if (call.text.startsWith("INSERT INTO public.messages")) {
    return [{ id: id(900 + (call.values[1] === channelA ? 1 : call.values[1] === channelB ? 2 : 3)) }];
  }
  return undefined;
};

const channelRow = (overrides: Record<string, unknown> = {}) => ({
  id: channelA,
  kind: "public",
  name: "chung",
  description: null,
  topic: null,
  created_by: me,
  created_at: new Date("2026-10-15T00:00:00Z"),
  updated_at: new Date("2026-10-15T00:00:00Z"),
  archived_at: null,
  last_message_seq: "2",
  last_message_at: null,
  member_count: 3,
  department: "PHOTO_RETOUCH",
  access: "submit",
  role: "admin",
  notify_level: "all",
  last_read_seq: "2",
  mention_count: 0,
  unread_count: 0,
  participants: [],
  member_id: id(60),
  ...overrides
});

describe("department change → public channels (syncDepartmentChannels)", () => {
  it("does nothing without a department gained or lost", async () => {
    const { sql, calls } = fakeSql();
    expect(await syncDepartmentChannels(sql, { organizationId: org, userId: person, actorUserId: me, join: [], leave: [] })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("joins the public channels of a department gained, caught up, with an 'added' message by the actor", async () => {
    const { sql, calls } = fakeSql((call) =>
      call.text.startsWith("INSERT INTO public.channel_members") ? [{ channel_id: channelB }, { channel_id: channelA }] : chatAnswers(call)
    );
    const sync = await syncDepartmentChannels(sql, { organizationId: org, userId: person, actorUserId: me, join: ["PRODUCTION"], leave: [] });

    const insert = calls.find((call) => call.text.startsWith("INSERT INTO public.channel_members"))!;
    expect(insert.text).toContain("c.kind = 'public' AND c.department = ANY($::text[])");
    expect(insert.text).toContain("c.deleted_at IS NULL AND c.archived_at IS NULL");
    expect(insert.text).toContain("'submit', 'member', c.last_message_seq");
    expect(insert.values).toContainEqual(["PRODUCTION"]);
    // Never DMs or private channels; nothing left.
    expect(calls.some((call) => call.text.startsWith("UPDATE public.channel_members cm SET deleted_at"))).toBe(false);

    // One system message per channel, in channel id order; the person's read marker moves past it.
    const messages = calls.filter((call) => call.text.startsWith("INSERT INTO public.messages"));
    expect(messages.map((call) => call.values[1])).toEqual([channelA, channelB]);
    expect(messages[0]!.values).toContainEqual({ type: "members_added", actorId: me, userIds: [person] });
    expect(messages[0]!.values).toContain("Quản trị Test added Nhân viên Test");
    const markers = calls.filter((call) => call.text.startsWith("UPDATE public.channel_members SET last_read_seq") && call.values.some((value) => Array.isArray(value) && value.includes(person)));
    expect(markers).toHaveLength(2);
    // Quiet: no inbox notification.
    expect(calls.some((call) => call.text.includes("public.outbox_events"))).toBe(false);

    expect(sync).toMatchObject({
      userId: person,
      joined: [
        { channelId: channelA, messageId: id(901) },
        { channelId: channelB, messageId: id(902) }
      ],
      left: []
    });
    expect(sync!.actor.user.id).toBe(me);
  });

  it("leaves the public channels of a department lost (no message in an archived one)", async () => {
    const { sql, calls } = fakeSql((call) =>
      call.text.startsWith("UPDATE public.channel_members cm SET deleted_at")
        ? [
            { channel_id: channelC, archived: true },
            { channel_id: channelA, archived: false }
          ]
        : chatAnswers(call)
    );
    const sync = await syncDepartmentChannels(sql, {
      organizationId: org,
      userId: person,
      actorUserId: me,
      join: ["PHOTO_RETOUCH"],
      leave: ["PHOTO_RETOUCH"]
    });

    const leave = calls.find((call) => call.text.startsWith("UPDATE public.channel_members cm SET deleted_at"))!;
    expect(leave.text).toContain("c.kind = 'public' AND c.department = ANY($::text[]) AND c.deleted_at IS NULL");
    expect(leave.values).toContainEqual(["PHOTO_RETOUCH"]);
    // Leaving wins over joining the same department.
    expect(calls.some((call) => call.text.startsWith("INSERT INTO public.channel_members"))).toBe(false);
    const messages = calls.filter((call) => call.text.startsWith("INSERT INTO public.messages"));
    expect(messages).toHaveLength(1);
    expect(messages[0]!.values).toContainEqual({ type: "member_removed", actorId: me, userIds: [person] });
    expect(sync).toMatchObject({
      left: [
        { channelId: channelA, messageId: id(901) },
        { channelId: channelC, messageId: null }
      ],
      joined: []
    });
  });

  it("says 'joined' / 'left' when the person acts on themselves (Google sign-up)", async () => {
    const { sql, calls } = fakeSql((call) =>
      call.text.startsWith("INSERT INTO public.channel_members") ? [{ channel_id: channelA }] : chatAnswers(call)
    );
    await syncDepartmentChannels(sql, { organizationId: org, userId: person, actorUserId: null, join: ["PHOTO_RETOUCH"], leave: [] });
    const message = calls.find((call) => call.text.startsWith("INSERT INTO public.messages"))!;
    expect(message.values).toContainEqual({ type: "joined", actorId: person, userIds: [person] });
  });

  it("publishes after the commit: messages, joined / left hints to the room and the person, eviction, inbox purge", async () => {
    const { calls } = fakeSql((call) =>
      call.text.startsWith("SELECT c.id, c.kind") ? [channelRow({ id: channelA }), channelRow({ id: channelB })] : chatAnswers(call)
    );
    const actor = contextWith([]);
    await publishDepartmentChannelSync({
      actor,
      userId: person,
      joined: [{ channelId: channelA, messageId: id(901) }],
      left: [{ channelId: channelB, messageId: null }]
    });
    const events = vi.mocked(publishToRooms).mock.calls.filter(([, name]) => name === "chat:channel");
    expect(events).toHaveLength(2);
    expect(events[0]![0]).toEqual(expect.arrayContaining([roomName({ type: "channel", id: channelA }), userRoom(person)]));
    expect(events[0]![2]).toMatchObject({ kind: "joined", channelId: channelA, userIds: [person], channel: { department: "PHOTO_RETOUCH" } });
    expect(events[1]![2]).toMatchObject({ kind: "left", channelId: channelB, userIds: [person] });
    expect(evictUsersFromRoom).toHaveBeenCalledWith([person], { type: "channel", id: channelB });
    const purge = calls.find((call) => call.text.startsWith("DELETE FROM public.notifications"))!;
    expect(purge.values).toContain(channelB);
    // Nothing to publish: nothing done.
    await publishDepartmentChannelSync(null);
    expect(vi.mocked(publishToRooms).mock.calls.filter(([, name]) => name === "chat:channel")).toHaveLength(2);
  });
});

describe("creating a public channel (POST /channels)", () => {
  const createSql = () =>
    fakeSql((call) => {
      if (call.text.startsWith("INSERT INTO public.channels")) return [{ id: channelA }];
      if (call.text.startsWith("WITH added AS")) {
        return [
          { user_id: colleague, display_name: "Đồng nghiệp" },
          { user_id: person, display_name: "Nhân viên Test" }
        ];
      }
      if (call.text.includes("FROM public.channels c LEFT JOIN public.channel_members cm")) return [channelRow()];
      return chatAnswers(call);
    });

  it("takes the creator's only department and adds every member of it, caught up and notified", async () => {
    const { calls } = createSql();
    const detail = await createChannel(retoucher, { kind: "public", name: "chung", memberIds: [id(77)] });
    expect(detail.department).toBe("PHOTO_RETOUCH");

    const insert = calls.find((call) => call.text.startsWith("INSERT INTO public.channels"))!;
    expect(insert.values).toContain("PHOTO_RETOUCH");
    // memberIds are ignored for a public channel: only the creator is inserted by hand, nobody is looked up.
    const creator = calls.find((call) => call.text.includes("FROM unnest($::uuid[]) AS u(user_id)"))!;
    expect(creator.values).toContainEqual([me]);
    expect(calls.some((call) => call.values.some((value) => Array.isArray(value) && value.includes(id(77))))).toBe(false);

    const added = calls.find((call) => call.text.startsWith("WITH added AS"))!;
    expect(added.text).toContain("public.is_department_member(om.organization_id, om.user_id, $::text)");
    expect(added.text).toContain("om.status = 'active'");
    expect(added.values).toContain("PHOTO_RETOUCH");

    const messages = calls.filter((call) => call.text.startsWith("INSERT INTO public.messages"));
    expect(messages[1]!.values).toContainEqual({ type: "members_added", actorId: me, userIds: [colleague, person] });
    const outbox = calls.find((call) => call.text.includes("public.outbox_events"))!;
    expect(JSON.stringify(outbox.values)).toContain("chat.channel.member_added");
    expect(JSON.stringify(outbox.values)).toContain(colleague);

    const events = vi.mocked(publishToRooms).mock.calls.filter(([, name]) => name === "chat:channel");
    expect(events[0]![0]).toEqual(expect.arrayContaining([userRoom(me), userRoom(colleague), userRoom(person)]));
  });

  it("asks a creator in several departments (the superadmin too) to choose: 400 CHANNEL_DEPARTMENT_REQUIRED", async () => {
    for (const context of [both, superadmin]) {
      const { calls } = createSql();
      expect(await failure(() => createChannel(context, { kind: "public", name: "chung", memberIds: [] }))).toBe("400 CHANNEL_DEPARTMENT_REQUIRED");
      expect(calls).toHaveLength(0);
      createSql();
      expect(await failure(() => createChannel(context, { kind: "public", name: "chung", memberIds: [], department: "PRODUCTION" }))).toBe("ok");
    }
  });

  it("refuses a department the creator is not in: 403 DEPARTMENT_FORBIDDEN", async () => {
    const { calls } = createSql();
    expect(await failure(() => createChannel(retoucher, { kind: "public", name: "chung", memberIds: [], department: "PRODUCTION" }))).toBe(
      "403 DEPARTMENT_FORBIDDEN"
    );
    expect(calls).toHaveLength(0);
  });

  const privateSql = () =>
    fakeSql((call) => {
      if (call.text.startsWith("SELECT om.user_id, au.display_name")) return [{ user_id: colleague, display_name: "Đồng nghiệp" }];
      if (call.text.startsWith("INSERT INTO public.channels")) return [{ id: channelA }];
      if (call.text.includes("FROM public.channels c LEFT JOIN public.channel_members cm")) {
        return [channelRow({ kind: "private", department: "PRODUCTION" })];
      }
      return chatAnswers(call);
    });

  it("a private channel takes a department too (PD-054) but keeps only the picked people", async () => {
    const { calls } = privateSql();
    const detail = await createChannel(both, { kind: "private", name: "nhom", memberIds: [colleague], department: "PRODUCTION" });
    expect(detail).toMatchObject({ kind: "private", department: "PRODUCTION", audienceDepartments: ["PRODUCTION"] });
    const insert = calls.find((call) => call.text.startsWith("INSERT INTO public.channels"))!;
    expect(insert.values).toContain("PRODUCTION");
    // The department adds nobody: no department members, only the creator and the picked people.
    expect(calls.some((call) => call.text.startsWith("WITH added AS"))).toBe(false);
    expect(calls.find((call) => call.text.includes("FROM unnest($::uuid[]) AS u(user_id)"))!.values).toContainEqual([me, colleague]);
  });

  it("a private channel's department follows the create rules: the only one, a choice, or 403", async () => {
    const { calls } = privateSql();
    await createChannel(retoucher, { kind: "private", name: "nhom", memberIds: [colleague] });
    expect(calls.find((call) => call.text.startsWith("INSERT INTO public.channels"))!.values).toContain("PHOTO_RETOUCH");

    for (const context of [both, superadmin]) {
      const again = privateSql();
      expect(await failure(() => createChannel(context, { kind: "private", name: "nhom", memberIds: [] }))).toBe("400 CHANNEL_DEPARTMENT_REQUIRED");
      expect(again.calls).toHaveLength(0);
    }
    const refused = privateSql();
    expect(await failure(() => createChannel(retoucher, { kind: "private", name: "nhom", memberIds: [], department: "PRODUCTION" }))).toBe(
      "403 DEPARTMENT_FORBIDDEN"
    );
    expect(refused.calls).toHaveLength(0);
  });
});

describe("changing who can find a channel (PATCH /channels/:id)", () => {
  const updateSql = (current: Record<string, unknown>) =>
    fakeSql((call) => {
      if (call.text.includes("cm.id AS member_id")) return [channelRow(current)];
      if (call.text.startsWith("WITH added AS")) return [{ user_id: colleague, display_name: "Đồng nghiệp" }];
      if (call.text.includes("FROM public.channels c LEFT JOIN public.channel_members cm")) return [channelRow({ ...current, kind: "public" })];
      return chatAnswers(call);
    });

  it("private → public takes a department and adds its members", async () => {
    const { calls } = updateSql({ kind: "private", department: null });
    await updateChannel(retoucher, channelA, { kind: "public" });
    const update = calls.find((call) => call.text.startsWith("UPDATE public.channels SET name"))!;
    expect(update.values).toContain("PHOTO_RETOUCH");
    expect(calls.some((call) => call.text.startsWith("WITH added AS"))).toBe(true);
    const events = vi.mocked(publishToRooms).mock.calls.filter(([, name]) => name === "chat:channel");
    expect(events.map(([, , payload]) => (payload as { kind: string }).kind)).toEqual(["updated", "joined"]);
  });

  it("private → public by someone in several departments needs a choice", async () => {
    updateSql({ kind: "private", department: null });
    expect(await failure(() => updateChannel(both, channelA, { kind: "public" }))).toBe("400 CHANNEL_DEPARTMENT_REQUIRED");
    updateSql({ kind: "private", department: null });
    expect(await failure(() => updateChannel(retoucher, channelA, { kind: "public", department: "PRODUCTION" }))).toBe("403 DEPARTMENT_FORBIDDEN");
  });

  it("public → private keeps the department and the members (PD-054); a channel's department never changes", async () => {
    const { calls } = updateSql({ kind: "public", department: "PHOTO_RETOUCH" });
    await updateChannel(retoucher, channelA, { kind: "private" });
    const update = calls.find((call) => call.text.startsWith("UPDATE public.channels SET name"))!;
    expect(update.values).toContain("private");
    expect(update.values).toContain("PHOTO_RETOUCH");
    expect(calls.some((call) => call.text.startsWith("WITH added AS"))).toBe(false);
    // Nobody is removed; only non-members' inbox entries go.
    expect(calls.some((call) => call.text.startsWith("UPDATE public.channel_members cm SET deleted_at"))).toBe(false);
    expect(calls.some((call) => call.text.startsWith("DELETE FROM public.notifications n"))).toBe(true);

    const again = updateSql({ kind: "public", department: "PHOTO_RETOUCH" });
    await updateChannel(both, channelA, { kind: "public", department: "PRODUCTION" });
    // Nothing changed: nothing written.
    expect(again.calls.some((call) => call.text.startsWith("UPDATE public.channels SET name"))).toBe(false);

    const kept = updateSql({ kind: "private", department: "PHOTO_RETOUCH" });
    await updateChannel(both, channelA, { department: "PRODUCTION" });
    expect(kept.calls.some((call) => call.text.startsWith("UPDATE public.channels SET name"))).toBe(false);
  });

  it("private → public keeps an existing department (no choice needed) and adds its members", async () => {
    const { calls } = updateSql({ kind: "private", department: "PRODUCTION" });
    await updateChannel(both, channelA, { kind: "public" });
    const update = calls.find((call) => call.text.startsWith("UPDATE public.channels SET name"))!;
    expect(update.values).toContain("public");
    expect(update.values).toContain("PRODUCTION");
    const added = calls.find((call) => call.text.startsWith("WITH added AS"))!;
    expect(added.values).toContain("PRODUCTION");
    const messages = calls.filter((call) => call.text.startsWith("INSERT INTO public.messages"));
    expect(messages.map((call) => (call.values.find((value) => typeof value === "object" && value !== null && "type" in value) as { type: string }).type)).toEqual([
      "kind_changed",
      "members_added"
    ]);
    // A department asked for alongside is ignored: the channel already has one.
    const ignored = updateSql({ kind: "private", department: "PRODUCTION" });
    await updateChannel(both, channelA, { kind: "public", department: "PHOTO_RETOUCH" });
    expect(ignored.calls.find((call) => call.text.startsWith("UPDATE public.channels SET name"))!.values).not.toContain("PHOTO_RETOUCH");
  });

  it("a private channel without department (before PD-054) may be given one by its admin, adding nobody", async () => {
    const { calls } = updateSql({ kind: "private", department: null });
    await updateChannel(retoucher, channelA, { department: "PHOTO_RETOUCH" });
    const update = calls.find((call) => call.text.startsWith("UPDATE public.channels SET name"))!;
    expect(update.values).toContain("private");
    expect(update.values).toContain("PHOTO_RETOUCH");
    expect(calls.some((call) => call.text.startsWith("WITH added AS"))).toBe(false);

    updateSql({ kind: "private", department: null });
    expect(await failure(() => updateChannel(retoucher, channelA, { department: "PRODUCTION" }))).toBe("403 DEPARTMENT_FORBIDDEN");
    // Only channel admins decide where a channel is listed.
    updateSql({ kind: "private", department: null, role: "member" });
    expect(await failure(() => updateChannel(retoucher, channelA, { department: "PHOTO_RETOUCH" }))).toBe("403 FORBIDDEN");
  });
});

describe("browse and mention picker follow the department", () => {
  it("browse lists department channels of the caller's departments and channels without department", async () => {
    const { calls } = fakeSql();
    await browseChannels(retoucher, { includePrivate: false, limit: 20 });
    const query = calls[0]!;
    expect(query.text).toContain("(c.department IS NULL OR $ OR c.department = ANY($::text[]))");
    expect(query.values).toContainEqual(["PHOTO_RETOUCH"]);
    expect(query.values).toContain(false);
  });

  it("a department channel offers its members plus the department; no department = everyone", async () => {
    const picker = (department: string | null) =>
      fakeSql((call) => (call.text.includes("cm.id AS member_id") ? [channelRow({ department, access: null, role: null, member_id: null, notify_level: null })] : []));

    const { calls } = picker("PHOTO_RETOUCH");
    await searchDirectory(retoucher, { channelId: channelA, limit: 50 });
    const query = calls.at(-1)!;
    expect(query.text).toContain("public.channel_members cm");
    expect(query.text).toContain("OR public.is_department_member(om.organization_id, om.user_id, $::text)");
    expect(query.values).toContain("PHOTO_RETOUCH");

    const legacy = picker(null);
    await searchDirectory(retoucher, { channelId: channelA, limit: 50 });
    expect(legacy.calls.at(-1)!.text).not.toContain("channel_members");

    // Another department's channel stays hidden.
    picker("PRODUCTION");
    expect(await failure(() => searchDirectory(retoucher, { channelId: channelA, limit: 50 }))).toBe("404 CHANNEL_NOT_FOUND");
  });
});

describe("chat follows the department switcher (PD-054)", () => {
  it("browse narrows to the selected department (and channels without one)", async () => {
    const { calls } = fakeSql();
    await browseChannels(both, { includePrivate: false, limit: 20, department: "PRODUCTION" });
    const query = calls[0]!;
    expect(query.text).toContain("($::text IS NULL OR c.department IS NULL OR c.department = $::text)");
    expect(query.values.filter((value) => value === "PRODUCTION")).toHaveLength(2);

    // Without a department: every department of the caller, as before.
    const all = fakeSql();
    await browseChannels(both, { includePrivate: false, limit: 20 });
    expect(all.calls[0]!.values).not.toContain("PRODUCTION");
    expect(all.calls[0]!.values).toContainEqual(["PHOTO_RETOUCH", "PRODUCTION"]);
  });

  it("browse refuses a department the caller is not in: 403 DEPARTMENT_FORBIDDEN (the superadmin is in all)", async () => {
    const { calls } = fakeSql();
    expect(await failure(() => browseChannels(retoucher, { includePrivate: false, limit: 20, department: "PRODUCTION" }))).toBe(
      "403 DEPARTMENT_FORBIDDEN"
    );
    expect(calls).toHaveLength(0);
    fakeSql();
    expect(await failure(() => browseChannels(superadmin, { includePrivate: true, limit: 20, department: "PRODUCTION" }))).toBe("ok");
  });

  it("the sidebar keeps every conversation and says where each one is shown, in one query", async () => {
    const dm = id(54);
    const legacy = id(55);
    const { calls } = fakeSql((call) =>
      call.text.includes("FROM public.channel_members cm JOIN public.channels c")
        ? [
            channelRow({ id: channelA, department: "PHOTO_RETOUCH" }),
            channelRow({ id: channelB, kind: "private", department: "PRODUCTION" }),
            channelRow({ id: legacy, department: null }),
            channelRow({ id: dm, kind: "dm", name: null, department: null, audience_departments: ["PRODUCTION"] }),
            channelRow({ id: channelC, kind: "group_dm", name: null, department: null, audience_departments: null })
          ]
        : []
    );
    const result = await listMyChannels(retoucher);
    expect(calls).toHaveLength(1);
    const query = calls[0]!;
    expect(query.text).toContain("AS audience_departments");
    expect(query.text).toContain("FROM public.channel_members ap CROSS JOIN LATERAL");
    expect(query.text).toContain("ar.key = 'superadmin'");
    expect(query.values).toContainEqual(["PHOTO_RETOUCH", "PRODUCTION"]);
    // Never filtered by department: the switcher counts the other departments' unread from this list.
    expect(query.text).not.toMatch(/c\.department (=|IS|IN)/);

    expect(result.items.map((item) => [item.id, item.audienceDepartments])).toEqual([
      [channelA, ["PHOTO_RETOUCH"]],
      [channelB, ["PRODUCTION"]],
      [legacy, ["PHOTO_RETOUCH", "PRODUCTION"]],
      [dm, ["PRODUCTION"]],
      [channelC, ["PHOTO_RETOUCH", "PRODUCTION"]]
    ]);
    for (const item of result.items) {
      expect(ChatChannelSchema.parse(item)).toEqual(item);
    }
  });

  it("the channel detail carries it too, but realtime info payloads never do", async () => {
    fakeSql((call) =>
      call.text.includes("FROM public.channels c LEFT JOIN public.channel_members cm")
        ? [channelRow({ kind: "dm", name: null, department: null, audience_departments: ["PHOTO_RETOUCH", "PRODUCTION"], role: "member" })]
        : []
    );
    const detail = await getChannel(retoucher, channelA);
    expect(detail.audienceDepartments).toEqual(["PHOTO_RETOUCH", "PRODUCTION"]);
    expect(pickChannelInfo(detail)).not.toHaveProperty("audienceDepartments");
    expect(ChatChannelInfoSchema.parse(detail)).not.toHaveProperty("audienceDepartments");
  });

  it("a mention picker ignores the department (it follows the channel)", async () => {
    const { calls } = fakeSql((call) =>
      call.text.includes("cm.id AS member_id") ? [channelRow({ department: "PHOTO_RETOUCH", access: null, role: null, member_id: null, notify_level: null })] : []
    );
    expect(await failure(() => searchDirectory(retoucher, { channelId: channelA, department: "PRODUCTION", limit: 50 }))).toBe("ok");
    expect(calls.at(-1)!.values).not.toContain("PRODUCTION");
  });
});
