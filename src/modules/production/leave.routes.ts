import { Router, type Router as ExpressRouter } from "express";

import {
  CreateLeaveRequestSchema,
  DecideLeaveRequestSchema,
  LeaveCalendarQuerySchema,
  LeaveCalendarSchema,
  LeaveRequestCollectionSchema,
  LeaveRequestSchema
} from "../../contracts/production-leave.js";
import { requireSupabaseUser } from "../../middleware/auth.js";
import { handle, param } from "../work/http.js";
import { cancelLeaveRequest, createLeaveRequest, decideLeaveRequest, getLeaveCalendar, listPendingLeave } from "./leave.service.js";

/**
 * Shared leave calendar ("Lịch nghỉ", SPEC §6.3). Every handler checks production roles itself
 * (PD-011): non-members get 404, members without the role get 403.
 */
export const createProductionLeaveRoutes = (): ExpressRouter => {
  const routes = Router();
  routes.use("/production/leave", requireSupabaseUser);

  routes.get(
    "/production/leave",
    handle(async (context, req) => LeaveCalendarSchema.parse(await getLeaveCalendar(context, LeaveCalendarQuerySchema.parse(req.query))))
  );
  routes.get("/production/leave/pending", handle(async (context) => LeaveRequestCollectionSchema.parse(await listPendingLeave(context))));
  routes.post(
    "/production/leave",
    handle(async (context, req) => LeaveRequestSchema.parse(await createLeaveRequest(context, CreateLeaveRequestSchema.parse(req.body))), 201)
  );
  routes.post(
    "/production/leave/:leaveId/cancel",
    handle(async (context, req) => LeaveRequestSchema.parse(await cancelLeaveRequest(context, param(req, "leaveId"))))
  );
  routes.post(
    "/production/leave/:leaveId/decide",
    handle(async (context, req) =>
      LeaveRequestSchema.parse(await decideLeaveRequest(context, param(req, "leaveId"), DecideLeaveRequestSchema.parse(req.body)))
    )
  );

  return routes;
};
