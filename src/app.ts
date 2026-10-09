import cors from "cors";
import { randomUUID } from "node:crypto";
import express, { type Express } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";

import { corsOrigins, env } from "./config/env.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFound } from "./middleware/not-found.js";
import { requestContext } from "./middleware/request-context.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { apiRoutes } from "./routes.js";
import { logger } from "./lib/logger.js";

export const createApp = (): Express => {
  const app = express();

  app.disable("x-powered-by");
  app.use(requestContext);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => {
        const requestId = req.headers["x-request-id"];
        if (Array.isArray(requestId)) {
          return requestId[0] ?? randomUUID();
        }

        return requestId ?? randomUUID();
      }
    })
  );
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "same-site" }
    })
  );
  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        if (!origin || corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error("CORS origin denied"));
      }
    })
  );
  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      limit: env.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false
    })
  );
  app.use(express.json({ limit: "1mb" }));

  app.use(healthRoutes);
  app.use("/api/v1", apiRoutes);
  app.use(notFound);
  app.use(errorHandler);

  return app;
};

