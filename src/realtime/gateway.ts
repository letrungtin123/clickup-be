import type { Server as HttpServer } from "node:http";

import { createAdapter } from "@socket.io/redis-adapter";
import { Server, type Socket } from "socket.io";

import { corsOrigins, env } from "../config/env.js";
import {
  PresenceQuerySchema,
  RealtimeRoomRefSchema,
  SessionRefreshInputSchema,
  TypingInputSchema,
  orgRoom,
  roomName,
  userRoom,
  type ClientToServerEvents,
  type RealtimeRoomRef,
  type ServerToClientEvents
} from "../contracts/realtime.js";
import { AppError } from "../lib/app-error.js";
import { readCookieFromHeader } from "../lib/cookies.js";
import { logger } from "../lib/logger.js";
import { getOptionalRedis, getRedisSubscriber } from "../lib/redis.js";
import { assertPasswordCurrent, resolveAccessContext } from "../modules/access/access-context.js";
import { accessTokenCookieName } from "../modules/auth/auth.cookies.js";
import { verifySocketTicket } from "../modules/auth/socket-ticket.js";
import { isTokenRevoked, verifyAccessToken } from "../modules/auth/supabase-auth.service.js";
import { sessionRoom, setLocalRealtimeServer } from "./publisher.js";
import { authorizeRoom, type RoomAccess } from "./room-authorizers.js";

type SocketData = {
  userId: string;
  sessionId: string | null;
  organizationId: string;
  expiresAt: number;
  rooms: Map<string, Exclude<RoomAccess, null>>;
  lastTypingAt: Map<string, number>;
  bucket: { tokens: number; updatedAt: number };
};

type GatewaySocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type GatewayServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const maxRoomsPerSocket = 300;
const typingThrottleMs = 2_500;
const presenceWindowMs = 75_000;
const eventBucketSize = 30;
const eventRefillPerSecond = 15;

const presenceKey = (organizationId: string) => `presence:${organizationId}`;

/** Simple token bucket so one socket cannot flood the gateway with events. */
const takeToken = (socket: GatewaySocket) => {
  const now = Date.now();
  const bucket = socket.data.bucket;
  bucket.tokens = Math.min(eventBucketSize, bucket.tokens + ((now - bucket.updatedAt) / 1000) * eventRefillPerSecond);
  bucket.updatedAt = now;
  if (bucket.tokens < 1) {
    return false;
  }
  bucket.tokens -= 1;
  return true;
};

const touchPresence = async (socket: GatewaySocket) => {
  const redis = getOptionalRedis();
  if (!redis) {
    return;
  }
  await redis.zadd(presenceKey(socket.data.organizationId), Date.now(), socket.data.userId);
};

const isAllowedOrigin = (origin: string | undefined) => {
  if (!origin) {
    // Non-browser clients (tests, server-to-server) send no Origin; browsers always do.
    return env.NODE_ENV !== "production";
  }
  return corsOrigins.includes(origin);
};

