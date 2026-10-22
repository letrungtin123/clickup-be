import { existsSync, readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  defaultJobPermissions,
  jobsBoundToOwnProjects,
  mayCreateProject,
  mayOwnProject,
  newProjectOwnerPick,
  ProductionMeSchema,
  ProductionProjectCollectionSchema,
  projectCapabilitiesFor,
  requestedProjectOwners,
  seesProjectPage,
  taskJobScopes,
  UpdateProductionProjectRequestSchema,
  UpsertProductionProjectRequestSchema,
  type ProductionRole
} from "../../contracts/production-catalog.js";
import {
  CreateJobRequestSchema,
  CreateSubtaskRequestSchema,
  CreateTaskLineSchema,
  CreateWorkEntryRequestSchema,
  JobOptionsQuerySchema,
  JobQuerySchema
} from "../../contracts/production-jobs.js";
import type { AccessContext } from "../access/access-context.js";
import type * as JobsRepoModule from "./jobs.repo.js";
import type { Workflow } from "./workflow.js";

/**
 * PD-079 — an Account creates Projects and Job Codes but no task; a Project may have several owners (only the superadmin
 * sets more than one). Without a database: a fake tagged-template `sql` records every statement (fragments inlined like
 * postgres.js) and answers from a per-test handler (as pd078.test.ts). Made-up ids, codes and names only: the repository
 * is public.
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

const { createProject, deleteProject, listProjects, newProjectOwners, projectHasJobsMessage, projectOwnerNeeded, updateProject } = await import(
  "./projects.service.js"
);
const { createJob, listJobOptions, listJobs } = await import("./jobs.service.js");
const { createProductionTasks } = await import("./tasks.service.js");
const { createProductionSubtask } = await import("./subtasks.service.js");
const { createWorkEntry } = await import("./work-entries.service.js");
const { getProductionMe } = await import("./catalog.service.js");
const { taskCapabilities } = await import("./jobs.repo.js");
const { clearProductionConfigCache } = await import("./catalog-cache.js");

const org = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const third = "44444444-4444-4444-8444-444444444444";
const fourth = "55555555-5555-4555-8555-555555555555";
const projectId = "88888888-8888-4888-8888-888888888881";
const newProjectId = "88888888-8888-4888-8888-888888888889";
const jobId = "66666666-6666-4666-8666-666666666666";
const taskId = "77777777-7777-4777-8777-777777777777";
const processId = "99999999-9999-4999-8999-999999999991";
const shiftId = "99999999-9999-4999-8999-999999999992";

const contextWith = (roles: string[], options: { superadmin?: boolean } = {}) =>
  ({
    user: { id: me },
    organization: { id: org },
    hasFullOrganizationAuthority: options.superadmin ?? false,
    productionRoles: roles,
    role: { permissions: [] }
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
const roles = (...list: ProductionRole[]) => list;
const forbiddenTask = { code: "TASK_CREATE_FORBIDDEN", status: 403, message: "Account không tạo task — chỉ tạo Project và Job Code." };

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = () => [];
  clearProductionConfigCache();
});

describe("the pure rules (contracts/production-catalog.ts)", () => {
  it("who owns, creates and sees Projects; how a new Project gets its owners", () => {
    expect(mayOwnProject(roles("LEADER"))).toBe(true);
    expect(mayOwnProject(roles("ADMIN"))).toBe(true);
    expect(mayOwnProject(roles("ACCOUNT"))).toBe(false);
    for (const role of ["LEADER", "ADMIN", "ACCOUNT"] as const) expect(mayCreateProject([role])).toBe(true);
    for (const role of ["QC", "STAFF", "DIRECTOR"] as const) expect(mayCreateProject([role])).toBe(false);
    for (const role of ["LEADER", "ADMIN", "DIRECTOR", "ACCOUNT"] as const) expect(seesProjectPage([role])).toBe(true);
    expect(seesProjectPage(roles("QC", "STAFF"))).toBe(false);

    expect(newProjectOwnerPick({ roles: roles("ADMIN", "DIRECTOR"), superadmin: true })).toBe("many");
    expect(newProjectOwnerPick({ roles: roles("ADMIN"), superadmin: false })).toBe("one");
    expect(newProjectOwnerPick({ roles: roles("ACCOUNT"), superadmin: false })).toBe("one");
    expect(newProjectOwnerPick({ roles: roles("LEADER", "ACCOUNT"), superadmin: false })).toBe("one");
    expect(newProjectOwnerPick({ roles: roles("LEADER", "QC"), superadmin: false })).toBe("self");
    expect(newProjectOwnerPick({ roles: roles("STAFF", "DIRECTOR"), superadmin: false })).toBeNull();
  });

  it("edit: any owner (holding LEADER / ADMIN), every Admin, the Account who created it; delete only without jobs", () => {
    const viewer = (list: ProductionRole[], superadmin = false) => ({ roles: list, me, superadmin });
    const project = (ownerIds: string[], createdById: string | null = null, hasJobs = false) => ({ ownerIds, createdById, hasJobs });
    // A co-owner Leader edits and deletes, never changes owners.
    expect(projectCapabilitiesFor(viewer(["LEADER"]), project([other, me]))).toEqual({
      canEdit: true,
      canChangeOwner: false,
      ownerEdit: "none",
      canDelete: true
    });
    expect(projectCapabilitiesFor(viewer(["LEADER"]), project([other])).canEdit).toBe(false);
    // An owner who lost LEADER keeps nothing (SEC2-04).
    expect(projectCapabilitiesFor(viewer(["STAFF"]), project([me])).canEdit).toBe(false);
    // The Account who created it: edit / delete, owners fixed; another Account's project: read-only.
    expect(projectCapabilitiesFor(viewer(["ACCOUNT"]), project([other], me))).toEqual({
      canEdit: true,
      canChangeOwner: false,
      ownerEdit: "none",
      canDelete: true
    });
    expect(projectCapabilitiesFor(viewer(["ACCOUNT"]), project([other], other)).canEdit).toBe(false);
    expect(projectCapabilitiesFor(viewer(["ACCOUNT"]), project([other], me, true)).canDelete).toBe(false);
    // An Admin: the single owner of a project with at most one; a list of several is read-only.
    expect(projectCapabilitiesFor(viewer(["ADMIN"]), project([other])).ownerEdit).toBe("one");
    expect(projectCapabilitiesFor(viewer(["ADMIN"]), project([])).ownerEdit).toBe("one");
    expect(projectCapabilitiesFor(viewer(["ADMIN"]), project([other, third]))).toEqual({
      canEdit: true,
      canChangeOwner: false,
      ownerEdit: "none",
      canDelete: true
    });
    // The superadmin: any list.
    expect(projectCapabilitiesFor(viewer(["ADMIN", "DIRECTOR"], true), project([other, third])).ownerEdit).toBe("many");
    // The Director reads.
    expect(projectCapabilitiesFor(viewer(["DIRECTOR"]), project([other], other)).canEdit).toBe(false);
  });

  it("task-creating scopes leave ACCOUNT out (most permissive of the other roles)", () => {
    const matrix = { ...defaultJobPermissions, STAFF: { view: "all", create: "own", update: "own", delete: "none" } } as const;
    expect(taskJobScopes(["ACCOUNT"], matrix).create).toBe("none");
    expect(taskJobScopes(["ACCOUNT"], matrix).update).toBe("none");
    expect(taskJobScopes(["ACCOUNT", "LEADER"], matrix).create).toBe("all");
    expect(taskJobScopes(["ACCOUNT", "STAFF"], matrix).create).toBe("own");
    expect(taskJobScopes(["ADMIN"], matrix).create).toBe("all");
    expect(jobsBoundToOwnProjects(roles("LEADER"))).toBe(true);
    expect(jobsBoundToOwnProjects(roles("LEADER", "ACCOUNT"))).toBe(false);
  });

  it("the request contracts: ownerIds (in order) or the PD-078 ownerId", () => {
    expect(requestedProjectOwners({})).toBeUndefined();
    expect(requestedProjectOwners({ ownerId: other })).toEqual([other]);
    expect(requestedProjectOwners({ ownerId: null })).toEqual([]);
    expect(requestedProjectOwners({ ownerIds: [third, other, third] })).toEqual([third, other]);
    expect(UpsertProductionProjectRequestSchema.safeParse({ code: "AXP", name: "Axon", ownerIds: [other, third] }).success).toBe(true);
    expect(UpsertProductionProjectRequestSchema.safeParse({ code: "AXP", name: "Axon", ownerIds: ["x"] }).success).toBe(false);
    expect(UpdateProductionProjectRequestSchema.parse({ ownerIds: [] })).toEqual({ ownerIds: [] });
  });
});

// Projects ---------------------------------------------------------------------------------------------------------------

const userJson = (id: string, name: string) => ({ id, display_name: name, email: null, avatar_url: null });
const projectRow = (overrides: Record<string, unknown> = {}) => ({
  id: projectId,
  code: "AXP",
  name: "Axon",
  description: null,
  client_id: null,
  client_name: null,
  qc_buffer_hours: 0,
  active: true,
  created_by: other,
  owners: [userJson(other, "Leader Hai"), userJson(me, "Người Thử")],
  creator: userJson(other, "Leader Hai"),
  created_at: new Date("2026-10-22T03:00:00Z"),
  job_count: 2,
  has_jobs: true,
  ...overrides
});
/**
 * The project queries: the list, the owner candidates (`candidates`: who may own), the locked row (`current`: its creator
 * and owners, undefined = no such project) and the "used" check.
 */
