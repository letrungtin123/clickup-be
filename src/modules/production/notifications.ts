import type postgres from "postgres";

import type { NotificationType } from "../../contracts/notifications.js";
import { getSql } from "../../db/client.js";
import type { QuerySql } from "../../lib/db-types.js";
import type { DomainEventEnvelope, DomainEventInput } from "../events/outbox.js";
import { enqueueDomainEvents } from "../events/outbox.js";
import { deliverNotifications } from "../notifications/notifications.service.js";
import { loadSettings } from "./catalog.service.js";
import { rolesWithAll } from "./job-permissions.js";
import { kpiSettlementNotificationHandlers } from "./kpi-settlement-notifications.js";
import { listOpenJobsLedBy, loadProductionAdminIds } from "./member-lookups.js";

/**
 * Production notifications (SPEC §6 Phase 4 §1, PLAN §8): events are written to the outbox inside the task
 * transaction, the worker turns them into inbox entries (and e-mails when enabled). Who gets what is decided by
 * the pure functions in `productionRecipients` (unit-tested); the handlers below only load the people.
 */

type JsonRecord = Record<string, postgres.JSONValue>;

const event = (organizationId: string, type: string, aggregateId: string, actorUserId: string | null, payload: JsonRecord): DomainEventInput => ({
  organizationId,
  type,
  aggregateType: "production_task",
  aggregateId,
  actorUserId,
  payload
});

export const enqueueProductionEvents = (tx: QuerySql, events: DomainEventInput[]) => enqueueDomainEvents(tx, events);

export const taskAssignedEvent = (organizationId: string, taskId: string, actorId: string | null) =>
  event(organizationId, "production.task.assigned", taskId, actorId, { taskId });

export const taskStatusEvent = (
  organizationId: string,
  taskId: string,
  actorId: string | null,
  change: { toCode: string; toName: string; enteredWaitingQc: boolean; enteredChecked: boolean; qcFail: boolean; note: string | null }
) => event(organizationId, "production.task.status_changed", taskId, actorId, { taskId, ...change });

export const taskQtyEvent = (organizationId: string, taskId: string, actorId: string, from: number, to: number, note: string | null) =>
  event(organizationId, "production.task.qty_changed", taskId, actorId, { taskId, from, to, note });

/** `taskIds`: the delivering tasks the feedback parked (their workers are "NV cũ" when no source task is named). */
export const feedbackEvent = (
  organizationId: string,
  jobId: string,
  actorId: string,
  feedback: { type: string; note: string; sourceTaskId: string | null; taskIds: string[] }
) => ({ ...event(organizationId, "production.feedback.created", jobId, actorId, { jobId, ...feedback }), aggregateType: "production_job" });

export const commentCreatedEvent = (
  organizationId: string,
  actorId: string,
  comment: { id: string; jobId: string; taskId: string | null; body: string; mentionedUserIds: string[] }
) => ({
  ...event(organizationId, "production.comment.created", comment.id, actorId, {
    commentId: comment.id,
    jobId: comment.jobId,
    taskId: comment.taskId,
    excerpt: comment.body.slice(0, 300),
    mentionedUserIds: comment.mentionedUserIds
  }),
  aggregateType: "production_comment"
});

export const leaveEvent = (organizationId: string, type: "requested" | "decided", leaveId: string, actorId: string, extra: JsonRecord = {}) =>
  ({ ...event(organizationId, `production.leave.${type}`, leaveId, actorId, { leaveId, ...extra }), aggregateType: "production_leave" });

/**
 * SEC2-04 follow-up: `userId` lost the LEADER role (or was disabled) by `actorId`'s change. The worker tells the
 * production Admins which open jobs that person still leads, so someone hands them to another Leader.
 */
export const leaderRemovedEvent = (organizationId: string, userId: string, actorId: string, reason: "role_removed" | "deactivated"): DomainEventInput => ({
  organizationId,
  type: "production.member.leader_removed",
  aggregateType: "user",
  aggregateId: userId,
  actorUserId: actorId,
  payload: { userId, reason }
});

// Recipient rules (pure) ---------------------------------------------------------------------------------

/**
 * The people of a task as the notification rules see them. `leaderId` is the job's leader only while that person
 * still holds LEADER (or ADMIN, superadmins included) as an active member: a demoted leader lost the job-leader
 * powers and the job's visibility (SEC2-04), so they are no longer told about it either.
 */
