import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createApp } from "../../app.js";

const CsrfResponseSchema = z.object({ csrfToken: z.string().min(32) });
const ApiErrorResponseSchema = z.object({ error: z.object({ code: z.string(), requestId: z.string() }) });

const channel = "00000000-0000-4000-8000-000000000001";
const message = "00000000-0000-4000-8000-000000000002";
const user = "00000000-0000-4000-8000-000000000003";

describe("chat routes", () => {
  const app = createApp();

  it.each([
    ["get", "/api/v1/channels"],
    ["get", "/api/v1/channels/browse"],
    ["post", "/api/v1/channels"],
    ["get", `/api/v1/channels/${channel}`],
    ["patch", `/api/v1/channels/${channel}`],
    ["delete", `/api/v1/channels/${channel}`],
    ["post", `/api/v1/channels/${channel}/archive`],
    ["post", `/api/v1/channels/${channel}/unarchive`],
    ["post", `/api/v1/channels/${channel}/join`],
    ["post", `/api/v1/channels/${channel}/leave`],
    ["get", `/api/v1/channels/${channel}/members`],
    ["post", `/api/v1/channels/${channel}/members`],
    ["patch", `/api/v1/channels/${channel}/members/${user}`],
    ["delete", `/api/v1/channels/${channel}/members/${user}`],
    ["patch", `/api/v1/channels/${channel}/me`],
    ["post", `/api/v1/channels/${channel}/read`],
    ["get", `/api/v1/channels/${channel}/messages`],
    ["post", `/api/v1/channels/${channel}/messages`],
    ["post", `/api/v1/channels/${channel}/attachments`],
    ["post", "/api/v1/dms"],
    ["patch", `/api/v1/messages/${message}`],
    ["delete", `/api/v1/messages/${message}`],
    ["get", `/api/v1/messages/${message}/thread`],
    ["put", `/api/v1/messages/${message}/reactions`],
    ["delete", `/api/v1/messages/${message}/reactions?emoji=%F0%9F%91%8D`],
    ["post", "/api/v1/chat-attachments/urls"],
    ["post", `/api/v1/chat-attachments/${message}/complete`],
    ["delete", `/api/v1/chat-attachments/${message}`],
    ["get", "/api/v1/chat/search?q=hello"],
    ["get", "/api/v1/chat/mentions"]
  ])("requires authentication for %s %s", async (method, path) => {
    const agent = request.agent(app);
    const csrf = await agent.get("/api/v1/auth/csrf").expect(200);
    const token = CsrfResponseSchema.parse(csrf.body).csrfToken;
    const response = await agent[method as "get"](path).set("x-csrf-token", token).expect(401);

    expect(ApiErrorResponseSchema.parse(response.body).error.code).toBe("AUTH_REQUIRED");
  });

  it("rejects chat writes without a CSRF token", async () => {
    const response = await request(app).post(`/api/v1/channels/${channel}/messages`).send({}).expect(403);
    expect(ApiErrorResponseSchema.parse(response.body).error.code).toBe("CSRF_INVALID");
  });
});
