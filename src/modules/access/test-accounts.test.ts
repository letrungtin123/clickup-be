import type { Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessContext } from "./access-context.js";
import type * as JobsRepoModule from "../production/jobs.repo.js";
import type * as LeaveExportModule from "../production/leave-export.js";
import type * as PublisherModule from "../../realtime/publisher.js";

/**
 * PD-063 — temporary QA test accounts are invisible to real users, without a database: a fake tagged-template `sql`
 * records every statement (fragments inlined like postgres.js, identifiers quoted) and answers from a per-test handler.
 * The handler of the "behaviour" cases plays the database: it drops the test account from the rows when the statement
 * carries the real viewer's predicate, so the mapping of each listing is exercised end to end.
 */
type Call = { text: string; values: unknown[] };
type Fragment = { readonly isFragment: true; text: string; values: unknown[] };

const db = vi.hoisted(() => {
  const state = {
    calls: [] as Call[],
    handler: (() => []) as (call: Call) => unknown[] | undefined
  };
  const isFragment = (value: unknown): value is Fragment =>
    typeof value === "object" && value !== null && (value as { isFragment?: unknown }).isFragment === true;
  const sql = (strings: TemplateStringsArray | string, ...values: unknown[]) => {
    if (typeof strings === "string") {
      return { isFragment: true as const, text: `"${strings}"`, values: [] as unknown[] };
    }
    let text = strings[0] ?? "";
    const flat: unknown[] = [];
    values.forEach((value, index) => {
      if (isFragment(value)) {
        text += value.text;
        flat.push(...value.values);
      } else {
        text += "$";
        flat.push(value);
      }
      text += strings[index + 1] ?? "";
    });
    return {
      isFragment: true as const,
      text,
      values: flat,
      then(resolve: (rows: unknown[]) => void, reject: (error: unknown) => void) {
        const call = { text: text.replace(/\s+/g, " ").trim(), values: flat };
        state.calls.push(call);
        try {
          resolve(state.handler(call) ?? []);
        } catch (error) {
          reject(error);
        }
      }
    };
  };
  const fake = Object.assign(sql, {
    json: (value: unknown) => value,
    begin: <T>(fn: (tx: unknown) => Promise<T>) => fn(fake),
    savepoint: <T>(fn: (tx: unknown) => Promise<T>) => fn(fake)
  });
  return { state, sql: fake };
});
const workbook = vi.hoisted(() => ({ send: vi.fn((...args: unknown[]) => Promise.resolve(args.length)) }));

vi.mock("../../lib/redis.js", () => ({
  hasRedisConfig: () => false,
  getOptionalRedis: () => undefined,
  getRedis: () => {
    throw new Error("Redis is not available in this test");
  }
}));
vi.mock("../../db/client.js", () => ({ getSql: () => db.sql }));
// No live events leave the test.
vi.mock("../../realtime/publisher.js", async (importOriginal) => {
  const original = await importOriginal<typeof PublisherModule>();
  return Object.fromEntries(Object.entries(original).map(([name, value]) => [name, typeof value === "function" ? vi.fn() : value]));
});
vi.mock("../production/realtime.js", () => ({ publishProductionChange: vi.fn(), jobAudience: vi.fn(() => Promise.resolve([])) }));
vi.mock("../production/job-chat.service.js", () => ({ syncJobChat: vi.fn(() => Promise.resolve()) }));
vi.mock("../production/jobs.repo.js", async (importOriginal) => ({
  ...(await importOriginal<typeof JobsRepoModule>()),
  loadWorkflowModel: vi.fn(() => Promise.resolve({ statuses: [], transitions: [] }))
}));
vi.mock("../production/leave-export.js", async (importOriginal) => ({
  ...(await importOriginal<typeof LeaveExportModule>()),
  sendLeaveAttendanceWorkbook: workbook.send
}));