export type TaskPeople = { assigneeId: string; qcId: string | null; leaderId: string | null };

/** The people of a job for a job-level comment (see `jobComment`). `creatorId` only while they may still see the job. */
export type JobPeople = { leaderId: string | null; creatorId: string | null; workerIds: string[] };

const distinct = (ids: readonly (string | null | undefined)[], exclude: readonly (string | null | undefined)[] = []) => {
  const skip = new Set(exclude.filter((id): id is string => Boolean(id)));
  return [...new Set(ids.filter((id): id is string => Boolean(id) && !skip.has(id as string)))];
};

/**
 * SPEC §6 Phase 4 §1 / PLAN §8 recipients. Every list is de-duplicated; the actor is also dropped by
 * `deliverNotifications` (nobody is notified of their own action).
 */
export const productionRecipients = {
  /** TASK_ASSIGNED → assignee. */
  taskAssigned: (task: TaskPeople) => distinct([task.assigneeId]),
  /** TASK_WAITING_QC → QC. */
  waitingQc: (task: TaskPeople) => distinct([task.qcId]),
  /** QC_FAILED → assignee. */
  qcFailed: (task: TaskPeople) => distinct([task.assigneeId]),
  /** TASK_CHECKED → the job's leader. */
  checked: (task: TaskPeople) => distinct([task.leaderId]),
  /** TASK_LATE / TASK_DUE_SOON → assignee + leader. */
  deadline: (task: TaskPeople) => distinct([task.assigneeId, task.leaderId]),
  /** QTY_CHANGED_BY_LEADER → assignee. */
  qtyChanged: (task: TaskPeople) => distinct([task.assigneeId]),
  /** FEEDBACK_CREATED → leader + the previous workers ("NV cũ"). */
  feedback: (leaderId: string | null, previousWorkerIds: readonly string[]) => distinct([leaderId, ...previousWorkerIds]),
  /** @mentions in a comment → the mentioned people (never the writer). */
  mentioned: (mentionedIds: readonly string[], writerId: string | null) => distinct(mentionedIds, [writerId]),
  /**
   * COMMENT_ADDED on a task → its worker, its QC and the job's leader, never the writer. People @mentioned get the
   * "nhắc đến" notification instead of a second one.
   */
  taskComment: (task: TaskPeople, writerId: string | null, mentionedIds: readonly string[] = []) =>
    distinct([task.assigneeId, task.qcId, task.leaderId], [writerId, ...mentionedIds]),
  /**
   * COMMENT_ADDED on a job (PD-023) → the job's leader, the job's creator and every worker and QC of its tasks,
   * never the writer; @mentioned people get "nhắc đến" instead.
   */
  jobComment: (job: JobPeople, writerId: string | null, mentionedIds: readonly string[] = []) =>
    distinct([job.leaderId, job.creatorId, ...job.workerIds], [writerId, ...mentionedIds]),
  /** LEAVE_REQUESTED → the requester's team Leaders (every Leader without a team) + Admins, never the requester. */
  leaveRequested: (approverIds: readonly string[], requesterId: string) => distinct(approverIds, [requesterId]),
  /** LEAVE_DECIDED → the requester. */
  leaveDecided: (requesterId: string) => distinct([requesterId]),
  /** KPI_SETTLED → each settled person gets their own result. */
  kpiSettledPerson: (userId: string) => distinct([userId]),
  /** KPI_SETTLED summary → every production ADMIN, organization superadmins included (PD-011). */
  kpiSettledAdmins: (adminIds: readonly string[]) => distinct(adminIds)
};

// Worker side ----------------------------------------------------------------------------------------------

/**
 * `leaderActiveSql`: the job leader (`j.leader_id`) is an active member who still holds LEADER or ADMIN, or is an
 * organization superadmin (= `leadsJob`, SEC2-04). Expects the alias `j` (production.jobs).
 */
const leaderActiveSql = (sql: QuerySql) => sql`
  EXISTS (
    SELECT 1 FROM public.organization_memberships lom
    WHERE lom.organization_id = j.organization_id AND lom.user_id = j.leader_id AND lom.status = 'active' AND lom.deleted_at IS NULL
      AND (
        EXISTS (SELECT 1 FROM public.roles lr WHERE lr.id = lom.role_id AND lr.key = 'superadmin')
        OR EXISTS (
          SELECT 1 FROM production.user_roles lur
          WHERE lur.organization_id = lom.organization_id AND lur.user_id = lom.user_id AND lur.role_code IN ('LEADER', 'ADMIN')
        )
      )
  )
`;

