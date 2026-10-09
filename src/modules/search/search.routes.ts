import { Router, type Router as ExpressRouter } from "express";

import { GlobalSearchQuerySchema, GlobalSearchResultSchema, TrashPageSchema, TrashQuerySchema } from "../../contracts/search.js";
import { TaskSummarySchema } from "../../contracts/work.js";
import { requireSupabaseUser } from "../../middleware/auth.js";
import { handle, param } from "../work/http.js";
import { listTrash, purgeTask, restoreTask } from "../work/trash.service.js";
import { globalSearch } from "./search.service.js";

export const createSearchRoutes = (): ExpressRouter => {
  const routes = Router();
  routes.use(["/search", "/trash"], requireSupabaseUser);

  routes.get("/search", handle(async (context, req) => GlobalSearchResultSchema.parse(await globalSearch(context, GlobalSearchQuerySchema.parse(req.query)))));
  routes.get("/trash/tasks", handle(async (context, req) => TrashPageSchema.parse(await listTrash(context, TrashQuerySchema.parse(req.query)))));
  routes.post("/trash/tasks/:taskId/restore", handle(async (context, req) => TaskSummarySchema.parse(await restoreTask(context, param(req, "taskId")))));
  routes.delete("/trash/tasks/:taskId", handle(async (context, req) => await purgeTask(context, param(req, "taskId"))));

  return routes;
};