const { viewerIsTestAccount, visibleUserIdSql, visibleUserSql } = await import("./test-accounts.js");
const { searchDirectory } = await import("../work/directory.service.js");
const { getWorkspaceContext, listOrganizationMembers } = await import("../workspace/workspace.service.js");
const { WorkspaceSessionSchema } = await import("../../contracts/schemas.js");
const { listMembers, listTeams } = await import("../production/catalog.service.js");
const { clearProductionConfigCache } = await import("../production/catalog-cache.js");
const { listJobOptions, listJobs } = await import("../production/jobs.service.js");
const { JobOptionsQuerySchema, JobQuerySchema } = await import("../../contracts/production-jobs.js");
const { getScoreBoard } = await import("../production/scores.service.js");
const { exportLeaveAttendance, getLeaveCalendar, listPendingLeave } = await import("../production/leave.service.js");
const { getKpiTargetMatrix } = await import("../production/kpi-targets.service.js");
const { listAnomalies } = await import("../production/anomalies.service.js");
const { buildReportQuery } = await import("../production/reports.js");
const { ReportConfigSchema } = await import("../../contracts/production-reports.js");
const { browseChannels } = await import("../chat/channels.service.js");
const { ChannelBrowseQuerySchema } = await import("../../contracts/chat.js");
const { addDepartmentMembers, syncDepartmentChannels } = await import("../chat/department-channels.js");

// Obviously fake ids and names (the repository is public).
const org = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const realPerson = "33333333-3333-4333-8333-333333333333";
const testPerson = "44444444-4444-4444-8444-444444444444";
const projectId = "55555555-5555-4555-8555-555555555555";
const channelId = "66666666-6666-4666-8666-666666666666";

const contextOf = (options: { test?: boolean; permissions?: string[]; productionRoles?: string[] } = {}) =>
  ({
    user: { id: me, email: "viewer@example.test", displayName: "Viewer" },
    organization: { id: org, slug: "test-org", name: "Test org" },
    role: { id: "77777777-7777-4777-8777-777777777777", organizationId: org, key: "member", name: "Role", permissions: options.permissions ?? [] },
    hasFullOrganizationAuthority: false,
    mustChangePassword: false,
    productionRoles: options.productionRoles ?? [],
    departments: ["PHOTO_RETOUCH", "PRODUCTION"],
    canSwitchDepartment: true,
    ...(options.test ? { isTestAccount: true } : {})
  }) as unknown as AccessContext;

const text = (fragment: unknown) => (fragment as Fragment).text.replace(/\s+/g, " ").trim();
const realPredicate = "NOT au.is_test_account";
const createdByTest = (column: string) => `NOT EXISTS (SELECT 1 FROM public.app_users test_au WHERE test_au.id = ${column} AND test_au.is_test_account)`;
const callWith = (needle: string) => db.state.calls.find((call) => call.text.includes(needle));
const people = [
  { id: realPerson, name: "Người thật", test: false },
  { id: testPerson, name: "QA tạm", test: true }
];
/** The people a statement returns: the test account only when the real viewer's predicate is absent. */
const visiblePeople = (call: Call, alias = "au") => people.filter((person) => !person.test || !call.text.includes(`NOT ${alias}.is_test_account`));
const userJson = (person: (typeof people)[number]) => ({ id: person.id, display_name: person.name, email: `${person.id.slice(0, 4)}@example.test`, avatar_url: null });

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = () => [];
  workbook.send.mockClear();
  clearProductionConfigCache();
});

describe("the visibility predicate", () => {
  const real = contextOf();
  const tester = contextOf({ test: true });

  it("hides test accounts from a real viewer, shows everyone to a test viewer", () => {
    expect(viewerIsTestAccount(real)).toBe(false);
    expect(viewerIsTestAccount({ isTestAccount: undefined })).toBe(false);
    expect(viewerIsTestAccount(tester)).toBe(true);
    expect(text(visibleUserSql(db.sql as never, real))).toBe(realPredicate);
    expect(text(visibleUserSql(db.sql as never, real, db.sql`u` as never))).toBe("NOT u.is_test_account");
    expect(text(visibleUserSql(db.sql as never, tester))).toBe("TRUE");
  });

  it("checks the owner of an artifact by id (NULL owners stay visible)", () => {
    expect(text(visibleUserIdSql(db.sql as never, real, db.sql`j.created_by` as never))).toBe(createdByTest("j.created_by"));
    expect(text(visibleUserIdSql(db.sql as never, tester, db.sql`j.created_by` as never))).toBe("TRUE");
  });
});

