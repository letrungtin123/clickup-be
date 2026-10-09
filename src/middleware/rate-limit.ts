import type { Request } from "express";
import { ipKeyGenerator, rateLimit, type Options } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";

import { env } from "../config/env.js";
import { AppError } from "../lib/app-error.js";
import { getOptionalRedis } from "../lib/redis.js";
import { verifyAccessToken } from "../modules/auth/supabase-auth.service.js";
import { getAccessTokenFromRequest, type AuthenticatedRequest } from "./auth.js";

const redisStore = (prefix: string): Partial<Options> => {
  const redis = getOptionalRedis();
  if (!redis) {
    return {};
  }

  return {
    store: new RedisStore({
      prefix: `rl:${prefix}:`,
      sendCommand: (command: string, ...args: string[]) =>
        redis.call(command, ...args) as Promise<boolean | number | string>
    })
  };
};

const clientIp = (req: Request) => ipKeyGenerator(req.ip ?? "unknown");

const rejectWith = (code: string, message: string): Options["handler"] => {
  return (_req, _res, next) => {
    next(new AppError(code, message, 429));
  };
};

/**
 * Resolves the verified session once per request (reused by requireSupabaseUser) so signed-in
 * traffic is limited per user — many colleagues behind one office NAT must not share a bucket.
 */
const resolveSessionForLimit = async (req: Request) => {
  const existing = (req as Partial<AuthenticatedRequest>).auth;
  if (existing) {
    return existing;
  }
  const token = getAccessTokenFromRequest(req);
  if (!token) {
    return null;
  }
  try {
    const session = await verifyAccessToken(token);
    (req as AuthenticatedRequest).auth = session;
    return session;
  } catch {
    return null;
  }
};

/** Global limiter shared across API instances: per user when signed in, per IP otherwise. */
export const createApiRateLimit = () =>
  rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: async (req: Request) => ((await resolveSessionForLimit(req)) ? env.RATE_LIMIT_MAX * 2 : env.RATE_LIMIT_MAX),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: async (req: Request) => {
      const session = await resolveSessionForLimit(req);
      return session ? `user:${session.id}` : `ip:${clientIp(req)}`;
    },
    handler: rejectWith("RATE_LIMITED", "Too many requests. Please slow down."),
    ...redisStore("api")
  });

const loginEmail = (req: Request) => {
  const body: unknown = req.body;
  return typeof body === "object" && body !== null && "email" in body && typeof body.email === "string"
    ? body.email.trim().toLowerCase().slice(0, 254)
    : "";
};

/** Per-account guard (any source address): slows distributed guessing against one account. */
export const createLoginAccountRateLimit = () =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: env.LOGIN_ACCOUNT_LIMIT_MAX,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => `acct:${loginEmail(req)}`,
    handler: rejectWith("LOGIN_RATE_LIMITED", "Too many sign-in attempts. Try again in a few minutes."),
    ...redisStore("login-account")
  });

/** Brute-force guard for credential endpoints, keyed by IP + normalized email; only failures count. */
export const createLoginRateLimit = () =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: env.LOGIN_RATE_LIMIT_MAX,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => {
      const body: unknown = req.body;
      const email =
        typeof body === "object" && body !== null && "email" in body && typeof body.email === "string"
          ? body.email.trim().toLowerCase().slice(0, 254)
          : "";
      return `${clientIp(req)}|${email}`;
    },
    handler: rejectWith("LOGIN_RATE_LIMITED", "Too many sign-in attempts. Try again in a few minutes."),
    ...redisStore("login")
  });

/** Wrong current-password guesses on change-password, per signed-in user. */
export const createPasswordChangeRateLimit = () =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => `pwd:${(req as Partial<AuthenticatedRequest>).auth?.id ?? clientIp(req)}`,
    handler: rejectWith("PASSWORD_CHANGE_RATE_LIMITED", "Too many attempts. Try again in a few minutes."),
    ...redisStore("password-change")
  });
