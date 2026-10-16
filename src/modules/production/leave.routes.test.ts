import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createApp } from "../../app.js";

const ApiErrorResponseSchema = z.object({ error: z.object({ code: z.string() }) });

describe("leave routes (PD-057)", () => {
  const app = createApp();

  it("the attendance export requires authentication", async () => {
    const response = await request(app).get("/api/v1/production/leave/export?from=2026-10-01&to=2026-10-31").expect(401);
    expect(ApiErrorResponseSchema.parse(response.body).error.code).toBe("AUTH_REQUIRED");
  });
});
