import type { NextFunction, Request, Response } from "express";

import type { AuthUser } from "../contracts/schemas.js";
import type { PermissionKey } from "../contracts/permissions.js";
import { AppError } from "../lib/app-error.js";
import { readCookie } from "../lib/cookies.js";
import { accessTokenCookieName } from "../modules/auth/auth.cookies.js";
import { verifyAccessToken } from "../modules/auth/supabase-auth.service.js";

export type AuthenticatedRequest = Request & {
  auth: AuthUser;
};

export const getAccessTokenFromRequest = (req: Request) => {
  const authorization = req.header("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return readCookie(req, accessTokenCookieName);
};

export const requireSupabaseUser = async (req: Request, _res: Response, next: NextFunction) => {
  try {
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

export const requirePermission = (permission: PermissionKey) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const auth = (req as Partial<AuthenticatedRequest>).auth;
      if (!auth) {
        throw new AppError("AUTH_REQUIRED", "Authentication is required.", 401);
      }

      if (!auth.permissions.includes(permission)) {
        throw new AppError("FORBIDDEN", "You do not have permission to perform this action.", 403);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
