import { Router, type Request, type Router as ExpressRouter } from "express";

import {
  ArchiveResponseSchema,
  CreateListRequestSchema,
  CreateProjectRequestSchema,
  CreateRoleRequestSchema,
  CreateTaskCommentRequestSchema,
  CreateTaskRequestSchema,
  ListCollectionSchema,
  ListSummarySchema,
  OpaqueIdSchema,
  OrganizationMemberCollectionSchema,
  OrganizationMemberSchema,
  PermissionCollectionSchema,
  ProjectCollectionSchema,
  ProjectMemberSchema,
  ProjectMemberCollectionSchema,
  ProjectSummarySchema,
  RoleCollectionSchema,
  ManagedRoleSchema,
  TaskDetailResponseSchema,
  TaskPageSchema,
  TaskStatusCollectionSchema,
  TaskSummarySchema,
  UpdateListRequestSchema,
  UpdateOrganizationMemberRequestSchema,
  UpdateProjectMemberRequestSchema,
  UpdateProjectRequestSchema,
  UpdateRolePermissionsRequestSchema,
  UpdateRoleRequestSchema,
  UpdateTaskRequestSchema,
  UpsertProjectMemberRequestSchema,
  WorkspaceContextSchema
} from "../../contracts/schemas.js";
import { CursorQuerySchema } from "../../contracts/pagination.js";
import { requireSupabaseUser, type AuthenticatedRequest } from "../../middleware/auth.js";
import {
  archiveRole,
  archiveProject,
  archiveProjectList,
  createProject,
  createProjectList,
  createRole,
  createTask,
  createTaskComment,
  getTaskDetail,
  getWorkspaceContext,
  listOrganizationMembers,
  listPermissions,
  listProjectLists,
  listProjectMembers,
  listProjectStatuses,
  listProjectTasks,
  listProjects,
  listRoles,
  removeProjectMember,
  updateProject,
  updateOrganizationMember,
  updateProjectMember,
  updateProjectList,
  updateRole,
  updateRolePermissions,
  upsertProjectMember,
  updateTask
} from "./workspace.service.js";

export const workspaceRoutes: ExpressRouter = Router();

const getAuthenticatedUserId = (req: Request) => {
  return (req as unknown as AuthenticatedRequest).auth.id;
};

workspaceRoutes.use(requireSupabaseUser);

