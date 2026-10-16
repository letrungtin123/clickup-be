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
import { listOpenJobsLedBy, loadProductionAdminIds, loadProductionRoleHolderIds } from "./member-lookups.js";
import { parentNumberSql, taskCode } from "./task-codes.js";

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

/** `leaderId`: the Leader the job was given to (the handler skips it when the job has had another Leader since). */
export const jobLeaderAssignedEvent = (organizationId: string, jobId: string, actorId: string, leaderId: string) =>
  ({ ...event(organizationId, "production.job.leader_assigned", jobId, actorId, { jobId, leaderId }), aggregateType: "production_job" });

/** A job status as the PD-045 status notification carries it (by value: a later rename or delete keeps the story). */
export type JobStatusValue = { id: string; name: string; color: string };

/**
 * PD-045: someone changed the job's status (the manual chip). Enqueued in the change's transaction, only when the status
 * really changed; the handler reads the job's Leader and the Account / Admin people itself.
 */
export const jobStatusChangedEvent = (organizationId: string, jobId: string, actorId: string, from: JobStatusValue, to: JobStatusValue) => ({
  ...event(organizationId, "production.job.status_changed", jobId, actorId, {
    jobId,
    from: { id: from.id, name: from.name, color: from.color },
    to: { id: to.id, name: to.name, color: to.color }
  }),
  aggregateType: "production_job"
});

export const taskStatusEvent = (
  organizationId: string,
  taskId: string,
  actorId: string | null,
  change: { toCode: string; toName: string; enteredWaitingQc: boolean; enteredChecked: boolean; qcFail: boolean; note: string | null }
) => event(organizationId, "production.task.status_changed", taskId, actorId, { taskId, ...change });

export const taskQtyEvent = (organizationId: string, taskId: string, actorId: string, from: number, to: number, note: string | null) =>
  event(organizationId, "production.task.qty_changed", taskId, actorId, { taskId, from, to, note });

/**
 * PD-058: `actorId` filled in the quantity of a task that had none — directly (PATCH, `atDone` false) or when moving it to
 * Done (`atDone` true). One event per task (a subtask too); the handler tells the job's Leader.
 */
export const taskQtyFilledEvent = (organizationId: string, taskId: string, actorId: string | null, qty: number, atDone: boolean) =>
  event(organizationId, "production.task.qty_filled", taskId, actorId, { taskId, qty, atDone });

/**
 * PD-044 "Số lượng giao": a worker asked to change it (`requested`, → the job's Leader) or the request was decided
 * (`decided`, → the worker). The handler reads the request itself, so the payload only names it.
 */
export const qtyRequestEvent = (organizationId: string, kind: "requested" | "decided", taskId: string, requestId: string, actorId: string) =>
  event(organizationId, `production.task.qty_change_${kind}`, taskId, actorId, { taskId, requestId });

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
  /** JOB_LEADER_ASSIGNED → the job's (still active) Leader. */
  jobLeaderAssigned: (leaderId: string | null) => distinct([leaderId]),
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
  /**
   * QTY_CHANGE_REQUESTED (PD-044) → the job's (still active) Leader; without one — or when the Leader asked themselves —
   * the production Admins. Never the requester.
   */
  qtyChangeRequested: (task: TaskPeople, adminIds: readonly string[], requesterId: string) =>
    task.leaderId && task.leaderId !== requesterId ? [task.leaderId] : distinct(adminIds, [requesterId]),
  /** QTY_CHANGE_DECIDED (PD-044) → the worker who asked. */
  qtyChangeDecided: (requesterId: string) => distinct([requesterId]),
  /**
   * QTY_FILLED (PD-058) → the job's (still active) Leader; without one the production Admins (like a quantity request).
   * Never the person who filled it in (a Leader filling it in tells nobody).
   */
  qtyFilled: (task: TaskPeople, adminIds: readonly string[], actorId: string | null) =>
    task.leaderId ? distinct([task.leaderId], [actorId]) : distinct(adminIds, [actorId]),
  /**
   * JOB_STATUS_CHANGED (PD-045) → the job's (still active) Leader and every production Account / Admin (organization
   * superadmins included in `accountAdminIds`), never the person who changed it.
   */
  jobStatusChanged: (leaderId: string | null, accountAdminIds: readonly string[], actorId: string | null) =>
    distinct([leaderId, ...accountAdminIds], [actorId]),
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
  /**
   * LEAVE_REQUESTED → the approvers: holders of a role of the `leave_approval` feature (PD-065; by default production
   * Admins — PD-057: no Leaders) and the organization superadmins, never the requester.
   */
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
  /** null: no quantity yet (PD-058). */
  qty_assigned: number | null;
  qty_done: number | null;
  deadline: Date;
  /** PD-045 subtask letter index and its line's number (null for lines): the task's display code. */
  sub_seq: number | null;
  parent_number: string | number | null;
};

