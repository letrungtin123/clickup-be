import { Router, type Router as ExpressRouter } from "express";
import { z } from "zod";

import {
  AddAllowedEmailsRequestSchema,
  AddAllowedEmailsResultSchema,
  AllowedEmailCollectionSchema,
  ClientCollectionSchema,
  CreditImportRequestSchema,
  CreditImportResultSchema,
  CreditMatrixSchema,
  CreditRuleHistorySchema,
  CustomFieldCollectionSchema,
  CustomFieldEntitySchema,
  NewCreditVersionRequestSchema,
  NotificationPreferencesSchema,
  ProcessCollectionSchema,
  ProductionMeSchema,
  ProductionMemberCollectionSchema,
  ProductionMemberSchema,
  ProductionProjectCollectionSchema,
  ProductionSettingsSchema,
  ReorderStatusesRequestSchema,
  ReplaceTransitionsRequestSchema,
  SetCreditRuleRequestSchema,
  ShiftCollectionSchema,
  StatusWorkflowSchema,
  TagCollectionSchema,
  TeamCollectionSchema,
  UpdateNotificationPreferencesRequestSchema,
  UpdateProductionMemberRequestSchema,
  UpdateProductionSettingsRequestSchema,
  UpsertClientRequestSchema,
  UpsertCustomFieldRequestSchema,
  UpsertProcessRequestSchema,
  UpsertProductionProjectRequestSchema,
  UpsertShiftRequestSchema,
  UpsertStatusRequestSchema,
  UpsertTagRequestSchema,
  UpsertTeamRequestSchema
} from "../../contracts/production-catalog.js";
import { requireSupabaseUser } from "../../middleware/auth.js";
import { handle, param } from "../work/http.js";
import {
  addAllowedEmails,
  createCreditVersion,
  getCreditHistory,
  getCreditMatrix,
  getNotificationPreferences,
  getProductionMe,
  getSettings,
  getWorkflow,
  importCredits,
  listAllowedEmails,
  listClients,
  listCustomFields,
  listMembers,
  listProcesses,
  listProjects,
  listShifts,
  listTags,
  listTeams,
  putCreditRule,
  removeAllowedEmail,
  reorderStatuses,
  replaceTransitions,
  updateMember,
  updateNotificationPreferences,
  updateSettings,
  upsertClient,
  upsertCustomField,
  upsertProcess,
  upsertProject,
  upsertShift,
  upsertStatus,
  upsertTag,
  upsertTeam
} from "./catalog.service.js";

const DayQuery = z.object({ at: z.string().optional() });
const HistoryQuery = z.object({ projectId: z.string().uuid(), processId: z.string().uuid() });
const FieldQuery = z.object({ entity: CustomFieldEntitySchema.optional() });
const EmailParam = z.string().trim().toLowerCase().email().max(254);

/**
 * Production (Photo Retouch) catalog — SPEC Phase 0–1. Every handler checks production roles
 * itself (PD-011): non-members get 404, members without the role get 403.
 */
