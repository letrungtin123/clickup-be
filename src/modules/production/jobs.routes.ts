import { Router, type Router as ExpressRouter } from "express";

import {
  AssignTaskRequestSchema,
  CloseFeedbackRequestSchema,
  CreateFeedbackRequestSchema,
  CreateJobRequestSchema,
  CreateProductionCommentRequestSchema,
  CreateTasksRequestSchema,
  CreateTasksResultSchema,
  CreateWorkEntryRequestSchema,
  DeleteJobResultSchema,
  DeleteTaskResultSchema,
  JobChatResultSchema,
  JobDetailSchema,
  JobOptionsQuerySchema,
  JobOptionsSchema,
  JobPageSchema,
  JobQuerySchema,
  JobTransitionRequestSchema,
  JobTransitionResultSchema,
  MyProductionTasksQuerySchema,
  QcQueueQuerySchema,
  ProductionCommentSchema,
  ProductionTaskPageSchema,
  ProductionTaskSchema,
  ProductionTimelinePageSchema,
  ProductionTimelineQuerySchema,
  ReassignFeedbackRequestSchema,
  TransitionTaskRequestSchema,
  UpdateJobRequestSchema,
  UpdateJobStatusRequestSchema,
  UpdateProductionCommentRequestSchema,
  UpdateProductionTaskRequestSchema,
  UpdateTaskQtyRequestSchema,
  WorkEntryResultSchema
} from "../../contracts/production-jobs.js";
import { withCustomFieldFilters } from "../../contracts/production-catalog.js";
import { requireSupabaseUser } from "../../middleware/auth.js";
import { handle, param } from "./http.js";
import { openJobChat } from "./job-chat.service.js";
import {
  changeJobStatus,
  closeFeedback,
  createFeedback,
  createJob,
  deleteJob,
  getJobDetail,
  listJobOptions,
  listJobs,
  reassignFeedback,
  transitionJob,
  updateJob
} from "./jobs.service.js";
import {
  assignProductionTask,
  createProductionTasks,
  deleteProductionTask,
  getProductionTask,
  listMyProductionTasks,
  listQcQueue,
  transitionProductionTask,
  updateProductionTask,
  updateProductionTaskQty
} from "./tasks.service.js";
import { createProductionComment, deleteProductionComment, listProductionTimeline, updateProductionComment } from "./timeline.service.js";
import { createWorkEntry } from "./work-entries.service.js";

