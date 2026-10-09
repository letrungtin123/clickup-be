import pino from "pino";

import { env } from "../config/env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers.apikey",
      "res.headers.set-cookie",
      "*.password",
      "*.token",
      "*.serviceRoleKey"
    ],
    censor: "[redacted]"
  }
});

