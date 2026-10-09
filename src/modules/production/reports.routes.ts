import { Router, type Router as ExpressRouter } from "express";

import { JobQuerySchema } from "../../contracts/production-jobs.js";
import {
  AdminDashboardSchema,
  AnomalyListSchema,
  AnomalyQuerySchema,
  AnomalyReviewResultSchema,
  CreateSavedReportRequestSchema,
  LeaderDashboardQuerySchema,
  LeaderDashboardSchema,
  ReportConfigSchema,
  ReportExportRequestSchema,
  ReportResultSchema,
  ReviewAnomalyRequestSchema,
  SavedReportCollectionSchema,
  SavedReportSchema,
  UnreviewAnomalyRequestSchema,
  UpdateSavedReportRequestSchema
} from "../../contracts/production-reports.js";
import { KpiReportQuerySchema, ScoreBoardQuerySchema } from "../../contracts/production-scores.js";
import { requireSupabaseUser } from "../../middleware/auth.js";
import { handle, param } from "../work/http.js";
import { listAnomalies, reviewAnomaly, unreviewAnomaly } from "./anomalies.service.js";
import { getAdminDashboard, getLeaderDashboard } from "./dashboards.service.js";
import { exportJobs, exportKpi, exportReport, exportScoreBoard } from "./exports.service.js";
import { runReport } from "./reports.js";
import { createSavedReport, deleteSavedReport, getSavedReport, listSavedReports, updateSavedReport } from "./saved-reports.service.js";

/**
 * Production reports — SPEC Phase 5: report builder (query, saved reports, Excel), Leader / Admin
 * dashboards, anomalies, and the Excel exports of the job list, score board and KPI. Every handler
 * checks production roles itself (PD-011). Mounted before the job routes so /production/jobs/export
 * is not taken for a job id.
 */
export const createProductionReportRoutes = (): ExpressRouter => {
  const routes = Router();
  routes.use("/production", requireSupabaseUser);

  // Report builder
  routes.post(
    "/production/reports/query",
    handle(async (context, req) => ReportResultSchema.parse(await runReport(context, ReportConfigSchema.parse(req.body))))
  );
  routes.post(
    "/production/reports/export",
    handle(async (context, req, res) => {
      const input = ReportExportRequestSchema.parse(req.body);
      await exportReport(context, res, input);
    })
  );
  routes.get("/production/reports/saved", handle(async (context) => SavedReportCollectionSchema.parse(await listSavedReports(context))));
  routes.post(
    "/production/reports/saved",
    handle(async (context, req) => SavedReportSchema.parse(await createSavedReport(context, CreateSavedReportRequestSchema.parse(req.body))), 201)
  );
  routes.get(
    "/production/reports/saved/:reportId",
    handle(async (context, req) => SavedReportSchema.parse(await getSavedReport(context, param(req, "reportId"))))
  );
  routes.patch(
    "/production/reports/saved/:reportId",
    handle(async (context, req) =>
      SavedReportSchema.parse(await updateSavedReport(context, param(req, "reportId"), UpdateSavedReportRequestSchema.parse(req.body)))
    )
  );
  routes.delete("/production/reports/saved/:reportId", handle(async (context, req) => await deleteSavedReport(context, param(req, "reportId"))));

  // Dashboards
  routes.get(
    "/production/dashboard/leader",
    handle(async (context, req) => LeaderDashboardSchema.parse(await getLeaderDashboard(context, LeaderDashboardQuerySchema.parse(req.query))))
  );
  routes.get("/production/dashboard/admin", handle(async (context) => AdminDashboardSchema.parse(await getAdminDashboard(context))));

  // Anomalies
  routes.get("/production/anomalies", handle(async (context, req) => AnomalyListSchema.parse(await listAnomalies(context, AnomalyQuerySchema.parse(req.query)))));
  routes.post(
    "/production/anomalies/review",
    handle(async (context, req) => AnomalyReviewResultSchema.parse(await reviewAnomaly(context, ReviewAnomalyRequestSchema.parse(req.body))))
  );
  routes.delete(
    "/production/anomalies/reviews",
    handle(async (context, req) => AnomalyReviewResultSchema.parse(await unreviewAnomaly(context, UnreviewAnomalyRequestSchema.parse(req.query))))
  );

  // Excel exports of other screens (same filters and visibility as the screens)
  routes.get(
    "/production/jobs/export",
    handle(async (context, req, res) => {
      await exportJobs(context, res, JobQuerySchema.parse(req.query));
    })
  );
  routes.get(
    "/production/scores/board/export",
    handle(async (context, req, res) => {
      await exportScoreBoard(context, res, ScoreBoardQuerySchema.parse(req.query));
    })
  );
  routes.get(
    "/production/kpi/export",
    handle(async (context, req, res) => {
      await exportKpi(context, res, KpiReportQuerySchema.parse(req.query));
    })
  );

  return routes;
};
