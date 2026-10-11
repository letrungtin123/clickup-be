/**
 * Final passes after the timeline ran: backdating (real execution time → planned time), chat read markers,
 * a curated inbox, mention-label refresh, and the summary.
 */
import type postgres from "postgres";

import { commentLimits, descriptionLimits, messageLimits, type SanitizeLimits } from "../../src/contracts/rich-text.js";
import { sanitizeWithMentionLabels } from "../../src/lib/mentions.js";
import type { SeedEnv } from "./env.js";
import { DAY, HOUR, MINUTE, Rng, at, hash } from "./time.js";
import type { PersonaKey } from "./types.js";

export type Scope = { projectIds: string[]; channelIds: string[] };

type Tx = postgres.TransactionSql;

/** Seeded projects / channels (natural keys + creators), used by backdating, the inbox and --reset. */
export const loadScope = async (env: SeedEnv, projectKeys: string[], channelNames: string[]): Promise<Scope> => {
  const sql = env.sql;
  const personaIds = [...env.personas.values()].map((persona) => persona.id);
  const projects = await sql<{ id: string }[]>`
    SELECT id FROM public.projects
    WHERE organization_id = ${env.organizationId} AND key = ANY(${projectKeys}::text[]) AND created_by = ANY(${personaIds}::uuid[])
  `;
  const channels = await sql<{ id: string }[]>`
    SELECT c.id FROM public.channels c
    WHERE c.organization_id = ${env.organizationId} AND c.deleted_at IS NULL
      AND (
        (c.kind IN ('public', 'private') AND c.name = ANY(${channelNames}::text[]) AND c.created_by = ANY(${personaIds}::uuid[]))
        OR (c.kind IN ('dm', 'group_dm') AND EXISTS (
          SELECT 1 FROM public.messages m
          WHERE m.organization_id = c.organization_id AND m.channel_id = c.id AND m.client_message_id::text LIKE '5eed5eed%'
        ))
      )
  `;
  return { projectIds: projects.map((row) => row.id), channelIds: channels.map((row) => row.id) };
};

// Backdating -----------------------------------------------------------------------------------------------------

/**
 * Every row the services wrote carries the real execution time. Each action recorded (real start, planned
 * time); a timestamp x maps to planned(k) + (x − real(k)) for the last action k that started at or before x.
 * Runs with session_replication_role = replica so set_updated_at() triggers keep the mapped values.
 */