const loadTaskInfos = async (organizationId: string, taskIds: string[]) => {
  if (taskIds.length === 0) {
    return [];
  }
  const sql = getSql();
  return await sql<TaskInfo[]>`
    SELECT t.id, t.number, t.job_id, j.code AS job_code, j.leader_id, ${leaderActiveSql(sql)} AS leader_active,
      t.assignee_id, t.qc_id, pr.name AS process_name, t.qty_assigned, t.qty_done, t.deadline,
      t.sub_seq, ${parentNumberSql(sql)} AS parent_number
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

/** "1216" for a line, "1216a" for a subtask (PD-045). */
const codeOf = (task: TaskInfo) => taskCode({ number: task.number, subSeq: task.sub_seq, parentNumber: task.parent_number });

/** The task's images for a notification: Done quantity, else "Số lượng giao"; null while it has none (PD-058). */
const qtyOf = (task: Pick<TaskInfo, "qty_done" | "qty_assigned">) => task.qty_done ?? task.qty_assigned;

/** "#1216 · Retouch · 20 tấm" (without "· N tấm" while the task has no quantity, PD-058). */
const taskLine = (task: TaskInfo, qty: number | null) => [`#${codeOf(task)}`, task.process_name, ...(qty === null ? [] : [`${qty} tấm`])].join(" · ");

const taskPayload = (task: TaskInfo, extra: Record<string, unknown> = {}) => ({
  productionTaskId: task.id,
  jobId: task.job_id,
  jobCode: task.job_code,
  taskNumber: Number(task.number),
  /** PD-045 display code ("#" + code): the inbox and the e-mails show it instead of the number. */
  taskCode: codeOf(task),
  processName: task.process_name,
  /** null while the task has no quantity (PD-058). */
  qty: qtyOf(task),
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
    body: body ?? taskLine(task, qtyOf(task)),
    payload: taskPayload(task, extra),
    dedupeKey: `evt:${envelope.id}:${type}`
  });
};

const str = (value: unknown) => (typeof value === "string" ? value : null);
const strArray = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);

/** A { id, name, color } job status of an event payload (PD-045); null when malformed. */
const jobStatusValue = (value: unknown): JobStatusValue | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = str(record.id);
  const name = str(record.name);
  return id && name ? { id, name, color: str(record.color) ?? "slate" } : null;
};

type QtyRequestInfo = {
  id: string;
  from_qty: number;
  to_qty: number;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  requested_by: string;
  decision_note: string | null;
};

/** The task and the quantity request named by a qty_change_* event (PD-044); null when either is gone. */
const loadQtyRequest = async (envelope: DomainEventEnvelope) => {
  const taskId = str(envelope.payload.taskId);
  const requestId = str(envelope.payload.requestId);
  if (!taskId || !requestId) {
    return null;
  }
  const [task, request] = await Promise.all([
    loadTaskInfo(envelope.organizationId, taskId),
    getSql()<QtyRequestInfo[]>`
      SELECT id, from_qty, to_qty, reason, status, requested_by, decision_note FROM production.task_qty_requests
      WHERE organization_id = ${envelope.organizationId} AND id = ${requestId} AND task_id = ${taskId}
    `
  ]);
  return task && request[0] ? { task, request: request[0] } : null;
};

