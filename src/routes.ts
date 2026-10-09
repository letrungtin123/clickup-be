import { Router, type Router as ExpressRouter } from "express";

import { createAuthRoutes } from "./modules/auth/auth.routes.js";
import { metaRoutes } from "./modules/meta/meta.routes.js";
import { workspaceRoutes } from "./modules/workspace/workspace.routes.js";

export const createApiRoutes = (): ExpressRouter => {
  const apiRoutes = Router();

  apiRoutes.use(createAuthRoutes());
  apiRoutes.use(metaRoutes);
  apiRoutes.use(workspaceRoutes);

  return apiRoutes;
};
