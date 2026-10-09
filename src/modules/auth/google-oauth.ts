import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Pure helpers for "Đăng nhập bằng Google" (PD-012): PKCE + state, redirect sanitizing, provider error
 * mapping and the whitelist / account decision. No I/O here so every rule is unit-tested.
 */

/** Error codes handed to the login page as `/login?error=<code>` (the SPA shows Vietnamese messages). */
export const googleLoginErrors = [
  "google_not_allowed",
  "google_account_disabled",
  "google_account_conflict",
  "google_not_provisioned",
  "google_email_unverified",
  "google_state_invalid",
  "google_cancelled",
  "google_unavailable",
  "google_rate_limited",
  "google_failed"
] as const;
export type GoogleLoginError = (typeof googleLoginErrors)[number];

// PKCE (RFC 7636) and state ----------------------------------------------------------------------

/** S256 challenge of a verifier, base64url without padding. */
export const pkceChallenge = (codeVerifier: string) => createHash("sha256").update(codeVerifier).digest("base64url");

/** 32 random bytes → 43-character verifier (RFC 7636 §4.1 allows 43..128 unreserved characters). */
export const createPkcePair = () => {
  const codeVerifier = randomBytes(32).toString("base64url");
  return { codeVerifier, codeChallenge: pkceChallenge(codeVerifier) };
};

/** Unguessable, single-use state; it travels in the redirect URL and in the HttpOnly state cookie. */
export const createOAuthState = () => randomBytes(32).toString("base64url");

const statePattern = /^[A-Za-z0-9_-]{43}$/;

export const isWellFormedState = (value: unknown): value is string =>
  typeof value === "string" && statePattern.test(value);

/** The callback is valid only when the URL state equals the browser's state cookie (constant time). */
export const statesMatch = (cookieState: string | null | undefined, queryState: unknown): queryState is string => {
  if (!isWellFormedState(cookieState) || !isWellFormedState(queryState)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(cookieState), Buffer.from(queryState));
};

/** Redis key for a pending flow. Only a hash of the state is stored, never the raw value. */
export const googleFlowKey = (state: string) =>
  `auth:google:flow:${createHash("sha256").update(state).digest("hex")}`;

// URLs -------------------------------------------------------------------------------------------

/** API path of the callback behind the web app origin (the reverse proxy forwards /api unchanged). */
export const googleCallbackPath = "/api/v1/auth/google/callback";

export const buildCallbackUrl = (appPublicUrl: string, state: string) => {
  const url = new URL(`${appPublicUrl.replace(/\/+$/, "")}${googleCallbackPath}`);
  url.searchParams.set("state", state);
  return url.toString();
};

/** GoTrue starts the Google flow; with a code challenge it answers the callback with `?code=` (PKCE). */
export const buildAuthorizeUrl = (input: { supabasePublicUrl: string; redirectTo: string; codeChallenge: string }) => {
  const url = new URL(`${input.supabasePublicUrl.replace(/\/+$/, "")}/auth/v1/authorize`);
  url.searchParams.set("provider", "google");
  url.searchParams.set("redirect_to", input.redirectTo);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "s256");
  return url.toString();
};

const maxNextLength = 2048;
const probeOrigin = "http://app.invalid";

const hasControlOrSpace = (value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
};

/**
 * Post-login target. Only same-app absolute paths survive (no scheme, host, protocol-relative,
 * backslash or control-character tricks); everything else — and /login or /api targets — becomes "/".
 */
export const sanitizeNextPath = (value: unknown): string => {
  if (typeof value !== "string" || value.length === 0 || value.length > maxNextLength) {
    return "/";
  }
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || hasControlOrSpace(value)) {
    return "/";
  }
  let parsed: URL;
  try {
    parsed = new URL(value, probeOrigin);
  } catch {
    return "/";
  }
  if (parsed.origin !== probeOrigin) {
    return "/";
  }
  if (parsed.pathname.startsWith("/login") || parsed.pathname.startsWith("/api/")) {
    return "/";
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
};

// Provider errors --------------------------------------------------------------------------------

/**
 * GoTrue reports failures on the redirect as `error` (OAuth code) + `error_code` (GoTrue code).
 * `signup_disabled` means no account was provisioned for this Google e-mail.
 */
export const mapProviderError = (error: unknown, errorCode: unknown): GoogleLoginError => {
  switch (typeof errorCode === "string" ? errorCode : "") {
    case "signup_disabled":
      return "google_not_allowed";
    case "user_banned":
      return "google_account_disabled";
    case "email_not_confirmed":
    case "provider_email_needs_verification":
      return "google_email_unverified";
    case "":
      return error === "access_denied" ? "google_cancelled" : "google_failed";
    default:
      return "google_failed";
  }
};

