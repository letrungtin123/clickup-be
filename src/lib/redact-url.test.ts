import { describe, expect, it } from "vitest";

import { redactUrl } from "./redact-url.js";

describe("redactUrl", () => {
  it("hides OAuth codes, state and tokens but keeps the rest", () => {
    expect(redactUrl("/api/v1/auth/google/callback?state=abc&code=123e4567&foo=bar")).toBe(
      "/api/v1/auth/google/callback?state=REDACTED&code=REDACTED&foo=bar"
    );
    expect(redactUrl("/x?ACCESS_TOKEN=a&refresh%5Ftoken=b&error=access_denied")).toBe(
      "/x?ACCESS_TOKEN=REDACTED&refresh%5Ftoken=REDACTED&error=access_denied"
    );
  });

  it("leaves URLs without sensitive parameters untouched", () => {
    expect(redactUrl("/api/v1/projects")).toBe("/api/v1/projects");
    expect(redactUrl("/api/v1/search?q=code")).toBe("/api/v1/search?q=code");
    expect(redactUrl("/a?code#frag")).toBe("/a?code#frag");
  });
});
