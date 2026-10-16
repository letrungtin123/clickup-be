import { Router, type Router as ExpressRouter } from "express";

import {
  CreateLeaveRequestSchema,
  DecideLeaveRequestSchema,
  LeaveCalendarQuerySchema,
  LeaveCalendarSchema,
  LeaveExportQuerySchema,
  LeaveRequestCollectionSchema,
  LeaveRequestSchema
} from "../../contracts/production-leave.js";
import { requireSupabaseUser } from "../../middleware/auth.js";
import { handle, param } from "./http.js";
import {
  assertLeaveDecider,
  assertLeaveExporter,
  cancelLeaveRequest,
  createLeaveRequest,
  decideLeaveRequest,
  exportLeaveAttendance,
  getLeaveCalendar,
  listMyLeave,
  listPendingLeave
} from "./leave.service.js";

/**
 * Shared leave calendar ("Lịch nghỉ", SPEC §6.3, PD-057). Every handler checks production roles itself
 * (PD-011): non-members get 404, members without the role get 403.
 */
export const createProductionLeaveRoutes = (): ExpressRouter => {
  const routes = Router();
  routes.use("/production/leave", requireSupabaseUser);

  routes.get(
    "/production/leave",
    handle(async (context, req) => LeaveCalendarSchema.parse(await getLeaveCalendar(context, LeaveCalendarQuerySchema.parse(req.query))))
  );
  // PD-057: payroll attendance workbook (ADMIN only — checked before the query, so others always get 403/404).
  routes.get(
    "/production/leave/export",
    handle(async (context, req, res) => {
      assertLeaveExporter(context);
      await exportLeaveAttendance(context, res, LeaveExportQuerySchema.parse(req.query));
    })
  );
  routes.get("/production/leave/mine", handle(async (context) => LeaveRequestCollectionSchema.parse(await listMyLeave(context))));
  routes.get("/production/leave/pending", handle(async (context) => LeaveRequestCollectionSchema.parse(await listPendingLeave(context))));
  routes.post(
    "/production/leave",
    handle(async (context, req) => LeaveRequestSchema.parse(await createLeaveRequest(context, CreateLeaveRequestSchema.parse(req.body))), 201)
  );
  routes.post(
    "/production/leave/:leaveId/cancel",
    handle(async (context, req) => LeaveRequestSchema.parse(await cancelLeaveRequest(context, param(req, "leaveId"))))
  );
  // PD-057: ADMIN only — checked before the body, so Leaders / Staff always get 403.
  routes.post(
    "/production/leave/:leaveId/decide",
    handle(async (context, req) => {
      assertLeaveDecider(context);
      return LeaveRequestSchema.parse(await decideLeaveRequest(context, param(req, "leaveId"), DecideLeaveRequestSchema.parse(req.body)));
    })
  );

  return routes;
};
