import { appPublicUrl, env } from "../../config/env.js";
import { getSql } from "../../db/client.js";
import { logger } from "../../lib/logger.js";
import { closeMailer, describeMailer, isEmailEnabled, isPermanentMailError, sendMail } from "../../lib/mailer.js";
import { getOptionalRedis } from "../../lib/redis.js";
import type { DomainEventEnvelope } from "../events/outbox.js";
import { enqueueDomainEvents } from "../events/outbox.js";
import {
  createMemoryWindowStore,
  createRedisWindowStore,
  digestWindowKey,
  recipientSkipReason,
  type DigestRecipient,
  type WindowStore
} from "./email-policy.js";
import { renderDigestEmail, type EmailNotification } from "./email-templates.js";

/**
 * E-mail delivery of inbox notifications (PD-013, PLAN §8, SPEC §6): web delivery always happens;
 * recipients with notify_email = true additionally get a digest e-mail, at most one per
 * EMAIL_DIGEST_MINUTES, combining every notification still pending for them.
 *
 *   deliverNotifications → mark rows email_queued_at + outbox `email.notification`
 *   nesso.email consumer → digest now if the user's window is free, otherwise leave it pending
 *   sweeper (every minute) → digests for users whose window expired with notifications pending
 *
 * Idempotency: rows included in a sent digest get email_sent_at and are never e-mailed again.
 */

export const emailNotificationEvent = "email.notification";
export const emailBindings = [emailNotificationEvent];

const lookbackHours = 24;
const maxRowsPerDigest = 100;
const maxSectionsPerDigest = 20;
const sweepIntervalMs = 60_000;
const sweepUserLimit = 200;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Producer side (called by deliverNotifications) -------------------------------------------------

/**
 * Queues an e-mail for each new notification whose recipient opted in: one statement filters and
 * marks the rows (email_queued_at), and the same transaction writes the outbox events.
 */
export const enqueueNotificationEmails = async (organizationId: string, rows: { id: string; recipient_user_id: string }[]) => {
  if (rows.length === 0 || !isEmailEnabled()) {
    return 0;
  }
  const ids = rows.map((row) => row.id);
  return await getSql().begin(async (tx) => {
    const queued = await tx<{ id: string; recipient_user_id: string }[]>`
      UPDATE public.notifications n
      SET email_queued_at = now()
      FROM public.app_users au
      WHERE n.id = ANY(${ids}::uuid[])
        AND n.email_queued_at IS NULL
        AND au.id = n.recipient_user_id
        AND au.notify_email AND au.email IS NOT NULL AND au.deleted_at IS NULL
      RETURNING n.id, n.recipient_user_id
    `;
    await enqueueDomainEvents(
      tx,
      queued.map((row) => ({
        organizationId,
        type: emailNotificationEvent,
        aggregateType: "notification",
        aggregateId: row.id,
        actorUserId: null,
        payload: { notificationId: row.id }
      }))
    );
    return queued.length;
  });
};

// Digest -----------------------------------------------------------------------------------------

let windowStore: WindowStore | undefined;
const getWindowStore = () => {
  if (!windowStore) {
    const redis = getOptionalRedis();
    windowStore = redis ? createRedisWindowStore(redis) : createMemoryWindowStore();
  }
  return windowStore;
};

type PendingRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  project_id: string | null;
  task_id: string | null;
  channel_id: string | null;
  message_id: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
  actor_name: string | null;
};

const toEmailNotification = (row: PendingRow): EmailNotification => ({
  type: row.type,
  title: row.title,
  body: row.body,
  actorName: row.actor_name,
  projectId: row.project_id,
  taskId: row.task_id,
  channelId: row.channel_id,
  messageId: row.message_id,
  payload: row.payload,
  createdAt: row.created_at
});

/** Pending = queued, not e-mailed yet, still unread on the web, recent, and the membership is active. */
const loadPending = async (userId: string) =>
  await getSql()<PendingRow[]>`
    SELECT n.id, n.type, n.title, n.body, n.project_id, n.task_id, n.channel_id, n.message_id, n.payload, n.created_at,
      (SELECT au.display_name FROM public.app_users au WHERE au.id = n.actor_user_id) AS actor_name
    FROM public.notifications n
    JOIN public.organization_memberships om
      ON om.organization_id = n.organization_id AND om.user_id = n.recipient_user_id
     AND om.status = 'active' AND om.deleted_at IS NULL
    WHERE n.recipient_user_id = ${userId}
      AND n.email_queued_at > now() - make_interval(hours => ${lookbackHours})
      AND n.email_sent_at IS NULL AND n.read_at IS NULL AND n.archived_at IS NULL
    ORDER BY n.created_at, n.id
    LIMIT ${maxRowsPerDigest}
  `;

/** Drops queued rows that will never be e-mailed (recipient opted out, inactive, or address rejected). */
const dequeue = async (userId: string, ids?: string[]) => {
  await getSql()`
    UPDATE public.notifications SET email_queued_at = NULL
    WHERE recipient_user_id = ${userId} AND email_sent_at IS NULL AND email_queued_at IS NOT NULL
      AND (${ids ?? null}::uuid[] IS NULL OR id = ANY(${ids ?? null}::uuid[]))
  `;
};

export type DigestOutcome =
  | { status: "sent"; count: number }
  | { status: "deferred" }
  | { status: "skipped"; reason: string };