const projectQueries =
  (
    options: {
      current?: { createdBy: string | null; owners: string[] } | undefined;
      candidates?: string[];
      used?: boolean;
      rows?: Record<string, unknown>[];
    } = {}
  ) =>
  (call: Call) => {
    if (call.text.startsWith("SELECT p.id, p.code, p.name, p.description")) return options.rows ?? [projectRow()];
    if (call.text.startsWith("SELECT om.user_id FROM public.organization_memberships om")) {
      const ids = call.values.find(Array.isArray) as string[];
      return ids.filter((id) => (options.candidates ?? [me, other, third]).includes(id)).map((id) => ({ user_id: id }));
    }
    if (call.text.startsWith("SELECT created_by FROM production.projects") && call.text.endsWith("FOR UPDATE")) {
      return options.current === undefined ? [] : [{ created_by: options.current.createdBy }];
    }
    if (call.text.startsWith("SELECT user_id FROM production.project_owners")) {
      return (options.current?.owners ?? []).map((id) => ({ user_id: id }));
    }
    if (call.text.startsWith("INSERT INTO production.projects")) return [{ id: newProjectId }];
    if (call.text.includes("AS used")) return [{ used: options.used ?? false }];
    return undefined;
  };
const insertedProject = () => callsLike(/^INSERT INTO production\.projects/);
const ownerWrites = () => callsLike(/^INSERT INTO production\.project_owners/);
const ownerDeletes = () => callsLike(/^DELETE FROM production\.project_owners/);
const fieldUpdates = () => callsLike(/^UPDATE production\.projects SET code/);
const leaderMirror = () => callsLike(/^UPDATE production\.projects SET leader_id/);
const deleted = () => callsLike(/^DELETE FROM production\.projects/);

