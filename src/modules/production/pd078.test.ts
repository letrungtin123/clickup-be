import { existsSync, readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreateJobRequestSchema, JobFacetsSchema, JobQuerySchema, UpdateJobRequestSchema } from "../../contracts/production-jobs.js";
import { ProductionOverviewQuerySchema } from "../../contracts/production-overview.js";
import type { AccessContext } from "../access/access-context.js";
import type * as JobsRepoModule from "./jobs.repo.js";
import type { Workflow } from "./workflow.js";

/**
 * PD-078 — Project (Dự án) has an owner; hierarchy Project > Job Code > Task > Subtask. Without a database: a fake
 * tagged-template `sql` records every statement (fragments inlined like postgres.js) and answers from a per-test handler
 * (as pd073.test.ts). Made-up ids, codes and names only: the repository is public.
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

const { compareProjectCodes, createJob, getJobFacets, listJobs, updateJob } = await import("./jobs.service.js");
const { clearProductionConfigCache } = await import("./catalog-cache.js");
const { workLogColumnOf, workLogHeaders } = await import("./worklog-headers.js");
const { workLogColumns } = await import("./exports.service.js");

const org = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const third = "44444444-4444-4444-8444-444444444444";
const projectId = "88888888-8888-4888-8888-888888888881";
const otherProjectId = "88888888-8888-4888-8888-888888888882";
const jobId = "66666666-6666-4666-8666-666666666666";

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
const ownedProject = "EXISTS ( SELECT 1 FROM production.project_owners op WHERE op.organization_id = j.organization_id AND op.project_id = j.project_id AND op.user_id = $ )";

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = () => [];
  clearProductionConfigCache();
});

// The Project rules and their CRUD (create / edit / delete, owners) as amended by PD-079: pd079.test.ts.

// Jobs --------------------------------------------------------------------------------------------------------------------

describe("POST /production/jobs — a Leader works in the projects they own (PD-078)", () => {
  const base = { projectId, code: "Batch 9", receivedAt: "2026-10-12T00:00:00+07:00", deadline: "2026-10-13T23:59:00+07:00" };
  /** The project's owner (assertProject: active projects), the roles of the named leaders. */
  const jobQueries = (owner: string | null, leaders: string[] = [me, other]) => (call: Call) => {
    if (call.text.includes("AS owned FROM production.projects p")) return [{ owned: owner === me }];
    if (call.text.includes("array_agg(ur.role_code)")) {
      const ids = call.values.find(Array.isArray) as string[];
      return ids.filter((id) => leaders.includes(id)).map((id) => ({ user_id: id, roles: ["LEADER"], superadmin: false }));
    }
    if (call.text.startsWith("INSERT INTO production.jobs")) return [{ id: jobId }];
    return undefined;
  };
  const jobInserted = () => callsLike(/^INSERT INTO production\.jobs/);
  const create = async (roles: string[], body: Record<string, unknown>, owner: string | null) => {
    db.state.calls = [];
    db.state.handler = jobQueries(owner);
    return await failure(createJob(contextWith(roles), CreateJobRequestSchema.parse({ ...base, ...body })));
  };

  it("a Leader: only in a project they own, led by themselves", async () => {
    await create(["LEADER"], { leaderId: me }, me);
    expect(jobInserted()).toHaveLength(1);
    expect(jobInserted()[0]!.values).toContain(me);
    // The project check reads active projects only, with their owner.
    expect(callsLike(/AS owned FROM production\.projects p/)[0]!.text).toMatch(/AND p\.active$/);
    // PD-079: "own" = one of the owners (production.project_owners).
    expect(callsLike(/AS owned FROM production\.projects p/)[0]!.text).toContain("FROM production.project_owners po");

    for (const owner of [other, null]) {
      expect(await create(["LEADER"], { leaderId: me }, owner)).toEqual({
        code: "PROJECT_NOT_OWNED",
        status: 403,
        message: "Bạn chỉ tạo được job trong Project do mình phụ trách."
      });
      expect(jobInserted()).toHaveLength(0);
    }
    // Another Leader: refused before anything is read.
    expect(await create(["LEADER", "QC", "STAFF"], { leaderId: other }, me)).toEqual({
      code: "JOB_LEADER_LOCKED",
      status: 403,
      message: "Leader chỉ tạo được job do chính mình phụ trách."
    });
    expect(db.state.calls.filter((call) => !call.text.includes("production.settings"))).toHaveLength(0);
    // PD-073 still comes first: no Leader at all.
    expect(await create(["LEADER"], {}, me)).toMatchObject({ code: "JOB_LEADER_REQUIRED", status: 400 });
  });

  it("Admin and Account: any active project, any Leader; several roles take the most permissive rule", async () => {
    for (const roles of [["ADMIN"], ["ACCOUNT"], ["LEADER", "ACCOUNT"], ["LEADER", "ADMIN"]]) {
      await create(roles, { leaderId: other }, third);
      expect(jobInserted(), roles.join()).toHaveLength(1);
      expect(jobInserted()[0]!.values).toContain(other);
      await create(roles, { leaderId: other }, null);
      expect(jobInserted(), roles.join()).toHaveLength(1);
    }
    // The superadmin is an Admin.
    db.state.calls = [];
    db.state.handler = jobQueries(third);
    await failure(createJob(contextWith(["LEADER"], { superadmin: true }), CreateJobRequestSchema.parse({ ...base, leaderId: other })));
    expect(jobInserted()).toHaveLength(1);
  });
});

