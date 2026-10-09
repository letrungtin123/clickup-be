import { getSql } from "../../db/client.js";
import { isCursorTimestamp, timestampParamSql } from "../../lib/db-types.js";
import { withJobLock } from "../../lib/job-lock.js";
import { logger } from "../../lib/logger.js";
import { getOptionalRedis } from "../../lib/redis.js";
import { afterNotificationsInserted, insertedNotificationColumns, type InsertedNotificationRow } from "./notifications.service.js";

const scanIntervalMs = 5 * 60 * 1000;
const watermarkKey = "deadline-scan:watermark";
/** Upper bound of reminders written per kind and scan; the rest follow on the next scan (dedupe keys). */
const maxRowsPerScan = 20_000;

type Kind = "task.due_soon" | "task.overdue";

/**
 * Deadline reminders (spec §11, §30): "due soon" (within 24 h) and "overdue" (up to 7 days late), once per
 * task, assignee and due date (dedupe keys). Set-based (PERF-04): one INSERT … SELECT … ON CONFLICT DO NOTHING
 * per kind and scan writes every reminder, then only the rows actually inserted are pushed.
 *
 * Watermark: after a successful scan the database time is stored in Redis. The next scan only considers
 * tasks whose reminder moment was crossed since then (due_at − 24 h, resp. due_at, in (watermark, now]) or
 * that changed since then (new due date, reopened, reassigned — every such change touches tasks.updated_at).
 * Without a watermark (first run, Redis lost) the whole windows are scanned; dedupe keys keep it idempotent.
 */
const scanKind = async (kind: Kind, since: string | null) => {
  const sql = getSql();
  const window =
    kind === "task.due_soon"
      ? sql`t.due_at > now() AND t.due_at <= now() + interval '24 hours'`
      : sql`t.due_at <= now() AND t.due_at > now() - interval '7 days'`;
  const crossed = since
    ? kind === "task.due_soon"
      ? sql`(t.due_at - interval '24 hours' > ${timestampParamSql(sql, since)} OR t.updated_at > ${timestampParamSql(sql, since)})`
      : sql`(t.due_at > ${timestampParamSql(sql, since)} OR t.updated_at > ${timestampParamSql(sql, since)})`
    : sql`TRUE`;

  const inserted = await sql<(InsertedNotificationRow & { organization_id: string })[]>`
    WITH due AS (
      SELECT t.id, t.organization_id, t.project_id, t.title, t.due_at, p.key || '-' || t.number AS task_key, p.name AS project_name,
        p.visibility
      FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id AND p.organization_id = t.organization_id
        AND p.deleted_at IS NULL AND p.archived_at IS NULL
      JOIN public.lists l ON l.id = t.list_id AND l.organization_id = t.organization_id
        AND l.deleted_at IS NULL AND l.archived_at IS NULL
      WHERE t.deleted_at IS NULL AND t.archived_at IS NULL AND t.completed_at IS NULL AND t.due_at IS NOT NULL
        AND ${window}
        AND ${crossed}
      ORDER BY t.due_at, t.id
      LIMIT ${maxRowsPerScan}
    ),
    recipients AS (
      -- Assignees who can still see the project (visibility, membership, RBAC); people who lost access get nothing.
      SELECT due.*, ta.assignee_user_id AS user_id
      FROM due
      JOIN public.task_assignees ta ON ta.task_id = due.id AND ta.organization_id = due.organization_id AND ta.removed_at IS NULL
      JOIN public.organization_memberships om
        ON om.organization_id = due.organization_id AND om.user_id = ta.assignee_user_id
        AND om.status = 'active' AND om.deleted_at IS NULL
      JOIN public.roles r ON r.id = om.role_id AND r.organization_id = om.organization_id AND r.deleted_at IS NULL
      WHERE r.key = 'superadmin'
        OR (
          EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_key = 'task.view')
          AND EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_key = 'project.view')
          AND (
            due.visibility = 'public'
            OR EXISTS (
              SELECT 1 FROM public.project_memberships pm
              WHERE pm.organization_id = due.organization_id AND pm.project_id = due.project_id
                AND pm.user_id = ta.assignee_user_id AND pm.status = 'active' AND pm.deleted_at IS NULL
            )
          )
        )
    ),
    inserted AS (
      INSERT INTO public.notifications (organization_id, recipient_user_id, type, actor_user_id, project_id, task_id, title, payload, dedupe_key)
      SELECT organization_id, user_id, ${kind}::text, NULL, project_id, id, left(title, 300),
        jsonb_build_object(
          'taskKey', task_key,
          'projectName', project_name,
          'dueAt', to_char(due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        ),
        -- Same key as the previous per-row scanner: "<kind>:<taskId>:<due epoch ms>".
        ${kind}::text || ':' || id || ':' || floor(extract(epoch FROM due_at) * 1000)::bigint
      FROM recipients
      ON CONFLICT (organization_id, recipient_user_id, dedupe_key) DO NOTHING
      RETURNING *
    )
    SELECT ${insertedNotificationColumns(sql)}, n.organization_id
    FROM inserted n
  `;

  const byOrganization = new Map<string, InsertedNotificationRow[]>();
  for (const row of inserted) {
    byOrganization.set(row.organization_id, [...(byOrganization.get(row.organization_id) ?? []), row]);
  }
  for (const [organizationId, rows] of byOrganization) {
    await afterNotificationsInserted(organizationId, rows);
  }
  return inserted.length;
};

const readWatermark = async () => {
  try {
    const value = await getOptionalRedis()?.get(watermarkKey);
    return isCursorTimestamp(value) ? value : null;
  } catch {
    return null;
  }
};

const writeWatermark = async (value: string) => {
  try {
    // Kept a day: after a longer outage the full windows are scanned again.
    await getOptionalRedis()?.set(watermarkKey, value, "EX", 24 * 3600);
  } catch (error) {
    logger.warn({ err: error }, "Deadline scan watermark could not be saved");
  }
};

export const runDeadlineScan = async () => {
  // One instance at a time, without keeping a transaction open while notifications are delivered.
  const delivered = await withJobLock("deadline-scan", 10 * 60 * 1000, async () => {
    const sql = getSql();
    const startedAt = (await sql<{ now: string }[]>`SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now`)[0]!.now;
    const since = await readWatermark();
    const soon = await scanKind("task.due_soon", since);
    const overdue = await scanKind("task.overdue", since);
    await writeWatermark(startedAt);
    if (soon + overdue > 0) {
      logger.info({ soon, overdue, incremental: since !== null }, "Deadline reminders delivered");
    }
    return soon + overdue;
  });
  return delivered ?? 0;
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
