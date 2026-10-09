import { z } from "zod";

import { colorTokens } from "./work.js";

/**
 * Production (Photo Retouch) catalog contract — docs/retouch/SPEC.md Phase 0–1. Shared FE/BE.
 * Money is VND integers; credits are decimals with 2 places (sent as numbers).
 */

const Id = z.string().uuid();
const IsoDate = z.string().datetime({ offset: true });
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const Color = z.enum(colorTokens);

export const productionRoleCodes = ["ADMIN", "ACCOUNT", "LEADER", "QC", "STAFF"] as const;
export const ProductionRoleSchema = z.enum(productionRoleCodes);
export type ProductionRole = z.infer<typeof ProductionRoleSchema>;

export const customFieldEntities = ["JOB", "TASK", "USER", "CLIENT"] as const;
export const CustomFieldEntitySchema = z.enum(customFieldEntities);
export type CustomFieldEntity = z.infer<typeof CustomFieldEntitySchema>;

export const CustomValuesSchema = z.record(z.string(), z.union([z.string(), z.number(), z.array(z.string()), z.null()]));
export type CustomValues = z.infer<typeof CustomValuesSchema>;

// Members -----------------------------------------------------------------------------------------

export const ProductionMemberSchema = z.object({
  userId: Id,
  displayName: z.string(),
  email: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  roles: z.array(ProductionRoleSchema),
  teamId: Id.nullable(),
  active: z.boolean(),
  customValues: CustomValuesSchema,
  tagIds: z.array(Id)
});
export type ProductionMember = z.infer<typeof ProductionMemberSchema>;
export const ProductionMemberCollectionSchema = z.object({ items: z.array(ProductionMemberSchema) });

export const UpdateProductionMemberRequestSchema = z
  .object({
    roles: z.array(ProductionRoleSchema).max(5).optional(),
    teamId: Id.nullable().optional(),
    customValues: CustomValuesSchema.optional(),
    tagIds: z.array(Id).max(50).optional()
  })
  .strict();

/** What the signed-in user is in the production module (drives menus; the API enforces). */
export const ProductionMeSchema = z.object({
  roles: z.array(ProductionRoleSchema),
  isAdmin: z.boolean(),
  teamId: Id.nullable(),
  settings: z.object({
    kpiCloseDay: z.number().int(),
    scoresPublic: z.boolean(),
    moneyPublic: z.boolean(),
    chatAttachmentsEnabled: z.boolean(),
    timezone: z.string()
  })
});
export type ProductionMe = z.infer<typeof ProductionMeSchema>;

// Teams, clients, projects, processes, shifts -----------------------------------------------------

export const TeamSchema = z.object({ id: Id, name: z.string(), active: z.boolean(), memberCount: z.number().int() });
export const TeamCollectionSchema = z.object({ items: z.array(TeamSchema) });
export const UpsertTeamRequestSchema = z.object({ name: z.string().trim().min(1).max(120), active: z.boolean().optional() }).strict();

export const ClientSchema = z.object({
  id: Id,
  name: z.string(),
  note: z.string().nullable(),
  active: z.boolean(),
  customValues: CustomValuesSchema,
  tagIds: z.array(Id),
  projectCount: z.number().int()
});
export const ClientCollectionSchema = z.object({ items: z.array(ClientSchema) });
export const UpsertClientRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    note: z.string().trim().max(2000).nullable().optional(),
    active: z.boolean().optional(),
    customValues: CustomValuesSchema.optional(),
    tagIds: z.array(Id).max(50).optional()
  })
  .strict();

export const ProductionProjectSchema = z.object({
  id: Id,
  code: z.string(),
  name: z.string(),
  clientId: Id.nullable(),
  clientName: z.string().nullable(),
  qcBufferHours: z.number().int(),
  active: z.boolean()
});
export type ProductionProject = z.infer<typeof ProductionProjectSchema>;
export const ProductionProjectCollectionSchema = z.object({ items: z.array(ProductionProjectSchema) });
export const UpsertProductionProjectRequestSchema = z
  .object({
    code: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1).max(160),
    clientId: Id.nullable().optional(),
    qcBufferHours: z.number().int().min(0).max(720).optional(),
    active: z.boolean().optional()
  })
  .strict();

