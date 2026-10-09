import type postgres from "postgres";

import { getSql } from "../db/client.js";
import { publishEvents } from "../lib/amqp.js";
import { logger } from "../lib/logger.js";
import type { DomainEventEnvelope } from "../modules/events/outbox.js";

type OutboxRow = {
  id: string;
  organization_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string | null;
  actor_user_id: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
  attempts: number;
};

const batchSize = 200;
const pollIntervalMs = 2_000;
const maxBackoffMs = 5 * 60 * 1000;

/**
 * Moves committed outbox rows to RabbitMQ. Safe to run in several worker instances:
 * rows are claimed with FOR UPDATE SKIP LOCKED and marked published only after broker confirms.
 */
export const startOutboxRelay = () => {
  const sql = getSql();
  let stopped = false;
  let running = false;
  let wakeRequested = false;
  let listener: postgres.ListenMeta | undefined;
  let timer: NodeJS.Timeout | undefined;

  const relayBatch = async (): Promise<number> => {
    return await sql.begin(async (tx) => {
      const rows = await tx<OutboxRow[]>`
        SELECT id::text, organization_id, event_type, aggregate_type, aggregate_id, actor_user_id, payload, created_at, attempts
        FROM public.outbox_events
        WHERE published_at IS NULL
          AND next_attempt_at <= now()
        ORDER BY id
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      `;
      if (rows.length === 0) {
        return 0;
      }

      try {
        await publishEvents(
          rows.map((row) => {
            const envelope: DomainEventEnvelope = {
              id: row.id,
              type: row.event_type,
              organizationId: row.organization_id,
              aggregateType: row.aggregate_type,
              aggregateId: row.aggregate_id,
              actorUserId: row.actor_user_id,
              payload: row.payload,
              occurredAt: row.created_at.toISOString()
            };
            return { routingKey: row.event_type, messageId: `outbox-${row.id}`, body: envelope, timestamp: row.created_at };
          })
        );

        await tx`
          UPDATE public.outbox_events
          SET published_at = now(), attempts = attempts + 1, last_error = NULL
          WHERE id = ANY(${rows.map((row) => row.id)}::bigint[])
        `;
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 2000) : "publish failed";
        await tx`
          UPDATE public.outbox_events
          SET attempts = attempts + 1,
              last_error = ${message},
              next_attempt_at = now() + make_interval(secs => LEAST(${maxBackoffMs / 1000}, power(2, LEAST(attempts, 12))))
          WHERE id = ANY(${rows.map((row) => row.id)}::bigint[])
        `;
        logger.warn({ err: error, count: rows.length }, "Outbox publish failed; will retry");
        return 0;
      }

      return rows.length;
    });
  };

  const drain = async () => {
    if (running || stopped) {
      wakeRequested = true;
      return;
    }
    running = true;
    try {
      do {
        wakeRequested = false;
        let published = 0;
        do {
          published = await relayBatch();
        } while (published === batchSize && !stopped);
      } while (wakeRequested && !stopped);
    } catch (error) {
      logger.error({ err: error }, "Outbox relay iteration failed");
    } finally {
      running = false;
    }
  };

  const schedule = () => {
    if (stopped) {
      return;
    }
    timer = setTimeout(() => {
      void drain().finally(schedule);
    }, pollIntervalMs);
  };

  void sql
    .listen("outbox_events", () => {
      void drain();
    })
    .then((meta) => {
      listener = meta;
    })
    .catch((error: unknown) => {
      logger.warn({ err: error }, "LISTEN outbox_events unavailable; relying on polling");
    });

  void drain();
  schedule();
  logger.info("Outbox relay started");

  return async () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
    await listener?.unlisten().catch(() => undefined);
  };
};
