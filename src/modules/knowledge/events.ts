/**
 * Outbox event types of the knowledge base (PD-026: each one is handled by the notifications consumer,
 * knowledge/notifications.ts). Payloads never carry item content besides a short comment excerpt.
 */
export const knowledgeItemChangedEvent = "knowledge.item.changed";

export const knowledgeCommentEvents = {
  created: "knowledge.comment.created",
  updated: "knowledge.comment.updated",
  deleted: "knowledge.comment.deleted"
} as const;
