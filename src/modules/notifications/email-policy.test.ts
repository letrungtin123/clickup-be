import { describe, expect, it } from "vitest";

import { emailConfigured, isDeliverableAddress, isPermanentMailError, PermanentMailError, toSubjectLine } from "../../lib/mailer.js";
import { createMemoryWindowStore, digestWindowKey, recipientSkipReason } from "./email-policy.js";

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
