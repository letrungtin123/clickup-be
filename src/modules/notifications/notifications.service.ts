import { getSql } from "../../db/client.js";
import type {
  Notification,
  NotificationPage,
  NotificationType
} from "../../contracts/notifications.js";
import { NotificationTypeSchema } from "../../contracts/notifications.js";
import { AppError } from "../../lib/app-error.js";
import { decodeCursor, encodeCursor, toIso, type QuerySql } from "../../lib/db-types.js";
import { publishToUsers } from "../../realtime/publisher.js";
import type { AccessContext } from "../access/access-context.js";
import { toUserRef, type UserRefJson } from "../work/mappers.js";
import { userJsonSql } from "../work/tasks.repo.js";

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
    messageId: row.message_id
  },
  payload: row.payload,
  createdAt: toIso(row.created_at),
  readAt: row.read_at ? toIso(row.read_at) : null
});

const notificationColumns = (sql: QuerySql) => sql`
  n.id, n.type, n.title, n.body, n.project_id, n.task_id, n.comment_id, n.channel_id, n.message_id, n.payload, n.created_at, n.read_at,
  (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = n.actor_user_id) AS actor
`;

export const countUnread = async (sql: QuerySql, organizationId: string, userId: string) => {
  const rows = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM (
      SELECT 1 FROM public.notifications
      WHERE organization_id = ${organizationId} AND recipient_user_id = ${userId} AND read_at IS NULL AND archived_at IS NULL
      LIMIT 1000
    ) capped
  `;
  return rows[0]?.count ?? 0;
};

export const listNotifications = async (
  context: AccessContext,
  input: { filter: "all" | "unread"; cursor?: string | undefined; limit: number }
): Promise<NotificationPage> => {
  const sql = getSql();
  const cursor = decodeCursor(input.cursor, 2);
  if (input.cursor && !cursor) {
    throw new AppError("INVALID_CURSOR", "The pagination cursor is invalid.", 400);
  }
  const rows = await sql<NotificationRow[]>`
    SELECT ${notificationColumns(sql)}
    FROM public.notifications n
    WHERE n.organization_id = ${context.organization.id}
      AND n.recipient_user_id = ${context.user.id}
      AND n.archived_at IS NULL
      AND (${input.filter} = 'all' OR n.read_at IS NULL)
      AND (${cursor ? String(cursor[0]) : null}::timestamptz IS NULL
        OR (n.created_at, n.id) < (${cursor ? String(cursor[0]) : null}::timestamptz, ${cursor ? String(cursor[1]) : null}::uuid))
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT ${input.limit + 1}
  `;
  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  const hasMore = rows.length > input.limit;
  return {
    items: page.map(toNotification),
    pageInfo: { hasMore, nextCursor: hasMore && last ? encodeCursor([last.created_at.toISOString(), last.id]) : null },
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
  await sql`
    UPDATE public.notifications SET archived_at = now(), read_at = coalesce(read_at, now())
    WHERE organization_id = ${context.organization.id} AND recipient_user_id = ${context.user.id} AND id = ANY(${ids}::uuid[])
  `;
  const unreadCount = await countUnread(sql, context.organization.id, context.user.id);
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

  for (const row of inserted) {
    const unreadCount = await countUnread(sql, draft.organizationId, row.recipient_user_id);
    publishToUsers([row.recipient_user_id], "notification:new", { notification: toNotification(row), unreadCount });
  }
  return inserted.length;
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
