import { Router, type Router as ExpressRouter } from "express";
import { z } from "zod";

import {
  ArchivedListCollectionSchema,
  ArchivedProjectCollectionSchema,
  AttachmentSchema,
  AttachmentUrlCollectionSchema,
  AttachmentUrlRequestSchema,
  CommentPageSchema,
  CommentSchema,
  CompleteUploadRequestSchema,
  CreateCommentRequestSchema,
  CreateListRequestSchema,
  CreateProjectRequestSchema,
  CreateTaskRequestSchema,
  CreateUploadRequestSchema,
  DirectoryCollectionSchema,
  DirectoryQuerySchema,
  ListSchema,
  MoveTaskRequestSchema,
  MyTasksQuerySchema,
  ProjectCollectionSchema,
  ProjectMemberCollectionSchema,
  ProjectMemberSchema,
  ProjectSchema,
  ReplaceWorkflowRequestSchema,
  StatusWorkflowSchema,
  TaskDetailSchema,
  TaskKeyLookupSchema,
  TaskPageSchema,
  TaskQuerySchema,
  TaskSummarySchema,
  TimelinePageSchema,
  UpdateCommentRequestSchema,
  UpdateListRequestSchema,
  UpdateProjectMemberRequestSchema,
  UpdateProjectRequestSchema,
  UpdateTaskRequestSchema,
  UploadTicketSchema,
  UpsertProjectMemberRequestSchema
} from "../../contracts/work.js";
import { hasControlCharacters } from "../../contracts/schemas.js";
import { requireSupabaseUser } from "../../middleware/auth.js";
import { createAttachmentUrls, completeTaskUpload, createTaskUpload, deleteAttachment } from "./attachments.service.js";
import { searchDirectory } from "./directory.service.js";
import { handle, IdParam, param } from "./http.js";
import { getWorkflow, replaceWorkflow } from "./statuses.service.js";
import { listMyTasks, listTasks } from "./tasks.query.js";
import { createTask, deleteTask, getTaskDetail, lookupTaskByKey, moveTask, updateTask } from "./tasks.service.js";
import { createComment, deleteComment, getTimeline, listReplies, updateComment } from "./timeline.service.js";
import {
  archiveList,
  archiveProject,
  createList,
  createProject,
  getProject,
  listArchivedLists,
  listArchivedProjects,
  listProjectMembers,
  listProjects,
  removeProjectMember,
  restoreList,
  restoreProject,
  updateList,
  updateProject,
  upsertProjectMember
} from "./projects.service.js";

