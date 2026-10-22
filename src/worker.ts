import { closeDatabase, configureDatabase } from "./db/client.js";
import { startOutboxRelay } from "./jobs/outbox-relay.js";
import { startWorkerConsumers } from "./jobs/registry.js";
import { closeAmqp, getAmqpConnection } from "./lib/amqp.js";
import { logger } from "./lib/logger.js";
import { closeRedis } from "./lib/redis.js";

/**
 * RabbitMQ may come up after the worker (2026-10-21: after a reboot Docker published the broker's port late, the worker
 * exited on ECONNREFUSED and — under `tsx watch`, which waits for a file change — stayed down for an hour). Keep trying
 * with a growing pause (5 s … 1 min) instead of exiting.
 */
const connectBroker = async () => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await getAmqpConnection();
    } catch (error) {
      const retryInMs = Math.min(60_000, 5_000 * attempt);
      logger.error({ err: error, attempt, retryInMs }, "RabbitMQ unavailable at start; retrying");
      await new Promise((resolve) => setTimeout(resolve, retryInMs));
    }
  }
};

/**
 * Background worker: relays the transactional outbox to RabbitMQ and runs durable consumers
 * (notifications, reminders). Deploy alongside the API; any number of instances is safe.
 */
const main = async () => {
  // Smaller pool and longer statement limit than the API (DB_POOL_MAX / DB_STATEMENT_TIMEOUT_MS override).
  configureDatabase({ role: "worker" });
  await connectBroker();
  const stopRelay = startOutboxRelay();
  const stopConsumers = await startWorkerConsumers();
  logger.info("Worker running");

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, "Worker shutting down");

    void (async () => {
      await stopConsumers();
      await stopRelay();
      await closeAmqp();
      await closeRedis();
      await closeDatabase();
      process.exit(0);
    })().catch((error: unknown) => {
      logger.error({ err: error }, "Worker shutdown failed");
      process.exit(1);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "Worker failed to start");
  process.exit(1);
});
