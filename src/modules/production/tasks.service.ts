import { randomUUID } from "node:crypto";

import type { z } from "zod";

import type {
  AssignTaskRequestSchema,
  CreateTaskLine,
  MyProductionTasksQuery,
  ProductionTask,
  ProductionTaskPage,
  TaskKind,
  TransitionTaskRequest,
  UpdateProductionTaskRequestSchema
} from "../../contracts/production-jobs.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import type { QuerySql } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { assertProductionMember } from "./access.js";
import { cursorInstantSql, decodeTimeCursor, encodeTimeCursor } from "./cursor.js";
import { loadFieldDefinitions, resolveCustomValues, setEntityTags, validateCustomValues } from "./custom-fields.js";
import { syncJobChat } from "./job-chat.service.js";
import {
  canManageTask,
  canViewTask,
  finishedStatusIds,
  jobArchivedError,
  loadMemberRoles,
  loadTask,
  loadWorkflowModel,
  relationOf,
  selectTasks,
  taskSelectSql,
  toProductionTask,
  type TaskRow
} from "./jobs.repo.js";
import { enqueueProductionEvents, taskAssignedEvent, taskQtyEvent, taskStatusEvent } from "./notifications.js";
import { publishProductionChange } from "./realtime.js";
import { onTaskQtyChanged, onTaskStatusEntered } from "./scoring-hooks.js";
import {
  assertTransition,
  computeIsLate,
  defaultTaskDeadline,
  deriveJobStatus,
  feedbackTaskDeadline,
  isQcFail,
  overAllocationWarning,
  statusByCode,
  statusById,
  systemFollowUp,
  taskLineErrors,
  type Workflow,
  type WorkflowStatus
} from "./workflow.js";

export { publishProductionChange };

type In<T extends z.ZodTypeAny> = z.infer<T>;
const notFound = () => new AppError("TASK_NOT_FOUND", "Không tìm thấy task.", 404);

// Locking & logging -------------------------------------------------------------------------------------

/** Locks the job first, then the task (same order everywhere, so concurrent changes never deadlock). */
export const lockTaskForUpdate = async (tx: QuerySql, organizationId: string, taskId: string) => {
  const row = (await tx<{ job_id: string }[]>`SELECT job_id FROM production.tasks WHERE organization_id = ${organizationId} AND id = ${taskId}`)[0];
  if (!row) {
    throw notFound();
  }
  await tx`SELECT 1 FROM production.jobs WHERE organization_id = ${organizationId} AND id = ${row.job_id} FOR UPDATE`;
  await tx`SELECT 1 FROM production.tasks WHERE organization_id = ${organizationId} AND id = ${taskId} FOR UPDATE`;
  return row.job_id;
};

type LogInput = {
  taskId: string;
  jobId: string;
  userId: string | null;
  action: "CREATE" | "STATUS" | "QTY" | "ASSIGN" | "NOTE" | "FIELD";
  from?: Record<string, unknown> | null;
  to?: Record<string, unknown> | null;
  note?: string | null;
  /** Event time (defaults to now; the worklog seed replays history with past times). */
  at?: Date;
};

export const insertTaskLogs = async (tx: QuerySql, organizationId: string, logs: LogInput[]) => {
  if (logs.length === 0) {
    return;
  }
  await tx`
    INSERT INTO production.task_logs (organization_id, task_id, job_id, user_id, action, from_value, to_value, note, created_at)
    SELECT ${organizationId}, (l->>'taskId')::uuid, (l->>'jobId')::uuid, (l->>'userId')::uuid, l->>'action',
      nullif(l->'from', 'null'::jsonb), nullif(l->'to', 'null'::jsonb), l->>'note', coalesce((l->>'at')::timestamptz, now())
    FROM jsonb_array_elements(${tx.json(
      logs.map((log) => ({
        taskId: log.taskId,
        jobId: log.jobId,
        userId: log.userId,
        action: log.action,
        from: log.from ?? null,
        to: log.to ?? null,
        note: log.note ?? null,
        at: log.at ? log.at.toISOString() : null
      })) as never
    )}) AS l
  `;
};

const statusLogValue = (status: WorkflowStatus) => ({ statusId: status.id, code: status.code, name: status.name });

// Status engine -----------------------------------------------------------------------------------------

type MoveExtras = { qtyDone?: number | undefined; otHours?: number | undefined; override?: boolean; at?: Date };

/**
 * Applies the same status change to locked tasks (one task, or a job-level bulk move): Done/Checked timestamps
 * and quantity, closed_at, lateness, QC-fail counter, history rows and the scoring hook. One UPDATE and one
 * history INSERT for all of them (PERF-15); the scoring hook still runs per task when the target status
 * records scores. Callers validate permissions first; the result keeps the input order.
 */
