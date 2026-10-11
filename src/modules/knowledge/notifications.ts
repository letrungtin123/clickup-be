import type { KnowledgeAccessLevel, KnowledgeImportance, KnowledgeStatusGroup } from "../../contracts/knowledge.js";
import type { NotificationType } from "../../contracts/notifications.js";
import { getSql } from "../../db/client.js";
import type { DomainEventEnvelope } from "../events/outbox.js";
import { deliverNotifications, refreshNotificationExcerpts, removeNotificationsAbout } from "../notifications/notifications.service.js";
import { loadReaderCandidates } from "./access.js";
import { knowledgeCommentEvents, knowledgeItemChangedEvent } from "./events.js";
import { itemReaders, planCommentNotifications, planItemNotifications } from "./rules.js";

/**
 * Knowledge notifications (PD-031) for the notifications consumer. Outbox events are written in the same
 * transaction as the change; every recipient list is re-filtered here with the item's current visibility (drafts:
 * submit+ and the author), the actor is never notified, and each person gets one notice per change.
 * E-mail (email-policy.ts): only knowledge.mentioned and knowledge.updated with payload.criticalVersion.
 */

type Handler = (event: DomainEventEnvelope) => Promise<void>;

const str = (value: unknown) => (typeof value === "string" ? value : null);
const bool = (value: unknown) => value === true;
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const strArray = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);

type ItemInfo = {
  id: string;
  title: string;
  space_id: string;
  space_name: string;
  visibility: "public" | "private";
  status_group: KnowledgeStatusGroup;
  status_name: string;
  importance: KnowledgeImportance;
  created_by: string | null;
  version: number;
};

/** The item as it is now, in a live space; null when it is gone, trashed, or its space archived / deleted. */
const loadItem = async (organizationId: string, itemId: string | null) => {
  if (!itemId) {
    return null;
  }
  const rows = await getSql()<ItemInfo[]>`
    SELECT i.id, i.title, i.space_id, s.name AS space_name, s.visibility, st.status_group, st.name AS status_name,
      i.importance, i.created_by, i.version
    FROM knowledge.items i
    JOIN knowledge.spaces s ON s.id = i.space_id AND s.deleted_at IS NULL AND s.archived_at IS NULL
    JOIN knowledge.statuses st ON st.id = i.status_id
    WHERE i.id = ${itemId} AND i.organization_id = ${organizationId} AND i.deleted_at IS NULL
  `;
  return rows[0] ?? null;
};

const loadFollowers = async (itemId: string) =>
  (await getSql()<{ user_id: string }[]>`SELECT user_id FROM knowledge.followers WHERE item_id = ${itemId} LIMIT 5000`).map((row) => row.user_id);

const loadMembers = async (spaceId: string) =>
  (
    await getSql()<{ user_id: string; access_level: KnowledgeAccessLevel }[]>`
      SELECT user_id, access_level FROM knowledge.space_members WHERE space_id = ${spaceId} LIMIT 5000
    `
  ).map((row) => ({ userId: row.user_id, level: row.access_level }));

/** Keeps the people who can read the item right now. */
const readersOf = async (organizationId: string, item: ItemInfo, userIds: string[]) => {
  if (userIds.length === 0) {
    return new Set<string>();
  }
  const candidates = await loadReaderCandidates(getSql(), organizationId, item.space_id, userIds);
  return new Set(itemReaders(candidates, { visibility: item.visibility }, { group: item.status_group, createdBy: item.created_by }));
};

const basePayload = (item: ItemInfo) => ({
  knowledgeSpaceId: item.space_id,
  knowledgeItemId: item.id,
  spaceName: item.space_name,
  importance: item.importance
});

const deliver = async (
  event: DomainEventEnvelope,
  item: ItemInfo,
  readers: Set<string>,
  type: NotificationType,
  recipients: string[],
  extra: { body?: string | null; commentId?: string | null; payload?: Record<string, unknown>; key: string }
) => {
  const allowed = recipients.filter((id) => readers.has(id));
  if (allowed.length === 0) {
    return;
  }
  await deliverNotifications({
    organizationId: event.organizationId,
    recipientIds: allowed,
    type,
    actorUserId: event.actorUserId,
    title: item.title,
    body: extra.body ?? null,
    commentId: extra.commentId ?? null,
    payload: { ...basePayload(item), ...(extra.commentId ? { commentId: extra.commentId } : {}), ...(extra.payload ?? {}) },
    dedupeKey: `evt:${event.id}:${extra.key}`
  });
};

const commentAlive = async (commentId: string | null) => {
  if (!commentId) {
    return false;
  }
  const rows = await getSql()<{ ok: number }[]>`SELECT 1 AS ok FROM knowledge.comments WHERE id = ${commentId} AND deleted_at IS NULL`;
  return rows.length > 0;
};