describe("GET /production/projects (PD-079)", () => {
  it("every owner in order (the first as `owner`), the creator and the caller's rights; Accounts may create", async () => {
    db.state.handler = projectQueries();
    const result = ProductionProjectCollectionSchema.parse(await listProjects(contextWith(["LEADER"])));
    expect(result).toMatchObject({ canCreate: true, ownerPick: "self" });
    expect(result.items[0]).toMatchObject({
      owners: [
        { id: other, displayName: "Leader Hai" },
        { id: me, displayName: "Người Thử" }
      ],
      owner: { id: other },
      createdBy: { id: other },
      capabilities: { canEdit: true, ownerEdit: "none", canDelete: false }
    });
    const text = db.state.calls[0]!.text;
    expect(text).toContain("FROM production.project_owners po JOIN public.app_users oa ON oa.id = po.user_id");
    expect(text).toContain("ORDER BY po.position, po.added_at, oa.display_name");
    for (const [list, pick] of [
      [["ACCOUNT"], "one"],
      [["ADMIN"], "one"],
      [["STAFF"], null]
    ] as const) {
      expect((await listProjects(contextWith([...list]))).ownerPick).toBe(pick);
    }
    expect((await listProjects(contextWith([], { superadmin: true }))).ownerPick).toBe("many");
    // A project without owners reads as empty.
    db.state.handler = projectQueries({ rows: [projectRow({ owners: null })] });
    expect((await listProjects(contextWith(["ADMIN"]))).items[0]).toMatchObject({ owners: [], owner: null });
  });
});

