import cors from "cors";
import { randomUUID } from "node:crypto";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";

import { corsOrigins, env } from "./config/env.js";
import { requireCsrf } from "./middleware/csrf.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFound } from "./middleware/not-found.js";
import { createApiRateLimit } from "./middleware/rate-limit.js";
import { requestContext } from "./middleware/request-context.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { createApiRoutes } from "./routes.js";
import { logger } from "./lib/logger.js";

export const createApp = (): Express => {
  const app = express();

  app.disable("x-powered-by");
  // Only the configured number of reverse-proxy hops may set the client address.
  app.set("trust proxy", env.TRUST_PROXY_HOPS);
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
      },
      autoLogging: { ignore: (req) => req.url === "/health" || req.url === "/ready" },
      // Keep request logs compact and free of credentials (cookies, tokens, CSRF headers).
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode })
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
  app.use(express.json({ limit: "1mb" }));
  app.use(healthRoutes);
  app.use("/api/v1", createApiRateLimit(), requireCsrf, createApiRoutes());
  app.use(notFound);
  app.use(errorHandler);

  return app;
};