// E-mail, whitelist and account decision ----------------------------------------------------------

const emailPattern = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

/** Lower-cased, trimmed address, or null when it is not an e-mail `allowed_emails` could hold. */
export const normalizeEmail = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const email = value.trim().toLowerCase();
  return email.length <= 254 && emailPattern.test(email) ? email : null;
};

/** Organizations whose whitelist contains the address (case-insensitive), in the given order. */
export const whitelistedOrganizationIds = (
  email: string,
  entries: readonly { organizationId: string; email: string }[]
): string[] => {
  const wanted = normalizeEmail(email);
  if (!wanted) {
    return [];
  }
  const ids: string[] = [];
  for (const entry of entries) {
    if (normalizeEmail(entry.email) === wanted && !ids.includes(entry.organizationId)) {
      ids.push(entry.organizationId);
    }
  }
  return ids;
};

/** Comma-separated Google Workspace domains → normalized list (empty = any domain). */
export const parseHostedDomains = (value: string) =>
  value
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => domain.length > 0);

export const isHostedDomainAllowed = (hostedDomain: string | null, allowed: readonly string[]) =>
  allowed.length === 0 || (hostedDomain !== null && allowed.includes(hostedDomain.toLowerCase()));

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export type ExternalAuthUser = {
  email?: string | null | undefined;
  email_confirmed_at?: string | null | undefined;
  identities?: readonly { provider: string; identity_data?: Record<string, unknown> | undefined }[] | null | undefined;
};

/**
 * The account e-mail, only when a Google identity with that same address says Google verified it
 * (never trust an unverified provider address, even if GoTrue autoconfirm is on).
 */
export const verifiedGoogleEmail = (user: ExternalAuthUser): { email: string; hostedDomain: string | null } | null => {
  const email = normalizeEmail(user.email);
  if (!email || !user.email_confirmed_at) {
    return null;
  }
  const identity = (user.identities ?? []).find(
    (candidate) =>
      candidate.provider === "google" &&
      candidate.identity_data?.email_verified === true &&
      normalizeEmail(candidate.identity_data.email) === email
  );
  if (!identity) {
    return null;
  }
  const claims = identity.identity_data?.custom_claims;
  const hostedDomain = isRecord(claims) && typeof claims.hd === "string" ? claims.hd.toLowerCase() : null;
  return { email, hostedDomain };
};

export type GoogleAccessDecision =
  | { kind: "sign_in"; organizationId: string }
  | { kind: "provision"; organizationId: string }
  | { kind: "reject"; reason: GoogleLoginError };

/**
 * Whitelist + account rules. Existing members sign in when they are active in a whitelisting
 * organization; a whitelisted address without any membership is provisioned (default role) in the
 * first whitelisting organization. Disabled memberships and accounts of other organizations never pass.
 */
export const decideGoogleAccess = (input: {
  whitelistedOrganizationIds: readonly string[];
  appUser: { deleted: boolean } | null;
  memberships: readonly { organizationId: string; status: string }[];
  emailUsedByAnotherProfile: boolean;
}): GoogleAccessDecision => {
  const whitelisted = new Set(input.whitelistedOrganizationIds);
  const first = input.whitelistedOrganizationIds[0];
  if (!first) {
    return { kind: "reject", reason: "google_not_allowed" };
  }
  if (input.emailUsedByAnotherProfile) {
    return { kind: "reject", reason: "google_account_conflict" };
  }
  if (input.appUser?.deleted) {
    return { kind: "reject", reason: "google_account_disabled" };
  }
  const active = input.memberships.find((item) => whitelisted.has(item.organizationId) && item.status === "active");
  if (active) {
    return { kind: "sign_in", organizationId: active.organizationId };
  }
  if (input.memberships.some((item) => whitelisted.has(item.organizationId))) {
    // Disabled (or merely invited) here: an admin decides, not the whitelist.
    return { kind: "reject", reason: "google_account_disabled" };
  }
  if (input.memberships.length > 0) {
    // Belongs to another organization that has not whitelisted the address.
    return input.memberships.some((item) => item.status !== "active")
      ? { kind: "reject", reason: "google_account_disabled" }
      : { kind: "reject", reason: "google_not_allowed" };
  }
  return { kind: "provision", organizationId: first };
};

/** Display name for a provisioned profile: Google's name, else the e-mail's local part (1..160 chars). */
export const googleDisplayName = (metadata: Record<string, unknown> | undefined, email: string) => {
  for (const key of ["full_name", "name", "display_name"]) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim().slice(0, 160);
    }
  }
  return (email.split("@")[0] ?? email).slice(0, 160) || email.slice(0, 160);
};
