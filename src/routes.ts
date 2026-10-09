import { Router, type Router as ExpressRouter } from "express";

import { authRoutes } from "./modules/auth/auth.routes.js";
import { metaRoutes } from "./modules/meta/meta.routes.js";
import { workspaceRoutes } from "./modules/workspace/workspace.routes.js";

export const apiRoutes: ExpressRouter = Router();

apiRoutes.use(authRoutes);
apiRoutes.use(metaRoutes);
apiRoutes.use(workspaceRoutes);
