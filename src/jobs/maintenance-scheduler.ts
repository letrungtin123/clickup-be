import { getSql } from "../db/client.js";
import { logger } from "../lib/logger.js";
import { removeObjects } from "../lib/storage.js";
import { knowledgeLimits } from "../contracts/knowledge.js";

const intervalMs = 30 * 60 * 1000;
const batchSize = 500;

/**
 * Housekeeping (one worker instance at a time via advisory lock), always in bounded batches:
 * - abandoned uploads: task attachments never completed, chat files never sent (> 24h), knowledge files never
 *   completed or comment drafts never posted (> 24h)
 * - knowledge items in a space trash for more than knowledgeLimits.trashRetentionDays days: purged, with an
 *   ITEM_PURGED audit entry by the system (PD-031; the audit log keeps every entry). Only then do the item's files
 *   leave storage — images used by any version body stay until the item itself is purged, even when hidden.
 * - published outbox rows older than 7 days
 * - read or archived notifications older than 180 days
 * - planner statistics for tables never analyzed (small lookup tables stay below the autovacuum
 *   threshold forever, and default estimates on them produced 1M-row join plans)
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
    // Never a file that a version body uses as an image (kept until the item itself is purged, PD-031).
    const staleKnowledgeFiles = await sql<{ id: string; storage_path: string }[]>`
      DELETE FROM knowledge.item_attachments
      WHERE id IN (
        SELECT a.id FROM knowledge.item_attachments a
        WHERE a.created_at < now() - interval '24 hours'
          AND (a.status = 'pending' OR (a.purpose = 'comment' AND a.comment_id IS NULL AND a.deleted_at IS NULL))
          AND NOT EXISTS (
            SELECT 1 FROM knowledge.item_versions v WHERE v.item_id = a.item_id AND a.id = ANY(v.image_attachment_ids)
          )
        ORDER BY a.created_at LIMIT ${batchSize}
      )
      RETURNING id, storage_path
    `;
    const purgedItems = await sql<{ id: string }[]>`
      SELECT id FROM knowledge.items
      WHERE deleted_at IS NOT NULL AND deleted_at < now() - make_interval(days => ${knowledgeLimits.trashRetentionDays})
      ORDER BY deleted_at LIMIT 200
      FOR UPDATE SKIP LOCKED
    `;
    const purgedIds = purgedItems.map((row) => row.id);
    const purgedFiles =
      purgedIds.length > 0
        ? await sql<{ storage_path: string }[]>`SELECT storage_path FROM knowledge.item_attachments WHERE item_id = ANY(${purgedIds}::uuid[])`
        : [];
    if (purgedIds.length > 0) {
      await sql`
        INSERT INTO knowledge.audit_log (organization_id, space_id, item_id, item_title, actor_user_id, action, before, reason)
        SELECT i.organization_id, i.space_id, i.id, i.title, NULL, 'ITEM_PURGED',
          jsonb_build_object('title', i.title, 'version', i.version, 'importance', i.importance),
          ${`Tự xoá vĩnh viễn sau ${knowledgeLimits.trashRetentionDays} ngày trong thùng rác`}
        FROM knowledge.items i WHERE i.id = ANY(${purgedIds}::uuid[])
      `;
      await sql`DELETE FROM knowledge.items WHERE id = ANY(${purgedIds}::uuid[])`;
      await sql`
        DELETE FROM public.notifications
        WHERE type LIKE 'knowledge.%' AND payload->>'knowledgeItemId' = ANY(${purgedIds}::text[])
      `;
    }
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
      paths: [...staleTaskFiles, ...staleChatFiles, ...staleKnowledgeFiles, ...purgedFiles].map((row) => row.storage_path),
      knowledgePurged: purgedIds.length,
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
  await analyzeUnanalyzedTables().catch((error: unknown) => logger.warn({ err: error }, "Statistics refresh failed"));
  if (result.paths.length + result.outboxRows + result.notifications + result.knowledgePurged > 0) {
    logger.info(
      {
        abandonedUploads: result.paths.length,
        outboxRows: result.outboxRows,
        notifications: result.notifications,
        knowledgeItemsPurged: result.knowledgePurged
      },
      "Maintenance cleanup"
    );
  }
};

const analyzeUnanalyzedTables = async () => {
  const sql = getSql();
  const tables = await sql<{ schema: string; name: string }[]>`
    SELECT schemaname AS schema, relname AS name FROM pg_stat_user_tables
    WHERE schemaname IN ('public', 'production', 'knowledge') AND n_live_tup > 0
      AND last_analyze IS NULL AND last_autoanalyze IS NULL
    LIMIT 50
  `;
  for (const table of tables) {
    await sql`ANALYZE ${sql(table.schema)}.${sql(table.name)}`;
  }
  if (tables.length > 0) {
    logger.info({ tables: tables.map((table) => `${table.schema}.${table.name}`) }, "Analyzed tables without statistics");
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
