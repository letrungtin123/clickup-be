import { Router, type Router as ExpressRouter } from "express";

import {
  AssignTaskRequestSchema,
  CloseFeedbackRequestSchema,
  CreateFeedbackRequestSchema,
  CreateJobRequestSchema,
  CreateProductionCommentRequestSchema,
  CreateTasksRequestSchema,
  CreateTasksResultSchema,
  JobChatResultSchema,
  JobDetailSchema,
  JobPageSchema,
  JobQuerySchema,
  JobTransitionRequestSchema,
  JobTransitionResultSchema,
  MyProductionTasksQuerySchema,
  ProductionCommentSchema,
  ProductionTaskPageSchema,
  ProductionTaskSchema,
  ProductionTimelinePageSchema,
  ProductionTimelineQuerySchema,
  ReassignFeedbackRequestSchema,
  TransitionTaskRequestSchema,
  UpdateJobRequestSchema,
  UpdateProductionCommentRequestSchema,
  UpdateProductionTaskRequestSchema,
  UpdateTaskQtyRequestSchema
} from "../../contracts/production-jobs.js";
import { requireSupabaseUser } from "../../middleware/auth.js";
import { handle, param } from "../work/http.js";
import { openJobChat } from "./job-chat.service.js";
import { closeFeedback, createFeedback, createJob, getJobDetail, listJobs, reassignFeedback, transitionJob, updateJob } from "./jobs.service.js";
import {
  assignProductionTask,
  createProductionTasks,
  getProductionTask,
  listMyProductionTasks,
  listQcQueue,
  transitionProductionTask,
  updateProductionTask,
  updateProductionTaskQty
} from "./tasks.service.js";
import { createProductionComment, deleteProductionComment, listProductionTimeline, updateProductionComment } from "./timeline.service.js";

/** Production jobs, tasks, feedback and comments — SPEC Phase 2. Every handler enforces production roles. */
export const createProductionJobRoutes = (): ExpressRouter => {
  const routes = Router();
  routes.use("/production", requireSupabaseUser);

  // Jobs
  routes.get("/production/jobs", handle(async (context, req) => JobPageSchema.parse(await listJobs(context, JobQuerySchema.parse(req.query)))));
  routes.post("/production/jobs", handle(async (context, req) => JobDetailSchema.parse(await createJob(context, CreateJobRequestSchema.parse(req.body))), 201));
  routes.get("/production/jobs/:jobId", handle(async (context, req) => JobDetailSchema.parse(await getJobDetail(context, param(req, "jobId")))));
  routes.patch(
    "/production/jobs/:jobId",
    handle(async (context, req) => JobDetailSchema.parse(await updateJob(context, param(req, "jobId"), UpdateJobRequestSchema.parse(req.body))))
  );
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

  // Tasks
  routes.get(
    "/production/tasks/mine",
    handle(async (context, req) => ProductionTaskPageSchema.parse(await listMyProductionTasks(context, MyProductionTasksQuerySchema.parse(req.query))))
  );
  routes.get("/production/tasks/qc-queue", handle(async (context) => ProductionTaskPageSchema.parse(await listQcQueue(context))));
  routes.get("/production/tasks/:taskId", handle(async (context, req) => ProductionTaskSchema.parse(await getProductionTask(context, param(req, "taskId")))));
  routes.patch(
    "/production/tasks/:taskId",
    handle(async (context, req) =>
      ProductionTaskSchema.parse(await updateProductionTask(context, param(req, "taskId"), UpdateProductionTaskRequestSchema.parse(req.body)))
    )
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
