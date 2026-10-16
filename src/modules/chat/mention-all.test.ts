import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChannelKind } from "../../contracts/chat.js";
import type * as DbClientModule from "../../db/client.js";
import type * as PublisherModule from "../../realtime/publisher.js";
import type { AccessContext } from "../access/access-context.js";
import type { DomainEventInput } from "../events/outbox.js";
import type * as ChatAccessModule from "./chat-access.js";
import type * as ChatRepoModule from "./chat.repo.js";

/**
 * PD-061 @all, send / edit (no database): which mention rows a message writes and what its events carry. A fake
 * tagged-template `sql` records each statement and answers it. Obviously fake ids (the repository is public).
 */
type Call = { text: string; values: unknown[] };
type Fragment = { readonly isFragment: true; text: string; values: unknown[] };

const state = vi.hoisted((): { sql: unknown; kind: string; events: DomainEventInput[]; mentionsAllAfter: boolean | undefined } => ({
  sql: undefined,
  kind: "private",
  events: [],
  mentionsAllAfter: undefined
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
vi.mock("./chat-rate-limit.js", () => ({ consumeChatQuota: vi.fn(() => Promise.resolve()) }));
vi.mock("../events/outbox.js", () => ({
  enqueueDomainEvents: vi.fn((_tx: unknown, events: DomainEventInput[]) => {
    state.events.push(...events);
    return Promise.resolve();
  })
}));
vi.mock("./chat-access.js", async (importOriginal) => {
  const original = await importOriginal<typeof ChatAccessModule>();
  const resolved = () => ({
    channel: { id: channelId, kind: state.kind, department: null, last_message_seq: "8" },
    member: { id: id(900), access: "submit", role: "member", notifyLevel: "all", lastReadSeq: 8 },
    caps: { canRead: true, canPost: true }
  });
  return {
    ...original,
    requireChannel: vi.fn(() => Promise.resolve(resolved())),
    loadChannel: vi.fn(() => Promise.resolve(resolved())),
    assertCanPost: vi.fn()
  };
});
vi.mock("./chat.repo.js", async (importOriginal) => ({
  ...(await importOriginal<typeof ChatRepoModule>()),
  selectMessageById: vi.fn((_sql: unknown, _context: unknown, messageId: string) =>
    Promise.resolve({ id: messageId, channelId, body: null, text: "", mentions: [], mentionsAll: state.mentionsAllAfter ?? false })
  )
}));

const { sendMessage, editMessage } = await import("./messages.service.js");
const { publishToRoom } = await import("../../realtime/publisher.js");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const org = id(1);
const me = id(2);
const named = id(3);
const other = id(4);
const muted = id(5);
const channelId = id(100);
const messageId = id(200);
const members = [me, named, other, muted];

const context = {
  user: { id: me, email: null, displayName: "Người gửi" },
  organization: { id: org, slug: "test-org", name: "Test org" },
  role: { id: id(9), organizationId: org, key: "member", name: "Role", permissions: [] },
  hasFullOrganizationAuthority: false,
  mustChangePassword: false,
  productionRoles: [],
  departments: ["PHOTO_RETOUCH"],
  canSwitchDepartment: false
} as unknown as AccessContext;

type Previous = { mentionedUserIds: string[]; mentionsAll: boolean; rows: string[] };

const fakeSql = (previous: Previous = { mentionedUserIds: [], mentionsAll: false, rows: [] }) => {
  const calls: Call[] = [];
  const isFragment = (value: unknown): value is Fragment =>
    typeof value === "object" && value !== null && (value as { isFragment?: unknown }).isFragment === true;
  const answer = (call: Call): unknown[] => {
    const ids = (call.values.find(Array.isArray) ?? []) as string[];
    if (call.text.startsWith("SELECT au.id, au.display_name FROM public.organization_memberships")) {
      return ids.map((user) => ({ id: user, display_name: `Người ${user.slice(-1)}` }));
    }
    if (call.text.startsWith("UPDATE public.channels SET last_message_seq")) {
      return [{ last_message_seq: "9" }];
    }
    if (call.text.startsWith("SELECT user_id FROM public.organization_memberships")) {
      return ids.filter((user) => members.includes(user)).map((user_id) => ({ user_id }));
    }
    if (call.text.startsWith("SELECT user_id FROM public.channel_members")) {
      return ids.filter((user) => members.includes(user)).map((user_id) => ({ user_id }));
    }
    if (call.text.startsWith("SELECT cm.user_id FROM public.channel_members cm JOIN public.organization_memberships")) {
      return members.map((user_id) => ({ user_id }));
    }
    if (call.text.startsWith("SELECT id, channel_id, author_user_id, kind")) {
      return [
        {
          id: messageId,
          channel_id: channelId,
          author_user_id: me,
          kind: "user",
          thread_root_id: null,
          seq: "7",
          attachment_count: 0,
          mentioned_user_ids: previous.mentionedUserIds,
          mentions_all: previous.mentionsAll,
          deleted_at: null
        }
      ];
    }
    if (call.text.startsWith("SELECT user_id FROM public.message_mentions")) {
      return previous.rows.map((user_id) => ({ user_id }));
    }
    if (call.text.startsWith("UPDATE public.messages SET body_json")) {
      return [{ edited_at: new Date("2026-10-16T03:00:00Z") }];
    }
    return [];
  };
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
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
          resolve(answer(call));
        } catch (error) {
          reject(error);
        }
      }
    };
  };
  const fake = Object.assign(sql, {
    json: (value: unknown) => value,
    begin: <T>(fn: (tx: unknown) => Promise<T>) => fn(fake)
  });
  state.sql = fake;
  const find = (prefix: string) => calls.filter((call) => call.text.startsWith(prefix));
  return {
    calls,
    /** user ids of the message_mentions INSERT (last value: unnest array). */
    mentionRows: () => find("INSERT INTO public.message_mentions").map((call) => call.values.at(-1) as string[]),
    find
  };
};

