import type { CreateWorkEntryRequest, WorkEntryResult } from "../../contracts/production-jobs.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import type { QuerySql } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { assertProductionMember } from "./access.js";
import { syncJobChat } from "./job-chat.service.js";
import { assertTaskLinesCreatable, loadTaskScopes } from "./job-permissions.js";
import { loadWorkflowModel, selectTasks, toProductionTasks } from "./jobs.repo.js";
import { publishProductionChange } from "./realtime.js";
import { insertTasks, loadJobForTasks, settleJob } from "./tasks.service.js";

/**
 * "Nhập công việc" (PD-035 / PD-038): one row of the company's work-log Excel typed by a staff member, added to an
 * EXISTING job: the row names the project and the job (picked from GET /production/jobs/options). The quick entry never
 * creates a job — jobs are created with "Tạo job" only (PD-038). The line is an ordinary task in the initial status; the
 * normal workflow applies afterwards. PD-047: a work line (not Checking) must name a QC (400 TASK_LINES_INVALID
 * "Task 1: Chọn QC cho task.", insertTasks).
 *
 * Permissions (PD-036 "create"): "all" enters a row for anyone, "own" only for oneself — also into a job the caller could
 * not see before (the line is theirs); "none" (STAFF by default since PD-047) refuses (403). PD-079: ACCOUNT's "create" does
 * not count (an Account alone gets 403 TASK_CREATE_FORBIDDEN). Archived jobs refuse new
 * lines (409), deleted ones are not found.
 */

/** The job of the entry: a live job of the chosen project (404 when missing / deleted, 400 when of another project). */
const assertEntryJob = async (tx: QuerySql, organizationId: string, input: CreateWorkEntryRequest) => {
  const project = await tx`SELECT 1 FROM production.projects WHERE organization_id = ${organizationId} AND id = ${input.projectId} AND active`;
  if (project.length === 0) {
    throw new AppError("PROJECT_NOT_FOUND", "Project không tồn tại hoặc đã ngừng hoạt động.", 400);
  }
  const job = (
    await tx<{ project_id: string }[]>`
      SELECT project_id FROM production.jobs WHERE organization_id = ${organizationId} AND id = ${input.jobId} AND deleted_at IS NULL
    `
  )[0];
  if (!job) {
    throw new AppError("JOB_NOT_FOUND", "Không tìm thấy Job Code — chọn lại trong danh sách.", 404);
  }
  if (job.project_id !== input.projectId) {
    throw new AppError("JOB_PROJECT_MISMATCH", "Job Code không thuộc Project đã chọn.", 400);
  }
};

/** POST /production/work-entries. */
export const createWorkEntry = async (context: AccessContext, input: CreateWorkEntryRequest): Promise<WorkEntryResult> => {
  assertProductionMember(context);
  const organizationId = context.organization.id;
  const assigneeId = input.assigneeId ?? context.user.id;
  const sql = getSql();
  // PD-079: the task-creating scopes — an Account alone creates no task (403 TASK_CREATE_FORBIDDEN).
  assertTaskLinesCreatable(context, await loadTaskScopes(sql, context), [assigneeId]);
  if (Date.parse(input.deadline) < Date.parse(input.assignedAt)) {
    throw new AppError("TASK_LINES_INVALID", "Ngày giao phải từ Ngày nhận trở đi.", 400);
  }
  const result = await sql.begin(async (tx) => {
    await assertEntryJob(tx, organizationId, input);
    // Locks the job; archived jobs are read-only (409 JOB_ARCHIVED).
    const job = await loadJobForTasks(tx, organizationId, input.jobId, true);
    const workflow = await loadWorkflowModel(tx, organizationId);
    const created = await insertTasks(
      tx,
      context,
      workflow,
      job,
      [
        {
          assigneeId,
          processId: input.processId,
          shiftId: input.shiftId,
          // PD-058: optional (null = "chưa có số lượng").
          qtyAssigned: input.qtyAssigned ?? null,
          qcId: input.qcId ?? null,
          assignedAt: input.assignedAt,
          deadline: input.deadline,
          errorQty: input.errorQty ?? null,
          otHours: input.otHours ?? null,
          ...(input.note ? { note: input.note } : {}),
          ...(input.workLink ? { workLink: input.workLink } : {}),
          ...(input.customValues ? { customValues: input.customValues } : {})
        }
      ],
      { kind: "NORMAL", feedbackId: null, defaultParentId: null }
    );
    await settleJob(tx, organizationId, workflow, input.jobId);
    return { jobId: input.jobId, ...created };
  });
  publishProductionChange(organizationId, result.jobId, result.ids, "tasks", context.user.id);
  await syncJobChat(context, result.jobId);
  const workflow = await loadWorkflowModel(sql, organizationId);
  const [task] = await toProductionTasks(sql, context, workflow, await selectTasks(sql, organizationId, result.ids));
  return { jobId: result.jobId, task: task!, warnings: result.warnings };
};
