import { randomUUID } from "node:crypto";

import type { z } from "zod";

import type { CustomFieldFilter, CustomValues } from "../../contracts/production-catalog.js";
import type {
  AssignTaskRequestSchema,
  CreateTaskLine,
  DeleteTaskResult,
  MyProductionTasksQuery,
  ProductionTask,
  ProductionTaskPage,
  QcQueueQuery,
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
import {
  anyTagSql,
  customFieldFilterSql,
  loadFieldDefinitions,
  resolveCustomFieldFilters,
  resolveCustomValues,
  setEntityTags,
  taskLineCustomValues
} from "./custom-fields.js";
import { syncJobChat } from "./job-chat.service.js";
import {
  assertJobVisible,
  assertTaskVisible,
  isSubtaskRow,
  jobArchivedError,
  lineFinishedSql,
  loadMemberRoles,
  loadTask,
  loadTaskExtras,
  loadWorkflowModel,
  notSubtaskSql,
  relationOf,
  selectTasks,
  subtaskJsonCode,
  taskRowCode,
  taskSelectSql,
  toProductionTask,
  toProductionTasks,
  type TaskRow
} from "./jobs.repo.js";
import { enqueueProductionEvents, taskAssignedEvent, taskQtyEvent, taskQtyFilledEvent, taskStatusEvent } from "./notifications.js";
import { publishProductionChange } from "./realtime.js";
import {
  assertLinesCreatable,
  doneQtyEditAllowed,
  forbidden,
  lineAllowed,
  qtyAssignedEditAllowed,
  qtyFillAllowed,
  subtaskDeleteAllowed,
  subtaskManageAllowed
} from "./job-permissions.js";
import { onTaskDeleted, onTaskQtyChanged, onTaskStatusEntered } from "./scoring-hooks.js";
import {
  assertDeclaredDoneQty,
  assertTransition,
  computeIsLate,
  deriveJobStatus,
  feedbackTaskDeadline,
  isLineFinished,
  isQcFail,
  lineFinishStatusIds,
  overAllocationWarning,
  qcStageCodes,
  statusByCode,
  statusById,
  subtaskProcessProblem,
  subtaskQtyProblem,
  systemFollowUp,
  taskLineErrors,
  taskQtyRequiredError,
  tasksMissingDoneQty,
  type TaskLineRules,
  type Workflow,
  type WorkflowStatus
} from "./workflow.js";

export { publishProductionChange };

type In<T extends z.ZodTypeAny> = z.infer<T>;
const notFound = () => new AppError("TASK_NOT_FOUND", "Không tìm thấy task.", 404);

// Locking & logging -------------------------------------------------------------------------------------

/** Locks the job first, then the task (same order everywhere, so concurrent changes never deadlock). */
export const lockTaskForUpdate = async (tx: QuerySql, organizationId: string, taskId: string) => {
  const row = (
    await tx<{ job_id: string }[]>`SELECT job_id FROM production.tasks WHERE organization_id = ${organizationId} AND id = ${taskId} AND deleted_at IS NULL`
  )[0];
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
  action: "CREATE" | "STATUS" | "QTY" | "ASSIGN" | "NOTE" | "FIELD" | "DELETE" | "SUBTASK" | "QTY_REQUEST";
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

type MoveExtras = {
  qtyDone?: number | undefined;
  otHours?: number | undefined;
  override?: boolean;
  at?: Date;
  /** PD-044: the Done quantity of each subtask moving with its line (default: its qty_assigned). */
  subtaskQtyDone?: readonly { taskId: string; qtyDone: number }[] | undefined;
};

/**
 * PD-044: the live subtasks of the given lines that are not in `tasks` already, locked (callers hold the job lock, so
 * nothing changes them in between). Rows that cannot have subtasks (feedback redo tasks, subtasks) need no query.
 */
const lockSubtasksOf = async (tx: QuerySql, organizationId: string, tasks: readonly TaskRow[]) => {
  const lineIds = tasks.filter((task) => task.kind === "NORMAL" && task.parent_task_id === null).map((task) => task.id);
  if (lineIds.length === 0) {
    return [];
  }
  const known = new Set(tasks.map((task) => task.id));
  const ids = (
    await tx<{ id: string }[]>`
      SELECT id FROM production.tasks
      WHERE organization_id = ${organizationId} AND parent_task_id = ANY(${lineIds}::uuid[]) AND kind = 'NORMAL' AND deleted_at IS NULL
      ORDER BY created_at, number
      FOR UPDATE
    `
  )
    .map((row) => row.id)
    .filter((id) => !known.has(id));
  return await selectTasks(tx, organizationId, ids);
};

/**
 * Applies the same status change to locked tasks (one task, or a job-level bulk move): Done/Checked timestamps
 * and quantity, closed_at, lateness, QC-fail counter, history rows and the scoring hook. One UPDATE and one
 * history INSERT for all of them (PERF-15); the scoring hook still runs per task when the target status
 * records scores. Callers validate permissions first; the result keeps the input order.
 *
 * PD-045 closing (closed_at, per row): a line becomes finished work when it enters "Đã check" or later, a Checking line
 * when it enters Done (`isLineFinished`); moving back into the pipeline reopens it. A closed or Done line is never
 * flagged late or reminded (computeIsLate, markLateTasks / markDueSoonTasks).
 *
 * PD-044: the live subtasks of every line move with it in the same call (same status, timestamps, closing and lateness;
 * each records its own score entry at the first Done, with its Done quantity from `subtaskQtyDone`); they raise no
 * notification and never count as a QC fail (the line does). Back into Done before QC checked the line, the worker may
 * give a new Done quantity (the scoring hook adjusts the ledger). Only the input rows are returned.
 *
 * PD-058: entering Done, every moving task without a quantity (the line and / or its subtasks) needs its number ≥ 1 in the
 * same call (`qtyDone` / `subtaskQtyDone`); it becomes both its qty_assigned and its qty_done (uncapped: there is nothing to
 * compare with), and the job's Leader is told (production.task.qty_filled, one per task). Otherwise nothing is written:
 * 400 TASK_QTY_REQUIRED with `details.taskIds` (every such task, the line first).
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
  // Becoming finished work closes the task (BUG-PR-08, PD-045); moving back into the pipeline reopens it.
  const finish = lineFinishStatusIds(workflow);
  const subtaskQty = new Map((extras.subtaskQtyDone ?? []).map((entry) => [entry.taskId, entry.qtyDone]));
  const planMove = (task: TaskRow) => {
    const from = statusById(workflow, task.status_id);
    if (!from) {
      throw new AppError("WORKFLOW_INCOMPLETE", "Trạng thái hiện tại của task không còn tồn tại.", 409);
    }
    const subtask = isSubtaskRow(task);
    if (to.code === "WAITING_QC" && !task.qc_id && !subtask) {
      throw new AppError("QC_REQUIRED", "Cần gán QC trước khi chuyển sang chờ QC.", 400);
    }
    const firstDone = to.countsDone && task.done_at === null;
    // The worker's Done quantity: the line's from the request, each subtask's from `subtaskQtyDone` (PD-044).
    const declared = subtask ? subtaskQty.get(task.id) : extras.qtyDone;
    // PD-058: entering Done without a quantity — the number given (≥ 1) becomes both quantities; none: missingQty.
    const fill = to.countsDone && task.qty_assigned === null;
    const missingQty = fill && tasksMissingDoneQty([{ id: task.id, qtyAssigned: task.qty_assigned, declared }]).length > 0;
    let qtyAssigned = task.qty_assigned;
    let qtyDone = task.qty_done;
    let otHours = task.ot_hours === null ? null : Number(task.ot_hours);
    let qtyChanged = false;
    if (firstDone && extras.otHours !== undefined && !subtask) {
      // PD-035: "Giờ OT" is optional, also on the OT shift; sent at Done it replaces the line's own value.
      otHours = extras.otHours;
    }
    if (fill) {
      if (!missingQty) {
        qtyAssigned = declared!;
        qtyDone = declared!;
        qtyChanged = !firstDone;
      }
    } else if (firstDone) {
      qtyDone = declared ?? task.qty_assigned;
      // SEC2-03: the declared quantity feeds points / Khoán money in the append-only ledger.
      assertDeclaredDoneQty(task.qty_assigned!, qtyDone!);
    } else if (declared !== undefined && declared !== task.qty_done) {
      if (!to.countsDone) {
        throw new AppError("QTY_LOCKED", "Số lượng hoàn thành chỉ nhập khi chuyển sang Done.", 400);
      }
      if (task.checked_at !== null) {
        throw new AppError("QTY_LOCKED", "Task đã được QC check — số lượng đã chốt; nhờ Leader sửa nếu cần.", 400);
      }
      // PD-044: back into Done (e.g. after "Cần sửa lại") the worker may give a new quantity until QC checked the line.
      if (task.qty_assigned !== null) {
        assertDeclaredDoneQty(task.qty_assigned, declared);
      }
      qtyDone = declared;
      qtyChanged = true;
    }
    const qcFail = !subtask && isQcFail(from, to, extras.override === true);
    const doneAt = task.done_at ?? (to.countsDone ? now : null);
    const checkedAt = task.checked_at ?? (to.countsChecked ? now : null);
    const closing = isLineFinished(workflow, { statusId: to.id, isChecking: task.process_is_qc, doneAt }, finish);
    const closedAt = closing ? (task.closed_at ?? now) : null;
    const isLate = computeIsLate({ doneAt, closed: closedAt !== null, deadline: task.deadline, now });
    return {
      task,
      subtask,
      from,
      firstDone,
      fill,
      missingQty,
      qtyChanged,
      qtyAssigned,
      qtyDone,
      otHours,
      qcFail,
      doneAt,
      checkedAt,
      closing,
      closedAt,
      isLate
    };
  };
  // The input rows are checked before anything is read or written (SEC2-03); then their subtasks join (PD-044).
  const inputPlans = tasks.map(planMove);
  const cascaded = await lockSubtasksOf(tx, organizationId, tasks);
  const movingSubtasks = new Set([...tasks, ...cascaded].filter(isSubtaskRow).map((task) => task.id));
  if ([...subtaskQty.keys()].some((id) => !movingSubtasks.has(id))) {
    throw new AppError("SUBTASK_INVALID", "Số lượng Done gửi kèm không thuộc subtask của task này.", 400);
  }
  const planned = [...inputPlans, ...cascaded.map(planMove)];
  // PD-058: every task still without a quantity, named at once (the FE asks for all of them in one dialog).
  const missing = planned.filter((plan) => plan.missingQty).map((plan) => plan.task.id);
  if (missing.length > 0) {
    throw taskQtyRequiredError(missing);
  }

  // Existing timestamps are kept by the database (coalesce) so their microseconds survive.
  await tx`
    UPDATE production.tasks AS t
    SET status_id = ${to.id},
        qty_assigned = CASE WHEN (m->>'fillQty')::boolean THEN (m->>'qtyAssigned')::int ELSE t.qty_assigned END,
        qty_done = CASE WHEN (m->>'setQty')::boolean THEN (m->>'qtyDone')::int ELSE t.qty_done END,
        ot_hours = CASE WHEN (m->>'firstDone')::boolean THEN (m->>'otHours')::numeric ELSE t.ot_hours END,
        done_at = coalesce(t.done_at, (m->>'doneAt')::timestamptz),
        checked_at = coalesce(t.checked_at, (m->>'checkedAt')::timestamptz),
        closed_at = CASE WHEN (m->>'closing')::boolean THEN coalesce(t.closed_at, (m->>'closedAt')::timestamptz) ELSE NULL END,
        is_late = (m->>'isLate')::boolean,
        qc_fail_count = t.qc_fail_count + (m->>'qcFail')::int,
        updated_at = now()
    FROM jsonb_array_elements(${tx.json(
      planned.map((plan) => ({
        id: plan.task.id,
        firstDone: plan.firstDone,
        setQty: plan.firstDone || plan.qtyChanged || plan.fill,
        fillQty: plan.fill,
        qtyAssigned: plan.qtyAssigned,
        qtyDone: plan.qtyDone,
        otHours: plan.otHours,
        doneAt: plan.doneAt?.toISOString() ?? null,
        checkedAt: plan.checkedAt?.toISOString() ?? null,
        closing: plan.closing,
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
      from: {
        ...statusLogValue(plan.from),
        ...(plan.qtyChanged ? { qtyDone: plan.task.qty_done } : {}),
        // PD-058: "Số lượng: — → 120" filled in at Done.
        ...(plan.fill ? { qtyAssigned: null } : {})
      },
      to: {
        ...statusLogValue(to),
        ...(plan.firstDone ? { qtyDone: plan.qtyDone, ...(plan.otHours !== null ? { otHours: plan.otHours } : {}) } : {}),
        ...(plan.qtyChanged ? { qtyDone: plan.qtyDone } : {}),
        ...(plan.fill ? { qtyAssigned: plan.qtyAssigned } : {}),
        ...(plan.qcFail ? { qcFail: true } : {}),
        ...(extras.override ? { override: true } : {})
      },
      note,
      at: now
    }))
  );
  // Subtasks raise no status notification: their line's covers them (PD-044). A quantity filled in at Done is told for
  // every task, subtasks included (PD-058).
  const events = planned.flatMap((plan) => {
    const filled = plan.fill && plan.qtyAssigned !== null ? [taskQtyFilledEvent(organizationId, plan.task.id, actorId, plan.qtyAssigned, true)] : [];
    if (plan.subtask) {
      return filled;
    }
    const enteredWaitingQc = to.code === "WAITING_QC";
    const enteredChecked = to.countsChecked && plan.task.checked_at === null;
    return enteredWaitingQc || enteredChecked || plan.qcFail
      ? [
          taskStatusEvent(organizationId, plan.task.id, actorId, { toCode: to.code, toName: to.name, enteredWaitingQc, enteredChecked, qcFail: plan.qcFail, note }),
          ...filled
        ]
      : filled;
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
  return planned.slice(0, tasks.length).map((plan) => ({
    ...plan.task,
    status_id: to.id,
    status_code: to.code,
    status_name: to.name,
    qty_assigned: plan.qtyAssigned,
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
      SELECT id FROM production.tasks WHERE organization_id = ${organizationId} AND job_id = ${jobId} AND deleted_at IS NULL
        AND (status_id = ${statusByCode(workflow, "FEEDBACK").id}
          OR (feedback_id IS NOT NULL AND status_id = ANY(${checked}::uuid[])))
      ORDER BY created_at FOR UPDATE
    `
  ).map((row) => row.id);
  await moveTasks(tx, organizationId, workflow, await selectTasks(tx, organizationId, ids), complete, actorId, note);
  return ids;
};

/**
 * "Tổng tấm" of a job that was not typed (total_images_manual = false, PD-035): the sum of its NORMAL work lines
 * (feedback redo lines are extra work, and Checking lines check the same images, PD-037). Call after lines are
 * added, changed or removed.
 */
export const syncJobTotalImages = async (tx: QuerySql, organizationId: string, jobId: string) => {
  await tx`
    UPDATE production.jobs j SET total_images = s.total, updated_at = now()
    FROM (
      SELECT coalesce(sum(t.qty_assigned), 0)::int AS total FROM production.tasks t
      JOIN production.processes p ON p.organization_id = t.organization_id AND p.id = t.process_id
      WHERE t.organization_id = ${organizationId} AND t.job_id = ${jobId} AND t.kind = 'NORMAL' AND t.deleted_at IS NULL AND NOT p.is_qc
    ) s
    WHERE j.organization_id = ${organizationId} AND j.id = ${jobId} AND NOT j.total_images_manual AND j.total_images <> s.total
  `;
};

/**
 * After task changes in a job: resolve feedback whose re-done tasks are all checked (source tasks and FB
 * tasks return to Complete), then store the job status derived from its tasks and its automatic Tổng tấm.
 */
export const settleJob = async (tx: QuerySql, organizationId: string, workflow: Workflow, jobId: string) => {
  await syncJobTotalImages(tx, organizationId, jobId);
  const ready = await tx<{ id: string }[]>`
    SELECT f.id FROM production.feedbacks f
    WHERE f.organization_id = ${organizationId} AND f.job_id = ${jobId} AND f.status <> 'RESOLVED'
      AND EXISTS (SELECT 1 FROM production.tasks t WHERE t.organization_id = f.organization_id AND t.feedback_id = f.id AND t.deleted_at IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM production.tasks t
        WHERE t.organization_id = f.organization_id AND t.feedback_id = f.id AND t.checked_at IS NULL AND t.deleted_at IS NULL
      )
  `;
  if (ready.length > 0) {
    await tx`
      UPDATE production.feedbacks SET status = 'RESOLVED', resolution = 'REWORKED', resolved_at = now()
      WHERE organization_id = ${organizationId} AND id = ANY(${ready.map((row) => row.id)}::uuid[])
    `;
    await releaseParkedTasks(tx, organizationId, workflow, jobId, null, "Feedback đã xử lý xong — trở về Complete.");
  }
  const [statusRows, open] = await Promise.all([
    tx<{ status_id: string }[]>`
      SELECT DISTINCT status_id FROM production.tasks WHERE organization_id = ${organizationId} AND job_id = ${jobId} AND deleted_at IS NULL
    `,
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
  const scopes = await assertTaskVisible(sql, context, task);
  const extras = await loadTaskExtras(sql, context.organization.id, context.user.id, [task]);
  return toProductionTask(task, workflow, relationOf(context, task), { scopes, userId: context.user.id }, extras.get(task.id));
};

/**
 * TASK tag (any of them) and custom-field filters of the personal lists. Returns a builder: a postgres.js fragment
 * must never be returned from an async function (awaiting it would run it as a query).
 */
const taskListFilters = async (sql: QuerySql, organizationId: string, query: { tagId?: string[] | undefined; cf?: CustomFieldFilter[] | undefined }) => {
  const plans = await resolveCustomFieldFilters(sql, organizationId, "TASK", query.cf);
  return () => sql`
    ${query.tagId?.length ? sql`AND ${anyTagSql(sql, "TASK", "t.id", "t.organization_id", query.tagId)}` : sql``}
    ${plans.length > 0 ? sql`AND ${customFieldFilterSql(sql, "t.custom_values", plans)}` : sql``}
  `;
};

/**
 * Personal board: tasks I work on and/or check, soonest deadline first (full-precision keyset, BUG-PR-05). Subtasks are
 * listed inside their line (`subtasks`), not as cards of their own (PD-044). Without `includeFinished`, finished lines
 * are left out (PD-045: "Đã check" or later; a Checking line once Done — lineFinishedSql).
 */
export const listMyProductionTasks = async (context: AccessContext, query: MyProductionTasksQuery): Promise<ProductionTaskPage> => {
  assertProductionMember(context);
  const sql = getSql();
  const organizationId = context.organization.id;
  const cursor = decodeTimeCursor(query.cursor);
  const workflow = await loadWorkflowModel(sql, organizationId);
  const me = context.user.id;
  const filters = await taskListFilters(sql, organizationId, query);
  const rows = await sql<TaskRow[]>`
    ${taskSelectSql(sql)}
    WHERE t.organization_id = ${organizationId}
      AND ${query.role === "assignee" ? sql`t.assignee_id = ${me}` : query.role === "qc" ? sql`t.qc_id = ${me}` : sql`(t.assignee_id = ${me} OR t.qc_id = ${me})`}
      ${query.includeFinished ? sql`` : sql`AND NOT ${lineFinishedSql(sql, lineFinishStatusIds(workflow), "pr")}`}
      AND j.archived_at IS NULL AND ${notSubtaskSql(sql)}
      ${filters()}
      ${cursor ? sql`AND (t.deadline, t.id) > (${cursorInstantSql(sql, cursor.at)}, ${cursor.id}::uuid)` : sql``}
    ORDER BY t.deadline, t.id
    LIMIT ${query.limit + 1}
  `;
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    items: await toProductionTasks(sql, context, workflow, page),
    pageInfo: { hasMore: rows.length > query.limit, nextCursor: rows.length > query.limit && last ? encodeTimeCursor(last.deadline_cursor, last.id) : null }
  };
};

/**
 * QC queue: lines waiting for my check or that I am checking ("Chờ QC", "Đang check" — PD-044), oldest Done first
 * (archived jobs left out, BUG-PR-04). Subtasks come with their line.
 */
export const listQcQueue = async (context: AccessContext, query: QcQueueQuery = { cf: [] }) => {
  assertProductionMember(context);
  const sql = getSql();
  const workflow = await loadWorkflowModel(sql, context.organization.id);
  const waiting = workflow.statuses.filter((status) => qcStageCodes.has(status.code)).map((status) => status.id);
  const filters = await taskListFilters(sql, context.organization.id, query);
  const rows = await sql<TaskRow[]>`
    ${taskSelectSql(sql)}
    WHERE t.organization_id = ${context.organization.id} AND t.qc_id = ${context.user.id}
      AND t.status_id = ANY(${waiting}::uuid[]) AND j.archived_at IS NULL AND ${notSubtaskSql(sql)}
      ${filters()}
    ORDER BY t.done_at NULLS LAST, t.id
    LIMIT 500
  `;
  return { items: await toProductionTasks(sql, context, workflow, rows), pageInfo: { hasMore: false, nextCursor: null } };
};

// Creating tasks -------------------------------------------------------------------------------------------

type JobForTasks = {
  id: string;
  leader_id: string | null;
  received_at: Date;
  deadline: Date;
  total_images: number;
  total_images_manual: boolean;
  qc_buffer_hours: number;
};

export const loadJobForTasks = async (tx: QuerySql, organizationId: string, jobId: string, lock: boolean) => {
  const job = (
    await tx<(JobForTasks & { archived_at: Date | null })[]>`
      SELECT j.id, j.leader_id, j.received_at, j.deadline, j.total_images, j.total_images_manual, p.qc_buffer_hours, j.archived_at
      FROM production.jobs j JOIN production.projects p ON p.organization_id = j.organization_id AND p.id = j.project_id
      WHERE j.organization_id = ${organizationId} AND j.id = ${jobId} AND j.deleted_at IS NULL
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

const lineContext = async (tx: QuerySql, organizationId: string, userIds: string[]) => {
  const [memberRoles, processes, shifts] = await Promise.all([
    loadMemberRoles(tx, organizationId, userIds),
    tx<{ id: string; active: boolean; is_qc: boolean; name: string }[]>`SELECT id, active, is_qc, name FROM production.processes WHERE organization_id = ${organizationId}`,
    tx<{ id: string; active: boolean }[]>`SELECT id, active FROM production.shifts WHERE organization_id = ${organizationId}`
  ]);
  return {
    memberRoles,
    processes: new Map(processes.map((row) => [row.id, { active: row.active, isQc: row.is_qc, name: row.name }])),
    shifts: new Map(shifts.map((row) => [row.id, { active: row.active }]))
  };
};

/**
 * Validates every line (all errors at once, prefixed "Task N: …") — nothing is written on error. `rules.requireQc`:
 * a work line without QC is refused (PD-047).
 */
const assertLines = async (
  tx: QuerySql,
  organizationId: string,
  lines: (CreateTaskLine & { sourceTaskId?: string | undefined })[],
  rules: TaskLineRules
) => {
  const ctx = await lineContext(tx, organizationId, lines.flatMap((line) => [line.assigneeId, ...(line.qcId ? [line.qcId] : [])]));
  const errors: string[] = [];
  lines.forEach((line, index) => {
    const lineErrors = taskLineErrors(line, ctx, rules);
    if (line.deadline && Number.isNaN(Date.parse(line.deadline))) {
      lineErrors.push("Ngày giao không hợp lệ.");
    }
    if (line.assignedAt && line.deadline && Date.parse(line.deadline) < Date.parse(line.assignedAt)) {
      lineErrors.push("Ngày giao phải từ Ngày nhận trở đi.");
    }
    errors.push(...lineErrors.map((message) => `Task ${index + 1}: ${message}`));
  });
  if (errors.length > 0) {
    throw new AppError("TASK_LINES_INVALID", errors.join(" "), 400);
  }
};

/**
 * Inserts tasks for a locked job (Phase 2 "Chia task" and feedback "Giao lại") in one statement (PERF-15). PD-058: a
 * line's quantity is optional (null = "chưa có số lượng"; Checking lines too).
 * Returns the new ids in line order and the over-allocation warning, if any (allowed, but logged on each
 * new task). Default deadlines: job deadline − QC buffer; feedback redo tasks see feedbackTaskDeadline.
 * A task created already late is flagged late and notified by the next lateness scan (BUG-PR-03).
 *
 * PD-047: every NORMAL work line (not a Checking line) must name a QC ("Task N: Chọn QC cho task.", 400
 * TASK_LINES_INVALID). `historicQcOptional` lifts that rule for the work-log importers only (BE/scripts), which replay
 * history recorded without QC; API paths never set it.
 */
export const insertTasks = async (
  tx: QuerySql,
  context: AccessContext,
  workflow: Workflow,
  job: JobForTasks,
  lines: (CreateTaskLine & { sourceTaskId?: string | undefined })[],
  options: { kind: TaskKind; feedbackId: string | null; defaultParentId: string | null; assignedAt?: Date; historicQcOptional?: boolean }
) => {
  const organizationId = context.organization.id;
  await assertLines(tx, organizationId, lines, { requireQc: options.kind === "NORMAL" && options.historicQcOptional !== true });
  const initial = workflow.statuses.find((status) => status.isInitial && status.active);
  if (!initial) {
    throw new AppError("WORKFLOW_INCOMPLETE", "Chưa có trạng thái khởi tạo trong cấu hình.", 409);
  }
  const parentIds = [...new Set(lines.map((line) => line.sourceTaskId ?? options.defaultParentId).filter((id): id is string => Boolean(id)))];
  const parents = new Map<string, { assignedAt: Date; deadline: Date; customValues: CustomValues; tagIds: string[] }>();
  if (parentIds.length > 0) {
    const found = await tx<{ id: string; assigned_at: Date; deadline: Date; custom_values: CustomValues; tag_ids: string[] | null }[]>`
      SELECT t.id, t.assigned_at, t.deadline, t.custom_values,
        (SELECT array_agg(et.tag_id ORDER BY et.created_at) FROM production.entity_tags et
          WHERE et.organization_id = t.organization_id AND et.entity = 'TASK' AND et.entity_id = t.id) AS tag_ids
      FROM production.tasks t
      WHERE t.organization_id = ${organizationId} AND t.job_id = ${job.id} AND t.id = ANY(${parentIds}::uuid[])
    `;
    if (found.length !== parentIds.length) {
      throw new AppError("SOURCE_TASK_INVALID", "Task gốc không thuộc job này.", 400);
    }
    for (const row of found) {
      parents.set(row.id, { assignedAt: row.assigned_at, deadline: row.deadline, customValues: row.custom_values ?? {}, tagIds: row.tag_ids ?? [] });
    }
  }
  // Custom fields and tags of every line, all errors at once ("Task N: …"), before anything is written. A feedback
  // redo task ("Giao lại") inherits its source task's values and tags unless the line sends its own.
  const definitions = await loadFieldDefinitions(tx, organizationId, "TASK");
  const lineErrors: string[] = [];
  const lineValues = lines.map((line, index) => {
    const parentId = line.sourceTaskId ?? options.defaultParentId;
    const parent = options.kind === "NORMAL" || !parentId ? null : (parents.get(parentId) ?? null);
    try {
      return { customValues: taskLineCustomValues(definitions, line.customValues, parent?.customValues ?? null), tagIds: [...new Set(line.tagIds ?? parent?.tagIds ?? [])] };
    } catch (error) {
      lineErrors.push(`Task ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      return { customValues: {}, tagIds: [] };
    }
  });
  if (lineErrors.length > 0) {
    throw new AppError("CUSTOM_FIELDS_INVALID", lineErrors.join(" "), 400);
  }
  const lineTagIds = [...new Set(lineValues.flatMap((value) => value.tagIds))];
  if (lineTagIds.length > 0) {
    const known = new Set(
      (await tx<{ id: string }[]>`SELECT id FROM production.tags WHERE organization_id = ${organizationId} AND id = ANY(${lineTagIds}::uuid[])`).map((row) => row.id)
    );
    const missing = lineValues.flatMap((value, index) => (value.tagIds.some((tagId) => !known.has(tagId)) ? [`Task ${index + 1}: tag không tồn tại.`] : []));
    if (missing.length > 0) {
      throw new AppError("TAG_NOT_FOUND", missing.join(" "), 400);
    }
  }
  let warning: string | null = null;
  // PD-058: lines without a quantity add nothing (known numbers only).
  const adding = lines.reduce((sum, line) => sum + (line.qtyAssigned ?? 0), 0);
  // An automatic Tổng tấm (PD-035) follows the lines, so only a typed one can be exceeded.
  if (options.kind === "NORMAL" && job.total_images_manual && adding > 0) {
    const assigned = (
      await tx<{ total: number }[]>`
        SELECT coalesce(sum(qty_assigned), 0)::int AS total FROM production.tasks
        WHERE organization_id = ${organizationId} AND job_id = ${job.id} AND kind = 'NORMAL' AND deleted_at IS NULL
      `
    )[0]!.total;
    warning = overAllocationWarning(job.total_images, assigned, adding);
  }
  // Creation time (history, created_at); `options.assignedAt` replays a past event. "Ngày nhận" of a normal line
  // defaults to the job's, its "Ngày giao" to the job deadline (PD-035); a feedback redo line is received now.
  const createdAt = options.assignedAt ?? new Date();
  const rows = lines.map((line, index) => {
    const parentId = line.sourceTaskId ?? options.defaultParentId;
    const assignedAt = line.assignedAt
      ? new Date(line.assignedAt)
      : (options.assignedAt ?? (options.kind === "NORMAL" ? job.received_at : createdAt));
    const deadline = line.deadline
      ? new Date(line.deadline)
      : options.kind === "NORMAL"
        ? job.deadline
        : feedbackTaskDeadline({
            jobDeadline: job.deadline,
            qcBufferHours: job.qc_buffer_hours,
            now: createdAt,
            source: parentId ? (parents.get(parentId) ?? null) : null
          });
    return {
      id: randomUUID(),
      assigneeId: line.assigneeId,
      qcId: line.qcId ?? null,
      processId: line.processId,
      shiftId: line.shiftId,
      // PD-058: null = "chưa có số lượng" (filled in by the worker, at Done at the latest).
      qtyAssigned: line.qtyAssigned ?? null,
      assignedAt: assignedAt.toISOString(),
      deadline: deadline.toISOString(),
      errorQty: line.errorQty ?? null,
      otHours: line.otHours ?? null,
      parentId,
      note: line.note?.trim() || null,
      // "Link chia việc" (PD-040): any text (web link or folder path); empty = none.
      workLink: line.workLink?.trim() || null,
      customValues: lineValues[index]!.customValues,
      isLate: computeIsLate({ doneAt: null, closed: false, deadline, now: createdAt }),
      tagIds: lineValues[index]!.tagIds
    };
  });
  await tx`
    INSERT INTO production.tasks (id, organization_id, job_id, assignee_id, qc_id, process_id, shift_id, qty_assigned, deadline,
      error_qty, ot_hours, status_id, kind, parent_task_id, feedback_id, note, work_link, custom_values, created_by, is_late, assigned_at, created_at)
    SELECT (r->>'id')::uuid, ${organizationId}, ${job.id}, (r->>'assigneeId')::uuid, (r->>'qcId')::uuid, (r->>'processId')::uuid,
      (r->>'shiftId')::uuid, (r->>'qtyAssigned')::int, (r->>'deadline')::timestamptz, (r->>'errorQty')::int, (r->>'otHours')::numeric,
      ${initial.id}, ${options.kind}, (r->>'parentId')::uuid, ${options.feedbackId}, r->>'note', r->>'workLink', r->'customValues', ${context.user.id},
      (r->>'isLate')::boolean, (r->>'assignedAt')::timestamptz, ${createdAt}
    FROM jsonb_array_elements(${tx.json(
      rows.map((row) => ({
        id: row.id,
        assigneeId: row.assigneeId,
        qcId: row.qcId,
        processId: row.processId,
        shiftId: row.shiftId,
        qtyAssigned: row.qtyAssigned,
        assignedAt: row.assignedAt,
        deadline: row.deadline,
        errorQty: row.errorQty,
        otHours: row.otHours,
        parentId: row.parentId,
        note: row.note,
        workLink: row.workLink,
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
    // PD-036 "create": lines for anyone ("all") or only for myself ("own"), on a job I may see.
    const scopes = await assertJobVisible(tx, context, jobId);
    assertLinesCreatable(scopes, lines.map((line) => line.assigneeId), context.user.id);
    const workflow = await loadWorkflowModel(tx, organizationId);
    const created = await insertTasks(tx, context, workflow, job, lines, { kind: "NORMAL", feedbackId: null, defaultParentId: null });
    await settleJob(tx, organizationId, workflow, jobId);
    return created;
  });
  publishProductionChange(organizationId, jobId, result.ids, "tasks", context.user.id);
  await syncJobChat(context, jobId);
  const workflow = await loadWorkflowModel(sql, organizationId);
  const rows = await selectTasks(sql, organizationId, result.ids);
  return { tasks: await toProductionTasks(sql, context, workflow, rows), warnings: result.warnings };
};

// Changing tasks -------------------------------------------------------------------------------------------

/**
 * Loads a locked task with the caller's relation; hides it (404) from people who may not see it and refuses
 * changes to tasks of an archived job (409 JOB_ARCHIVED, BUG-PR-04).
 */
export const lockedTask = async (tx: QuerySql, context: AccessContext, taskId: string) => {
  const organizationId = context.organization.id;
  await lockTaskForUpdate(tx, organizationId, taskId);
  const [task, workflow] = await Promise.all([loadTask(tx, organizationId, taskId), loadWorkflowModel(tx, organizationId)]);
  const scopes = await assertTaskVisible(tx, context, task);
  if (task.job_archived) {
    throw jobArchivedError();
  }
  return { task, workflow, relation: relationOf(context, task), scopes, mine: task.assignee_id === context.user.id };
};

/** The number of a subtask's line (for messages such as "Subtask đi theo trạng thái của task #N."). */
export const parentNumberOf = async (tx: QuerySql, organizationId: string, task: Pick<TaskRow, "parent_task_id">) =>
  task.parent_task_id
    ? Number(
        (await tx<{ number: string }[]>`SELECT number FROM production.tasks WHERE organization_id = ${organizationId} AND id = ${task.parent_task_id}`)[0]
          ?.number ?? 0
      )
    : 0;

export const transitionProductionTask = async (context: AccessContext, taskId: string, input: TransitionTaskRequest) => {
  assertProductionMember(context);
  const organizationId = context.organization.id;
  const sql = getSql();
  const jobId = await sql.begin(async (tx) => {
    const { task, workflow, relation } = await lockedTask(tx, context, taskId);
    if (isSubtaskRow(task)) {
      throw new AppError("SUBTASK_FOLLOWS_PARENT", `Subtask đi theo trạng thái của task #${await parentNumberOf(tx, organizationId, task)}.`, 409);
    }
    const option = assertTransition(workflow, task.status_id, input.toStatusId, relation, input.note);
    const target = statusById(workflow, input.toStatusId)!;
    const moved = await moveTask(tx, organizationId, workflow, task, target, context.user.id, input.note?.trim() || null, {
      qtyDone: input.qtyDone,
      otHours: input.otHours,
      override: option.override,
      subtaskQtyDone: input.subtaskQtyDone
    });
    await applyFollowUps(tx, organizationId, workflow, moved);
    await settleJob(tx, organizationId, workflow, task.job_id);
    return task.job_id;
  });
  publishProductionChange(organizationId, jobId, [taskId], "tasks", context.user.id);
  return await getProductionTask(context, taskId);
};