const allNode = { type: "mention", attrs: { id: "all", label: "all" } };
const namedNode = { type: "mention", attrs: { id: named, label: "x" } };
const doc = (...content: unknown[]) => ({ type: "doc", content: [{ type: "paragraph", content }] });

const send = (body: unknown) => sendMessage(context, channelId, { body: body as never, clientMessageId: id(700), attachmentIds: [] });

afterEach(() => {
  state.sql = undefined;
  state.kind = "private";
  state.events = [];
  state.mentionsAllAfter = undefined;
  vi.clearAllMocks();
});


describe("sending @all (PD-061)", () => {
  for (const kind of ["public", "private", "group_dm"] satisfies ChannelKind[]) {
    it(`${kind}: stores mentions_all and a mention row for every member but the author (named people once)`, async () => {
      state.kind = kind;
      const db = fakeSql();
      await send(doc(allNode, { type: "text", text: " họp " }, namedNode));

      const insert = db.find("INSERT INTO public.messages")[0]!;
      expect(insert.text).toContain("mentioned_user_ids, mentions_all, attachment_count");
      // body, text, client id, mentioned_user_ids, mentions_all, attachment_count
      expect(insert.values.slice(6)).toEqual([
        doc({ type: "mention", attrs: { id: "all", label: "all" } }, { type: "text", text: " họp " }, { type: "mention", attrs: { id: named, label: "Người 3" } }),
        "@all họp @Người 3",
        id(700),
        [named],
        true,
        0
      ]);
      expect(db.mentionRows()).toEqual([[named, other, muted]]);
      expect(state.events[0]?.payload).toMatchObject({ mentionedUserIds: [named], mentionsAll: true });
    });
  }

  it("1:1 DM: @all is plain text, no error, no rows for anyone", async () => {
    state.kind = "dm";
    const db = fakeSql();
    await send(doc(allNode, { type: "text", text: " ơi" }));

    const insert = db.find("INSERT INTO public.messages")[0]!;
    expect(insert.values.slice(6, 11)).toEqual([doc({ type: "text", text: "@all" }, { type: "text", text: " ơi" }), "@all ơi", id(700), [], false]);
    expect(db.find("SELECT cm.user_id FROM public.channel_members cm")).toEqual([]);
    expect(db.mentionRows()).toEqual([]);
    expect(state.events[0]?.payload).toMatchObject({ mentionedUserIds: [], mentionsAll: false });
  });

  it("without @all only the named people get rows (unchanged)", async () => {
    const db = fakeSql();
    await send(doc(namedNode));
    expect(db.find("SELECT cm.user_id FROM public.channel_members cm")).toEqual([]);
    expect(db.mentionRows()).toEqual([[named]]);
    expect(state.events[0]?.payload).toMatchObject({ mentionedUserIds: [named], mentionsAll: false });
  });
});

describe("editing @all (PD-061)", () => {
  it("removing @all removes the members' rows and keeps the named ones", async () => {
    state.mentionsAllAfter = false;
    const db = fakeSql({ mentionedUserIds: [named], mentionsAll: true, rows: [named, other, muted] });
    await editMessage(context, messageId, doc(namedNode));

    expect(db.find("UPDATE public.messages SET body_json")[0]?.values.slice(2, 4)).toEqual([[named], false]);
    expect(db.find("DELETE FROM public.message_mentions")[0]?.values.at(-1)).toEqual([named]);
    expect(db.mentionRows()).toEqual([[named]]);
    expect(state.events[0]?.payload).toMatchObject({ addedMentionUserIds: [], mentionsAllAdded: false });
    expect(state.events[0]?.payload).not.toHaveProperty("previousMentionUserIds");
    expect(publishToRoom).toHaveBeenCalledWith(
      expect.anything(),
      "chat:message:updated",
      expect.objectContaining({ messageId, mentions: [named], mentionsAll: false })
    );
  });

  it("adding @all adds a row for every member and tells the handler who was already mentioned", async () => {
    state.mentionsAllAfter = true;
    const db = fakeSql({ mentionedUserIds: [named], mentionsAll: false, rows: [named] });
    await editMessage(context, messageId, doc(namedNode, allNode));

    expect(db.find("UPDATE public.messages SET body_json")[0]?.values.slice(2, 4)).toEqual([[named], true]);
    expect(db.mentionRows()).toEqual([[named, other, muted]]);
    expect(state.events[0]?.payload).toMatchObject({ addedMentionUserIds: [], mentionsAllAdded: true, previousMentionUserIds: [named] });
    expect(publishToRoom).toHaveBeenCalledWith(expect.anything(), "chat:message:updated", expect.objectContaining({ mentionsAll: true }));
  });

  it("someone reached by @all and now also named is not mentioned anew", async () => {
    state.mentionsAllAfter = true;
    fakeSql({ mentionedUserIds: [], mentionsAll: true, rows: [named, other, muted] });
    await editMessage(context, messageId, doc(allNode, namedNode));
    expect(state.events[0]?.payload).toMatchObject({ addedMentionUserIds: [], mentionsAllAdded: false });
  });

  it("1:1 DM: an edit with @all keeps it as text", async () => {
    state.kind = "dm";
    const db = fakeSql();
    await editMessage(context, messageId, doc(allNode));
    expect(db.find("UPDATE public.messages SET body_json")[0]?.values.slice(0, 4)).toEqual([doc({ type: "text", text: "@all" }), "@all", [], false]);
    expect(db.mentionRows()).toEqual([]);
  });
});
