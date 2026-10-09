import { getSql } from "../db/client.js";
import { logger } from "../lib/logger.js";
import { removeObjects } from "../lib/storage.js";

const intervalMs = 30 * 60 * 1000;
const batchSize = 500;

/**
 * Housekeeping (one worker instance at a time via advisory lock), always in bounded batches:
 * - abandoned uploads: task attachments never completed, chat files never sent (> 24h)
 * - published outbox rows older than 7 days
 * - read or archived notifications older than 180 days
 */
export const runMaintenance = async () => {
  // Transaction-scoped lock: safe with pooled connections (released on commit).
  const result = await getSql().begin(async (sql) => {
    const locked = await sql<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended('maintenance', 0)) AS locked`;
    if (!locked[0]?.locked) {
      return null;
    }
    const staleTaskFiles = await sql<{ id: string; storage_path: string }[]>`
      DELETE FROM public.task_attachments
      WHERE id IN (
        SELECT id FROM public.task_attachments
        WHERE status = 'pending' AND created_at < now() - interval '24 hours'
        ORDER BY created_at LIMIT ${batchSize}
      )
      RETURNING id, storage_path
    `;
    const staleChatFiles = await sql<{ id: string; storage_path: string }[]>`
      DELETE FROM public.message_attachments
      WHERE id IN (
        SELECT id FROM public.message_attachments
        WHERE message_id IS NULL AND created_at < now() - interval '24 hours'
        ORDER BY created_at LIMIT ${batchSize}
      )
      RETURNING id, storage_path
    `;
    const outbox = await sql`
      DELETE FROM public.outbox_events
      WHERE id IN (
        SELECT id FROM public.outbox_events
        WHERE published_at IS NOT NULL AND published_at < now() - interval '7 days'
        ORDER BY published_at LIMIT ${batchSize * 10}
      )
    `;
    const notifications = await sql`
      DELETE FROM public.notifications
      WHERE id IN (
        SELECT id FROM public.notifications
        WHERE created_at < now() - interval '180 days' AND (read_at IS NOT NULL OR archived_at IS NOT NULL)
        ORDER BY created_at LIMIT ${batchSize * 10}
      )
    `;
    return {
      paths: [...staleTaskFiles, ...staleChatFiles].map((row) => row.storage_path),
      outboxRows: outbox.count,
      notifications: notifications.count
    };
  });
  if (!result) {
    return;
  }
  // Objects are removed after the rows are gone, so nothing can still reference them.
  if (result.paths.length > 0) {
    await removeObjects(result.paths).catch((error: unknown) => logger.warn({ err: error }, "Storage cleanup of abandoned uploads failed"));
  }
  if (result.paths.length + result.outboxRows + result.notifications > 0) {
    logger.info(
      { abandonedUploads: result.paths.length, outboxRows: result.outboxRows, notifications: result.notifications },
      "Maintenance cleanup"
    );
  }
};

export const startMaintenanceScheduler = () => {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const tick = () => {
    if (stopped) {
      return;
    }
    runMaintenance()
      .catch((error: unknown) => logger.error({ err: error }, "Maintenance run failed"))
      .finally(() => {
        if (!stopped) {
          timer = setTimeout(tick, intervalMs);
        }
      });
  };
  timer = setTimeout(tick, 60_000);
  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
    return Promise.resolve();
  };
};
