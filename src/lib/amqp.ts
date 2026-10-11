import { connect, type Channel, type ChannelModel, type ConfirmChannel, type RecoveringChannelModel } from "amqplib";

import { env } from "../config/env.js";
import { logger } from "./logger.js";

export const eventsExchange = "nesso.events";
export const deadLetterExchange = "nesso.events.dlx";

/** Durable work queues of the worker (jobs/registry.ts); each has `.retry` and `.dead` companions (declareWorkQueue). */
export const workQueueNames = { notifications: "nesso.notifications", email: "nesso.email" } as const;
export const deadQueueName = (queue: string) => `${queue}.dead`;

export type QueueSpec = {
  name: string;
  bindings: string[];
  /** Delay before a failed message is retried. */
  retryDelayMs: number;
};

let connection: RecoveringChannelModel | undefined;
let connecting: Promise<RecoveringChannelModel> | undefined;
let publishChannel: ConfirmChannel | undefined;

export const hasAmqpConfig = () => Boolean(env.RABBITMQ_URL);

const declareTopology = async (model: ChannelModel) => {
  const channel = await model.createChannel();
  try {
    await channel.assertExchange(eventsExchange, "topic", { durable: true });
    await channel.assertExchange(deadLetterExchange, "topic", { durable: true });
  } finally {
    await channel.close();
  }
};

export const getAmqpConnection = async () => {
  if (connection) {
    return connection;
  }
  if (!env.RABBITMQ_URL) {
    throw new Error("RABBITMQ_URL is not configured");
  }

  connecting ??= (async () => {
    const model = await connect(env.RABBITMQ_URL!, {
      clientProperties: { connection_name: `nesso-${process.pid}` },
      recovery: {
        initialDelay: 250,
        maxDelay: 15_000,
        initialMaxRetries: 10,
        setup: async (channelModel: ChannelModel) => {
          await declareTopology(channelModel);
        }
      }
    });

    model.on("disconnect", (error: Error) => {
      publishChannel = undefined;
      logger.warn({ err: error }, "RabbitMQ disconnected; recovering");
    });
    model.on("connect", () => logger.info("RabbitMQ connected"));
    model.on("error", (error: Error) => logger.warn({ err: error }, "RabbitMQ connection error"));

    connection = model;
    return model;
  })();

  try {
    return await connecting;
  } finally {
    connecting = undefined;
  }
};

const getPublishChannel = async () => {
  if (publishChannel) {
    return publishChannel;
  }

  const model = await getAmqpConnection();
  const channel = await model.createConfirmChannel();
  channel.on("close", () => {
    if (publishChannel === channel) {
      publishChannel = undefined;
    }
  });
  channel.on("error", (error: Error) => logger.warn({ err: error }, "RabbitMQ publish channel error"));
  // Messages are published "mandatory": an event type no queue is bound to comes back here instead of vanishing.
  channel.on("return", (message: { fields: { routingKey: string } }) => reportUnroutedEvent(message.fields.routingKey));
  publishChannel = channel;
  return channel;
};

const unroutedSeen = new Set<string>();

/**
 * An outbox event type that no consumer binds (no queue receives it): logged once per type and process, so a new
 * event without a consumer (or a consumer that lost its binding) is noticed instead of being dropped silently.
 * Returns whether this call logged.
 */
export const reportUnroutedEvent = (routingKey: string) => {
  if (unroutedSeen.has(routingKey) || unroutedSeen.size >= 500) {
    return false;
  }
  unroutedSeen.add(routingKey);
  logger.warn({ routingKey }, "Outbox event has no consumer: no queue is bound to this event type");
  return true;
};

/** Publishes persistent messages and waits for broker confirmation. */
export const publishEvents = async (
  messages: { routingKey: string; messageId: string; body: unknown; timestamp: Date }[]
) => {
  if (messages.length === 0) {
    return;
  }

  const channel = await getPublishChannel();
  for (const message of messages) {
    channel.publish(eventsExchange, message.routingKey, Buffer.from(JSON.stringify(message.body)), {
      persistent: true,
      mandatory: true,
      contentType: "application/json",
      messageId: message.messageId,
      timestamp: Math.floor(message.timestamp.getTime() / 1000),
      type: message.routingKey
    });
  }
  await channel.waitForConfirms();
};

/**
 * Declares a durable work queue with a delayed retry loop and a parking (dead) queue:
 *   main --nack--> <name>.retry (TTL) --expire--> main      (up to maxAttempts)
 *   main --give up--> <name>.dead
 */
export const declareWorkQueue = async (channel: Channel, spec: QueueSpec) => {
  const retryQueue = `${spec.name}.retry`;
  const deadQueue = `${spec.name}.dead`;

  await channel.assertQueue(spec.name, {
    durable: true,
    arguments: { "x-queue-type": "quorum" }
  });
  await channel.assertQueue(retryQueue, {
    durable: true,
    arguments: {
      "x-queue-type": "quorum",
      "x-message-ttl": spec.retryDelayMs,
      "x-dead-letter-exchange": "",
      "x-dead-letter-routing-key": spec.name
    }
  });
  await channel.assertQueue(deadQueue, { durable: true, arguments: { "x-queue-type": "quorum" } });

  for (const binding of spec.bindings) {
    await channel.bindQueue(spec.name, eventsExchange, binding);
  }

  return { retryQueue, deadQueue };
};

type ChannelFactory = { createChannel(): Promise<Pick<Channel, "checkQueue" | "close" | "on">> };

/**
 * Messages parked in each work queue's `.dead` queue (passive declare: nothing is created). A queue that does not
 * exist (yet) or cannot be read counts as null.
 */
export const getDeadLetterCounts = async (model?: ChannelFactory): Promise<Record<string, number | null>> => {
  const connection: ChannelFactory = model ?? (await getAmqpConnection());
  const counts: Record<string, number | null> = {};
  for (const queue of Object.values(workQueueNames)) {
    const dead = deadQueueName(queue);
    let channel: Awaited<ReturnType<ChannelFactory["createChannel"]>> | undefined;
    try {
      channel = await connection.createChannel();
      // A missing queue closes the channel with 404: handled here, never an unhandled `error` event.
      channel.on("error", () => undefined);
      counts[dead] = (await channel.checkQueue(dead)).messageCount;
    } catch {
      counts[dead] = null;
    } finally {
      try {
        await channel?.close();
      } catch {
        // already closed (e.g. by the 404 of a missing queue)
      }
    }
  }
  return counts;
};

export const checkAmqp = async () => {
  if (!hasAmqpConfig()) {
    return { ok: false, reason: "RABBITMQ_URL is not configured" };
  }
  try {
    await getAmqpConnection();
    return { ok: true, reason: null };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "unknown" };
  }
};

export const closeAmqp = async () => {
  try {
    await publishChannel?.close();
  } catch {
    // already closed
  }
  try {
    await connection?.close();
  } catch {
    // already closed
  }
  publishChannel = undefined;
  connection = undefined;
};
