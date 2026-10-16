import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DomainEventEnvelope } from "../events/outbox.js";
import type { NotificationDraft } from "./notifications.service.js";

/**
 * PD-061 @all in chat: who gets `chat.mentioned` / `chat.thread_replied`, against a fake tagged-template `sql` (no
 * database). Obviously fake ids (the repository is public).
 */
type Call = { text: string; values: unknown[] };
type Fragment = { readonly isFragment: true; text: string; values: unknown[] };

const db = vi.hoisted(() => {
  const state = {
    calls: [] as Call[],
    handler: (() => []) as (call: Call) => unknown[] | undefined
  };
  const isFragment = (value: unknown): value is Fragment =>
    typeof value === "object" && value !== null && (value as { isFragment?: unknown }).isFragment === true;
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
        state.calls.push(call);
        try {
          resolve(state.handler(call) ?? []);
        } catch (error) {
          reject(error);
        }
      }
    };
  };
  return { state, sql: Object.assign(sql, { json: (value: unknown) => value }) };
});

const delivered = vi.hoisted(() => ({ drafts: [] as NotificationDraft[] }));

vi.mock("../../db/client.js", () => ({ getSql: () => db.sql }));
vi.mock("./notifications.service.js", () => ({
  deliverNotifications: vi.fn((draft: NotificationDraft) => {
    delivered.drafts.push(draft);
    return Promise.resolve(draft.recipientIds.length);
  }),
  refreshNotificationExcerpts: vi.fn(() => Promise.resolve()),
  removeNotificationsAbout: vi.fn(() => Promise.resolve())
}));

const { handleNotificationEvent } = await import("./notification-handlers.js");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const org = id(1);
const author = id(2);
const named = id(3);
const muted = id(4);
const mentionsOnly = id(5);
const plain = id(6);
const formerReplier = id(7);
const channelId = id(100);
const messageId = id(200);
const rootId = id(300);

type Level = "all" | "mentions" | "none";
const levels: Record<string, Level> = { [author]: "all", [named]: "all", [muted]: "none", [mentionsOnly]: "mentions", [plain]: "all" };
const members = Object.keys(levels);

const world = (input: { kind?: string; mentionsAll?: boolean; participants?: string[] }) => {
  db.state.handler = (call) => {
    if (call.text.startsWith("SELECT cm.user_id FROM public.channel_members cm JOIN public.channels c")) {
      return input.mentionsAll === false ? [] : members.map((user_id) => ({ user_id }));
    }
    if (call.text.startsWith("SELECT c.name, c.kind, m.body_text")) {
      return [{ name: "kenh-test", kind: input.kind ?? "private", text: "@all họp lúc 9h", threadRootId: null }];
    }
    if (call.text.startsWith("SELECT user_id, notify_level FROM public.channel_members")) {
      const ids = call.values.find(Array.isArray) as string[];
      return ids.filter((user) => levels[user]).map((user_id) => ({ user_id, notify_level: levels[user_id] }));
    }
    if (call.text.startsWith("SELECT om.user_id FROM public.organization_memberships om")) {
      return (call.values.find(Array.isArray) as string[]).map((user_id) => ({ user_id }));
    }
    if (call.text.startsWith("SELECT DISTINCT author_user_id FROM public.messages")) {
      return (input.participants ?? []).map((author_user_id) => ({ author_user_id }));
    }
    if (call.text.startsWith("SELECT body_text AS text")) {
      return [{ text: "@all họp lúc 9h", deleted: false }];
    }
    return [];
  };
};

const event = (type: string, payload: Record<string, unknown>): DomainEventEnvelope => ({
  id: "5001",
  type,
  organizationId: org,
  aggregateType: "message",
  aggregateId: messageId,
  actorUserId: author,
  payload: { channelId, channelKind: "private", messageId, authorId: author, threadRootId: null, seq: 9, ...payload },
  occurredAt: "2026-10-16T02:00:00.000Z"
});

