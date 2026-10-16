import { z } from "zod";

import { DepartmentSchema } from "./departments.js";
import { colorTokens, UserRefSchema } from "./work.js";

/**
 * Production (Photo Retouch) catalog contract — docs/retouch/SPEC.md Phase 0–1. Shared FE/BE.
 * Money is VND integers; credits are decimals with 2 places (sent as numbers).
 */

const Id = z.string().uuid();
const IsoDate = z.string().datetime({ offset: true });
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const Color = z.enum(colorTokens);

// Request inputs (PR-16) ----------------------------------------------------------------------------

/** PostgreSQL text and jsonb cannot store U+0000. */
export const hasNoNul = (value: string) => !value.includes("\u0000");
/**
 * Free text from a request: a NUL character is rejected here (400) instead of failing in the database (500).
 * Chain the usual checks after it: `SafeText().trim().min(1).max(120)`.
 */
export const SafeText = () => z.string().refine(hasNoNul, "Không được chứa ký tự NUL.");

/** A real calendar instant the database accepts (years 1900–2999, no rolled-over days such as 31/02). */
export const isAcceptedInstant = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T/.exec(value);
  if (!match) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && year <= 2999 && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};
/** Instant from a request: ISO 8601 with an offset, within isAcceptedInstant. */
export const IsoDateInputSchema = z.string().datetime({ offset: true }).refine(isAcceptedInstant, "Thời điểm không hợp lệ.");

/**
 * Production roles (PD-011). DIRECTOR ("Director", PD-065) is the company director: by default the only role with
 * "Quản trị số liệu" and "Bất thường", and it sees every job; it has no Quản trị (ADMIN) power otherwise. The
 * organization superadmin holds ADMIN and DIRECTOR implicitly.
 */
export const productionRoleCodes = ["ADMIN", "ACCOUNT", "LEADER", "QC", "STAFF", "DIRECTOR"] as const;
export const ProductionRoleSchema = z.enum(productionRoleCodes);
export type ProductionRole = z.infer<typeof ProductionRoleSchema>;

/** Known production role codes of a list, de-duplicated, in the stable order of `productionRoleCodes`. */
export const sortProductionRoles = (roles: Iterable<string>): ProductionRole[] => {
  const given = new Set(roles);
  return productionRoleCodes.filter((code) => given.has(code));
};

export const customFieldEntities = ["JOB", "TASK", "USER", "CLIENT"] as const;
export const CustomFieldEntitySchema = z.enum(customFieldEntities);
export type CustomFieldEntity = z.infer<typeof CustomFieldEntitySchema>;

export const CustomValuesSchema = z.record(SafeText(), z.union([SafeText(), z.number(), z.array(SafeText()), z.null()]));
export type CustomValues = z.infer<typeof CustomValuesSchema>;

// Custom-field & tag filters of list endpoints (PLAN §8 "trường hiện trong form, bảng và bộ lọc") -----------

/** Key of an admin-defined custom field. */
export const customFieldKeyPattern = /^[a-z][a-z0-9_]{0,39}$/;
/** Filter value meaning "the field has no value". */
export const customFieldEmptyValue = "__empty__";

/**
 * One custom-field filter. In a query string: `cf.<key>=<value>` (repeat the parameter for several values),
 * `cf.<key>.from=<v>` / `cf.<key>.to=<v>` for NUMBER / DATE ranges (inclusive). The key must be an active
 * field of the list's entity (400 CUSTOM_FIELD_FILTER_INVALID otherwise). Semantics by field type:
 *  - SELECT: one of the values; MULTISELECT: contains at least one of the values;
 *  - TEXT: contains one of the values (case and accent insensitive);
 *  - NUMBER / DATE (YYYY-MM-DD): equals one of the values and/or within [from, to].
 * `__empty__` as a value matches records without a value for the field. Several filters combine with AND.
 */
export const CustomFieldFilterSchema = z
  .object({
    key: z.string().regex(customFieldKeyPattern, "Trường lọc không hợp lệ."),
    values: z.array(SafeText().trim().min(1).max(200)).max(50).default([]),
    from: SafeText().trim().min(1).max(40).optional(),
    to: SafeText().trim().min(1).max(40).optional()
  })
  .strict()
  .refine((filter) => filter.values.length > 0 || filter.from !== undefined || filter.to !== undefined, "Bộ lọc trường tuỳ biến cần giá trị.");
