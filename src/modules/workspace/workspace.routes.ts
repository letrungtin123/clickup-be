import { Router, type Request, type Router as ExpressRouter } from "express";

import {
  ArchiveResponseSchema,
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
import { requireSupabaseUser, type AuthenticatedRequest } from "../../middleware/auth.js";
import { invalidateAccessContexts, resolveAccessContext } from "../access/access-context.js";
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
    const context = await resolveAccessContext(getAuthenticatedUserId(req));
    const payload = await listPermissions(context);
    res.json(PermissionCollectionSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.get("/roles", async (req, res, next) => {
  try {
    const context = await resolveAccessContext(getAuthenticatedUserId(req));
    const payload = await listRoles(context);
    res.json(RoleCollectionSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.post("/roles", async (req, res, next) => {
  try {
    const input = CreateRoleRequestSchema.parse(req.body);
    const context = await resolveAccessContext(getAuthenticatedUserId(req));
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
    const context = await resolveAccessContext(getAuthenticatedUserId(req));
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
    const context = await resolveAccessContext(getAuthenticatedUserId(req));
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
    const context = await resolveAccessContext(getAuthenticatedUserId(req));
    const payload = await updateRolePermissions(context, roleId, input);
    await invalidateAccessContexts();
    res.json(ManagedRoleSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

workspaceRoutes.get("/organization/members", async (req, res, next) => {
  try {
    const context = await resolveAccessContext(getAuthenticatedUserId(req));
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
    const context = await resolveAccessContext(getAuthenticatedUserId(req));
    const payload = await updateOrganizationMember(context, membershipId, input);
    await invalidateAccessContexts();
    res.json(OrganizationMemberSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});