/**
 * Sends one digest with everything pending for the user, if their window is free. Transient SMTP
 * errors give the window back and throw (the caller retries); permanent ones are logged and dropped.
 */
export const sendDigestForUser = async (userId: string): Promise<DigestOutcome> => {
  if (!isEmailEnabled()) {
    return { status: "skipped", reason: "email_disabled" };
  }
  const sql = getSql();
  const recipient = (
    await sql<(DigestRecipient & { display_name: string })[]>`
      SELECT email, display_name, notify_email, deleted_at FROM public.app_users WHERE id = ${userId}
    `
  )[0];
  const reason = recipientSkipReason(recipient);
  if (reason || !recipient?.email) {
    await dequeue(userId);
    logger.info({ userId, reason }, "Notification e-mail skipped");
    return { status: "skipped", reason: reason ?? "no_address" };
  }

  const store = getWindowStore();
  const windowKey = digestWindowKey(userId);
  if (!(await store.claim(windowKey, env.EMAIL_DIGEST_MINUTES * 60))) {
    return { status: "deferred" };
  }

  let rows: PendingRow[];
  try {
    rows = await loadPending(userId);
  } catch (error) {
    await store.release(windowKey);
    throw error;
  }
  if (rows.length === 0) {
    await store.release(windowKey);
    return { status: "skipped", reason: "nothing_pending" };
  }

  const shown = rows.slice(0, maxSectionsPerDigest);
  const mail = renderDigestEmail({
    recipientName: recipient.display_name,
    items: shown.map(toEmailNotification),
    moreCount: rows.length - shown.length,
    baseUrl: appPublicUrl
  });
  const ids = rows.map((row) => row.id);

  try {
    const result = await sendMail({ to: recipient.email, ...mail });
    logger.info({ userId, count: ids.length, mode: result.mode, messageId: result.messageId }, "Notification e-mail digest sent");
  } catch (error) {
    if (isPermanentMailError(error)) {
      await dequeue(userId, ids);
      logger.warn({ err: error, userId, count: ids.length }, "Notification e-mail rejected permanently; dropped");
      return { status: "skipped", reason: "rejected" };
    }
    await store.release(windowKey);
    throw error;
  }

  // Sent: the window stays claimed for EMAIL_DIGEST_MINUTES.
  await sql`
    UPDATE public.notifications SET email_sent_at = now()
    WHERE id = ANY(${ids}::uuid[]) AND email_sent_at IS NULL
  `;
  return { status: "sent", count: ids.length };
};

// Consumer + sweeper -----------------------------------------------------------------------------

/** `email.notification` → digest for the recipient now, or later by the sweeper if their window is taken. */
export const handleEmailEvent = async (event: DomainEventEnvelope) => {
  const raw = typeof event.payload.notificationId === "string" ? event.payload.notificationId : event.aggregateId;
  if (!raw || !uuidPattern.test(raw) || !isEmailEnabled()) {
    return;
  }
  const row = (
    await getSql()<{ recipient_user_id: string; pending: boolean }[]>`
      SELECT recipient_user_id, (email_queued_at IS NOT NULL AND email_sent_at IS NULL) AS pending
      FROM public.notifications WHERE id = ${raw}
    `
  )[0];
  if (!row?.pending) {
    // Deleted, or already included in an earlier digest (redelivered event).
    return;
  }
  await sendDigestForUser(row.recipient_user_id);
};

/** One sweep: digests for every user with pending notifications whose window has expired. */
export const runEmailDigestSweep = async () => {
  if (!isEmailEnabled()) {
    return 0;
  }
  const users = await getSql()<{ recipient_user_id: string }[]>`
    SELECT n.recipient_user_id
    FROM public.notifications n
    WHERE n.email_queued_at > now() - make_interval(hours => ${lookbackHours})
      AND n.email_sent_at IS NULL AND n.read_at IS NULL AND n.archived_at IS NULL
      AND EXISTS (
        SELECT 1 FROM public.organization_memberships om
        WHERE om.organization_id = n.organization_id AND om.user_id = n.recipient_user_id
          AND om.status = 'active' AND om.deleted_at IS NULL
      )
    GROUP BY n.recipient_user_id
    ORDER BY min(n.email_queued_at)
    LIMIT ${sweepUserLimit}
  `;
  let sent = 0;
  for (const { recipient_user_id: userId } of users) {
    try {
      const outcome = await sendDigestForUser(userId);
      sent += outcome.status === "sent" ? 1 : 0;
    } catch (error) {
      // Most likely SMTP is unreachable: stop this round, the next one retries.
      logger.warn({ err: error, userId }, "Notification e-mail digest failed; retrying next sweep");
      break;
    }
  }
  return sent;
};

export const startEmailDigestSweeper = () => {
  logger.info({ email: describeMailer(), digestMinutes: env.EMAIL_DIGEST_MINUTES }, "Notification e-mail delivery");
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const tick = () => {
    if (stopped) {
      return;
    }
    runEmailDigestSweep()
      .then((sent) => {
        if (sent > 0) {
          logger.info({ sent }, "Notification e-mail sweep");
        }
      })
      .catch((error: unknown) => logger.error({ err: error }, "Notification e-mail sweep failed"))
      .finally(() => {
        if (!stopped) {
          timer = setTimeout(tick, sweepIntervalMs);
        }
      });
  };
  timer = setTimeout(tick, 20_000);
  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
    closeMailer();
    return Promise.resolve();
  };
};
