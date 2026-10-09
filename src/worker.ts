import { closeDatabase } from "./db/client.js";
import { startOutboxRelay } from "./jobs/outbox-relay.js";
import { startWorkerConsumers } from "./jobs/registry.js";
import { closeAmqp, getAmqpConnection } from "./lib/amqp.js";
import { logger } from "./lib/logger.js";
import { closeRedis } from "./lib/redis.js";

/**
 * Background worker: relays the transactional outbox to RabbitMQ and runs durable consumers
 * (notifications, reminders). Deploy alongside the API; any number of instances is safe.
 */
const main = async () => {
  await getAmqpConnection();
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