export const moveTasks = async (
  tx: QuerySql,
  organizationId: string,
  workflow: Workflow,
  tasks: TaskRow[],
  to: WorkflowStatus,
  actorId: string | null,
  note: string | null,
  extras: MoveExtras = {}
): Promise<TaskRow[]> => {
  if (tasks.length === 0) {
    return [];
  }
  const now = extras.at ?? new Date();
  // Entering Complete or later closes the task (BUG-PR-08); moving back into the pipeline reopens it.
  const closing = finishedStatusIds(workflow).includes(to.id);
  const planned = tasks.map((task) => {
    const from = statusById(workflow, task.status_id);
    if (!from) {
      throw new AppError("WORKFLOW_INCOMPLETE", "Trạng thái hiện tại của task không còn tồn tại.", 409);
    }
    if (to.code === "WAITING_QC" && !task.qc_id) {
      throw new AppError("QC_REQUIRED", "Cần gán QC trước khi chuyển sang chờ QC.", 400);
    }
    const firstDone = to.countsDone && task.done_at === null;
    let qtyDone = task.qty_done;
    let otHours = task.ot_hours === null ? null : Number(task.ot_hours);
    if (firstDone) {
      qtyDone = extras.qtyDone ?? task.qty_assigned;
      if (task.requires_ot_hours) {
        if (extras.otHours === undefined) {
          throw new AppError("OT_HOURS_REQUIRED", "Ca OT cần nhập số giờ OT khi Done.", 400);
        }
        otHours = extras.otHours;
      }
    } else if (extras.qtyDone !== undefined && extras.qtyDone !== task.qty_done) {
      throw new AppError("QTY_LOCKED", "Số lượng đã chốt ở lần Done đầu tiên; nhờ Leader sửa nếu cần.", 400);
    }
    const qcFail = isQcFail(from, to, extras.override === true);
    const doneAt = task.done_at ?? (to.countsDone ? now : null);
    const checkedAt = task.checked_at ?? (to.countsChecked ? now : null);
    const closedAt = closing ? (task.closed_at ?? now) : null;
    const isLate = computeIsLate({ doneAt, closed: closedAt !== null, deadline: task.deadline, now });
    return { task, from, firstDone, qtyDone, otHours, qcFail, doneAt, checkedAt, closedAt, isLate };
  });

  // Existing timestamps are kept by the database (coalesce) so their microseconds survive.
  await tx`
    UPDATE production.tasks AS t
    SET status_id = ${to.id},
        qty_done = CASE WHEN (m->>'firstDone')::boolean THEN (m->>'qtyDone')::int ELSE t.qty_done END,
        ot_hours = CASE WHEN (m->>'firstDone')::boolean THEN (m->>'otHours')::numeric ELSE t.ot_hours END,
        done_at = coalesce(t.done_at, (m->>'doneAt')::timestamptz),
        checked_at = coalesce(t.checked_at, (m->>'checkedAt')::timestamptz),
        closed_at = CASE WHEN ${closing} THEN coalesce(t.closed_at, (m->>'closedAt')::timestamptz) ELSE NULL END,
        is_late = (m->>'isLate')::boolean,
        qc_fail_count = t.qc_fail_count + (m->>'qcFail')::int,
        updated_at = now()
    FROM jsonb_array_elements(${tx.json(
      planned.map((plan) => ({
        id: plan.task.id,
        firstDone: plan.firstDone,
        qtyDone: plan.qtyDone,
        otHours: plan.otHours,
        doneAt: plan.doneAt?.toISOString() ?? null,
        checkedAt: plan.checkedAt?.toISOString() ?? null,
        closedAt: plan.closedAt?.toISOString() ?? null,
        isLate: plan.isLate,
        qcFail: plan.qcFail ? 1 : 0
      }))
    )}) AS m
    WHERE t.organization_id = ${organizationId} AND t.id = (m->>'id')::uuid
  `;
  await insertTaskLogs(
    tx,
    organizationId,
    planned.map((plan) => ({
      taskId: plan.task.id,
      jobId: plan.task.job_id,
      userId: actorId,
      action: "STATUS" as const,
      from: statusLogValue(plan.from),
      to: {
        ...statusLogValue(to),
        ...(plan.firstDone ? { qtyDone: plan.qtyDone, ...(plan.otHours !== null ? { otHours: plan.otHours } : {}) } : {}),
        ...(plan.qcFail ? { qcFail: true } : {}),
        ...(extras.override ? { override: true } : {})
      },
      note,
      at: now
    }))
  );
  const events = planned.flatMap((plan) => {
    const enteredWaitingQc = to.code === "WAITING_QC";
    const enteredChecked = to.countsChecked && plan.task.checked_at === null;
    return enteredWaitingQc || enteredChecked || plan.qcFail
      ? [taskStatusEvent(organizationId, plan.task.id, actorId, { toCode: to.code, toName: to.name, enteredWaitingQc, enteredChecked, qcFail: plan.qcFail, note })]
      : [];
  });
  await enqueueProductionEvents(tx, events);
  if (to.countsDone || to.countsChecked) {
    for (const plan of planned) {
      await onTaskStatusEntered(tx, {
        organizationId,
        taskId: plan.task.id,
        // Credit only work that was Done: an ADMIN override skipping Done records no QC credit either.
        status: { id: to.id, countsDone: to.countsDone, countsChecked: to.countsChecked && plan.doneAt !== null },
        at: now
      });
    }
  }
  return planned.map((plan) => ({
    ...plan.task,
    status_id: to.id,
    status_code: to.code,
    status_name: to.name,
    qty_done: plan.qtyDone,
    ot_hours: plan.otHours === null ? null : String(plan.otHours),
    done_at: plan.doneAt,
    checked_at: plan.checkedAt,
    closed_at: plan.closedAt,
    is_late: plan.isLate,
    qc_fail_count: plan.task.qc_fail_count + (plan.qcFail ? 1 : 0)
  }));
};