export const createProductionRoutes = (): ExpressRouter => {
  const routes = Router();
  routes.use("/production", requireSupabaseUser);
  routes.use("/me/notification-preferences", requireSupabaseUser);

  routes.get("/production/me", handle(async (context) => ProductionMeSchema.parse(await getProductionMe(context))));

  // Members
  routes.get("/production/members", handle(async (context) => ProductionMemberCollectionSchema.parse(await listMembers(context))));
  routes.patch(
    "/production/members/:userId",
    handle(async (context, req) =>
      ProductionMemberSchema.parse(await updateMember(context, param(req, "userId"), UpdateProductionMemberRequestSchema.parse(req.body)))
    )
  );

  // Teams
  routes.get("/production/teams", handle(async (context) => TeamCollectionSchema.parse(await listTeams(context))));
  routes.post(
    "/production/teams",
    handle(async (context, req) => TeamCollectionSchema.parse(await upsertTeam(context, null, UpsertTeamRequestSchema.parse(req.body))), 201)
  );
  routes.patch(
    "/production/teams/:teamId",
    handle(async (context, req) =>
      TeamCollectionSchema.parse(await upsertTeam(context, param(req, "teamId"), UpsertTeamRequestSchema.parse(req.body)))
    )
  );

  // Clients
  routes.get("/production/clients", handle(async (context) => ClientCollectionSchema.parse(await listClients(context))));
  routes.post(
    "/production/clients",
    handle(async (context, req) => ClientCollectionSchema.parse(await upsertClient(context, null, UpsertClientRequestSchema.parse(req.body))), 201)
  );
  routes.patch(
    "/production/clients/:clientId",
    handle(async (context, req) =>
      ClientCollectionSchema.parse(await upsertClient(context, param(req, "clientId"), UpsertClientRequestSchema.parse(req.body)))
    )
  );

  // Projects
  routes.get("/production/projects", handle(async (context) => ProductionProjectCollectionSchema.parse(await listProjects(context))));
  routes.post(
    "/production/projects",
    handle(
      async (context, req) =>
        ProductionProjectCollectionSchema.parse(await upsertProject(context, null, UpsertProductionProjectRequestSchema.parse(req.body))),
      201
    )
  );
  routes.patch(
    "/production/projects/:projectId",
    handle(async (context, req) =>
      ProductionProjectCollectionSchema.parse(
        await upsertProject(context, param(req, "projectId"), UpsertProductionProjectRequestSchema.parse(req.body))
      )
    )
  );

  // Processes & shifts
  routes.get("/production/processes", handle(async (context) => ProcessCollectionSchema.parse(await listProcesses(context))));
  routes.post(
    "/production/processes",
    handle(async (context, req) => ProcessCollectionSchema.parse(await upsertProcess(context, null, UpsertProcessRequestSchema.parse(req.body))), 201)
  );
  routes.patch(
    "/production/processes/:processId",
    handle(async (context, req) =>
      ProcessCollectionSchema.parse(await upsertProcess(context, param(req, "processId"), UpsertProcessRequestSchema.parse(req.body)))
    )
  );
  routes.get("/production/shifts", handle(async (context) => ShiftCollectionSchema.parse(await listShifts(context))));
  routes.post(
    "/production/shifts",
    handle(async (context, req) => ShiftCollectionSchema.parse(await upsertShift(context, null, UpsertShiftRequestSchema.parse(req.body))), 201)
  );
  routes.patch(
    "/production/shifts/:shiftId",
    handle(async (context, req) =>
      ShiftCollectionSchema.parse(await upsertShift(context, param(req, "shiftId"), UpsertShiftRequestSchema.parse(req.body)))
    )
  );

  // Credit rules
  routes.get(
    "/production/credit-rules/matrix",
    handle(async (context, req) => CreditMatrixSchema.parse(await getCreditMatrix(context, DayQuery.parse(req.query).at)))
  );
  routes.get(
    "/production/credit-rules/history",
    handle(async (context, req) => {
      const query = HistoryQuery.parse(req.query);
      return CreditRuleHistorySchema.parse(await getCreditHistory(context, query.projectId, query.processId));
    })
  );
  routes.put(
    "/production/credit-rules",
    handle(async (context, req) => CreditRuleHistorySchema.parse(await putCreditRule(context, SetCreditRuleRequestSchema.parse(req.body))))
  );
  routes.post(
    "/production/credit-rules/versions",
    handle(async (context, req) => await createCreditVersion(context, NewCreditVersionRequestSchema.parse(req.body).effectiveFrom), 201)
  );
  routes.post(
    "/production/credit-rules/import",
    handle(async (context, req) => CreditImportResultSchema.parse(await importCredits(context, CreditImportRequestSchema.parse(req.body))))
  );

  // Status workflow
  routes.get("/production/workflow", handle(async (context) => StatusWorkflowSchema.parse(await getWorkflow(context))));
  routes.post(
    "/production/statuses",
    handle(async (context, req) => StatusWorkflowSchema.parse(await upsertStatus(context, null, UpsertStatusRequestSchema.parse(req.body))), 201)
  );
  routes.patch(
    "/production/statuses/:statusId",
    handle(async (context, req) =>
      StatusWorkflowSchema.parse(await upsertStatus(context, param(req, "statusId"), UpsertStatusRequestSchema.parse(req.body)))
    )
  );
  routes.put(
    "/production/statuses/order",
    handle(async (context, req) => StatusWorkflowSchema.parse(await reorderStatuses(context, ReorderStatusesRequestSchema.parse(req.body).ids)))
  );
  routes.put(
    "/production/transitions",
    handle(async (context, req) => StatusWorkflowSchema.parse(await replaceTransitions(context, ReplaceTransitionsRequestSchema.parse(req.body))))
  );

  // Custom fields & tags
  routes.get(
    "/production/custom-fields",
    handle(async (context, req) =>
      CustomFieldCollectionSchema.parse(await listCustomFields(context, FieldQuery.parse(req.query).entity ?? null))
    )
  );
  routes.post(
    "/production/custom-fields",
    handle(
      async (context, req) => CustomFieldCollectionSchema.parse(await upsertCustomField(context, null, UpsertCustomFieldRequestSchema.parse(req.body))),
      201
    )
  );
  routes.patch(
    "/production/custom-fields/:fieldId",
    handle(async (context, req) =>
      CustomFieldCollectionSchema.parse(await upsertCustomField(context, param(req, "fieldId"), UpsertCustomFieldRequestSchema.parse(req.body)))
    )
  );
  routes.get("/production/tags", handle(async (context) => TagCollectionSchema.parse(await listTags(context))));
  routes.post(
    "/production/tags",
    handle(async (context, req) => TagCollectionSchema.parse(await upsertTag(context, null, UpsertTagRequestSchema.parse(req.body))), 201)
  );
  routes.patch(
    "/production/tags/:tagId",
    handle(async (context, req) => TagCollectionSchema.parse(await upsertTag(context, param(req, "tagId"), UpsertTagRequestSchema.parse(req.body))))
  );

  // Settings & whitelist
  routes.get("/production/settings", handle(async (context) => ProductionSettingsSchema.parse(await getSettings(context))));
  routes.patch(
    "/production/settings",
    handle(async (context, req) => ProductionSettingsSchema.parse(await updateSettings(context, UpdateProductionSettingsRequestSchema.parse(req.body))))
  );
  routes.get("/production/allowed-emails", handle(async (context) => AllowedEmailCollectionSchema.parse(await listAllowedEmails(context))));
  routes.post(
    "/production/allowed-emails",
    handle(async (context, req) => AddAllowedEmailsResultSchema.parse(await addAllowedEmails(context, AddAllowedEmailsRequestSchema.parse(req.body).text)))
  );
  routes.delete(
    "/production/allowed-emails/:email",
    handle(async (context, req) => await removeAllowedEmail(context, EmailParam.parse(req.params.email)))
  );

  // Personal notification preferences (any signed-in user)
  routes.get("/me/notification-preferences", handle(async (context) => NotificationPreferencesSchema.parse(await getNotificationPreferences(context))));
  routes.patch(
    "/me/notification-preferences",
    handle(async (context, req) =>
      NotificationPreferencesSchema.parse(await updateNotificationPreferences(context, UpdateNotificationPreferencesRequestSchema.parse(req.body)))
    )
  );

  return routes;
};