export const backdate = async (env: SeedEnv, scope: Scope, clock: { real: string; planned: string }[]) => {
  if (clock.length === 0) {
    return;
  }
  const { projectIds, channelIds } = scope;
  await env.sql.begin(async (tx: Tx) => {
    await tx`SET LOCAL session_replication_role = replica`;
    await tx`SET LOCAL statement_timeout = 0`;
    await tx`CREATE TEMP TABLE seed_clock (real timestamptz NOT NULL, planned timestamptz NOT NULL) ON COMMIT DROP`;
    for (let index = 0; index < clock.length; index += 5000) {
      const chunk = clock.slice(index, index + 5000);
      await tx`
        INSERT INTO seed_clock (real, planned)
        SELECT r::timestamptz, p::timestamptz FROM unnest(${chunk.map((row) => row.real)}::text[], ${chunk.map((row) => row.planned)}::text[]) AS u(r, p)
      `;
    }
    await tx`CREATE INDEX ON seed_clock (real)`;
    await tx`ANALYZE seed_clock`;
    await tx.unsafe(`
      CREATE OR REPLACE FUNCTION pg_temp.seed_map(x timestamptz) RETURNS timestamptz LANGUAGE sql STABLE AS $$
        SELECT CASE
          WHEN x IS NULL OR x < (SELECT min(real) FROM seed_clock) THEN x
          ELSE coalesce((SELECT c.planned + (x - c.real) FROM seed_clock c WHERE c.real <= x ORDER BY c.real DESC LIMIT 1), x)
        END
      $$
    `);
    const map = (columns: string[]) => columns.map((column) => `${column} = pg_temp.seed_map(${column})`).join(", ");
    const run = async (table: string, columns: string[], where: string, params: unknown[]) => {
      await tx.unsafe(`UPDATE ${table} SET ${map(columns)} WHERE ${where}`, params as never[]);
    };
    const inProjects = "project_id = ANY($1::uuid[])";
    const taskScope = "task_id IN (SELECT id FROM public.tasks WHERE project_id = ANY($1::uuid[]))";
    await run("public.projects", ["created_at", "updated_at", "archived_at"], "id = ANY($1::uuid[])", [projectIds]);
    await run("public.project_memberships", ["created_at", "updated_at", "deleted_at"], inProjects, [projectIds]);
    await run("public.lists", ["created_at", "updated_at", "archived_at", "deleted_at"], inProjects, [projectIds]);
    await run(
      "public.task_statuses",
      ["created_at", "updated_at", "deleted_at"],
      "(project_id = ANY($1::uuid[]) OR list_id IN (SELECT id FROM public.lists WHERE project_id = ANY($1::uuid[])))",
      [projectIds]
    );
    await run("public.tasks", ["created_at", "updated_at", "completed_at", "deleted_at", "archived_at"], inProjects, [projectIds]);
    await run("public.task_assignees", ["assigned_at", "removed_at"], taskScope, [projectIds]);
    await run("public.task_activity_events", ["created_at"], taskScope, [projectIds]);
    await run("public.task_comments", ["created_at", "updated_at", "edited_at", "deleted_at"], taskScope, [projectIds]);
    await run("public.task_attachments", ["created_at", "completed_at", "deleted_at"], inProjects, [projectIds]);
    await run("public.channels", ["created_at", "updated_at", "last_message_at", "archived_at"], "id = ANY($1::uuid[])", [channelIds]);
    const inChannels = "channel_id = ANY($1::uuid[])";
    await run("public.channel_members", ["joined_at", "updated_at", "last_read_at", "deleted_at"], inChannels, [channelIds]);
    await run("public.messages", ["created_at", "updated_at", "edited_at", "deleted_at", "last_reply_at"], inChannels, [channelIds]);
    await run("public.message_mentions", ["created_at"], inChannels, [channelIds]);
    await run("public.message_reactions", ["created_at"], inChannels, [channelIds]);
    await run("public.message_attachments", ["created_at", "completed_at", "deleted_at"], inChannels, [channelIds]);
    // Invariants: updated_at ≥ created_at; a done task's completion after creation.
    await tx`UPDATE public.tasks SET updated_at = greatest(updated_at, created_at), completed_at = CASE WHEN completed_at IS NULL THEN NULL ELSE greatest(completed_at, created_at) END WHERE project_id = ANY(${projectIds}::uuid[])`;
    await tx`UPDATE public.task_comments SET updated_at = greatest(updated_at, coalesce(edited_at, created_at), created_at) WHERE task_id IN (SELECT id FROM public.tasks WHERE project_id = ANY(${projectIds}::uuid[]))`;
    await tx`UPDATE public.messages SET updated_at = greatest(updated_at, coalesce(edited_at, created_at), coalesce(deleted_at, created_at), created_at) WHERE channel_id = ANY(${channelIds}::uuid[])`;
    await tx`
      UPDATE public.channels c SET last_message_at = sub.last_at
      FROM (SELECT channel_id, max(created_at) AS last_at FROM public.messages WHERE channel_id = ANY(${channelIds}::uuid[]) AND seq IS NOT NULL GROUP BY channel_id) sub
      WHERE c.id = sub.channel_id
    `;
  });
};

// Read markers -----------------------------------------------------------------------------------------------

