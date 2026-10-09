import type { Channel, ConsumeMessage } from "amqplib";

import { declareWorkQueue, getAmqpConnection, type QueueSpec } from "../lib/amqp.js";
import { logger } from "../lib/logger.js";
import type { DomainEventEnvelope } from "../modules/events/outbox.js";

export type EventHandler = (event: DomainEventEnvelope) => Promise<void>;

type ConsumerSpec = QueueSpec & {
  prefetch: number;
  maxAttempts: number;
  handler: EventHandler;
};

const attemptsHeader = "x-nesso-attempts";

const parseEnvelope = (message: ConsumeMessage): DomainEventEnvelope | null => {
  try {
    const value: unknown = JSON.parse(message.content.toString("utf8"));
    if (
      typeof value === "object" &&
      value !== null &&
      "id" in value &&
      "type" in value &&
      "organizationId" in value &&
      "payload" in value
    ) {
      return value as DomainEventEnvelope;
    }
  } catch {
    // fall through
  }
  return null;
};

/**
 * Runs a durable consumer with bounded retries. Handlers must be idempotent: a message can be
 * redelivered after a crash between handling and ack.
 */
export const startConsumer = async (spec: ConsumerSpec) => {
  const model = await getAmqpConnection();
  let channel: Channel | undefined;
  let stopped = false;

  const setup = async () => {
    if (stopped) {
      return;
    }
    const next = await model.createChannel();
    await next.prefetch(spec.prefetch);
    const { retryQueue, deadQueue } = await declareWorkQueue(next, spec);

    await next.consume(spec.name, (message) => {
      if (!message) {
        return;
      }

      const envelope = parseEnvelope(message);
      const attempts = Number(message.properties.headers?.[attemptsHeader] ?? 0);

      if (!envelope) {
        logger.error({ queue: spec.name }, "Unparseable event parked");
        next.sendToQueue(deadQueue, message.content, message.properties);
        next.ack(message);
        return;
      }

      spec
        .handler(envelope)
        .then(() => next.ack(message))
        .catch((error: unknown) => {
          const nextAttempt = attempts + 1;
          const target = nextAttempt >= spec.maxAttempts ? deadQueue : retryQueue;
          logger.warn(
            { err: error, queue: spec.name, eventId: envelope.id, type: envelope.type, attempt: nextAttempt, target },
            "Event handler failed"
          );
          next.sendToQueue(target, message.content, {
            ...message.properties,
            headers: { ...message.properties.headers, [attemptsHeader]: nextAttempt }
          });
          next.ack(message);
        });
    });

    channel = next;
    logger.info({ queue: spec.name }, "Consumer started");
  };

  model.on("connect", () => {
    void setup().catch((error: unknown) => logger.error({ err: error, queue: spec.name }, "Consumer setup failed"));
  });
  await setup();

  return async () => {
    stopped = true;
    try {
      await channel?.close();
    } catch {
      // already closed
    }
  };
};
