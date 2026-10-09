import { connect, type Channel, type ChannelModel, type ConfirmChannel, type RecoveringChannelModel } from "amqplib";

import { env } from "../config/env.js";
import { logger } from "./logger.js";

export const eventsExchange = "nesso.events";
export const deadLetterExchange = "nesso.events.dlx";

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
  publishChannel = channel;
  return channel;
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