describe("PATCH /production/jobs/:id — a Leader moves a job only between their own projects (PD-078)", () => {
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
  /** `owners`: project id → its owner (both the current project and the target). */
  const editQueries = (owners: Record<string, string | null>, leaderId: string | null = me) => (call: Call) => {
    if (call.text.startsWith("SELECT code, name, project_id, leader_id")) return [jobEditRow(leaderId)];
    if (call.text.includes("AS owned FROM production.projects p")) {
      const id = call.values.find((value) => value === projectId || value === otherProjectId) as string;
      return id in owners ? [{ owned: owners[id] === me }] : [];
    }
    if (call.text.startsWith("SELECT assignee_id FROM production.tasks")) return [{ assignee_id: me }];
    if (call.text.includes("array_agg(ur.role_code)")) {
      const ids = call.values.find(Array.isArray) as string[];
      return ids.map((id) => ({ user_id: id, roles: ["LEADER"], superadmin: false }));
    }
    return undefined;
  };
  const jobUpdated = () => callsLike(/^UPDATE production\.jobs SET/);
  const patch = async (roles: string[], body: Record<string, unknown>, owners: Record<string, string | null>, leaderId: string | null = me) => {
    db.state.calls = [];
    db.state.handler = editQueries(owners, leaderId);
    return await failure(updateJob(contextWith(roles), jobId, UpdateJobRequestSchema.parse(body)));
  };

  it("a Leader: from one of their projects to another one of theirs only", async () => {
    await patch(["LEADER"], { projectId: otherProjectId }, { [projectId]: me, [otherProjectId]: me });
    expect(jobUpdated()).toHaveLength(1);
    expect(await patch(["LEADER"], { projectId: otherProjectId }, { [projectId]: me, [otherProjectId]: other })).toEqual({
      code: "PROJECT_NOT_OWNED",
      status: 403,
      message: "Bạn chỉ chuyển được job sang Project do mình phụ trách."
    });
    expect(jobUpdated()).toHaveLength(0);
    expect(await patch(["LEADER"], { projectId: otherProjectId }, { [projectId]: other, [otherProjectId]: me })).toEqual({
      code: "PROJECT_NOT_OWNED",
      status: 403,
      message: "Job này thuộc Project không do bạn phụ trách — bạn không chuyển được sang Project khác."
    });
    expect(jobUpdated()).toHaveLength(0);
    // Not a move: other edits of a job in someone else's project follow the job permission matrix as before.
    await patch(["LEADER"], { code: "B2", projectId }, { [projectId]: other });
    expect(jobUpdated()).toHaveLength(1);
  });

  it("a Leader names only themselves as the job's Leader; Admin / Account anyone", async () => {
    expect(await patch(["LEADER"], { leaderId: other }, { [projectId]: me })).toEqual({
      code: "JOB_LEADER_LOCKED",
      status: 403,
      message: "Leader chỉ đặt được chính mình làm Leader của job."
    });
    expect(jobUpdated()).toHaveLength(0);
    await patch(["LEADER"], { leaderId: me, code: "B2" }, { [projectId]: me }, other);
    expect(jobUpdated()).toHaveLength(1);
    // An older job without a leader: the Leader takes it (PD-073 needs one with the edit).
    await patch(["LEADER"], { leaderId: me, code: "B2" }, { [projectId]: me }, null);
    expect(jobUpdated()).toHaveLength(1);
    for (const roles of [["ACCOUNT"], ["ADMIN"], ["LEADER", "ACCOUNT"]]) {
      await patch(roles, { leaderId: other, projectId: otherProjectId }, { [projectId]: third, [otherProjectId]: null });
      expect(jobUpdated(), roles.join()).toHaveLength(1);
    }
  });
});