/**
 * The job creator (`j.created_by`) may still see every job: a role whose "view" scope is "all" in the job permission
 * matrix (PD-036; by default Account / Leader / Admin) or superadmin.
 */
const creatorSeesJobsSql = (sql: QuerySql, viewAllRoles: readonly string[]) => sql`
  EXISTS (
    SELECT 1 FROM public.organization_memberships com
    WHERE com.organization_id = j.organization_id AND com.user_id = j.created_by AND com.status = 'active' AND com.deleted_at IS NULL
      AND (
        EXISTS (SELECT 1 FROM public.roles cr WHERE cr.id = com.role_id AND cr.key = 'superadmin')
        OR EXISTS (
          SELECT 1 FROM production.user_roles cur
          WHERE cur.organization_id = com.organization_id AND cur.user_id = com.user_id AND cur.role_code = ANY(${[...viewAllRoles]}::text[])
        )
      )
  )
`;

type TaskInfo = {
  id: string;
  number: string | number;
  job_id: string;
  job_code: string;
  leader_id: string | null;
  leader_active: boolean;
  assignee_id: string;
  qc_id: string | null;
  process_name: string;
  qty_assigned: number;
  qty_done: number | null;
  deadline: Date;
};

const loadTaskInfos = async (organizationId: string, taskIds: string[]) => {
  if (taskIds.length === 0) {
    return [];
  }
  const sql = getSql();
  return await sql<TaskInfo[]>`
    SELECT t.id, t.number, t.job_id, j.code AS job_code, j.leader_id, ${leaderActiveSql(sql)} AS leader_active,
      t.assignee_id, t.qc_id, pr.name AS process_name, t.qty_assigned, t.qty_done, t.deadline
    FROM production.tasks t
    JOIN production.jobs j ON j.organization_id = t.organization_id AND j.id = t.job_id
    JOIN production.processes pr ON pr.organization_id = t.organization_id AND pr.id = t.process_id
    WHERE t.organization_id = ${organizationId} AND t.id = ANY(${taskIds}::uuid[]) AND t.deleted_at IS NULL
  `;
};

const loadTaskInfo = async (organizationId: string, taskId: string) => (await loadTaskInfos(organizationId, [taskId]))[0] ?? null;

const peopleOf = (task: TaskInfo): TaskPeople => ({
  assigneeId: task.assignee_id,
  qcId: task.qc_id,
  leaderId: task.leader_active ? task.leader_id : null
});

const taskPayload = (task: TaskInfo, extra: Record<string, unknown> = {}) => ({
  productionTaskId: task.id,
  jobId: task.job_id,
  jobCode: task.job_code,
  taskNumber: Number(task.number),
  processName: task.process_name,
  qty: task.qty_done ?? task.qty_assigned,
  deadline: task.deadline.toISOString(),
  ...extra
});

const notifyTask = async (
  envelope: DomainEventEnvelope,
  task: TaskInfo,
  type: NotificationType,
  recipientIds: string[],
  extra: Record<string, unknown> = {},
  body: string | null = null
) => {
  await deliverNotifications({
    organizationId: envelope.organizationId,
    recipientIds,
    type,
    actorUserId: envelope.actorUserId,
    title: task.job_code,
    body: body ?? `#${Number(task.number)} · ${task.process_name} · ${task.qty_done ?? task.qty_assigned} tấm`,
    payload: taskPayload(task, extra),
    dedupeKey: `evt:${envelope.id}:${type}`
  });
};

const str = (value: unknown) => (typeof value === "string" ? value : null);
const strArray = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);

