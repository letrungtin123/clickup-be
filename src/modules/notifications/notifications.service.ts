import { getSql } from "../../db/client.js";
import type {
  Notification,
  NotificationPage,
  NotificationType
} from "../../contracts/notifications.js";
import { NotificationTypeSchema } from "../../contracts/notifications.js";
import { decodeTimeCursor, encodeTimeCursor, timestampParamSql, timestampTextSql, toIso, type QuerySql } from "../../lib/db-types.js";
import { logger } from "../../lib/logger.js";
import { isEmailEnabled } from "../../lib/mailer.js";
import { publishToUsers } from "../../realtime/publisher.js";
import type { AccessContext } from "../access/access-context.js";
import { toUserRef, type UserRefJson } from "../work/mappers.js";
import { userJsonSql } from "../work/tasks.repo.js";
import { enqueueNotificationEmails } from "./notification-email.js";

type NotificationRow = {
  id: string;
  type: string;
  actor: UserRefJson | null;
  title: string;
  body: string | null;
  project_id: string | null;
  task_id: string | null;
  comment_id: string | null;
  channel_id: string | null;
  message_id: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
  read_at: Date | null;
};

const toNotification = (row: NotificationRow): Notification => ({
  id: row.id,
  type: NotificationTypeSchema.catch("task.assigned").parse(row.type),
  actor: toUserRef(row.actor),
  title: row.title,
  body: row.body,
  target: {
    projectId: row.project_id,
    taskId: row.task_id,
    taskKey: typeof row.payload.taskKey === "string" ? row.payload.taskKey : null,
    commentId: row.comment_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    productionTaskId: typeof row.payload.productionTaskId === "string" ? row.payload.productionTaskId : null,
    jobId: typeof row.payload.jobId === "string" ? row.payload.jobId : null
  },
  payload: row.payload,
  createdAt: toIso(row.created_at),
  readAt: row.read_at ? toIso(row.read_at) : null
});

const notificationColumns = (sql: QuerySql) => sql`
  n.id, n.type, n.title, n.body, n.project_id, n.task_id, n.comment_id, n.channel_id, n.message_id, n.payload, n.created_at, n.read_at,
  (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = n.actor_user_id) AS actor
`;

/**
 * Defense in depth (BUG-WK-04): an inbox entry about a project or channel is only shown while its recipient
 * can still see that project / channel — even if a purge on an access change was missed. Evaluated in SQL
 * from the recipient (alias `n`), so the API and the worker's unread pushes agree.
 */
const recipientCanSeeSql = (sql: QuerySql) => sql`
  (n.project_id IS NULL OR EXISTS (
    SELECT 1
    FROM public.projects vp
    JOIN public.organization_memberships vom
      ON vom.organization_id = vp.organization_id AND vom.user_id = n.recipient_user_id
      AND vom.status = 'active' AND vom.deleted_at IS NULL
    JOIN public.roles vr ON vr.id = vom.role_id AND vr.organization_id = vom.organization_id
    WHERE vp.id = n.project_id AND vp.organization_id = n.organization_id
      AND vp.deleted_at IS NULL AND vp.archived_at IS NULL
      AND (
        vr.key = 'superadmin'
        OR (
          EXISTS (SELECT 1 FROM public.role_permissions vrp WHERE vrp.role_id = vr.id AND vrp.permission_key = 'project.view')
          AND (
            vp.visibility = 'public'
            OR EXISTS (
              SELECT 1 FROM public.project_memberships vpm
              WHERE vpm.organization_id = vp.organization_id AND vpm.project_id = vp.id AND vpm.user_id = n.recipient_user_id
                AND vpm.status = 'active' AND vpm.deleted_at IS NULL
            )
          )
        )
      )
  ))
  AND (n.channel_id IS NULL OR EXISTS (
    SELECT 1
    FROM public.channels vc
    JOIN public.organization_memberships vcm
      ON vcm.organization_id = vc.organization_id AND vcm.user_id = n.recipient_user_id
      AND vcm.status = 'active' AND vcm.deleted_at IS NULL
    JOIN public.roles vcr ON vcr.id = vcm.role_id AND vcr.organization_id = vcm.organization_id
    WHERE vc.id = n.channel_id AND vc.organization_id = n.organization_id AND vc.deleted_at IS NULL
      AND (
        EXISTS (
          SELECT 1 FROM public.channel_members vmem
          WHERE vmem.organization_id = vc.organization_id AND vmem.channel_id = vc.id
            AND vmem.user_id = n.recipient_user_id AND vmem.deleted_at IS NULL
        )
        OR vc.kind = 'public'
      )
      AND (
        vc.kind IN ('dm', 'group_dm')
        OR vcr.key = 'superadmin'
        OR EXISTS (SELECT 1 FROM public.role_permissions vcrp WHERE vcrp.role_id = vcr.id AND vcrp.permission_key = 'channel.view')
      )
  ))
`;

