import { z } from "zod";

import { permissionValues } from "./permissions.js";
export const OpaqueIdSchema = z.string().uuid();

export const IsoDateTimeSchema = z.string().datetime({ offset: true });

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
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  permissions: z.array(PermissionKeySchema).max(permissionValues.length).default([])
});

export const UpdateRoleRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).nullable().optional()
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

export const OrganizationMemberCollectionSchema = z.object({
  items: z.array(OrganizationMemberSchema)
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
  mustChangePassword: z.boolean().default(false)
});

/** Password policy for user-chosen passwords. */
export const NewPasswordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters.")
  .max(128)
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
    email: z.string().trim().toLowerCase().email().max(254),
    displayName: z.string().trim().min(1).max(160),
    roleId: OpaqueIdSchema,
    jobTitle: z.string().trim().max(120).nullable().optional()
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