export type CustomFieldFilter = z.infer<typeof CustomFieldFilterSchema>;
export const CustomFieldFiltersSchema = z.array(CustomFieldFilterSchema).max(10).default([]);

const queryValues = (value: unknown): string[] =>
  value === undefined || value === null ? [] : (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === "string");

/**
 * Turns the `cf.<key>[.from|.to]` parameters of a parsed query string into `cf: CustomFieldFilter[]` (other
 * parameters are kept as they are). Use before parsing a list query schema: `JobQuerySchema.parse(withCustomFieldFilters(req.query))`.
 */
export const withCustomFieldFilters = (query: Record<string, unknown>): Record<string, unknown> => {
  const rest: Record<string, unknown> = {};
  const filters = new Map<string, { key: string; values: string[]; from?: string; to?: string }>();
  for (const [name, value] of Object.entries(query)) {
    const match = /^cf\.([^.]+)(?:\.(from|to))?$/.exec(name);
    if (!match) {
      rest[name] = value;
      continue;
    }
    const key = match[1]!;
    const filter = filters.get(key) ?? { key, values: [] };
    const values = queryValues(value);
    if (match[2] === "from" || match[2] === "to") {
      if (values[0] !== undefined) {
        filter[match[2]] = values[0];
      }
    } else {
      filter.values.push(...values);
    }
    filters.set(key, filter);
  }
  return filters.size > 0 ? { ...rest, cf: [...filters.values()] } : rest;
};

/** A uuid list in a query string: `tagId=a&tagId=b` (a single value is accepted too). Any of them matches. */
export const IdListQuerySchema = z.preprocess(
  (value) => (value === undefined || value === "" ? undefined : Array.isArray(value) ? value : [value]),
  z.array(z.string().uuid()).min(1).max(50).optional()
);

// KPI close day history (G15) ---------------------------------------------------------------------------

/**
 * Close day 31 = "Cuối tháng" (PD-032): the period closes on the last day of each month (28/29 in February, 30 or 31
 * otherwise), so a period "MM/YYYY" is exactly that calendar month. Every other close day is 1–28 (PD-016).
 */
export const kpiCloseDayEndOfMonth = 31;

/** A valid KPI close day: 1–28, or 31 = "Cuối tháng". */
export const isKpiCloseDay = (day: number) => Number.isInteger(day) && ((day >= 1 && day <= 28) || day === kpiCloseDayEndOfMonth);

export const KpiCloseDaySchema = z.number().int().refine(isKpiCloseDay, "Ngày chốt là 1–28 hoặc 31 (cuối tháng).");

/**
 * One version of the KPI close day. A new close day applies from the NEXT KPI period; the current period keeps
 * its boundaries (no overlap, no gap). The close day of period P is the version with the latest fromPeriod ≤ P.
 */
export const KpiCloseDayVersionSchema = z.object({
  /** First KPI period ("YYYY-MM") this close day applies to; null = every earlier period. */
  fromPeriod: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .nullable(),
  closeDay: KpiCloseDaySchema
});
export type KpiCloseDayVersion = z.infer<typeof KpiCloseDayVersionSchema>;

// Khoán pay policy (PD-033) -------------------------------------------------------------------------

/**
 * What the KPI settlement does with Khoán (MONEY_IF_KPI) work. Both: met = official points (Chính thức + OT + QC)
 * ≥ target, no target → met.
 * - ALWAYS (default, like the company's Excel): the Khoán money is always paid; Khoán credits are never converted
 *   and never count toward the KPI.
 * - IF_KPI: met → the money is paid; not met → no money, the Khoán credits are converted into KPI points.
 * Each settlement run records the policy it used (KpiSettlementRun.khoanPolicy).
 */
export const KhoanPayPolicySchema = z.enum(["ALWAYS", "IF_KPI"]);
export type KhoanPayPolicy = z.infer<typeof KhoanPayPolicySchema>;

// Job permission matrix (PD-036) ------------------------------------------------------------------

