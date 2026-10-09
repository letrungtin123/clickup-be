import { Router, type Router as ExpressRouter } from "express";

import { permissionValues } from "../../contracts/permissions.js";
import { ProductMetaSchema } from "../../contracts/schemas.js";

export const metaRoutes: ExpressRouter = Router();

metaRoutes.get("/meta", (_req, res) => {
  const payload = ProductMetaSchema.parse({
    name: "Nesso Work",
    apiVersion: "v1",
    ports: {
      web: 5890,
      api: 3890
    },
    permissions: permissionValues
  });

  res.json(payload);
});
