import { Router, type Router as ExpressRouter } from "express";

import {
  ApplyDefaultKpiRequestSchema,
  ApplyDefaultKpiResultSchema,
  ForecastQuerySchema,
  KpiReportQuerySchema,
  KpiReportSchema,
  KpiSettlementListSchema,
  KpiSettlementQuerySchema,
  KpiSettlementRunCollectionSchema,
  KpiSettlementRunQuerySchema,
  KpiSettlementRunResultSchema,
  KpiTargetCollectionSchema,
  KpiTargetImportRequestSchema,
  KpiTargetImportResultSchema,
  KpiTargetMatrixQuerySchema,
  KpiTargetMatrixSchema,
  MyScoresQuerySchema,
  MyScoresSchema,
  PutKpiTargetsRequestSchema,
  RunKpiSettlementRequestSchema,
  ScoreBoardQuerySchema,
  ScoreBoardSchema,
  ScoreForecastSchema,
  TaskScoresSchema
} from "../../contracts/production-scores.js";
import { requireSupabaseUser } from "../../middleware/auth.js";
import { handle, param } from "../work/http.js";
import { getKpiReport, listKpiSettlementRuns, listKpiSettlements, runKpiSettlement } from "./kpi-settlement.service.js";
import { applyDefaultKpiTargets, deleteKpiTarget, getKpiTargetMatrix, importKpiTargets, putKpiTargets } from "./kpi-targets.service.js";
import { getMyScores, getScoreBoard, getScoreForecast, getTaskScores } from "./scores.service.js";

/**
 * Production scores & KPI — SPEC Phase 3 (scores, targets) and Phase 6 (settlement, KPI report). Every handler checks production roles itself (PD-011):
 * non-members get 404, members without the role get 403.
 */
export const createProductionScoreRoutes = (): ExpressRouter => {
  const routes = Router();
  routes.use("/production", requireSupabaseUser);

  routes.get("/production/scores/me", handle(async (context, req) => MyScoresSchema.parse(await getMyScores(context, MyScoresQuerySchema.parse(req.query)))));
  routes.get(
    "/production/scores/forecast",
    handle(async (context, req) => ScoreForecastSchema.parse(await getScoreForecast(context, ForecastQuerySchema.parse(req.query))))
  );
  routes.get("/production/scores/task/:taskId", handle(async (context, req) => TaskScoresSchema.parse(await getTaskScores(context, param(req, "taskId")))));
  routes.get("/production/scores/board", handle(async (context, req) => ScoreBoardSchema.parse(await getScoreBoard(context, ScoreBoardQuerySchema.parse(req.query)))));

  // KPI targets (ADMIN)
  routes.get(
    "/production/kpi-targets",
    handle(async (context, req) => KpiTargetMatrixSchema.parse(await getKpiTargetMatrix(context, KpiTargetMatrixQuerySchema.parse(req.query))))
  );
  routes.put(
    "/production/kpi-targets",
    handle(async (context, req) => KpiTargetCollectionSchema.parse(await putKpiTargets(context, PutKpiTargetsRequestSchema.parse(req.body))))
  );
  routes.delete("/production/kpi-targets/:targetId", handle(async (context, req) => await deleteKpiTarget(context, param(req, "targetId"))));
  routes.post(
    "/production/kpi-targets/import",
    handle(async (context, req) => KpiTargetImportResultSchema.parse(await importKpiTargets(context, KpiTargetImportRequestSchema.parse(req.body))))
  );
  routes.post(
    "/production/kpi-targets/apply-defaults",
    handle(async (context, req) =>
      ApplyDefaultKpiResultSchema.parse(await applyDefaultKpiTargets(context, ApplyDefaultKpiRequestSchema.parse(req.body).period))
    )
  );

  // KPI settlement & report (Phase 6)
  routes.post(
    "/production/kpi/settlements/run",
    handle(async (context, req) => KpiSettlementRunResultSchema.parse(await runKpiSettlement(context, RunKpiSettlementRequestSchema.parse(req.body))))
  );
  routes.get(
    "/production/kpi/settlements",
    handle(async (context, req) => KpiSettlementListSchema.parse(await listKpiSettlements(context, KpiSettlementQuerySchema.parse(req.query))))
  );
  routes.get(
    "/production/kpi/settlement-runs",
    handle(async (context, req) =>
      KpiSettlementRunCollectionSchema.parse(await listKpiSettlementRuns(context, KpiSettlementRunQuerySchema.parse(req.query)))
    )
  );
  routes.get("/production/kpi/report", handle(async (context, req) => KpiReportSchema.parse(await getKpiReport(context, KpiReportQuerySchema.parse(req.query)))));

  return routes;
};