describe("access context", () => {
  const row = (isTest: boolean) => ({
    user_id: me,
    email: "viewer@example.test",
    display_name: "Viewer",
    must_change_password: false,
    is_test_account: isTest,
    production_roles: null,
    departments: ["PRODUCTION"],
    organization_id: org,
    organization_slug: "test-org",
    organization_name: "Test org",
    role_id: "77777777-7777-4777-8777-777777777777",
    role_key: "member",
    role_name: "Member",
    permissions: []
  });

  it("carries isTestAccount for a test account only, and GET /workspace/context leaves it out", async () => {
    db.state.handler = () => [row(true)];
    const tester = await getWorkspaceContext(me);
    expect(tester.isTestAccount).toBe(true);
    expect(callWith("au.is_test_account,")).toBeDefined();
    expect("isTestAccount" in WorkspaceSessionSchema.parse({ ...tester, currentDepartment: null })).toBe(false);

    db.state.handler = () => [row(false)];
    expect("isTestAccount" in (await getWorkspaceContext(me))).toBe(false);
  });
});

describe("people lists", () => {
  it("directory search (pickers, @mention, Tin nhắn mới) hides test accounts from a real viewer only", async () => {
    db.state.handler = (call) => (call.text.includes("FROM public.organization_memberships om") ? visiblePeople(call).map((person) => ({ user: userJson(person) })) : undefined);
    const real = await searchDirectory(contextOf({ permissions: ["member.view"] }), { limit: 20 });
    expect(callWith("FROM public.organization_memberships om")!.text).toContain(realPredicate);
    expect(real.items.map((user) => user.displayName)).toEqual(["Người thật"]);

    db.state.calls = [];
    const tester = await searchDirectory(contextOf({ permissions: ["member.view"], test: true }), { limit: 20 });
    expect(callWith("FROM public.organization_memberships om")!.text).not.toContain("is_test_account");
    expect(tester.items.map((user) => user.displayName)).toEqual(["Người thật", "QA tạm"]);

    // DM search ("Tin nhắn mới") goes through the same statement.
    db.state.calls = [];
    await searchDirectory(contextOf({ permissions: ["channel.create"] }), { purpose: "dm", limit: 20 });
    expect(callWith("FROM public.organization_memberships om")!.text).toContain(realPredicate);
  });

  it("GET /organization/members (Cài đặt › Thành viên)", async () => {
    await listOrganizationMembers(contextOf({ permissions: ["member.view"] }), { limit: 50 });
    expect(callWith("FROM public.organization_memberships om")!.text).toContain(realPredicate);
    db.state.calls = [];
    await listOrganizationMembers(contextOf({ permissions: ["member.view"], test: true }), { limit: 50 });
    expect(callWith("FROM public.organization_memberships om")!.text).not.toContain("is_test_account");
  });

  it("GET /production/members (Photo Retouch members, assignee / QC / leader pickers) and team sizes", async () => {
    db.state.handler = (call) =>
      call.text.includes("FROM public.organization_memberships om")
        ? visiblePeople(call).map((person) => ({
            user_id: person.id,
            display_name: person.name,
            email: null,
            avatar_url: null,
            status: "active",
            roles: ["STAFF"],
            superadmin: false,
            departments: ["PHOTO_RETOUCH"],
            team_id: null,
            custom_values: null,
            tag_ids: null
          }))
        : undefined;
    const real = await listMembers(contextOf({ productionRoles: ["LEADER"] }));
    expect(real.items.map((member) => member.displayName)).toEqual(["Người thật"]);
    const tester = await listMembers(contextOf({ productionRoles: ["LEADER"], test: true }));
    expect(tester.items.map((member) => member.displayName)).toEqual(["Người thật", "QA tạm"]);

    await listTeams(contextOf({ productionRoles: ["STAFF"] }));
    expect(callWith("FROM production.teams t")!.text).toContain(createdByTest("mp.user_id"));
  });
});