export const ProcessSchema = z.object({ id: Id, name: z.string(), isQc: z.boolean(), sortOrder: z.number().int(), active: z.boolean() });
export type Process = z.infer<typeof ProcessSchema>;
export const ProcessCollectionSchema = z.object({ items: z.array(ProcessSchema) });
export const UpsertProcessRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    isQc: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    active: z.boolean().optional()
  })
  .strict();

export const PayModeSchema = z.enum(["POINTS", "MONEY_IF_KPI"]);
export type PayMode = z.infer<typeof PayModeSchema>;
export const ShiftSchema = z.object({
  id: Id,
  name: z.string(),
  payMode: PayModeSchema,
  requiresOtHours: z.boolean(),
  sortOrder: z.number().int(),
  active: z.boolean()
});
export type Shift = z.infer<typeof ShiftSchema>;
export const ShiftCollectionSchema = z.object({ items: z.array(ShiftSchema) });
export const UpsertShiftRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    payMode: PayModeSchema,
    requiresOtHours: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    active: z.boolean().optional()
  })
  .strict();

// Credit rules ------------------------------------------------------------------------------------

export const CreditRuleSchema = z.object({
  id: Id,
  projectId: Id,
  processId: Id,
  creditPerImage: z.number(),
  moneyPerImage: z.number().int().nullable(),
  effectiveFrom: DateOnly,
  effectiveTo: DateOnly.nullable()
});
export type CreditRule = z.infer<typeof CreditRuleSchema>;

/** Matrix of rules effective on `at` (projects × processes), plus version history per cell on demand. */
export const CreditMatrixSchema = z.object({
  at: DateOnly,
  projects: z.array(ProductionProjectSchema),
  processes: z.array(ProcessSchema),
  rules: z.array(CreditRuleSchema)
});
export type CreditMatrix = z.infer<typeof CreditMatrixSchema>;

export const CreditRuleHistorySchema = z.object({ items: z.array(CreditRuleSchema) });

export const SetCreditRuleRequestSchema = z
  .object({
    projectId: Id,
    processId: Id,
    creditPerImage: z.number().min(0).max(99_999_999.99),
    moneyPerImage: z.number().int().min(0).max(1_000_000_000).nullable(),
    /** New version starts on this day (VN calendar day); the previous version ends the day before. */
    effectiveFrom: DateOnly
  })
  .strict();

export const NewCreditVersionRequestSchema = z.object({ effectiveFrom: DateOnly }).strict();

export const CreditImportRequestSchema = z
  .object({
    csv: z.string().min(1).max(2_000_000),
    effectiveFrom: DateOnly,
    /** Create unknown project codes / process names instead of rejecting the rows. */
    createMissing: z.boolean().default(false)
  })
  .strict();

export const CreditImportResultSchema = z.object({
  ok: z.boolean(),
  imported: z.number().int(),
  createdProjects: z.array(z.string()),
  createdProcesses: z.array(z.string()),
  errors: z.array(z.object({ line: z.number().int(), message: z.string() }))
});
export type CreditImportResult = z.infer<typeof CreditImportResultSchema>;

// Statuses & transitions --------------------------------------------------------------------------

export const ProductionStatusSchema = z.object({
  id: Id,
  code: z.string(),
  name: z.string(),
  color: Color,
  sortOrder: z.number().int(),
  countsDone: z.boolean(),
  countsChecked: z.boolean(),
  isTerminal: z.boolean(),
  isInitial: z.boolean(),
  setByRoles: z.array(ProductionRoleSchema),
  active: z.boolean()
});
export type ProductionStatus = z.infer<typeof ProductionStatusSchema>;

export const transitionActors = ["ASSIGNEE", "QC", "JOB_LEADER", "ACCOUNT", "LEADER", "SYSTEM"] as const;
export const TransitionActorSchema = z.enum(transitionActors);
export type TransitionActor = z.infer<typeof TransitionActorSchema>;

export const StatusTransitionSchema = z.object({
  id: Id,
  fromStatusId: Id,
  toStatusId: Id,
  actors: z.array(TransitionActorSchema),
  requiresNote: z.boolean()
});
export type StatusTransition = z.infer<typeof StatusTransitionSchema>;

export const StatusWorkflowSchema = z.object({
  statuses: z.array(ProductionStatusSchema),
  transitions: z.array(StatusTransitionSchema)
});
export type ProductionWorkflow = z.infer<typeof StatusWorkflowSchema>;

