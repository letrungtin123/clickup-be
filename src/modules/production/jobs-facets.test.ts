import { beforeEach, describe, expect, it, vi } from "vitest";

import { JobFacetsSchema, JobPageSchema, JobQuerySchema } from "../../contracts/production-jobs.js";
import { encodeCursor } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import type * as JobsRepoModule from "./jobs.repo.js";
import type { JobRow } from "./jobs.repo.js";
import type { Workflow } from "./workflow.js";

/**
 * PD-067 — the job List view: GET /production/jobs/facets (months of "Ngày nhận", projects) and GET /production/jobs
 * `sort=received`, without a database: a fake tagged-template `sql` records every statement (fragments inlined like
 * postgres.js) and answers from a per-test handler (as jobs-people.test.ts).
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

const { getJobFacets, listJobs } = await import("./jobs.service.js");
const { encodeTimeCursor } = await import("./cursor.js");
const { clearProductionConfigCache } = await import("./catalog-cache.js");

// Obviously fake ids and names (the repository is public).
const org = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const person = "33333333-3333-4333-8333-333333333333";
const projectA = "88888888-8888-4888-8888-888888888881";
const projectB = "88888888-8888-4888-8888-888888888882";
const jobId = (n: number) => `66666666-6666-4666-8666-${String(n).padStart(12, "0")}`;

const contextWith = (roles: string[], options: { test?: boolean } = {}) =>
  ({
    user: { id: me },
    organization: { id: org },
    hasFullOrganizationAuthority: false,
    productionRoles: roles,
    role: { permissions: [] },
    ...(options.test ? { isTestAccount: true } : {})
  }) as unknown as AccessContext;

const monthsCall = () => db.state.calls.find((call) => call.text.includes("AS month"));
const projectsCall = () => db.state.calls.find((call) => call.text.startsWith("WITH counts AS"));
const listCall = () => db.state.calls.find((call) => call.text.startsWith("WITH page AS MATERIALIZED"))!;
const createdByTest = "NOT EXISTS (SELECT 1 FROM public.app_users test_au WHERE test_au.id = j.created_by AND test_au.is_test_account)";

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return { code: (error as { code?: string }).code, status: (error as { statusCode?: number }).statusCode };
  }
  return null;
};

const jobRow = (n: number, overrides: Partial<JobRow> = {}): JobRow => ({
  id: jobId(n),
  number: n,
  code: `JOB-${n}`,
  name: null,
  project_id: projectA,
  project_code: "P1",
  project_name: "Project",
  client_name: null,
  leader_id: null,
  leader: null,
  deadline: new Date("2099-01-01T00:00:00Z"),
  received_at: new Date("2026-10-01T00:00:00Z"),
  total_images: 0,
  total_images_manual: false,
  drive_link: null,
  channel_id: null,
  job_status_id: "99999999-9999-4999-8999-999999999999",
  job_status_name: "Mới nhận",
  job_status_color: "slate",
  job_status_closed: false,
  job_status_requires_all_checked: false,
  status_id: null,
  status_code: null,
  status_name: null,
  status_color: null,
  qty_assigned: 0,
  qty_done: 0,
  qty_checked: 0,
  task_count: 0,
  late_task_count: 0,
  unchecked_task_count: 0,
  tasks_without_qty: 0,
  open_feedback_count: 0,
  workers: null,
  qc_people: null,
  process_totals: null,
  person_share: null,
  custom_values: {},
  tag_ids: null,
  created_by: null,
  created_at: new Date("2026-10-02T01:00:00Z"),
  created_cursor: "2026-10-02T01:00:00.123456Z",
  received_cursor: "2026-09-30T17:00:00.000000Z",
  archived_at: null,
  ...overrides
});

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = () => [];
  clearProductionConfigCache();
});

describe("GET /production/jobs/facets (PD-067)", () => {
  it("counts jobs per month of Ngày nhận in the organization's timezone, every filter applied", async () => {
    db.state.handler = (call) => {
      if (call.text.includes("FROM production.settings")) return [{ key: "timezone", value: "Asia/Bangkok" }];
      if (call.text.includes("AS month")) {
        return [
          { month: "2026-10", count: 12 },
          { month: "2026-09", count: 30 }
        ];
      }
      return undefined;
    };
    const facets = JobFacetsSchema.parse(
      await getJobFacets(contextWith(["LEADER"]), JobQuerySchema.parse({ projectId: projectA, q: "alg", late: "true" }))
    );
    expect(facets.months).toEqual([
      { month: "2026-10", count: 12 },
      { month: "2026-09", count: 30 }
    ]);
    const months = monthsCall()!;
    expect(months.text).toContain("to_char(j.received_at AT TIME ZONE $::text, 'YYYY-MM') AS month");
    expect(months.text).toContain("GROUP BY 1 ORDER BY 1 DESC");
    expect(months.values).toContain("Asia/Bangkok");
    // Every list filter: the project, the search and "có task trễ" included.
    expect(months.text).toContain("AND j.project_id = $");
    expect(months.values).toContain(projectA);
    expect(months.text).toContain("immutable_unaccent");
    expect(months.text).toContain("t.is_late");
    expect(months.text).toContain("j.archived_at IS NULL");
  });

  it("counts jobs per project without the project filter; the filtered project stays listed (count 0)", async () => {
    db.state.handler = (call) =>
      call.text.startsWith("WITH counts AS")
        ? [
            { project_id: projectA, code: "AXP", name: "Axon", active: true, count: 0 },
            { project_id: projectB, code: "BRX", name: "Brix", active: false, count: 7 }
          ]
        : undefined;
    const facets = JobFacetsSchema.parse(
      await getJobFacets(contextWith(["LEADER"]), JobQuerySchema.parse({ projectId: projectA, jobStatusId: "99999999-9999-4999-8999-999999999999" }))
    );
    expect(facets.projects).toEqual([
      { projectId: projectA, code: "AXP", name: "Axon", active: true, count: 0 },
      { projectId: projectB, code: "BRX", name: "Brix", active: false, count: 7 }
    ]);
    const projects = projectsCall()!;
    expect(projects.text).not.toContain("AND j.project_id = $");
    expect(projects.text).toContain("j.job_status_id = ANY($::uuid[])");
    expect(projects.text).toContain("GROUP BY j.project_id");
    expect(projects.text).toContain("LEFT JOIN counts c ON c.project_id = p.id");
    expect(projects.text).toContain("AND (c.project_id IS NOT NULL OR p.id = $)");
    expect(projects.text).toContain("ORDER BY lower(p.code), p.code, p.id");

    db.state.calls = [];
    await getJobFacets(contextWith(["LEADER"]), JobQuerySchema.parse({}));
    expect(projectsCall()!.text).toContain("AND (c.project_id IS NOT NULL )");
  });

  it("follows the list's visibility: view scope, test accounts (PD-063), the per-person view", async () => {
    await getJobFacets(contextWith(["LEADER"]), JobQuerySchema.parse({ personId: person }));
    for (const call of [monthsCall()!, projectsCall()!]) {
      expect(call.text).toContain(createdByTest);
      expect(call.text).toContain("t.assignee_id = $");
      expect(call.values).toContain(person);
    }

    // Default matrix: QC views "own" — only the jobs with a line of mine.
    db.state.calls = [];
    await getJobFacets(contextWith(["QC"]), JobQuerySchema.parse({}));
    expect(monthsCall()!.text).toContain("t.assignee_id = $ OR t.qc_id = $");
    expect(projectsCall()!.text).toContain("t.assignee_id = $ OR t.qc_id = $");

    // A test account sees the test accounts' jobs.
    db.state.calls = [];
    await getJobFacets(contextWith(["LEADER"], { test: true }), JobQuerySchema.parse({}));
    expect(monthsCall()!.text).not.toContain("is_test_account");
  });

  it("is refused like the list without a production role or a view scope", async () => {
    expect(await failure(getJobFacets(contextWith([]), JobQuerySchema.parse({})))).toMatchObject({ status: 404 });
    db.state.handler = (call) =>
      call.text.includes("FROM production.settings")
        ? [{ key: "job_permissions", value: { STAFF: { view: "none", create: "none", update: "none", delete: "none" } } }]
        : undefined;
    expect(await failure(getJobFacets(contextWith(["STAFF"]), JobQuerySchema.parse({})))).toMatchObject({ code: "FORBIDDEN", status: 403 });
  });
});

describe("GET /production/jobs sort=received (PD-067)", () => {
  it("orders by Ngày nhận, then created, newest first; the next cursor carries both instants", async () => {
    const rows = [jobRow(1), jobRow(2, { received_cursor: "2026-09-14T17:00:00.000000Z", created_cursor: "2026-10-03T01:00:00.000001Z" }), jobRow(3)];
    db.state.handler = (call) => (call.text.startsWith("WITH page AS MATERIALIZED") ? rows : undefined);
    const page = JobPageSchema.parse(await listJobs(contextWith(["LEADER"]), JobQuerySchema.parse({ sort: "received", limit: "2" })));
    expect(page.items.map((item) => item.code)).toEqual(["JOB-1", "JOB-2"]);
    expect(page.pageInfo).toEqual({ hasMore: true, nextCursor: encodeCursor(["2026-09-14T17:00:00.000000Z", "2026-10-03T01:00:00.000001Z", jobId(2)]) });
    const text = listCall().text;
    expect(text).toContain("ORDER BY j.received_at DESC, j.created_at DESC, j.id DESC LIMIT $");
    expect(text).toContain("AS received_cursor");
    expect(text).not.toContain("(j.received_at, j.created_at, j.id) <");

    db.state.calls = [];
    await listJobs(contextWith(["LEADER"]), JobQuerySchema.parse({ sort: "received", cursor: page.pageInfo.nextCursor }));
    const next = listCall();
    expect(next.text).toContain("AND (j.received_at, j.created_at, j.id) < (($::text)::timestamptz, ($::text)::timestamptz, $::uuid)");
    expect(next.values).toEqual(expect.arrayContaining(["2026-09-14T17:00:00.000000Z", "2026-10-03T01:00:00.000001Z", jobId(2)]));
  });

  it("keeps the created order by default, and each order refuses the other's cursor", async () => {
    await listJobs(contextWith(["LEADER"]), JobQuerySchema.parse({}));
    expect(listCall().text).toContain("ORDER BY j.created_at DESC, j.id DESC LIMIT $");

    const createdCursor = encodeTimeCursor("2026-10-02T01:00:00.123456Z", jobId(1));
    const receivedCursor = encodeCursor(["2026-09-30T17:00:00.000000Z", "2026-10-02T01:00:00.123456Z", jobId(1)]);
    expect(await failure(listJobs(contextWith(["LEADER"]), JobQuerySchema.parse({ sort: "received", cursor: createdCursor })))).toMatchObject({
      code: "INVALID_CURSOR",
      status: 400
    });
    expect(await failure(listJobs(contextWith(["LEADER"]), JobQuerySchema.parse({ cursor: receivedCursor })))).toMatchObject({
      code: "INVALID_CURSOR",
      status: 400
    });
    expect(
      await failure(listJobs(contextWith(["LEADER"]), JobQuerySchema.parse({ sort: "received", cursor: encodeCursor(["x", "2026-10-02T01:00:00Z", jobId(1)]) })))
    ).toMatchObject({ code: "INVALID_CURSOR", status: 400 });
  });

  it("per-person totals come with the first page only, in either order", async () => {
    await listJobs(contextWith(["LEADER"]), JobQuerySchema.parse({ sort: "received", personId: person }));
    expect(db.state.calls.some((call) => call.text.includes("SELECT count(DISTINCT t.job_id)"))).toBe(true);
    db.state.calls = [];
    const cursor = encodeCursor(["2026-09-30T17:00:00.000000Z", "2026-10-02T01:00:00.123456Z", jobId(1)]);
    await listJobs(contextWith(["LEADER"]), JobQuerySchema.parse({ sort: "received", personId: person, cursor }));
    expect(db.state.calls.some((call) => call.text.includes("SELECT count(DISTINCT t.job_id)"))).toBe(false);
  });

  it("rejects an unknown order", () => {
    expect(JobQuerySchema.safeParse({ sort: "deadline" }).success).toBe(false);
    expect(JobQuerySchema.parse({}).sort).toBe("created");
  });
});
