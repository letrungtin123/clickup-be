import { createServer } from "node:http";

import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { closeDatabase } from "./db/client.js";
import { logger } from "./lib/logger.js";

const app = createApp();
const server = createServer(app);

server.listen(env.API_PORT, env.API_HOST, () => {
  logger.info(
    {
      host: env.API_HOST,
      port: env.API_PORT
    },
    "API server listening"
  );
});

const closeAfterServerStops = async (error?: Error) => {
  if (error) {
    logger.error({ err: error }, "API server close failed");
    process.exitCode = 1;
  }

  try {
    await closeDatabase();
  } catch (closeError) {
    logger.error({ err: closeError }, "Database close failed");
    process.exitCode = 1;
  }

  process.exit();
};

const shutdown = (signal: NodeJS.Signals) => {
  logger.info({ signal }, "API server shutting down");

  server.close((error) => {
    void closeAfterServerStops(error ?? undefined);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);