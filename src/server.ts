import { createServer } from "node:http";

import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { closeDatabase } from "./db/client.js";
import { closeAmqp } from "./lib/amqp.js";
import { logger } from "./lib/logger.js";
import { closeRedis } from "./lib/redis.js";
import { registerRoomAuthorizers } from "./modules/room-authorizers.js";
import { attachRealtimeGateway } from "./realtime/gateway.js";

const app = createApp();
const server = createServer(app);

registerRoomAuthorizers();
const io = attachRealtimeGateway(server);

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

  const results = await Promise.allSettled([closeDatabase(), closeRedis(), closeAmqp()]);
  for (const result of results) {
    if (result.status === "rejected") {
      logger.error({ err: result.reason }, "Dependency close failed");
      process.exitCode = 1;
    }
  }

  process.exit();
};

let shuttingDown = false;
const shutdown = (signal: NodeJS.Signals) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, "API server shutting down");

  // Closes every socket, then the underlying HTTP server.
  void io.close((error) => {
    void closeAfterServerStops(error ?? undefined);
  });
  // Do not hang forever on keep-alive connections.
  setTimeout(() => server.closeAllConnections(), 10_000).unref();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
