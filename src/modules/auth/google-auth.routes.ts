import { Router, type NextFunction, type Request, type Response, type Router as ExpressRouter } from "express";

import { appPublicUrl, authCookieSecure, env, supabasePublicUrl } from "../../config/env.js";
import { readCookie } from "../../lib/cookies.js";
import { logger } from "../../lib/logger.js";
import { createGoogleAuthRateLimit } from "../../middleware/rate-limit.js";
import { notFound } from "../../middleware/not-found.js";
import { setAuthCookies } from "./auth.cookies.js";
import { googleFlowTtlSeconds, saveGoogleFlow, takeGoogleFlow } from "./google-flow.store.js";
import {
  buildAuthorizeUrl,
  buildCallbackUrl,
  createOAuthState,
  createPkcePair,
  mapProviderError,
  sanitizeNextPath,
  statesMatch,
  type GoogleLoginError
} from "./google-oauth.js";
import { completeGoogleSignIn, isGoogleSignInAvailable } from "./google-auth.service.js";

/** Binds the pending flow to this browser. Lax (not Strict): the callback arrives as a cross-site redirect. */
export const googleStateCookieName = "nesso_google_oauth";

const stateCookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: authCookieSecure,
  // Only the start/callback endpoints ever see it.
  path: `${new URL(appPublicUrl).pathname.replace(/\/+$/, "")}/api/v1/auth/google`
});

const redirectTo = (res: Response, url: string) => {
  res.setHeader("cache-control", "no-store");
  res.redirect(303, url);
};

const redirectToLogin = (res: Response, error: GoogleLoginError) => redirectTo(res, `${appPublicUrl}/login?error=${error}`);

/** Everything Google-related is invisible (404) unless GOOGLE_AUTH_ENABLED=true. */
const requireGoogleEnabled = (req: Request, res: Response, next: NextFunction) => {
  if (!env.GOOGLE_AUTH_ENABLED) {
    notFound(req, res, next);
    return;
  }
  next();
};

const queryText = (value: unknown) => (typeof value === "string" ? value : null);

/** GoTrue's PKCE auth codes are UUIDs. */
const authCodePattern = /^[A-Za-z0-9-]{8,128}$/;

export const createGoogleAuthRoutes = (): ExpressRouter => {
  const routes = Router();
  const rateLimit = createGoogleAuthRateLimit((_req, res) => redirectToLogin(res, "google_rate_limited"));

  routes.get("/auth/providers", async (_req, res, next) => {
    try {
      res.setHeader("cache-control", "no-store");
      res.json({ google: await isGoogleSignInAvailable() });
    } catch (error) {
      next(error);
    }
  });

  /** Step 1: create state + PKCE verifier (Redis, 10 min), bind the state to this browser, go to GoTrue. */
  routes.get("/auth/google/start", requireGoogleEnabled, rateLimit, async (req, res) => {
    try {
      if (!(await isGoogleSignInAvailable())) {
        redirectToLogin(res, "google_unavailable");
        return;
      }
      const state = createOAuthState();
      const { codeVerifier, codeChallenge } = createPkcePair();
      await saveGoogleFlow(state, { codeVerifier, next: sanitizeNextPath(req.query.next) });
      res.cookie(googleStateCookieName, state, { ...stateCookieOptions(), maxAge: googleFlowTtlSeconds * 1000 });
      redirectTo(
        res,
        buildAuthorizeUrl({ supabasePublicUrl, redirectTo: buildCallbackUrl(appPublicUrl, state), codeChallenge })
      );
    } catch (error) {
      logger.error({ err: error }, "Google sign-in could not start");
      redirectToLogin(res, "google_failed");
    }
  });

  /** Step 2: GoTrue sends the browser back with ?state=…&code=… (or ?error=…). */
  routes.get("/auth/google/callback", requireGoogleEnabled, rateLimit, async (req, res) => {
    const cookieState = readCookie(req, googleStateCookieName);
    res.clearCookie(googleStateCookieName, stateCookieOptions());
    try {
      const queryState = req.query.state;
      if (!statesMatch(cookieState, queryState)) {
        redirectToLogin(res, "google_state_invalid");
        return;
      }
      const flow = await takeGoogleFlow(queryState);
      if (!flow) {
        redirectToLogin(res, "google_state_invalid");
        return;
      }

      const providerError = queryText(req.query.error);
      const code = queryText(req.query.code);
      if (providerError || !code) {
        const errorCode = queryText(req.query.error_code);
        logger.info({ error: providerError?.slice(0, 64), errorCode: errorCode?.slice(0, 64) }, "Google sign-in returned an error");
        redirectToLogin(res, mapProviderError(providerError, errorCode));
        return;
      }
      if (!authCodePattern.test(code)) {
        redirectToLogin(res, "google_failed");
        return;
      }

      const result = await completeGoogleSignIn({ authCode: code, codeVerifier: flow.codeVerifier });
      if (!result.ok) {
        redirectToLogin(res, result.reason);
        return;
      }
      setAuthCookies(res, result.tokens);
      redirectTo(res, `${appPublicUrl}${flow.next}`);
    } catch (error) {
      logger.error({ err: error }, "Google sign-in callback failed");
      redirectToLogin(res, "google_failed");
    }
  });

  return routes;
};
