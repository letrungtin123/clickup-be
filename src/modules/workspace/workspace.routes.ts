import { Router, type Request, type Router as ExpressRouter } from "express";

import {
  ArchiveResponseSchema,
  ChangePasswordRequestSchema,
  ChangePasswordResponseSchema,
  CreatedMemberResponseSchema,
  CreateOrganizationMemberRequestSchema,
  TemporaryPasswordResponseSchema,
  CreateRoleRequestSchema,
  OpaqueIdSchema,
  OrganizationMemberCollectionSchema,
  OrganizationMemberQuerySchema,
  OrganizationMemberSchema,
  PermissionCollectionSchema,
  RoleCollectionSchema,
  ManagedRoleSchema,
  UpdateOrganizationMemberRequestSchema,
  UpdateRolePermissionsRequestSchema,
  UpdateRoleRequestSchema,
  WorkspaceSessionSchema
} from "../../contracts/schemas.js";
import { SetCurrentDepartmentRequestSchema, SetCurrentDepartmentResponseSchema } from "../../contracts/departments.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { requireSupabaseUser, type AuthenticatedRequest } from "../../middleware/auth.js";
import { createPasswordChangeRateLimit, markPasswordGuessFailed } from "../../middleware/rate-limit.js";
import { clearAuthCookies, setAuthCookies } from "../auth/auth.cookies.js";
import { signInWithPassword } from "../auth/supabase-auth.service.js";
import { disconnectUsers } from "../../realtime/publisher.js";
import { assertPasswordCurrent, invalidateAccessContexts, resolveAccessContext } from "../access/access-context.js";
import { assertDepartment, resolveCurrentDepartment } from "../access/departments.js";
import { afterDepartmentChange, applyDepartmentChange } from "../production/users-admin.service.js";
import { afterMembershipStatusChange, changeOwnPassword, createOrganizationMember, resetMemberPassword } from "./members.service.js";
import {
  archiveRole,
  createRole,
  listOrganizationMembers,
  listPermissions,
  listRoles,
  updateOrganizationMember,
  updateRole,
  updateRolePermissions
} from "./workspace.service.js";

export const workspaceRoutes: ExpressRouter = Router();
const passwordChangeRateLimit = createPasswordChangeRateLimit();

const getAuthenticatedUserId = (req: Request) => {
  return (req as unknown as AuthenticatedRequest).auth.id;
};

const resolveActiveContext = async (req: Request) => assertPasswordCurrent(await resolveAccessContext(getAuthenticatedUserId(req)));

/** Users whose (non-deleted) membership uses the role. */
const listRoleHolderIds = async (context: { organization: { id: string } }, roleId: string) =>
  (
    await getSql()<{ user_id: string }[]>`
      SELECT user_id FROM public.organization_memberships
      WHERE organization_id = ${context.organization.id} AND role_id = ${roleId} AND deleted_at IS NULL
      LIMIT 10000
    `
  ).map((row) => row.user_id);

// Scoped to this module's paths: unknown routes fall through to the 404 handler instead of a 401 (WK-60).
workspaceRoutes.use(["/workspace", "/permissions", "/roles", "/organization", "/auth/change-password"], requireSupabaseUser);

workspaceRoutes.get("/workspace/context", async (req, res, next) => {
  try {
    const context = await resolveAccessContext(getAuthenticatedUserId(req));
    // Personal channels and the chosen department are read fresh (not part of the cached access context): a toggle
    // or a department switch shows on the next fetch without invalidating everyone's cached context.
    const preferences = (
      await getSql()<{ notify_web: boolean; notify_email: boolean; current_department: string | null }[]>`
        SELECT notify_web, notify_email, current_department FROM public.app_users WHERE id = ${context.user.id}
      `
    )[0];
    res.json(
      WorkspaceSessionSchema.parse({
        ...context,
        notificationPreferences: { notifyWeb: preferences?.notify_web ?? true, notifyEmail: preferences?.notify_email ?? false },
        currentDepartment: resolveCurrentDepartment(context.departments, preferences?.current_department)
      })
    );
  } catch (error) {
    next(error);
  }
});