/**
 * Corrects qty_done after Done; scores are adjusted by the Phase 3 hook. "update: all" at any time (trusted, not capped,
 * the worker is notified); PD-044: also the line's worker until QC checked it ("Đã check"), capped like at Done. A subtask
 * has its own Done quantity. The worker is notified only when someone else changed it (the actor never is).
 */
export const updateProductionTaskQty = async (context: AccessContext, taskId: string, input: { qtyDone: number; note?: string | undefined }) => {
  assertProductionMember(context);
  const organizationId = context.organization.id;
  const sql = getSql();
  const jobId = await sql.begin(async (tx) => {
    const { task, scopes, mine } = await lockedTask(tx, context, taskId);
    // It changes recorded points: "update: all" (PD-036), or the worker before QC checked the line (PD-044).
    if (!mine && scopes.update !== "all") {
      throw forbidden("Chỉ người làm (trước khi QC check) hoặc người có quyền sửa mọi công việc mới sửa được số lượng sau khi Done.");
    }
    if (task.done_at === null || task.qty_done === null) {
      throw new AppError("TASK_NOT_DONE", "Task chưa Done — người làm nhập số lượng khi bấm Done.", 409);
    }
    if (!doneQtyEditAllowed({ updateScope: scopes.update, mine, done: true, checked: task.checked_at !== null })) {
      throw forbidden("Task đã được QC check — nhờ Leader sửa số lượng hoàn thành.");
    }
    // A Done task always has its quantity (PD-058, filled in at Done at the latest).
    if (scopes.update !== "all" && task.qty_assigned !== null) {
      // SEC2-03: the worker's own number is capped like at Done.
      assertDeclaredDoneQty(task.qty_assigned, input.qtyDone);
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
        to: { qtyDone: input.qtyDone, notifyAssignee: !mine },
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
    const { task, workflow, scopes, mine } = await lockedTask(tx, context, taskId);
    if (isSubtaskRow(task)) {
      throw new AppError(
        "SUBTASK_FIELD_LOCKED",
        `Subtask theo người làm và QC của task — đổi trên task #${await parentNumberOf(tx, organizationId, task)}.`,
        400
      );
    }
    if (!lineAllowed(scopes.update, mine)) {
      throw forbidden("Bạn không có quyền sửa công việc này.");
    }
    const assigneeId = input.assigneeId ?? task.assignee_id;
    const qcId = input.qcId === undefined ? task.qc_id : input.qcId;
    // With "own", the line stays mine: only its QC can change.
    if (assigneeId !== task.assignee_id && scopes.update !== "all") {
      throw forbidden("Bạn chỉ đổi được QC của công việc của mình, không giao cho người khác.");
    }
    if (assigneeId !== task.assignee_id && task.done_at !== null) {
      throw new AppError("TASK_ALREADY_DONE", "Task đã Done, không đổi người làm được.", 409);
    }
    if (qcId !== task.qc_id && task.checked_at !== null) {
      throw new AppError("TASK_ALREADY_CHECKED", "Task đã Checked, không đổi QC được.", 409);
    }
    // PD-047: a work line keeps its QC — it can be changed, not removed (a Checking line never has one; a line created
    // without QC before PD-047 may stay without).
    if (qcId === null && task.qc_id !== null && !task.process_is_qc) {
      throw new AppError("QC_REQUIRED", "Task phải có QC — chỉ đổi sang QC khác.", 400);
    }
    if (qcId === null && qcStageCodes.has(task.status_code)) {
      throw new AppError("QC_REQUIRED", "Task đang ở bước QC — chỉ có thể đổi sang QC khác.", 409);
    }
    const ctx = await lineContext(tx, organizationId, [assigneeId, ...(qcId ? [qcId] : [])]);
    const errors = taskLineErrors({ assigneeId, qcId, processId: task.process_id, shiftId: task.shift_id, qtyAssigned: task.qty_assigned }, ctx).filter(
      // Catalog rows of an existing task may since have been deactivated; only people are re-validated here.
      (message) => !message.startsWith("Quy trình") && !message.startsWith("Ca làm")
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
    // PD-044: subtasks keep their line's worker and QC.
    if ((task.subtasks ?? []).length > 0) {
      await tx`
        UPDATE production.tasks SET assignee_id = ${assigneeId}, qc_id = ${qcId}, updated_at = now()
        WHERE organization_id = ${organizationId} AND parent_task_id = ${taskId} AND kind = 'NORMAL' AND deleted_at IS NULL
      `;
    }
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
    if (qcId && qcId !== task.qc_id && qcStageCodes.has(task.status_code)) {
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

type UpdateTaskInput = In<typeof UpdateProductionTaskRequestSchema>;

/** Changed fields of an edit as the from / to of its FIELD history row (only what changed). */
const fieldChanges = () => {
  const from: Record<string, unknown> = {};
  const to: Record<string, unknown> = {};
  const track = (key: string, before: unknown, after: unknown) => {
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      from[key] = before;
      to[key] = after;
    }
  };
  return { from, to, track, changed: () => Object.keys(to).length > 0 };
};

/**
 * PATCH on a subtask (PD-044): its worker, the job's Leader or "update: all". Before Done: its process (active, not
 * Checking, not the line's) and its quantity — the difference comes from / goes back to its line, which keeps at least 1
 * (the total the Leader gave stays the same). Any time: note, Hình lỗi, tags and custom fields. Shift, dates, OT hours and
 * link follow the line (400 SUBTASK_FIELD_LOCKED when changed here). A process / quantity change is a SUBTASK row
 * ("updated", fromValue = before) on the line's history; the rest the subtask's own FIELD / NOTE rows.
 *
 * PD-058: quantities may be null ("chưa có số lượng"). The line gives / takes back the difference only when it has a number
 * (a subtask without one counts 0 there, so filling it in takes its number from the line); a line without a number gives
 * nothing — the subtask's number is just recorded. Filling in an empty quantity tells the job's Leader.
 */
const updateSubtask = async (tx: QuerySql, context: AccessContext, locked: Awaited<ReturnType<typeof lockedTask>>, input: UpdateTaskInput) => {
  const { task, relation, scopes, mine } = locked;
  const organizationId = context.organization.id;
  const parent = (
    await tx<{ id: string; number: string; process_id: string; qty_assigned: number | null; done_at: Date | null }[]>`
      SELECT id, number, process_id, qty_assigned, done_at FROM production.tasks
      WHERE organization_id = ${organizationId} AND id = ${task.parent_task_id} FOR UPDATE
    `
  )[0];
  if (!parent) {
    throw notFound();
  }
  const lineNumber = Number(parent.number);
  const otHoursNow = task.ot_hours === null ? null : Number(task.ot_hours);
  const lockedChange =
    (input.shiftId !== undefined && input.shiftId !== task.shift_id) ||
    (input.assignedAt !== undefined && new Date(input.assignedAt).getTime() !== task.assigned_at.getTime()) ||
    (input.deadline !== undefined && new Date(input.deadline).getTime() !== task.deadline.getTime()) ||
    (input.otHours !== undefined && input.otHours !== otHoursNow) ||
    (input.workLink !== undefined && (input.workLink?.trim() || null) !== task.work_link);
  if (lockedChange) {
    throw new AppError("SUBTASK_FIELD_LOCKED", `Subtask theo ca, ngày nhận / giao, giờ OT và link của task — sửa trên task #${lineNumber}.`, 400);
  }
  if (!subtaskManageAllowed({ leads: relation.isJobLeader, updateScope: scopes.update, mine })) {
    throw forbidden("Chỉ người làm, Leader của job hoặc người có quyền sửa mọi công việc mới sửa được subtask.");
  }
  const processId = input.processId ?? task.process_id;
  const qtyAssigned = input.qtyAssigned ?? task.qty_assigned;
  const qtyChanged = input.qtyAssigned !== undefined && input.qtyAssigned !== task.qty_assigned;
  const structural = processId !== task.process_id || qtyChanged;
  if (structural && (task.done_at !== null || parent.done_at !== null)) {
    throw new AppError("TASK_ALREADY_DONE", "Task đã Done — không đổi được quy trình và số lượng của subtask.", 409);
  }
  let processName = task.process_name;
  if (processId !== task.process_id) {
    const process = (
      await tx<{ active: boolean; is_qc: boolean; name: string }[]>`
        SELECT active, is_qc, name FROM production.processes WHERE organization_id = ${organizationId} AND id = ${processId}
      `
    )[0];
    const problem = subtaskProcessProblem(process ? { active: process.active, isQc: process.is_qc } : undefined, processId, parent.process_id);
    if (problem) {
      throw new AppError("PROCESS_INVALID", problem, 400);
    }
    processName = process!.name;
  }
  // PD-058: the line gives the difference only when it has a number (an empty subtask counts 0 in the pool).
  let parentQty = parent.qty_assigned;
  if (qtyChanged && input.qtyAssigned !== undefined && parent.qty_assigned !== null) {
    const qtyProblem = subtaskQtyProblem(parent.qty_assigned + (task.qty_assigned ?? 0), input.qtyAssigned);
    if (qtyProblem) {
      throw new AppError("SUBTASK_QTY_INVALID", qtyProblem, 400);
    }
    parentQty = parent.qty_assigned - (input.qtyAssigned - (task.qty_assigned ?? 0));
  }
  const errorQty = input.errorQty === undefined ? task.error_qty : input.errorQty;
  const customValues =
    input.customValues !== undefined
      ? await resolveCustomValues(tx, organizationId, "TASK", input.customValues, { existing: task.custom_values as never, enforceRequired: true })
      : task.custom_values;
  const note = input.note === undefined ? task.note : input.note?.trim() || null;
  await tx`
    UPDATE production.tasks
    SET process_id = ${processId}, qty_assigned = ${qtyAssigned}, error_qty = ${errorQty}, note = ${note},
        custom_values = ${tx.json(customValues as never)}, updated_at = now()
    WHERE organization_id = ${organizationId} AND id = ${task.id}
  `;
  if (parentQty !== parent.qty_assigned) {
    await tx`UPDATE production.tasks SET qty_assigned = ${parentQty}, updated_at = now() WHERE organization_id = ${organizationId} AND id = ${parent.id}`;
  }
  if (qtyChanged) {
    await syncJobTotalImages(tx, organizationId, task.job_id);
  }
  if (qtyChanged && task.qty_assigned === null && input.qtyAssigned !== undefined) {
    // PD-058: an empty quantity filled in → the job's Leader is told.
    await enqueueProductionEvents(tx, [taskQtyFilledEvent(organizationId, task.id, context.user.id, input.qtyAssigned, false)]);
  }
  if (input.tagIds) {
    await setEntityTags(tx, organizationId, "TASK", task.id, input.tagIds);
  }
  const changes = fieldChanges();
  if (input.tagIds) {
    changes.track("tagIds", [...new Set(task.tag_ids ?? [])].sort(), [...new Set(input.tagIds)].sort());
  }
  changes.track("processId", task.process_id, processId);
  changes.track("qtyAssigned", task.qty_assigned, qtyAssigned);
  changes.track("errorQty", task.error_qty, errorQty);
  changes.track("customValues", task.custom_values, customValues);
  const logs: LogInput[] = [];
  const subtaskValue = (values: { processId: string; processName: string; qtyAssigned: number | null; parentQtyAssigned: number | null }) => ({
    subtaskId: task.id,
    subtaskNumber: Number(task.number),
    subtaskCode: taskRowCode(task),
    ...values
  });
  if (structural) {
    logs.push({
      taskId: parent.id,
      jobId: task.job_id,
      userId: context.user.id,
      action: "SUBTASK",
      from: subtaskValue({ processId: task.process_id, processName: task.process_name, qtyAssigned: task.qty_assigned, parentQtyAssigned: parent.qty_assigned }),
      to: { op: "updated", ...subtaskValue({ processId, processName, qtyAssigned, parentQtyAssigned: parentQty }) }
    });
  }
  if (changes.changed()) {
    logs.push({ taskId: task.id, jobId: task.job_id, userId: context.user.id, action: "FIELD", from: changes.from, to: changes.to });
  }
  if (note !== task.note) {
    logs.push({ taskId: task.id, jobId: task.job_id, userId: context.user.id, action: "NOTE", from: { note: task.note }, to: { note } });
  }
  await insertTaskLogs(tx, organizationId, logs);
  return { jobId: task.job_id, taskIds: [task.id, parent.id] };
};

/**
 * PATCH /production/tasks/:taskId. A line: its fields follow the line's "update" scope (PD-036). "Số lượng giao"
 * (`qtyAssigned`, the line's OWN quantity — `allocatedQty` adds its subtasks') is the Leader's number (PD-044): the job's
 * Leader, "update: all", or the worker on a line they entered themselves; any other worker gets 403
 * QTY_REQUEST_REQUIRED (send a request instead). Shift, dates and link changes are mirrored to the line's subtasks. A
 * subtask: see updateSubtask. PD-058: an empty quantity ("chưa có số lượng") is filled in directly by the line's assignee
 * too (qtyFillAllowed) — never a request — and the job's Leader is told (production.task.qty_filled).
 */
export const updateProductionTask = async (context: AccessContext, taskId: string, input: UpdateTaskInput) => {
  assertProductionMember(context);
  const organizationId = context.organization.id;
  const sql = getSql();
  const changed = await sql.begin(async (tx) => {
    const locked = await lockedTask(tx, context, taskId);
    if (isSubtaskRow(locked.task)) {
      return await updateSubtask(tx, context, locked, input);
    }
    const { task, relation, scopes, mine } = locked;
    const qtyChange = input.qtyAssigned !== undefined && input.qtyAssigned !== task.qty_assigned;
    // PD-058: filling in an empty quantity is the assignee's own step (no request); changing a number keeps PD-044.
    const qtyFill = qtyChange && task.qty_assigned === null;
    const qtyRights = { leads: relation.isJobLeader, updateScope: scopes.update, mine, createdByMe: task.created_by === context.user.id, subtask: false };
    if (qtyChange && !(qtyFill ? qtyFillAllowed(qtyRights) : qtyAssignedEditAllowed(qtyRights))) {
      throw mine ? new AppError("QTY_REQUEST_REQUIRED", "Gửi đề nghị sửa số tấm để Leader duyệt.", 403) : forbidden("Bạn không có quyền sửa số lượng giao.");
    }
    const otherFields = Object.entries(input).some(([key, value]) => key !== "qtyAssigned" && value !== undefined);
    if ((otherFields || !qtyChange) && !lineAllowed(scopes.update, mine)) {
      throw forbidden("Bạn không có quyền sửa công việc này.");
    }
    const subtasks = task.subtasks ?? [];
    const structural =
      (input.qtyAssigned !== undefined && input.qtyAssigned !== task.qty_assigned) ||
      (input.processId !== undefined && input.processId !== task.process_id) ||
      (input.shiftId !== undefined && input.shiftId !== task.shift_id);
    if (structural && task.done_at !== null) {
      throw new AppError(
        "TASK_ALREADY_DONE",
        "Task đã Done — không đổi được quy trình, ca và số lượng giao; vẫn sửa được số tấm hoàn thành, ngày nhận / giao, hình lỗi, giờ OT, ghi chú, link chia việc và trường tuỳ biến.",
        409
      );
    }
    if (input.processId !== undefined && input.processId !== task.process_id) {
      // The new process must fit the line's people (a Checking line: a QC person, no QC of its own — PD-037).
      const ctx = await lineContext(tx, organizationId, [task.assignee_id, ...(task.qc_id ? [task.qc_id] : [])]);
      const errors = taskLineErrors(
        { assigneeId: task.assignee_id, qcId: task.qc_id, processId: input.processId, shiftId: task.shift_id, qtyAssigned: task.qty_assigned },
        ctx
      ).filter((message) => !message.startsWith("Ca làm"));
      // PD-044: a line with subtasks stays a work line, apart from its subtasks' processes.
      if (subtasks.length > 0 && ctx.processes.get(input.processId)?.isQc) {
        errors.push("Task có subtask không chuyển sang Checking được.");
      }
      const twin = subtasks.find((subtask) => subtask.process_id === input.processId);
      if (twin) {
        errors.push(`Quy trình trùng với subtask #${subtaskJsonCode(twin, task.number)} của task.`);
      }
      if (errors.length > 0) {
        throw new AppError("PROCESS_INVALID", errors.join(" "), 400);
      }
    }
    if (input.shiftId !== undefined && input.shiftId !== task.shift_id) {
      const shift = (await tx<{ active: boolean }[]>`SELECT active FROM production.shifts WHERE organization_id = ${organizationId} AND id = ${input.shiftId}`)[0];
      if (!shift?.active) {
        throw new AppError("SHIFT_INVALID", "Ca làm không hợp lệ.", 400);
      }
    }
    const deadline = input.deadline ? new Date(input.deadline) : task.deadline;
    const assignedAt = input.assignedAt ? new Date(input.assignedAt) : task.assigned_at;
    if ((input.deadline || input.assignedAt) && deadline < assignedAt) {
      throw new AppError("TASK_DATES_INVALID", "Ngày giao phải từ Ngày nhận trở đi.", 400);
    }
    const errorQty = input.errorQty === undefined ? task.error_qty : input.errorQty;
    const otHours = input.otHours === undefined ? (task.ot_hours === null ? null : Number(task.ot_hours)) : input.otHours;
    // Required TASK fields are checked whenever values are sent (like jobs and clients), and at creation.
    const customValues =
      input.customValues !== undefined
        ? await resolveCustomValues(tx, organizationId, "TASK", input.customValues, { existing: task.custom_values as never, enforceRequired: true })
        : task.custom_values;
    const note = input.note === undefined ? task.note : input.note?.trim() || null;
    // "Link chia việc" (PD-040): same rule as Ghi chú — the line's "update" scope above; null / "" clears it.
    const workLink = input.workLink === undefined ? task.work_link : input.workLink?.trim() || null;
    // A deadline moved into the past makes the task late now; the next scan notifies once for that deadline (BUG-PR-03).
    const isLate = computeIsLate({ doneAt: task.done_at, closed: task.closed_at !== null, deadline, now: new Date() });
    await tx`
      UPDATE production.tasks
      SET qty_assigned = ${input.qtyAssigned ?? task.qty_assigned}, process_id = ${input.processId ?? task.process_id},
          shift_id = ${input.shiftId ?? task.shift_id}, assigned_at = ${assignedAt}, deadline = ${deadline}, note = ${note}, work_link = ${workLink}, is_late = ${isLate},
          error_qty = ${errorQty}, ot_hours = ${otHours}, custom_values = ${tx.json(customValues as never)}, updated_at = now()
      WHERE organization_id = ${organizationId} AND id = ${taskId}
    `;
    if (qtyChange) {
      await syncJobTotalImages(tx, organizationId, task.job_id);
    }
    if (qtyFill && input.qtyAssigned !== undefined) {
      await enqueueProductionEvents(tx, [taskQtyFilledEvent(organizationId, taskId, context.user.id, input.qtyAssigned, false)]);
    }
    if (input.tagIds) {
      await setEntityTags(tx, organizationId, "TASK", taskId, input.tagIds);
    }
    const shiftId = input.shiftId ?? task.shift_id;
    // PD-044: subtasks keep their line's shift, dates and link (and its lateness rule).
    const mirrored =
      shiftId !== task.shift_id ||
      assignedAt.getTime() !== task.assigned_at.getTime() ||
      deadline.getTime() !== task.deadline.getTime() ||
      workLink !== task.work_link;
    if (subtasks.length > 0 && mirrored) {
      await tx`
        UPDATE production.tasks
        SET shift_id = ${shiftId}, assigned_at = ${assignedAt}::timestamptz, deadline = ${deadline}::timestamptz, work_link = ${workLink},
            is_late = CASE WHEN done_at IS NOT NULL THEN done_at > ${deadline}::timestamptz WHEN closed_at IS NOT NULL THEN false
              ELSE now() > ${deadline}::timestamptz END,
            updated_at = now()
        WHERE organization_id = ${organizationId} AND parent_task_id = ${taskId} AND kind = 'NORMAL' AND deleted_at IS NULL
      `;
    }
    const changes = fieldChanges();
    // Tag changes are part of the task history too (FIELD tagIds, sorted).
    if (input.tagIds) {
      changes.track("tagIds", [...new Set(task.tag_ids ?? [])].sort(), [...new Set(input.tagIds)].sort());
    }
    changes.track("qtyAssigned", task.qty_assigned, input.qtyAssigned ?? task.qty_assigned);
    changes.track("processId", task.process_id, input.processId ?? task.process_id);
    changes.track("shiftId", task.shift_id, shiftId);
    changes.track("assignedAt", task.assigned_at.toISOString(), assignedAt.toISOString());
    changes.track("deadline", task.deadline.toISOString(), deadline.toISOString());
    changes.track("errorQty", task.error_qty, errorQty);
    changes.track("otHours", task.ot_hours === null ? null : Number(task.ot_hours), otHours);
    changes.track("workLink", task.work_link, workLink);
    changes.track("customValues", task.custom_values, customValues);
    const logs: LogInput[] = [];
    if (changes.changed()) {
      logs.push({ taskId, jobId: task.job_id, userId: context.user.id, action: "FIELD", from: changes.from, to: changes.to });
    }
    if (note !== task.note) {
      logs.push({ taskId, jobId: task.job_id, userId: context.user.id, action: "NOTE", from: { note: task.note }, to: { note } });
    }
    await insertTaskLogs(tx, organizationId, logs);
    return { jobId: task.job_id, taskIds: [taskId, ...(mirrored ? subtasks.map((subtask) => subtask.id) : [])] };
  });
  publishProductionChange(organizationId, changed.jobId, changed.taskIds, "tasks", context.user.id);
  return await getProductionTask(context, taskId);
};

// Deleting lines (PD-036) ------------------------------------------------------------------------------------

/**
 * Deletes locked lines of a locked job: the points / money already recorded for each line are reversed with adjustment
 * entries (the ledger stays append-only, totals drop to zero), then the line is hidden (deleted_at / deleted_by) and a
 * DELETE row is added to its history. Callers check permissions first and settle the job afterwards. Returns the
 * number of adjustment rows written.
 */
export const softDeleteTasks = async (tx: QuerySql, organizationId: string, actorId: string, tasks: TaskRow[], options: { withJob: boolean }) => {
  if (tasks.length === 0) {
    return 0;
  }
  const at = new Date();
  const reversed = new Map<string, number>();
  for (const task of tasks) {
    reversed.set(task.id, await onTaskDeleted(tx, { organizationId, taskId: task.id, taskNumber: Number(task.number), taskCode: taskRowCode(task), at }));
  }
  await tx`
    UPDATE production.tasks SET deleted_at = ${at}, deleted_by = ${actorId}, updated_at = now()
    WHERE organization_id = ${organizationId} AND id = ANY(${tasks.map((task) => task.id)}::uuid[]) AND deleted_at IS NULL
  `;
  // An open quantity request of a deleted line has nothing left to decide (PD-044).
  const pending = tasks.filter((task) => task.pending_qty_request).map((task) => task.id);
  if (pending.length > 0) {
    await tx`
      UPDATE production.task_qty_requests SET status = 'CANCELLED', decided_at = ${at}, decided_by = ${actorId}, decision_note = 'Task đã bị xoá.'
      WHERE organization_id = ${organizationId} AND task_id = ANY(${pending}::uuid[]) AND status = 'PENDING'
    `;
  }
  await insertTaskLogs(
    tx,
    organizationId,
    tasks.map((task) => ({
      taskId: task.id,
      jobId: task.job_id,
      userId: actorId,
      action: "DELETE" as const,
      from: { statusId: task.status_id, code: task.status_code, name: task.status_name, assigneeId: task.assignee_id, qtyAssigned: task.qty_assigned, qtyDone: task.qty_done },
      to: { reversedEntries: reversed.get(task.id) ?? 0, ...(options.withJob ? { withJob: true } : {}) },
      at
    }))
  );
  return [...reversed.values()].reduce((sum, count) => sum + count, 0);
};

/**
 * Deletes a locked subtask (PD-044): before its line's Done its worker, the job's Leader or the "delete" scope; after
 * Done only "delete: all" (its points are reversed like any line's). Its quantity always goes back to the line; a SUBTASK
 * row ("deleted") goes on the line's history.
 */
const deleteSubtask = async (tx: QuerySql, context: AccessContext, locked: Awaited<ReturnType<typeof lockedTask>>) => {
  const { task, relation, scopes, mine } = locked;
  const organizationId = context.organization.id;
  const parent = (
    await tx<{ id: string; qty_assigned: number | null; done_at: Date | null }[]>`
      SELECT id, qty_assigned, done_at FROM production.tasks WHERE organization_id = ${organizationId} AND id = ${task.parent_task_id} FOR UPDATE
    `
  )[0];
  if (!parent) {
    throw notFound();
  }
  const done = parent.done_at !== null || task.done_at !== null;
  const allowed = subtaskDeleteAllowed({ leads: relation.isJobLeader, deleteScope: scopes.delete, mine, done });
  if (!allowed) {
    throw forbidden(done ? "Task đã Done — chỉ người có quyền xoá mọi công việc mới xoá được subtask." : "Bạn không có quyền xoá subtask này.");
  }
  const reversedEntries = await softDeleteTasks(tx, organizationId, context.user.id, [task], { withJob: false });
  // PD-058: the quantity goes back only between numbers (a line or a subtask without one gives / gets nothing).
  const parentQty = parent.qty_assigned !== null && task.qty_assigned !== null ? parent.qty_assigned + task.qty_assigned : parent.qty_assigned;
  if (parentQty !== parent.qty_assigned) {
    await tx`UPDATE production.tasks SET qty_assigned = ${parentQty}, updated_at = now() WHERE organization_id = ${organizationId} AND id = ${parent.id}`;
  }
  await insertTaskLogs(tx, organizationId, [
    {
      taskId: parent.id,
      jobId: task.job_id,
      userId: context.user.id,
      action: "SUBTASK",
      from: { qtyAssigned: task.qty_assigned, parentQtyAssigned: parent.qty_assigned },
      to: {
        op: "deleted",
        subtaskId: task.id,
        subtaskNumber: Number(task.number),
        subtaskCode: taskRowCode(task),
        processId: task.process_id,
        processName: task.process_name,
        qtyAssigned: task.qty_assigned,
        parentQtyAssigned: parentQty,
        reversedEntries
      }
    }
  ]);
  return { reversedEntries, taskIds: [task.id, parent.id] };
};

/**
 * DELETE /production/tasks/:taskId — "delete: all", or "own" for my own line (PD-036). Deleting a line deletes its
 * subtasks with it (PD-044); a subtask: see deleteSubtask.
 */
export const deleteProductionTask = async (context: AccessContext, taskId: string): Promise<DeleteTaskResult> => {
  assertProductionMember(context);
  const organizationId = context.organization.id;
  const sql = getSql();
  const result = await sql.begin(async (tx) => {
    const locked = await lockedTask(tx, context, taskId);
    const { task, workflow, scopes, mine } = locked;
    let reversedEntries: number;
    let taskIds = [taskId];
    if (isSubtaskRow(task)) {
      ({ reversedEntries, taskIds } = await deleteSubtask(tx, context, locked));
    } else {
      if (!lineAllowed(scopes.delete, mine)) {
        throw forbidden(scopes.delete === "own" ? "Bạn chỉ xoá được công việc của chính mình." : "Bạn không có quyền xoá công việc.");
      }
      const subtasks = await lockSubtasksOf(tx, organizationId, [task]);
      reversedEntries = await softDeleteTasks(tx, organizationId, context.user.id, [task, ...subtasks], { withJob: false });
      taskIds = [taskId, ...subtasks.map((subtask) => subtask.id)];
    }
    await settleJob(tx, organizationId, workflow, task.job_id);
    return { taskId, jobId: task.job_id, reversedEntries, taskIds, people: [task.assignee_id, task.qc_id] };
  });
  // The line's people lose it from their lists (and possibly the job from theirs); the job chat follows.
  publishProductionChange(organizationId, result.jobId, result.taskIds, "tasks", context.user.id, result.people);
  await syncJobChat(context, result.jobId);
  return { taskId: result.taskId, jobId: result.jobId, reversedEntries: result.reversedEntries };
};

// Lateness scan (worker) ------------------------------------------------------------------------------------

/**
 * Worker cron (every 15 min, PLAN §9: late = not Done by the deadline). Open tasks of active jobs past their
 * deadline are flagged late; the ones not yet notified for their current deadline are returned (and marked
 * notified) — so a task created or edited when already late is notified too, once per deadline (BUG-PR-03).
 * Tasks closed without Done (BUG-PR-08) and tasks of archived jobs (BUG-PR-04) are not open work. Subtasks are not
 * scanned (PD-044): their line is, and its people are told once.
 */
export const markLateTasks = async (sql: QuerySql = getSql()) => {
  const rows = await sql<{ organization_id: string; job_id: string; id: string; notify: boolean; flagged: boolean }[]>`
    WITH due AS (
      SELECT t.id, NOT t.is_late AS flagged, t.late_notified_deadline IS DISTINCT FROM t.deadline AS notify
      FROM production.tasks t
      JOIN production.jobs j ON j.organization_id = t.organization_id AND j.id = t.job_id AND j.archived_at IS NULL
      WHERE t.done_at IS NULL AND t.closed_at IS NULL AND t.deleted_at IS NULL AND t.deadline < now() AND ${notSubtaskSql(sql)}
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
    WHERE t.done_at IS NULL AND t.closed_at IS NULL AND t.deleted_at IS NULL AND t.deadline > now() AND ${notSubtaskSql(sql)}
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
