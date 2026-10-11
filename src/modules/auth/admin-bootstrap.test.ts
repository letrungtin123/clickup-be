import { beforeEach, describe, expect, it, vi } from "vitest";

/** SPEC Phase 0: ADMIN_EMAIL is whitelisted at start-up — idempotent, never hard-coded, never logged. */
type Call = { text: string; values: unknown[] };

const db = vi.hoisted(() => {
  const state = { calls: [] as Call[], handler: (() => []) as (call: Call) => unknown[] | undefined };
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const call = { text: strings.join("$").replace(/\s+/g, " ").trim(), values };
    state.calls.push(call);
    return Promise.resolve(state.handler(call) ?? []);
  };
  return { state, sql };
});
const logs = vi.hoisted(() => ({ entries: [] as unknown[][] }));

vi.mock("../../db/client.js", () => ({ getSql: () => db.sql, hasDatabaseConfig: () => true }));
vi.mock("./google-auth.service.js", () => ({ scheduleGoogleAuthUserProvisioning: vi.fn() }));
vi.mock("../../lib/logger.js", () => {
  const record = (...args: unknown[]) => logs.entries.push(args);
  return { logger: { info: record, warn: record, error: record, debug: record } };
});

const { chooseWhitelistOrganizations, ensureAdminEmailWhitelisted } = await import("./admin-bootstrap.js");

const orgA = "11111111-1111-4111-8111-111111111111";
const orgB = "22222222-2222-4222-8222-222222222222";
const email = "owner@company.example";

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = () => [];
  logs.entries = [];
});

describe("chooseWhitelistOrganizations", () => {
  it("prefers the organizations where the address is a member", () => {
    expect(chooseWhitelistOrganizations({ memberOrganizationIds: [orgB, orgB], activeOrganizationIds: [orgA, orgB] })).toEqual([orgB]);
  });
  it("falls back to the only organization; ambiguous with several", () => {
    expect(chooseWhitelistOrganizations({ memberOrganizationIds: [], activeOrganizationIds: [orgA] })).toEqual([orgA]);
    expect(chooseWhitelistOrganizations({ memberOrganizationIds: [], activeOrganizationIds: [orgA, orgB] })).toEqual([]);
    expect(chooseWhitelistOrganizations({ memberOrganizationIds: [], activeOrganizationIds: [] })).toEqual([]);
  });
});

describe("ensureAdminEmailWhitelisted", () => {
  it("does nothing without ADMIN_EMAIL", async () => {
    expect(await ensureAdminEmailWhitelisted(undefined)).toEqual({ status: "skipped", reason: "not_configured" });
    expect(db.state.calls).toHaveLength(0);
  });

  it("inserts idempotently (ON CONFLICT DO NOTHING) and never logs the address", async () => {
    db.state.handler = (call) => {
      if (call.text.includes("FROM public.organization_memberships om")) {
        return [];
      }
      if (call.text.startsWith("SELECT id FROM public.organizations")) {
        return [{ id: orgA }];
      }
      if (call.text.startsWith("INSERT INTO public.allowed_emails")) {
        return [{ organization_id: orgA }];
      }
      return undefined;
    };
    expect(await ensureAdminEmailWhitelisted(email)).toEqual({ status: "done", organizations: 1, added: 1 });
    const insert = db.state.calls.find((call) => call.text.startsWith("INSERT INTO public.allowed_emails"))!;
    expect(insert.text).toContain("ON CONFLICT DO NOTHING");
    expect(insert.values).toContain(email);
    expect(JSON.stringify(logs.entries)).not.toContain(email);
  });

  it("skips (with a warning) when no single organization can be chosen", async () => {
    db.state.handler = (call) => (call.text.startsWith("SELECT id FROM public.organizations") ? [{ id: orgA }, { id: orgB }] : undefined);
    expect(await ensureAdminEmailWhitelisted(email)).toEqual({ status: "skipped", reason: "no_organization" });
    expect(db.state.calls.some((call) => call.text.startsWith("INSERT"))).toBe(false);
  });
});
