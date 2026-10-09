# Nesso Work — Backend

Express 5 + TypeScript API and background worker for Nesso Work, an internal ClickUp-style work-management platform with realtime chat.

- **API** (`src/server.ts`): REST under `/api/v1` and a Socket.IO gateway at `/socket.io`.
- **Worker** (`src/worker.ts`): moves the transactional outbox to RabbitMQ, runs the notification consumers, and sends deadline reminders.
- **Data**: PostgreSQL on self-hosted Supabase (Auth, Storage), Redis (Socket.IO adapter, presence, caches, rate limits), and RabbitMQ (durable events).

## Modules

| Module | Responsibility |
| --- | --- |
| `modules/auth` | Login, refresh, logout, local JWT verification, session revocation, GoTrue admin |
| `modules/access` | Cached access context (org, role, permissions), project access, visibility |
| `modules/workspace` | Roles, permissions, member provisioning (temporary passwords), password change |
| `modules/work` | Projects, lists, status workflows, tasks (List/Board/Table queries), timeline, comments, attachments, directory, trash |
| `modules/chat` | Public and private channels, DMs, messages, threads, reactions, read state, chat search |
| `modules/notifications` | Inbox API, RabbitMQ consumers, deadline scheduler |
| `modules/search` | Global search across tasks, projects, lists, people, and messages |
| `realtime/` | Socket.IO gateway (cookie auth, origin guard, per-room authorization), Redis emitter |

## Security model

- HttpOnly session cookies. Access tokens are verified locally (HS256, issuer, audience, expiry). Revoked sessions and user-wide revocations are tracked in Redis.
- Double-submit CSRF token on every unsafe request.
- Rate limits are distributed through Redis.
- Every request is authorized as: organization boundary + RBAC capability + resource membership (projects, channels).
- Rich text is stored as allow-listed Tiptap JSON (never HTML).
- Files go directly to private Storage through short-lived signed URLs.

## Running

```bash
corepack pnpm install
cp .env.example .env   # fill in Supabase, Redis, and RabbitMQ values
corepack pnpm dev        # API on 127.0.0.1:3890
corepack pnpm dev:worker # outbox relay + consumers
corepack pnpm typecheck && corepack pnpm lint && corepack pnpm test
```

The database migrations (manual SQL) and the Redis/RabbitMQ docker-compose files live in the platform monorepo under `supabase/manual_sql/` and `infra/`.