/** Payload extras of the qty_change_* notifications: { requestId, fromQty, toQty, reason, approved, decisionNote }. */
const qtyRequestPayload = (request: QtyRequestInfo) => ({
  requestId: request.id,
  fromQty: request.from_qty,
  toQty: request.to_qty,
  reason: request.reason,
  approved: request.status === "PENDING" ? null : request.status === "APPROVED",
  decisionNote: request.decision_note
});

export const productionNotificationHandlers: Record<string, (event: DomainEventEnvelope) => Promise<void>> = {
  "production.task.assigned": async (envelope) => {
    const task = await loadTaskInfo(envelope.organizationId, str(envelope.payload.taskId) ?? "");
    if (task) {
      await notifyTask(envelope, task, "production.task_assigned", productionRecipients.taskAssigned(peopleOf(task)));
    }
  },

  /** The job's Leader learns the job is theirs (created with them as Leader, or the Leader changed to them). */
  "production.job.leader_assigned": async (envelope) => {
    const jobId = str(envelope.payload.jobId);
    const leaderId = str(envelope.payload.leaderId);
    if (!jobId || !leaderId) {
      return;
    }
    const sql = getSql();
    const job = (
      await sql<{ code: string; name: string | null; project_code: string; deadline: Date; leader_id: string | null; leader_active: boolean; task_count: number }[]>`
        SELECT j.code, j.name, p.code AS project_code, j.deadline, j.leader_id, ${leaderActiveSql(sql)} AS leader_active,
          -- Lines only: a subtask (PD-044) is part of its line.
          (SELECT count(*)::int FROM production.tasks t
            WHERE t.organization_id = j.organization_id AND t.job_id = j.id AND t.deleted_at IS NULL
              AND NOT (t.kind = 'NORMAL' AND t.parent_task_id IS NOT NULL)) AS task_count
        FROM production.jobs j
        JOIN production.projects p ON p.organization_id = j.organization_id AND p.id = j.project_id
        WHERE j.organization_id = ${envelope.organizationId} AND j.id = ${jobId} AND j.deleted_at IS NULL
      `
    )[0];
    // Another Leader since the change (or none, or no longer a Leader): nothing to tell this person.
    if (!job || job.leader_id !== leaderId || !job.leader_active) {
      return;
    }
    await deliverNotifications({
      organizationId: envelope.organizationId,
      recipientIds: productionRecipients.jobLeaderAssigned(job.leader_id),
      type: "production.job_leader_assigned",
      actorUserId: envelope.actorUserId,
      title: job.code,
      body: job.name,
      payload: {
        jobId,
        jobCode: job.code,
        jobName: job.name,
        projectCode: job.project_code,
        deadline: job.deadline.toISOString(),
        taskCount: job.task_count
      },
      dedupeKey: `evt:${envelope.id}`
    });
  },

  /**
   * PD-045: the job's status (the manual chip) changed → its active Leader (leaderActiveSql) and every active production
   * Account / Admin (organization superadmins included), never the person who changed it. Title: the job's code; body
   * "Đang làm → Đã xong" from the statuses as they were at the change (event payload). A deleted job tells nobody.
   */
  "production.job.status_changed": async (envelope) => {
    const jobId = str(envelope.payload.jobId);
    const from = jobStatusValue(envelope.payload.from);
    const to = jobStatusValue(envelope.payload.to);
    if (!jobId || !from || !to) {
      return;
    }
    const sql = getSql();
    const job = (
      await sql<{ code: string; name: string | null; leader_id: string | null; leader_active: boolean }[]>`
        SELECT j.code, j.name, j.leader_id, ${leaderActiveSql(sql)} AS leader_active
        FROM production.jobs j
        WHERE j.organization_id = ${envelope.organizationId} AND j.id = ${jobId} AND j.deleted_at IS NULL
      `
    )[0];
    if (!job) {
      return;
    }
    const accountAdminIds = await loadProductionRoleHolderIds(sql, envelope.organizationId, ["ACCOUNT", "ADMIN"]);
    await deliverNotifications({
      organizationId: envelope.organizationId,
      recipientIds: productionRecipients.jobStatusChanged(job.leader_active ? job.leader_id : null, accountAdminIds, envelope.actorUserId),
      type: "production.job_status_changed",
      actorUserId: envelope.actorUserId,
      title: job.code,
      body: `${from.name} → ${to.name}`,
      payload: { jobId, jobCode: job.code, jobName: job.name, from, to },
      dedupeKey: `evt:${envelope.id}`
    });
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
      `#${codeOf(task)}: ${String(envelope.payload.from)} → ${String(envelope.payload.to)} tấm${note ? ` — ${note}` : ""}`
    );
  },

  /**
   * PD-044: a worker's request to change "Số lượng giao" → the job's active Leader (else the production Admins), while it
   * is still open (a request cancelled or decided before the worker ran tells nobody).
   */
  "production.task.qty_change_requested": async (envelope) => {
    const loaded = await loadQtyRequest(envelope);
    if (!loaded || loaded.request.status !== "PENDING") {
      return;
    }
    const { task, request } = loaded;
    const people = peopleOf(task);
    const leaderNeeded = !people.leaderId || people.leaderId === request.requested_by;
    const adminIds = leaderNeeded ? await loadProductionAdminIds(getSql(), envelope.organizationId) : [];
    await notifyTask(
      envelope,
      task,
      "production.qty_change_requested",
      productionRecipients.qtyChangeRequested(people, adminIds, request.requested_by),
      qtyRequestPayload(request),
      `#${codeOf(task)}: ${request.from_qty} → ${request.to_qty} tấm — ${request.reason}`
    );
  },

  /**
   * PD-058: someone filled in a task's empty quantity (directly or at Done) → the job's active Leader, else the production
   * Admins; never the person who filled it in. Body "#1286 · Retouch · 120 tấm" with the number filled in (the event's);
   * payload: the task's + { filledQty, atDone }. A task deleted before the worker ran tells nobody.
   */
  "production.task.qty_filled": async (envelope) => {
    const task = await loadTaskInfo(envelope.organizationId, str(envelope.payload.taskId) ?? "");
    const filled = typeof envelope.payload.qty === "number" ? envelope.payload.qty : null;
    if (!task || filled === null) {
      return;
    }
    const people = peopleOf(task);
    const adminIds = people.leaderId ? [] : await loadProductionAdminIds(getSql(), envelope.organizationId);
    await notifyTask(
      envelope,
      task,
      "production.qty_filled",
      productionRecipients.qtyFilled(people, adminIds, envelope.actorUserId),
      { filledQty: filled, atDone: envelope.payload.atDone === true },
      taskLine(task, filled)
    );
  },

  /** PD-044: the request was approved or rejected → the worker who asked (the decider never: they are the actor). */
  "production.task.qty_change_decided": async (envelope) => {
    const loaded = await loadQtyRequest(envelope);
    if (!loaded || (loaded.request.status !== "APPROVED" && loaded.request.status !== "REJECTED")) {
      return;
    }
    const { task, request } = loaded;
    const approved = request.status === "APPROVED";
    await notifyTask(
      envelope,
      task,
      "production.qty_change_decided",
      productionRecipients.qtyChangeDecided(request.requested_by),
      qtyRequestPayload(request),
      `#${codeOf(task)}: ${request.from_qty} → ${request.to_qty} tấm ${approved ? "đã được duyệt" : "bị từ chối"}${request.decision_note ? ` — ${request.decision_note}` : ""}`
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

type LeaveInfo = {
  user_id: string;
  display_name: string;
  from_date: string;
  to_date: string;
  part: string;
  status: string;
  /** The requester's reason ("Lý do nghỉ", required since PD-057; older requests may have none). */
  note: string | null;
  decision_note: string | null;
};

const loadLeave = async (organizationId: string, leaveId: string) =>
  (
    await getSql()<LeaveInfo[]>`
      SELECT lr.user_id, au.display_name, to_char(lr.from_date, 'YYYY-MM-DD') AS from_date, to_char(lr.to_date, 'YYYY-MM-DD') AS to_date,
        lr.part, lr.status, lr.note, lr.decision_note
      FROM production.leave_requests lr
      JOIN public.app_users au ON au.id = lr.user_id
      WHERE lr.organization_id = ${organizationId} AND lr.id = ${leaveId}
    `
  )[0] ?? null;

/** Longest reason quoted in a leave notification (body and payload), in characters. */
export const leaveReasonExcerptLength = 200;

/** The reason on one line, cut to `leaveReasonExcerptLength` characters with "…"; null when there is none. */
export const leaveReasonExcerpt = (note: string | null | undefined) => {
  const flat = (note ?? "").replace(/\s+/g, " ").trim();
  if (!flat) {
    return null;
  }
  const chars = [...flat];
  return chars.length > leaveReasonExcerptLength ? `${chars.slice(0, leaveReasonExcerptLength - 1).join("").trimEnd()}…` : flat;
};

const leavePartPhrases: Record<string, string> = { FULL_DAY: "Nghỉ cả ngày", MORNING: "Nghỉ buổi sáng", AFTERNOON: "Nghỉ buổi chiều" };
const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/**
 * Body of the "new leave request" notification (PD-057): what, when and why for the approver —
 * "Nghỉ cả ngày 20/10 – 21/10: Việc gia đình", "Nghỉ buổi sáng 20/10: Khám bệnh" (no ": …" without a reason).
 */
export const leaveRequestedBody = (leave: { from_date: string; to_date: string; part: string; note: string | null }) => {
  const span = leave.from_date === leave.to_date ? shortDay(leave.from_date) : `${shortDay(leave.from_date)} – ${shortDay(leave.to_date)}`;
  const reason = leaveReasonExcerpt(leave.note);
  return `${leavePartPhrases[leave.part] ?? "Nghỉ"} ${span}${reason ? `: ${reason}` : ""}`;
};

const leavePayload = (leaveId: string, leave: LeaveInfo) => ({
  leaveId,
  requesterName: leave.display_name,
  fromDate: leave.from_date,
  toDate: leave.to_date,
  part: leave.part,
  status: leave.status,
  /** The requester's reason, cut like the body (PD-057). */
  reason: leaveReasonExcerpt(leave.note),
  /** The approver's decision note. */
  note: leave.decision_note
});

Object.assign(productionNotificationHandlers, {
  /**
   * New leave request → the people who can approve it: active holders of a role of the `leave_approval` feature
   * (PD-065; by default Quản trị — PD-057: Leaders are not notified, they still see pending requests in the calendar)
   * and the organization superadmins. Never the requester. The body says what, when and why (`leaveRequestedBody`).
   */
  "production.leave.requested": async (envelope: DomainEventEnvelope) => {
    const leaveId = str(envelope.payload.leaveId);
    const leave = leaveId ? await loadLeave(envelope.organizationId, leaveId) : null;
    if (!leaveId || !leave) {
      return;
    }
    const sql = getSql();
    const approverRoles = (await loadSettings(sql, envelope.organizationId)).featurePermissions.leave_approval;
    const approverIds = await loadProductionRoleHolderIds(sql, envelope.organizationId, approverRoles);
    await deliverNotifications({
      organizationId: envelope.organizationId,
      recipientIds: productionRecipients.leaveRequested(approverIds, leave.user_id),
      type: "production.leave_requested",
      actorUserId: envelope.actorUserId,
      title: leave.display_name,
      body: leaveRequestedBody(leave),
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
    body: taskLine(task, task.qty_assigned),
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