const sent = (type: NotificationDraft["type"]) => delivered.drafts.filter((draft) => draft.type === type);
/** Who would get an entry: deliverNotifications itself never notifies the actor (the author). */
const reached = (type: NotificationDraft["type"]) =>
  sent(type).flatMap((draft) => draft.recipientIds.filter((user) => user !== draft.actorUserId));

beforeEach(() => {
  db.state.calls = [];
  delivered.drafts = [];
});

describe("chat.mentioned with @all (PD-061)", () => {
  it("reaches every member but the author, muted ones included; named people get the personal one; one each", async () => {
    world({});
    await handleNotificationEvent(event("chat.message.created", { mentionedUserIds: [named, muted], mentionsAll: true }));

    const mentions = sent("chat.mentioned");
    expect(mentions).toHaveLength(2);
    const [personal, all] = mentions;
    expect(personal).toMatchObject({ recipientIds: [named], payload: { channelKind: "private", threadRootId: null } });
    expect(personal?.payload).not.toHaveProperty("all");
    // The muted member was named too, but "none" filters the named one: they get the @all one instead.
    expect(all).toMatchObject({ recipientIds: [muted, mentionsOnly, plain], payload: { channelKind: "private", threadRootId: null, all: true } });
    expect(personal?.dedupeKey).toBe(all?.dedupeKey);
    const everyone = mentions.flatMap((draft) => draft.recipientIds);
    expect(new Set(everyone).size).toBe(everyone.length);
    expect(everyone).not.toContain(author);
  });

  it("asks only for a message that still mentions everyone, never in a 1:1 DM", async () => {
    world({ mentionsAll: false });
    await handleNotificationEvent(event("chat.message.created", { mentionedUserIds: [], mentionsAll: true }));
    const query = db.state.calls.find((call) => call.text.startsWith("SELECT cm.user_id FROM public.channel_members cm"));
    expect(query?.text).toContain("c.kind <> 'dm'");
    expect(query?.text).toContain("m.mentions_all");
    expect(sent("chat.mentioned")).toEqual([]);
  });

  it("without @all nothing changes: named mentions follow the notify levels", async () => {
    world({});
    await handleNotificationEvent(event("chat.message.created", { mentionedUserIds: [named, muted, mentionsOnly], mentionsAll: false }));
    expect(db.state.calls.some((call) => call.text.startsWith("SELECT cm.user_id FROM public.channel_members cm"))).toBe(false);
    expect(sent("chat.mentioned")).toEqual([expect.objectContaining({ recipientIds: [named, mentionsOnly] })]);
  });

  it("a thread reply with @all sends mentions, not also thread replies", async () => {
    world({ participants: [author, named, plain, formerReplier] });
    await handleNotificationEvent(event("chat.message.created", { threadRootId: rootId, seq: null, mentionedUserIds: [], mentionsAll: true }));
    expect(sent("chat.mentioned").flatMap((draft) => draft.recipientIds)).toEqual([named, muted, mentionsOnly, plain]);
    // Every participant who is still a member was reached by @all; the one who left is not a member any more.
    expect(reached("chat.thread_replied")).toEqual([]);

    delivered.drafts = [];
    await handleNotificationEvent(event("chat.message.created", { threadRootId: rootId, seq: null, mentionedUserIds: [], mentionsAll: false }));
    expect(reached("chat.thread_replied")).toEqual([named, plain]);
  });

  it("an edit that adds @all reaches the members the previous version did not mention", async () => {
    world({});
    await handleNotificationEvent(
      event("chat.message.updated", { addedMentionUserIds: [], mentionsAllAdded: true, previousMentionUserIds: [named] })
    );
    expect(sent("chat.mentioned")).toEqual([
      expect.objectContaining({ recipientIds: [muted, mentionsOnly, plain], payload: { channelKind: "private", threadRootId: null, all: true } })
    ]);

    delivered.drafts = [];
    await handleNotificationEvent(event("chat.message.updated", { addedMentionUserIds: [plain], mentionsAllAdded: false }));
    expect(sent("chat.mentioned")).toEqual([expect.objectContaining({ recipientIds: [plain] })]);
    expect(sent("chat.mentioned")[0]?.payload).not.toHaveProperty("all");
  });
});