describe("POST /production/projects — Accounts too; several owners only for the superadmin (PD-079)", () => {
  const input = { code: "AXP", name: "Axon" };
  const create = async (list: string[], body: Record<string, unknown>, superadmin = false) => {
    db.state.calls = [];
    db.state.handler = projectQueries();
    return await failure(createProject(contextWith(list, { superadmin }), UpsertProductionProjectRequestSchema.parse({ ...input, ...body })));
  };

  it("an Account creates a project with exactly one owner (LEADER / ADMIN) and is recorded as its creator", async () => {
    expect(await create(["ACCOUNT"], { ownerIds: [other] })).toBeNull();
    expect(insertedProject()[0]!.values.slice(-2)).toEqual([other, me]);
    expect(ownerWrites()[0]!.values).toEqual(expect.arrayContaining([newProjectId, [other], me]));
    expect(leaderMirror()[0]!.values[0]).toBe(other);
    // The PD-078 single ownerId still works.
    expect(await create(["ACCOUNT"], { ownerId: other })).toBeNull();
    expect(await create(["ACCOUNT"], {})).toEqual({ code: "PROJECT_OWNER_REQUIRED", status: 400, message: "Chọn người phụ trách cho Project." });
    expect(await create(["ACCOUNT"], { ownerIds: [other, third] })).toEqual({
      code: "PROJECT_OWNERS_SUPERADMIN_ONLY",
      status: 403,
      message: "Chỉ Siêu quản trị đặt được nhiều người phụ trách cho một Project."
    });
    expect(insertedProject()).toHaveLength(0);
    // The owner must hold LEADER / ADMIN.
    expect(await create(["ACCOUNT"], { ownerIds: [fourth] })).toMatchObject({ code: "PROJECT_OWNER_INVALID", status: 400 });
    expect(insertedProject()).toHaveLength(0);
  });

  it("the superadmin names several owners in order; an Admin one; a Leader owns what they create", async () => {
    expect(await create([], { ownerIds: [third, other] }, true)).toBeNull();
    expect(ownerWrites()[0]!.values).toEqual(expect.arrayContaining([[third, other]]));
    expect(ownerWrites()[0]!.text).toContain("unnest($::uuid[]) WITH ORDINALITY AS x(user_id, ord)");
    expect(leaderMirror()[0]!.values[0]).toBe(third);
    expect(await create([], {}, true)).toMatchObject({ code: "PROJECT_OWNER_REQUIRED" });
    expect(await create(["ADMIN"], { ownerIds: [other, third] })).toMatchObject({ code: "PROJECT_OWNERS_SUPERADMIN_ONLY", status: 403 });
    expect(await create(["ADMIN"], { ownerIds: [other] })).toBeNull();
    expect(await create(["LEADER"], {})).toBeNull();
    expect(ownerWrites()[0]!.values).toEqual(expect.arrayContaining([[me]]));
    expect(await create(["LEADER"], { ownerIds: [me, other] })).toMatchObject({ code: "PROJECT_OWNER_LOCKED", status: 403 });
    for (const list of [["QC"], ["STAFF"], ["DIRECTOR"]]) {
      expect(await create(list, { ownerIds: [other] })).toMatchObject({ code: "FORBIDDEN", status: 403 });
    }
  });

  it("newProjectOwners: the rule itself", () => {
    expect(newProjectOwners(contextWith(["LEADER", "ACCOUNT"]), { ...input, ownerId: other })).toEqual([other]);
    expect(newProjectOwners(contextWith([], { superadmin: true }), { ...input, ownerIds: [other, third] })).toEqual([other, third]);
    expect(newProjectOwners(contextWith(["LEADER"]), input)).toEqual([me]);
  });
});