export const productionNotificationHandlers: Record<string, (event: DomainEventEnvelope) => Promise<void>> = {
  "production.task.assigned": async (envelope) => {
    const task = await loadTaskInfo(envelope.organizationId, str(envelope.payload.taskId) ?? "");
    if (task) {
      await notifyTask(envelope, task, "production.task_assigned", productionRecipients.taskAssigned(peopleOf(task)));
    }
  },

  "production.task.status_changed": async (envelope) => {
    const task = await loadTaskInfo(envelope.organizationId, str(envelope.payload.taskId) ?? "");
    if (!task) {
      return;
    }
    const people = peopleOf(task);
    const note = str(envelope.payload.note);
    if (envelope.payload.qcFail === true) {
      await notifyTask(envelope, task, "production.qc_failed", productionRecipients.qcFailed(people), { note }, note);
    }
    if (envelope.payload.enteredWaitingQc === true) {
      await notifyTask(envelope, task, "production.task_waiting_qc", productionRecipients.waitingQc(people));
    }
    if (envelope.payload.enteredChecked === true) {
      await notifyTask(envelope, task, "production.task_checked", productionRecipients.checked(people));
    }
  },

  "production.task.qty_changed": async (envelope) => {
    const task = await loadTaskInfo(envelope.organizationId, str(envelope.payload.taskId) ?? "");
    if (!task) {
      return;
    }
    const note = str(envelope.payload.note);
    await notifyTask(
      envelope,
      task,
      "production.qty_changed",
      productionRecipients.qtyChanged(peopleOf(task)),
      { from: envelope.payload.from ?? null, to: envelope.payload.to ?? null, note },
      `#${Number(task.number)}: ${String(envelope.payload.from)} → ${String(envelope.payload.to)} tấm${note ? ` — ${note}` : ""}`
    );
  },

  "production.feedback.created": async (envelope) => {
    const jobId = str(envelope.payload.jobId);
    if (!jobId) {
      return;
    }
    // "NV cũ" (PR-15): the worker of the named source task — whatever its kind, an FB redo task included —
    // otherwise the workers of the delivering tasks the feedback parked (events before PR-15: normal tasks).
    const sourceTaskId = str(envelope.payload.sourceTaskId);
    const parked = strArray(envelope.payload.taskIds);
    const sql = getSql();
    const job = (
      await sql<{ code: string; leader_id: string | null; leader_active: boolean; workers: string[] }[]>`
        SELECT j.code, j.leader_id, ${leaderActiveSql(sql)} AS leader_active,
          coalesce((SELECT array_agg(DISTINCT t.assignee_id) FROM production.tasks t
            WHERE t.organization_id = j.organization_id AND t.job_id = j.id AND t.deleted_at IS NULL
              AND CASE
                WHEN ${sourceTaskId}::uuid IS NOT NULL THEN t.id = ${sourceTaskId}::uuid
                WHEN cardinality(${parked}::uuid[]) > 0 THEN t.id = ANY(${parked}::uuid[])
                ELSE t.kind = 'NORMAL'
              END), '{}') AS workers
        FROM production.jobs j WHERE j.organization_id = ${envelope.organizationId} AND j.id = ${jobId} AND j.deleted_at IS NULL
      `
    )[0];
    if (!job) {
      return;
    }
    const note = str(envelope.payload.note);
    await deliverNotifications({
      organizationId: envelope.organizationId,
      recipientIds: productionRecipients.feedback(job.leader_active ? job.leader_id : null, job.workers),
      type: "production.feedback",
      actorUserId: envelope.actorUserId,
      title: job.code,
      body: note,
      payload: { jobId, jobCode: job.code, feedbackType: str(envelope.payload.type), note },
      dedupeKey: `evt:${envelope.id}`
    });
  },

  /**
   * Mentioned people get "nhắc đến"; everyone else related gets "bình luận" (PD-023): on a task its worker, QC and
   * job leader; on a job the job's leader, creator and every worker / QC of its tasks. Never the writer. A comment
   * deleted before the event is handled notifies nobody (it would quote deleted text).
   */
  "production.comment.created": async (envelope) => {
    const jobId = str(envelope.payload.jobId);
    const commentId = str(envelope.payload.commentId);
    if (!jobId) {
      return;
    }
    const sql = getSql();
    if (commentId) {
      const alive = await sql`
        SELECT 1 FROM production.comments WHERE organization_id = ${envelope.organizationId} AND id = ${commentId} AND deleted_at IS NULL
      `;
      if (alive.length === 0) {
        return;
      }
    }
    const writerId = envelope.actorUserId;
    const mentioned = productionRecipients.mentioned(strArray(envelope.payload.mentionedUserIds), writerId);
    const taskId = str(envelope.payload.taskId);
    const task = taskId ? await loadTaskInfo(envelope.organizationId, taskId) : null;
    const job = (
      await sql<{ code: string; leader_id: string | null; leader_active: boolean; created_by: string; creator_sees_jobs: boolean; workers: string[] }[]>`
        SELECT j.code, j.leader_id, ${leaderActiveSql(sql)} AS leader_active, j.created_by,
          ${creatorSeesJobsSql(sql, rolesWithAll((await loadSettings(sql, envelope.organizationId)).jobPermissions, "view"))} AS creator_sees_jobs,
          coalesce((
            SELECT array_agg(DISTINCT p) FROM production.tasks t, unnest(ARRAY[t.assignee_id, t.qc_id]) AS p
            WHERE t.organization_id = j.organization_id AND t.job_id = j.id AND t.deleted_at IS NULL AND p IS NOT NULL
          ), '{}') AS workers
        FROM production.jobs j WHERE j.organization_id = ${envelope.organizationId} AND j.id = ${jobId} AND j.deleted_at IS NULL
      `
    )[0];
    if (!job || (taskId && !task)) {
      return;
    }
    const payload = task ? taskPayload(task, { commentId }) : { jobId, jobCode: job.code, commentId };
    const related = task
      ? productionRecipients.taskComment(peopleOf(task), writerId, mentioned)
      : productionRecipients.jobComment(
          {
            leaderId: job.leader_active ? job.leader_id : null,
            // A creator who works on one of the tasks is in `workers` anyway.
            creatorId: job.creator_sees_jobs ? job.created_by : null,
            workerIds: job.workers
          },
          writerId,
          mentioned
        );
    for (const [type, recipientIds] of [
      ["production.mentioned", mentioned],
      ["production.commented", related]
    ] as const) {
      await deliverNotifications({
        organizationId: envelope.organizationId,
        recipientIds: [...recipientIds],
        type,
        actorUserId: envelope.actorUserId,
        title: job.code,
        body: str(envelope.payload.excerpt),
        payload,
        dedupeKey: `evt:${envelope.id}:${type}`
      });
    }
  }
};