export const countUnread = async (sql: QuerySql, organizationId: string, userId: string) => {
  const rows = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM (
      SELECT 1 FROM public.notifications n
      WHERE n.organization_id = ${organizationId} AND n.recipient_user_id = ${userId}
        AND n.read_at IS NULL AND n.archived_at IS NULL
        AND ${recipientCanSeeSql(sql)}
      LIMIT 1000
    ) capped
  `;
  return rows[0]?.count ?? 0;
};

export const listNotifications = async (
  context: AccessContext,
  input: { filter: "all" | "unread"; types?: string[] | undefined; cursor?: string | undefined; limit: number }
): Promise<NotificationPage> => {
  const sql = getSql();
  const cursor = decodeTimeCursor(input.cursor);
  const rows = await sql<(NotificationRow & { cursor_at: string })[]>`
    SELECT ${notificationColumns(sql)}, ${timestampTextSql(sql, () => sql`n.created_at`)} AS cursor_at
    FROM public.notifications n
    WHERE n.organization_id = ${context.organization.id}
      AND n.recipient_user_id = ${context.user.id}
      AND n.archived_at IS NULL
      AND (${input.filter} = 'all' OR n.read_at IS NULL)
      AND (${input.types ?? null}::text[] IS NULL OR n.type = ANY(${input.types ?? null}::text[]))
      AND ${recipientCanSeeSql(sql)}
      ${cursor ? sql`AND (n.created_at, n.id) < (${timestampParamSql(sql, cursor.at)}, ${cursor.id}::uuid)` : sql``}
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT ${input.limit + 1}
  `;
  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  const hasMore = rows.length > input.limit;
  return {
    items: page.map(toNotification),
    // Microsecond-exact keyset (BUG-WK-12): entries sharing a millisecond are neither skipped nor repeated.
    pageInfo: { hasMore, nextCursor: hasMore && last ? encodeTimeCursor(last.cursor_at, last.id) : null },
    unreadCount: await countUnread(sql, context.organization.id, context.user.id)
  };
};

export const markRead = async (context: AccessContext, input: { ids?: string[] | undefined; all?: boolean | undefined }) => {
  const sql = getSql();
  if (input.all) {
    await sql`
      UPDATE public.notifications SET read_at = now()
      WHERE organization_id = ${context.organization.id} AND recipient_user_id = ${context.user.id} AND read_at IS NULL
    `;
  } else {
    await sql`
      UPDATE public.notifications SET read_at = now()
      WHERE organization_id = ${context.organization.id} AND recipient_user_id = ${context.user.id}
        AND id = ANY(${input.ids ?? []}::uuid[]) AND read_at IS NULL
    `;
  }
  const unreadCount = await countUnread(sql, context.organization.id, context.user.id);
  publishToUsers([context.user.id], "notification:read", { ids: input.all ? "all" : (input.ids ?? []), unreadCount });
  return { unreadCount };
};

export const archiveNotifications = async (context: AccessContext, ids: string[]) => {
  const sql = getSql();
  const archived = await sql<{ id: string }[]>`
    UPDATE public.notifications SET archived_at = now(), read_at = coalesce(read_at, now())
    WHERE organization_id = ${context.organization.id} AND recipient_user_id = ${context.user.id} AND id = ANY(${ids}::uuid[])
      AND archived_at IS NULL
    RETURNING id
  `;
  const unreadCount = await countUnread(sql, context.organization.id, context.user.id);
  // Other tabs / devices drop archived entries (BUG-WK-48); `notification:read` stays for older clients.
  const archivedIds = archived.map((row) => row.id);
  publishToUsers([context.user.id], "notification:archived", { ids: archivedIds.length > 0 ? archivedIds : ids, unreadCount });
  publishToUsers([context.user.id], "notification:read", { ids, unreadCount });
  return { unreadCount };
};

export const getUnreadCount = async (context: AccessContext) => ({
  unreadCount: await countUnread(getSql(), context.organization.id, context.user.id)
});

// Writing (worker side) ---------------------------------------------------------------------------

export type NotificationDraft = {
  organizationId: string;
  recipientIds: string[];
  type: NotificationType;
  actorUserId: string | null;
  title: string;
  body?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  commentId?: string | null;
  channelId?: string | null;
  messageId?: string | null;
  payload?: Record<string, unknown>;
  /** Stable per logical notification; combined with the recipient for idempotency. */
  dedupeKey: string;
};

/**
 * Inserts notifications idempotently (redelivered events are no-ops) and pushes each new row to
 * its recipient's realtime room. The actor never notifies themselves.
 */
export const deliverNotifications = async (draft: NotificationDraft) => {
  const recipients = [...new Set(draft.recipientIds)].filter((id) => id !== draft.actorUserId);
  if (recipients.length === 0) {
    return 0;
  }
  const sql = getSql();
  const inserted = await sql<(NotificationRow & { recipient_user_id: string })[]>`
    WITH active AS (
      SELECT om.user_id
      FROM public.organization_memberships om
      WHERE om.organization_id = ${draft.organizationId}
        AND om.user_id = ANY(${recipients}::uuid[])
        AND om.status = 'active'
        AND om.deleted_at IS NULL
    ), inserted AS (
      INSERT INTO public.notifications (
        organization_id, recipient_user_id, type, actor_user_id, project_id, task_id, comment_id, channel_id, message_id,
        title, body, payload, dedupe_key
      )
      SELECT ${draft.organizationId}, active.user_id, ${draft.type}, ${draft.actorUserId}, ${draft.projectId ?? null},
        ${draft.taskId ?? null}, ${draft.commentId ?? null}, ${draft.channelId ?? null}, ${draft.messageId ?? null},
        ${draft.title.slice(0, 300)}, ${draft.body ? draft.body.slice(0, 500) : null},
        ${sql.json((draft.payload ?? {}) as Parameters<typeof sql.json>[0])}, ${draft.dedupeKey.slice(0, 200)}
      FROM active
      ON CONFLICT (organization_id, recipient_user_id, dedupe_key) DO NOTHING
      RETURNING *
    )
    SELECT n.id, n.recipient_user_id, n.type, n.title, n.body, n.project_id, n.task_id, n.comment_id, n.channel_id,
      n.message_id, n.payload, n.created_at, n.read_at,
      (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = n.actor_user_id) AS actor
    FROM inserted n
  `;

  await afterNotificationsInserted(draft.organizationId, inserted);
  return inserted.length;
};

export type InsertedNotificationRow = NotificationRow & { recipient_user_id: string };

/** Live push (with the recipient's new unread count) and optional e-mail for freshly inserted rows. */
export const afterNotificationsInserted = async (organizationId: string, inserted: InsertedNotificationRow[]) => {
  if (inserted.length === 0) {
    return;
  }
  const sql = getSql();
  const unreadByUser = new Map<string, number>();
  for (const row of inserted) {
    if (!unreadByUser.has(row.recipient_user_id)) {
      unreadByUser.set(row.recipient_user_id, await countUnread(sql, organizationId, row.recipient_user_id));
    }
    publishToUsers([row.recipient_user_id], "notification:new", {
      notification: toNotification(row),
      unreadCount: unreadByUser.get(row.recipient_user_id) ?? 0
    });
  }

  // Optional e-mail (PD-013): only once SMTP is configured, and never at the expense of web delivery.
  if (isEmailEnabled()) {
    try {
      await enqueueNotificationEmails(organizationId, inserted);
    } catch (error) {
      logger.warn({ err: error, count: inserted.length }, "Queueing notification e-mails failed");
    }
  }
};

/** Columns of an inserted row for `afterNotificationsInserted` (alias `n`). */
export const insertedNotificationColumns = (sql: QuerySql) => sql`
  n.id, n.recipient_user_id, n.type, n.title, n.body, n.project_id, n.task_id, n.comment_id, n.channel_id,
  n.message_id, n.payload, n.created_at, n.read_at,
  (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = n.actor_user_id) AS actor
`;

/**
 * Inbox entries quoting content that no longer exists (a deleted chat message or comment) are removed;
 * recipients' badges are refreshed (BUG-WK-05).
 */
export const removeNotificationsAbout = async (input: {
  organizationId: string;
  messageId?: string | null;
  commentIds?: string[];
}) => {
  const commentIds = input.commentIds ?? [];
  if (!input.messageId && commentIds.length === 0) {
    return 0;
  }
  const sql = getSql();
  const removed = await sql<{ id: string; recipient_user_id: string }[]>`
    DELETE FROM public.notifications
    WHERE organization_id = ${input.organizationId}
      AND (
        (${input.messageId ?? null}::uuid IS NOT NULL AND message_id = ${input.messageId ?? null}::uuid)
        OR comment_id = ANY(${commentIds}::uuid[])
      )
    RETURNING id, recipient_user_id
  `;
  await publishInboxChanges(input.organizationId, removed);
  return removed.length;
};

/** An edited message / comment: inbox entries quoting it show the new text (BUG-WK-05). */
export const refreshNotificationExcerpts = async (input: {
  organizationId: string;
  messageId?: string | null;
  commentId?: string | null;
  excerpt: string;
}) => {
  if (!input.messageId && !input.commentId) {
    return 0;
  }
  const sql = getSql();
  const updated = await sql<{ id: string; recipient_user_id: string }[]>`
    UPDATE public.notifications
    SET body = ${input.excerpt.slice(0, 500) || null}
    WHERE organization_id = ${input.organizationId}
      AND body IS DISTINCT FROM ${input.excerpt.slice(0, 500) || null}
      AND (
        (${input.messageId ?? null}::uuid IS NOT NULL AND message_id = ${input.messageId ?? null}::uuid)
        OR (${input.commentId ?? null}::uuid IS NOT NULL AND comment_id = ${input.commentId ?? null}::uuid)
      )
    RETURNING id, recipient_user_id
  `;
  await publishInboxChanges(input.organizationId, updated);
  return updated.length;
};

/** Tells each affected recipient to refetch (the `notification:read` event carries the fresh unread count). */
const publishInboxChanges = async (organizationId: string, rows: { id: string; recipient_user_id: string }[]) => {
  const byUser = new Map<string, string[]>();
  for (const row of rows) {
    byUser.set(row.recipient_user_id, [...(byUser.get(row.recipient_user_id) ?? []), row.id]);
  }
  const sql = getSql();
  for (const [userId, ids] of byUser) {
    publishToUsers([userId], "notification:read", { ids, unreadCount: await countUnread(sql, organizationId, userId) });
  }
};

/** Removes inbox entries a user may no longer see (project or channel access revoked). */
export const purgeNotificationsFor = async (input: {
  organizationId: string;
  userIds: string[];
  projectId?: string;
  channelId?: string;
}) => {
  if (input.userIds.length === 0 || (!input.projectId && !input.channelId)) {
    return;
  }
  await getSql()`
    DELETE FROM public.notifications
    WHERE organization_id = ${input.organizationId}
      AND recipient_user_id = ANY(${input.userIds}::uuid[])
      AND (${input.projectId ?? null}::uuid IS NULL OR project_id = ${input.projectId ?? null}::uuid)
      AND (${input.channelId ?? null}::uuid IS NULL OR channel_id = ${input.channelId ?? null}::uuid)
  `;
};