export const UpsertStatusRequestSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,39}$/),
    name: z.string().trim().min(1).max(80),
    color: Color,
    countsDone: z.boolean().default(false),
    countsChecked: z.boolean().default(false),
    isTerminal: z.boolean().default(false),
    setByRoles: z.array(ProductionRoleSchema).max(5).default([]),
    active: z.boolean().optional()
  })
  .strict();

export const ReorderStatusesRequestSchema = z.object({ ids: z.array(Id).min(1).max(100) }).strict();

export const ReplaceTransitionsRequestSchema = z
  .object({
    transitions: z
      .array(
        z
          .object({
            fromStatusId: Id,
            toStatusId: Id,
            actors: z.array(TransitionActorSchema).min(1).max(6),
            requiresNote: z.boolean().default(false)
          })
          .strict()
      )
      .max(200)
  })
  .strict();

// Custom fields & tags ----------------------------------------------------------------------------

export const CustomFieldTypeSchema = z.enum(["TEXT", "NUMBER", "DATE", "SELECT", "MULTISELECT"]);
export const CustomFieldOptionSchema = z.object({
  value: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  color: Color.optional()
});

export const CustomFieldSchema = z.object({
  id: Id,
  entity: CustomFieldEntitySchema,
  key: z.string(),
  label: z.string(),
  type: CustomFieldTypeSchema,
  options: z.array(CustomFieldOptionSchema),
  required: z.boolean(),
  showInTable: z.boolean(),
  sortOrder: z.number().int(),
  active: z.boolean()
});
export type CustomField = z.infer<typeof CustomFieldSchema>;
export const CustomFieldCollectionSchema = z.object({ items: z.array(CustomFieldSchema) });
export const UpsertCustomFieldRequestSchema = z
  .object({
    entity: CustomFieldEntitySchema,
    key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/, "Use lowercase letters, digits and _."),
    label: z.string().trim().min(1).max(120),
    type: CustomFieldTypeSchema,
    options: z.array(CustomFieldOptionSchema).max(200).default([]),
    required: z.boolean().default(false),
    showInTable: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
    active: z.boolean().optional()
  })
  .strict();

export const TagSchema = z.object({ id: Id, name: z.string(), color: Color, active: z.boolean() });
export const TagCollectionSchema = z.object({ items: z.array(TagSchema) });
export const UpsertTagRequestSchema = z
  .object({ name: z.string().trim().min(1).max(60), color: Color.default("slate"), active: z.boolean().optional() })
  .strict();

// Settings & whitelist ----------------------------------------------------------------------------

export const ProductionSettingsSchema = z.object({
  kpiCloseDay: z.number().int().min(1).max(28),
  scoresPublic: z.boolean(),
  moneyPublic: z.boolean(),
  kpiProrateLeave: z.boolean(),
  anomalyFailRate: z.number().min(0).max(1),
  dueSoonHours: z.number().int().min(1).max(72),
  kpiDefaultMember: z.number().min(0).max(1_000_000),
  kpiDefaultLeader: z.number().min(0).max(1_000_000),
  chatAttachmentsEnabled: z.boolean(),
  timezone: z.string()
});
export type ProductionSettings = z.infer<typeof ProductionSettingsSchema>;
export const UpdateProductionSettingsRequestSchema = ProductionSettingsSchema.omit({ timezone: true }).partial().strict();

export const AllowedEmailSchema = z.object({ email: z.string(), addedBy: z.string().nullable(), createdAt: IsoDate });
export const AllowedEmailCollectionSchema = z.object({ items: z.array(AllowedEmailSchema) });
export const AddAllowedEmailsRequestSchema = z
  .object({
    /** Free text pasted from a spreadsheet: emails separated by commas, semicolons, spaces or new lines. */
    text: z.string().min(3).max(200_000)
  })
  .strict();
export const AddAllowedEmailsResultSchema = z.object({
  added: z.array(z.string()),
  alreadyAllowed: z.array(z.string()),
  invalid: z.array(z.string())
});

export const NotificationPreferencesSchema = z.object({ notifyWeb: z.boolean(), notifyEmail: z.boolean() });
export const UpdateNotificationPreferencesRequestSchema = NotificationPreferencesSchema.partial().strict();