const onItemChanged: Handler = async (event) => {
  const item = await loadItem(event.organizationId, str(event.payload.itemId) ?? event.aggregateId);
  if (!item) {
    return;
  }
  const payload = event.payload;
  const plan = planItemNotifications({
    actorId: event.actorUserId,
    created: bool(payload.created),
    followers: await loadFollowers(item.id),
    members: await loadMembers(item.space_id),
    mentioned: strArray(payload.mentionedUserIds),
    approvalRequested: bool(payload.approvalRequested),
    statusChanged: bool(payload.statusChanged),
    newVersion: bool(payload.newVersion),
    published: bool(payload.published),
    importance: (str(payload.importance) as KnowledgeImportance | null) ?? item.importance,
    group: (str(payload.statusGroup) as KnowledgeStatusGroup | null) ?? item.status_group
  });
  const readers = await readersOf(event.organizationId, item, [
    ...plan.mentioned,
    ...plan.approval,
    ...plan.statusChanged,
    ...plan.updated,
    ...plan.broadcast
  ]);
  const version = num(payload.version) ?? Number(item.version);
  const statusName = str(payload.statusName) ?? item.status_name;
  const statusGroup = str(payload.statusGroup) ?? item.status_group;
  await deliver(event, item, readers, "knowledge.mentioned", plan.mentioned, { payload: { source: "body", version }, key: "mention" });
  await deliver(event, item, readers, "knowledge.approval_requested", plan.approval, { payload: { statusName, version }, key: "approval" });
  await deliver(event, item, readers, "knowledge.status_changed", plan.statusChanged, { payload: { statusName, statusGroup }, key: "status" });
  const versionPayload = {
    version,
    newVersion: bool(payload.newVersion),
    published: bool(payload.published),
    restoredFrom: num(payload.restoredFrom),
    criticalVersion: plan.criticalVersion,
    statusName
  };
  await deliver(event, item, readers, "knowledge.updated", plan.updated, { payload: { ...versionPayload, broadcast: false }, key: "updated" });
  await deliver(event, item, readers, "knowledge.updated", plan.broadcast, { payload: { ...versionPayload, broadcast: true }, key: "broadcast" });
};

const onCommentCreated: Handler = async (event) => {
  const commentId = str(event.payload.commentId);
  const item = await loadItem(event.organizationId, str(event.payload.itemId) ?? event.aggregateId);
  if (!item || !(await commentAlive(commentId))) {
    return;
  }
  const plan = planCommentNotifications({
    actorId: event.actorUserId,
    followers: await loadFollowers(item.id),
    mentioned: strArray(event.payload.mentionedUserIds),
    parentAuthorId: str(event.payload.parentAuthorId)
  });
  const readers = await readersOf(event.organizationId, item, [...plan.mentioned, ...plan.replied, ...plan.commented]);
  const common = {
    body: str(event.payload.excerpt),
    commentId,
    payload: { parentCommentId: str(event.payload.parentCommentId) }
  };
  await deliver(event, item, readers, "knowledge.mentioned", plan.mentioned, {
    ...common,
    payload: { ...common.payload, source: "comment" },
    key: "mention"
  });
  await deliver(event, item, readers, "knowledge.replied", plan.replied, { ...common, key: "reply" });
  await deliver(event, item, readers, "knowledge.commented", plan.commented, { ...common, key: "comment" });
};

const onCommentUpdated: Handler = async (event) => {
  const commentId = str(event.payload.commentId);
  if (!commentId) {
    return;
  }
  const current = (
    await getSql()<{ text: string; deleted: boolean }[]>`
      SELECT body_text AS text, deleted_at IS NOT NULL AS deleted FROM knowledge.comments WHERE id = ${commentId}
    `
  )[0];
  if (!current || current.deleted) {
    await removeNotificationsAbout({ organizationId: event.organizationId, commentIds: [commentId] });
    return;
  }
  // Existing inbox entries quote the new text; only people newly @mentioned by the edit are notified.
  await refreshNotificationExcerpts({ organizationId: event.organizationId, commentId, excerpt: current.text.slice(0, 280) });
  const item = await loadItem(event.organizationId, str(event.payload.itemId) ?? event.aggregateId);
  const mentioned = strArray(event.payload.addedMentionUserIds).filter((id) => id !== event.actorUserId);
  if (!item || mentioned.length === 0) {
    return;
  }
  const readers = await readersOf(event.organizationId, item, mentioned);
  await deliver(event, item, readers, "knowledge.mentioned", mentioned, {
    body: current.text.slice(0, 280),
    commentId,
    payload: { source: "comment" },
    key: "mention"
  });
};

const onCommentDeleted: Handler = async (event) => {
  await removeNotificationsAbout({ organizationId: event.organizationId, commentIds: strArray(event.payload.commentIds) });
};

export const knowledgeNotificationHandlers: Record<string, Handler> = {
  [knowledgeItemChangedEvent]: onItemChanged,
  [knowledgeCommentEvents.created]: onCommentCreated,
  [knowledgeCommentEvents.updated]: onCommentUpdated,
  [knowledgeCommentEvents.deleted]: onCommentDeleted
};