/** CRUD of jobs and their lines; workflow moves keep their own rules (PD-014). */
export const jobPermissionActions = ["view", "create", "update", "delete"] as const;
export type JobPermissionAction = (typeof jobPermissionActions)[number];
/**
 * none: not at all. all: any job / line. own:
 * - view: jobs where I am the assignee or QC of a line (or lead the job);
 * - create: lines for myself only (assignee = me), and the job of a new package while doing so ("Nhập công việc");
 * - update / delete: lines assigned to me; a job's own fields (or the whole job) only when every line of it is mine.
 */
export const jobPermissionScopes = ["none", "own", "all"] as const;
export const JobPermissionScopeSchema = z.enum(jobPermissionScopes);
export type JobPermissionScope = z.infer<typeof JobPermissionScopeSchema>;
export const JobScopesSchema = z
  .object({ view: JobPermissionScopeSchema, create: JobPermissionScopeSchema, update: JobPermissionScopeSchema, delete: JobPermissionScopeSchema })
  .strict();
export type JobScopes = z.infer<typeof JobScopesSchema>;
/** The roles an Admin configures; ADMIN is always "all" everywhere and is not stored. */
export const jobPermissionRoles = ["ACCOUNT", "LEADER", "QC", "STAFF", "DIRECTOR"] as const satisfies readonly ProductionRole[];
export type JobPermissionRole = (typeof jobPermissionRoles)[number];

const allScopes: JobScopes = { view: "all", create: "all", update: "all", delete: "all" };
const noScopes: JobScopes = { view: "none", create: "none", update: "none", delete: "none" };
/**
 * PD-047: staff see every job and update their own tasks but neither enter work ("Nhập công việc", "Chia task") nor delete
 * tasks — deleting their own subtasks before Done stays allowed whatever the delete scope (subtaskDeleteAllowed).
 */
const staffScopes: JobScopes = { view: "all", create: "none", update: "own", delete: "none" };
/** PD-051: QC people are staff too — no own work entry and no task delete; they see and update their own tasks. */
const qcScopes: JobScopes = { view: "own", create: "none", update: "own", delete: "none" };
/** PD-065: the Director sees every job and changes none. */
const directorScopes: JobScopes = { view: "all", create: "none", update: "none", delete: "none" };

/**
 * "Phân quyền Job" matrix. DIRECTOR (PD-065) may be left out of a request or a stored value (matrices saved before it):
 * it then reads its default (view all, nothing else).
 */
export const JobPermissionMatrixSchema = z
  .object({
    ACCOUNT: JobScopesSchema,
    LEADER: JobScopesSchema,
    QC: JobScopesSchema,
    STAFF: JobScopesSchema,
    DIRECTOR: JobScopesSchema.default(directorScopes)
  })
  .strict();
export type JobPermissionMatrix = z.infer<typeof JobPermissionMatrixSchema>;

/**
 * The owner's defaults (seeded by migration 20261013_0110; STAFF by 20261015_0200, PD-047; QC by 20261015_0300, PD-051;
 * DIRECTOR by PD-065, not stored until the matrix is saved again).
 */
export const defaultJobPermissions: JobPermissionMatrix = {
  ACCOUNT: allScopes,
  LEADER: allScopes,
  QC: qcScopes,
  STAFF: staffScopes,
  DIRECTOR: directorScopes
};

/**
 * A stored `job_permissions` value as the API uses it: each role column that is missing or invalid (e.g. DIRECTOR in a
 * matrix saved before PD-065) reads its default.
 */
export const normalizeJobPermissions = (value: unknown): JobPermissionMatrix => {
  const stored = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const result = { ...defaultJobPermissions };
  for (const role of jobPermissionRoles) {
    const parsed = JobScopesSchema.safeParse(stored[role]);
    if (parsed.success) {
      result[role] = parsed.data;
    }
  }
  return result;
};

const scopeRank: Record<JobPermissionScope, number> = { none: 0, own: 1, all: 2 };
/** The more permissive of two scopes. */
export const widerScope = (a: JobPermissionScope, b: JobPermissionScope): JobPermissionScope => (scopeRank[a] >= scopeRank[b] ? a : b);

/** A user's scopes: the most permissive over their production roles; ADMIN is "all"; no role is "none". */
export const effectiveJobScopes = (roles: Iterable<ProductionRole>, matrix: JobPermissionMatrix): JobScopes => {
  const result = { ...noScopes };
  for (const role of roles) {
    const scopes = role === "ADMIN" ? allScopes : (matrix as Partial<Record<ProductionRole, JobScopes>>)[role];
    if (!scopes) {
      continue;
    }
    for (const action of jobPermissionActions) {
      result[action] = widerScope(result[action], scopes[action]);
    }
  }
  return result;
};

