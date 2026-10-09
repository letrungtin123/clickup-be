import { getSql } from "../../db/client.js";
import { logger } from "../../lib/logger.js";
import { deliverNotifications } from "./notifications.service.js";

type DueRow = {
  id: string;
  organization_id: string;
  project_id: string;
  title: string;
  task_key: string;
  project_name: string;
  due_at: Date;
  assignee_ids: string[];
};

const scanIntervalMs = 5 * 60 * 1000;
const batchSize = 500;

/**
 * Deadline reminders (spec §11, §30): "due soon" (within 24h) and "overdue", once per task per due
 * date thanks to dedupe keys. Only one worker instance scans at a time (advisory lock); scans walk
 * the open-due index in keyset batches so they stay bounded at any table size.
 */
const scanWindow = async (kind: "task.due_soon" | "task.overdue") => {
  const sql = getSql();
  let cursor: { dueAt: Date; id: string } | null = null;
  let delivered = 0;
  for (;;) {
    const rows: DueRow[] = await sql<DueRow[]>`
      SELECT t.id, t.organization_id, t.project_id, t.title, p.key || '-' || t.number AS task_key, p.name AS project_name, t.due_at,
        coalesce(array_agg(ta.assignee_user_id) FILTER (WHERE ta.assignee_user_id IS NOT NULL), '{}') AS assignee_ids
      FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id AND p.organization_id = t.organization_id AND p.deleted_at IS NULL AND p.archived_at IS NULL
      LEFT JOIN public.task_assignees ta ON ta.task_id = t.id AND ta.organization_id = t.organization_id AND ta.removed_at IS NULL
      WHERE t.deleted_at IS NULL AND t.completed_at IS NULL AND t.due_at IS NOT NULL
        AND ${
          kind === "task.due_soon"
            ? sql`t.due_at > now() AND t.due_at <= now() + interval '24 hours'`
            : sql`t.due_at <= now() AND t.due_at > now() - interval '7 days'`
        }
        AND (${cursor?.dueAt ?? null}::timestamptz IS NULL OR (t.due_at, t.id) > (${cursor?.dueAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
      GROUP BY t.id, p.key, p.name
      ORDER BY t.due_at, t.id
      LIMIT ${batchSize}
    `;
    for (const row of rows) {
      if (row.assignee_ids.length === 0) {
        continue;
      }
      delivered += await deliverNotifications({
        organizationId: row.organization_id,
        recipientIds: row.assignee_ids,
        type: kind,
        actorUserId: null,
        title: row.title,
        projectId: row.project_id,
        taskId: row.id,
        payload: { taskKey: row.task_key, projectName: row.project_name, dueAt: row.due_at.toISOString() },
        dedupeKey: `${kind}:${row.id}:${row.due_at.getTime()}`
      });
    }
    const last = rows[rows.length - 1];
    if (!last || rows.length < batchSize) {
      break;
    }
    cursor = { dueAt: last.due_at, id: last.id };
  }
  return delivered;
};

export const runDeadlineScan = async () => {
  const sql = getSql();
  return await sql.begin(async (tx) => {
    const lock = await tx<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended('deadline-scan', 0)) AS locked`;
    if (!lock[0]?.locked) {
      return 0;
    }
    const soon = await scanWindow("task.due_soon");
    const overdue = await scanWindow("task.overdue");
    if (soon + overdue > 0) {
      logger.info({ soon, overdue }, "Deadline reminders delivered");
    }
    return soon + overdue;
  });
};

export const startDeadlineScheduler = () => {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const tick = () => {
    if (stopped) {
      return;
    }
    runDeadlineScan()
      .catch((error: unknown) => logger.error({ err: error }, "Deadline scan failed"))
      .finally(() => {
        if (!stopped) {
          timer = setTimeout(tick, scanIntervalMs);
        }
      });
  };
  timer = setTimeout(tick, 10_000);
  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
    return Promise.resolve();
  };
};
