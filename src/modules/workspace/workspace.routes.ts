import { Router, type Request, type Router as ExpressRouter } from "express";

import {
  ArchiveResponseSchema,
  ChangePasswordRequestSchema,
  CreatedMemberResponseSchema,
  CreateOrganizationMemberRequestSchema,
  TemporaryPasswordResponseSchema,
  CreateRoleRequestSchema,
  OpaqueIdSchema,
  OrganizationMemberCollectionSchema,
  OrganizationMemberSchema,
  PermissionCollectionSchema,
  RoleCollectionSchema,
  ManagedRoleSchema,
  UpdateOrganizationMemberRequestSchema,
  UpdateRolePermissionsRequestSchema,
  UpdateRoleRequestSchema,
  WorkspaceContextSchema
} from "../../contracts/schemas.js";
import { readCookie } from "../../lib/cookies.js";
import { requireSupabaseUser, type AuthenticatedRequest } from "../../middleware/auth.js";
import { clearAuthCookies, refreshTokenCookieName, setAuthCookies } from "../auth/auth.cookies.js";
import { refreshAuthSession } from "../auth/supabase-auth.service.js";
import { assertPasswordCurrent, invalidateAccessContexts, resolveAccessContext } from "../access/access-context.js";
import { changeOwnPassword, createOrganizationMember, resetMemberPassword, revokeUserSessions } from "./members.service.js";
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

const getAuthenticatedUserId = (req: Request) => {
  return (req as unknown as AuthenticatedRequest).auth.id;
};

const resolveActiveContext = async (req: Request) => assertPasswordCurrent(await resolveAccessContext(getAuthenticatedUserId(req)));

workspaceRoutes.use(requireSupabaseUser);

workspaceRoutes.get("/workspace/context", async (req, res, next) => {
  try {
    const context = await resolveAccessContext(getAuthenticatedUserId(req));
    res.json(WorkspaceContextSchema.parse(context));
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
    res.json(ManagedRoleSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.get("/organization/members", async (req, res, next) => {
  try {
    const context = await resolveActiveContext(req);
    const payload = await listOrganizationMembers(context);
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
    const payload = await updateOrganizationMember(context, membershipId, input);
    await invalidateAccessContexts();
    if (input.status === "disabled") {
      await revokeUserSessions(payload.user.id);
    }
    res.json(OrganizationMemberSchema.parse(payload));
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

workspaceRoutes.post("/auth/change-password", async (req, res, next) => {
  try {
    const input = ChangePasswordRequestSchema.parse(req.body);
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const context = await resolveAccessContext(auth.id);
    await changeOwnPassword(context, auth.sessionId, input);
    // Older access tokens are now revoked; rotate this session's cookies so the user stays signed in.
    const refreshToken = readCookie(req, refreshTokenCookieName);
    let reauthenticate = true;
    if (refreshToken) {
      try {
        setAuthCookies(res, (await refreshAuthSession(refreshToken)).tokens);
        reauthenticate = false;
      } catch {
        clearAuthCookies(res);
      }
    }
    res.json({ ok: true, reauthenticate });
  } catch (error) {
    next(error);
  }
});
