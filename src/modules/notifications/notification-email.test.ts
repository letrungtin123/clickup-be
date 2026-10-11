import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Producer side of notification e-mails: chat notifications are never queued (SPEC: CHAT_MESSAGE không email),
 * and the queueing statement itself only marks e-mailable types (defense in depth). No database: the tagged
 * template `sql` records statements.
 */
type Call = { text: string; values: unknown[] };

const db = vi.hoisted(() => {
  const state = { calls: [] as Call[], rows: [] as unknown[] };
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("$").replace(/\s+/g, " ").trim();
    state.calls.push({ text, values });
    return Promise.resolve(text.startsWith("UPDATE public.notifications") ? state.rows : []);
  };
  const fake = Object.assign(sql, {
    json: (value: unknown) => value,
    begin: <T>(fn: (tx: unknown) => Promise<T>) => fn(fake)
  });
  return { state, sql: fake };
});

vi.mock("../../db/client.js", () => ({ getSql: () => db.sql }));
vi.mock("../../lib/mailer.js", () => ({
  isEmailEnabled: () => true,
  describeMailer: () => "test",
  closeMailer: () => undefined,
  isPermanentMailError: () => false,
  sendMail: vi.fn()
}));

const { enqueueNotificationEmails } = await import("./notification-email.js");

const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const row = (id: string, type: string) => ({ id, recipient_user_id: user, type });

beforeEach(() => {
  db.state.calls = [];
  db.state.rows = [];
});

describe("enqueueNotificationEmails", () => {
  it("queues nothing for chat notifications (mentions, thread replies, channel adds)", async () => {
    const queued = await enqueueNotificationEmails(org, [
      row("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "chat.mentioned"),
      row("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "chat.thread_replied"),
      row("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "channel.member_added")
    ]);
    expect(queued).toBe(0);
    expect(db.state.calls).toHaveLength(0);
  });

  it("queues only the e-mailable rows of a mixed batch, and the SQL re-checks the type", async () => {
    db.state.rows = [{ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", recipient_user_id: user }];
    const queued = await enqueueNotificationEmails(org, [
      row("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "production.task_assigned"),
      row("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "chat.mentioned")
    ]);
    expect(queued).toBe(1);
    const update = db.state.calls.find((call) => call.text.startsWith("UPDATE public.notifications"))!;
    expect(update.values[0]).toEqual(["dddddddd-dddd-4ddd-8ddd-dddddddddddd"]);
    expect(update.text).toContain("n.type = ANY(");
    const types = update.values[1] as string[];
    expect(types).toContain("production.task_assigned");
    expect(types.some((type) => type.startsWith("chat.") || type.startsWith("channel."))).toBe(false);
    // The outbox event for the digest consumer is written in the same transaction.
    expect(db.state.calls.some((call) => call.text.startsWith("INSERT INTO public.outbox_events"))).toBe(true);
  });
});

describe("enqueueNotificationEmails — knowledge base (PD-031)", () => {
  it("queues @mentions and critical new versions, never other knowledge notices", async () => {
    db.state.rows = [{ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", recipient_user_id: user }];
    const queued = await enqueueNotificationEmails(org, [
      { ...row("ffffffff-ffff-4fff-8fff-ffffffffffff", "knowledge.updated"), payload: { criticalVersion: true } },
      { ...row("12121212-1212-4121-8121-121212121212", "knowledge.updated"), payload: { broadcast: true } },
      row("13131313-1313-4131-8131-131313131313", "knowledge.commented"),
      row("14141414-1414-4141-8141-141414141414", "knowledge.mentioned")
    ]);
    expect(queued).toBe(1);
    const update = db.state.calls.find((call) => call.text.startsWith("UPDATE public.notifications"))!;
    expect(update.values[0]).toEqual(["ffffffff-ffff-4fff-8fff-ffffffffffff", "14141414-1414-4141-8141-141414141414"]);
    // The statement re-checks the type, or the critical-version payload of knowledge.updated.
    expect(update.text).toContain("n.payload @>");
    expect(update.values).toContain("knowledge.updated");
    expect(update.values).toContain(JSON.stringify({ criticalVersion: true }));
    expect(update.values[1] as string[]).not.toContain("knowledge.updated");
  });
});