export const setReadMarkers = async (env: SeedEnv, scope: Scope) => {
  const sql = env.sql;
  const rng = new Rng(hash("read-markers"));
  const now = env.now;
  const byId = new Map([...env.personas.values()].map((persona) => [persona.id, persona.key]));
  const members = await sql<{ id: string; channel_id: string; user_id: string; kind: string; name: string | null; joined_at: Date; archived: boolean }[]>`
    SELECT cm.id, cm.channel_id, cm.user_id, c.kind, c.name, cm.joined_at, c.archived_at IS NOT NULL AS archived
    FROM public.channel_members cm JOIN public.channels c ON c.id = cm.channel_id
    WHERE cm.channel_id = ANY(${scope.channelIds}::uuid[]) AND cm.deleted_at IS NULL
  `;
  const messages = await sql<{ channel_id: string; seq: string; created_at: Date; author_user_id: string | null; mentions: string[] }[]>`
    SELECT channel_id, seq::text, created_at, author_user_id, mentioned_user_ids AS mentions
    FROM public.messages
    WHERE channel_id = ANY(${scope.channelIds}::uuid[]) AND seq IS NOT NULL
    ORDER BY channel_id, messages.seq
  `;
  const byChannel = new Map<string, (typeof messages)[number][]>();
  for (const message of messages) {
    byChannel.set(message.channel_id, [...(byChannel.get(message.channel_id) ?? []), message]);
  }

  // When each person last looked at the app.
  const lastActive = new Map<string, number>();
  const office: PersonaKey[] = ["linh", "admin", "minh", "an", "khoa", "acc1", "acc2"];
  for (const persona of env.personas.values()) {
    let t: number;
    if (persona.leftAt !== null) {
      t = persona.leftAt;
    } else if (persona.key === "boss") {
      // Leave the newest few @mentions of the director unread.
      const mentions = messages
        .filter((message) => message.mentions.includes(persona.id) && message.author_user_id !== persona.id)
        .map((message) => message.created_at.getTime())
        .sort((a, b) => b - a);
      const fourth = mentions[3] ?? now - 6 * HOUR;
      t = Math.min(Math.max(fourth - 2 * MINUTE, now - 26 * HOUR), now - 90 * MINUTE);
    } else if (office.includes(persona.key)) {
      t = rng.chance(0.65) ? at("2026-10-10", 11, rng.int(20, 59)) : at("2026-10-09", 17, rng.int(10, 50));
    } else {
      t = now - rng.float(0.6, 6) * HOUR;
    }
    lastActive.set(persona.id, Math.min(t, now - 10 * MINUTE));
  }

  const updates: { id: string; seq: string; at: Date }[] = [];
  // Recent @mentions stay unread in one or two conversations per person, so mention badges show.
  const forcedMentions = new Map<string, number>();
  for (const member of members) {
    const list = byChannel.get(member.channel_id) ?? [];
    if (list.length === 0) {
      continue;
    }
    const key = byId.get(member.user_id);
    let seen = lastActive.get(member.user_id) ?? now - 3 * DAY;
    const noisy = member.name === "tan-gau" || member.name === "chung" || member.name === "it-ho-tro" || member.name === "thong-bao";
    if (member.archived) {
      seen = now;
    } else if (noisy && key !== undefined && rng.chance(key === "boss" ? 0.5 : 0.35)) {
      seen -= rng.float(3, 70) * HOUR;
    } else {
      seen -= rng.float(0, 25) * MINUTE;
    }
    const recentMention = list
      .filter((message) => message.mentions.includes(member.user_id) && message.author_user_id !== member.user_id && message.created_at.getTime() > now - 48 * HOUR)
      .at(-1);
    if (!member.archived && recentMention && (forcedMentions.get(member.user_id) ?? 0) < 2 && rng.chance(0.85)) {
      seen = Math.min(seen, recentMention.created_at.getTime() - MINUTE);
      forcedMentions.set(member.user_id, (forcedMentions.get(member.user_id) ?? 0) + 1);
    }
    let readSeq = 0;
    let readAt = member.joined_at.getTime();
    for (const message of list) {
      const t = message.created_at.getTime();
      const own = message.author_user_id === member.user_id;
      if (t <= seen || own || t <= member.joined_at.getTime()) {
        readSeq = Number(message.seq);
        readAt = Math.max(readAt, Math.min(own ? t : seen, now));
      }
    }
    updates.push({ id: member.id, seq: String(readSeq), at: new Date(Math.max(readAt, member.joined_at.getTime())) });
  }
  await sql.begin(async (tx: Tx) => {
    await tx`SET LOCAL session_replication_role = replica`;
    for (let index = 0; index < updates.length; index += 2000) {
      const chunk = updates.slice(index, index + 2000);
      await tx`
        UPDATE public.channel_members cm SET last_read_seq = u.seq::bigint, last_read_at = u.at::timestamptz
        FROM unnest(${chunk.map((u) => u.id)}::uuid[], ${chunk.map((u) => u.seq)}::text[], ${chunk.map((u) => u.at.toISOString())}::text[]) AS u(id, seq, at)
        WHERE cm.id = u.id
      `;
    }
  });
  env.count("chat.read_markers", updates.length);
};

