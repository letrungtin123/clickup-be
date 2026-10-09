import { Emitter } from "@socket.io/redis-emitter";
import type { Server } from "socket.io";

import type { RealtimeRoomRef, ServerToClientEvents } from "../contracts/realtime.js";
import { roomName, userRoom } from "../contracts/realtime.js";
import { logger } from "../lib/logger.js";
import { getOptionalRedis } from "../lib/redis.js";

type EventName = keyof ServerToClientEvents;
type EventPayload<Name extends EventName> = Parameters<ServerToClientEvents[Name]>[0];

let localServer: Server | undefined;
let emitter: Emitter<ServerToClientEvents> | undefined;

/** Registered by the API process once Socket.IO is attached; the worker never sets it. */
export const setLocalRealtimeServer = (server: Server | undefined) => {
  localServer = server;
};

const getEmitter = () => {
  if (emitter) {
    return emitter;
  }

  const redis = getOptionalRedis();
  if (!redis) {
    return undefined;
  }

  emitter = new Emitter<ServerToClientEvents>(redis);
  return emitter;
};

const target = (rooms: string[]) => {
  const redisEmitter = getEmitter();
  if (redisEmitter) {
    return redisEmitter.to(rooms);
  }

  return localServer?.to(rooms);
};

/**
 * Publishes a realtime hint. Always call after the database transaction has committed.
 * Failures are logged, never thrown: realtime must not break a successful write.
 */
export const publishToRooms = <Name extends EventName>(rooms: string[], event: Name, payload: EventPayload<Name>) => {
  if (rooms.length === 0) {
    return;
  }

  try {
    const operator = target(rooms) as { emit: (event: string, payload: unknown) => unknown } | undefined;
    operator?.emit(event, payload);
  } catch (error) {
    logger.warn({ err: error, event }, "Realtime publish failed");
  }
};

export const publishToRoom = <Name extends EventName>(room: RealtimeRoomRef, event: Name, payload: EventPayload<Name>) => {
  publishToRooms([roomName(room)], event, payload);
};

export const publishToUsers = <Name extends EventName>(userIds: string[], event: Name, payload: EventPayload<Name>) => {
  publishToRooms([...new Set(userIds)].map(userRoom), event, payload);
};

/** Room name for every socket opened with one auth session (closed on logout). */
export const sessionRoom = (sessionId: string) => `session:${sessionId}`;

/** Disconnects every socket in the given raw rooms, cluster-wide. */
export const disconnectRooms = (rooms: string[]) => {
  if (rooms.length === 0) {
    return;
  }
  try {
    const redisEmitter = getEmitter();
    if (redisEmitter) {
      redisEmitter.in(rooms).disconnectSockets(true);
    } else {
      localServer?.in(rooms).disconnectSockets(true);
    }
  } catch (error) {
    logger.warn({ err: error }, "Realtime disconnect failed");
  }
};

/**
 * Re-authorizes a whole room (e.g. project became private): everyone is told access was revoked
 * and removed; clients re-join and only those still authorized get back in.
 */
export const resetRoom = (room: RealtimeRoomRef) => {
  try {
    publishToRooms([roomName(room)], "access:revoked", { room });
    const redisEmitter = getEmitter();
    if (redisEmitter) {
      redisEmitter.in(roomName(room)).socketsLeave(roomName(room));
    } else {
      localServer?.in(roomName(room)).socketsLeave(roomName(room));
    }
  } catch (error) {
    logger.warn({ err: error, room }, "Realtime room reset failed");
  }
};

/** Disconnects every live socket of the given users, cluster-wide (account disabled, password reset). */
export const disconnectUsers = (userIds: string[]) => {
  if (userIds.length === 0) {
    return;
  }
  const rooms = [...new Set(userIds)].map(userRoom);
  try {
    const redisEmitter = getEmitter();
    if (redisEmitter) {
      redisEmitter.in(rooms).disconnectSockets(true);
    } else {
      localServer?.in(rooms).disconnectSockets(true);
    }
  } catch (error) {
    logger.warn({ err: error }, "Realtime disconnect failed");
  }
};

/** Removes every socket of the given users from a room (e.g. after membership removal), cluster-wide. */
export const evictUsersFromRoom = (userIds: string[], room: RealtimeRoomRef) => {
  if (userIds.length === 0) {
    return;
  }

  const rooms = [...new Set(userIds)].map(userRoom);
  try {
    const redisEmitter = getEmitter();
    if (redisEmitter) {
      redisEmitter.in(rooms).socketsLeave(roomName(room));
    } else {
      localServer?.in(rooms).socketsLeave(roomName(room));
    }
    publishToRooms(rooms, "access:revoked", { room });
  } catch (error) {
    logger.warn({ err: error, room }, "Realtime eviction failed");
  }
};
