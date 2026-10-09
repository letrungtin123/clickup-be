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
  CreditVersionResultSchema,
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
  ReorderCatalogRequestSchema,
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
import { AppError } from "../../lib/app-error.js";
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
  removeCreditVersion,
  reorderCatalog,
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
/**
 * PATCH is a partial update: fields absent from the body keep their current values (read from the
 * current record), so archiving or renaming never needs the whole object. `keepUnsent` fields are not
 * copied (e.g. custom values, so required-field checks only run when values are actually sent).
 */
const patchBody = <S extends z.ZodObject>(schema: S, current: object | undefined, body: unknown, keepUnsent: string[] = []): z.infer<S> => {
  if (!current) {
    throw new AppError("NOT_FOUND", "Không tìm thấy.", 404);
  }
  const sent = new Set(body && typeof body === "object" ? Object.keys(body) : []);
  const patch = schema.partial().parse(body ?? {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = {};
  for (const key of Object.keys(schema.shape)) {
    const value = (current as Record<string, unknown>)[key];
    if (!keepUnsent.includes(key) && value !== undefined) {
      merged[key] = value;
    }
  }
  for (const key of sent) {
    merged[key] = patch[key];
  }
  return schema.parse(merged);
};
const byId = <T extends { id: string }>(items: T[], id: string) => items.find((item) => item.id === id);

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
      TeamCollectionSchema.parse(
        await upsertTeam(context, param(req, "teamId"), patchBody(UpsertTeamRequestSchema, byId((await listTeams(context)).items, param(req, "teamId")), req.body))
      )
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
      ClientCollectionSchema.parse(
        await upsertClient(
          context,
          param(req, "clientId"),
          patchBody(UpsertClientRequestSchema, byId((await listClients(context)).items, param(req, "clientId")), req.body, ["customValues", "tagIds"])
        )
      )
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
        await upsertProject(
          context,
          param(req, "projectId"),
          patchBody(UpsertProductionProjectRequestSchema, byId((await listProjects(context)).items, param(req, "projectId")), req.body)
        )
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
      ProcessCollectionSchema.parse(
        await upsertProcess(context, param(req, "processId"), patchBody(UpsertProcessRequestSchema, byId((await listProcesses(context)).items, param(req, "processId")), req.body))
      )
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
      ShiftCollectionSchema.parse(
        await upsertShift(context, param(req, "shiftId"), patchBody(UpsertShiftRequestSchema, byId((await listShifts(context)).items, param(req, "shiftId")), req.body))
      )
    )
  );

  for (const [segment, kind] of [
    ["processes", "processes"],
    ["shifts", "shifts"],
    ["custom-fields", "customFields"]
  ] as const) {
    routes.put(
      `/production/${segment}/order`,
      handle(async (context, req) => {
        await reorderCatalog(context, kind, ReorderCatalogRequestSchema.parse(req.body).ids);
        return { ok: true as const };
      })
    );
  }

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
    handle(async (context, req) => CreditVersionResultSchema.parse(await createCreditVersion(context, NewCreditVersionRequestSchema.parse(req.body).effectiveFrom)), 201)
  );
  routes.delete(
    "/production/credit-rules/:ruleId",
    handle(async (context, req) => CreditRuleHistorySchema.parse(await removeCreditVersion(context, param(req, "ruleId"))))
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
      StatusWorkflowSchema.parse(
        await upsertStatus(context, param(req, "statusId"), patchBody(UpsertStatusRequestSchema, byId((await getWorkflow(context)).statuses, param(req, "statusId")), req.body))
      )
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
      CustomFieldCollectionSchema.parse(
        await upsertCustomField(
          context,
          param(req, "fieldId"),
          patchBody(UpsertCustomFieldRequestSchema, byId((await listCustomFields(context, null)).items, param(req, "fieldId")), req.body)
        )
      )
    )
  );
  routes.get("/production/tags", handle(async (context) => TagCollectionSchema.parse(await listTags(context))));
  routes.post(
    "/production/tags",
    handle(async (context, req) => TagCollectionSchema.parse(await upsertTag(context, null, UpsertTagRequestSchema.parse(req.body))), 201)
  );
  routes.patch(
    "/production/tags/:tagId",
    handle(async (context, req) =>
      TagCollectionSchema.parse(await upsertTag(context, param(req, "tagId"), patchBody(UpsertTagRequestSchema, byId((await listTags(context)).items, param(req, "tagId")), req.body)))
    )
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
