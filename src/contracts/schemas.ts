import { z } from "zod";

import { DepartmentListSchema, DepartmentSchema, departmentRolesProblem, MemberProductionRolesSchema } from "./departments.js";
import { PageInfoSchema } from "./pagination.js";
import { permissionValues } from "./permissions.js";
export const OpaqueIdSchema = z.string().uuid();

export const IsoDateTimeSchema = z.string().datetime({ offset: true });

// Text input rules (shared by every request schema) ------------------------------------------------

// eslint-disable-next-line no-control-regex -- detecting control characters is intended
const controlCharacters = /[\u0000-\u001f\u007f]/;
// eslint-disable-next-line no-control-regex -- detecting control characters is intended
const controlCharactersExceptBreaks = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
/** Bidirectional overrides / isolates: they make names read differently from what they are. */
const bidiControls = /[\u202a-\u202e\u2066-\u2069]/;
/** Characters that render as nothing (zero-width, word joiner, BOM, fillers). */
const invisibleCharacters = /[\u00ad\u115f\u1160\u180e\u200b-\u200f\u2060-\u2064\u3164\ufeff\uffa0]/g;

export const textRuleMessages = {
  control: "Không được chứa ký tự điều khiển.",
  bidi: "Không được chứa ký tự đảo chiều văn bản.",
  blank: "Không được để trống.",
  year: "Năm phải nằm trong khoảng 1970–2100.",
  mime: "Loại tệp không hợp lệ."
} as const;

export const hasControlCharacters = (value: string, allowLineBreaks = false) =>
  (allowLineBreaks ? controlCharactersExceptBreaks : controlCharacters).test(value);
export const hasBidiControls = (value: string) => bidiControls.test(value);
/** True when nothing visible remains once whitespace and invisible characters are removed. */
export const isVisiblyBlank = (value: string) => value.replace(invisibleCharacters, "").trim().length === 0;

/** Single-line name or title: trimmed, no control or bidi characters, not visually empty. */
export const SafeLineSchema = (max: number, min = 1) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !hasControlCharacters(value), textRuleMessages.control)
    .refine((value) => !hasBidiControls(value), textRuleMessages.bidi)
    .refine((value) => min === 0 || !isVisiblyBlank(value), textRuleMessages.blank);

/** Multi-line plain text (descriptions): line breaks and tabs allowed, other control characters not. */
export const SafeMultilineSchema = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !hasControlCharacters(value, true), textRuleMessages.control);

/** Free-text search input. */
export const SafeSearchSchema = (max: number, min = 0) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !hasControlCharacters(value), textRuleMessages.control);

/** Client-declared MIME type (`type/subtype`, optional parameters). */
export const MimeTypeSchema = z
  .string()
  .trim()
  .min(3)
  .max(255)
  .refine((value) => !hasControlCharacters(value), textRuleMessages.control)
  .refine((value) => /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(\s*;.*)?$/i.test(value), textRuleMessages.mime);

/** File name as sent by the browser (the server sanitizes it further before storing). */
export const FileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !hasControlCharacters(value), textRuleMessages.control);

/** Date-time input: ISO-8601 with offset, year 1970–2100 (PostgreSQL rejects year 0; far years are typos). */
export const IsoDateInputSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => {
    const year = Number(value.slice(0, 4));
    return year >= 1970 && year <= 2100;
  }, textRuleMessages.year);

/** E-mail addresses as the database accepts them (app_users_email_format_chk). */
export const AccountEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email()
  .regex(/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i, "Email chỉ được chứa chữ, số và các ký tự . _ % + -");

export const PermissionKeySchema = z.enum(permissionValues);

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1)
  })
});

export const LoginRequestSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(4096)
});

export const AuthUserSchema = z.object({
  id: OpaqueIdSchema,
  email: z.string().email().nullable(),
  permissions: z.array(z.string().min(1).max(80))
});

export const AuthSessionSchema = z.object({
  user: AuthUserSchema
});

export const LogoutResponseSchema = z.object({
  ok: z.literal(true)
});

export const OrganizationSchema = z.object({
  id: OpaqueIdSchema,
  slug: z.string().min(2).max(80),
  name: z.string().min(1).max(160)
});

export const AppUserSchema = z.object({
  id: OpaqueIdSchema,
  displayName: z.string().min(1).max(160),
  email: z.string().email().nullable()
});

/** Read responses accept unknown permission keys so a newly added DB permission never breaks clients. */
export const PermissionKeyReadSchema = z.string().min(1).max(80);

export const RoleSchema = z.object({
  id: OpaqueIdSchema,
  organizationId: OpaqueIdSchema,
  key: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  permissions: z.array(PermissionKeyReadSchema)
});

export const RoleKeySchema = z.string().trim().regex(/^[a-z][a-z0-9_]{1,78}$/);

export const PermissionDefinitionSchema = z.object({
  key: PermissionKeyReadSchema,
  module: z.string().min(1).max(80),
  description: z.string().min(1).max(240)
});

export const PermissionCollectionSchema = z.object({
  items: z.array(PermissionDefinitionSchema)
});