describe("PATCH /production/projects/:id — owners by the superadmin (several) or an Admin (one) only (PD-079)", () => {
  const patch = async (
    list: string[],
    body: Record<string, unknown>,
    current: { createdBy: string | null; owners: string[] } | undefined,
    superadmin = false
  ) => {
    db.state.calls = [];
    db.state.handler = projectQueries({ current });
    return await failure(updateProject(contextWith(list, { superadmin }), projectId, UpdateProductionProjectRequestSchema.parse(body)));
  };

  it("an Account edits / renames the projects they created, never their owners; others' projects are read-only", async () => {
    expect(await patch(["ACCOUNT"], { name: "Axon mới", code: "AXN", active: false }, { createdBy: me, owners: [other] })).toBeNull();
    expect(fieldUpdates()).toHaveLength(1);
    expect(await patch(["ACCOUNT"], { ownerIds: [third] }, { createdBy: me, owners: [other] })).toEqual({
      code: "FORBIDDEN",
      status: 403,
      message: "Chỉ Quản trị mới đổi được người phụ trách Project."
    });
    // Sending the same owner back is no change.
    expect(await patch(["ACCOUNT"], { ownerId: other, name: "X" }, { createdBy: me, owners: [other] })).toBeNull();
    expect(await patch(["ACCOUNT"], { name: "X" }, { createdBy: other, owners: [other] })).toEqual({
      code: "FORBIDDEN",
      status: 403,
      message: "Bạn chỉ sửa được Project do mình phụ trách hoặc mình tạo."
    });
    expect(fieldUpdates()).toHaveLength(0);
  });

  it("an Admin changes the single owner; a project with several owners is read-only for them (other fields stay editable)", async () => {
    expect(await patch(["ADMIN"], { ownerIds: [third] }, { createdBy: null, owners: [other] })).toBeNull();
    expect(ownerDeletes()[0]!.values).toEqual(expect.arrayContaining([[third]]));
    expect(ownerWrites()[0]!.values).toEqual(expect.arrayContaining([[third]]));
    expect(leaderMirror()[0]!.values[0]).toBe(third);
    expect(await patch(["ADMIN"], { ownerIds: [other, third] }, { createdBy: null, owners: [other] })).toMatchObject({
      code: "PROJECT_OWNERS_SUPERADMIN_ONLY",
      status: 403
    });
    expect(await patch(["ADMIN"], { ownerIds: [third] }, { createdBy: null, owners: [other, me] })).toEqual({
      code: "PROJECT_OWNERS_SUPERADMIN_ONLY",
      status: 403,
      message: "Project có nhiều người phụ trách — chỉ Siêu quản trị đổi được danh sách này."
    });
    expect(ownerWrites()).toHaveLength(0);
    expect(await patch(["ADMIN"], { name: "Tên mới", ownerIds: [other, me] }, { createdBy: null, owners: [other, me] })).toBeNull();
    expect(fieldUpdates()).toHaveLength(1);
    expect(ownerWrites()).toHaveLength(0);
  });

  it("the superadmin sets any list (≥ 1); only the newly added are checked; a co-owner Leader edits but never changes owners", async () => {
    expect(await patch([], { ownerIds: [third, other, me] }, { createdBy: null, owners: [other] }, true)).toBeNull();
    const check = callsLike(/^SELECT om\.user_id FROM public\.organization_memberships om/)[0]!;
    expect(check.values).toEqual(expect.arrayContaining([[third, me]]));
    expect(ownerWrites()[0]!.values).toEqual(expect.arrayContaining([[third, other, me]]));
    expect(await patch([], { ownerIds: [] }, { createdBy: null, owners: [other] }, true)).toMatchObject({ code: "PROJECT_OWNER_REQUIRED", status: 400 });
    expect(await patch(["LEADER"], { name: "X" }, { createdBy: null, owners: [other, me] })).toBeNull();
    expect(await patch(["LEADER"], { ownerIds: [me] }, { createdBy: null, owners: [other, me] })).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(await patch(["LEADER"], { name: "X" }, { createdBy: null, owners: [other] })).toMatchObject({ status: 403 });
  });

  it("an older project without owners: an Admin must pick one to edit it (switching it on / off alone is fine)", async () => {
    expect(await patch(["ADMIN"], { name: "X" }, { createdBy: null, owners: [] })).toMatchObject({ code: "PROJECT_OWNER_REQUIRED" });
    expect(await patch(["ADMIN"], { active: false }, { createdBy: null, owners: [] })).toBeNull();
    expect(await patch(["ADMIN"], { name: "X", ownerIds: [other] }, { createdBy: null, owners: [] })).toBeNull();
    expect(projectOwnerNeeded({ name: "X" }, 0)).toBe(true);
    expect(projectOwnerNeeded({ name: "X", ownerIds: [other] }, 0)).toBe(false);
    expect(projectOwnerNeeded({ name: "X" }, 2)).toBe(false);
  });
});