type LeaveInfo = { user_id: string; display_name: string; from_date: string; to_date: string; part: string; status: string; decision_note: string | null; team_id: string | null };

const loadLeave = async (organizationId: string, leaveId: string) =>
  (
    await getSql()<LeaveInfo[]>`
      SELECT lr.user_id, au.display_name, to_char(lr.from_date, 'YYYY-MM-DD') AS from_date, to_char(lr.to_date, 'YYYY-MM-DD') AS to_date,
        lr.part, lr.status, lr.decision_note, mp.team_id
      FROM production.leave_requests lr
      JOIN public.app_users au ON au.id = lr.user_id
      LEFT JOIN production.member_profiles mp ON mp.organization_id = lr.organization_id AND mp.user_id = lr.user_id
      WHERE lr.organization_id = ${organizationId} AND lr.id = ${leaveId}
    `
  )[0] ?? null;

const leavePayload = (leaveId: string, leave: LeaveInfo) => ({
  leaveId,
  requesterName: leave.display_name,
  fromDate: leave.from_date,
  toDate: leave.to_date,
  part: leave.part,
  status: leave.status,
  note: leave.decision_note
});

Object.assign(productionNotificationHandlers, {
  /**
   * SPEC §6.3: new leave request → the Leaders of the requester's team and the production Admins
   * (organization superadmins included). Requester without a team (PR-14, decided): every production
   * Leader and Admin.
   */
  "production.leave.requested": async (envelope: DomainEventEnvelope) => {
    const leaveId = str(envelope.payload.leaveId);
    const leave = leaveId ? await loadLeave(envelope.organizationId, leaveId) : null;
    if (!leaveId || !leave) {
      return;
    }
    const approvers = await getSql()<{ user_id: string }[]>`
      SELECT ur.user_id FROM production.user_roles ur
      LEFT JOIN production.member_profiles mp ON mp.organization_id = ur.organization_id AND mp.user_id = ur.user_id
      WHERE ur.organization_id = ${envelope.organizationId}
        AND (ur.role_code = 'ADMIN'
          OR (ur.role_code = 'LEADER' AND (${leave.team_id}::uuid IS NULL OR mp.team_id = ${leave.team_id}::uuid)))
      UNION
      SELECT om.user_id FROM public.organization_memberships om
      JOIN public.roles r ON r.id = om.role_id AND r.key = 'superadmin'
      WHERE om.organization_id = ${envelope.organizationId} AND om.deleted_at IS NULL AND om.status = 'active'
    `;
    await deliverNotifications({
      organizationId: envelope.organizationId,
      recipientIds: productionRecipients.leaveRequested(
        approvers.map((row) => row.user_id),
        leave.user_id
      ),
      type: "production.leave_requested",
      actorUserId: envelope.actorUserId,
      title: leave.display_name,
      body: leave.from_date === leave.to_date ? leave.from_date : `${leave.from_date} → ${leave.to_date}`,
      payload: leavePayload(leaveId, leave),
      dedupeKey: `evt:${envelope.id}`
    });
  },

  "production.leave.decided": async (envelope: DomainEventEnvelope) => {
    const leaveId = str(envelope.payload.leaveId);
    const leave = leaveId ? await loadLeave(envelope.organizationId, leaveId) : null;
    if (!leaveId || !leave) {
      return;
    }
    await deliverNotifications({
      organizationId: envelope.organizationId,
      recipientIds: productionRecipients.leaveDecided(leave.user_id),
      type: "production.leave_decided",
      actorUserId: envelope.actorUserId,
      title: leave.status === "APPROVED" ? "Đơn nghỉ được duyệt" : "Đơn nghỉ bị từ chối",
      body: leave.decision_note,
      payload: leavePayload(leaveId, leave),
      dedupeKey: `evt:${envelope.id}`
    });
  },

  /**
   * SEC2-04 follow-up (PD-024): tells the production Admins (except the one who made the change) which open jobs a
   * person who no longer leads still has as `leader_id`. Nothing when they still hold LEADER / ADMIN (the role came
   * back, or they are superadmin) or lead no open job any more.
   */
  "production.member.leader_removed": async (envelope: DomainEventEnvelope) => {
    const userId = str(envelope.payload.userId);
    if (!userId) {
      return;
    }
    const led = await listOpenJobsLedBy(getSql(), envelope.organizationId, userId);
    if (led.leaderActive || led.items.length === 0) {
      return;
    }
    const shown = led.items.slice(0, 20);
    const codes = shown.map((job) => job.code).join(", ");
    await deliverNotifications({
      organizationId: envelope.organizationId,
      recipientIds: await loadProductionAdminIds(getSql(), envelope.organizationId),
      type: "production.leader_removed",
      actorUserId: envelope.actorUserId,
      title: led.displayName || "Leader",
      body: `Còn dẫn ${led.items.length} job chưa xong: ${codes}${led.items.length > shown.length ? ", …" : ""}. Hãy giao các job này cho Leader khác.`,
      payload: {
        userId,
        userName: led.displayName,
        reason: str(envelope.payload.reason),
        jobCount: led.items.length,
        jobs: shown.map((job) => ({ id: job.id, code: job.code }))
      },
      dedupeKey: `evt:${envelope.id}`
    });
  }
});

