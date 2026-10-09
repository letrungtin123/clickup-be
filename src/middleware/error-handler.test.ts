import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createApp } from "../app.js";
import { errorHandler } from "./error-handler.js";

const ErrorBodySchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const errorCode = (body: unknown) => ErrorBodySchema.parse(body).error.code;

const postgresError = (code: string) => Object.assign(new Error(`internal detail for ${code}`), { name: "PostgresError", code });

const appThrowing = (error: unknown) => {
  const app = express();
  app.get("/boom", () => {
    throw error;
  });
  app.use(errorHandler);
  return app;
};

describe("error handler (SEC-API-08)", () => {
  it.each(["22021", "22P05", "22007", "22008", "22003", "22001", "22P02"])("maps PostgreSQL %s (bad input) to 400 without leaking SQL", async (code) => {
    const response = await request(appThrowing(postgresError(code))).get("/boom").expect(400);
    expect(errorCode(response.body)).toBe("VALIDATION_FAILED");
    expect(JSON.stringify(response.body)).not.toContain("internal detail");
  });

  it("maps a statement timeout to 503 QUERY_TIMEOUT", async () => {
    const response = await request(appThrowing(postgresError("57014"))).get("/boom").expect(503);
    expect(errorCode(response.body)).toBe("QUERY_TIMEOUT");
  });

  it("keeps unknown failures a generic 500", async () => {
    const response = await request(appThrowing(new Error("secret"))).get("/boom").expect(500);
    expect(errorCode(response.body)).toBe("INTERNAL_SERVER_ERROR");
    expect(JSON.stringify(response.body)).not.toContain("secret");
  });
});

describe("unknown API routes (WK-60)", () => {
  const app = createApp();

  it.each(["/api/v1/does-not-exist", "/api/v1/projectsx", "/api/v1/tasks-archive/1"])("answers 404 (not 401) for %s", async (path) => {
    const response = await request(app).get(path).expect(404);
    expect(errorCode(response.body)).toBe("NOT_FOUND");
  });
});
