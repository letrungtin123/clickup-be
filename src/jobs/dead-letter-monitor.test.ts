import { describe, expect, it, vi } from "vitest";

import { getDeadLetterCounts, reportUnroutedEvent } from "../lib/amqp.js";
import { deadLetterAlertKey, parkedQueues, runDeadLetterCheck } from "./dead-letter-monitor.js";

describe("dead-letter monitor", () => {
  it("only non-empty, readable parking queues are alerts", () => {
    expect(parkedQueues({ "nesso.notifications.dead": 0, "nesso.email.dead": 3, "x.dead": null })).toEqual([{ queue: "nesso.email.dead", count: 3 }]);
  });

  it("one alert key per queue and UTC hour (rate limit through the notification dedupe key)", () => {
    const at = new Date("2026-10-11T08:05:00Z");
    expect(deadLetterAlertKey("nesso.email.dead", at)).toBe("dlq:nesso.email.dead:2026-10-11T08");
    expect(deadLetterAlertKey("nesso.email.dead", new Date("2026-10-11T08:59:59Z"))).toBe(deadLetterAlertKey("nesso.email.dead", at));
    expect(deadLetterAlertKey("nesso.email.dead", new Date("2026-10-11T09:00:00Z"))).not.toBe(deadLetterAlertKey("nesso.email.dead", at));
    expect(deadLetterAlertKey("nesso.notifications.dead", at)).not.toBe(deadLetterAlertKey("nesso.email.dead", at));
  });

  it("a check notifies once per parked queue and survives a failing notification", async () => {
    const now = new Date("2026-10-11T08:05:00Z");
    const notify = vi.fn((queue: string) => (queue === "a.dead" ? Promise.reject(new Error("db down")) : Promise.resolve(2)));
    const counts = await runDeadLetterCheck({
      counts: () => Promise.resolve({ "a.dead": 1, "b.dead": 4, "c.dead": 0, "d.dead": null }),
      notify,
      now: () => now
    });
    expect(counts["b.dead"]).toBe(4);
    expect(notify.mock.calls).toEqual([
      ["a.dead", 1, now],
      ["b.dead", 4, now]
    ]);
  });

  it("reads parking-queue depths passively; a missing queue counts as null and its channel error is absorbed", async () => {
    const closed: string[] = [];
    const model = {
      createChannel: () => {
        let checked = "";
        return Promise.resolve({
          on: vi.fn(),
          checkQueue: (queue: string) => {
            checked = queue;
            return queue === "nesso.email.dead" ? Promise.reject(new Error("NOT_FOUND")) : Promise.resolve({ queue, messageCount: 7, consumerCount: 0 });
          },
          close: () => {
            closed.push(checked);
            return checked === "nesso.email.dead" ? Promise.reject(new Error("Channel closed")) : Promise.resolve();
          }
        });
      }
    };
    expect(await getDeadLetterCounts(model as never)).toEqual({ "nesso.notifications.dead": 7, "nesso.email.dead": null });
    expect(closed).toEqual(["nesso.notifications.dead", "nesso.email.dead"]);
  });
});

describe("unrouted outbox events", () => {
  it("are reported once per event type", () => {
    expect(reportUnroutedEvent("test.nobody_listens")).toBe(true);
    expect(reportUnroutedEvent("test.nobody_listens")).toBe(false);
    expect(reportUnroutedEvent("test.other_type")).toBe(true);
  });
});