// Inbox ------------------------------------------------------------------------------------------------------------

type Draft = {
  recipient: string;
  type: string;
  actor: string | null;
  title: string;
  body: string | null;
  projectId: string | null;
  taskId: string | null;
  commentId: string | null;
  channelId: string | null;
  messageId: string | null;
  payload: Record<string, unknown>;
  dedupe: string;
  at: number;
};

/**
 * Rebuilds the inbox for the seeded scope over the last 10 days from what actually happened (assignments,
 * mentions, comments, replies, status changes, deadlines, chat mentions and thread replies), honouring
 * project/channel visibility and channel notify levels. Older entries are read; the last ~1–2 days mostly not.
 */
export const rebuildInbox = async (env: SeedEnv, scope: Scope) => {
  const sql = env.sql;
  const rng = new Rng(hash("inbox"));
  const now = env.now;
  const since = new Date(now - 10 * DAY);
  const drafts: Draft[] = [];
  const activeIds = new Set(
    (
      await sql<{ user_id: string }[]>`
        SELECT user_id FROM public.organization_memberships WHERE organization_id = ${env.organizationId} AND status = 'active' AND deleted_at IS NULL
      `
    ).map((row) => row.user_id)
  );
  const bossId = env.p("boss").id;

  // Task context
  const tasks = await sql<{
    id: string; title: string; task_key: string; project_id: string; project_name: string; visibility: string; created_by: string | null;
    due_at: Date | null; completed_at: Date | null; deleted_at: Date | null; assignees: string[]; list_archived: boolean; project_archived: boolean;
  }[]>`
    SELECT t.id, t.title, p.key || '-' || t.number AS task_key, t.project_id, p.name AS project_name, p.visibility, t.created_by,
      t.due_at, t.completed_at, t.deleted_at, l.archived_at IS NOT NULL AS list_archived, p.archived_at IS NOT NULL AS project_archived,
      coalesce((SELECT array_agg(ta.assignee_user_id) FROM public.task_assignees ta WHERE ta.task_id = t.id AND ta.removed_at IS NULL), '{}') AS assignees
    FROM public.tasks t JOIN public.projects p ON p.id = t.project_id JOIN public.lists l ON l.id = t.list_id
    WHERE t.project_id = ANY(${scope.projectIds}::uuid[])
  `;
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const projectMembers = new Map<string, Set<string>>();
  for (const row of await sql<{ project_id: string; user_id: string }[]>`
    SELECT project_id, user_id FROM public.project_memberships WHERE project_id = ANY(${scope.projectIds}::uuid[]) AND status = 'active' AND deleted_at IS NULL
  `) {
    projectMembers.set(row.project_id, (projectMembers.get(row.project_id) ?? new Set()).add(row.user_id));
  }
  const canSeeTask = (task: (typeof tasks)[number], userId: string) =>
    activeIds.has(userId) &&
    !task.deleted_at && !task.list_archived && !task.project_archived &&
    (userId === bossId || task.visibility === "public" || (projectMembers.get(task.project_id)?.has(userId) ?? false));
  const taskDraft = (task: (typeof tasks)[number], partial: Omit<Draft, "title" | "projectId" | "taskId" | "channelId" | "messageId" | "payload"> & { payload?: Record<string, unknown> }): Draft => ({
    ...partial,
    title: task.title.slice(0, 300),
    projectId: task.project_id,
    taskId: task.id,
    channelId: null,
    messageId: null,
    payload: { taskKey: task.task_key, projectName: task.project_name, ...(partial.payload ?? {}) }
  });

  // Assignments
  for (const event of await sql<{ id: string; task_id: string; actor_user_id: string | null; target_id: string; created_at: Date }[]>`
    SELECT e.id, e.task_id, e.actor_user_id, e.target_id, e.created_at FROM public.task_activity_events e
    WHERE e.task_id IN (SELECT id FROM public.tasks WHERE project_id = ANY(${scope.projectIds}::uuid[]))
      AND e.action = 'TASK_ASSIGNEE_ADDED' AND e.created_at >= ${since} AND e.target_id IS NOT NULL
  `) {
    const task = taskById.get(event.task_id);
    if (!task || event.actor_user_id === event.target_id || !canSeeTask(task, event.target_id) || !task.assignees.includes(event.target_id)) {
      continue;
    }
    drafts.push(taskDraft(task, {
      recipient: event.target_id, type: "task.assigned", actor: event.actor_user_id, body: null, commentId: null,
      payload: { reopened: false }, dedupe: `seed:assign:${event.id}`, at: event.created_at.getTime() + rng.int(800, 4000)
    }));
  }

  // Status changes (assignees + creator)
  for (const event of await sql<{ id: string; task_id: string; actor_user_id: string | null; name: string | null; created_at: Date }[]>`
    SELECT e.id, e.task_id, e.actor_user_id, e.new_value->>'name' AS name, e.created_at FROM public.task_activity_events e
    WHERE e.task_id IN (SELECT id FROM public.tasks WHERE project_id = ANY(${scope.projectIds}::uuid[]))
      AND e.action = 'TASK_STATUS_CHANGED' AND e.created_at >= ${since}
  `) {
    const task = taskById.get(event.task_id);
    if (!task) {
      continue;
    }
    const isDone = task.completed_at !== null && Math.abs(task.completed_at.getTime() - event.created_at.getTime()) < 2000;
    if (!isDone && !rng.chance(0.3)) {
      continue;
    }
    for (const recipient of new Set([...task.assignees, ...(task.created_by ? [task.created_by] : [])])) {
      if (recipient === event.actor_user_id || !canSeeTask(task, recipient)) {
        continue;
      }
      // Creators follow fewer of their tasks' status changes than assignees do.
      if (!task.assignees.includes(recipient) && !rng.chance(isDone ? 0.7 : 0.35)) {
        continue;
      }
      drafts.push(taskDraft(task, {
        recipient, type: "task.status_changed", actor: event.actor_user_id, body: null, commentId: null,
        payload: { statusName: event.name, isDone }, dedupe: `seed:status:${event.id}`, at: event.created_at.getTime() + rng.int(800, 4000)
      }));
    }
  }

  // Comments, replies, comment mentions
  const comments = await sql<{ id: string; task_id: string; author_user_id: string; parent_comment_id: string | null; parent_author: string | null; body_text: string; mentions: string[]; created_at: Date }[]>`
    SELECT c.id, c.task_id, c.author_user_id, c.parent_comment_id, pc.author_user_id AS parent_author, c.body_text, c.mentioned_user_ids AS mentions, c.created_at
    FROM public.task_comments c LEFT JOIN public.task_comments pc ON pc.id = c.parent_comment_id
    WHERE c.task_id IN (SELECT id FROM public.tasks WHERE project_id = ANY(${scope.projectIds}::uuid[]))
      AND c.deleted_at IS NULL AND c.created_at >= ${since}
  `;
  for (const comment of comments) {
    const task = taskById.get(comment.task_id);
    if (!task) {
      continue;
    }
    const t = comment.created_at.getTime() + rng.int(800, 4000);
    const excerpt = comment.body_text.slice(0, 280);
    const mentioned = new Set(comment.mentions.filter((id) => id !== comment.author_user_id));
    for (const recipient of mentioned) {
      if (canSeeTask(task, recipient)) {
        drafts.push(taskDraft(task, {
          recipient, type: "task.mentioned", actor: comment.author_user_id, body: null, commentId: comment.id,
          payload: { source: "comment" }, dedupe: `seed:tmention:${comment.id}`, at: t
        }));
      }
    }
    const parentAuthor = comment.parent_author;
    if (parentAuthor && parentAuthor !== comment.author_user_id && !mentioned.has(parentAuthor) && canSeeTask(task, parentAuthor)) {
      drafts.push(taskDraft(task, {
        recipient: parentAuthor, type: "task.replied", actor: comment.author_user_id, body: excerpt, commentId: comment.id,
        dedupe: `seed:reply:${comment.id}`, at: t
      }));
    }
    for (const recipient of new Set([...task.assignees, ...(task.created_by ? [task.created_by] : [])])) {
      if (recipient === comment.author_user_id || mentioned.has(recipient) || recipient === parentAuthor || !canSeeTask(task, recipient)) {
        continue;
      }
      if (!rng.chance(task.assignees.includes(recipient) ? 0.8 : 0.4)) {
        continue;
      }
      drafts.push(taskDraft(task, {
        recipient, type: "task.commented", actor: comment.author_user_id, body: excerpt, commentId: comment.id,
        dedupe: `seed:comment:${comment.id}`, at: t
      }));
    }
  }

  // Description mentions of tasks created in the window
  for (const row of await sql<{ id: string; created_by: string | null; created_at: Date; ids: string[] }[]>`
    SELECT t.id, t.created_by, t.created_at,
      coalesce((SELECT array_agg(DISTINCT m->'attrs'->>'id') FROM jsonb_path_query(t.description_json, 'strict $.**') AS m
        WHERE jsonb_typeof(m) = 'object' AND m->>'type' = 'mention'), '{}') AS ids
    FROM public.tasks t
    WHERE t.project_id = ANY(${scope.projectIds}::uuid[]) AND t.created_at >= ${since} AND t.description_json::text LIKE '%"mention"%'
  `) {
    const task = taskById.get(row.id);
    for (const recipient of row.ids) {
      if (task && recipient !== row.created_by && canSeeTask(task, recipient)) {
        drafts.push(taskDraft(task, {
          recipient, type: "task.mentioned", actor: row.created_by, body: null, commentId: null,
          payload: { source: "description" }, dedupe: `seed:dmention:${row.id}`, at: row.created_at.getTime() + rng.int(800, 4000)
        }));
      }
    }
  }

  // Deadlines (same dedupe keys as the worker's deadline scanner, so it never repeats them)
  for (const task of tasks) {
    if (!task.due_at || task.deleted_at || task.list_archived || task.project_archived) {
      continue;
    }
    const due = task.due_at.getTime();
    const completed = task.completed_at?.getTime() ?? null;
    for (const recipient of task.assignees) {
      if (!canSeeTask(task, recipient)) {
        continue;
      }
      const soonAt = due - 24 * HOUR + rng.int(0, 5) * MINUTE;
      if (soonAt <= now && soonAt >= since.getTime() && (completed === null || completed > soonAt) && due > soonAt) {
        drafts.push(taskDraft(task, {
          recipient, type: "task.due_soon", actor: null, body: null, commentId: null, payload: { dueAt: task.due_at.toISOString() },
          dedupe: `task.due_soon:${task.id}:${Math.floor(due)}`, at: soonAt
        }));
      }
      const overdueAt = due + rng.int(0, 5) * MINUTE;
      if (overdueAt <= now && due >= now - 7 * DAY && (completed === null || completed > due)) {
        drafts.push(taskDraft(task, {
          recipient, type: "task.overdue", actor: null, body: null, commentId: null, payload: { dueAt: task.due_at.toISOString() },
          dedupe: `task.overdue:${task.id}:${Math.floor(due)}`, at: overdueAt
        }));
      }
    }
  }

  // Chat
  const channelRows = await sql<{ id: string; kind: string; name: string | null }[]>`
    SELECT id, kind, name FROM public.channels WHERE id = ANY(${scope.channelIds}::uuid[]) AND archived_at IS NULL
  `;
  const channelById = new Map(channelRows.map((row) => [row.id, row]));
  const membership = new Map<string, string>();
  for (const row of await sql<{ channel_id: string; user_id: string; notify_level: string }[]>`
    SELECT channel_id, user_id, notify_level FROM public.channel_members WHERE channel_id = ANY(${scope.channelIds}::uuid[]) AND deleted_at IS NULL
  `) {
    membership.set(`${row.channel_id}:${row.user_id}`, row.notify_level);
  }
  const chatMessages = await sql<{ id: string; channel_id: string; author_user_id: string | null; thread_root_id: string | null; body_text: string; mentions: string[]; created_at: Date }[]>`
    SELECT id, channel_id, author_user_id, thread_root_id, body_text, mentioned_user_ids AS mentions, created_at
    FROM public.messages
    WHERE channel_id = ANY(${scope.channelIds}::uuid[]) AND kind = 'user' AND deleted_at IS NULL AND created_at >= ${new Date(since.getTime() - 5 * DAY)}
    ORDER BY created_at
  `;
  const threadParticipants = new Map<string, string[]>();
  for (const message of chatMessages) {
    const channel = channelById.get(message.channel_id);
    const rootId = message.thread_root_id;
    if (rootId) {
      const earlier = threadParticipants.get(rootId) ?? [];
      threadParticipants.set(rootId, [...earlier, message.author_user_id ?? ""]);
    } else {
      threadParticipants.set(message.id, [message.author_user_id ?? ""]);
    }
    if (!channel || message.created_at < since) {
      continue;
    }
    const base = {
      actor: message.author_user_id,
      title: (channel.name ?? "Direct message").slice(0, 300),
      body: message.body_text.slice(0, 500),
      projectId: null,
      taskId: null,
      commentId: null,
      channelId: channel.id,
      messageId: message.id,
      at: message.created_at.getTime() + rng.int(800, 4000)
    };
    const mentioned = new Set(message.mentions.filter((id) => id !== message.author_user_id));
    for (const recipient of mentioned) {
      const level = membership.get(`${channel.id}:${recipient}`);
      const eligible = level === undefined ? channel.kind === "public" : level !== "none";
      if (eligible && activeIds.has(recipient)) {
        drafts.push({ ...base, recipient, type: "chat.mentioned", payload: { channelKind: channel.kind, threadRootId: rootId }, dedupe: `seed:chatm:${message.id}` });
      }
    }
    if (rootId) {
      const participants = new Set((threadParticipants.get(rootId) ?? []).slice(0, -1));
      for (const recipient of participants) {
        if (!recipient || recipient === message.author_user_id || mentioned.has(recipient) || !activeIds.has(recipient)) {
          continue;
        }
        if (membership.get(`${channel.id}:${recipient}`) !== "all") {
          continue;
        }
        drafts.push({ ...base, recipient, type: "chat.thread_replied", payload: { channelKind: channel.kind, threadRootId: rootId }, dedupe: `seed:thread:${message.id}` });
      }
    }
  }

  // Read state: older entries read (a few minutes to hours later), the last ~30 h mostly unread.
  const rows = drafts
    .filter((draft) => draft.at <= now - MINUTE && activeIds.has(draft.recipient) && draft.recipient !== draft.actor)
    .map((draft) => {
      const recent = draft.at > now - (draft.recipient === bossId ? 22 : 30) * HOUR;
      const read = recent ? rng.chance(draft.recipient === bossId ? 0.2 : 0.3) : rng.chance(0.97);
      const readAt = read ? Math.min(draft.at + rng.float(2, 300) * MINUTE, now - 5 * MINUTE) : null;
      return { ...draft, readAt };
    });

  await sql.begin(async (tx: Tx) => {
    await tx`
      DELETE FROM public.notifications
      WHERE organization_id = ${env.organizationId}
        AND (project_id = ANY(${scope.projectIds}::uuid[]) OR channel_id = ANY(${scope.channelIds}::uuid[]) OR dedupe_key LIKE 'seed:%')
    `;
    for (let index = 0; index < rows.length; index += 1000) {
      const chunk = rows.slice(index, index + 1000);
      await tx`
        INSERT INTO public.notifications (
          organization_id, recipient_user_id, type, actor_user_id, project_id, task_id, comment_id, channel_id, message_id,
          title, body, payload, dedupe_key, created_at, read_at
        )
        SELECT ${env.organizationId}, r.recipient, r.type, r.actor, r.project_id, r.task_id, r.comment_id, r.channel_id, r.message_id,
          r.title, r.body, r.payload, r.dedupe, r.created_at, r.read_at
        FROM jsonb_to_recordset(${tx.json(
          chunk.map((row) => ({
            recipient: row.recipient,
            type: row.type,
            actor: row.actor,
            project_id: row.projectId,
            task_id: row.taskId,
            comment_id: row.commentId,
            channel_id: row.channelId,
            message_id: row.messageId,
            title: row.title,
            body: row.body,
            payload: row.payload,
            dedupe: row.dedupe,
            created_at: new Date(row.at).toISOString(),
            read_at: row.readAt === null ? null : new Date(row.readAt).toISOString()
          })) as never
        )}) AS r(
          recipient uuid, type text, actor uuid, project_id uuid, task_id uuid, comment_id uuid, channel_id uuid, message_id uuid,
          title text, body text, payload jsonb, dedupe text, created_at timestamptz, read_at timestamptz
        )
        ON CONFLICT (organization_id, recipient_user_id, dedupe_key) DO NOTHING
      `;
    }
  });
  env.count("notifications", rows.length);
  env.count("notifications.unread", rows.filter((row) => row.readAt === null).length);
};

