import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildAuthorizeUrl,
  buildCallbackUrl,
  createOAuthState,
  createPkcePair,
  decideGoogleAccess,
  googleDisplayName,
  googleFlowKey,
  isHostedDomainAllowed,
  isWellFormedState,
  mapProviderError,
  normalizeEmail,
  parseHostedDomains,
  pkceChallenge,
  sanitizeNextPath,
  statesMatch,
  verifiedGoogleEmail,
  whitelistedOrganizationIds
} from "./google-oauth.js";

const orgA = "00000000-0000-4000-8000-00000000000a";
const orgB = "00000000-0000-4000-8000-00000000000b";

describe("PKCE and state", () => {
  it("matches the RFC 7636 appendix B example", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("creates a 43-character verifier whose S256 challenge GoTrue accepts", () => {
    const { codeVerifier, codeChallenge } = createPkcePair();
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(codeChallenge).toBe(createHash("sha256").update(codeVerifier).digest("base64url"));
    expect(createPkcePair().codeVerifier).not.toBe(codeVerifier);
  });

  it("creates unique well-formed states", () => {
    const states = new Set(Array.from({ length: 50 }, () => createOAuthState()));
    expect(states.size).toBe(50);
    for (const state of states) {
      expect(isWellFormedState(state)).toBe(true);
    }
  });

  it("accepts the callback only when the URL state equals the cookie", () => {
    const state = createOAuthState();
    expect(statesMatch(state, state)).toBe(true);
    expect(statesMatch(state, createOAuthState())).toBe(false);
    expect(statesMatch(null, state)).toBe(false);
    expect(statesMatch(state, undefined)).toBe(false);
    expect(statesMatch(state, [state])).toBe(false);
    expect(statesMatch("short", "short")).toBe(false);
    expect(statesMatch(`${state.slice(0, 42)}!`, `${state.slice(0, 42)}!`)).toBe(false);
  });

  it("never stores the raw state in the Redis key", () => {
    const state = createOAuthState();
    const key = googleFlowKey(state);
    expect(key).toMatch(/^auth:google:flow:[0-9a-f]{64}$/);
    expect(key).not.toContain(state);
  });
});

describe("URLs", () => {
  it("builds the GoTrue authorize URL with PKCE S256 and the API callback", () => {
    const redirectTo = buildCallbackUrl("https://work.example.com/", "s".repeat(43));
    expect(redirectTo).toBe(`https://work.example.com/api/v1/auth/google/callback?state=${"s".repeat(43)}`);
    const url = new URL(buildAuthorizeUrl({ supabasePublicUrl: "https://sb.example.com/", redirectTo, codeChallenge: "c".repeat(43) }));
    expect(url.origin + url.pathname).toBe("https://sb.example.com/auth/v1/authorize");
    expect(url.searchParams.get("provider")).toBe("google");
    expect(url.searchParams.get("redirect_to")).toBe(redirectTo);
    expect(url.searchParams.get("code_challenge")).toBe("c".repeat(43));
    expect(url.searchParams.get("code_challenge_method")).toBe("s256");
  });
});

describe("sanitizeNextPath", () => {
  it("keeps same-app paths with query and hash", () => {
    expect(sanitizeNextPath("/p/1/l/2?view=board&task=3")).toBe("/p/1/l/2?view=board&task=3");
    expect(sanitizeNextPath("/inbox#top")).toBe("/inbox#top");
    expect(sanitizeNextPath("/search?q=a%20b")).toBe("/search?q=a%20b");
  });

  it("normalizes dot segments without leaving the app", () => {
    expect(sanitizeNextPath("/a/../b")).toBe("/b");
    expect(sanitizeNextPath("/../../etc")).toBe("/etc");
  });

  it.each([
    "https://evil.test",
    "http://evil.test/path",
    "//evil.test",
    "///evil.test",
    "/\\evil.test",
    "\\\\evil.test",
    "/%5Cevil.test/../x\\y",
    "javascript:alert(1)",
    "evil.test",
    " /p/1",
    "/p/1\n",
    "/p\t/1",
    "/login",
    "/login?next=/x",
    "/api/v1/auth/google/start",
    "",
    "/".padEnd(3000, "a"),
    null,
    undefined,
    42,
    // it.each spreads array rows: this row passes the array ["/p/1"] itself (a repeated ?next=).
    [["/p/1"]]
  ])("rejects %j", (value: unknown) => {
    expect(sanitizeNextPath(value)).toBe("/");
  });
});

describe("mapProviderError", () => {
  it("maps GoTrue error codes and the OAuth cancel", () => {
    expect(mapProviderError("access_denied", "signup_disabled")).toBe("google_not_allowed");
    expect(mapProviderError("access_denied", "user_banned")).toBe("google_account_disabled");
    expect(mapProviderError("access_denied", "provider_email_needs_verification")).toBe("google_email_unverified");
    expect(mapProviderError("access_denied", undefined)).toBe("google_cancelled");
    expect(mapProviderError("server_error", "unexpected_failure")).toBe("google_failed");
    expect(mapProviderError(undefined, undefined)).toBe("google_failed");
  });
});

describe("whitelist matching", () => {
  it("normalizes e-mails case-insensitively", () => {
    expect(normalizeEmail("  Lan.Tran@Nesso.VN ")).toBe("lan.tran@nesso.vn");
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail(`${"a".repeat(250)}@x.vn`)).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });

  it("finds every whitelisting organization once, ignoring case", () => {
    const entries = [
      { organizationId: orgB, email: "lan@nesso.vn" },
      { organizationId: orgA, email: "LAN@nesso.vn" },
      { organizationId: orgB, email: "lan@nesso.vn" },
      { organizationId: orgA, email: "other@nesso.vn" }
    ];
    expect(whitelistedOrganizationIds("Lan@Nesso.vn", entries)).toEqual([orgB, orgA]);
    expect(whitelistedOrganizationIds("stranger@nesso.vn", entries)).toEqual([]);
    expect(whitelistedOrganizationIds("lan@nesso.vn.evil.test", entries)).toEqual([]);
    expect(whitelistedOrganizationIds("garbage", entries)).toEqual([]);
  });

  it("restricts hosted domains only when configured", () => {
    expect(parseHostedDomains(" Nesso.vn, ,hcm.nesso.vn ")).toEqual(["nesso.vn", "hcm.nesso.vn"]);
    expect(isHostedDomainAllowed(null, [])).toBe(true);
    expect(isHostedDomainAllowed("NESSO.vn", ["nesso.vn"])).toBe(true);
    expect(isHostedDomainAllowed(null, ["nesso.vn"])).toBe(false);
    expect(isHostedDomainAllowed("gmail.com", ["nesso.vn"])).toBe(false);
  });
});

