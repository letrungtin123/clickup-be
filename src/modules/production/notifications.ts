import type postgres from "postgres";

import type { NotificationType } from "../../contracts/notifications.js";
import { getSql } from "../../db/client.js";
import type { QuerySql } from "../../lib/db-types.js";
import type { DomainEventEnvelope, DomainEventInput } from "../events/outbox.js";
import { enqueueDomainEvents } from "../events/outbox.js";
import { deliverNotifications } from "../notifications/notifications.service.js";
import { kpiSettlementNotificationHandlers } from "./kpi-settlement-notifications.js";

/**
 * Production notifications (PLAN §8): events are written to the outbox inside the task transaction,
 * the worker turns them into inbox entries (and e-mails when enabled). Recipients:
 * assigned → assignee; waiting QC → QC; QC fail → assignee; checked → job leader;
 * qty corrected → assignee; client feedback → job leader + original workers; mentions → mentioned.
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

// Worker side ----------------------------------------------------------------------------------------------

type TaskInfo = {
  id: string;
  number: string | number;
  job_id: string;
  job_code: string;
  leader_id: string;
  assignee_id: string;
  qc_id: string | null;
  process_name: string;
  qty_assigned: number;
  qty_done: number | null;
  deadline: Date;
};

const loadTaskInfos = async (organizationId: string, taskIds: string[]) =>
  taskIds.length === 0
    ? []
    : await getSql()<TaskInfo[]>`
        SELECT t.id, t.number, t.job_id, j.code AS job_code, j.leader_id, t.assignee_id, t.qc_id, pr.name AS process_name,
          t.qty_assigned, t.qty_done, t.deadline
        FROM production.tasks t
        JOIN production.jobs j ON j.organization_id = t.organization_id AND j.id = t.job_id
        JOIN production.processes pr ON pr.organization_id = t.organization_id AND pr.id = t.process_id
        WHERE t.organization_id = ${organizationId} AND t.id = ANY(${taskIds}::uuid[])
      `;

const loadTaskInfo = async (organizationId: string, taskId: string) => (await loadTaskInfos(organizationId, [taskId]))[0] ?? null;

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
  recipientIds: (string | null)[],
  extra: Record<string, unknown> = {},
  body: string | null = null
) => {
  await deliverNotifications({
    organizationId: envelope.organizationId,
    recipientIds: recipientIds.filter((id): id is string => Boolean(id)),
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
      await notifyTask(envelope, task, "production.task_assigned", [task.assignee_id]);
    }
  },

  "production.task.status_changed": async (envelope) => {
    const task = await loadTaskInfo(envelope.organizationId, str(envelope.payload.taskId) ?? "");
    if (!task) {
      return;
    }
    const note = str(envelope.payload.note);
    if (envelope.payload.qcFail === true) {
      await notifyTask(envelope, task, "production.qc_failed", [task.assignee_id], { note }, note);
    }
    if (envelope.payload.enteredWaitingQc === true) {
      await notifyTask(envelope, task, "production.task_waiting_qc", [task.qc_id]);
    }
    if (envelope.payload.enteredChecked === true) {
      await notifyTask(envelope, task, "production.task_checked", [task.leader_id]);
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
      [task.assignee_id],
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
      await sql<{ code: string; leader_id: string; workers: string[] }[]>`
        SELECT j.code, j.leader_id,
          coalesce((SELECT array_agg(DISTINCT t.assignee_id) FROM production.tasks t
            WHERE t.organization_id = j.organization_id AND t.job_id = j.id
              AND CASE
                WHEN ${sourceTaskId}::uuid IS NOT NULL THEN t.id = ${sourceTaskId}::uuid
                WHEN cardinality(${parked}::uuid[]) > 0 THEN t.id = ANY(${parked}::uuid[])
                ELSE t.kind = 'NORMAL'
              END), '{}') AS workers
        FROM production.jobs j WHERE j.organization_id = ${envelope.organizationId} AND j.id = ${jobId}
      `
    )[0];
    if (!job) {
      return;
    }
    const note = str(envelope.payload.note);
    await deliverNotifications({
      organizationId: envelope.organizationId,
      recipientIds: [job.leader_id, ...job.workers],
      type: "production.feedback",
      actorUserId: envelope.actorUserId,
      title: job.code,
      body: note,
      payload: { jobId, jobCode: job.code, feedbackType: str(envelope.payload.type), note },
      dedupeKey: `evt:${envelope.id}`
    });
  },

  /** Mentioned people get "nhắc đến"; the task's worker, QC and job leader (or the job's leader and creator) get "bình luận". */
  "production.comment.created": async (envelope) => {
    const jobId = str(envelope.payload.jobId);
    if (!jobId) {
      return;
    }
    const mentioned = strArray(envelope.payload.mentionedUserIds);
    const taskId = str(envelope.payload.taskId);
    const task = taskId ? await loadTaskInfo(envelope.organizationId, taskId) : null;
    const job = (
      await getSql()<{ code: string; leader_id: string; created_by: string }[]>`
        SELECT code, leader_id, created_by FROM production.jobs WHERE organization_id = ${envelope.organizationId} AND id = ${jobId}
      `
    )[0];
    if (!job) {
      return;
    }
    const commentId = str(envelope.payload.commentId);
    const payload = task ? taskPayload(task, { commentId }) : { jobId, jobCode: job.code, commentId };
    const related = (task ? [task.assignee_id, task.qc_id, job.leader_id] : [job.leader_id, job.created_by]).filter(
      (id): id is string => Boolean(id) && !mentioned.includes(id as string)
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
    const recipients = await getSql()<{ user_id: string }[]>`
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
      recipientIds: recipients.map((row) => row.user_id),
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
      recipientIds: [leave.user_id],
      type: "production.leave_decided",
      actorUserId: envelope.actorUserId,
      title: leave.status === "APPROVED" ? "Đơn nghỉ được duyệt" : "Đơn nghỉ bị từ chối",
      body: leave.decision_note,
      payload: leavePayload(leaveId, leave),
      dedupeKey: `evt:${envelope.id}`
    });
  }
});

// SPEC §8.2: KPI_SETTLED → each settled person + one summary per run for production admins.
Object.assign(productionNotificationHandlers, kpiSettlementNotificationHandlers);

const deliverDeadline = (kind: "production.task_late" | "production.task_due_soon", organizationId: string, task: TaskInfo) =>
  deliverNotifications({
    organizationId,
    recipientIds: [task.assignee_id, task.leader_id],
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
