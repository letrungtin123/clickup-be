import type { Request, RequestHandler, Response } from "express";

import type { AccessContext } from "../access/access-context.js";
import { handle as baseHandle } from "../work/http.js";
import { hasProductionRole } from "./access.js";

export { param } from "../work/http.js";

/**
 * SEC2-09: colleagues' e-mail addresses are for the people who organise the work (Admin / Leader / Account).
 * Callers who hold only STAFF and/or QC get every person object of a production response — user refs
 * `{ id, displayName, email, avatarUrl }` and member rows `{ userId, displayName, email, … }` — with
 * `email: null`, except their own. Applied once in the production route wrapper below, so every production
 * endpoint (present and future) follows the same rule. The organization-level directory (`member.view`) is a
 * separate, owner-decided policy and is not affected.
 */
export const seesColleagueEmails = (context: AccessContext) => hasProductionRole(context, "ADMIN", "LEADER", "ACCOUNT");

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
};

/** Deep copy of `value` with every person's `email` nulled except `selfId`'s (see above). */
export const redactColleagueEmails = <T>(value: T, selfId: string): T => {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (!isPlainObject(node)) {
      return node;
    }
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node)) {
      copy[key] = walk(child);
    }
    if ("email" in copy && "displayName" in copy && copy.email !== null) {
      const personId = typeof copy.id === "string" ? copy.id : typeof copy.userId === "string" ? copy.userId : null;
      if (personId !== selfId) {
        copy.email = null;
      }
    }
    return copy;
  };
  return walk(value) as T;
};

/** `handle` from the work module plus the production e-mail rule above, for every production route. */
export const handle = (
  handler: (context: AccessContext, req: Request, res: Response) => Promise<unknown>,
  status = 200
): RequestHandler =>
  baseHandle(async (context, req, res) => {
    const body = await handler(context, req, res);
    return seesColleagueEmails(context) ? body : redactColleagueEmails(body, context.user.id);
  }, status);
