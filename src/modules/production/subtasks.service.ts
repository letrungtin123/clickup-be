import { randomUUID } from "node:crypto";

import type { CreateSubtaskRequest, ProductionTask } from "../../contracts/production-jobs.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import type { AccessContext } from "../access/access-context.js";
import { assertProductionMember, productionRolesOf } from "./access.js";
import { forbidden, loadTaskScopes, subtaskManageAllowed, taskCreateForbidden } from "./job-permissions.js";
import { isSubtaskRow } from "./jobs.repo.js";
import { publishProductionChange } from "./realtime.js";
import { assertProcessesPriced, pricingDay } from "./pricing.js";
import { maxSubtaskSeq, taskCode } from "./task-codes.js";
import { getProductionTask, insertTaskLogs, lockedTask, settleJob } from "./tasks.service.js";
import { subtaskProcessProblem, subtaskQtyProblem } from "./workflow.js";

/**
 * PD-044 subtasks. The worker (or the job's Leader / "update: all") splits part of a line that is not Done yet into
 * another process ("Công đoạn"), with an optional reason (PD-045). A subtask is a production.tasks row of kind NORMAL whose parent_task_id is
 * the line, with `split_reason`: same worker, QC, shift, dates, link and custom fields as the line (kept in sync by the
 * line's edits), the line's status (it follows every move of the line, `moveTasks`), and its quantity taken from the line
 * — the total the Leader gave (`allocatedQty`) stays the same. Each subtask scores on its own (its process price × its
 * Done quantity). Edits and deletion: `updateProductionTask` / `deleteProductionTask`.
 */

/**
 * POST /production/tasks/:taskId/subtasks → the line, refreshed. The line: a live NORMAL work line (not a subtask, not a
 * feedback redo line, not Checking), not Done, job not archived. The process: active, not Checking, not the line's. The
 * quantity: at most the line's minus 1 (the line keeps at least 1). One transaction (job, then line locked): the line
 * gives the quantity, the subtask is inserted, history CREATE on the subtask and SUBTASK ("created", note = reason or
 * null) on the line. Nobody is notified (it is the same person's work).
 *
 * PD-045 code: the subtask takes the next letter of its line — sub_seq = the highest sub_seq of every subtask the line
 * ever had (deleted ones included: a letter is never reused) + 1, under the line's row lock; "1216" → "1216a", "1216b"…
 * After "zz" (702) the line takes no more subtasks (409 SUBTASK_LIMIT).
 *
 * PD-058: the quantity is optional (null = "chưa có số lượng", filled in later or at Done). It is carved from the line only
 * when both the line and the subtask have a number (same rule as above); otherwise nothing is carved.
 */