describe("DELETE /production/projects/:id — the creating Account, an owner or an Admin; never with jobs (PD-079)", () => {
  const remove = async (list: string[], current: { createdBy: string | null; owners: string[] }, used: boolean) => {
    db.state.calls = [];
    db.state.handler = projectQueries({ current, used, rows: [] });
    return await failure(deleteProject(contextWith(list), projectId));
  };

  it("an Account deletes a job-less project they created; with jobs 409; not theirs 403", async () => {
    expect(await remove(["ACCOUNT"], { createdBy: me, owners: [other] }, false)).toBeNull();
    expect(deleted()).toHaveLength(1);
    expect(await remove(["ACCOUNT"], { createdBy: me, owners: [other] }, true)).toEqual({
      code: "PROJECT_HAS_JOBS",
      status: 409,
      message: projectHasJobsMessage
    });
    expect(await remove(["ACCOUNT"], { createdBy: other, owners: [other] }, false)).toEqual({
      code: "FORBIDDEN",
      status: 403,
      message: "Bạn chỉ xoá được Project do mình phụ trách hoặc mình tạo."
    });
    expect(deleted()).toHaveLength(0);
    // A co-owner Leader too.
    expect(await remove(["LEADER"], { createdBy: null, owners: [other, me] }, false)).toBeNull();
  });
});

// Jobs ----------------------------------------------------------------------------------------------------------------------

