import { Router, type Router as ExpressRouter } from "express";

import {
  CreateListRequestSchema,
  CreateProjectRequestSchema,
  ListSchema,
  ProjectCollectionSchema,
  ProjectMemberCollectionSchema,
  ProjectMemberSchema,
  ProjectSchema,
  UpdateListRequestSchema,
  UpdateProjectMemberRequestSchema,
  UpdateProjectRequestSchema,
  UpsertProjectMemberRequestSchema
} from "../../contracts/work.js";
import { requireSupabaseUser } from "../../middleware/auth.js";
import { handle, param } from "./http.js";
import {
  archiveList,
  archiveProject,
  createList,
  createProject,
  getProject,
  listProjectMembers,
  listProjects,
  removeProjectMember,
  updateList,
  updateProject,
  upsertProjectMember
} from "./projects.service.js";

export const createWorkRoutes = (): ExpressRouter => {
  const routes = Router();
  routes.use(requireSupabaseUser);

  // Projects
  routes.get("/projects", handle(async (context) => ProjectCollectionSchema.parse(await listProjects(context))));
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
        await upsertProjectMember(context, param(req, "projectId"), {
          userId: param(req, "userId"),
          ...UpdateProjectMemberRequestSchema.parse(req.body)
        })
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

  return routes;
};
