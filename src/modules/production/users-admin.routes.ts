import { Router, type Router as ExpressRouter } from "express";

import {
  CreatedProductionUserSchema,
  CreateProductionUserRequestSchema,
  LedJobsSchema,
  ProductionUserChangeResultSchema,
  ProductionUserPasswordResetSchema,
  UpdateProductionUserRequestSchema
} from "../../contracts/users-admin.js";
import { requireSupabaseUser } from "../../middleware/auth.js";
import { assertProductionAdmin } from "./access.js";
import { handle, param } from "./http.js";
import {
  createProductionUser,
  getLedJobs,
  resetProductionUserPassword,
  setProductionUserActive,
  updateProductionUser
} from "./users-admin.service.js";

/**
 * Production user administration (SPEC Phase 0 /admin/users, PD-024; contract in contracts/users-admin.ts).
 * The production role is checked before the body is validated (non-members 404, others 403).
 */
export const createProductionUserAdminRoutes = (): ExpressRouter => {
  const routes = Router();
  routes.use("/production/users", requireSupabaseUser);

  routes.post(
    "/production/users",
    handle(async (context, req, res) => {
      assertProductionAdmin(context); // before the body is validated (no schema hints for non-admins)
      res.setHeader("cache-control", "no-store");
      return CreatedProductionUserSchema.parse(await createProductionUser(context, CreateProductionUserRequestSchema.parse(req.body)));
    }, 201)
  );
  routes.patch(
    "/production/users/:userId",
    handle(async (context, req) => {
      assertProductionAdmin(context);
      return ProductionUserChangeResultSchema.parse(
        await updateProductionUser(context, param(req, "userId"), UpdateProductionUserRequestSchema.parse(req.body))
      );
    })
  );
  routes.post(
    "/production/users/:userId/deactivate",
    handle(async (context, req) => ProductionUserChangeResultSchema.parse(await setProductionUserActive(context, param(req, "userId"), false)))
  );
  routes.post(
    "/production/users/:userId/activate",
    handle(async (context, req) => ProductionUserChangeResultSchema.parse(await setProductionUserActive(context, param(req, "userId"), true)))
  );
  routes.post(
    "/production/users/:userId/reset-password",
    handle(async (context, req, res) => {
      res.setHeader("cache-control", "no-store");
      return ProductionUserPasswordResetSchema.parse(await resetProductionUserPassword(context, param(req, "userId")));
    })
  );
  routes.get(
    "/production/users/:userId/led-jobs",
    handle(async (context, req) => LedJobsSchema.parse(await getLedJobs(context, param(req, "userId"))))
  );

  return routes;
};
