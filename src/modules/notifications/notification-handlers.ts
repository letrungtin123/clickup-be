import { getSql } from "../../db/client.js";
import { logger } from "../../lib/logger.js";
import type { DomainEventEnvelope } from "../events/outbox.js";
import { deliverNotifications } from "./notifications.service.js";

type TaskInfo = {
  id: string;
  title: string;
  task_key: string;
  project_id: string;
  project_name: string;
  created_by: string | null;
  assignee_ids: string[];
};

const loadTask = async (organizationId: string, taskId: string) => {
  const sql = getSql();
  const rows = await sql<TaskInfo[]>`
    SELECT t.id, t.title, p.key || '-' || t.number AS task_key, t.project_id, p.name AS project_name, t.created_by,
      coalesce(array_agg(ta.assignee_user_id) FILTER (WHERE ta.assignee_user_id IS NOT NULL), '{}') AS assignee_ids
    FROM public.tasks t
    JOIN public.projects p ON p.id = t.project_id AND p.organization_id = t.organization_id AND p.deleted_at IS NULL
    LEFT JOIN public.task_assignees ta ON ta.task_id = t.id AND ta.organization_id = t.organization_id AND ta.removed_at IS NULL
    WHERE t.id = ${taskId} AND t.organization_id = ${organizationId} AND t.deleted_at IS NULL
    GROUP BY t.id, p.key, p.name
  `;
  return rows[0] ?? null;
};

/** Keeps only users who can currently see the project (visibility, membership, RBAC). */
export const filterProjectViewers = async (organizationId: string, projectId: string, userIds: string[]) => {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) {
    return [];
  }
  const sql = getSql();
  const rows = await sql<{ user_id: string }[]>`
    SELECT om.user_id
    FROM public.organization_memberships om
    JOIN public.roles r ON r.id = om.role_id AND r.organization_id = om.organization_id AND r.deleted_at IS NULL
    JOIN public.projects p ON p.id = ${projectId} AND p.organization_id = om.organization_id
    WHERE om.organization_id = ${organizationId}
      AND om.user_id = ANY(${unique}::uuid[])
      AND om.status = 'active' AND om.deleted_at IS NULL
      AND (
        r.key = 'superadmin'
        OR (
          EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_key = 'task.view')
          AND EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_key = 'project.view')
          AND (
            p.visibility = 'public'
            OR EXISTS (
              SELECT 1 FROM public.project_memberships pm
              WHERE pm.organization_id = om.organization_id AND pm.project_id = p.id AND pm.user_id = om.user_id
                AND pm.status = 'active' AND pm.deleted_at IS NULL
            )
          )
        )
      )
  `;
  return rows.map((row) => row.user_id);
};

const str = (value: unknown) => (typeof value === "string" ? value : null);
const strArray = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);

const taskTarget = (task: TaskInfo) => ({
  projectId: task.project_id,
  taskId: task.id,
  payloadBase: { taskKey: task.task_key, projectName: task.project_name }
});


/** Active org members whose role grants `permission` (superadmins always qualify). */
const filterByPermission = async (organizationId: string, userIds: string[], permission: string) => {
  if (userIds.length === 0) {
    return [];
  }
  const rows = await getSql()<{ user_id: string }[]>`
    SELECT om.user_id
    FROM public.organization_memberships om
    JOIN public.roles r ON r.id = om.role_id AND r.organization_id = om.organization_id AND r.deleted_at IS NULL
    WHERE om.organization_id = ${organizationId} AND om.user_id = ANY(${userIds}::uuid[])
      AND om.status = 'active' AND om.deleted_at IS NULL
      AND (r.key = 'superadmin' OR EXISTS (
        SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_key = ${permission}
      ))
  `;
  return rows.map((row) => row.user_id);
};

type ChatContext = { name: string | null; kind: string; text: string | null; threadRootId: string | null };

const loadChatMessage = async (event: DomainEventEnvelope, channelId: string, messageId: string) => {
  const sql = getSql();
  const row = (
    await sql<ChatContext[]>`
      SELECT c.name, c.kind, m.body_text AS text, m.thread_root_id AS "threadRootId"
      FROM public.channels c
      LEFT JOIN public.messages m ON m.id = ${messageId} AND m.organization_id = c.organization_id AND m.deleted_at IS NULL
      WHERE c.id = ${channelId} AND c.organization_id = ${event.organizationId} AND c.deleted_at IS NULL
    `
  )[0];
  return row && row.text !== null ? row : null;
};

