import { Router, type Request, type Router as ExpressRouter } from "express";

import { permissionValues } from "../../contracts/permissions.js";
import { ProductMetaSchema } from "../../contracts/schemas.js";
import { getAccessTokenFromRequest, type AuthenticatedRequest } from "../../middleware/auth.js";
import { verifyAccessToken } from "../auth/supabase-auth.service.js";

export const metaRoutes: ExpressRouter = Router();

const productName = "Nesso Work";
const apiVersion = "v1";

/** Signed in = a valid session (the API rate limiter usually verified it already for this request). */
const isSignedIn = async (req: Request) => {
  if ((req as Partial<AuthenticatedRequest>).auth) {
    return true;
  }
  const token = getAccessTokenFromRequest(req);
  if (!token) {
    return false;
  }
  try {
    (req as AuthenticatedRequest).auth = await verifyAccessToken(token);
    return true;
  } catch {
    return false;
  }
};

/**
 * Anonymous callers only learn the product name and API version (SEC2-20); ports and the permission
 * catalog (ProductMetaSchema) are for signed-in clients.
 */
metaRoutes.get("/meta", async (req, res) => {
  res.setHeader("cache-control", "no-store");
  if (!(await isSignedIn(req))) {
    res.json({ name: productName, apiVersion });
    return;
  }

  res.json(
    ProductMetaSchema.parse({
      name: productName,
      apiVersion,
      ports: {
        web: 5890,
        api: 3890
      },
      permissions: permissionValues
    })
  );
});
