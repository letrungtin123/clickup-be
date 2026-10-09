import { describe, expect, it } from "vitest";

import { AppError } from "../../lib/app-error.js";
import { issueSocketTicket, verifySocketTicket } from "./socket-ticket.js";

const session = {
  id: "3f0c1d9e-8a4b-4c2d-9e1f-2a3b4c5d6e7f",
  email: "minh.dev@nesso.test",
  permissions: [],
  sessionId: "4a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  issuedAt: Math.floor(Date.now() / 1000)
};

describe("socket re-auth tickets (PERF-02)", () => {
  it("binds the ticket to the user, the auth session and the new token expiry", async () => {
    const { ticket, expiresAt } = await issueSocketTicket(session);
    expect(expiresAt).toBe(session.expiresAt);
    await expect(verifySocketTicket(ticket)).resolves.toEqual({
      userId: session.id,
      sessionId: session.sessionId,
      tokenExpiresAt: session.expiresAt,
      tokenIssuedAt: session.issuedAt
    });
  });

  it("rejects tampered tickets and arbitrary JWTs", async () => {
    const { ticket } = await issueSocketTicket(session);
    const [header, payload, signature] = ticket.split(".");
    const tampered = `${header}.${payload}.${signature?.slice(0, -2)}xx`;
    await expect(verifySocketTicket(tampered)).rejects.toBeInstanceOf(AppError);
    await expect(verifySocketTicket("not-a-ticket-at-all")).rejects.toBeInstanceOf(AppError);
    await expect(verifySocketTicket(42)).rejects.toBeInstanceOf(AppError);
  });
});