// Feature permission matrix (PD-065) ---------------------------------------------------------------

/**
 * "Phân quyền Photo Retouch": which production roles use each feature, edited by the organization superadmin (PD-050)
 * in Cài đặt → Vai trò & phân quyền (setting `feature_permissions`). A user has a feature when one of their roles is
 * listed; the organization superadmin always has every feature. ADMIN gets a feature only through the matrix.
 *  - qc_queue            "Hàng chờ QC" (GET /production/tasks/qc-queue).
 *  - view_others_scores  others' scores: "Xếp hạng" (+ export), "Điểm cá nhân" of others (+ forecast), others' KPI rows
 *                        (`userId` on /kpi/settlements, /kpi/report, /kpi/export) and others' rows of a task's scores.
 *                        One's own scores are always visible.
 *  - view_others_money   others' Khoán money (board, task scores, "Điểm cá nhân", KPI) and money per image of the
 *                        credit grid ("Bảng đơn giá"). Setting `moneyPublic` opens it to everyone; one's own always.
 *  - leader_dashboard    "Bảng điều khiển" (GET /production/dashboard/leader).
 *  - admin_dashboard     "Quản trị số liệu" (GET /production/dashboard/admin) and running its pinned reports.
 *  - anomalies           "Bất thường" (GET /production/anomalies, "Đã xem" review / undo).
 *  - leave_approval      approve / reject leave requests and the attendance Excel export (GET /production/leave/export);
 *                        the approvers are notified of new requests.
 *  - clients             "Khách hàng" (GET /production/clients; writes stay the superadmin's, PD-050).
 * Data scopes do not change: on the dashboards and anomalies ADMIN and DIRECTOR (and the superadmin) see every job,
 * anyone else the jobs they lead plus the jobs without a leader. "Cấu hình Photo Retouch" stays fixed (not in the matrix).
 */
export const featurePermissionKeys = [
  "qc_queue",
  "view_others_scores",
  "view_others_money",
  "leader_dashboard",
  "admin_dashboard",
  "anomalies",
  "leave_approval",
  "clients"
] as const;
export const FeaturePermissionKeySchema = z.enum(featurePermissionKeys);
export type FeaturePermissionKey = z.infer<typeof FeaturePermissionKeySchema>;

/** Roles of one feature: known codes, de-duplicated, in the stable order of `productionRoleCodes`. */
const FeatureRolesSchema = z
  .array(ProductionRoleSchema)
  .max(productionRoleCodes.length * 2)
  .transform((roles) => sortProductionRoles(roles));
/** Every key is required (unknown keys are rejected). */
export const FeaturePermissionMatrixSchema = z.record(FeaturePermissionKeySchema, FeatureRolesSchema);
export type FeaturePermissionMatrix = z.infer<typeof FeaturePermissionMatrixSchema>;

/** The owner's defaults (PD-065); used until the superadmin saves the matrix. */
export const defaultFeaturePermissions: FeaturePermissionMatrix = {
  qc_queue: ["ADMIN", "QC"],
  view_others_scores: ["ADMIN", "ACCOUNT", "LEADER", "QC", "STAFF", "DIRECTOR"],
  view_others_money: ["ADMIN", "DIRECTOR"],
  leader_dashboard: ["ADMIN", "LEADER", "DIRECTOR"],
  admin_dashboard: ["DIRECTOR"],
  anomalies: ["DIRECTOR"],
  leave_approval: ["ADMIN"],
  clients: ["ADMIN", "ACCOUNT"]
};

/** A stored `feature_permissions` value as the API uses it: a missing or invalid key reads its default; unknown keys are dropped. */
export const normalizeFeaturePermissions = (value: unknown): FeaturePermissionMatrix => {
  const stored = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const result = { ...defaultFeaturePermissions };
  for (const key of featurePermissionKeys) {
    const parsed = FeatureRolesSchema.safeParse(stored[key]);
    if (parsed.success) {
      result[key] = parsed.data;
    }
  }
  return result;
};

/**
 * The features of someone holding `roles` (union over the roles, in `featurePermissionKeys` order). `superadmin`: the
 * organization superadmin (hasFullOrganizationAuthority) has every feature.
 */