describe("Jobs: Account creates Job Codes; a Leader co-owner creates jobs led by themselves (PD-079)", () => {
  const base = { projectId, code: "Batch 9", receivedAt: "2026-10-12T00:00:00+07:00", deadline: "2026-10-13T23:59:00+07:00" };
  const jobQueries = (owned: boolean) => (call: Call) => {
    if (call.text.includes("AS owned FROM production.projects p")) return [{ owned }];
    if (call.text.includes("array_agg(ur.role_code)")) {
      const ids = call.values.find(Array.isArray) as string[];
      return ids.map((id) => ({ user_id: id, roles: ["LEADER"], superadmin: false }));
    }
    if (call.text.startsWith("INSERT INTO production.jobs")) return [{ id: jobId }];
    return undefined;
  };
  const create = async (list: string[], body: Record<string, unknown>, owned: boolean) => {
    db.state.calls = [];
    db.state.handler = jobQueries(owned);
    return await failure(createJob(contextWith(list), CreateJobRequestSchema.parse({ ...base, ...body })));
  };

  it("an Account still creates a job (Job Code) in any project with any Leader", async () => {
    await create(["ACCOUNT"], { leaderId: other }, false);
    expect(callsLike(/^INSERT INTO production\.jobs/)).toHaveLength(1);
  });

  it("a Leader who is one of several owners creates jobs there, led by themselves", async () => {
    await create(["LEADER"], { leaderId: me }, true);
    expect(callsLike(/^INSERT INTO production\.jobs/)).toHaveLength(1);
    expect(callsLike(/AS owned FROM production\.projects p/)[0]!.text).toContain(
      "SELECT 1 FROM production.project_owners po WHERE po.organization_id = p.organization_id AND po.project_id = p.id AND po.user_id = $"
    );
    expect(await create(["LEADER"], { leaderId: me }, false)).toMatchObject({ code: "PROJECT_NOT_OWNED", status: 403 });
    expect(await create(["LEADER"], { leaderId: other }, true)).toMatchObject({ code: "JOB_LEADER_LOCKED", status: 403 });
  });

  it("Tôi quản lý = the projects where I am one of the owners", async () => {
    await listJobs(contextWith(["LEADER"]), JobQuerySchema.parse({ scope: "mine" }));
    expect(callsLike(/^WITH page AS MATERIALIZED/)[0]!.text).toContain(
      "AND EXISTS ( SELECT 1 FROM production.project_owners op WHERE op.organization_id = j.organization_id AND op.project_id = j.project_id AND op.user_id = $ )"
    );
  });
});

// Tasks ---------------------------------------------------------------------------------------------------------------------

