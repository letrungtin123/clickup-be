import { z } from "zod";

import { ProductionMemberSchema, ProductionRoleSchema, UpdateProductionMemberRequestSchema } from "./production-catalog.js";
import { JobStatusRefSchema } from "./production-jobs.js";
import { AccountEmailSchema, SafeLineSchema, TemporaryPasswordResponseSchema } from "./schemas.js";

/**
 * Production user administration (SPEC Phase 0 "/admin/users", PD-024): what a production ADMIN — who may not
 * hold the organization's `member.manage` — can do to accounts from the production module. Guarded server-side:
 *   - production ADMIN only (organization superadmins are production ADMIN);
 *   - never on an organization superadmin, and on organization admins (role with member.manage / role.*) only
 *     when the caller is a superadmin (403 ORG_ADMIN_PROTECTED);
 *   - no organization-level role can be chosen: new accounts get the organization's default "member" role;
 *   - not on yourself for deactivate / reset password (409), and you cannot remove your own ADMIN (409).
 *
 * Endpoints (all under /api/v1, CSRF header as usual):
 *   POST  /production/users                          CreateProductionUserRequest → 201 CreatedProductionUser
 *   PATCH /production/users/:userId                   UpdateProductionUserRequest → ProductionUserChangeResult
 *   POST  /production/users/:userId/deactivate        → ProductionUserChangeResult (sessions revoked, sign-in blocked)
 *   POST  /production/users/:userId/activate          → ProductionUserChangeResult
 *   POST  /production/users/:userId/reset-password    → TemporaryPasswordResponse (shown once; no-store)
 *   GET   /production/users/:userId/led-jobs          → LedJobs (ADMIN or ACCOUNT)
 */

const Id = z.string().uuid();
const IsoDate = z.string().datetime({ offset: true });

export const CreateProductionUserRequestSchema = z
  .object({
    email: AccountEmailSchema,
    displayName: SafeLineSchema(160),
    jobTitle: SafeLineSchema(120, 0).nullable().optional(),
    /** Production roles of the new account (at least one; several allowed, PD-011). */
    roles: z
      .array(ProductionRoleSchema)
      .min(1, "Chọn ít nhất một vai trò sản xuất.")
      .max(5)
      .transform((roles) => [...new Set(roles)]),
    teamId: Id.nullable().optional(),
    /** Also add the address to the sign-in whitelist (allowed_emails) so Google sign-in works once enabled. */
    allowGoogleSignIn: z.boolean().default(true)
  })
  .strict();
export type CreateProductionUserRequest = z.infer<typeof CreateProductionUserRequestSchema>;

export const CreatedProductionUserSchema = TemporaryPasswordResponseSchema.extend({ member: ProductionMemberSchema });
export type CreatedProductionUser = z.infer<typeof CreatedProductionUserSchema>;

/** Same fields as PATCH /production/members/:userId (roles, team, custom values, tags); at least one. */
export const UpdateProductionUserRequestSchema = UpdateProductionMemberRequestSchema.refine(
  (value) => Object.values(value).some((entry) => entry !== undefined),
  { message: "Gửi ít nhất một trường cần sửa." }
);
export type UpdateProductionUserRequest = z.infer<typeof UpdateProductionUserRequestSchema>;

/** An open job (not archived, not deleted, its manual status not closed — PD-038) whose leader is the person. */
export const LedJobSchema = z.object({
  id: Id,
  code: z.string(),
  name: z.string().nullable(),
  deadline: IsoDate,
  jobStatus: JobStatusRefSchema,
  taskCount: z.number().int()
});
export type LedJob = z.infer<typeof LedJobSchema>;

export const LedJobsSchema = z.object({
  userId: Id,
  displayName: z.string(),
  /** Still holds LEADER or ADMIN (or is superadmin) as an active member: the jobs are fine where they are. */
  leaderActive: z.boolean(),
  items: z.array(LedJobSchema)
});
export type LedJobs = z.infer<typeof LedJobsSchema>;

export const ProductionUserChangeResultSchema = z.object({
  member: ProductionMemberSchema,
  /**
   * SEC2-04 follow-up: open jobs this person still leads although they no longer lead (LEADER removed or account
   * disabled). Non-empty → show "N job vẫn do người này dẫn — hãy giao cho Leader khác" with links. The other
   * production Admins also get a `production.leader_removed` notification.
   */
  orphanedJobs: z.array(LedJobSchema)
});
export type ProductionUserChangeResult = z.infer<typeof ProductionUserChangeResultSchema>;

export const ProductionUserPasswordResetSchema = TemporaryPasswordResponseSchema;