describe("verifiedGoogleEmail", () => {
  const google = (data: Record<string, unknown>) => ({ provider: "google", identity_data: data });

  it("accepts a confirmed account with a verified Google identity of the same address", () => {
    expect(
      verifiedGoogleEmail({
        email: "Lan@nesso.vn",
        email_confirmed_at: "2026-10-09T00:00:00Z",
        identities: [
          { provider: "email", identity_data: { email: "lan@nesso.vn", email_verified: false } },
          google({ email: "LAN@nesso.vn", email_verified: true, custom_claims: { hd: "Nesso.vn" } })
        ]
      })
    ).toEqual({ email: "lan@nesso.vn", hostedDomain: "nesso.vn" });
  });

  it("rejects unverified, mismatched, unconfirmed or non-Google identities", () => {
    const base = { email: "lan@nesso.vn", email_confirmed_at: "2026-10-09T00:00:00Z" };
    expect(verifiedGoogleEmail({ ...base, identities: [google({ email: "lan@nesso.vn", email_verified: false })] })).toBeNull();
    expect(verifiedGoogleEmail({ ...base, identities: [google({ email: "lan@nesso.vn", email_verified: "true" })] })).toBeNull();
    expect(verifiedGoogleEmail({ ...base, identities: [google({ email: "other@nesso.vn", email_verified: true })] })).toBeNull();
    expect(verifiedGoogleEmail({ ...base, identities: [{ provider: "email", identity_data: { email: "lan@nesso.vn", email_verified: true } }] })).toBeNull();
    expect(verifiedGoogleEmail({ ...base, identities: null })).toBeNull();
    expect(verifiedGoogleEmail({ email: "lan@nesso.vn", email_confirmed_at: null, identities: [google({ email: "lan@nesso.vn", email_verified: true })] })).toBeNull();
  });
});

describe("decideGoogleAccess", () => {
  const base = { whitelistedOrganizationIds: [orgA], appUser: null, memberships: [], emailUsedByAnotherProfile: false };

  it("rejects addresses that no organization whitelisted", () => {
    expect(decideGoogleAccess({ ...base, whitelistedOrganizationIds: [] })).toEqual({ kind: "reject", reason: "google_not_allowed" });
  });

  it("signs in active members of a whitelisting organization", () => {
    expect(
      decideGoogleAccess({ ...base, appUser: { deleted: false }, memberships: [{ organizationId: orgA, status: "active" }] })
    ).toEqual({ kind: "sign_in", organizationId: orgA });
  });

  it("provisions a whitelisted address without any membership in the first whitelisting organization", () => {
    expect(decideGoogleAccess({ ...base, whitelistedOrganizationIds: [orgB, orgA] })).toEqual({ kind: "provision", organizationId: orgB });
    expect(decideGoogleAccess({ ...base, appUser: { deleted: false } })).toEqual({ kind: "provision", organizationId: orgA });
  });

  it("keeps disabled accounts blocked", () => {
    expect(decideGoogleAccess({ ...base, appUser: { deleted: true } })).toEqual({ kind: "reject", reason: "google_account_disabled" });
    expect(
      decideGoogleAccess({ ...base, appUser: { deleted: false }, memberships: [{ organizationId: orgA, status: "disabled" }] })
    ).toEqual({ kind: "reject", reason: "google_account_disabled" });
    expect(
      decideGoogleAccess({ ...base, appUser: { deleted: false }, memberships: [{ organizationId: orgB, status: "disabled" }] })
    ).toEqual({ kind: "reject", reason: "google_account_disabled" });
  });

  it("never moves a member of another organization", () => {
    expect(
      decideGoogleAccess({ ...base, appUser: { deleted: false }, memberships: [{ organizationId: orgB, status: "active" }] })
    ).toEqual({ kind: "reject", reason: "google_not_allowed" });
  });

  it("refuses when another profile already uses the address", () => {
    expect(decideGoogleAccess({ ...base, emailUsedByAnotherProfile: true })).toEqual({ kind: "reject", reason: "google_account_conflict" });
  });
});

describe("googleDisplayName", () => {
  it("prefers Google's name and falls back to the local part", () => {
    expect(googleDisplayName({ full_name: "  Trần Lan  ", name: "x" }, "lan@nesso.vn")).toBe("Trần Lan");
    expect(googleDisplayName({ name: "Lan" }, "lan@nesso.vn")).toBe("Lan");
    expect(googleDisplayName({}, "lan.tran@nesso.vn")).toBe("lan.tran");
    expect(googleDisplayName(undefined, "lan@nesso.vn")).toBe("lan");
    expect(googleDisplayName({ full_name: "x".repeat(300) }, "lan@nesso.vn")).toHaveLength(160);
  });
});
