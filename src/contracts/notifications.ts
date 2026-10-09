import { z } from "zod";

import { createCursorPageSchema } from "./pagination.js";
import { UserRefSchema } from "./work.js";

/** Inbox / notification contract. Shared FE/BE. */

const Id = z.string().uuid();
const IsoDate = z.string().datetime({ offset: true });

export const notificationTypes = [
  "task.assigned",
  "task.mentioned",
  "task.commented",
  "task.replied",
  "task.status_changed",
  "task.due_soon",
  "task.overdue",
  "project.member_added",
  "chat.mentioned",
  "chat.thread_replied",
  "channel.member_added",
  // Production (Photo Retouch) module — PLAN §8. Target: productionTaskId / jobId.
  "production.task_assigned",
  "production.task_waiting_qc",
  "production.qc_failed",
  "production.task_checked",
  "production.task_due_soon",
  "production.task_late",
  "production.qty_changed",
  "production.feedback",
  "production.mentioned",
  "production.commented",
  "production.leave_requested",
  "production.leave_decided",
  "production.kpi_settled"
] as const;
export const NotificationTypeSchema = z.enum(notificationTypes);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

export const NotificationTargetSchema = z.object({
  projectId: Id.nullable(),
  taskId: Id.nullable(),
  taskKey: z.string().nullable(),
  commentId: Id.nullable(),
  channelId: Id.nullable(),
  messageId: Id.nullable(),
  /** Production module targets (production.* types). */
  productionTaskId: Id.nullable().default(null),
  jobId: Id.nullable().default(null)
});

export const NotificationSchema = z.object({
  id: Id,
  type: NotificationTypeSchema,
  actor: UserRefSchema.nullable(),
  /** Subject line (task title, channel name, project name) — the client composes the sentence per type. */
  title: z.string(),
  /** Optional excerpt (comment / message text). */
  body: z.string().nullable(),
  target: NotificationTargetSchema,
  /** Type-specific extras, e.g. { statusName, dueAt, projectName }. */
  payload: z.record(z.string(), z.unknown()),
  createdAt: IsoDate,
  readAt: IsoDate.nullable()
});
export type Notification = z.infer<typeof NotificationSchema>;

export const NotificationPageSchema = createCursorPageSchema(NotificationSchema).extend({
  unreadCount: z.number().int()
});
export type NotificationPage = z.infer<typeof NotificationPageSchema>;

export const NotificationQuerySchema = z.object({
  filter: z.enum(["all", "unread"]).default("all"),
  /** Comma-separated notification types (e.g. the "Nhắc đến" tab); omitted = every type. */
  types: z
    .string()
    .max(500)
    .optional()
    .transform((value) => (value ? [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))] : undefined))
    .pipe(z.array(NotificationTypeSchema).max(20).optional()),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30)
});

export const MarkNotificationsReadRequestSchema = z
  .object({
    ids: z.array(Id).max(200).optional(),
    all: z.boolean().optional()
  })
  .strict()
  .refine((value) => value.all === true || (value.ids?.length ?? 0) > 0, { message: "Provide ids or all." });

export const ArchiveNotificationsRequestSchema = z.object({ ids: z.array(Id).min(1).max(200) }).strict();

export const UnreadCountSchema = z.object({ unreadCount: z.number().int() });

/** `notification:new` → room user:<id>. */
export type NotificationNewEvent = { notification: Notification; unreadCount: number };
/** `notification:read` → room user:<id> (multi-device sync). */
export type NotificationReadEvent = { ids: string[] | "all"; unreadCount: number };
/** `notification:archived` → room user:<id> (other tabs/devices drop the archived entries, BUG-WK-48). */
export type NotificationArchivedEvent = { ids: string[]; unreadCount: number };
