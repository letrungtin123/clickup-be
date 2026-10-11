import { Router, type Router as ExpressRouter } from "express";

import {
  AuthSessionSchema,
  LoginRequestSchema,
  LogoutResponseSchema,
  SocketTicketSchema
} from "../../contracts/schemas.js";
import { resolveAccessContext } from "../access/access-context.js";
import { issueSocketTicket } from "./socket-ticket.js";
import { AppError } from "../../lib/app-error.js";
import { readCookie } from "../../lib/cookies.js";
import {
  getAccessTokenFromRequest,
  requireSupabaseUser,
  type AuthenticatedRequest
} from "../../middleware/auth.js";
import { issueCsrfToken, rotateCsrfToken } from "../../middleware/csrf.js";
import { disconnectRooms, sessionRoom } from "../../realtime/publisher.js";
import {
  createLoginAccountRateLimit,
  createLoginIpRateLimits,
  createLoginRateLimit
} from "../../middleware/rate-limit.js";
import { accessTokenCookieName, clearAuthCookies, refreshTokenCookieName, setAuthCookies } from "./auth.cookies.js";
import { createGoogleAuthRoutes } from "./google-auth.routes.js";
import { withFailurePadding } from "./login-timing.js";
import { refreshAuthSession, revokeAuthSession, signInWithPassword } from "./supabase-auth.service.js";

export const createAuthRoutes = (): ExpressRouter => {
  const authRoutes = Router();
  const loginRateLimit = createLoginRateLimit();
  const loginAccountRateLimit = createLoginAccountRateLimit();
  const loginIpRateLimits = createLoginIpRateLimits();

  authRoutes.get("/auth/csrf", (req, res) => {
    res.setHeader("cache-control", "no-store");
    res.json({ csrfToken: issueCsrfToken(req, res) });
  });

  // Per-address failure caps first (SEC2-02), then IP+email and per-account.
  authRoutes.post("/auth/login", ...loginIpRateLimits, loginRateLimit, loginAccountRateLimit, async (req, res, next) => {
    try {
      // Every failure (invalid input or credentials, banned, provider error) takes the same minimum time (SEC2-07).
      const session = await withFailurePadding(() => signInWithPassword(LoginRequestSchema.parse(req.body)));

      setAuthCookies(res, session.tokens);
      rotateCsrfToken(res);
      res.json(AuthSessionSchema.parse({ user: session.user }));
    } catch (error) {
      next(error);
    }
  });

  authRoutes.post("/auth/refresh", async (req, res, next) => {
    try {
      const refreshToken = readCookie(req, refreshTokenCookieName);
      if (!refreshToken) {
        throw new AppError("AUTH_REQUIRED", "Authentication is required.", 401);
      }

      const session = await refreshAuthSession(refreshToken);
      setAuthCookies(res, session.tokens);
      res.json(AuthSessionSchema.parse({ user: session.user }));
    } catch (error) {
      next(error);
    }
  });

  authRoutes.post("/auth/logout", async (req, res, next) => {
    // Whoever signs in next on this browser starts with a fresh CSRF token (SEC2-23), even if revocation fails.
    rotateCsrfToken(res);
    try {
      const accessToken = getAccessTokenFromRequest(req) ?? readCookie(req, accessTokenCookieName);
      clearAuthCookies(res);
      // This device only (BUG-WK-02): other devices keep their sessions.
      const sessionId = await revokeAuthSession(accessToken, { scope: "local" });
      if (sessionId) {
        disconnectRooms([sessionRoom(sessionId)]);
      }
      res.json(LogoutResponseSchema.parse({ ok: true }));
    } catch (error) {
      clearAuthCookies(res);
      next(error);
    }
  });

  authRoutes.get("/auth/me", requireSupabaseUser, async (req, res, next) => {
    try {
      res.setHeader("cache-control", "no-store");
      const auth = (req as AuthenticatedRequest).auth;
      // Permissions come from the database role (token claims carry none, WK-59); none without a membership.
      const permissions = await resolveAccessContext(auth.id)
        .then((context) => context.role.permissions)
        .catch((error: unknown) => {
          if (error instanceof AppError && error.statusCode === 403) {
            return [] as string[];
          }
          throw error;
        });
      res.json(AuthSessionSchema.parse({ user: { id: auth.id, email: auth.email, permissions } }));
    } catch (error) {
      next(error);
    }
  });

  /** Short-lived ticket that lets the open socket survive the access-token refresh (PERF-02). */
  authRoutes.post("/auth/socket-ticket", requireSupabaseUser, async (req, res, next) => {
    try {
      res.setHeader("cache-control", "no-store");
      res.json(SocketTicketSchema.parse(await issueSocketTicket((req as AuthenticatedRequest).auth)));
    } catch (error) {
      next(error);
    }
  });

  // GET /auth/providers, /auth/google/start, /auth/google/callback (PD-012; off unless GOOGLE_AUTH_ENABLED).
  authRoutes.use(createGoogleAuthRoutes());

  return authRoutes;
};
