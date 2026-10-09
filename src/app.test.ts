import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createApp } from "./app.js";
import { ProductMetaSchema } from "./contracts/schemas.js";

const HealthResponseSchema = z.object({
  status: z.literal("ok")
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
    const response = await request(app)[method as "get"](path).expect(401);
    const body = ApiErrorResponseSchema.parse(response.body);

    expect(body.error.code).toBe("AUTH_REQUIRED");
  });

  it("validates login payload before contacting auth provider", async () => {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "not-an-email", password: "" })
      .expect(400);
    const body = ApiErrorResponseSchema.parse(response.body);

    expect(body.error.code).toBe("VALIDATION_FAILED");
  });
});


