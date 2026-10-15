import type { ProductionComment, ProductionTimelinePage, TaskLog } from "../../contracts/production-jobs.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { toIso, toNullableIso, type QuerySql } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { toUserRef, type UserRefJson } from "../work/mappers.js";
import { userJsonSql } from "../work/tasks.repo.js";
import { assertProductionMember, isProductionAdmin } from "./access.js";
import { cursorInstantSql, cursorTextSql, decodeTimeCursor, encodeTimeCursor } from "./cursor.js";
import { leadsForView, loadJobScopes } from "./job-permissions.js";
import { assertTaskVisible, jobArchivedError, loadMemberRoles, loadTask } from "./jobs.repo.js";
import { commentCreatedEvent, enqueueProductionEvents } from "./notifications.js";
import { publishProductionChange } from "./realtime.js";
import { parentNumberSql, taskCode } from "./task-codes.js";

/** Job/Task comment boxes with the task history interleaved by time (PLAN §8, §10). */

/**
 * What a comment box belongs to. `viewers`: who may see it besides the all-jobs roles (Account / Leader /
 * Admin) — for a task its worker and QC; for a job everyone working or checking in it (PD-014). The job
 * leader sees it through the LEADER role; a leader who lost that role no longer counts (SEC2-04).
 * `archived`: the job is archived (read-only, BUG-PR-04).
 */
type Target = { entity: "JOB" | "TASK"; entityId: string; jobId: string; archived: boolean; viewers: Set<string> };

/** Resolves what the caller may read; 404 for anything they may not see. */
const resolveTarget = async (sql: QuerySql, context: AccessContext, entity: "JOB" | "TASK", id: string): Promise<Target> => {
  assertProductionMember(context);
  const organizationId = context.organization.id;
  if (entity === "TASK") {
    const task = await loadTask(sql, organizationId, id);
    await assertTaskVisible(sql, context, task);
    const viewers = new Set([task.assignee_id, ...(task.qc_id ? [task.qc_id] : [])]);
    return { entity, entityId: id, jobId: task.job_id, archived: task.job_archived, viewers };
  }
  const [rows, scopes] = await Promise.all([
    sql<{ archived: boolean; leader_id: string | null; people: string[] }[]>`
      SELECT j.archived_at IS NOT NULL AS archived, coalesce((
          SELECT array_agg(DISTINCT p) FROM production.tasks t, unnest(ARRAY[t.assignee_id, t.qc_id]) AS p
          WHERE t.organization_id = j.organization_id AND t.job_id = j.id AND t.deleted_at IS NULL AND p IS NOT NULL
        ), '{}') AS people, j.leader_id
      FROM production.jobs j WHERE j.organization_id = ${organizationId} AND j.id = ${id} AND j.deleted_at IS NULL
    `,
    loadJobScopes(sql, context)
  ]);
  const job = rows[0];
  const viewers = new Set(job ? job.people : []);
  // PD-036 "view": every job, or with "own" the jobs where I work / check or that I lead.
  const visible =
    scopes.view === "all" || (scopes.view === "own" && (viewers.has(context.user.id) || leadsForView(context, job?.leader_id ?? null)));
  if (!job || !visible) {
    throw new AppError("JOB_NOT_FOUND", "Không tìm thấy job.", 404);
  }
  return { entity, entityId: id, jobId: id, archived: job.archived, viewers };
};

type CommentRow = {
  id: string;
  cursor_at: string;
  entity: "JOB" | "TASK";
  entity_id: string;
  job_id: string;
  user_id: string;
  author: UserRefJson | null;
  body: string;
  mentioned_user_ids: string[];
  created_at: Date;
  edited_at: Date | null;
};

const toComment = (row: CommentRow, context: AccessContext): ProductionComment => ({
  id: row.id,
  entity: row.entity,
  entityId: row.entity_id,
  jobId: row.job_id,
  author: toUserRef(row.author),
  body: row.body,
  mentionedUserIds: row.mentioned_user_ids,
  createdAt: toIso(row.created_at),
  editedAt: toNullableIso(row.edited_at),
  canEdit: row.user_id === context.user.id
});

type LogRow = {
  id: string;
  cursor_at: string;
  /** Null for job-level history (action JOB: job edits). */
  task_id: string | null;
  task_number: string | number | null;
  /** PD-045 display code parts: a subtask's letter index and its line's number (null otherwise). */
  task_sub_seq: number | null;
  task_parent_number: string | number | null;
  user: UserRefJson | null;
  action: TaskLog["action"];
  from_value: Record<string, unknown> | null;
  to_value: Record<string, unknown> | null;
  note: string | null;
  created_at: Date;
};

