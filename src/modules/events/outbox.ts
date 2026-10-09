import type postgres from "postgres";

type QuerySql = postgres.Sql | postgres.TransactionSql;

export type DomainEventInput = {
  organizationId: string;
  /** Dotted lowercase routing key, e.g. "task.assigned", "chat.message.created". */
  type: string;
  aggregateType: string;
  aggregateId: string | null;
  actorUserId: string | null;
  payload: Record<string, postgres.JSONValue>;
};

/** The envelope delivered to RabbitMQ consumers. */
export type DomainEventEnvelope = {
  id: string;
  type: string;
  organizationId: string;
  aggregateType: string;
  aggregateId: string | null;
  actorUserId: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
};

/**
 * Records domain events in the transactional outbox. Must be called with the same transaction
 * as the business write so events exist if and only if the change committed.
 */
export const enqueueDomainEvents = async (tx: QuerySql, events: DomainEventInput[]) => {
  if (events.length === 0) {
    return;
  }

  await tx`
    INSERT INTO public.outbox_events (organization_id, event_type, aggregate_type, aggregate_id, actor_user_id, payload)
    SELECT
      (event->>'organizationId')::uuid,
      event->>'type',
      event->>'aggregateType',
      (event->>'aggregateId')::uuid,
      (event->>'actorUserId')::uuid,
      event->'payload'
    FROM jsonb_array_elements(${tx.json(events as unknown as postgres.JSONValue)}) AS event
  `;
};