/** Production jobs, tasks, feedback and comments — SPEC Phase 2. Every handler enforces production roles. */
export const createProductionJobRoutes = (): ExpressRouter => {
  const routes = Router();
  routes.use("/production", requireSupabaseUser);

  // Jobs
  routes.get("/production/jobs", handle(async (context, req) => JobPageSchema.parse(await listJobs(context, JobQuerySchema.parse(withCustomFieldFilters(req.query))))));
  routes.post("/production/jobs", handle(async (context, req) => JobDetailSchema.parse(await createJob(context, CreateJobRequestSchema.parse(req.body))), 201));
  // "Gói công việc" picker of "Nhập công việc" (PD-038); registered before /production/jobs/:jobId.
  routes.get("/production/jobs/options", handle(async (context, req) => JobOptionsSchema.parse(await listJobOptions(context, JobOptionsQuerySchema.parse(req.query)))));
  routes.get("/production/jobs/:jobId", handle(async (context, req) => JobDetailSchema.parse(await getJobDetail(context, param(req, "jobId")))));
  routes.patch(
    "/production/jobs/:jobId",
    handle(async (context, req) => JobDetailSchema.parse(await updateJob(context, param(req, "jobId"), UpdateJobRequestSchema.parse(req.body))))
  );
  // Manual job status (PD-038).
  routes.patch(
    "/production/jobs/:jobId/status",
    handle(async (context, req) => JobDetailSchema.parse(await changeJobStatus(context, param(req, "jobId"), UpdateJobStatusRequestSchema.parse(req.body))))
  );
  routes.delete("/production/jobs/:jobId", handle(async (context, req) => DeleteJobResultSchema.parse(await deleteJob(context, param(req, "jobId")))));
  routes.post(
    "/production/jobs/:jobId/tasks",
    handle(
      async (context, req) =>
        CreateTasksResultSchema.parse(await createProductionTasks(context, param(req, "jobId"), CreateTasksRequestSchema.parse(req.body).tasks)),
      201
    )
  );
  routes.post(
    "/production/jobs/:jobId/transition",
    handle(async (context, req) =>
      JobTransitionResultSchema.parse(await transitionJob(context, param(req, "jobId"), JobTransitionRequestSchema.parse(req.body)))
    )
  );
  routes.post("/production/jobs/:jobId/chat", handle(async (context, req) => JobChatResultSchema.parse(await openJobChat(context, param(req, "jobId")))));
  routes.post(
    "/production/jobs/:jobId/feedbacks",
    handle(
      async (context, req) => JobDetailSchema.parse(await createFeedback(context, param(req, "jobId"), CreateFeedbackRequestSchema.parse(req.body))),
      201
    )
  );
  routes.post(
    "/production/feedbacks/:feedbackId/close",
    handle(async (context, req) =>
      JobDetailSchema.parse(await closeFeedback(context, param(req, "feedbackId"), CloseFeedbackRequestSchema.parse(req.body)))
    )
  );
  routes.post(
    "/production/feedbacks/:feedbackId/reassign",
    handle(
      async (context, req) =>
        CreateTasksResultSchema.parse(await reassignFeedback(context, param(req, "feedbackId"), ReassignFeedbackRequestSchema.parse(req.body))),
      201
    )
  );

  // "Nhập công việc": one work-log row (PD-035)
  routes.post(
    "/production/work-entries",
    handle(async (context, req) => WorkEntryResultSchema.parse(await createWorkEntry(context, CreateWorkEntryRequestSchema.parse(req.body))), 201)
  );

  // Tasks
  routes.get(
    "/production/tasks/mine",
    handle(async (context, req) => ProductionTaskPageSchema.parse(await listMyProductionTasks(context, MyProductionTasksQuerySchema.parse(withCustomFieldFilters(req.query)))))
  );
  routes.get(
    "/production/tasks/qc-queue",
    handle(async (context, req) => ProductionTaskPageSchema.parse(await listQcQueue(context, QcQueueQuerySchema.parse(withCustomFieldFilters(req.query)))))
  );
  routes.get("/production/tasks/:taskId", handle(async (context, req) => ProductionTaskSchema.parse(await getProductionTask(context, param(req, "taskId")))));
  routes.patch(
    "/production/tasks/:taskId",
    handle(async (context, req) =>
      ProductionTaskSchema.parse(await updateProductionTask(context, param(req, "taskId"), UpdateProductionTaskRequestSchema.parse(req.body)))
    )
  );
  routes.delete(
    "/production/tasks/:taskId",
    handle(async (context, req) => DeleteTaskResultSchema.parse(await deleteProductionTask(context, param(req, "taskId"))))
  );
  routes.post(
    "/production/tasks/:taskId/transition",
    handle(async (context, req) =>
      ProductionTaskSchema.parse(await transitionProductionTask(context, param(req, "taskId"), TransitionTaskRequestSchema.parse(req.body)))
    )
  );
  routes.post(
    "/production/tasks/:taskId/qty",
    handle(async (context, req) =>
      ProductionTaskSchema.parse(await updateProductionTaskQty(context, param(req, "taskId"), UpdateTaskQtyRequestSchema.parse(req.body)))
    )
  );
  routes.post(
    "/production/tasks/:taskId/assign",
    handle(async (context, req) =>
      ProductionTaskSchema.parse(await assignProductionTask(context, param(req, "taskId"), AssignTaskRequestSchema.parse(req.body)))
    )
  );

  // Comments & timeline
  for (const [segment, entity] of [
    ["jobs", "JOB"],
    ["tasks", "TASK"]
  ] as const) {
    const idParam = segment === "jobs" ? "jobId" : "taskId";
    routes.get(
      `/production/${segment}/:${idParam}/timeline`,
      handle(async (context, req) =>
        ProductionTimelinePageSchema.parse(
          await listProductionTimeline(context, entity, param(req, idParam), ProductionTimelineQuerySchema.parse(req.query))
        )
      )
    );
    routes.post(
      `/production/${segment}/:${idParam}/comments`,
      handle(
        async (context, req) =>
          ProductionCommentSchema.parse(
            await createProductionComment(context, entity, param(req, idParam), CreateProductionCommentRequestSchema.parse(req.body))
          ),
        201
      )
    );
  }
  routes.patch(
    "/production/comments/:commentId",
    handle(async (context, req) =>
      ProductionCommentSchema.parse(
        await updateProductionComment(context, param(req, "commentId"), UpdateProductionCommentRequestSchema.parse(req.body).body)
      )
    )
  );
  routes.delete("/production/comments/:commentId", handle(async (context, req) => await deleteProductionComment(context, param(req, "commentId"))));

  return routes;
};