// Mention labels ---------------------------------------------------------------------------------------------

/** JSON with sorted keys (jsonb reorders object keys). */
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

/**
 * Mention labels are stored in documents at write time. Display names of some accounts change after the seed
 * (e.g. production staff), so stored labels and derived plain text are refreshed from the current names.
 */
export const refreshMentionLabels = async (env: SeedEnv, scope: Scope) => {
  const sql = env.sql;
  let changed = 0;
  const refresh = async (
    rows: { id: string; doc: Record<string, unknown> }[],
    limits: SanitizeLimits,
    write: (tx: Tx, id: string, doc: unknown, text: string) => Promise<unknown>
  ) => {
    const updates: { id: string; doc: unknown; text: string }[] = [];
    for (const row of rows) {
      const result = await sanitizeWithMentionLabels(sql, env.organizationId, row.doc, limits);
      if (canonical(result.doc) !== canonical(row.doc)) {
        updates.push({ id: row.id, doc: result.doc, text: result.text });
      }
    }
    if (updates.length === 0) {
      return;
    }
    await sql.begin(async (tx: Tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      for (const update of updates) {
        await write(tx, update.id, update.doc, update.text);
      }
    });
    changed += updates.length;
  };
  await refresh(
    await sql<{ id: string; doc: Record<string, unknown> }[]>`
      SELECT id, description_json AS doc FROM public.tasks WHERE project_id = ANY(${scope.projectIds}::uuid[]) AND description_json::text LIKE '%"mention"%'
    `,
    descriptionLimits,
    (tx, id, doc, text) => tx`UPDATE public.tasks SET description_json = ${tx.json(doc as never)}, description_text = ${text || null} WHERE id = ${id}`
  );
  await refresh(
    await sql<{ id: string; doc: Record<string, unknown> }[]>`
      SELECT id, body_json AS doc FROM public.task_comments
      WHERE task_id IN (SELECT id FROM public.tasks WHERE project_id = ANY(${scope.projectIds}::uuid[])) AND body_json::text LIKE '%"mention"%'
    `,
    commentLimits,
    async (tx, id, doc, text) => {
      await tx`UPDATE public.task_comments SET body_json = ${tx.json(doc as never)}, body_text = ${text} WHERE id = ${id}`;
      await tx`UPDATE public.notifications SET body = ${text.slice(0, 280)} WHERE comment_id = ${id} AND body IS NOT NULL`;
    }
  );
  await refresh(
    await sql<{ id: string; doc: Record<string, unknown> }[]>`
      SELECT id, body_json AS doc FROM public.messages
      WHERE channel_id = ANY(${scope.channelIds}::uuid[]) AND body_json IS NOT NULL AND body_json::text LIKE '%"mention"%'
    `,
    messageLimits,
    async (tx, id, doc, text) => {
      await tx`UPDATE public.messages SET body_json = ${tx.json(doc as never)}, body_text = ${text} WHERE id = ${id}`;
      await tx`UPDATE public.notifications SET body = ${text.slice(0, 500)} WHERE message_id = ${id} AND body IS NOT NULL`;
    }
  );
  env.count("mention_labels_refreshed", changed);
  return changed;
};