describe("Tôi quản lý = the projects I own (PD-078), on the list, the facets and Tổng quan", () => {
  it("scope=mine narrows the list to my projects' jobs; the Leader chip (leaderId) stays its own filter", async () => {
    await listJobs(contextWith(["LEADER"]), JobQuerySchema.parse({ scope: "mine" }));
    const page = callsLike(/^WITH page AS MATERIALIZED/)[0]!;
    expect(page.text).toContain(`AND ${ownedProject}`);
    expect(page.text).not.toContain("j.leader_id = $");
    expect(page.values).toContain(me);

    db.state.calls = [];
    await listJobs(contextWith(["LEADER"]), JobQuerySchema.parse({ scope: "all", leaderId: other }));
    const chip = callsLike(/^WITH page AS MATERIALIZED/)[0]!;
    expect(chip.text).not.toContain("production.project_owners op");
    expect(chip.text).toContain("AND j.leader_id = $");
    expect(chip.values).toContain(other);

    db.state.calls = [];
    await listJobs(contextWith(["LEADER"]), JobQuerySchema.parse({ scope: "mine", leaderId: other }));
    const both = callsLike(/^WITH page AS MATERIALIZED/)[0]!.text;
    expect(both).toContain(`AND ${ownedProject}`);
    expect(both).toContain("AND j.leader_id = $");
    expect(JobQuerySchema.safeParse({ scope: "team" }).success).toBe(false);
  });

  it("the overview takes scope=mine (leader=me kept as its older spelling)", () => {
    expect(ProductionOverviewQuerySchema.parse({ scope: "mine" })).toMatchObject({ scope: "mine" });
    expect(ProductionOverviewQuerySchema.parse({ scope: "all" })).toMatchObject({ scope: "all" });
    expect(ProductionOverviewQuerySchema.safeParse({ scope: "nobody" }).success).toBe(false);
    expect(ProductionOverviewQuerySchema.parse({ leader: "me" })).toMatchObject({ leader: "me" });
  });

  it("the sidebar lists every project in both tabs, sorted by code (Vietnamese collation, numbers in order)", async () => {
    const id = (n: number) => `99999999-9999-4999-8999-99999999999${n}`;
    db.state.handler = (call) =>
      call.text.startsWith("WITH counts AS")
        ? [
            { project_id: id(1), code: "Đ1", name: "Đ", active: true, owner_ids: null, count: 0 },
            { project_id: id(2), code: "B10", name: "B", active: true, owner_ids: [me], count: 2 },
            { project_id: id(3), code: "b2", name: "b", active: false, owner_ids: [other, me], count: 0 },
            { project_id: id(4), code: "D2", name: "D", active: true, owner_ids: null, count: 1 },
            { project_id: id(5), code: "AXP", name: "A", active: true, owner_ids: [me], count: 0 }
          ]
        : undefined;
    for (const scope of ["mine", "all"]) {
      const facets = JobFacetsSchema.parse(await getJobFacets(contextWith(["LEADER"]), JobQuerySchema.parse({ scope })));
      expect(facets.projects.map((project) => project.code)).toEqual(["AXP", "b2", "B10", "D2", "Đ1"]);
      expect(facets.projects.find((project) => project.code === "b2")).toMatchObject({
        active: false,
        count: 0,
        ownerId: other,
        ownerIds: [other, me]
      });
    }
    expect([{ code: "a", projectId: id(2) }, { code: "A", projectId: id(1) }].sort(compareProjectCodes).map((project) => project.code)).toEqual(["A", "a"]);
  });
});

