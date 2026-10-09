import type { NextFunction, Request, Response } from "express";

import { AppError } from "../lib/app-error.js";
import { readCookie } from "../lib/cookies.js";
import { accessTokenCookieName } from "../modules/auth/auth.cookies.js";
import { verifyAccessToken, type VerifiedSession } from "../modules/auth/supabase-auth.service.js";

export type AuthenticatedRequest = Request & {
  auth: VerifiedSession;
};

export const getAccessTokenFromRequest = (req: Pick<Request, "header">) => {
  const authorization = req.header("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return readCookie(req, accessTokenCookieName);
};

/**
 * Authenticates the request. Authorization (RBAC + resource membership) is resolved separately
 * from the database-backed access context, never from token claims.
 */
export const requireSupabaseUser = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    // Already verified for this request (e.g. by the rate limiter).
    if ((req as Partial<AuthenticatedRequest>).auth) {
      next();
      return;
    }
    const accessToken = getAccessTokenFromRequest(req);
    if (!accessToken) {
      throw new AppError("AUTH_REQUIRED", "Authentication is required.", 401);
    }

    (req as AuthenticatedRequest).auth = await verifyAccessToken(accessToken);
    next();
  } catch (error) {
    next(error);
  }
};
