import type { Request } from "express";
import { ipKeyGenerator, rateLimit, type Options } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";

import { env } from "../config/env.js";
import { AppError } from "../lib/app-error.js";
import { getOptionalRedis } from "../lib/redis.js";

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

/** Global per-IP limiter shared across API instances. */
export const createApiRateLimit = () =>
  rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: env.RATE_LIMIT_MAX,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: clientIp,
    handler: rejectWith("RATE_LIMITED", "Too many requests. Please slow down."),
    ...redisStore("api")
  });

/** Brute-force guard for credential endpoints, keyed by IP + normalized email. */
export const createLoginRateLimit = () =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: env.LOGIN_RATE_LIMIT_MAX,
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