describe("jobs created by test accounts", () => {
  it("GET /production/jobs (and its export, per-person totals) leaves them out for a real viewer", async () => {
    await listJobs(contextOf({ productionRoles: ["LEADER"] }), JobQuerySchema.parse({}));
    expect(callWith("WITH page AS MATERIALIZED")!.text).toContain(createdByTest("j.created_by"));

    db.state.calls = [];
    await listJobs(contextOf({ productionRoles: ["LEADER"] }), JobQuerySchema.parse({ personId: realPerson }));
    expect(callWith("SELECT count(DISTINCT t.job_id)")!.text).toContain(createdByTest("j.created_by"));

    db.state.calls = [];
    await listJobs(contextOf({ productionRoles: ["LEADER"], test: true }), JobQuerySchema.parse({}));
    expect(callWith("WITH page AS MATERIALIZED")!.text).not.toContain("is_test_account");
  });

  it("GET /production/jobs/options (the job picker of Nhập công việc)", async () => {
    await listJobOptions(contextOf({ productionRoles: ["LEADER"] }), JobOptionsQuerySchema.parse({ projectId }));
    expect(callWith("FROM production.jobs j JOIN production.job_statuses js")!.text).toContain(createdByTest("j.created_by"));
    db.state.calls = [];
    await listJobOptions(contextOf({ productionRoles: ["LEADER"], test: true }), JobOptionsQuerySchema.parse({ projectId }));
    expect(callWith("FROM production.jobs j JOIN production.job_statuses js")!.text).not.toContain("is_test_account");
  });

  it("anomalies leave out test jobs and tasks of test accounts (PD-065: the Director's by default)", async () => {
    await listAnomalies(contextOf({ productionRoles: ["DIRECTOR"] }), { days: 7, includeReviewed: false });
    const taskQueries = db.state.calls.filter((call) => call.text.includes("FROM production.tasks t") || call.text.includes("FROM production.score_entries e"));
    expect(taskQueries.length).toBeGreaterThanOrEqual(5);
    for (const call of taskQueries) {
      expect(call.text).toContain(createdByTest("j.created_by"));
      expect(call.text).toContain(createdByTest("t.assignee_id"));
    }
    db.state.calls = [];
    await listAnomalies(contextOf({ productionRoles: ["DIRECTOR"], test: true }), { days: 7, includeReviewed: false });
    expect(db.state.calls.some((call) => call.text.includes("is_test_account"))).toBe(false);
  });
});