export const ManagedRoleSchema = RoleSchema.extend({
  description: z.string().max(1000).nullable(),
  isSystem: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema
});

export const RoleCollectionSchema = z.object({
  items: z.array(ManagedRoleSchema)
});

export const CreateRoleRequestSchema = z.object({
  key: RoleKeySchema,
  name: SafeLineSchema(120),
  description: SafeMultilineSchema(1000).nullable().optional(),
  permissions: z.array(PermissionKeySchema).max(permissionValues.length).default([])
});

export const UpdateRoleRequestSchema = z
  .object({
    name: SafeLineSchema(120).optional(),
    description: SafeMultilineSchema(1000).nullable().optional()
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "At least one role field is required."
  });

export const UpdateRolePermissionsRequestSchema = z.object({
  permissions: z.array(PermissionKeySchema).max(permissionValues.length).default([])
});

export const MembershipStatusSchema = z.enum(["invited", "active", "disabled"]);
export const EditableMembershipStatusSchema = z.enum(["active", "disabled"]);

export const OrganizationMemberSchema = z.object({
  id: OpaqueIdSchema,
  user: AppUserSchema,
  role: RoleSchema,
  status: MembershipStatusSchema,
  /**
   * Departments (PD-041), stable order. A superadmin gets every department (implicit membership, no rows): show it as
   * "Tất cả" by the role key.
   */
  departments: z.array(DepartmentSchema).default([]),
  joinedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema
});

/** GET /organization/members: optional search / status / department filter, keyset paging (status, name, id). */
export const OrganizationMemberQuerySchema = z.object({
  q: SafeSearchSchema(120).optional(),
  status: MembershipStatusSchema.optional(),
  /** Members of this department (superadmins included: they belong to every department). */
  department: DepartmentSchema.optional(),
  cursor: z.string().max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(500)
});
export type OrganizationMemberQuery = z.infer<typeof OrganizationMemberQuerySchema>;

export const OrganizationMemberCollectionSchema = z.object({
  items: z.array(OrganizationMemberSchema),
  pageInfo: PageInfoSchema.default({ hasMore: false, nextCursor: null })
});

export const UpdateOrganizationMemberRequestSchema = z
  .object({
    roleId: OpaqueIdSchema.optional(),
    status: EditableMembershipStatusSchema.optional(),
    /**
     * Replaces the member's departments (PD-041). At least one unless the resulting role is superadmin. Removing
     * PHOTO_RETOUCH also removes the person's production roles (follow-ups as in PD-024).
     */
    departments: DepartmentListSchema.optional(),
    /**
     * Production roles to set together with the departments: required (non-empty) when PHOTO_RETOUCH is added to
     * someone without production roles; only allowed while the resulting departments include PHOTO_RETOUCH.
     */
    productionRoles: MemberProductionRolesSchema.optional()
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "At least one organization member field is required."
  });

export const WorkspaceContextSchema = z.object({
  user: AppUserSchema,
  organization: OrganizationSchema,
  role: RoleSchema,
  hasFullOrganizationAuthority: z.boolean(),
  /** Set for admin-created accounts until the user replaces the temporary password (PD-005). */
  mustChangePassword: z.boolean().default(false),
  /**
   * Effective production (Photo Retouch) roles: ADMIN | ACCOUNT | LEADER | QC | STAFF (PD-011). Empty when the user is
   * not in the PHOTO_RETOUCH department (PD-041) — the module is then closed to them like to anyone without a role.
   */
  productionRoles: z.array(z.string().min(1).max(20)).default([]),
  /** Departments the user belongs to (PD-041), stable order; a superadmin implicitly belongs to all. */
  departments: z.array(DepartmentSchema).default([]),
  /** More than one department: the header shows the department switcher. */
  canSwitchDepartment: z.boolean().default(false),
  /**
   * Temporary QA test account (PD-063, public.app_users.is_test_account). A viewer who is not one never sees test
   * accounts or the jobs / channels they created in any listing; a test account sees everyone. Absent = real account.
   * Server-side only: GET /workspace/context leaves it out.
   */
  isTestAccount: z.boolean().optional()
});

/**
 * The caller's personal notification channels (PD-021). `notifyWeb` = "Thông báo trên web": when false the client
 * shows no toast / pop-up for new notifications, but the inbox and the unread badge still update (PLAN §8: web
 * notifications are always kept). `notifyEmail` = digest e-mails (PD-013; chat never e-mails).
 */
export const NotificationChannelsSchema = z.object({ notifyWeb: z.boolean(), notifyEmail: z.boolean() });

/** GET /workspace/context response: the access context plus `notificationPreferences` (read fresh, not cached). */
export const WorkspaceSessionSchema = WorkspaceContextSchema.omit({ isTestAccount: true }).extend({
  notificationPreferences: NotificationChannelsSchema.default({ notifyWeb: true, notifyEmail: false }),
  /**
   * The department shown (PD-041), remembered per user (PUT /workspace/department) and read fresh: the saved choice when
   * the user still belongs to it, otherwise the first of `departments`; null without any department.
   */
  currentDepartment: DepartmentSchema.nullable().default(null)
});