/**
 * Newest first. A job's timeline holds its own comments plus every task's comments and history;
 * a task's timeline holds only that task's. Keyset (created_at, id) at the database's microsecond precision:
 * both sources are compared, merged and paged on the same full-precision key, so rows sharing a timestamp
 * (one transaction writes several logs) are neither dropped nor repeated (BUG-PR-05).
 *
 * PD-044 "Nhật ký" of the job page: `only` "logs" leaves the comments out; `taskId` (job timeline) narrows it to one
 * line — its history (SUBTASK / QTY_REQUEST rows are on the line already) and, without `only` "logs", its comments.
 */
export const listProductionTimeline = async (
  context: AccessContext,
  entity: "JOB" | "TASK",
  id: string,
  query: { only?: "all" | "logs" | undefined; taskId?: string | undefined; cursor?: string | undefined; limit: number }
): Promise<ProductionTimelinePage> => {
  const sql = getSql();
  const target = await resolveTarget(sql, context, entity, id);
  const organizationId = context.organization.id;
  const cursor = decodeTimeCursor(query.cursor);
  const before = (alias: string) =>
    cursor ? sql`AND (${sql(alias)}.created_at, ${sql(alias)}.id) < (${cursorInstantSql(sql, cursor.at)}, ${cursor.id}::uuid)` : sql``;
  // One line of the job (job timeline only; a task timeline is that task's already).
  const lineId = entity === "JOB" ? (query.taskId ?? null) : null;
  const [comments, logs] = await Promise.all([
    query.only === "logs"
      ? Promise.resolve([] as CommentRow[])
      : sql<CommentRow[]>`
          SELECT c.id, c.entity, c.entity_id, c.job_id, c.user_id, c.body, c.mentioned_user_ids, c.created_at, c.edited_at,
            ${cursorTextSql(sql, "c.created_at")} AS cursor_at,
            (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = c.user_id) AS author
          FROM production.comments c
          WHERE c.organization_id = ${organizationId} AND c.deleted_at IS NULL
            AND ${
              entity === "JOB"
                ? lineId
                  ? sql`c.job_id = ${target.jobId} AND c.entity = 'TASK' AND c.entity_id = ${lineId}`
                  : sql`c.job_id = ${target.jobId}`
                : sql`c.entity = 'TASK' AND c.entity_id = ${id}`
            }
            ${before("c")}
          ORDER BY c.created_at DESC, c.id DESC
          LIMIT ${query.limit + 1}
        `,
    sql<LogRow[]>`
      SELECT l.id, l.task_id, t.number AS task_number, t.sub_seq AS task_sub_seq, ${parentNumberSql(sql)} AS task_parent_number,
        l.action, l.from_value, l.to_value, l.note, l.created_at,
        ${cursorTextSql(sql, "l.created_at")} AS cursor_at,
        (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = l.user_id) AS user
      FROM production.task_logs l
      LEFT JOIN production.tasks t ON t.organization_id = l.organization_id AND t.id = l.task_id
      WHERE l.organization_id = ${organizationId}
        AND ${
          entity === "JOB" ? (lineId ? sql`l.job_id = ${target.jobId} AND l.task_id = ${lineId}` : sql`l.job_id = ${target.jobId}`) : sql`l.task_id = ${id}`
        }
        ${before("l")}
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT ${query.limit + 1}
    `
  ]);
  const merged = [
    ...comments.map((row) => ({ at: row.cursor_at, id: row.id, item: { kind: "comment" as const, comment: toComment(row, context) } })),
    ...logs.map((row) => ({
      at: row.cursor_at,
      id: row.id,
      item: {
        kind: "log" as const,
        log: {
          id: row.id,
          taskId: row.task_id,
          taskNumber: row.task_number === null ? null : Number(row.task_number),
          // PD-045: "1216" for a line, "1216a" for a subtask's own rows.
          taskCode:
            row.task_number === null ? null : taskCode({ number: row.task_number, subSeq: row.task_sub_seq, parentNumber: row.task_parent_number }),
          user: toUserRef(row.user),
          action: row.action,
          fromValue: row.from_value,
          toValue: row.to_value,
          note: row.note,
          createdAt: toIso(row.created_at)
        }
      }
    }))
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const page = merged.slice(0, query.limit);
  const last = page[page.length - 1];
  const hasMore = merged.length > query.limit;
  return {
    items: page.map((entry) => entry.item),
    pageInfo: { hasMore, nextCursor: hasMore && last ? encodeTimeCursor(last.at, last.id) : null }
  };
};

const loadComment = async (sql: QuerySql, organizationId: string, commentId: string) => {
  const row = (
    await sql<CommentRow[]>`
      SELECT c.id, c.entity, c.entity_id, c.job_id, c.user_id, c.body, c.mentioned_user_ids, c.created_at, c.edited_at,
        ${cursorTextSql(sql, "c.created_at")} AS cursor_at,
        (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = c.user_id) AS author
      FROM production.comments c WHERE c.organization_id = ${organizationId} AND c.id = ${commentId} AND c.deleted_at IS NULL
    `
  )[0];
  if (!row) {
    throw new AppError("COMMENT_NOT_FOUND", "Không tìm thấy bình luận.", 404);
  }
  return row;
};

export const createProductionComment = async (
  context: AccessContext,
  entity: "JOB" | "TASK",
  id: string,
  input: { body: string; mentionedUserIds: string[] }
) => {
  const sql = getSql();
  const target = await resolveTarget(sql, context, entity, id);
  if (target.archived) {
    throw jobArchivedError();
  }
  const organizationId = context.organization.id;
  const mentioned = [...new Set(input.mentionedUserIds)].filter((userId) => userId !== context.user.id);
  if (mentioned.length > 0) {
    // PR-10: a mention sends the comment to that person — only people who can see this task / job.
    const roles = await loadMemberRoles(sql, organizationId, mentioned);
    const canSee = (userId: string) => {
      const held = roles.get(userId);
      return Boolean(held && held.size > 0 && (held.has("ADMIN") || held.has("ACCOUNT") || held.has("LEADER") || target.viewers.has(userId)));
    };
    if (mentioned.some((userId) => !canSee(userId))) {
      throw new AppError("MENTION_INVALID", `Chỉ nhắc được người xem được ${entity === "TASK" ? "task" : "job"} này.`, 400);
    }
  }
  const created = await sql.begin(async (tx) => {
    const row = (
      await tx<{ id: string }[]>`
        INSERT INTO production.comments (organization_id, entity, entity_id, job_id, user_id, body, mentioned_user_ids)
        VALUES (${organizationId}, ${entity}, ${id}, ${target.jobId}, ${context.user.id}, ${input.body}, ${mentioned}::uuid[])
        RETURNING id
      `
    )[0]!;
    await enqueueProductionEvents(tx, [
      commentCreatedEvent(organizationId, context.user.id, {
        id: row.id,
        jobId: target.jobId,
        taskId: entity === "TASK" ? id : null,
        body: input.body,
        mentionedUserIds: mentioned
      })
    ]);
    return row;
  });
  publishProductionChange(organizationId, target.jobId, entity === "TASK" ? [id] : [], "comment", context.user.id);
  return toComment(await loadComment(sql, organizationId, created.id), context);
};

export const updateProductionComment = async (context: AccessContext, commentId: string, body: string) => {
  assertProductionMember(context);
  const sql = getSql();
  const organizationId = context.organization.id;
  const row = await loadComment(sql, organizationId, commentId);
  if (row.user_id !== context.user.id) {
    throw new AppError("FORBIDDEN", "Chỉ người viết được sửa bình luận.", 403);
  }
  if ((await resolveTarget(sql, context, row.entity, row.entity_id)).archived) {
    throw jobArchivedError();
  }
  await sql`UPDATE production.comments SET body = ${body}, edited_at = now() WHERE organization_id = ${organizationId} AND id = ${commentId}`;
  publishProductionChange(organizationId, row.job_id, row.entity === "TASK" ? [row.entity_id] : [], "comment", context.user.id);
  return toComment(await loadComment(sql, organizationId, commentId), context);
};

export const deleteProductionComment = async (context: AccessContext, commentId: string) => {
  assertProductionMember(context);
  const sql = getSql();
  const organizationId = context.organization.id;
  const row = await loadComment(sql, organizationId, commentId);
  if (row.user_id !== context.user.id && !isProductionAdmin(context)) {
    throw new AppError("FORBIDDEN", "Chỉ người viết (hoặc Quản trị) được xoá bình luận.", 403);
  }
  // Same checks as editing (SEC2-08): the author must still see the task / job (404 otherwise, e.g. after
  // being taken off the task), and an archived job is read-only.
  if ((await resolveTarget(sql, context, row.entity, row.entity_id)).archived) {
    throw jobArchivedError();
  }
  await sql`UPDATE production.comments SET deleted_at = now() WHERE organization_id = ${organizationId} AND id = ${commentId}`;
  publishProductionChange(organizationId, row.job_id, row.entity === "TASK" ? [row.entity_id] : [], "comment", context.user.id);
  return { ok: true as const };
};