describe("boards, KPI, leave", () => {
  it("score board (and its export) ranks real people only for a real viewer", async () => {
    const board = (call: Call) =>
      call.text.startsWith("WITH sums AS")
        ? visiblePeople(call).map((person) => ({
            user_id: person.id,
            display_name: person.name,
            email: null,
            avatar_url: null,
            team_id: null,
            team_name: null,
            points_official: "10",
            points_khoan: "0",
            qty_khoan: 0,
            money: "0",
            custom_values: null,
            tag_ids: null
          }))
        : undefined;
    db.state.handler = board;
    const real = await getScoreBoard(contextOf({ productionRoles: ["STAFF"] }), { period: "2026-10" });
    expect(real.items.map((item) => item.user.displayName)).toEqual(["Người thật"]);
    const tester = await getScoreBoard(contextOf({ productionRoles: ["STAFF"], test: true }), { period: "2026-10" });
    expect(tester.items.map((item) => item.user.displayName).sort()).toEqual(["Người thật", "QA tạm"]);
  });

  it("KPI target matrix leaves out test accounts and their targets", async () => {
    await getKpiTargetMatrix(contextOf({ productionRoles: ["ADMIN"] }), { year: 2026 });
    expect(callWith("FROM public.organization_memberships om")!.text).toContain(realPredicate);
    expect(callWith("FROM production.kpi_targets k LEFT JOIN")!.text).toContain(createdByTest("k.user_id"));
  });

  it("leave calendar, pending queue and the attendance export (PD-057) rows", async () => {
    await getLeaveCalendar(contextOf({ productionRoles: ["STAFF"] }), { from: "2026-10-01", to: "2026-10-31" });
    expect(callWith("FROM production.leave_requests lr")!.text).toContain(realPredicate);
    db.state.calls = [];
    await listPendingLeave(contextOf({ productionRoles: ["LEADER"] }));
    expect(callWith("FROM production.leave_requests lr")!.text).toContain(realPredicate);

    const leaveRow = (person: (typeof people)[number]) => ({
      id: `${person.id.slice(0, 8)}-0000-4000-8000-000000000001`,
      user_id: person.id,
      from_date: "2026-10-05",
      to_date: "2026-10-05",
      part: "FULL_DAY",
      note: "Việc riêng",
      status: "APPROVED",
      decided_at: null,
      decision_note: null,
      cancelled_at: null,
      created_at: new Date("2026-10-01T00:00:00Z"),
      updated_at: new Date("2026-10-01T00:00:00Z"),
      owner: userJson(person),
      decider: null,
      team_id: null,
      team_name: null
    });
    db.state.handler = (call) => {
      if (call.text.includes("FROM production.leave_requests lr")) return visiblePeople(call).map(leaveRow);
      if (call.text.includes("FROM public.organization_memberships om"))
        return visiblePeople(call).map((person) => ({ user_id: person.id, display_name: person.name, email: null, team_name: null }));
      return undefined;
    };
    const exported = async (context: AccessContext) => {
      workbook.send.mockClear();
      await exportLeaveAttendance(context, {} as Response, { from: "2026-10-01", to: "2026-10-31" });
      const data = workbook.send.mock.calls[0]![1] as { people: { displayName: string }[]; requests: { person: { displayName: string } }[] };
      return { people: data.people.map((person) => person.displayName), requests: data.requests.map((request) => request.person.displayName) };
    };
    expect(await exported(contextOf({ productionRoles: ["ADMIN"] }))).toEqual({ people: ["Người thật"], requests: ["Người thật"] });
    expect(await exported(contextOf({ productionRoles: ["ADMIN"], test: true }))).toEqual({
      people: ["Người thật", "QA tạm"],
      requests: ["Người thật", "QA tạm"]
    });
  });

  it("reports / dashboard cards leave out test accounts' scores and tasks when asked", () => {
    const config = ReportConfigSchema.parse({ dimensions: ["user"], measures: ["points", "task_count"], from: "2026-10-01", to: "2026-10-31" });
    const input = { organizationId: org, from: "2026-10-01", to: "2026-10-31", closeDay: 25 };
    const hidden = buildReportQuery(config, { ...input, hideTestAccounts: true }).text;
    expect(hidden).toContain(createdByTest("e.user_id"));
    expect(hidden).toContain(createdByTest("t.assignee_id"));
    expect(buildReportQuery(config, input).text).not.toContain("is_test_account");
  });
});

describe("chat channels", () => {
  it("browse (incl. the superadmin's private ones) leaves out channels created by test accounts", async () => {
    await browseChannels(contextOf({ permissions: ["channel.view"] }), ChannelBrowseQuerySchema.parse({}));
    expect(callWith("FROM public.channels c")!.text).toContain(createdByTest("c.created_by"));
    db.state.calls = [];
    await browseChannels(contextOf({ permissions: ["channel.view"], test: true }), ChannelBrowseQuerySchema.parse({}));
    expect(callWith("FROM public.channels c")!.text).not.toContain("is_test_account");
  });

  it("department channels never mix test and real accounts (PD-053 auto membership)", async () => {
    await addDepartmentMembers(db.sql as never, contextOf(), channelId, "PRODUCTION", 0);
    expect(callWith("INSERT INTO public.channel_members")!.text).toContain(
      "au.is_test_account = coalesce(( SELECT creator.is_test_account FROM public.channels ch JOIN public.app_users creator ON creator.id = ch.created_by WHERE ch.id = $::uuid ), false)"
    );
    db.state.calls = [];
    await syncDepartmentChannels(db.sql as never, { organizationId: org, userId: testPerson, actorUserId: me, join: ["PRODUCTION"], leave: [] });
    expect(callWith("INSERT INTO public.channel_members")!.text).toContain(
      "coalesce((SELECT person.is_test_account FROM public.app_users person WHERE person.id = $::uuid), false) = coalesce(( SELECT creator.is_test_account FROM public.channels ch JOIN public.app_users creator ON creator.id = ch.created_by WHERE ch.id = c.id ), false)"
    );
  });
});