/** bcrypt (GoTrue) only uses the first 72 bytes of a password; GoTrue rejects longer ones. */
export const passwordMaxBytes = 72;
const utf8Length = (value: string) => new TextEncoder().encode(value).length;

/** Password policy for user-chosen passwords. */
export const NewPasswordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters.")
  .max(128)
  .refine(
    (value) => utf8Length(value) <= passwordMaxBytes,
    "Mật khẩu dài tối đa 72 byte (72 ký tự không dấu; mỗi chữ có dấu tính 2–3 byte)."
  )
  .refine((value) => /[A-Za-z]/.test(value) && /[0-9]/.test(value), "Password must contain letters and numbers.");

export const ChangePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1).max(4096),
    newPassword: NewPasswordSchema
  })
  .strict()
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: "The new password must be different.",
    path: ["newPassword"]
  });

/**
 * PATCH /organization/members/:membershipId/display-name (PD-062): the organization superadmin renames an account —
 * anyone's, their own included. Same rule as the name given at creation.
 */
export const RenameOrganizationMemberRequestSchema = z.object({ displayName: SafeLineSchema(160) }).strict();
export type RenameOrganizationMemberRequest = z.infer<typeof RenameOrganizationMemberRequestSchema>;

export const CreateOrganizationMemberRequestSchema = z
  .object({
    email: AccountEmailSchema,
    displayName: SafeLineSchema(160),
    roleId: OpaqueIdSchema,
    jobTitle: SafeLineSchema(120, 0).nullable().optional(),
    /** Required (PD-041): at least one, unless the chosen role is superadmin (checked by the API). */
    departments: DepartmentListSchema,
    /** Production roles: required with PHOTO_RETOUCH, not allowed without it. */
    productionRoles: MemberProductionRolesSchema.optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    const problem = departmentRolesProblem(value.departments, value.productionRoles);
    if (problem) {
      ctx.addIssue({ code: "custom", path: ["productionRoles"], message: problem });
    }
  });

export const TemporaryPasswordResponseSchema = z.object({
  /** Shown to the admin exactly once; never stored in plain text. */
  temporaryPassword: z.string().min(12)
});

export const ChangePasswordResponseSchema = z.object({
  ok: z.literal(true),
  /** True when the session could not be rotated and the user must sign in again. */
  reauthenticate: z.boolean()
});

export const CreatedMemberResponseSchema = TemporaryPasswordResponseSchema.extend({
  member: OrganizationMemberSchema
});

export const ArchiveResponseSchema = z.object({
  ok: z.literal(true)
});

/**
 * POST /auth/socket-ticket: a short-lived (60 s) ticket the SPA sends over its open socket
 * (`session:refresh`) after refreshing the session, so the socket survives the access-token rotation
 * without reconnecting. `expiresAt` is the new access token's expiry (seconds since epoch).
 */
export const SocketTicketSchema = z.object({
  ticket: z.string().min(16).max(4000),
  expiresAt: z.number().int()
});
export type SocketTicket = z.infer<typeof SocketTicketSchema>;

export const ProductMetaSchema = z.object({
  name: z.literal("Nesso Work"),
  apiVersion: z.literal("v1"),
  ports: z.object({
    web: z.number().int(),
    api: z.number().int()
  }),
  permissions: z.array(PermissionKeySchema)
});

export type ApiError = z.infer<typeof ApiErrorSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type AuthUser = z.infer<typeof AuthUserSchema>;
export type AuthSession = z.infer<typeof AuthSessionSchema>;
export type Organization = z.infer<typeof OrganizationSchema>;
export type AppUser = z.infer<typeof AppUserSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type PermissionDefinition = z.infer<typeof PermissionDefinitionSchema>;
export type PermissionCollection = z.infer<typeof PermissionCollectionSchema>;
export type ManagedRole = z.infer<typeof ManagedRoleSchema>;
export type RoleCollection = z.infer<typeof RoleCollectionSchema>;
export type CreateRoleRequest = z.infer<typeof CreateRoleRequestSchema>;
export type UpdateRoleRequest = z.infer<typeof UpdateRoleRequestSchema>;
export type UpdateRolePermissionsRequest = z.infer<typeof UpdateRolePermissionsRequestSchema>;
export type MembershipStatus = z.infer<typeof MembershipStatusSchema>;
export type EditableMembershipStatus = z.infer<typeof EditableMembershipStatusSchema>;
export type OrganizationMember = z.infer<typeof OrganizationMemberSchema>;
export type OrganizationMemberCollection = z.infer<typeof OrganizationMemberCollectionSchema>;
export type UpdateOrganizationMemberRequest = z.infer<typeof UpdateOrganizationMemberRequestSchema>;
export type WorkspaceContext = z.infer<typeof WorkspaceContextSchema>;
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;
export type CreateOrganizationMemberRequest = z.infer<typeof CreateOrganizationMemberRequestSchema>;
export type ArchiveResponse = z.infer<typeof ArchiveResponseSchema>;
export type ProductMeta = z.infer<typeof ProductMetaSchema>;
