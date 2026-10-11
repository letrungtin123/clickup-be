import { describe, expect, it } from "vitest";

import { emailConfigured, isDeliverableAddress, isPermanentMailError, PermanentMailError, toSubjectLine } from "../../lib/mailer.js";
import { notificationTypes } from "../../contracts/notifications.js";
import {
  conditionalEmailType,
  createMemoryWindowStore,
  digestWindowKey,
  emailableNotificationTypes,
  isEmailableNotification,
  isEmailableNotificationType,
  recipientSkipReason
} from "./email-policy.js";

describe("emailConfigured", () => {
  it("is on only when both SMTP_HOST and SMTP_FROM are set", () => {
    expect(emailConfigured({})).toBe(false);
    expect(emailConfigured({ SMTP_HOST: "smtp.gmail.com" })).toBe(false);
    expect(emailConfigured({ SMTP_FROM: "Nesso Work <no-reply@example.com>" })).toBe(false);
    expect(emailConfigured({ SMTP_HOST: "smtp.gmail.com", SMTP_FROM: "Nesso Work <no-reply@example.com>" })).toBe(true);
    expect(emailConfigured({ SMTP_HOST: "log", SMTP_FROM: "dev@example.com" })).toBe(true);
  });
});

describe("digest window (one e-mail per user per window)", () => {
  it("lets one digest through per window and reopens after the TTL", async () => {
    let now = 0;
    const store = createMemoryWindowStore(() => now);
    const key = digestWindowKey("user-1");
    expect(await store.claim(key, 300)).toBe(true);
    expect(await store.claim(key, 300)).toBe(false);
    expect(await store.claim(digestWindowKey("user-2"), 300)).toBe(true);
    now = 299_000;
    expect(await store.claim(key, 300)).toBe(false);
    now = 300_000;
    expect(await store.claim(key, 300)).toBe(true);
  });

  it("reopens immediately when a failed send gives the window back", async () => {
    const store = createMemoryWindowStore(() => 0);
    const key = digestWindowKey("user-1");
    expect(await store.claim(key, 300)).toBe(true);
    await store.release(key);
    expect(await store.claim(key, 300)).toBe(true);
  });
});

describe("recipientSkipReason", () => {
  const recipient = { email: "an@example.com", notify_email: true, deleted_at: null };

  it("sends to active, opted-in users with an address", () => {
    expect(recipientSkipReason(recipient)).toBeNull();
  });

  it("skips missing, deactivated, opted-out and address-less users", () => {
    expect(recipientSkipReason(undefined)).toBe("not_found");
    expect(recipientSkipReason({ ...recipient, deleted_at: new Date() })).toBe("inactive");
    expect(recipientSkipReason({ ...recipient, notify_email: false })).toBe("opted_out");
    expect(recipientSkipReason({ ...recipient, email: null })).toBe("no_address");
    expect(recipientSkipReason({ ...recipient, email: "  " })).toBe("no_address");
  });
});

describe("SMTP error classification", () => {
  it("treats rejected recipients and refused messages as permanent", () => {
    expect(isPermanentMailError(new PermanentMailError("bad", "EADDRESS"))).toBe(true);
    expect(isPermanentMailError({ code: "EENVELOPE", command: "RCPT TO", responseCode: 550 })).toBe(true);
    expect(isPermanentMailError({ code: "EMESSAGE" })).toBe(true);
  });

  it("retries connection, auth, greylisting and sender problems", () => {
    expect(isPermanentMailError({ code: "ECONNECTION" })).toBe(false);
    expect(isPermanentMailError({ code: "ETIMEDOUT" })).toBe(false);
    expect(isPermanentMailError({ code: "EAUTH", responseCode: 535 })).toBe(false);
    expect(isPermanentMailError({ code: "EENVELOPE", command: "RCPT TO", responseCode: 451 })).toBe(false);
    expect(isPermanentMailError({ code: "EENVELOPE", command: "MAIL FROM", responseCode: 553 })).toBe(false);
    expect(isPermanentMailError(new Error("boom"))).toBe(false);
    expect(isPermanentMailError(null)).toBe(false);
  });
});

describe("mail helpers", () => {
  it("validates recipient addresses", () => {
    expect(isDeliverableAddress("an.nguyen+qc@example.com.vn")).toBe(true);
    expect(isDeliverableAddress("not-an-address")).toBe(false);
    expect(isDeliverableAddress("a@b.c\r\nBcc: x@y.z")).toBe(false);
  });

  it("keeps subjects on one bounded line", () => {
    expect(toSubjectLine("Xin chào\r\nBcc: x@y.z")).toBe("Xin chào Bcc: x@y.z");
    expect(toSubjectLine("x".repeat(300))).toHaveLength(200);
  });
});

describe("which notification types may be e-mailed (SPEC: chat never e-mails)", () => {
  it("never e-mails chat: messages / @mentions / thread replies / added to a channel", () => {
    for (const type of ["chat.mentioned", "chat.thread_replied", "channel.member_added", "chat.message"]) {
      expect(isEmailableNotificationType(type)).toBe(false);
    }
  });

  it("never e-mails system alerts (an SMTP failure must not feed its own alert)", () => {
    expect(isEmailableNotificationType("system.dead_letter")).toBe(false);
  });

  it("e-mails every production event of PLAN §8 and the task workspace events", () => {
    for (const type of [
      "production.task_assigned",
      "production.task_waiting_qc",
      "production.qc_failed",
      "production.task_checked",
      "production.task_late",
      "production.task_due_soon",
      "production.feedback",
      "production.qty_changed",
      "production.kpi_settled",
      "production.commented",
      "production.mentioned",
      "production.leave_requested",
      "production.leave_decided",
      "production.leader_removed",
      "task.assigned",
      "task.mentioned",
      "task.commented",
      "project.member_added"
    ]) {
      expect(isEmailableNotificationType(type)).toBe(true);
    }
  });

  it("is a subset of the notification types; unknown types are not e-mailed", () => {
    expect(emailableNotificationTypes.every((type) => (notificationTypes as readonly string[]).includes(type))).toBe(true);
    expect(emailableNotificationTypes.some((type) => type.startsWith("chat.") || type.startsWith("channel."))).toBe(false);
    expect(isEmailableNotificationType("something.new")).toBe(false);
  });
});

describe("knowledge base e-mails (PD-031: only @mentions and new versions of critical items)", () => {
  it("e-mails knowledge @mentions", () => {
    expect(isEmailableNotificationType("knowledge.mentioned")).toBe(true);
    expect(isEmailableNotification({ type: "knowledge.mentioned", payload: {} })).toBe(true);
  });

  it("keeps comments, replies, status changes and approval requests in the app", () => {
    for (const type of ["knowledge.commented", "knowledge.replied", "knowledge.status_changed", "knowledge.approval_requested"]) {
      expect(isEmailableNotificationType(type)).toBe(false);
      expect(isEmailableNotification({ type, payload: { criticalVersion: true } })).toBe(false);
    }
  });

  it("e-mails knowledge.updated only for a new version of a critical item", () => {
    expect(isEmailableNotificationType("knowledge.updated")).toBe(false);
    expect(isEmailableNotification({ type: "knowledge.updated", payload: { criticalVersion: true } })).toBe(true);
    expect(isEmailableNotification({ type: "knowledge.updated", payload: { criticalVersion: false, broadcast: true } })).toBe(false);
    expect(isEmailableNotification({ type: "knowledge.updated" })).toBe(false);
    expect(conditionalEmailType).toBe("knowledge.updated");
  });
});