export const createWorkRoutes = (): ExpressRouter => {
  const routes = Router();
  // Scoped to this module's paths: unknown routes fall through to the 404 handler instead of a 401 (WK-60).
  routes.use(["/projects", "/tasks", "/attachments", "/directory"], requireSupabaseUser);

  // Projects
  routes.get("/projects", handle(async (context) => ProjectCollectionSchema.parse(await listProjects(context))));
  routes.get("/projects/archived", handle(async (context) => ArchivedProjectCollectionSchema.parse(await listArchivedProjects(context))));
  routes.post(
    "/projects/:projectId/restore",
    handle(async (context, req) => ProjectSchema.parse(await restoreProject(context, param(req, "projectId"))))
  );
  routes.post(
    "/projects",
    handle(async (context, req) => ProjectSchema.parse(await createProject(context, CreateProjectRequestSchema.parse(req.body))), 201)
  );
  routes.get("/projects/:projectId", handle(async (context, req) => ProjectSchema.parse(await getProject(context, param(req, "projectId")))));
  routes.patch(
    "/projects/:projectId",
    handle(async (context, req) =>
      ProjectSchema.parse(await updateProject(context, param(req, "projectId"), UpdateProjectRequestSchema.parse(req.body)))
    )
  );
  routes.delete("/projects/:projectId", handle(async (context, req) => await archiveProject(context, param(req, "projectId"))));

  // Project members
  routes.get(
    "/projects/:projectId/members",
    handle(async (context, req) => ProjectMemberCollectionSchema.parse(await listProjectMembers(context, param(req, "projectId"))))
  );
  routes.post(
    "/projects/:projectId/members",
    handle(async (context, req) =>
      ProjectMemberSchema.parse(
        await upsertProjectMember(context, param(req, "projectId"), UpsertProjectMemberRequestSchema.parse(req.body))
      )
    )
  );
  routes.patch(
    "/projects/:projectId/members/:userId",
    handle(async (context, req) =>
      ProjectMemberSchema.parse(
        await upsertProjectMember(
          context,
          param(req, "projectId"),
          { userId: param(req, "userId"), ...UpdateProjectMemberRequestSchema.parse(req.body) },
          "update"
        )
      )
    )
  );
  routes.delete(
    "/projects/:projectId/members/:userId",
    handle(async (context, req) => await removeProjectMember(context, param(req, "projectId"), param(req, "userId")))
  );

  // Lists
  routes.post(
    "/projects/:projectId/lists",
    handle(
      async (context, req) =>
        ListSchema.parse(await createList(context, param(req, "projectId"), CreateListRequestSchema.parse(req.body))),
      201
    )
  );
  routes.patch(
    "/projects/:projectId/lists/:listId",
    handle(async (context, req) =>
      ListSchema.parse(
        await updateList(context, param(req, "projectId"), param(req, "listId"), UpdateListRequestSchema.parse(req.body))
      )
    )
  );
  routes.delete(
    "/projects/:projectId/lists/:listId",
    handle(async (context, req) => await archiveList(context, param(req, "projectId"), param(req, "listId")))
  );
  routes.get(
    "/projects/:projectId/archived-lists",
    handle(async (context, req) => ArchivedListCollectionSchema.parse(await listArchivedLists(context, param(req, "projectId"))))
  );
  routes.post(
    "/projects/:projectId/lists/:listId/restore",
    handle(async (context, req) => ListSchema.parse(await restoreList(context, param(req, "projectId"), param(req, "listId"))))
  );

  // Status workflows (?listId= for a list's effective workflow)
  routes.get(
    "/projects/:projectId/workflow",
    handle(async (context, req) => {
      const listId = typeof req.query.listId === "string" ? IdParam.parse(req.query.listId) : null;
      return StatusWorkflowSchema.parse(await getWorkflow(context, param(req, "projectId"), listId));
    })
  );
  routes.put(
    "/projects/:projectId/workflow",
    handle(async (context, req) =>
      StatusWorkflowSchema.parse(await replaceWorkflow(context, param(req, "projectId"), ReplaceWorkflowRequestSchema.parse(req.body)))
    )
  );

  // Tasks
  routes.get(
    "/projects/:projectId/tasks",
    handle(async (context, req) => TaskPageSchema.parse(await listTasks(context, param(req, "projectId"), TaskQuerySchema.parse(req.query))))
  );
  routes.post(
    "/projects/:projectId/tasks",
    handle(
      async (context, req) =>
        TaskSummarySchema.parse(await createTask(context, param(req, "projectId"), CreateTaskRequestSchema.parse(req.body))),
      201
    )
  );
  routes.get("/tasks/mine", handle(async (context, req) => TaskPageSchema.parse(await listMyTasks(context, MyTasksQuerySchema.parse(req.query)))));
  routes.get(
    "/tasks/by-key/:key",
    handle(async (context, req) => TaskKeyLookupSchema.parse(await lookupTaskByKey(context, TaskKeyParamSchema.parse(req.params.key))))
  );
  routes.get("/tasks/:taskId", handle(async (context, req) => TaskDetailSchema.parse(await getTaskDetail(context, param(req, "taskId")))));
  routes.patch(
    "/tasks/:taskId",
    handle(async (context, req) =>
      TaskDetailSchema.parse(await updateTask(context, param(req, "taskId"), UpdateTaskRequestSchema.parse(req.body)))
    )
  );
  routes.post(
    "/tasks/:taskId/move",
    handle(async (context, req) =>
      TaskSummarySchema.parse(await moveTask(context, param(req, "taskId"), MoveTaskRequestSchema.parse(req.body)))
    )
  );
  routes.delete("/tasks/:taskId", handle(async (context, req) => await deleteTask(context, param(req, "taskId"))));

  // Timeline & comments
  routes.get(
    "/tasks/:taskId/timeline",
    handle(async (context, req) => {
      const query = TimelineQuerySchema.parse(req.query);
      return TimelinePageSchema.parse(await getTimeline(context, param(req, "taskId"), query));
    })
  );
  routes.post(
    "/tasks/:taskId/comments",
    handle(
      async (context, req) =>
        CommentSchema.parse(await createComment(context, param(req, "taskId"), CreateCommentRequestSchema.parse(req.body))),
      201
    )
  );
  routes.get(
    "/tasks/:taskId/comments/:commentId/replies",
    handle(async (context, req) => CommentPageSchema.parse(await listReplies(context, param(req, "taskId"), param(req, "commentId"))))
  );
  routes.patch(
    "/tasks/:taskId/comments/:commentId",
    handle(async (context, req) =>
      CommentSchema.parse(
        await updateComment(context, param(req, "taskId"), param(req, "commentId"), UpdateCommentRequestSchema.parse(req.body).body)
      )
    )
  );
  routes.delete(
    "/tasks/:taskId/comments/:commentId",
    handle(async (context, req) => await deleteComment(context, param(req, "taskId"), param(req, "commentId")))
  );

  // Attachments (direct-to-storage upload with signed URLs)
  routes.post(
    "/tasks/:taskId/attachments",
    handle(
      async (context, req) =>
        UploadTicketSchema.parse(await createTaskUpload(context, param(req, "taskId"), CreateUploadRequestSchema.parse(req.body))),
      201
    )
  );
  routes.post(
    "/attachments/:attachmentId/complete",
    handle(async (context, req) =>
      AttachmentSchema.parse(
        await completeTaskUpload(context, param(req, "attachmentId"), CompleteUploadRequestSchema.parse(req.body ?? {}).target)
      )
    )
  );
  routes.post(
    "/attachments/urls",
    handle(async (context, req) =>
      AttachmentUrlCollectionSchema.parse(await createAttachmentUrls(context, AttachmentUrlRequestSchema.parse(req.body).ids))
    )
  );
  routes.delete("/attachments/:attachmentId", handle(async (context, req) => await deleteAttachment(context, param(req, "attachmentId"))));

  // People directory for pickers
  routes.get(
    "/directory/users",
    handle(async (context, req) => DirectoryCollectionSchema.parse(await searchDirectory(context, DirectoryQuerySchema.parse(req.query))))
  );

  return routes;
};

const TimelineQuerySchema = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30)
});

/** "PRJ-12" keys: short plain text only. */
const TaskKeyParamSchema = z.string().max(40).refine((value) => !hasControlCharacters(value));
