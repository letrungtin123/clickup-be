import { Router, type Router as ExpressRouter } from "express";

import {
  AuthSessionSchema,
  LoginRequestSchema,
  LogoutResponseSchema
} from "../../contracts/schemas.js";
import { AppError } from "../../lib/app-error.js";
import { readCookie } from "../../lib/cookies.js";
import {
  getAccessTokenFromRequest,
  requireSupabaseUser,
  type AuthenticatedRequest
} from "../../middleware/auth.js";
import { issueCsrfToken } from "../../middleware/csrf.js";
import { createLoginRateLimit } from "../../middleware/rate-limit.js";
import { accessTokenCookieName, clearAuthCookies, refreshTokenCookieName, setAuthCookies } from "./auth.cookies.js";
import { refreshAuthSession, revokeAuthSession, signInWithPassword } from "./supabase-auth.service.js";

export const createAuthRoutes = (): ExpressRouter => {
  const authRoutes = Router();
  const loginRateLimit = createLoginRateLimit();

  authRoutes.get("/auth/csrf", (req, res) => {
    res.setHeader("cache-control", "no-store");
    res.json({ csrfToken: issueCsrfToken(req, res) });
  });

  authRoutes.post("/auth/login", loginRateLimit, async (req, res, next) => {
    try {
      const input = LoginRequestSchema.parse(req.body);
      const session = await signInWithPassword(input);

      setAuthCookies(res, session.tokens);
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
    try {
      const accessToken = getAccessTokenFromRequest(req) ?? readCookie(req, accessTokenCookieName);
      clearAuthCookies(res);
      await revokeAuthSession(accessToken);
      res.json(LogoutResponseSchema.parse({ ok: true }));
    } catch (error) {
      clearAuthCookies(res);
      next(error);
    }
  });

  authRoutes.get("/auth/me", requireSupabaseUser, (req, res) => {
    res.setHeader("cache-control", "no-store");
    res.json(AuthSessionSchema.parse({ user: (req as AuthenticatedRequest).auth }));
  });

  return authRoutes;
};