export const attachRealtimeGateway = (httpServer: HttpServer): GatewayServer => {
  const io: GatewayServer = new Server(httpServer, {
    path: "/socket.io",
    serveClient: false,
    cors: { origin: corsOrigins, credentials: true },
    maxHttpBufferSize: 32 * 1024,
    pingInterval: 25_000,
    pingTimeout: 20_000,
    // Cross-site WebSocket hijacking guard: CORS does not apply to the websocket upgrade.
    allowRequest: (req, callback) => {
      callback(null, isAllowedOrigin(req.headers.origin));
    }
  });

  const redis = getOptionalRedis();
  if (redis) {
    io.adapter(createAdapter(redis.duplicate(), getRedisSubscriber()));
  } else {
    logger.warn("Realtime gateway running without Redis adapter (single instance only)");
  }

  const authenticate = async (socket: GatewaySocket) => {
    const token = readCookieFromHeader(socket.handshake.headers.cookie, accessTokenCookieName);
    if (!token) {
      throw new AppError("AUTH_REQUIRED", "Authentication is required.", 401);
    }

    const session = await verifyAccessToken(token);
    const context = assertPasswordCurrent(await resolveAccessContext(session.id));

    socket.data.userId = context.user.id;
    socket.data.organizationId = context.organization.id;
    socket.data.expiresAt = session.expiresAt;
    socket.data.sessionId = session.sessionId;
    socket.data.rooms = new Map();
    socket.data.lastTypingAt = new Map();
    socket.data.bucket = { tokens: eventBucketSize, updatedAt: Date.now() };
  };

  io.use((socket, next) => {
    authenticate(socket).then(
      () => next(),
      (error: unknown) => {
        const code = error instanceof AppError ? error.code : "AUTH_REQUIRED";
        next(Object.assign(new Error(code), { data: { code } }));
      }
    );
  });

  io.on("connection", (socket: GatewaySocket) => {
    void socket.join([
      userRoom(socket.data.userId),
      orgRoom(socket.data.organizationId),
      ...(socket.data.sessionId ? [sessionRoom(socket.data.sessionId)] : [])
    ]);
    void touchPresence(socket).catch(() => undefined);

    // At access-token expiry the socket is disconnected unless the client refreshed it in place
    // (`session:refresh` with a ticket from POST /auth/socket-ticket, PERF-02); 60 s before, it is warned.
    let expiryWarning: NodeJS.Timeout | undefined;
    let expiryTimer: NodeJS.Timeout | undefined;
    const scheduleExpiry = () => {
      clearTimeout(expiryWarning);
      clearTimeout(expiryTimer);
      const msUntilExpiry = socket.data.expiresAt * 1000 - Date.now();
      expiryWarning = setTimeout(
        () => socket.emit("session:expiring", { expiresAt: socket.data.expiresAt }),
        Math.max(0, msUntilExpiry - 60_000)
      );
      expiryTimer = setTimeout(() => socket.disconnect(true), Math.max(0, msUntilExpiry));
    };
    scheduleExpiry();

    socket.on("session:refresh", async (rawInput, ack) => {
      const reply = typeof ack === "function" ? ack : () => undefined;
      if (!takeToken(socket)) {
        reply({ ok: false, code: "RATE_LIMITED" });
        return;
      }
      const parsed = SessionRefreshInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        reply({ ok: false, code: "INVALID_TICKET" });
        return;
      }
      try {
        const claims = await verifySocketTicket(parsed.data.ticket);
        // Same person, same auth session (a new sign-in on this browser reconnects instead).
        if (claims.userId !== socket.data.userId || (socket.data.sessionId !== null && claims.sessionId !== socket.data.sessionId)) {
          reply({ ok: false, code: "SESSION_MISMATCH" });
          return;
        }
        if (claims.tokenExpiresAt * 1000 <= Date.now()) {
          reply({ ok: false, code: "TOKEN_EXPIRED" });
          return;
        }
        if (await isTokenRevoked(claims.userId, claims.sessionId, claims.tokenIssuedAt ?? undefined)) {
          reply({ ok: false, code: "SESSION_REVOKED" });
          socket.disconnect(true);
          return;
        }
        // Still an active member allowed to use the app (disabled accounts and pending password changes fail).
        assertPasswordCurrent(await resolveAccessContext(claims.userId));
        socket.data.expiresAt = Math.max(socket.data.expiresAt, claims.tokenExpiresAt);
        scheduleExpiry();
        reply({ ok: true, expiresAt: socket.data.expiresAt });
      } catch (error) {
        reply({ ok: false, code: error instanceof AppError ? error.code : "UNAVAILABLE" });
      }
    });

    socket.on("room:join", async (rawRoom, ack) => {
      const reply = typeof ack === "function" ? ack : () => undefined;
      if (!takeToken(socket)) {
        reply({ ok: false, code: "RATE_LIMITED" });
        return;
      }

      const parsed = RealtimeRoomRefSchema.safeParse(rawRoom);
      if (!parsed.success) {
        reply({ ok: false, code: "INVALID_ROOM" });
        return;
      }

      if (socket.data.rooms.size >= maxRoomsPerSocket) {
        reply({ ok: false, code: "TOO_MANY_ROOMS" });
        return;
      }

      try {
        const context = await resolveAccessContext(socket.data.userId);
        const access = await authorizeRoom(context, parsed.data.type, parsed.data.id);
        if (!access) {
          reply({ ok: false, code: "NOT_FOUND" });
          return;
        }

        const name = roomName(parsed.data);
        socket.data.rooms.set(name, access);
        await socket.join(name);
        reply({ ok: true });
      } catch (error) {
        logger.warn({ err: error, room: parsed.data }, "Realtime room authorization failed");
        reply({ ok: false, code: "UNAVAILABLE" });
      }
    });

    socket.on("room:leave", async (rawRoom, ack) => {
      const parsed = RealtimeRoomRefSchema.safeParse(rawRoom);
      if (parsed.success) {
        const name = roomName(parsed.data);
        socket.data.rooms.delete(name);
        await socket.leave(name);
      }
      if (typeof ack === "function") {
        ack({ ok: true });
      }
    });

    socket.on("chat:typing", (rawInput) => {
      if (!takeToken(socket)) {
        return;
      }
      const parsed = TypingInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return;
      }

      const room: RealtimeRoomRef = { type: "channel", id: parsed.data.channelId };
      const name = roomName(room);
      // Typing is only relayed from sockets that joined the channel with send access.
      if (socket.data.rooms.get(name) !== "submit" || !socket.rooms.has(name)) {
        return;
      }

      const throttleKey = `${parsed.data.channelId}:${parsed.data.threadRootId ?? ""}`;
      const now = Date.now();
      if (now - (socket.data.lastTypingAt.get(throttleKey) ?? 0) < typingThrottleMs) {
        return;
      }
      socket.data.lastTypingAt.set(throttleKey, now);

      socket.to(name).emit("chat:typing", {
        channelId: parsed.data.channelId,
        threadRootId: parsed.data.threadRootId,
        userId: socket.data.userId
      });
    });

    socket.on("presence:heartbeat", () => {
      if (takeToken(socket)) {
        void touchPresence(socket).catch(() => undefined);
      }
    });

    socket.on("presence:query", async (rawInput, ack) => {
      if (typeof ack !== "function") {
        return;
      }
      const parsed = PresenceQuerySchema.safeParse(rawInput);
      const redisClient = getOptionalRedis();
      if (!parsed.success || !redisClient || parsed.data.userIds.length === 0 || !takeToken(socket)) {
        ack({ online: [] });
        return;
      }

      try {
        const scores = await redisClient.zmscore(presenceKey(socket.data.organizationId), ...parsed.data.userIds);
        const cutoff = Date.now() - presenceWindowMs;
        ack({
          online: parsed.data.userIds.filter((_userId, index) => {
            const score = scores[index];
            return score !== null && score !== undefined && Number(score) >= cutoff;
          })
        });
      } catch {
        ack({ online: [] });
      }
    });

    socket.on("disconnect", () => {
      clearTimeout(expiryWarning);
      clearTimeout(expiryTimer);
      void (async () => {
        const remaining = await io.in(userRoom(socket.data.userId)).fetchSockets();
        const redisClient = getOptionalRedis();
        if (remaining.length === 0 && redisClient) {
          await redisClient.zrem(presenceKey(socket.data.organizationId), socket.data.userId);
        }
      })().catch(() => undefined);
    });
  });

  setLocalRealtimeServer(io);
  return io;
};