/** PD-041: remembers the department chosen in the header switcher (restored at the next sign-in). */
workspaceRoutes.put("/workspace/department", async (req, res, next) => {
  try {
    const input = SetCurrentDepartmentRequestSchema.parse(req.body);
    const context = await resolveActiveContext(req);
    assertDepartment(context, input.department);
    await getSql()`UPDATE public.app_users SET current_department = ${input.department} WHERE id = ${context.user.id}`;
    res.json(SetCurrentDepartmentResponseSchema.parse({ currentDepartment: input.department }));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.get("/permissions", async (req, res, next) => {
  try {
    const context = await resolveActiveContext(req);
    const payload = await listPermissions(context);
    res.json(PermissionCollectionSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.get("/roles", async (req, res, next) => {
  try {
    const context = await resolveActiveContext(req);
    const payload = await listRoles(context);
    res.json(RoleCollectionSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.post("/roles", async (req, res, next) => {
  try {
    const input = CreateRoleRequestSchema.parse(req.body);
    const context = await resolveActiveContext(req);
    const payload = await createRole(context, input);
    res.status(201).json(ManagedRoleSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.patch("/roles/:roleId", async (req, res, next) => {
  try {
    const roleId = OpaqueIdSchema.parse(req.params.roleId);
    const input = UpdateRoleRequestSchema.parse(req.body);
    const context = await resolveActiveContext(req);
    const payload = await updateRole(context, roleId, input);
    await invalidateAccessContexts();
    res.json(ManagedRoleSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.delete("/roles/:roleId", async (req, res, next) => {
  try {
    const roleId = OpaqueIdSchema.parse(req.params.roleId);
    const context = await resolveActiveContext(req);
    const payload = await archiveRole(context, roleId);
    await invalidateAccessContexts();
    res.json(ArchiveResponseSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.patch("/roles/:roleId/permissions", async (req, res, next) => {
  try {
    const roleId = OpaqueIdSchema.parse(req.params.roleId);
    const input = UpdateRolePermissionsRequestSchema.parse(req.body);
    const context = await resolveActiveContext(req);
    const payload = await updateRolePermissions(context, roleId, input);
    await invalidateAccessContexts();
    // Live room subscriptions were authorized with the old permissions: like a membership change, the
    // holders of this role reconnect and re-authorize (SEC-API-07).
    disconnectUsers(await listRoleHolderIds(context, roleId));
    res.json(ManagedRoleSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.get("/organization/members", async (req, res, next) => {
  try {
    const query = OrganizationMemberQuerySchema.parse(req.query);
    const context = await resolveActiveContext(req);
    const payload = await listOrganizationMembers(context, query);
    res.json(OrganizationMemberCollectionSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.patch("/organization/members/:membershipId", async (req, res, next) => {
  try {
    const membershipId = OpaqueIdSchema.parse(req.params.membershipId);
    const input = UpdateOrganizationMemberRequestSchema.parse(req.body);
    const context = await resolveActiveContext(req);
    // PD-041: departments + production roles go through the production users admin's shared writer (same rules and
    // follow-ups as PATCH /production/users/:userId).
    const { member, departmentChange } = await updateOrganizationMember(context, membershipId, input, applyDepartmentChange);
    await invalidateAccessContexts();
    if (input.status === "disabled" || input.status === "active") {
      await afterMembershipStatusChange(member.user.id, input.status);
    }
    if (input.roleId) {
      // Live room subscriptions were authorized with the old role: force a re-authenticated reconnect.
      disconnectUsers([member.user.id]);
    }
    // Department change: sockets re-authorize, unassigned tasks are published, lost production roles get the PD-024
    // follow-ups (job chats, orphaned jobs → admins notified).
    await afterDepartmentChange(context, member.user.id, departmentChange);
    res.json(OrganizationMemberSchema.parse(member));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.post("/organization/members", async (req, res, next) => {
  try {
    const input = CreateOrganizationMemberRequestSchema.parse(req.body);
    const context = await resolveActiveContext(req);
    res.status(201).json(CreatedMemberResponseSchema.parse(await createOrganizationMember(context, input)));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.post("/organization/members/:membershipId/reset-password", async (req, res, next) => {
  try {
    const membershipId = OpaqueIdSchema.parse(req.params.membershipId);
    const context = await resolveActiveContext(req);
    res.setHeader("cache-control", "no-store");
    res.json(TemporaryPasswordResponseSchema.parse(await resetMemberPassword(context, membershipId)));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.post("/auth/change-password", passwordChangeRateLimit, async (req, res, next) => {
  try {
    const input = ChangePasswordRequestSchema.parse(req.body);
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const context = await resolveAccessContext(auth.id);
    try {
      await changeOwnPassword(context, auth.sessionId, input);
    } catch (error) {
      if (error instanceof AppError && error.code === "CURRENT_PASSWORD_INVALID") {
        // The only outcome the change-password limiter counts (WK-38).
        markPasswordGuessFailed(res);
      }
      throw error;
    }
    // A password change ends every session (GoTrue included); sign this browser straight back in
    // with the new password so the user stays signed in with a fresh session.
    let reauthenticate = true;
    if (context.user.email) {
      try {
        setAuthCookies(res, (await signInWithPassword({ email: context.user.email, password: input.newPassword })).tokens);
        reauthenticate = false;
      } catch {
        clearAuthCookies(res);
      }
    } else {
      clearAuthCookies(res);
    }
    res.json(ChangePasswordResponseSchema.parse({ ok: true, reauthenticate }));
  } catch (error) {
    next(error);
  }
});
