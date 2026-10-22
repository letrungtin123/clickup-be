import type { RequestHandler } from "express";

import { MyOverviewQuerySchema, MyOverviewSchema } from "../../contracts/production-my-overview.js";
import { handle } from "./http.js";
import { getMyOverview } from "./my-overview.service.js";

/**
 * GET /production/my-overview — "Tổng quan của tôi" (PD-081). Registered in production.routes.ts (behind
 * requireSupabaseUser); any production member, for their own work.
 */
export const myOverviewHandler: RequestHandler = handle(async (context, req) =>
  MyOverviewSchema.parse(await getMyOverview(context, MyOverviewQuerySchema.parse(req.query)))
);
