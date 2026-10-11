import { getSql } from "../db/client.js";
import { getDeadLetterCounts } from "../lib/amqp.js";
import { logger } from "../lib/logger.js";
import { deliverNotifications } from "../modules/notifications/notifications.service.js";
import { loadProductionAdminIds } from "../modules/production/member-lookups.js";

/**
 * Dead-letter monitoring: a message lands in `<queue>.dead` after its handler failed `maxAttempts` times (or it
 * could not be parsed) — a notification, e-mail … that was never delivered. Every CHECK_INTERVAL the worker reads
 * the parking queues' depth (passive declare). A non-empty one is logged as an error on every check and announced
 * in the app to the production Admins and organization admins (superadmin / "admin" role) of every active
 * organization: at most ONE notification per queue per hour (the dedupe key holds the UTC hour, so several worker
 * instances agree). The alert stays until someone inspects the queue (RabbitMQ UI, 127.0.0.1:56673) and moves or
 * purges the messages. `system.*` notifications are never e-mailed.
 */

const checkIntervalMs = 5 * 60 * 1000;
const firstCheckDelayMs = 45_000;

/** UTC hour bucket, e.g. "2026-10-11T08": one alert per queue per bucket. */
export const deadLetterAlertKey = (queue: string, now: Date) => `dlq:${queue}:${now.toISOString().slice(0, 13)}`;

/** Queues with parked messages (unknown / unreadable counts are not alerts). */
export const parkedQueues = (counts: Record<string, number | null>) =>
  Object.entries(counts)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0)
    .map(([queue, count]) => ({ queue, count }));

const loadAlertRecipients = async (organizationId: string) => {
  const sql = getSql();
  const orgAdmins = await sql<{ user_id: string }[]>`
    SELECT om.user_id FROM public.organization_memberships om
    JOIN public.roles r ON r.id = om.role_id AND r.organization_id = om.organization_id AND r.key IN ('superadmin', 'admin')
    WHERE om.organization_id = ${organizationId} AND om.status = 'active' AND om.deleted_at IS NULL
  `;
  return [...new Set([...(await loadProductionAdminIds(sql, organizationId)), ...orgAdmins.map((row) => row.user_id)])];
};

/** One in-app alert per active organization (deduplicated per queue and hour). Returns the notifications written. */
export const notifyDeadLetters = async (queue: string, count: number, now: Date) => {
  const organizations = await getSql()<{ id: string }[]>`
    SELECT id FROM public.organizations WHERE deleted_at IS NULL AND archived_at IS NULL
  `;
  let written = 0;
  for (const organization of organizations) {
    written += await deliverNotifications({
      organizationId: organization.id,
      recipientIds: await loadAlertRecipients(organization.id),
      type: "system.dead_letter",
      actorUserId: null,
      title: `Hàng đợi lỗi: ${queue}`,
      body: `${count} tin nhắn không xử lý được sau nhiều lần thử (thông báo hoặc e-mail chưa gửi). Kiểm tra log clickup-worker và hàng đợi trong RabbitMQ.`,
      payload: { queue, count },
      dedupeKey: deadLetterAlertKey(queue, now)
    });
  }
  return written;
};

type MonitorDeps = {
  counts: () => Promise<Record<string, number | null>>;
  notify: (queue: string, count: number, now: Date) => Promise<number>;
  now: () => Date;
};

/** One check: error log for every non-empty parking queue + the (rate-limited) in-app alert. */
export const runDeadLetterCheck = async (
  deps: MonitorDeps = { counts: () => getDeadLetterCounts(), notify: notifyDeadLetters, now: () => new Date() }
) => {
  const counts = await deps.counts();
  for (const { queue, count } of parkedQueues(counts)) {
    logger.error({ queue, count }, "Dead-letter queue has parked messages");
    try {
      await deps.notify(queue, count, deps.now());
    } catch (error) {
      logger.warn({ err: error, queue }, "Dead-letter alert notification failed");
    }
  }
  return counts;
};

export const startDeadLetterMonitor = () => {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const tick = () => {
    if (stopped) {
      return;
    }
    runDeadLetterCheck()
      .catch((error: unknown) => logger.warn({ err: error }, "Dead-letter check failed"))
      .finally(() => {
        if (!stopped) {
          timer = setTimeout(tick, checkIntervalMs);
        }
      });
  };
  timer = setTimeout(tick, firstCheckDelayMs);
  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
    return Promise.resolve();
  };
};