// SPEC §8.2: KPI_SETTLED → each settled person + one summary per run for production admins.
Object.assign(productionNotificationHandlers, kpiSettlementNotificationHandlers);

const deliverDeadline = (kind: "production.task_late" | "production.task_due_soon", organizationId: string, task: TaskInfo) =>
  deliverNotifications({
    organizationId,
    recipientIds: productionRecipients.deadline(peopleOf(task)),
    type: kind,
    actorUserId: null,
    title: task.job_code,
    body: `#${Number(task.number)} · ${task.process_name} · ${task.qty_assigned} tấm`,
    payload: taskPayload(task),
    dedupeKey: `${kind}:${task.id}:${task.deadline.toISOString()}`
  });

/**
 * Lateness scan side: late (once per task + deadline) and due-soon reminders to the worker and the job
 * leader. The tasks of an organization are loaded in one query per 500 (PERF-15).
 */
export const notifyDeadline = async (
  kind: "production.task_late" | "production.task_due_soon",
  rows: { organization_id: string; id: string }[]
) => {
  const byOrganization = new Map<string, string[]>();
  for (const row of rows) {
    const ids = byOrganization.get(row.organization_id) ?? [];
    ids.push(row.id);
    byOrganization.set(row.organization_id, ids);
  }
  for (const [organizationId, taskIds] of byOrganization) {
    for (let index = 0; index < taskIds.length; index += 500) {
      for (const task of await loadTaskInfos(organizationId, taskIds.slice(index, index + 500))) {
        await deliverDeadline(kind, organizationId, task);
      }
    }
  }
};