/** Private conversations only notify current members; public channels may notify any org member. */
const currentMembers = async (event: DomainEventEnvelope, channelId: string, userIds: string[]) => {
  if (userIds.length === 0) {
    return [];
  }
  const rows = await getSql()<{ user_id: string }[]>`
    SELECT user_id FROM public.channel_members
    WHERE organization_id = ${event.organizationId} AND channel_id = ${channelId}
      AND user_id = ANY(${userIds}::uuid[]) AND deleted_at IS NULL
  `;
  return rows.map((row) => row.user_id);
};

const notifyChatMentions = async (event: DomainEventEnvelope, mentioned: string[]) => {
  const channelId = str(event.payload.channelId);
  const messageId = str(event.payload.messageId) ?? event.aggregateId;
  if (mentioned.length === 0 || !channelId || !messageId) {
    return;
  }
  const chat = await loadChatMessage(event, channelId, messageId);
  if (!chat) {
    return;
  }
  // Public channels may notify non-members, but only people whose role can see channels at all.
  const recipients =
    chat.kind === "public"
      ? await filterByPermission(event.organizationId, mentioned, "channel.view")
      : await currentMembers(event, channelId, mentioned);
  await deliverNotifications({
    organizationId: event.organizationId,
    recipientIds: recipients,
    type: "chat.mentioned",
    actorUserId: str(event.payload.authorId) ?? event.actorUserId,
    title: chat.name ?? "Direct message",
    body: chat.text,
    channelId,
    messageId,
    payload: { channelKind: chat.kind, threadRootId: chat.threadRootId },
    dedupeKey: `evt:${event.id}:mention`
  });
};

/** A thread reply notifies the root author and earlier repliers (minus anyone already @mentioned). */
const notifyThreadParticipants = async (event: DomainEventEnvelope) => {
  const channelId = str(event.payload.channelId);
  const messageId = str(event.payload.messageId) ?? event.aggregateId;
  const threadRootId = str(event.payload.threadRootId);
  if (!channelId || !messageId || !threadRootId) {
    return;
  }
  const chat = await loadChatMessage(event, channelId, messageId);
  if (!chat) {
    return;
  }
  const participants = await getSql()<{ author_user_id: string }[]>`
    SELECT DISTINCT author_user_id FROM public.messages
    WHERE organization_id = ${event.organizationId} AND channel_id = ${channelId}
      AND (id = ${threadRootId} OR thread_root_id = ${threadRootId})
      AND deleted_at IS NULL AND kind = 'user'
    LIMIT 200
  `;
  const mentioned = new Set(strArray(event.payload.mentionedUserIds));
  const candidates = participants.map((row) => row.author_user_id).filter((id) => !mentioned.has(id));
  await deliverNotifications({
    organizationId: event.organizationId,
    recipientIds: await currentMembers(event, channelId, candidates),
    type: "chat.thread_replied",
    actorUserId: str(event.payload.authorId) ?? event.actorUserId,
    title: chat.name ?? "Direct message",
    body: chat.text,
    channelId,
    messageId,
    payload: { channelKind: chat.kind, threadRootId },
    dedupeKey: `evt:${event.id}:thread`
  });
};

type Handler = (event: DomainEventEnvelope) => Promise<void>;

