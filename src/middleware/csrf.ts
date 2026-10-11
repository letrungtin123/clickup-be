import { randomBytes, timingSafeEqual } from "node:crypto";

import type { NextFunction, Request, Response } from "express";

import { authCookieSecure } from "../config/env.js";
import { AppError } from "../lib/app-error.js";
import { readCookie } from "../lib/cookies.js";

export const csrfCookieName = "nesso_csrf";
export const csrfHeaderName = "x-csrf-token";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

const newCsrfToken = () => randomBytes(32).toString("base64url");

const setCsrfCookie = (res: Response, token: string) => {
  res.cookie(csrfCookieName, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: authCookieSecure,
    path: "/",
    maxAge: 1000 * 60 * 60 * 24 * 30
  });
};

/**
 * Double-submit CSRF protection. The token lives in an HttpOnly SameSite=Strict cookie and is
 * handed to the SPA through the JSON body of GET /auth/csrf; unsafe requests must echo it in a header.
 * A cross-site page can neither read the body (CORS) nor set the cookie.
 */
export const issueCsrfToken = (req: Request, res: Response) => {
  const existing = readCookie(req, csrfCookieName);
  const token = existing && /^[A-Za-z0-9_-]{43}$/.test(existing) ? existing : newCsrfToken();
  setCsrfCookie(res, token);
  return token;
};

/**
 * Replaces the token when the session changes (sign-in, sign-out; SEC2-23), so a value planted or seen
 * before cannot outlive it. A client still holding the old token gets one 403 CSRF_INVALID, refetches
 * GET /auth/csrf and retries (the SPA's API client does this automatically).
 */
export const rotateCsrfToken = (res: Response) => {
  const token = newCsrfToken();
  setCsrfCookie(res, token);
  return token;
};

const tokensMatch = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export const requireCsrf = (req: Request, _res: Response, next: NextFunction) => {
  if (safeMethods.has(req.method)) {
    next();
    return;
  }

  const cookieToken = readCookie(req, csrfCookieName);
  const headerToken = req.header(csrfHeaderName);

  if (!cookieToken || !headerToken || !tokensMatch(cookieToken, headerToken)) {
    next(new AppError("CSRF_INVALID", "Security token is missing or invalid. Reload the page and try again.", 403));
    return;
  }

  next();
};
