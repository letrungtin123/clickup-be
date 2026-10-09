import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

import { AppError } from "../lib/app-error.js";
import { logger } from "../lib/logger.js";

/** PostgreSQL integrity errors that reach the API map to safe, generic client errors (never raw DB text). */
const postgresErrors: Record<string, { status: number; code: string; message: string }> = {
  "23505": { status: 409, code: "CONFLICT", message: "This change conflicts with existing data." },
  "23503": { status: 409, code: "REFERENCE_INVALID", message: "A referenced item no longer exists." },
  "23514": { status: 409, code: "RULE_VIOLATION", message: "This change is not allowed by a data rule." },
  "23P01": { status: 409, code: "CONFLICT", message: "This change overlaps existing data." },
  "22P02": { status: 400, code: "VALIDATION_FAILED", message: "Request validation failed." },
  "40001": { status: 409, code: "RETRY", message: "The request conflicted with another change. Please retry." },
  "40P01": { status: 409, code: "RETRY", message: "The request conflicted with another change. Please retry." }
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  void next;

  const send = (status: number, code: string, message: string, extra?: Record<string, unknown>) => {
    res.status(status).json({ error: { code, message, requestId: req.id, ...extra } });
  };

  if (error instanceof AppError) {
    send(error.statusCode, error.code, error.message);
    return;
  }

  if (error instanceof ZodError) {
    send(400, "VALIDATION_FAILED", "Request validation failed.", {
      issues: error.issues.slice(0, 20).map((issue) => ({ path: issue.path.join("."), message: issue.message }))
    });
    return;
  }

  if (isRecord(error)) {
    // body-parser
    if (error.type === "entity.too.large") {
      send(413, "PAYLOAD_TOO_LARGE", "The request is too large.");
      return;
    }
    if (error.type === "entity.parse.failed") {
      send(400, "INVALID_JSON", "The request body is not valid JSON.");
      return;
    }
    if (error instanceof Error && error.message === "CORS origin denied") {
      send(403, "ORIGIN_DENIED", "This origin is not allowed.");
      return;
    }
    const pgCode = typeof error.code === "string" ? error.code : undefined;
    const mapped = pgCode ? postgresErrors[pgCode] : undefined;
    if (mapped && error.name === "PostgresError") {
      logger.warn({ err: error, requestId: req.id }, "Database rule rejected request");
      send(mapped.status, mapped.code, mapped.message);
      return;
    }
  }

  logger.error({ err: error, requestId: req.id }, "Unhandled API error");
  send(500, "INTERNAL_SERVER_ERROR", "An unexpected error occurred.");
};