export const createProductionSubtask = async (context: AccessContext, taskId: string, input: CreateSubtaskRequest): Promise<ProductionTask> => {
  assertProductionMember(context);
  const organizationId = context.organization.id;
  const sql = getSql();
  const result = await sql.begin(async (tx) => {
    const { task, workflow, relation, scopes, mine } = await lockedTask(tx, context, taskId);
    if (isSubtaskRow(task)) {
      throw new AppError("SUBTASK_PARENT_INVALID", "Không tách subtask từ một subtask.", 400);
    }
    if (task.kind !== "NORMAL") {
      throw new AppError("SUBTASK_PARENT_INVALID", "Chỉ tách subtask từ task thường (không phải task làm lại feedback).", 400);
    }
    if (task.process_is_qc) {
      throw new AppError("SUBTASK_PARENT_INVALID", "Task Checking không tách subtask.", 400);
    }
    // PD-079: "update: all" splits subtasks only through the task-creating roles (an Account alone creates no task).
    const taskScopes = await loadTaskScopes(tx, context);
    if (!subtaskManageAllowed({ leads: relation.isJobLeader, updateScope: taskScopes.update, mine })) {
      if (productionRolesOf(context).has("ACCOUNT") && subtaskManageAllowed({ leads: relation.isJobLeader, updateScope: scopes.update, mine })) {
        throw taskCreateForbidden();
      }
      throw forbidden("Chỉ người làm task, Leader của job hoặc người có quyền sửa mọi công việc mới tách được subtask.");
    }
    if (task.done_at !== null || task.closed_at !== null) {
      throw new AppError("TASK_ALREADY_DONE", "Task đã Done — không tách subtask được nữa.", 409);
    }
    const process = (
      await tx<{ active: boolean; is_qc: boolean; name: string }[]>`
        SELECT active, is_qc, name FROM production.processes WHERE organization_id = ${organizationId} AND id = ${input.processId}
      `
    )[0];
    const processProblem = subtaskProcessProblem(process ? { active: process.active, isQc: process.is_qc } : undefined, input.processId, task.process_id);
    if (processProblem) {
      throw new AppError("PROCESS_INVALID", processProblem, 400);
    }
    // PD-080b: priced for the job's project on the line's Ngày nhận (the subtask takes the line's).
    await assertProcessesPriced(tx, organizationId, task.project_id, [{ processId: input.processId, day: pricingDay(task.assigned_at) }]);
    // PD-058: the quantity is optional; it is carved from the line only when both have a number (same rule as before).
    const qty = input.qtyAssigned ?? null;
    const carve = qty !== null && task.qty_assigned !== null;
    const qtyProblem = carve ? subtaskQtyProblem(task.qty_assigned!, qty) : null;
    if (qtyProblem) {
      throw new AppError("SUBTASK_QTY_INVALID", qtyProblem, 400);
    }
    // Optional (PD-045): empty = none.
    const reason = input.reason?.trim() || null;
    // The next letter of the line (the line row is locked by lockedTask, so two splits never take the same one).
    const subSeq =
      ((
        await tx<{ last: number | null }[]>`
          SELECT max(sub_seq)::int AS last FROM production.tasks
          WHERE organization_id = ${organizationId} AND parent_task_id = ${taskId} AND kind = 'NORMAL'
        `
      )[0]?.last ?? 0) + 1;
    if (subSeq > maxSubtaskSeq) {
      throw new AppError("SUBTASK_LIMIT", `Task #${Number(task.number)} đã có tối đa ${maxSubtaskSeq} subtask.`, 409);
    }
    const parentQty = carve ? task.qty_assigned! - qty : task.qty_assigned;
    if (carve) {
      await tx`UPDATE production.tasks SET qty_assigned = ${parentQty}, updated_at = now() WHERE organization_id = ${organizationId} AND id = ${taskId}`;
    }
    // The line's people, shift, dates, status, lateness, link and custom fields, copied in the database (full precision).
    const id = randomUUID();
    const created = (
      await tx<{ number: string }[]>`
        INSERT INTO production.tasks (id, organization_id, job_id, assignee_id, qc_id, process_id, shift_id, qty_assigned, assigned_at, deadline,
          status_id, kind, parent_task_id, sub_seq, split_reason, work_link, custom_values, is_late, created_by)
        SELECT ${id}, p.organization_id, p.job_id, p.assignee_id, p.qc_id, ${input.processId}, p.shift_id, ${qty}::int, p.assigned_at,
          p.deadline, p.status_id, 'NORMAL', p.id, ${subSeq}, ${reason}, p.work_link, p.custom_values, p.is_late, ${context.user.id}
        FROM production.tasks p WHERE p.organization_id = ${organizationId} AND p.id = ${taskId}
        RETURNING number
      `
    )[0]!;
    const subtaskCode = taskCode({ number: created.number, subSeq, parentNumber: task.number });
    await insertTaskLogs(tx, organizationId, [
      {
        taskId: id,
        jobId: task.job_id,
        userId: context.user.id,
        action: "CREATE",
        to: { assigneeId: task.assignee_id, qcId: task.qc_id, qtyAssigned: qty, kind: "NORMAL", parentTaskId: taskId, processId: input.processId },
        note: reason
      },
      {
        taskId,
        jobId: task.job_id,
        userId: context.user.id,
        action: "SUBTASK",
        to: {
          op: "created",
          subtaskId: id,
          subtaskNumber: Number(created.number),
          subtaskCode,
          processId: input.processId,
          processName: process!.name,
          qtyAssigned: qty,
          parentQtyAssigned: parentQty
        },
        note: reason
      }
    ]);
    // The job's Tổng tấm is unchanged (the images only moved between rows); settled like every line change.
    await settleJob(tx, organizationId, workflow, task.job_id);
    return { jobId: task.job_id, subtaskId: id };
  });
  publishProductionChange(organizationId, result.jobId, [taskId, result.subtaskId], "tasks", context.user.id);
  return await getProductionTask(context, taskId);
};
