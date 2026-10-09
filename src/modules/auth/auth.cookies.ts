import type { Response } from "express";

import { authCookieSecure } from "../../config/env.js";

export const accessTokenCookieName = "nesso_access_token";
export const refreshTokenCookieName = "nesso_refresh_token";

const baseCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: authCookieSecure,
  path: "/"
};

export const setAuthCookies = (
  res: Response,
  tokens: { accessToken: string; refreshToken: string; expiresInSeconds: number }
) => {
  res.cookie(accessTokenCookieName, tokens.accessToken, {
    ...baseCookieOptions,
    maxAge: tokens.expiresInSeconds * 1000
  });
  res.cookie(refreshTokenCookieName, tokens.refreshToken, {
    ...baseCookieOptions,
    maxAge: 1000 * 60 * 60 * 24 * 30
  });
};

export const clearAuthCookies = (res: Response) => {
  res.clearCookie(accessTokenCookieName, baseCookieOptions);
  res.clearCookie(refreshTokenCookieName, baseCookieOptions);
};