describe("the work-log Excel columns (PD-078 names; both spellings read)", () => {
  it("the export writes Project / Job Code", () => {
    expect(workLogColumns.slice(0, 3).map((column) => column.header)).toEqual([
      "Nhân viên thực hiện",
      "Project",
      "Job Code (Folder hình, hỏi leader nếu không rõ)"
    ]);
  });

  it("an import reads the new and the old headers", () => {
    expect(workLogColumnOf("Project")).toBe("project");
    expect(workLogColumnOf("Dự án")).toBe("project");
    expect(workLogColumnOf("Job Code")).toBe("pkg");
    expect(workLogColumnOf(" Gói công việc (Folder hình, hỏi leader nếu không rõ) ")).toBe("pkg");
    expect(workLogColumnOf("Job Code (Folder hình, hỏi leader nếu không rõ)")).toBe("pkg");
    expect(workLogColumnOf("Ngày nhận")).toBe("received");
    expect(workLogColumnOf("Projects")).toBeNull();
    expect(Object.keys(workLogHeaders)).toHaveLength(11);
  });
});

describe("migration 20261021_0200 — the owner back-fill (PD-078)", () => {
  const file = new URL("../../../../supabase/manual_sql/20261021_0200_production_project_owner.sql", import.meta.url);

  it.runIf(existsSync(file))("adds nullable owner / creator columns idempotently and fills only missing owners by the agreed rule", () => {
    const text = readFileSync(file, "utf8").replace(/\s+/g, " ");
    expect(text).toContain("ADD COLUMN IF NOT EXISTS leader_id uuid REFERENCES public.app_users (id) ON DELETE SET NULL");
    expect(text).toContain("ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.app_users (id) ON DELETE SET NULL");
    expect(text).toContain("CREATE INDEX IF NOT EXISTS production_projects_leader_idx");
    // Owner = the Leader with the most live jobs (archived count), ties → latest job, then name (then id).
    expect(text).toContain("WHERE j.deleted_at IS NULL");
    expect(text).not.toContain("archived_at IS NULL");
    expect(text).toContain("ORDER BY led.jobs DESC, led.latest_job DESC, au.display_name, led.leader_id");
    expect(text).toContain("max(j.created_at) AS latest_job");
    // Only people who can own a project: active members holding LEADER / ADMIN, or the superadmin.
    expect(text).toContain("ur.role_code IN ('LEADER', 'ADMIN')");
    expect(text).toContain("r.key = 'superadmin'");
    // Projects with an owner are never touched; projects without such a job keep none; created_by is not back-filled.
    expect(text).toContain("AND p.leader_id IS NULL;");
    expect(text).toContain("WHERE ranked.position = 1");
    expect(text).not.toMatch(/SET created_by/);
  });
});
