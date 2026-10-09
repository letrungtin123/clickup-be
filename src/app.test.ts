import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createApp } from "./app.js";
import { ProductMetaSchema } from "./contracts/schemas.js";

const HealthResponseSchema = z.object({
  status: z.literal("ok")
});

const CsrfResponseSchema = z.object({
  csrfToken: z.string().min(32)
});

const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    requestId: z.string()
  })
});

describe("api app", () => {
  const app = createApp();

  it("serves liveness", async () => {
    const response = await request(app).get("/health").expect(200);
    const body = HealthResponseSchema.parse(response.body);

    expect(body.status).toBe("ok");
  });

  it("serves product metadata", async () => {
    const response = await request(app).get("/api/v1/meta").expect(200);
    const body = ProductMetaSchema.parse(response.body);

    expect(body.name).toBe("Nesso Work");
    expect(body.ports).toEqual({ web: 5890, api: 3890 });
  });

  it("requires authentication for the current user endpoint", async () => {
    const response = await request(app).get("/api/v1/auth/me").expect(401);
    const body = ApiErrorResponseSchema.parse(response.body);

    expect(body.error.code).toBe("AUTH_REQUIRED");
  });

  it.each([
    ["get", "/api/v1/workspace/context"],
    ["get", "/api/v1/permissions"],
    ["get", "/api/v1/roles"],
    ["post", "/api/v1/roles"],
    ["patch", "/api/v1/roles/00000000-0000-4000-8000-000000000001"],
    ["delete", "/api/v1/roles/00000000-0000-4000-8000-000000000001"],
    ["patch", "/api/v1/roles/00000000-0000-4000-8000-000000000001/permissions"],
    ["get", "/api/v1/organization/members"],
    ["patch", "/api/v1/organization/members/00000000-0000-4000-8000-000000000001"],
    ["get", "/api/v1/projects"],
    ["post", "/api/v1/projects"],
    ["patch", "/api/v1/projects/00000000-0000-4000-8000-000000000001"],
    ["delete", "/api/v1/projects/00000000-0000-4000-8000-000000000001"],
    ["get", "/api/v1/projects/00000000-0000-4000-8000-000000000001/members"],
    ["post", "/api/v1/projects/00000000-0000-4000-8000-000000000001/members"],
    ["patch", "/api/v1/projects/00000000-0000-4000-8000-000000000001/members/00000000-0000-4000-8000-000000000002"],
    ["delete", "/api/v1/projects/00000000-0000-4000-8000-000000000001/members/00000000-0000-4000-8000-000000000002"],
    ["post", "/api/v1/projects/00000000-0000-4000-8000-000000000001/lists"],
    ["get", "/api/v1/projects/00000000-0000-4000-8000-000000000001/statuses"],
    ["get", "/api/v1/projects/00000000-0000-4000-8000-000000000001/tasks/00000000-0000-4000-8000-000000000002"],
    ["patch", "/api/v1/projects/00000000-0000-4000-8000-000000000001/tasks/00000000-0000-4000-8000-000000000002"],
    ["post", "/api/v1/projects/00000000-0000-4000-8000-000000000001/tasks/00000000-0000-4000-8000-000000000002/comments"]
  ])("requires authentication for %s %s", async (method, path) => {
    const agent = request.agent(app);
    const csrf = await agent.get("/api/v1/auth/csrf").expect(200);
    const token = CsrfResponseSchema.parse(csrf.body).csrfToken;
    const response = await agent[method as "get"](path).set("x-csrf-token", token).expect(401);
    const body = ApiErrorResponseSchema.parse(response.body);

    expect(body.error.code).toBe("AUTH_REQUIRED");
  });

  it("rejects unsafe requests without a CSRF token", async () => {
    const response = await request(app).post("/api/v1/projects").send({}).expect(403);
    const body = ApiErrorResponseSchema.parse(response.body);

    expect(body.error.code).toBe("CSRF_INVALID");
  });

  it("rejects a CSRF token that does not match the cookie", async () => {
    const agent = request.agent(app);
    await agent.get("/api/v1/auth/csrf").expect(200);
    const response = await agent.post("/api/v1/projects").set("x-csrf-token", "x".repeat(43)).send({}).expect(403);
    const body = ApiErrorResponseSchema.parse(response.body);

    expect(body.error.code).toBe("CSRF_INVALID");
  });

  it("rejects a forged access token", async () => {
    const response = await request(app)
      .get("/api/v1/auth/me")
      .set("authorization", "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.invalid")
      .expect(401);
    const body = ApiErrorResponseSchema.parse(response.body);

    expect(body.error.code).toBe("AUTH_INVALID");
  });

  it("validates login payload before contacting auth provider", async () => {
    const agent = request.agent(app);
    const csrf = await agent.get("/api/v1/auth/csrf").expect(200);
    const token = CsrfResponseSchema.parse(csrf.body).csrfToken;
    const response = await agent
      .post("/api/v1/auth/login")
      .set("x-csrf-token", token)
      .send({ email: "not-an-email", password: "" })
      .expect(400);
    const body = ApiErrorResponseSchema.parse(response.body);

    expect(body.error.code).toBe("VALIDATION_FAILED");
  });
});


