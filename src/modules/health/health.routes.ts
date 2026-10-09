import { Router, type Router as ExpressRouter } from "express";

import { env } from "../../config/env.js";
import { checkDatabase } from "../../db/client.js";

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
    const database = await checkDatabase();
    const ready = database.ok || env.NODE_ENV !== "production";

    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      dependencies: {
        database,
        supabase: {
          configured: Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY)
        }
      }
    });
  } catch (error) {
    next(error);
  }
});