describe("Account creates no task, on every path (PD-079)", () => {
  const line = CreateTaskLineSchema.parse({ assigneeId: other, processId, shiftId, qcId: third });
  const taskRow = {
    id: taskId,
    number: "12",
    job_id: jobId,
    job_leader_id: other,
    job_archived: false,
    parent_task_id: null,
    kind: "NORMAL",
    process_is_qc: false,
    process_id: processId,
    assignee_id: other,
    qc_id: third,
    qty_assigned: 10,
    done_at: null,
    closed_at: null,
    checked_at: null
  };
  const handler = (call: Call) => {
    if (call.text.includes("FROM production.jobs j JOIN production.projects p")) {
      return [{ id: jobId, leader_id: other, received_at: new Date(), deadline: new Date(), total_images: 0, total_images_manual: false, qc_buffer_hours: 0, archived_at: null }];
    }
    if (call.text.startsWith("SELECT job_id FROM production.tasks")) return [{ job_id: jobId }];
    if (call.text.startsWith("SELECT t.id, t.number, t.job_id")) return [taskRow];
    return undefined;
  };
  const taskInserts = () => callsLike(/^INSERT INTO production\.tasks/);

  it("Chia task (POST /jobs/:id/tasks), Nhập Task (POST /work-entries), its Job Code picker and subtasks: 403 TASK_CREATE_FORBIDDEN", async () => {
    db.state.handler = handler;
    expect(await failure(createProductionTasks(contextWith(["ACCOUNT"]), jobId, [line]))).toEqual(forbiddenTask);
    const entry = CreateWorkEntryRequestSchema.parse({
      projectId,
      jobId,
      processId,
      shiftId,
      assignedAt: "2026-10-12T00:00:00+07:00",
      deadline: "2026-10-13T23:59:00+07:00",
      qcId: third
    });
    expect(await failure(createWorkEntry(contextWith(["ACCOUNT"]), entry))).toEqual(forbiddenTask);
    expect(await failure(listJobOptions(contextWith(["ACCOUNT"]), JobOptionsQuerySchema.parse({ projectId })))).toEqual(forbiddenTask);
    expect(await failure(createProductionSubtask(contextWith(["ACCOUNT"]), taskId, CreateSubtaskRequestSchema.parse({ processId: shiftId })))).toEqual(
      forbiddenTask
    );
    expect(taskInserts()).toHaveLength(0);
    // Nothing of the work entry was read: refused first.
    expect(callsLike(/FROM production\.projects WHERE/)).toHaveLength(0);
  });

  it("a member who also holds LEADER keeps their rights (most permissive role wins)", async () => {
    db.state.handler = handler;
    expect((await failure(createProductionTasks(contextWith(["ACCOUNT", "LEADER"]), jobId, [line])))?.code).not.toBe("TASK_CREATE_FORBIDDEN");
    expect((await failure(createProductionSubtask(contextWith(["ACCOUNT", "LEADER"]), taskId, CreateSubtaskRequestSchema.parse({ processId: shiftId }))))?.code).not.toBe(
      "TASK_CREATE_FORBIDDEN"
    );
    // STAFF (create none by default) still hears the old FORBIDDEN, not the Account wording.
    expect(await failure(createProductionTasks(contextWith(["STAFF"]), jobId, [line]))).toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("/production/me: an Account's jobPermissions.create stays 'all' (Job Codes) while taskCreate is 'none'", async () => {
    const account = ProductionMeSchema.parse(await getProductionMe(contextWith(["ACCOUNT"])));
    expect(account.jobPermissions.create).toBe("all");
    expect(account.taskCreate).toBe("none");
    expect((await getProductionMe(contextWith(["ACCOUNT", "LEADER"]))).taskCreate).toBe("all");
    expect((await getProductionMe(contextWith(["STAFF"]))).taskCreate).toBe("none");
    expect((await getProductionMe(contextWith([], { superadmin: true }))).taskCreate).toBe("all");
  });

  it("task capabilities: an Account edits a line through 'update: all' but splits no subtask", () => {
    const row = { ...taskRow, created_by: other, pending_qty_request: null } as unknown as Parameters<typeof taskCapabilities>[0];
    const all = { view: "all", create: "all", update: "all", delete: "all" } as const;
    const account = taskCapabilities(row, { scopes: all, userId: me, taskUpdateScope: "none" });
    expect(account.canEdit).toBe(true);
    expect(account.canCreateSubtask).toBe(false);
    expect(taskCapabilities(row, { scopes: all, userId: me, taskUpdateScope: "all" }).canCreateSubtask).toBe(true);
    // Their own line / the job's Leader still split.
    expect(taskCapabilities({ ...row, assignee_id: me }, { scopes: all, userId: me, taskUpdateScope: "none" }).canCreateSubtask).toBe(true);
    expect(taskCapabilities(row, { scopes: all, userId: me, taskUpdateScope: "none" }, true).canCreateSubtask).toBe(true);
  });
});

describe("migration 20261022_0100 — project owners (PD-079)", () => {
  const file = new URL("../../../../supabase/manual_sql/20261022_0100_production_project_owners.sql", import.meta.url);

  it.runIf(existsSync(file))("creates the owners table idempotently and back-fills it from the PD-078 owner", () => {
    const text = readFileSync(file, "utf8").replace(/\s+/g, " ");
    expect(text).toContain("CREATE TABLE IF NOT EXISTS production.project_owners");
    expect(text).toContain("PRIMARY KEY (project_id, user_id)");
    expect(text).toContain("REFERENCES production.projects (organization_id, id) ON DELETE CASCADE");
    expect(text).toContain("ENABLE ROW LEVEL SECURITY");
    expect(text).toContain("SELECT p.organization_id, p.id, p.leader_id, 0, p.created_by, now() FROM production.projects p WHERE p.leader_id IS NOT NULL");
    expect(text).toContain("ON CONFLICT (project_id, user_id) DO NOTHING");
    expect(text).not.toMatch(/DROP COLUMN/);
  });
});
