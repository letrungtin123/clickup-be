import { Router, type Router as ExpressRouter } from "express";

import { env } from "../../config/env.js";
import { checkDatabase } from "../../db/client.js";
import { checkAmqp } from "../../lib/amqp.js";
import { checkRedis } from "../../lib/redis.js";

export const healthRoutes: ExpressRouter = Router();

healthRoutes.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "nesso-api",
    uptimeSeconds: Math.round(process.uptime())
  });
});

healthRoutes.get("/ready", async (_req, res, next) => {
  try {
    const [database, redis, rabbitmq] = await Promise.all([
      checkDatabase().catch((error: unknown) => ({ ok: false, reason: error instanceof Error ? error.message : "unknown" })),
      checkRedis(),
      checkAmqp()
    ]);
    const ready = (database.ok && redis.ok) || env.NODE_ENV !== "production";

    // Readiness exposes dependency health only; failure reasons stay in logs outside development.
    const describe = (status: { ok: boolean; reason: string | null }) =>
      env.NODE_ENV === "production" ? { ok: status.ok } : status;

    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      dependencies: {
        database: describe(database),
        redis: describe(redis),
        rabbitmq: describe(rabbitmq),
        supabase: {
          configured: Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY)
        }
      }
    });
  } catch (error) {
    next(error);
  }
});