workspaceRoutes.get("/workspace/context", async (req, res, next) => {
  try {
    const context = await getWorkspaceContext(getAuthenticatedUserId(req));
    res.json(WorkspaceContextSchema.parse(context));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.get("/permissions", async (req, res, next) => {
  try {
    const context = await getWorkspaceContext(getAuthenticatedUserId(req));
    const payload = await listPermissions(context);
    res.json(PermissionCollectionSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.get("/roles", async (req, res, next) => {
  try {
    const context = await getWorkspaceContext(getAuthenticatedUserId(req));
    const payload = await listRoles(context);
    res.json(RoleCollectionSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.post("/roles", async (req, res, next) => {
  try {
    const input = CreateRoleRequestSchema.parse(req.body);
    const context = await getWorkspaceContext(getAuthenticatedUserId(req));
    const payload = await createRole(context, input);
    res.status(201).json(ManagedRoleSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.patch("/roles/:roleId", async (req, res, next) => {
  try {
    const roleId = OpaqueIdSchema.parse(req.params.roleId);
    const input = UpdateRoleRequestSchema.parse(req.body);
    const context = await getWorkspaceContext(getAuthenticatedUserId(req));
    const payload = await updateRole(context, roleId, input);
    res.json(ManagedRoleSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.delete("/roles/:roleId", async (req, res, next) => {
  try {
    const roleId = OpaqueIdSchema.parse(req.params.roleId);
    const context = await getWorkspaceContext(getAuthenticatedUserId(req));
    const payload = await archiveRole(context, roleId);
    res.json(ArchiveResponseSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.patch("/roles/:roleId/permissions", async (req, res, next) => {
  try {
    const roleId = OpaqueIdSchema.parse(req.params.roleId);
    const input = UpdateRolePermissionsRequestSchema.parse(req.body);
    const context = await getWorkspaceContext(getAuthenticatedUserId(req));
    const payload = await updateRolePermissions(context, roleId, input);
    res.json(ManagedRoleSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.get("/organization/members", async (req, res, next) => {
  try {
    const context = await getWorkspaceContext(getAuthenticatedUserId(req));
    const payload = await listOrganizationMembers(context);
    res.json(OrganizationMemberCollectionSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.patch("/organization/members/:membershipId", async (req, res, next) => {
  try {
    const membershipId = OpaqueIdSchema.parse(req.params.membershipId);
    const input = UpdateOrganizationMemberRequestSchema.parse(req.body);
    const context = await getWorkspaceContext(getAuthenticatedUserId(req));
    const payload = await updateOrganizationMember(context, membershipId, input);
    res.json(OrganizationMemberSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.get("/projects", async (req, res, next) => {
  try {
    const context = await getWorkspaceContext(getAuthenticatedUserId(req));
    const payload = await listProjects(context);
    res.json(ProjectCollectionSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.post("/projects", async (req, res, next) => {
  try {
    const input = CreateProjectRequestSchema.parse(req.body);
    const context = await getWorkspaceContext(getAuthenticatedUserId(req));
    const payload = await createProject(context, input);
    res.status(201).json(ProjectSummarySchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.patch("/projects/:projectId", async (req, res, next) => {
  try {
    const projectId = OpaqueIdSchema.parse(req.params.projectId);
    const input = UpdateProjectRequestSchema.parse(req.body);
    const context = await getWorkspaceContext(getAuthenticatedUserId(req));
    const payload = await updateProject(context, projectId, input);
    res.json(ProjectSummarySchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.delete("/projects/:projectId", async (req, res, next) => {
  try {
    const projectId = OpaqueIdSchema.parse(req.params.projectId);
    const context = await getWorkspaceContext(getAuthenticatedUserId(req));
    const payload = await archiveProject(context, projectId);
    res.json(ArchiveResponseSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.get("/projects/:projectId/members", async (req, res, next) => {
  try {
    const projectId = OpaqueIdSchema.parse(req.params.projectId);
    const context = await getWorkspaceContext(getAuthenticatedUserId(req));
    const payload = await listProjectMembers(context, projectId);
    res.json(ProjectMemberCollectionSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.post("/projects/:projectId/members", async (req, res, next) => {
  try {
    const projectId = OpaqueIdSchema.parse(req.params.projectId);
    const input = UpsertProjectMemberRequestSchema.parse(req.body);
    const context = await getWorkspaceContext(getAuthenticatedUserId(req));
    const payload = await upsertProjectMember(context, projectId, input);
    res.status(201).json(ProjectMemberSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.patch("/projects/:projectId/members/:userId", async (req, res, next) => {
  try {
    const projectId = OpaqueIdSchema.parse(req.params.projectId);
    const userId = OpaqueIdSchema.parse(req.params.userId);
    const input = UpdateProjectMemberRequestSchema.parse(req.body);
    const context = await getWorkspaceContext(getAuthenticatedUserId(req));
    const payload = await updateProjectMember(context, projectId, userId, input);
    res.json(ProjectMemberSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.delete("/projects/:projectId/members/:userId", async (req, res, next) => {
  try {
    const projectId = OpaqueIdSchema.parse(req.params.projectId);
    const userId = OpaqueIdSchema.parse(req.params.userId);
    const context = await getWorkspaceContext(getAuthenticatedUserId(req));
    const payload = await removeProjectMember(context, projectId, userId);
    res.json(ArchiveResponseSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.get("/projects/:projectId/lists", async (req, res, next) => {
  try {
    const projectId = OpaqueIdSchema.parse(req.params.projectId);
    const context = await getWorkspaceContext(getAuthenticatedUserId(req));
    const payload = await listProjectLists(context, projectId);
    res.json(ListCollectionSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.post("/projects/:projectId/lists", async (req, res, next) => {
  try {
    const projectId = OpaqueIdSchema.parse(req.params.projectId);
    const input = CreateListRequestSchema.parse(req.body);
    const context = await getWorkspaceContext(getAuthenticatedUserId(req));
    const payload = await createProjectList(context, projectId, input);
    res.status(201).json(ListSummarySchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.patch("/projects/:projectId/lists/:listId", async (req, res, next) => {
  try {
    const projectId = OpaqueIdSchema.parse(req.params.projectId);
    const listId = OpaqueIdSchema.parse(req.params.listId);
    const input = UpdateListRequestSchema.parse(req.body);
    const context = await getWorkspaceContext(getAuthenticatedUserId(req));
    const payload = await updateProjectList(context, projectId, listId, input);
    res.json(ListSummarySchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.delete("/projects/:projectId/lists/:listId", async (req, res, next) => {
  try {
    const projectId = OpaqueIdSchema.parse(req.params.projectId);
    const listId = OpaqueIdSchema.parse(req.params.listId);
    const context = await getWorkspaceContext(getAuthenticatedUserId(req));
    const payload = await archiveProjectList(context, projectId, listId);
    res.json(ArchiveResponseSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.get("/projects/:projectId/statuses", async (req, res, next) => {
  try {
    const projectId = OpaqueIdSchema.parse(req.params.projectId);
    const query = CursorQuerySchema.pick({}).extend({
      listId: OpaqueIdSchema.optional()
    }).parse(req.query);
    const context = await getWorkspaceContext(getAuthenticatedUserId(req));
    const payload = await listProjectStatuses(context, projectId, query.listId ? { listId: query.listId } : {});
    res.json(TaskStatusCollectionSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.get("/projects/:projectId/tasks", async (req, res, next) => {
  try {
    const projectId = OpaqueIdSchema.parse(req.params.projectId);
    const query = CursorQuerySchema.extend({
      listId: OpaqueIdSchema.optional()
    }).parse(req.query);
    const context = await getWorkspaceContext(getAuthenticatedUserId(req));
    const payload = await listProjectTasks(context, {
      projectId,
      limit: query.limit,
      ...(query.listId ? { listId: query.listId } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {})
    });
    res.json(TaskPageSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.post("/projects/:projectId/tasks", async (req, res, next) => {
  try {
    const projectId = OpaqueIdSchema.parse(req.params.projectId);
    const input = CreateTaskRequestSchema.parse(req.body);
    const context = await getWorkspaceContext(getAuthenticatedUserId(req));
    const payload = await createTask(context, projectId, input);
    res.status(201).json(TaskSummarySchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.get("/projects/:projectId/tasks/:taskId", async (req, res, next) => {
  try {
    const projectId = OpaqueIdSchema.parse(req.params.projectId);
    const taskId = OpaqueIdSchema.parse(req.params.taskId);
    const context = await getWorkspaceContext(getAuthenticatedUserId(req));
    const payload = await getTaskDetail(context, projectId, taskId);
    res.json(TaskDetailResponseSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.patch("/projects/:projectId/tasks/:taskId", async (req, res, next) => {
  try {
    const projectId = OpaqueIdSchema.parse(req.params.projectId);
    const taskId = OpaqueIdSchema.parse(req.params.taskId);
    const input = UpdateTaskRequestSchema.parse(req.body);
    const context = await getWorkspaceContext(getAuthenticatedUserId(req));
    const payload = await updateTask(context, projectId, taskId, input);
    res.json(TaskDetailResponseSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.post("/projects/:projectId/tasks/:taskId/comments", async (req, res, next) => {
  try {
    const projectId = OpaqueIdSchema.parse(req.params.projectId);
    const taskId = OpaqueIdSchema.parse(req.params.taskId);
    const input = CreateTaskCommentRequestSchema.parse(req.body);
    const context = await getWorkspaceContext(getAuthenticatedUserId(req));
    const payload = await createTaskComment(context, projectId, taskId, input);
    res.status(201).json(TaskDetailResponseSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

