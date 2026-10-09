import { z } from "zod";

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
  joinedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema
});

/** GET /organization/members: optional search / status filter, keyset paging (status, name, id). */
export const OrganizationMemberQuerySchema = z.object({
  q: SafeSearchSchema(120).optional(),
  status: MembershipStatusSchema.optional(),
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
    status: EditableMembershipStatusSchema.optional()
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
  /** Production (retouch) roles: ADMIN | ACCOUNT | LEADER | QC | STAFF (PD-011). */
  productionRoles: z.array(z.string().min(1).max(20)).default([])
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

export const CreateOrganizationMemberRequestSchema = z
  .object({
    email: AccountEmailSchema,
    displayName: SafeLineSchema(160),
    roleId: OpaqueIdSchema,
    jobTitle: SafeLineSchema(120, 0).nullable().optional()
  })
  .strict();

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