const handlers: Record<string, Handler> = {
  "task.assigned": async (event) => {
    const task = await loadTask(event.organizationId, event.aggregateId ?? "");
    if (!task) {
      return;
    }
    const recipients = await filterProjectViewers(event.organizationId, task.project_id, strArray(event.payload.assigneeIds));
    const target = taskTarget(task);
    await deliverNotifications({
      organizationId: event.organizationId,
      recipientIds: recipients,
      type: "task.assigned",
      actorUserId: event.actorUserId,
      title: task.title,
      projectId: target.projectId,
      taskId: target.taskId,
      payload: { ...target.payloadBase, reopened: event.payload.reopened === true },
      dedupeKey: `evt:${event.id}`
    });
  },

  "task.mentioned": async (event) => {
    const task = await loadTask(event.organizationId, event.aggregateId ?? "");
    if (!task) {
      return;
    }
    const recipients = await filterProjectViewers(event.organizationId, task.project_id, strArray(event.payload.userIds));
    const target = taskTarget(task);
    await deliverNotifications({
      organizationId: event.organizationId,
      recipientIds: recipients,
      type: "task.mentioned",
      actorUserId: event.actorUserId,
      title: task.title,
      projectId: target.projectId,
      taskId: target.taskId,
      commentId: str(event.payload.commentId),
      payload: { ...target.payloadBase, source: str(event.payload.source) },
      dedupeKey: `evt:${event.id}`
    });
  },

  "task.comment.created": async (event) => {
    const task = await loadTask(event.organizationId, event.aggregateId ?? "");
    if (!task) {
      return;
    }
    const mentioned = new Set(strArray(event.payload.mentionedUserIds));
    const parentAuthor = str(event.payload.parentAuthorId);
    const followers = [...task.assignee_ids, ...(task.created_by ? [task.created_by] : [])].filter((id) => !mentioned.has(id));
    const target = taskTarget(task);
    const common = {
      organizationId: event.organizationId,
      actorUserId: event.actorUserId,
      title: task.title,
      body: str(event.payload.excerpt),
      projectId: target.projectId,
      taskId: target.taskId,
      commentId: str(event.payload.commentId),
      payload: target.payloadBase
    };
    if (parentAuthor && !mentioned.has(parentAuthor)) {
      await deliverNotifications({
        ...common,
        recipientIds: await filterProjectViewers(event.organizationId, task.project_id, [parentAuthor]),
        type: "task.replied",
        dedupeKey: `evt:${event.id}:reply`
      });
    }
    await deliverNotifications({
      ...common,
      recipientIds: await filterProjectViewers(
        event.organizationId,
        task.project_id,
        followers.filter((id) => id !== parentAuthor)
      ),
      type: "task.commented",
      dedupeKey: `evt:${event.id}`
    });
  },

  "task.status_changed": async (event) => {
    const task = await loadTask(event.organizationId, event.aggregateId ?? "");
    if (!task) {
      return;
    }
    const recipients = await filterProjectViewers(event.organizationId, task.project_id, [
      ...task.assignee_ids,
      ...(task.created_by ? [task.created_by] : [])
    ]);
    const target = taskTarget(task);
    await deliverNotifications({
      organizationId: event.organizationId,
      recipientIds: recipients,
      type: "task.status_changed",
      actorUserId: event.actorUserId,
      title: task.title,
      projectId: target.projectId,
      taskId: target.taskId,
      payload: { ...target.payloadBase, statusName: str(event.payload.statusName), isDone: event.payload.isDone === true },
      dedupeKey: `evt:${event.id}`
    });
  },

  "project.member_added": async (event) => {
    if (event.payload.isNew !== true || !event.aggregateId) {
      return;
    }
    const sql = getSql();
    const project = (
      await sql<{ name: string }[]>`
        SELECT name FROM public.projects WHERE id = ${event.aggregateId} AND organization_id = ${event.organizationId} AND deleted_at IS NULL
      `
    )[0];
    const userId = str(event.payload.userId);
    if (!project || !userId) {
      return;
    }
    await deliverNotifications({
      organizationId: event.organizationId,
      recipientIds: [userId],
      type: "project.member_added",
      actorUserId: event.actorUserId,
      title: project.name,
      projectId: event.aggregateId,
      payload: { accessLevel: str(event.payload.accessLevel), projectName: project.name },
      dedupeKey: `evt:${event.id}`
    });
  },

  "chat.message.created": async (event) => {
    await notifyChatMentions(event, strArray(event.payload.mentionedUserIds));
    await notifyThreadParticipants(event);
  },

  "chat.message.updated": async (event) => {
    // Only people newly mentioned by an edit are notified.
    await notifyChatMentions(event, strArray(event.payload.addedMentionUserIds));
  },

  "chat.channel.member_added": async (event) => {
    const channelId = str(event.payload.channelId) ?? event.aggregateId;
    if (!channelId) {
      return;
    }
    const sql = getSql();
    const channel = (
      await sql<{ name: string | null; kind: string }[]>`
        SELECT name, kind FROM public.channels WHERE id = ${channelId} AND organization_id = ${event.organizationId} AND deleted_at IS NULL
      `
    )[0];
    if (!channel || (channel.kind !== "public" && channel.kind !== "private")) {
      return;
    }
    await deliverNotifications({
      organizationId: event.organizationId,
      recipientIds: strArray(event.payload.userIds),
      type: "channel.member_added",
      actorUserId: str(event.payload.addedBy) ?? event.actorUserId,
      title: channel.name ?? "Channel",
      channelId,
      payload: { channelKind: channel.kind },
      dedupeKey: `evt:${event.id}`
    });
  }
};

export const notificationBindings = Object.keys(handlers);

export const handleNotificationEvent = async (event: DomainEventEnvelope) => {
  const handler = handlers[event.type];
  if (!handler) {
    logger.debug({ type: event.type }, "No notification handler");
    return;
  }
  await handler(event);
};
