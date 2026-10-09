import { z } from "zod";

/**
 * Realtime contract shared by the API gateway, the worker, and the SPA.
 * Realtime messages are hints for the client cache; PostgreSQL stays authoritative.
 */

export const RealtimeRoomTypeSchema = z.enum(["project", "channel", "task"]);
export type RealtimeRoomType = z.infer<typeof RealtimeRoomTypeSchema>;

export const RealtimeRoomRefSchema = z.object({
  type: RealtimeRoomTypeSchema,
  id: z.string().uuid()
});
export type RealtimeRoomRef = z.infer<typeof RealtimeRoomRefSchema>;

export const roomName = (ref: RealtimeRoomRef) => `${ref.type}:${ref.id}`;
export const userRoom = (userId: string) => `user:${userId}`;

export const TypingInputSchema = z.object({
  channelId: z.string().uuid(),
  threadRootId: z.string().uuid().nullable().default(null)
});
export type TypingInput = z.infer<typeof TypingInputSchema>;

export const PresenceQuerySchema = z.object({
  userIds: z.array(z.string().uuid()).max(200)
});

export type RealtimeAck = { ok: true } | { ok: false; code: string };

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
  "chat:message": (event: GenericEnvelope) => void;
  "chat:message:updated": (event: GenericEnvelope) => void;
  "chat:message:deleted": (event: GenericEnvelope) => void;
  "chat:reaction": (event: GenericEnvelope) => void;
  "chat:channel": (event: GenericEnvelope) => void;
  "chat:read": (event: GenericEnvelope) => void;
  "chat:typing": (event: ChatTypingEvent) => void;
  "notification:new": (event: GenericEnvelope) => void;
  "notification:read": (event: GenericEnvelope) => void;
  "access:revoked": (event: { room: RealtimeRoomRef }) => void;
  "session:expiring": (event: { expiresAt: number }) => void;
};

export type ClientToServerEvents = {
  "room:join": (room: unknown, ack: (result: RealtimeAck) => void) => void;
  "room:leave": (room: unknown, ack?: (result: RealtimeAck) => void) => void;
  "chat:typing": (input: unknown) => void;
  "presence:heartbeat": () => void;
  "presence:query": (input: unknown, ack: (result: { online: string[] }) => void) => void;
};
