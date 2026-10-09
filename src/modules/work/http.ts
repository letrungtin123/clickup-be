import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../../middleware/auth.js";
import { assertPasswordCurrent, resolveAccessContext, type AccessContext } from "../access/access-context.js";

export const IdParam = z.string().uuid();

/**
 * Wraps a route: resolves the caller's access context, runs the handler, and forwards errors.
 * Handlers return the response body (validated by the caller with a contract schema) or undefined.
 */
export const handle =
  (
    handler: (context: AccessContext, req: Request, res: Response) => Promise<unknown>,
    status = 200
  ): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    resolveAccessContext((req as AuthenticatedRequest).auth.id)
      .then((context) => handler(assertPasswordCurrent(context), req, res))
      .then((body) => {
        if (!res.headersSent) {
          res.status(status).json(body);
        }
      })
      .catch(next);
  };

export const param = (req: Request, name: string) => IdParam.parse(req.params[name]);
