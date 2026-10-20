import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreateJobRequestSchema, JobFacetsSchema, JobQuerySchema, UpdateJobRequestSchema } from "../../contracts/production-jobs.js";
import type { AccessContext } from "../access/access-context.js";
import type * as JobsRepoModule from "./jobs.repo.js";
import type { Workflow } from "./workflow.js";

/**
 * PD-073 — the job list's "Tất cả" / "Tôi quản lý" tab counts (GET /production/jobs/facets `leaderTabs`) and "every job
 * must have a Leader" (POST / PATCH /production/jobs), without a database: a fake tagged-template `sql` records every
 * statement (fragments inlined like postgres.js) and answers from a per-test handler (as jobs-facets.test.ts). Obviously
 * fake ids and names only: the repository is public.
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
  const fake = Object.assign(sql, { json: (value: unknown) => value, begin: <T>(fn: (tx: unknown) => Promise<T>) => fn(fake) });
  return { state, sql: fake };
});

vi.mock("../../lib/redis.js", () => ({
  hasRedisConfig: () => false,
  getOptionalRedis: () => undefined,
  getRedis: () => {
    throw new Error("Redis is not available in this test");
  }
}));
vi.mock("../../db/client.js", () => ({ getSql: () => db.sql }));
vi.mock("./realtime.js", () => ({ publishProductionChange: vi.fn(), jobAudience: vi.fn(() => Promise.resolve([])) }));
vi.mock("./job-chat.service.js", () => ({ syncJobChat: vi.fn(() => Promise.resolve()) }));
vi.mock("./jobs.repo.js", async (importOriginal) => ({
  ...(await importOriginal<typeof JobsRepoModule>()),
  loadWorkflowModel: vi.fn(() => Promise.resolve({ statuses: [], transitions: [] } satisfies Workflow))
}));

const { changeJobStatus, createJob, getJobFacets, jobLeaderNeeded, updateJob } = await import("./jobs.service.js");
const { clearProductionConfigCache } = await import("./catalog-cache.js");

const org = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const person = "44444444-4444-4444-8444-444444444444";
const projectId = "88888888-8888-4888-8888-888888888881";
const jobId = "66666666-6666-4666-8666-666666666666";
const tagId = "77777777-7777-4777-8777-777777777777";
const statusNew = "a1111111-1111-4111-8111-111111111111";
const statusDoing = "a2222222-2222-4222-8222-222222222222";

const contextWith = (roles: string[], options: { superadmin?: boolean; test?: boolean } = {}) =>
  ({
    user: { id: me },
    organization: { id: org },
    hasFullOrganizationAuthority: options.superadmin ?? false,
    productionRoles: roles,
    role: { permissions: [] },
    ...(options.test ? { isTestAccount: true } : {})
  }) as unknown as AccessContext;

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return { code: (error as { code?: string }).code, status: (error as { statusCode?: number }).statusCode, message: (error as Error).message };
  }
  return null;
};
const callsLike = (pattern: RegExp) => db.state.calls.filter((call) => pattern.test(call.text));
const tabsCall = () => db.state.calls.find((call) => call.text.includes("AS all_count"));
const monthsCall = () => db.state.calls.find((call) => call.text.includes("AS month"));
const createdByTest = "NOT EXISTS (SELECT 1 FROM public.app_users test_au WHERE test_au.id = j.created_by AND test_au.is_test_account)";

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = () => [];
  clearProductionConfigCache();
});

describe("GET /production/jobs/facets leaderTabs — the Tất cả / Tôi quản lý tabs (PD-073)", () => {
  it("a Leader gets both counts in one query: every filter but the leader one; mine = led by the caller", async () => {
    db.state.handler = (call) => (call.text.includes("AS all_count") ? [{ all_count: 30, mine_count: 12 }] : undefined);
    const facets = JobFacetsSchema.parse(
      await getJobFacets(
        contextWith(["LEADER"]),
        JobQuerySchema.parse({ leaderId: me, projectId, q: "axp", late: "true", tagId, personId: person, jobStatusId: statusNew })
      )
    );
    expect(facets.leaderTabs).toEqual({ all: 30, mine: 12 });
    const tabs = callsLike(/AS all_count/);
    expect(tabs).toHaveLength(1);
    const text = tabs[0]!.text;
    expect(text).toContain("SELECT count(*)::int AS all_count, count(*) FILTER (WHERE j.leader_id = $)::int AS mine_count FROM production.jobs j");
    // `j.leader_id = me` never matches a job without a leader: those stay under "Tất cả" only.
    expect(tabs[0]!.values[0]).toBe(me);
    // The leader filter is left out; every other one applies (project, search, late, tags, person, statuses, archived).
    expect(text).not.toContain("AND j.leader_id = $");
    expect(text).not.toContain("AND j.leader_id IS NULL");
    expect(text).toContain("AND j.project_id = $");
    expect(text).toContain("immutable_unaccent");
    expect(text).toContain("t.is_late");
    expect(text).toContain("t.assignee_id = $");
    expect(text).toContain("j.job_status_id = ANY($::uuid[])");
    expect(text).toContain("j.archived_at IS NULL");
    expect(text).toContain(createdByTest);
    expect(tabs[0]!.values).toEqual(expect.arrayContaining([projectId, person]));
    // The months (and the list) still follow the active tab: the leader filter applies there.
    expect(monthsCall()!.text).toContain("AND j.leader_id = $");

    // "Tất cả" (no leader filter) and someone else's / no leader: the same counts query, without a leader filter.
    for (const leaderId of [undefined, other, "none"]) {
      db.state.calls = [];
      await getJobFacets(contextWith(["LEADER"]), JobQuerySchema.parse(leaderId ? { leaderId } : {}));
      expect(tabsCall()!.text).not.toMatch(/AND j\.leader_id (= \$|IS NULL)/);
    }
  });

  it("follows the list's visibility (test accounts, PD-063); archived jobs when asked", async () => {
    await getJobFacets(contextWith(["LEADER"], { test: true }), JobQuerySchema.parse({ includeArchived: "true" }));
    const text = tabsCall()!.text;
    expect(text).not.toContain("is_test_account");
    expect(text).not.toContain("j.archived_at IS NULL");
  });

  it("null (no tabs, no extra query) for anyone not holding LEADER — ADMIN, ACCOUNT, QC, STAFF, a superadmin without it", async () => {
    for (const context of [
      contextWith(["ADMIN"]),
      contextWith(["ACCOUNT"]),
      contextWith(["QC"]),
      contextWith(["STAFF"]),
      contextWith(["DIRECTOR"]),
      contextWith([], { superadmin: true })
    ]) {
      db.state.calls = [];
      const facets = JobFacetsSchema.parse(await getJobFacets(context, JobQuerySchema.parse({ leaderId: me })));
      expect(facets.leaderTabs).toBeNull();
      expect(tabsCall()).toBeUndefined();
    }
    // The superadmin holding every role (LEADER among them) gets them.
    db.state.handler = (call) => (call.text.includes("AS all_count") ? [{ all_count: 4, mine_count: 0 }] : undefined);
    const facets = await getJobFacets(contextWith(["LEADER", "ACCOUNT", "QC", "STAFF"], { superadmin: true }), JobQuerySchema.parse({}));
    expect(facets.leaderTabs).toEqual({ all: 4, mine: 0 });
  });

  it("the facets contract requires the field (null allowed)", () => {
    expect(JobFacetsSchema.safeParse({ months: [], projects: [] }).success).toBe(false);
    expect(JobFacetsSchema.safeParse({ months: [], projects: [], leaderTabs: null }).success).toBe(true);
    expect(JobFacetsSchema.safeParse({ months: [], projects: [], leaderTabs: { all: 3, mine: 1 } }).success).toBe(true);
  });
});

describe("POST /production/jobs — the Leader is required (PD-073)", () => {
  const base = { projectId, code: "Batch 9", receivedAt: "2026-10-12T00:00:00+07:00", deadline: "2026-10-13T23:59:00+07:00" };
  const roles = (userRoles: Record<string, string[]>) => (call: Call) => {
    if (call.text.startsWith("SELECT 1 FROM production.projects")) return [{ "?column?": 1 }];
    if (call.text.includes("array_agg(ur.role_code)")) {
      const ids = call.values.find(Array.isArray) as string[];
      return ids.filter((id) => userRoles[id]).map((id) => ({ user_id: id, roles: userRoles[id], superadmin: false }));
    }
    if (call.text.startsWith("INSERT INTO production.jobs")) return [{ id: jobId }];
    return undefined;
  };

  it("missing or null → 400 JOB_LEADER_REQUIRED, before anything is read or written", async () => {
    for (const input of [base, { ...base, leaderId: null }]) {
      db.state.calls = [];
      expect(await failure(createJob(contextWith(["LEADER"]), CreateJobRequestSchema.parse(input)))).toEqual({
        code: "JOB_LEADER_REQUIRED",
        status: 400,
        message: "Chọn Leader cho job."
      });
      expect(callsLike(/^INSERT INTO production\.jobs/)).toHaveLength(0);
      expect(callsLike(/FROM production\.projects/)).toHaveLength(0);
    }
    // Who may not create jobs still hears 403 first.
    expect(await failure(createJob(contextWith(["STAFF"]), CreateJobRequestSchema.parse(base)))).toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("a member holding LEADER is stored; anyone else is 400 LEADER_INVALID", async () => {
    db.state.handler = roles({ [me]: ["LEADER"], [other]: ["STAFF"] });
    await failure(createJob(contextWith(["LEADER"]), CreateJobRequestSchema.parse({ ...base, leaderId: me })));
    expect(callsLike(/^INSERT INTO production\.jobs/)[0]!.values).toContain(me);

    db.state.calls = [];
    expect(await failure(createJob(contextWith(["ACCOUNT"]), CreateJobRequestSchema.parse({ ...base, leaderId: other })))).toMatchObject({
      code: "LEADER_INVALID",
      status: 400
    });
    expect(callsLike(/^INSERT INTO production\.jobs/)).toHaveLength(0);
  });
});

describe("PATCH /production/jobs/:id — the Leader cannot be cleared; older jobs without one (PD-073)", () => {
  const jobEditRow = (leaderId: string | null) => ({
    code: "B1",
    name: null,
    project_id: projectId,
    leader_id: leaderId,
    received_at: new Date("2026-10-01T00:00:00Z"),
    deadline: new Date("2026-10-05T00:00:00Z"),
    total_images: 0,
    total_images_manual: false,
    drive_link: null,
    custom_values: {},
    archived_at: null
  });
  /** The locked job row (and the re-read after the UPDATE), my lines (with "own"), the roles of a named leader. */
  const editQueries = (leaderId: string | null) => (call: Call) => {
    if (call.text.startsWith("SELECT code, name, project_id, leader_id")) return [jobEditRow(leaderId)];
    if (call.text.startsWith("SELECT 1 FROM production.projects")) return [{ "?column?": 1 }];
    if (call.text.startsWith("SELECT assignee_id FROM production.tasks")) return [{ assignee_id: me }];
    if (call.text.includes("array_agg(ur.role_code)")) return [{ user_id: other, roles: ["LEADER"], superadmin: false }];
    return undefined;
  };
  const updated = () => callsLike(/^UPDATE production\.jobs SET/).length;
  // The detail read afterwards is not answered by the fake: only the refusal (or the UPDATE) matters here.
  const patch = async (roles: string[], body: Record<string, unknown>) => {
    db.state.calls = [];
    return await failure(updateJob(contextWith(roles), jobId, UpdateJobRequestSchema.parse(body)));
  };

  it("clearing the Leader → 400 JOB_LEADER_REQUIRED, nothing written", async () => {
    db.state.handler = editQueries(me);
    expect(await patch(["LEADER"], { leaderId: null })).toEqual({
      code: "JOB_LEADER_REQUIRED",
      status: 400,
      message: "Job phải có Leader — chỉ đổi sang Leader khác."
    });
    expect(updated()).toBe(0);
    expect(await patch(["ACCOUNT"], { code: "B2", leaderId: null })).toMatchObject({ code: "JOB_LEADER_REQUIRED", status: 400 });
    expect(updated()).toBe(0);
    // Another Leader is fine; so are edits of a led job that leave the Leader alone.
    expect(await patch(["LEADER"], { leaderId: other })).not.toMatchObject({ code: "JOB_LEADER_REQUIRED" });
    expect(updated()).toBe(1);
    expect(await patch(["LEADER"], { code: "B2", deadline: "2026-10-06T00:00:00Z" })).not.toMatchObject({ code: "JOB_LEADER_REQUIRED" });
    expect(updated()).toBe(1);
  });

  it("an older job without a leader: the form's fields need one — each of them alone, or with null", async () => {
    db.state.handler = editQueries(null);
    for (const body of [
      { code: "B2" },
      { name: "Tên" },
      { projectId },
      { receivedAt: "2026-10-02T00:00:00Z" },
      { deadline: "2026-10-06T00:00:00Z" },
      { totalImages: 40 },
      { totalImages: null },
      { driveLink: "https://example.test/folder" },
      { leaderId: null },
      { code: "B2", tagIds: [tagId] }
    ]) {
      const result = await patch(["LEADER"], body);
      expect(result, JSON.stringify(body)).toMatchObject({ code: "JOB_LEADER_REQUIRED", status: 400 });
      expect(updated()).toBe(0);
    }
    expect((await patch(["ACCOUNT"], { deadline: "2026-10-06T00:00:00Z" }))?.message).toBe("Job chưa có Leader — chọn Leader để lưu thay đổi.");
    // Naming the Leader with the edit saves it.
    expect(await patch(["LEADER"], { code: "B2", leaderId: other })).not.toMatchObject({ code: "JOB_LEADER_REQUIRED" });
    expect(updated()).toBe(1);
    expect(callsLike(/^UPDATE production\.jobs SET/)[0]!.values).toContain(other);
  });

  it("an older job without a leader: archive / restore, tags and custom-field values alone still work", async () => {
    db.state.handler = editQueries(null);
    for (const body of [{ archived: true }, { tagIds: [tagId] }, { tagIds: [] }, { customValues: {} }, { archived: true, tagIds: [] }]) {
      expect(await patch(["LEADER"], body), JSON.stringify(body)).not.toMatchObject({ code: "JOB_LEADER_REQUIRED" });
      expect(updated()).toBe(1);
    }
    db.state.handler = (call) =>
      call.text.startsWith("SELECT code, name, project_id, leader_id") ? [{ ...jobEditRow(null), archived_at: new Date() }] : editQueries(null)(call);
    expect(await patch(["ACCOUNT"], { archived: false })).not.toMatchObject({ code: "JOB_LEADER_REQUIRED" });
    expect(updated()).toBe(1);
  });

  it("with update own (the Leader is not theirs to choose) the edit of an older job goes through", async () => {
    db.state.handler = editQueries(null);
    expect(await patch(["STAFF"], { code: "B2" })).not.toMatchObject({ code: "JOB_LEADER_REQUIRED" });
    expect(updated()).toBe(1);
    // They still cannot change the Leader at all.
    expect(await patch(["STAFF"], { leaderId: other })).toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("jobLeaderNeeded: the rule itself", () => {
    expect(jobLeaderNeeded({ leaderId: null }, me)).toBe(true);
    expect(jobLeaderNeeded({ leaderId: null }, null)).toBe(true);
    expect(jobLeaderNeeded({ code: "B2" }, null)).toBe(true);
    expect(jobLeaderNeeded({ code: "B2", leaderId: me }, null)).toBe(false);
    expect(jobLeaderNeeded({ code: "B2" }, me)).toBe(false);
    expect(jobLeaderNeeded({ archived: true }, null)).toBe(false);
    expect(jobLeaderNeeded({ tagIds: [], customValues: {} }, null)).toBe(false);
    expect(jobLeaderNeeded({}, null)).toBe(false);
  });

  it("the job status of an older job without a leader still changes (PATCH …/status)", async () => {
    db.state.handler = (call) => {
      if (call.text.startsWith("SELECT j.leader_id, j.archived_at, j.job_status_id")) {
        return [{ leader_id: null, archived_at: null, job_status_id: statusNew, mine: false }];
      }
      if (call.text.startsWith("SELECT id, name, color, is_closed, requires_all_checked FROM production.job_statuses")) {
        return [
          { id: statusNew, name: "Mới nhận", color: "slate", is_closed: false, requires_all_checked: false },
          { id: statusDoing, name: "Đang làm", color: "blue", is_closed: false, requires_all_checked: false }
        ].filter((row) => row.id === call.values[1]);
      }
      return undefined;
    };
    await failure(changeJobStatus(contextWith(["LEADER"]), jobId, { statusId: statusDoing }));
    expect(callsLike(/^UPDATE production\.jobs SET job_status_id/)).toHaveLength(1);
  });
});