export const effectiveFeatures = (
  roles: Iterable<ProductionRole>,
  matrix: FeaturePermissionMatrix,
  superadmin = false
): FeaturePermissionKey[] => {
  if (superadmin) {
    return [...featurePermissionKeys];
  }
  const mine = new Set<string>(roles);
  return featurePermissionKeys.filter((key) => (matrix[key] ?? []).some((role) => mine.has(role)));
};

// Members -----------------------------------------------------------------------------------------

export const ProductionMemberSchema = z.object({
  userId: Id,
  displayName: z.string(),
  email: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  roles: z.array(ProductionRoleSchema),
  /** Departments (PD-041), stable order; an organization superadmin belongs to all. */
  departments: z.array(DepartmentSchema).default([]),
  teamId: Id.nullable(),
  active: z.boolean(),
  customValues: CustomValuesSchema,
  tagIds: z.array(Id)
});
export type ProductionMember = z.infer<typeof ProductionMemberSchema>;
export const ProductionMemberCollectionSchema = z.object({ items: z.array(ProductionMemberSchema) });

/**
 * GET /production/members?tagId=…&cf.<key>=… — USER tags (any of them) and USER custom-field filters
 * (CustomFieldFilterSchema). Members' custom values and tags are Admin data: non-admins get them empty and
 * filtering by them is 403 CUSTOM_FIELDS_FORBIDDEN.
 */
export const ProductionMemberQuerySchema = z.object({ tagId: IdListQuerySchema, cf: CustomFieldFiltersSchema });
export type ProductionMemberQuery = z.infer<typeof ProductionMemberQuerySchema>;

