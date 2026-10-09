import { Router, type Router as ExpressRouter } from "express";

import { createAuthRoutes } from "./modules/auth/auth.routes.js";
import { createChatRoutes } from "./modules/chat/chat.routes.js";
import { metaRoutes } from "./modules/meta/meta.routes.js";
import { createNotificationRoutes } from "./modules/notifications/notifications.routes.js";
import { createProductionRoutes } from "./modules/production/production.routes.js";
import { createSearchRoutes } from "./modules/search/search.routes.js";
import { createWorkRoutes } from "./modules/work/work.routes.js";
import { workspaceRoutes } from "./modules/workspace/workspace.routes.js";

export const createApiRoutes = (): ExpressRouter => {
  const apiRoutes = Router();

  apiRoutes.use(createAuthRoutes());
  apiRoutes.use(metaRoutes);
  apiRoutes.use(workspaceRoutes);
  apiRoutes.use(createWorkRoutes());
  apiRoutes.use(createNotificationRoutes());
  apiRoutes.use(createSearchRoutes());
  // Chat routes are mounted here by the chat module (createChatRoutes).
  apiRoutes.use(createChatRoutes());
  apiRoutes.use(createProductionRoutes());

  return apiRoutes;
};