/** One task's status change (see moveTasks). */
export const moveTask = async (
  tx: QuerySql,
  organizationId: string,
  workflow: Workflow,
  task: TaskRow,
  to: WorkflowStatus,
  actorId: string | null,
  note: string | null,
  extras: MoveExtras = {}
): Promise<TaskRow> => (await moveTasks(tx, organizationId, workflow, [task], to, actorId, note, extras))[0]!;

/** SYSTEM follow-up moves (Done → Waiting QC once a QC is assigned). */
export const applyFollowUps = async (tx: QuerySql, organizationId: string, workflow: Workflow, task: TaskRow) => {
  const next = systemFollowUp(workflow, task.status_id, task.qc_id !== null);
  return next ? await moveTask(tx, organizationId, workflow, task, next, null, "Tự động chuyển sang chờ QC.") : task;
};

/**
 * Once no feedback of the job is open: the source tasks parked in FEEDBACK and the re-done FB tasks that
 * reached Checked go back to Complete, so the Account can deliver again. Normal tasks keep their flow.
 * Returns the moved task ids (none while a feedback is still open).
 */
export const releaseParkedTasks = async (
  tx: QuerySql,
  organizationId: string,
  workflow: Workflow,
  jobId: string,
  actorId: string | null,
  note: string
) => {
  const stillOpen = await tx<{ count: number }[]>`
    SELECT count(*)::int AS count FROM production.feedbacks WHERE organization_id = ${organizationId} AND job_id = ${jobId} AND status <> 'RESOLVED'
  `;
  if (stillOpen[0]!.count > 0) {
    return [];
  }
  const complete = statusByCode(workflow, "COMPLETE");
  const checked = workflow.statuses.filter((status) => status.countsChecked).map((status) => status.id);
  const ids = (
    await tx<{ id: string }[]>`
      SELECT id FROM production.tasks WHERE organization_id = ${organizationId} AND job_id = ${jobId}
        AND (status_id = ${statusByCode(workflow, "FEEDBACK").id}
          OR (feedback_id IS NOT NULL AND status_id = ANY(${checked}::uuid[])))
      ORDER BY created_at FOR UPDATE
    `
  ).map((row) => row.id);
  await moveTasks(tx, organizationId, workflow, await selectTasks(tx, organizationId, ids), complete, actorId, note);
  return ids;
};

/**
 * After task changes in a job: resolve feedback whose re-done tasks are all checked (source tasks and FB
 * tasks return to Complete), then store the job status derived from its tasks.
 */
