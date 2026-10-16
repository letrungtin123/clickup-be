import type { CreateQtyRequest, DecideQtyRequest, ProductionTask } from "../../contracts/production-jobs.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import type { QuerySql } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { assertProductionMember } from "./access.js";
import { forbidden } from "./job-permissions.js";
import { allocatedQtyOf, isSubtaskRow, subtaskQtySum } from "./jobs.repo.js";
import { enqueueProductionEvents, qtyRequestEvent } from "./notifications.js";
import { publishProductionChange } from "./realtime.js";
import { getProductionTask, insertTaskLogs, lockedTask, syncJobTotalImages } from "./tasks.service.js";
import { qtyRequestProblem } from "./workflow.js";

/**
 * PD-044 "Số lượng giao" is the Leader's number. The job's Leader or "update: all" change it directly (and the worker on a
 * line they entered themselves, see updateProductionTask); any other worker asks: a request with the new TOTAL (the line
 * and its subtasks) and a reason, one open request per line (production.task_qty_requests). The Leader is notified at once
 * (no active Leader: the production Admins) and approves or rejects it with a note; the worker is notified of the decision
 * and may cancel while it is open. Until approved the line keeps its quantity; approving after Done is refused. Every
 * step is a QTY_REQUEST row on the line's history ({ op, requestId, fromQty, toQty }, note = reason / decision note).
 */

const requestNotFound = () => new AppError("QTY_REQUEST_NOT_FOUND", "Không tìm thấy đề nghị sửa số tấm.", 404);

type RequestRow = { id: string; task_id: string; status: string; from_qty: number; to_qty: number; requested_by: string };

/** The request's line (404 when the request does not exist in the organization). */
const requestTaskId = async (sql: QuerySql, organizationId: string, requestId: string) => {
  const row = (await sql<{ task_id: string }[]>`SELECT task_id FROM production.task_qty_requests WHERE organization_id = ${organizationId} AND id = ${requestId}`)[0];
  if (!row) {
    throw requestNotFound();
  }
  return row.task_id;
};

/** Locks the request after its line (job → line → request, the order every task change uses). */
const lockRequest = async (tx: QuerySql, organizationId: string, requestId: string) => {
  const row = (
    await tx<RequestRow[]>`
      SELECT id, task_id, status, from_qty, to_qty, requested_by FROM production.task_qty_requests
      WHERE organization_id = ${organizationId} AND id = ${requestId} FOR UPDATE
    `
  )[0];
  if (!row) {
    throw requestNotFound();
  }
  return row;
};

const requestLogValue = (request: Pick<RequestRow, "id" | "from_qty" | "to_qty">, op: string) => ({
  op,
  requestId: request.id,
  fromQty: request.from_qty,
  toQty: request.to_qty
});

const closedError = () => new AppError("QTY_REQUEST_CLOSED", "Đề nghị này đã được xử lý.", 409);

/**
 * POST /production/tasks/:taskId/qty-requests → the line. The line's worker only; a NORMAL line that is not a subtask, not
 * Done, without an open request (409 QTY_REQUEST_OPEN); the new total differs from the current one and leaves the line at
 * least 1 image besides its subtasks. PD-058: a task without a quantity is filled in directly, never asked for (409
 * TASK_QTY_EMPTY); the total counts known numbers only.
 */
export const createQtyRequest = async (context: AccessContext, taskId: string, input: CreateQtyRequest): Promise<ProductionTask> => {
  assertProductionMember(context);
  const organizationId = context.organization.id;
  const sql = getSql();
  const jobId = await sql.begin(async (tx) => {
    const { task, mine } = await lockedTask(tx, context, taskId);
    if (task.qty_assigned === null) {
      throw new AppError("TASK_QTY_EMPTY", "Task chưa có số lượng — điền trực tiếp vào ô số lượng.", 409);
    }
    if (!mine) {
      throw forbidden("Chỉ người làm task này gửi được đề nghị sửa số tấm.");
    }
    if (isSubtaskRow(task)) {
      throw new AppError("QTY_REQUEST_INVALID", "Subtask lấy số tấm từ task gốc — sửa số tấm của subtask trực tiếp.", 400);
    }
    if (task.kind !== "NORMAL") {
      throw new AppError("QTY_REQUEST_INVALID", "Chỉ task thường mới đề nghị sửa số tấm.", 400);
    }
    if (task.done_at !== null) {
      throw new AppError("TASK_ALREADY_DONE", "Task đã Done — không đổi số lượng giao được nữa.", 409);
    }
    if (task.pending_qty_request) {
      throw new AppError("QTY_REQUEST_OPEN", "Task đã có đề nghị sửa số tấm đang chờ Leader duyệt.", 409);
    }
    const currentTotal = allocatedQtyOf(task);
    const problem = qtyRequestProblem({ currentTotal, subtaskQty: subtaskQtySum(task), requestedTotal: input.qtyAssigned });
    if (problem) {
      throw new AppError("QTY_REQUEST_INVALID", problem, 400);
    }
    const reason = input.reason.trim();
    const request = (
      await tx<{ id: string }[]>`
        INSERT INTO production.task_qty_requests (organization_id, task_id, job_id, requested_by, from_qty, to_qty, reason)
        VALUES (${organizationId}, ${taskId}, ${task.job_id}, ${context.user.id}, ${currentTotal}, ${input.qtyAssigned}, ${reason})
        RETURNING id
      `
    )[0]!;
    await insertTaskLogs(tx, organizationId, [
      {
        taskId,
        jobId: task.job_id,
        userId: context.user.id,
        action: "QTY_REQUEST",
        to: requestLogValue({ id: request.id, from_qty: currentTotal, to_qty: input.qtyAssigned }, "requested"),
        note: reason
      }
    ]);
    await enqueueProductionEvents(tx, [qtyRequestEvent(organizationId, "requested", taskId, request.id, context.user.id)]);
    return task.job_id;
  });
  publishProductionChange(organizationId, jobId, [taskId], "tasks", context.user.id);
  return await getProductionTask(context, taskId);
};

