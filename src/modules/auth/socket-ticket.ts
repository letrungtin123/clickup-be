import { createHmac, randomBytes } from "node:crypto";

import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";

import { env } from "../../config/env.js";
import { AppError } from "../../lib/app-error.js";
import type { VerifiedSession } from "./supabase-auth.service.js";

/**
 * Socket re-authentication tickets (PERF-02). Browsers hold the access token only in an HttpOnly cookie,
 * which a WebSocket that is already open never sends again. After refreshing the session the SPA asks
 * POST /auth/socket-ticket (cookie-authenticated) for a short-lived ticket and hands it to its socket
 * (`session:refresh`); the gateway extends the socket's session instead of disconnecting it at expiry.
 *
 * A ticket is useless as an access token: it is signed with a key derived for this purpose only, has its own
 * audience, lives 60 seconds and is bound to the user and the auth session.
 */
const audience = "nesso-socket-reauth";
const ticketTtlSeconds = 60;

const deriveKey = () => {
  const secret = env.SUPABASE_JWT_SECRET ?? env.SUPABASE_SERVICE_ROLE_KEY;
  // Without configured secrets (local dev only) tickets work within this one process.
  const material = secret ?? randomBytes(32).toString("hex");
  return new Uint8Array(createHmac("sha256", material).update("nesso:socket-reauth:v1").digest());
};
const key = deriveKey();

const TicketClaimsSchema = z.object({
  sub: z.string().uuid(),
  sid: z.string().uuid().nullable(),
  /** Access-token expiry (seconds) the socket may live until. */
  tex: z.number().int(),
  /** Access-token issue time, checked against user-wide revocations. */
  tia: z.number().int().nullable()
});

export type SocketTicketClaims = { userId: string; sessionId: string | null; tokenExpiresAt: number; tokenIssuedAt: number | null };

export const issueSocketTicket = async (session: VerifiedSession) => {
  const now = Math.floor(Date.now() / 1000);
  const ticket = await new SignJWT({ sid: session.sessionId, tex: session.expiresAt, tia: session.issuedAt })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.id)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(now + ticketTtlSeconds)
    .sign(key);
  return { ticket, expiresAt: session.expiresAt };
};

export const verifySocketTicket = async (ticket: unknown): Promise<SocketTicketClaims> => {
  if (typeof ticket !== "string" || ticket.length < 16 || ticket.length > 4000) {
    throw new AppError("INVALID_TICKET", "Phiên kết nối không hợp lệ.", 401);
  }
  try {
    const { payload } = await jwtVerify(ticket, key, { algorithms: ["HS256"], audience });
    const claims = TicketClaimsSchema.parse(payload);
    return { userId: claims.sub, sessionId: claims.sid, tokenExpiresAt: claims.tex, tokenIssuedAt: claims.tia };
  } catch {
    throw new AppError("INVALID_TICKET", "Phiên kết nối không hợp lệ.", 401);
  }
};