export const settleJob = async (tx: QuerySql, organizationId: string, workflow: Workflow, jobId: string) => {
  const ready = await tx<{ id: string }[]>`
    SELECT f.id FROM production.feedbacks f
    WHERE f.organization_id = ${organizationId} AND f.job_id = ${jobId} AND f.status <> 'RESOLVED'
      AND EXISTS (SELECT 1 FROM production.tasks t WHERE t.organization_id = f.organization_id AND t.feedback_id = f.id)
      AND NOT EXISTS (SELECT 1 FROM production.tasks t WHERE t.organization_id = f.organization_id AND t.feedback_id = f.id AND t.checked_at IS NULL)
  `;
  if (ready.length > 0) {
    await tx`
      UPDATE production.feedbacks SET status = 'RESOLVED', resolution = 'REWORKED', resolved_at = now()
      WHERE organization_id = ${organizationId} AND id = ANY(${ready.map((row) => row.id)}::uuid[])
    `;
    await releaseParkedTasks(tx, organizationId, workflow, jobId, null, "Feedback đã xử lý xong — trở về Complete.");
  }
  const [statusRows, open] = await Promise.all([
    tx<{ status_id: string }[]>`SELECT DISTINCT status_id FROM production.tasks WHERE organization_id = ${organizationId} AND job_id = ${jobId}`,
    tx<{ open: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM production.feedbacks WHERE organization_id = ${organizationId} AND job_id = ${jobId} AND status <> 'RESOLVED') AS open
    `
  ]);
  const derived = deriveJobStatus(workflow, statusRows.map((row) => row.status_id), open[0]!.open);
  await tx`
    UPDATE production.jobs SET status_id = ${derived}, updated_at = now()
    WHERE organization_id = ${organizationId} AND id = ${jobId} AND status_id IS DISTINCT FROM ${derived}::uuid
  `;
};

// Reads ---------------------------------------------------------------------------------------------------

export const getProductionTask = async (context: AccessContext, taskId: string, sql: QuerySql = getSql()): Promise<ProductionTask> => {
  assertProductionMember(context);
  const [task, workflow] = await Promise.all([loadTask(sql, context.organization.id, taskId), loadWorkflowModel(sql, context.organization.id)]);
  const relation = relationOf(context, task);
  if (!canViewTask(relation)) {
    throw notFound();
  }
  return toProductionTask(task, workflow, relation);
};

/** Personal board: tasks I work on and/or check, soonest deadline first (full-precision keyset, BUG-PR-05). */
export const listMyProductionTasks = async (context: AccessContext, query: MyProductionTasksQuery): Promise<ProductionTaskPage> => {
  assertProductionMember(context);
  const sql = getSql();
  const organizationId = context.organization.id;
  const cursor = decodeTimeCursor(query.cursor);
  const workflow = await loadWorkflowModel(sql, organizationId);
  const finished = query.includeFinished ? [] : finishedStatusIds(workflow);
  const me = context.user.id;
  const rows = await sql<TaskRow[]>`
    ${taskSelectSql(sql)}
    WHERE t.organization_id = ${organizationId}
      AND ${query.role === "assignee" ? sql`t.assignee_id = ${me}` : query.role === "qc" ? sql`t.qc_id = ${me}` : sql`(t.assignee_id = ${me} OR t.qc_id = ${me})`}
      AND NOT (t.status_id = ANY(${finished}::uuid[]))
      AND j.archived_at IS NULL
      ${cursor ? sql`AND (t.deadline, t.id) > (${cursorInstantSql(sql, cursor.at)}, ${cursor.id}::uuid)` : sql``}
    ORDER BY t.deadline, t.id
    LIMIT ${query.limit + 1}
  `;
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((row) => toProductionTask(row, workflow, relationOf(context, row))),
    pageInfo: { hasMore: rows.length > query.limit, nextCursor: rows.length > query.limit && last ? encodeTimeCursor(last.deadline_cursor, last.id) : null }
  };
};

/** QC queue: tasks waiting for my check, oldest Done first (archived jobs left out, BUG-PR-04). */
export const listQcQueue = async (context: AccessContext) => {
  assertProductionMember(context);
  const sql = getSql();
  const workflow = await loadWorkflowModel(sql, context.organization.id);
  const waiting = workflow.statuses.filter((status) => status.code === "WAITING_QC").map((status) => status.id);
  const rows = await sql<TaskRow[]>`
    ${taskSelectSql(sql)}
    WHERE t.organization_id = ${context.organization.id} AND t.qc_id = ${context.user.id}
      AND t.status_id = ANY(${waiting}::uuid[]) AND j.archived_at IS NULL
    ORDER BY t.done_at NULLS LAST, t.id
    LIMIT 500
  `;
  return { items: rows.map((row) => toProductionTask(row, workflow, relationOf(context, row))), pageInfo: { hasMore: false, nextCursor: null } };
};

// Creating tasks -------------------------------------------------------------------------------------------

type JobForTasks = { id: string; leader_id: string; deadline: Date; total_images: number; qc_buffer_hours: number };

export const loadJobForTasks = async (tx: QuerySql, organizationId: string, jobId: string, lock: boolean) => {
  const job = (
    await tx<(JobForTasks & { archived_at: Date | null })[]>`
      SELECT j.id, j.leader_id, j.deadline, j.total_images, p.qc_buffer_hours, j.archived_at
      FROM production.jobs j JOIN production.projects p ON p.organization_id = j.organization_id AND p.id = j.project_id
      WHERE j.organization_id = ${organizationId} AND j.id = ${jobId}
      ${lock ? tx`FOR UPDATE OF j` : tx``}
    `
  )[0];
  if (!job) {
    throw new AppError("JOB_NOT_FOUND", "Không tìm thấy job.", 404);
  }
  if (job.archived_at) {
    throw jobArchivedError();
  }
  return job;
};

const lineContext = async (tx: QuerySql, organizationId: string, callerId: string, userIds: string[]) => {
  const [memberRoles, processes, shifts] = await Promise.all([
    loadMemberRoles(tx, organizationId, userIds),
    tx<{ id: string; active: boolean; is_qc: boolean; name: string }[]>`SELECT id, active, is_qc, name FROM production.processes WHERE organization_id = ${organizationId}`,
    tx<{ id: string; active: boolean }[]>`SELECT id, active FROM production.shifts WHERE organization_id = ${organizationId}`
  ]);
  return {
    callerId,
    memberRoles,
    processes: new Map(processes.map((row) => [row.id, { active: row.active, isQc: row.is_qc, name: row.name }])),
    shifts: new Map(shifts.map((row) => [row.id, { active: row.active }]))
  };
};

/** Validates every line (all errors at once, prefixed with the line number) — nothing is written on error. */
const assertLines = async (
  tx: QuerySql,
  organizationId: string,
  context: AccessContext,
  job: JobForTasks,
  lines: (CreateTaskLine & { sourceTaskId?: string | undefined })[]
) => {
  const ctx = await lineContext(tx, organizationId, job.leader_id, lines.flatMap((line) => [line.assigneeId, ...(line.qcId ? [line.qcId] : [])]));
  const errors: string[] = [];
  lines.forEach((line, index) => {
    const lineErrors = taskLineErrors(line, ctx);
    if (!line.qcId && line.assigneeId === context.user.id && line.assigneeId !== job.leader_id) {
      lineErrors.push("Tự giao cho mình thì phải chọn QC là người khác.");
    }
    if (line.deadline && Number.isNaN(Date.parse(line.deadline))) {
      lineErrors.push("Deadline không hợp lệ.");
    }
    errors.push(...lineErrors.map((message) => `Dòng ${index + 1}: ${message}`));
  });
  if (errors.length > 0) {
    throw new AppError("TASK_LINES_INVALID", errors.join(" "), 400);
  }
};

/**
 * Inserts tasks for a locked job (Phase 2 "Chia task" and feedback "Giao lại") in one statement (PERF-15).
 * Returns the new ids in line order and the over-allocation warning, if any (allowed, but logged on each
 * new task). Default deadlines: job deadline − QC buffer; feedback redo tasks see feedbackTaskDeadline.
 * A task created already late is flagged late and notified by the next lateness scan (BUG-PR-03).
 */
export const insertTasks = async (
  tx: QuerySql,
  context: AccessContext,
  workflow: Workflow,
  job: JobForTasks,
  lines: (CreateTaskLine & { sourceTaskId?: string | undefined })[],
  options: { kind: TaskKind; feedbackId: string | null; defaultParentId: string | null; assignedAt?: Date }
) => {
  const organizationId = context.organization.id;
  await assertLines(tx, organizationId, context, job, lines);
  const initial = workflow.statuses.find((status) => status.isInitial && status.active);
  if (!initial) {
    throw new AppError("WORKFLOW_INCOMPLETE", "Chưa có trạng thái khởi tạo trong cấu hình.", 409);
  }
  const parentIds = [...new Set(lines.map((line) => line.sourceTaskId ?? options.defaultParentId).filter((id): id is string => Boolean(id)))];
  const parents = new Map<string, { assignedAt: Date; deadline: Date }>();
  if (parentIds.length > 0) {
    const found = await tx<{ id: string; assigned_at: Date; deadline: Date }[]>`
      SELECT id, assigned_at, deadline FROM production.tasks
      WHERE organization_id = ${organizationId} AND job_id = ${job.id} AND id = ANY(${parentIds}::uuid[])
    `;
    if (found.length !== parentIds.length) {
      throw new AppError("SOURCE_TASK_INVALID", "Task gốc không thuộc job này.", 400);
    }
    for (const row of found) {
      parents.set(row.id, { assignedAt: row.assigned_at, deadline: row.deadline });
    }
  }
  let warning: string | null = null;
  if (options.kind === "NORMAL") {
    const assigned = (
      await tx<{ total: number }[]>`
        SELECT coalesce(sum(qty_assigned), 0)::int AS total FROM production.tasks
        WHERE organization_id = ${organizationId} AND job_id = ${job.id} AND kind = 'NORMAL'
      `
    )[0]!.total;
    warning = overAllocationWarning(job.total_images, assigned, lines.reduce((sum, line) => sum + line.qtyAssigned, 0));
  }
  const assignedAt = options.assignedAt ?? new Date();
  const definitions = await loadFieldDefinitions(tx, organizationId, "TASK");
  const rows = lines.map((line) => {
    const parentId = line.sourceTaskId ?? options.defaultParentId;
    const deadline = line.deadline
      ? new Date(line.deadline)
      : options.kind === "NORMAL"
        ? defaultTaskDeadline(job.deadline, job.qc_buffer_hours)
        : feedbackTaskDeadline({
            jobDeadline: job.deadline,
            qcBufferHours: job.qc_buffer_hours,
            now: assignedAt,
            source: parentId ? (parents.get(parentId) ?? null) : null
          });
    return {
      id: randomUUID(),
      assigneeId: line.assigneeId,
      qcId: line.qcId ?? null,
      processId: line.processId,
      shiftId: line.shiftId,
      qtyAssigned: line.qtyAssigned,
      deadline: deadline.toISOString(),
      parentId,
      note: line.note?.trim() || null,
      customValues: validateCustomValues(definitions, line.customValues, { enforceRequired: true }),
      isLate: computeIsLate({ doneAt: null, closed: false, deadline, now: assignedAt }),
      tagIds: line.tagIds ?? []
    };
  });
  await tx`
    INSERT INTO production.tasks (id, organization_id, job_id, assignee_id, qc_id, process_id, shift_id, qty_assigned, deadline,
      status_id, kind, parent_task_id, feedback_id, note, custom_values, created_by, is_late, assigned_at, created_at)
    SELECT (r->>'id')::uuid, ${organizationId}, ${job.id}, (r->>'assigneeId')::uuid, (r->>'qcId')::uuid, (r->>'processId')::uuid,
      (r->>'shiftId')::uuid, (r->>'qtyAssigned')::int, (r->>'deadline')::timestamptz, ${initial.id}, ${options.kind},
      (r->>'parentId')::uuid, ${options.feedbackId}, r->>'note', r->'customValues', ${context.user.id}, (r->>'isLate')::boolean,
      ${assignedAt}, ${assignedAt}
    FROM jsonb_array_elements(${tx.json(
      rows.map((row) => ({
        id: row.id,
        assigneeId: row.assigneeId,
        qcId: row.qcId,
        processId: row.processId,
        shiftId: row.shiftId,
        qtyAssigned: row.qtyAssigned,
        deadline: row.deadline,
        parentId: row.parentId,
        note: row.note,
        customValues: row.customValues,
        isLate: row.isLate
      }))
    )}) WITH ORDINALITY AS x(r, ord)
    ORDER BY x.ord
  `;
  for (const row of rows.filter((item) => item.tagIds.length > 0)) {
    await setEntityTags(tx, organizationId, "TASK", row.id, row.tagIds);
  }
  const ids = rows.map((row) => row.id);
  await insertTaskLogs(
    tx,
    organizationId,
    rows.map((row) => ({
      taskId: row.id,
      jobId: job.id,
      userId: context.user.id,
      action: "CREATE" as const,
      to: { assigneeId: row.assigneeId, qcId: row.qcId, qtyAssigned: row.qtyAssigned, kind: options.kind, ...(warning ? { warning } : {}) },
      ...(options.assignedAt ? { at: options.assignedAt } : {})
    }))
  );
  await enqueueProductionEvents(tx, ids.map((taskId) => taskAssignedEvent(organizationId, taskId, context.user.id)));
  return { ids, warnings: warning ? [warning] : [] };
};

export const createProductionTasks = async (context: AccessContext, jobId: string, lines: CreateTaskLine[]) => {
  assertProductionMember(context);
  const organizationId = context.organization.id;
  const sql = getSql();
  const result = await sql.begin(async (tx) => {
    const job = await loadJobForTasks(tx, organizationId, jobId, true);
    if (!canManageTask({ ...relationOf(context, { assignee_id: "", qc_id: null, job_leader_id: job.leader_id }) })) {
      throw new AppError("FORBIDDEN", "Chỉ Leader của job (hoặc Quản trị) được chia task.", 403);
    }
    const workflow = await loadWorkflowModel(tx, organizationId);
    const created = await insertTasks(tx, context, workflow, job, lines, { kind: "NORMAL", feedbackId: null, defaultParentId: null });
    await settleJob(tx, organizationId, workflow, jobId);
    return created;
  });
  publishProductionChange(organizationId, jobId, result.ids, "tasks", context.user.id);
  await syncJobChat(context, jobId);
  const workflow = await loadWorkflowModel(sql, organizationId);
  const rows = await selectTasks(sql, organizationId, result.ids);
  return { tasks: rows.map((row) => toProductionTask(row, workflow, relationOf(context, row))), warnings: result.warnings };
};

// Changing tasks -------------------------------------------------------------------------------------------

/**
 * Loads a locked task with the caller's relation; hides it (404) from people who may not see it and refuses
 * changes to tasks of an archived job (409 JOB_ARCHIVED, BUG-PR-04).
 */
const lockedTask = async (tx: QuerySql, context: AccessContext, taskId: string) => {
  const organizationId = context.organization.id;
  await lockTaskForUpdate(tx, organizationId, taskId);
  const [task, workflow] = await Promise.all([loadTask(tx, organizationId, taskId), loadWorkflowModel(tx, organizationId)]);
  const relation = relationOf(context, task);
  if (!canViewTask(relation)) {
    throw notFound();
  }
  if (task.job_archived) {
    throw jobArchivedError();
  }
  return { task, workflow, relation };
};

export const transitionProductionTask = async (context: AccessContext, taskId: string, input: TransitionTaskRequest) => {
  assertProductionMember(context);
  const organizationId = context.organization.id;
  const sql = getSql();
  const jobId = await sql.begin(async (tx) => {
    const { task, workflow, relation } = await lockedTask(tx, context, taskId);
    const option = assertTransition(workflow, task.status_id, input.toStatusId, relation, input.note);
    const target = statusById(workflow, input.toStatusId)!;
    const moved = await moveTask(tx, organizationId, workflow, task, target, context.user.id, input.note?.trim() || null, {
      qtyDone: input.qtyDone,
      otHours: input.otHours,
      override: option.override
    });
    await applyFollowUps(tx, organizationId, workflow, moved);
    await settleJob(tx, organizationId, workflow, task.job_id);
    return task.job_id;
  });
  publishProductionChange(organizationId, jobId, [taskId], "tasks", context.user.id);
  return await getProductionTask(context, taskId);
};

/** Leader of the job (or Admin) corrects qty_done after Done; scores are adjusted by the Phase 3 hook. */
export const updateProductionTaskQty = async (context: AccessContext, taskId: string, input: { qtyDone: number; note?: string | undefined }) => {
  assertProductionMember(context);
  const organizationId = context.organization.id;
  const sql = getSql();
  const jobId = await sql.begin(async (tx) => {
    const { task, relation } = await lockedTask(tx, context, taskId);
    if (!canManageTask(relation)) {
      throw new AppError("FORBIDDEN", "Chỉ Leader của job (hoặc Quản trị) được sửa số lượng sau khi Done.", 403);
    }
    if (task.done_at === null || task.qty_done === null) {
      throw new AppError("TASK_NOT_DONE", "Task chưa Done — người làm nhập số lượng khi bấm Done.", 409);
    }
    if (input.qtyDone === task.qty_done) {
      return task.job_id;
    }
    await tx`UPDATE production.tasks SET qty_done = ${input.qtyDone}, updated_at = now() WHERE organization_id = ${organizationId} AND id = ${taskId}`;
    await insertTaskLogs(tx, organizationId, [
      {
        taskId,
        jobId: task.job_id,
        userId: context.user.id,
        action: "QTY",
        from: { qtyDone: task.qty_done },
        to: { qtyDone: input.qtyDone, notifyAssignee: true },
        note: input.note?.trim() || null
      }
    ]);
    await onTaskQtyChanged(tx, { organizationId, taskId, previousQty: task.qty_done, nextQty: input.qtyDone, at: new Date() });
    await enqueueProductionEvents(tx, [taskQtyEvent(organizationId, taskId, context.user.id, task.qty_done, input.qtyDone, input.note?.trim() || null)]);
    return task.job_id;
  });
  publishProductionChange(organizationId, jobId, [taskId], "tasks", context.user.id);
  return await getProductionTask(context, taskId);
};

export const assignProductionTask = async (context: AccessContext, taskId: string, input: In<typeof AssignTaskRequestSchema>) => {
  assertProductionMember(context);
  const organizationId = context.organization.id;
  const sql = getSql();
  const result = await sql.begin(async (tx) => {
    const { task, workflow, relation } = await lockedTask(tx, context, taskId);
    if (!canManageTask(relation)) {
      throw new AppError("FORBIDDEN", "Chỉ Leader của job (hoặc Quản trị) được giao lại task.", 403);
    }
    const assigneeId = input.assigneeId ?? task.assignee_id;
    const qcId = input.qcId === undefined ? task.qc_id : input.qcId;
    if (assigneeId !== task.assignee_id && task.done_at !== null) {
      throw new AppError("TASK_ALREADY_DONE", "Task đã Done, không đổi người làm được.", 409);
    }
    if (qcId !== task.qc_id && task.checked_at !== null) {
      throw new AppError("TASK_ALREADY_CHECKED", "Task đã Checked, không đổi QC được.", 409);
    }
    if (qcId === null && task.status_code === "WAITING_QC") {
      throw new AppError("QC_REQUIRED", "Task đang chờ QC — chỉ có thể đổi sang QC khác.", 409);
    }
    const ctx = await lineContext(tx, organizationId, task.job_leader_id, [assigneeId, ...(qcId ? [qcId] : [])]);
    const errors = taskLineErrors({ assigneeId, qcId, processId: task.process_id, shiftId: task.shift_id, qtyAssigned: task.qty_assigned }, ctx).filter(
      // Catalog rows of an existing task may since have been deactivated; only people are re-validated here.
      (message) => !message.startsWith("Quy trình") && !message.startsWith("Ca làm") && !message.includes("quy trình QC")
    );
    if (errors.length > 0) {
      throw new AppError("ASSIGNMENT_INVALID", errors.join(" "), 400);
    }
    const previous = [task.assignee_id, task.qc_id];
    if (assigneeId === task.assignee_id && qcId === task.qc_id) {
      return { jobId: task.job_id, previous, changed: false };
    }
    await tx`
      UPDATE production.tasks SET assignee_id = ${assigneeId}, qc_id = ${qcId}, updated_at = now()
      WHERE organization_id = ${organizationId} AND id = ${taskId}
    `;
    await insertTaskLogs(tx, organizationId, [
      {
        taskId,
        jobId: task.job_id,
        userId: context.user.id,
        action: "ASSIGN",
        from: { assigneeId: task.assignee_id, qcId: task.qc_id },
        to: { assigneeId, qcId },
        note: input.note?.trim() || null
      }
    ]);
    const events = [];
    if (assigneeId !== task.assignee_id) {
      events.push(taskAssignedEvent(organizationId, taskId, context.user.id));
    }
    if (qcId && qcId !== task.qc_id && task.status_code === "WAITING_QC") {
      events.push(
        taskStatusEvent(organizationId, taskId, context.user.id, {
          toCode: task.status_code,
          toName: task.status_name,
          enteredWaitingQc: true,
          enteredChecked: false,
          qcFail: false,
          note: null
        })
      );
    }
    await enqueueProductionEvents(tx, events);
    await applyFollowUps(tx, organizationId, workflow, { ...task, assignee_id: assigneeId, qc_id: qcId });
    await settleJob(tx, organizationId, workflow, task.job_id);
    return { jobId: task.job_id, previous, changed: true };
  });
  // People taken off the task get the hint too, so their lists drop it; the job chat follows (SEC-API-05).
  publishProductionChange(organizationId, result.jobId, [taskId], "tasks", context.user.id, result.previous);
  if (result.changed) {
    await syncJobChat(context, result.jobId);
  }
  return await getProductionTask(context, taskId);
};

export const updateProductionTask = async (context: AccessContext, taskId: string, input: In<typeof UpdateProductionTaskRequestSchema>) => {
  assertProductionMember(context);
  const organizationId = context.organization.id;
  const sql = getSql();
  const jobId = await sql.begin(async (tx) => {
    const { task, relation } = await lockedTask(tx, context, taskId);
    if (!canManageTask(relation)) {
      throw new AppError("FORBIDDEN", "Chỉ Leader của job (hoặc Quản trị) được sửa task.", 403);
    }
    const structural =
      (input.qtyAssigned !== undefined && input.qtyAssigned !== task.qty_assigned) ||
      (input.processId !== undefined && input.processId !== task.process_id) ||
      (input.shiftId !== undefined && input.shiftId !== task.shift_id);
    if (structural && task.done_at !== null) {
      throw new AppError("TASK_ALREADY_DONE", "Task đã Done — chỉ sửa được số lượng hoàn thành, deadline, ghi chú và trường tuỳ biến.", 409);
    }
    if (input.processId !== undefined && input.processId !== task.process_id) {
      const process = (await tx<{ active: boolean; is_qc: boolean }[]>`SELECT active, is_qc FROM production.processes WHERE organization_id = ${organizationId} AND id = ${input.processId}`)[0];
      if (!process?.active || process.is_qc) {
        throw new AppError("PROCESS_INVALID", "Quy trình không hợp lệ.", 400);
      }
    }
    if (input.shiftId !== undefined && input.shiftId !== task.shift_id) {
      const shift = (await tx<{ active: boolean }[]>`SELECT active FROM production.shifts WHERE organization_id = ${organizationId} AND id = ${input.shiftId}`)[0];
      if (!shift?.active) {
        throw new AppError("SHIFT_INVALID", "Ca làm không hợp lệ.", 400);
      }
    }
    const deadline = input.deadline ? new Date(input.deadline) : task.deadline;
    const customValues =
      input.customValues !== undefined
        ? await resolveCustomValues(tx, organizationId, "TASK", input.customValues, { existing: task.custom_values as never, enforceRequired: false })
        : task.custom_values;
    const note = input.note === undefined ? task.note : input.note?.trim() || null;
    // A deadline moved into the past makes the task late now; the next scan notifies once for that deadline (BUG-PR-03).
    const isLate = computeIsLate({ doneAt: task.done_at, closed: task.closed_at !== null, deadline, now: new Date() });
    await tx`
      UPDATE production.tasks
      SET qty_assigned = ${input.qtyAssigned ?? task.qty_assigned}, process_id = ${input.processId ?? task.process_id},
          shift_id = ${input.shiftId ?? task.shift_id}, deadline = ${deadline}, note = ${note}, is_late = ${isLate},
          custom_values = ${tx.json(customValues as never)}, updated_at = now()
      WHERE organization_id = ${organizationId} AND id = ${taskId}
    `;
    if (input.tagIds) {
      await setEntityTags(tx, organizationId, "TASK", taskId, input.tagIds);
    }
    const from: Record<string, unknown> = {};
    const to: Record<string, unknown> = {};
    const track = (key: string, before: unknown, after: unknown) => {
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        from[key] = before;
        to[key] = after;
      }
    };
    track("qtyAssigned", task.qty_assigned, input.qtyAssigned ?? task.qty_assigned);
    track("processId", task.process_id, input.processId ?? task.process_id);
    track("shiftId", task.shift_id, input.shiftId ?? task.shift_id);
    track("deadline", task.deadline.toISOString(), deadline.toISOString());
    track("customValues", task.custom_values, customValues);
    const logs: LogInput[] = [];
    if (Object.keys(to).length > 0) {
      logs.push({ taskId, jobId: task.job_id, userId: context.user.id, action: "FIELD", from, to });
    }
    if (note !== task.note) {
      logs.push({ taskId, jobId: task.job_id, userId: context.user.id, action: "NOTE", from: { note: task.note }, to: { note } });
    }
    await insertTaskLogs(tx, organizationId, logs);
    return task.job_id;
  });
  publishProductionChange(organizationId, jobId, [taskId], "tasks", context.user.id);
  return await getProductionTask(context, taskId);
};

// Lateness scan (worker) ------------------------------------------------------------------------------------

/**
 * Worker cron (every 15 min, PLAN §9: late = not Done by the deadline). Open tasks of active jobs past their
 * deadline are flagged late; the ones not yet notified for their current deadline are returned (and marked
 * notified) — so a task created or edited when already late is notified too, once per deadline (BUG-PR-03).
 * Tasks closed without Done (BUG-PR-08) and tasks of archived jobs (BUG-PR-04) are not open work.
 */
export const markLateTasks = async (sql: QuerySql = getSql()) => {
  const rows = await sql<{ organization_id: string; job_id: string; id: string; notify: boolean; flagged: boolean }[]>`
    WITH due AS (
      SELECT t.id, NOT t.is_late AS flagged, t.late_notified_deadline IS DISTINCT FROM t.deadline AS notify
      FROM production.tasks t
      JOIN production.jobs j ON j.organization_id = t.organization_id AND j.id = t.job_id AND j.archived_at IS NULL
      WHERE t.done_at IS NULL AND t.closed_at IS NULL AND t.deadline < now()
        AND (NOT t.is_late OR t.late_notified_deadline IS DISTINCT FROM t.deadline)
      ORDER BY t.deadline
      LIMIT 5000
      FOR UPDATE OF t SKIP LOCKED
    )
    UPDATE production.tasks t
    SET is_late = true, late_notified_deadline = t.deadline, updated_at = CASE WHEN due.flagged THEN now() ELSE t.updated_at END
    FROM due WHERE t.id = due.id
    RETURNING t.organization_id, t.job_id, t.id, due.notify, due.flagged
  `;
  const byJob = new Map<string, { organizationId: string; taskIds: string[] }>();
  for (const row of rows.filter((item) => item.flagged)) {
    const entry = byJob.get(row.job_id) ?? { organizationId: row.organization_id, taskIds: [] };
    entry.taskIds.push(row.id);
    byJob.set(row.job_id, entry);
  }
  for (const [jobId, entry] of byJob) {
    publishProductionChange(entry.organizationId, jobId, entry.taskIds, "tasks", null);
  }
  return rows.filter((row) => row.notify);
};

/**
 * Open tasks whose deadline falls within the organization's "due soon" window (settings.due_soon_hours,
 * default 2) and that were not reminded for this deadline yet; they are marked reminded (PERF-15: each
 * reminder is prepared once, not on every scan).
 */
export const markDueSoonTasks = (sql: QuerySql = getSql()) => sql<{ organization_id: string; id: string }[]>`
  WITH due AS (
    SELECT t.id
    FROM production.tasks t
    JOIN production.jobs j ON j.organization_id = t.organization_id AND j.id = t.job_id AND j.archived_at IS NULL
    LEFT JOIN production.settings s ON s.organization_id = t.organization_id AND s.key = 'due_soon_hours'
    WHERE t.done_at IS NULL AND t.closed_at IS NULL AND t.deadline > now()
      AND t.deadline <= now() + make_interval(hours => coalesce((s.value #>> '{}')::int, 2))
      AND t.due_soon_notified_deadline IS DISTINCT FROM t.deadline
    ORDER BY t.deadline
    LIMIT 2000
    FOR UPDATE OF t SKIP LOCKED
  )
  UPDATE production.tasks t SET due_soon_notified_deadline = t.deadline
  FROM due WHERE t.id = due.id
  RETURNING t.organization_id, t.id
`;