/**
 * POST /production/qty-requests/:requestId/decision → the line. The job's Leader (actsAsJobLeader) or "update: all"
 * (403 otherwise); an open request only (409 QTY_REQUEST_CLOSED). Approving sets the line's own quantity to the new total
 * minus its subtasks' (still at least 1) and keeps Tổng tấm in sync; refused once the line is Done (409 TASK_ALREADY_DONE
 * "Task đã Done — hãy từ chối đề nghị."). The worker is notified either way.
 */
export const decideQtyRequest = async (context: AccessContext, requestId: string, input: DecideQtyRequest): Promise<ProductionTask> => {
  assertProductionMember(context);
  const organizationId = context.organization.id;
  const sql = getSql();
  const taskId = await requestTaskId(sql, organizationId, requestId);
  const jobId = await sql.begin(async (tx) => {
    const { task, relation, scopes } = await lockedTask(tx, context, taskId);
    const request = await lockRequest(tx, organizationId, requestId);
    if (!relation.isJobLeader && scopes.update !== "all") {
      throw forbidden("Chỉ Leader của job hoặc người có quyền sửa mọi công việc duyệt được đề nghị sửa số tấm.");
    }
    if (request.status !== "PENDING") {
      throw closedError();
    }
    const note = input.note?.trim() || null;
    if (input.approve) {
      if (task.done_at !== null) {
        throw new AppError("TASK_ALREADY_DONE", "Task đã Done — hãy từ chối đề nghị.", 409);
      }
      const subtaskQty = subtaskQtySum(task);
      const lineQty = request.to_qty - subtaskQty;
      if (lineQty < 1) {
        throw new AppError(
          "QTY_REQUEST_INVALID",
          `Tổng mới (${request.to_qty}) không đủ cho các subtask (${subtaskQty} tấm) — hãy từ chối đề nghị hoặc sửa subtask trước.`,
          409
        );
      }
      await tx`UPDATE production.tasks SET qty_assigned = ${lineQty}, updated_at = now() WHERE organization_id = ${organizationId} AND id = ${taskId}`;
      await syncJobTotalImages(tx, organizationId, task.job_id);
    }
    await tx`
      UPDATE production.task_qty_requests
      SET status = ${input.approve ? "APPROVED" : "REJECTED"}, decided_by = ${context.user.id}, decided_at = now(), decision_note = ${note}
      WHERE organization_id = ${organizationId} AND id = ${requestId}
    `;
    await insertTaskLogs(tx, organizationId, [
      {
        taskId,
        jobId: task.job_id,
        userId: context.user.id,
        action: "QTY_REQUEST",
        to: requestLogValue(request, input.approve ? "approved" : "rejected"),
        note
      }
    ]);
    await enqueueProductionEvents(tx, [qtyRequestEvent(organizationId, "decided", taskId, requestId, context.user.id)]);
    return task.job_id;
  });
  publishProductionChange(organizationId, jobId, [taskId], "tasks", context.user.id);
  return await getProductionTask(context, taskId);
};

/** DELETE /production/qty-requests/:requestId → the line: the worker who asked withdraws an open request. */
export const cancelQtyRequest = async (context: AccessContext, requestId: string): Promise<ProductionTask> => {
  assertProductionMember(context);
  const organizationId = context.organization.id;
  const sql = getSql();
  const taskId = await requestTaskId(sql, organizationId, requestId);
  const jobId = await sql.begin(async (tx) => {
    const { task } = await lockedTask(tx, context, taskId);
    const request = await lockRequest(tx, organizationId, requestId);
    if (request.requested_by !== context.user.id) {
      throw forbidden("Chỉ người gửi đề nghị mới huỷ được.");
    }
    if (request.status !== "PENDING") {
      throw closedError();
    }
    await tx`
      UPDATE production.task_qty_requests SET status = 'CANCELLED', decided_by = ${context.user.id}, decided_at = now()
      WHERE organization_id = ${organizationId} AND id = ${requestId}
    `;
    await insertTaskLogs(tx, organizationId, [
      { taskId, jobId: task.job_id, userId: context.user.id, action: "QTY_REQUEST", to: requestLogValue(request, "cancelled") }
    ]);
    return task.job_id;
  });
  publishProductionChange(organizationId, jobId, [taskId], "tasks", context.user.id);
  return await getProductionTask(context, taskId);
};