export const UpdateProductionMemberRequestSchema = z
  .object({
    roles: z.array(ProductionRoleSchema).max(productionRoleCodes.length).optional(),
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
  /** My scopes in the job permission matrix (PD-036): the job menu, "Tạo job", "Nhập công việc", the assignee picker. */
  jobPermissions: JobScopesSchema,
  /**
   * PD-065: my features in the feature permission matrix (`featurePermissionKeys` order): the menus "Hàng chờ QC",
   * "Bảng điều khiển", "Quản trị số liệu", "Bất thường", "Khách hàng", "Xếp hạng", leave approval / export. The
   * superadmin has all of them. Others' money also opens with settings.moneyPublic.
   */
  features: z.array(FeaturePermissionKeySchema),
  settings: z.object({
    /**
     * Close day of the CURRENT KPI period (an Admin's change applies from the next period, see kpiCloseDays);
     * 31 = "Cuối tháng" (kpiCloseDayEndOfMonth).
     */
    kpiCloseDay: z.number().int(),
    /** Close-day versions, oldest first (the first has fromPeriod null): compute any period's dates with them. */
    kpiCloseDays: z.array(KpiCloseDayVersionSchema).min(1),
    /** What the next settlement does with Khoán money (PD-033); the scores pages word their hints after it. */
    khoanPayPolicy: KhoanPayPolicySchema,
    /** Retired (PD-052): scores are always visible to every production member; kept for compatibility, gates nothing. */
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
export const UpsertTeamRequestSchema = z.object({ name: SafeText().trim().min(1).max(120), active: z.boolean().optional() }).strict();

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
/** GET /production/clients?tagId=…&cf.<key>=… — CLIENT tags (any of them) and CLIENT custom-field filters. */
export const ClientQuerySchema = z.object({ tagId: IdListQuerySchema, cf: CustomFieldFiltersSchema });
export type ClientQuery = z.infer<typeof ClientQuerySchema>;
export const UpsertClientRequestSchema = z
  .object({
    name: SafeText().trim().min(1).max(160),
    note: SafeText().trim().max(2000).nullable().optional(),
    active: z.boolean().optional(),
    customValues: CustomValuesSchema.optional(),
    tagIds: z.array(Id).max(50).optional()
  })
  .strict();

export const ProductionProjectSchema = z.object({
  id: Id,
  code: z.string(),
  name: z.string(),
  /** "Mô tả" (free text). */
  description: z.string().nullable(),
  /** Not entered in the project form any more (2026-10-13); kept for older data and the credit grid. */
  clientId: Id.nullable(),
  clientName: z.string().nullable(),
  qcBufferHours: z.number().int(),
  active: z.boolean()
});
export type ProductionProject = z.infer<typeof ProductionProjectSchema>;
export const ProductionProjectCollectionSchema = z.object({ items: z.array(ProductionProjectSchema) });
export const UpsertProductionProjectRequestSchema = z
  .object({
    code: SafeText().trim().min(1).max(40),
    name: SafeText().trim().min(1).max(160),
    description: SafeText().trim().max(2000).nullable().optional(),
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
    name: SafeText().trim().min(1).max(120),
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
    name: SafeText().trim().min(1).max(80),
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
export const CreditVersionResultSchema = z.object({ created: z.number().int() });

/** Bulk reorder of processes, shifts or custom fields (ids in the new order). */
export const ReorderCatalogRequestSchema = z.object({ ids: z.array(Id).min(1).max(500) }).strict();

export const CreditImportRequestSchema = z
  .object({
    csv: SafeText().min(1).max(2_000_000),
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
    code: SafeText().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,39}$/),
    name: SafeText().trim().min(1).max(80),
    color: Color,
    countsDone: z.boolean().default(false),
    countsChecked: z.boolean().default(false),
    isTerminal: z.boolean().default(false),
    setByRoles: z.array(ProductionRoleSchema).max(productionRoleCodes.length).default([]),
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
  value: SafeText().trim().min(1).max(80),
  label: SafeText().trim().min(1).max(120),
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
    key: SafeText().trim().regex(/^[a-z][a-z0-9_]{0,39}$/, "Use lowercase letters, digits and _."),
    label: SafeText().trim().min(1).max(120),
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
  .object({ name: SafeText().trim().min(1).max(60), color: Color.default("slate"), active: z.boolean().optional() })
  .strict();

// Job statuses (PD-038) ---------------------------------------------------------------------------

/**
 * The manual, ClickUp-style job status ("Cấu hình → Trạng thái job", ADMIN): set by people on a job, separate from the
 * 9-step line workflow (PD-014, unchanged). Ordered by `position`; closed statuses ("đóng", e.g. Đã giao khách) come
 * after the open ones wherever jobs are picked. Names are unique per organization (case-insensitive); the last status
 * cannot be deleted, and deleting one that jobs use needs a replacement (all of them move in one statement).
 *
 *   GET    /production/job-statuses                      → JobStatusCollection (every production member)
 *   POST   /production/job-statuses                      → JobStatusCollection (ADMIN), body CreateJobStatusRequest
 *   PATCH  /production/job-statuses/:id                  → JobStatusCollection (ADMIN), body UpdateJobStatusRequest
 *   PUT    /production/job-statuses/order                → JobStatusCollection (ADMIN), body ReorderJobStatusesRequest
 *   DELETE /production/job-statuses/:id?replacementId=   → DeleteJobStatusResult (ADMIN)
 */
export const jobStatusNameMaxLength = 60;
/** At most this many statuses per organization. */
export const jobStatusLimit = 50;

export const JobStatusSchema = z.object({
  id: Id,
  name: z.string(),
  color: Color,
  position: z.number().int(),
  isClosed: z.boolean(),
  /** PD-045: chosen only when every line of the job is "Đã check" (a Checking line: Done) — e.g. "Đã xong". */
  requiresAllChecked: z.boolean(),
  /** Jobs (not deleted) in this status; null for non-admins (the settings page shows it). */
  jobCount: z.number().int().nullable(),
  /** Last change of the status (like settings' updated_by / updated_at); updatedBy null = migration / system. */
  updatedAt: IsoDate,
  updatedBy: UserRefSchema.nullable()
});
export type JobStatus = z.infer<typeof JobStatusSchema>;
export const JobStatusCollectionSchema = z.object({ items: z.array(JobStatusSchema) });
export type JobStatusCollection = z.infer<typeof JobStatusCollectionSchema>;

const JobStatusName = SafeText().trim().min(1, "Nhập tên trạng thái.").max(jobStatusNameMaxLength);
export const CreateJobStatusRequestSchema = z
  .object({
    name: JobStatusName,
    color: Color.default("slate"),
    isClosed: z.boolean().default(false),
    requiresAllChecked: z.boolean().default(false)
  })
  .strict();
export type CreateJobStatusRequest = z.infer<typeof CreateJobStatusRequestSchema>;
export const UpdateJobStatusRequestSchema = z
  .object({
    name: JobStatusName.optional(),
    color: Color.optional(),
    isClosed: z.boolean().optional(),
    requiresAllChecked: z.boolean().optional()
  })
  .strict()
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), { message: "Gửi ít nhất một trường cần sửa." });
export type UpdateJobStatusRequest = z.infer<typeof UpdateJobStatusRequestSchema>;
/** Every status of the organization, in the new order. */
export const ReorderJobStatusesRequestSchema = z.object({ ids: z.array(Id).min(1).max(jobStatusLimit) }).strict();
/** `replacementId`: where the jobs of the deleted status go (required while jobs use it). */
export const DeleteJobStatusQuerySchema = z.object({ replacementId: Id.optional() });
export const DeleteJobStatusResultSchema = JobStatusCollectionSchema.extend({
  /** Jobs moved to the replacement (each gets a history row). */
  movedJobs: z.number().int()
});
export type DeleteJobStatusResult = z.infer<typeof DeleteJobStatusResultSchema>;

// Settings & whitelist ----------------------------------------------------------------------------

export const ProductionSettingsSchema = z.object({
  /**
   * The close day last configured: 1–28, or 31 = "Cuối tháng" (last day of each month, PD-032). A change applies
   * from the NEXT KPI period (the current period keeps its boundaries); kpiCloseDays lists every version (read only).
   */
  kpiCloseDay: KpiCloseDaySchema,
  /** Read only: close-day versions, oldest first (the first has fromPeriod null). */
  kpiCloseDays: z.array(KpiCloseDayVersionSchema).min(1),
  /**
   * Retired (PD-052): the ranking, "Điểm cá nhân" and task scores are always visible to every production member.
   * Still stored and accepted for compatibility; it gates nothing.
   */
  scoresPublic: z.boolean(),
  /** Others' Khoán money for every production member; otherwise the roles of `view_others_money` (PD-065) and the owner only. */
  moneyPublic: z.boolean(),
  kpiProrateLeave: z.boolean(),
  /** Khoán pay policy of the settlement (PD-033); applies to the next run (automatic or manual) and to provisional figures. */
  khoanPayPolicy: KhoanPayPolicySchema,
  anomalyFailRate: z.number().min(0).max(1),
  dueSoonHours: z.number().int().min(1).max(72),
  kpiDefaultMember: z.number().min(0).max(1_000_000),
  kpiDefaultLeader: z.number().min(0).max(1_000_000),
  chatAttachmentsEnabled: z.boolean(),
  /** "Phân quyền Job" (PD-036): role × action scopes; ADMIN is always "all" (not part of the value). */
  jobPermissions: JobPermissionMatrixSchema,
  /**
   * "Phân quyền Photo Retouch" (PD-065): feature → roles, every key present (see `featurePermissionKeys`). Written by the
   * superadmin only (PATCH, PD-050); the superadmin always has every feature whatever the value.
   */
  featurePermissions: FeaturePermissionMatrixSchema,
  timezone: z.string()
});
export type ProductionSettings = z.infer<typeof ProductionSettingsSchema>;
export const UpdateProductionSettingsRequestSchema = ProductionSettingsSchema.omit({ timezone: true, kpiCloseDays: true }).partial().strict();

export const AllowedEmailSchema = z.object({ email: z.string(), addedBy: z.string().nullable(), createdAt: IsoDate });
export const AllowedEmailCollectionSchema = z.object({ items: z.array(AllowedEmailSchema) });
export const AddAllowedEmailsRequestSchema = z
  .object({
    /** Free text pasted from a spreadsheet: emails separated by commas, semicolons, spaces or new lines. */
    text: SafeText().min(3).max(200_000)
  })
  .strict();
export const AddAllowedEmailsResultSchema = z.object({
  added: z.array(z.string()),
  alreadyAllowed: z.array(z.string()),
  invalid: z.array(z.string())
});

export const NotificationPreferencesSchema = z.object({
  notifyWeb: z.boolean(),
  notifyEmail: z.boolean(),
  /** Read-only: the server has SMTP configured (PD-013). Until then notifyEmail is saved but no e-mail is sent. */
  emailAvailable: z.boolean()
});
export const UpdateNotificationPreferencesRequestSchema = NotificationPreferencesSchema.omit({ emailAvailable: true }).partial().strict();
