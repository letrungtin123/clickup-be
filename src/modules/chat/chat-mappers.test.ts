import { describe, expect, it } from "vitest";

import { ReactionSummarySchema, chatLimits } from "../../contracts/chat.js";
import type { QuerySql } from "../../lib/db-types.js";
import {
  groupReactionRows,
  reactorsAggSql,
  toMessage,
  toReactionSummary,
  toReactors,
  type MessageRow,
  type ReactionUserRow
} from "./chat-mappers.js";

// Obviously fake ids and names (the repository is public).
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const reactor = (n: number) => ({ id: id(n), display_name: `Người ${n}`, avatar_url: n % 2 === 0 ? `https://example.test/a${n}.png` : null });
const row = (emoji: string, n: number): ReactionUserRow => ({
  emoji,
  user_id: id(n),
  display_name: `Người ${n}`,
  avatar_url: null
});

describe("reactors (who reacted)", () => {
  it("keeps the reaction order, drops duplicates and blanks, never carries e-mails", () => {
    const users = toReactors([reactor(3), null, reactor(1), reactor(3), undefined, reactor(2)]);
    expect(users.map((user) => user.id)).toEqual([id(3), id(1), id(2)]);
    expect(users[0]).toEqual({ id: id(3), displayName: "Người 3", email: null, avatarUrl: null });
    expect(users[2]?.avatarUrl).toBe("https://example.test/a2.png");
    expect(toReactors(null)).toEqual([]);
  });

  it("caps the list at the preview size (oldest first) while the count stays the total", () => {
    const many = Array.from({ length: 35 }, (_, index) => reactor(index + 1));
    const summary = toReactionSummary({ emoji: "👍", count: 35, reacted_by_me: true, users: many });
    expect(summary.count).toBe(35);
    expect(summary.users).toHaveLength(chatLimits.reactionUsersPreview);
    expect(summary.users[0]?.id).toBe(id(1));
    expect(summary.users.at(-1)?.id).toBe(id(chatLimits.reactionUsersPreview));
    expect(ReactionSummarySchema.parse(summary)).toEqual(summary);
  });

  it("older payloads without users still parse (users default to [])", () => {
    expect(toReactionSummary({ emoji: "🎉", count: 2, reacted_by_me: false })).toEqual({
      emoji: "🎉",
      count: 2,
      reactedByMe: false,
      users: []
    });
    expect(ReactionSummarySchema.parse({ emoji: "🎉", count: 1, reactedByMe: false }).users).toEqual([]);
  });

  it("groups loaded rows by emoji in first-reaction order with totals, my flag and capped people", () => {
    const rows = [row("👍", 1), row("👍", 2), row("❤️", 3), row("👍", 4), row("❤️", 1)];
    const summaries = groupReactionRows(rows, id(1), 2);
    expect(summaries.map((summary) => [summary.emoji, summary.count, summary.reactedByMe])).toEqual([
      ["👍", 3, true],
      ["❤️", 2, true]
    ]);
    expect(summaries[0]?.users.map((user) => user.id)).toEqual([id(1), id(2)]);
    expect(groupReactionRows(rows, id(9), Number.POSITIVE_INFINITY)[0]).toMatchObject({ count: 3, reactedByMe: false });
    expect(groupReactionRows(rows, id(9), Number.POSITIVE_INFINITY)[0]?.users).toHaveLength(3);
    expect(groupReactionRows([], id(1))).toEqual([]);
  });

  it("aggregates in SQL with the cap as a parameter (one statement, no query per message)", () => {
    const fake = ((strings: TemplateStringsArray, ...values: unknown[]) => ({ text: strings.join("$"), values })) as unknown as QuerySql;
    const fragment = reactorsAggSql(fake, 7) as unknown as { text: string; values: unknown[] };
    expect(fragment.values).toEqual([7]);
    expect(fragment.text).toContain("ORDER BY mr.created_at, mr.user_id");
    expect(fragment.text).toContain("FILTER (WHERE au.id IS NOT NULL)");
    expect(fragment.text).toContain("[1:$::int]");
    expect(fragment.text).not.toContain("email");
  });

  it("maps message rows: reactions with their people, none on deleted messages", () => {
    const base: MessageRow = {
      id: id(100),
      channel_id: id(200),
      seq: 3,
      thread_root_id: null,
      kind: "user",
      body_json: null,
      body_text: "xin chào",
      system_event: null,
      client_message_id: null,
      mentioned_user_ids: [],
      mentions_all: false,
      reply_count: 0,
      last_reply_at: null,
      edited_at: null,
      deleted_at: null,
      created_at: new Date("2026-10-15T01:00:00Z"),
      author: null,
      reactions: [{ emoji: "👍", count: 2, reacted_by_me: false, users: [reactor(5), reactor(6)] }],
      attachments: []
    };
    expect(toMessage(base).reactions).toEqual([
      {
        emoji: "👍",
        count: 2,
        reactedByMe: false,
        users: [
          { id: id(5), displayName: "Người 5", email: null, avatarUrl: null },
          { id: id(6), displayName: "Người 6", email: null, avatarUrl: "https://example.test/a6.png" }
        ]
      }
    ]);
    expect(toMessage({ ...base, deleted_at: new Date("2026-10-15T02:00:00Z") }).reactions).toEqual([]);
  });

  it("maps @all (PD-061): mentionsAll from the column, false once deleted", () => {
    const base: MessageRow = {
      id: id(100),
      channel_id: id(200),
      seq: 3,
      thread_root_id: null,
      kind: "user",
      body_json: null,
      body_text: "@all họp lúc 9h",
      system_event: null,
      client_message_id: null,
      mentioned_user_ids: [id(5)],
      mentions_all: true,
      reply_count: 0,
      last_reply_at: null,
      edited_at: null,
      deleted_at: null,
      created_at: new Date("2026-10-15T01:00:00Z"),
      author: null,
      reactions: [],
      attachments: []
    };
    expect(toMessage(base)).toMatchObject({ mentions: [id(5)], mentionsAll: true });
    expect(toMessage({ ...base, mentions_all: false }).mentionsAll).toBe(false);
    expect(toMessage({ ...base, deleted_at: new Date("2026-10-15T02:00:00Z") })).toMatchObject({ mentions: [], mentionsAll: false });
  });
});
