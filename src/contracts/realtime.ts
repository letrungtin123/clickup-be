import { z } from "zod";

import type {
  ChatChannelEvent,
  ChatMessageDeletedEvent,
  ChatMessageEvent,
  ChatMessageUpdatedEvent,
  ChatReactionEvent,
  ChatReadEvent
} from "./chat.js";
import type { NotificationArchivedEvent, NotificationNewEvent, NotificationReadEvent } from "./notifications.js";

/**
 * Realtime contract shared by the API gateway, the worker, and the SPA.
 * Realtime messages are hints for the client cache; PostgreSQL stays authoritative.
 */

/** "production": the organization's production module (id = organization id; production roles only). */
export const RealtimeRoomTypeSchema = z.enum(["project", "channel", "task", "production"]);
export type RealtimeRoomType = z.infer<typeof RealtimeRoomTypeSchema>;

export const RealtimeRoomRefSchema = z.object({
  type: RealtimeRoomTypeSchema,
  id: z.string().uuid()
});
export type RealtimeRoomRef = z.infer<typeof RealtimeRoomRefSchema>;

export const roomName = (ref: RealtimeRoomRef) => `${ref.type}:${ref.id}`;
export const userRoom = (userId: string) => `user:${userId}`;
export const orgRoom = (organizationId: string) => `org:${organizationId}`;

export const TypingInputSchema = z.object({
  channelId: z.string().uuid(),
  threadRootId: z.string().uuid().nullable().default(null)
});
export type TypingInput = z.infer<typeof TypingInputSchema>;

export const PresenceQuerySchema = z.object({
  userIds: z.array(z.string().uuid()).max(200)
});

export type RealtimeAck = { ok: true } | { ok: false; code: string };

/**
 * `session:refresh` (client → server, PERF-02): keeps an open socket alive across access-token refreshes.
 * Protocol: on `session:expiring` (sent ~60 s before the token expires) or after any successful
 * POST /auth/refresh, the client calls POST /auth/socket-ticket and emits `session:refresh` with the ticket.
 * ok → the socket now lives until `expiresAt` (seconds); not ok → fall back to disconnect + reconnect
 * (the handshake reads the new cookie). Sockets that never refresh are disconnected at token expiry.
 */
export const SessionRefreshInputSchema = z.object({ ticket: z.string().min(16).max(4000) });
export type SessionRefreshAck = { ok: true; expiresAt: number } | { ok: false; code: string };

export type TaskChangedEvent = {
  projectId: string;
  listId: string;
  taskId: string;
  parentTaskId: string | null;
  kind: "created" | "updated" | "deleted" | "moved";
  actorId: string;
  at: string;
};

export type TaskTimelineEvent = {
  projectId: string;
  taskId: string;
  actorId: string;
  at: string;
};

export type ProjectStructureEvent = {
  projectId: string;
  kind: "lists" | "statuses" | "members" | "project";
  at: string;
};

/** Sidebar refresh hint: only ids, never names (private projects are only hinted to people who can see them). */
export type SidebarHintEvent = {
  projectId: string;
  kind: "project" | "lists" | "members" | "removed";
  at: string;
};

/** Production jobs/tasks changed (cache hint: ids only). */
export type ProductionChangedEvent = {
  jobId: string;
  taskIds: string[];
  kind: "job" | "tasks" | "feedback" | "comment";
  actorId: string | null;
  at: string;
};

export type ChatTypingEvent = {
  channelId: string;
  threadRootId: string | null;
  userId: string;
};

export type GenericEnvelope = Record<string, unknown>;

/** Server → client event map. Chat and notification payload types are defined in their modules' schemas. */
export type ServerToClientEvents = {
  "task:changed": (event: TaskChangedEvent) => void;
  "task:timeline": (event: TaskTimelineEvent) => void;
  "project:structure": (event: ProjectStructureEvent) => void;
  "workspace:sidebar": (event: SidebarHintEvent) => void;
  "production:changed": (event: ProductionChangedEvent) => void;
  /** Leave calendar changed (cache hint for the production room; refetch /production/leave). */
  "production:leave": (event: { at: string }) => void;
  "chat:message": (event: ChatMessageEvent) => void;
  "chat:message:updated": (event: ChatMessageUpdatedEvent) => void;
  "chat:message:deleted": (event: ChatMessageDeletedEvent) => void;
  "chat:reaction": (event: ChatReactionEvent) => void;
  "chat:channel": (event: ChatChannelEvent) => void;
  "chat:read": (event: ChatReadEvent) => void;
  "chat:typing": (event: ChatTypingEvent) => void;
  "notification:new": (event: NotificationNewEvent) => void;
  "notification:read": (event: NotificationReadEvent) => void;
  "notification:archived": (event: NotificationArchivedEvent) => void;
  "access:revoked": (event: { room: RealtimeRoomRef }) => void;
  "session:expiring": (event: { expiresAt: number }) => void;
};

export type ClientToServerEvents = {
  "room:join": (room: unknown, ack: (result: RealtimeAck) => void) => void;
  "room:leave": (room: unknown, ack?: (result: RealtimeAck) => void) => void;
  "chat:typing": (input: unknown) => void;
  "presence:heartbeat": () => void;
  "presence:query": (input: unknown, ack: (result: { online: string[] }) => void) => void;
  "session:refresh": (input: unknown, ack: (result: SessionRefreshAck) => void) => void;
};
