import { Router, type Router as ExpressRouter } from "express";

import { createAuthRoutes } from "./modules/auth/auth.routes.js";
import { metaRoutes } from "./modules/meta/meta.routes.js";
import { createWorkRoutes } from "./modules/work/work.routes.js";
import { workspaceRoutes } from "./modules/workspace/workspace.routes.js";

export const createApiRoutes = (): ExpressRouter => {
  const apiRoutes = Router();

  apiRoutes.use(createAuthRoutes());
  apiRoutes.use(metaRoutes);
  apiRoutes.use(workspaceRoutes);
  apiRoutes.use(createWorkRoutes());
  // Chat routes are mounted here by the chat module (createChatRoutes).

  return apiRoutes;
};
