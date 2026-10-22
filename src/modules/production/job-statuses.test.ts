import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CreateJobStatusRequestSchema,
  DeleteJobStatusQuerySchema,
  UpdateJobStatusRequestSchema as UpdateCatalogStatusSchema
} from "../../contracts/production-catalog.js";
import { CreateJobRequestSchema, JobOptionsQuerySchema, JobQuerySchema, UpdateJobStatusRequestSchema } from "../../contracts/production-jobs.js";
import type { AccessContext } from "../access/access-context.js";
import type * as JobsRepoModule from "./jobs.repo.js";
import type { JobRow, TaskRow } from "./jobs.repo.js";
import type { Workflow } from "./workflow.js";

/**
 * PD-038 — the manual job status (ClickUp-style catalog, separate from the line workflow) and the "Gói công việc" picker
 * of "Nhập công việc", without a database: a fake tagged-template `sql` records every statement and answers from a
 * per-test handler (as security.test.ts). Fake names and ids only: the repository is public.
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
const realtime = vi.hoisted(() => ({ published: [] as unknown[][] }));

vi.mock("../../lib/redis.js", () => ({
  hasRedisConfig: () => false,
  getOptionalRedis: () => undefined,
  getRedis: () => {
    throw new Error("Redis is not available in this test");
  }
}));
vi.mock("../../db/client.js", () => ({ getSql: () => db.sql }));
vi.mock("./realtime.js", () => ({
  publishProductionChange: vi.fn((...args: unknown[]) => {
    realtime.published.push(args);
  }),
  jobAudience: vi.fn(() => Promise.resolve([]))
}));
vi.mock("./job-chat.service.js", () => ({ syncJobChat: vi.fn(() => Promise.resolve()) }));
vi.mock("./jobs.repo.js", async (importOriginal) => ({
  ...(await importOriginal<typeof JobsRepoModule>()),
  loadWorkflowModel: vi.fn(() => Promise.resolve({ statuses: [], transitions: [] } satisfies Workflow))
}));

const { jobStatusChangeAllowed, workEntryAllowed } = await import("./job-permissions.js");
const { changeJobStatus, createJob, getJobDetail, listJobOptions, listJobs } = await import("./jobs.service.js");
const { createJobStatus, deleteJobStatus, listJobStatuses, reorderJobStatuses, updateJobStatus } = await import("./job-statuses.service.js");
const { clearProductionConfigCache } = await import("./catalog-cache.js");

const org = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const worker = "33333333-3333-4333-8333-333333333333";
const jobId = "66666666-6666-4666-8666-666666666666";
const projectId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const statusNew = "a1111111-1111-4111-8111-111111111111";
const statusDoing = "a2222222-2222-4222-8222-222222222222";
const statusDelivered = "a3333333-3333-4333-8333-333333333333";

const contextWith = (roles: string[], superadmin = false) =>
  ({ user: { id: me }, organization: { id: org }, hasFullOrganizationAuthority: superadmin, productionRoles: roles, role: { permissions: [] } }) as unknown as AccessContext;
/** PD-050: the job status catalog is configuration, written by the organization superadmin only. */
const owner = contextWith([], true);

const catalog = [
  { id: statusNew, name: "Mới nhận", color: "slate", is_closed: false, requires_all_checked: false },
  { id: statusDoing, name: "Đang làm", color: "blue", is_closed: false, requires_all_checked: false },
  { id: statusDelivered, name: "Đã giao khách", color: "green", is_closed: true, requires_all_checked: false }
];
const userJson = (id: string) => ({ id, display_name: `User ${id.slice(0, 4)}`, email: null, avatar_url: null });

const jobRow = (overrides: Partial<JobRow> = {}): JobRow => ({
  id: jobId,
  number: 1,
  code: "Folder/Batch 1",
  name: null,
  project_id: projectId,
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
  job_status_id: statusNew,
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
  created_at: new Date("2026-10-01T01:00:00Z"),
  created_cursor: "2026-10-01T01:00:00.000000Z",
  received_cursor: "2026-10-01T01:00:00.000000Z",
  archived_at: null,
  ...overrides
});

const taskRow = (assigneeId: string): TaskRow => ({
  id: "55555555-5555-4555-8555-555555555555",
  number: 7,
  job_id: jobId,
  job_code: "Folder/Batch 1",
  job_leader_id: null,
  project_id: projectId,
  project_code: "P1",
  project_name: "Project",
  assignee_id: assigneeId,
  assignee: userJson(assigneeId),
  qc_id: null,
  qc: null,
  process_id: "77777777-7777-4777-8777-777777777777",
  process_name: "Retouch",
  process_is_qc: false,
  shift_id: "88888888-8888-4888-8888-888888888888",
  shift_name: "Chính thức",
  pay_mode: "POINTS",
  requires_ot_hours: false,
  qty_assigned: 10,
  qty_done: null,
  error_qty: null,
  ot_hours: null,
  assigned_at: new Date("2026-10-10T17:00:00Z"),
  deadline: new Date("2099-01-01T00:00:00Z"),
  done_at: null,
  checked_at: null,
  status_id: "PROCESSING",
  status_code: "PROCESSING",
  status_name: "Đang làm",
  status_color: "blue",
  kind: "NORMAL",
  parent_task_id: null,
  feedback_id: null,
  note: null,
  work_link: null,
  is_late: false,
  qc_fail_count: 0,
  custom_values: {},
  tag_ids: null,
  created_at: new Date("2026-10-10T02:00:00Z"),
  updated_at: new Date("2026-10-10T02:00:00Z"),
  closed_at: null,
  deadline_cursor: "2099-01-01 00:00:00.000000+00",
  job_archived: false,
  job_open_feedback: false,
  split_reason: null,
  created_by: null,
  sub_seq: null,
  parent_number: null,
  subtasks: null,
  pending_qty_request: null
});

/** The job (locked for a status change), its lines, the catalog and the detail read afterwards. */
const jobQueries = (options: { mine?: boolean; leaderId?: string | null; archived?: boolean; current?: string; assignee?: string } = {}) => (call: Call) => {
  if (call.text.startsWith("SELECT j.leader_id, j.archived_at, j.job_status_id")) {
    return [
      { leader_id: options.leaderId ?? null, archived_at: options.archived ? new Date() : null, job_status_id: options.current ?? statusNew, mine: options.mine ?? false }
    ];
  }
  if (call.text.includes("AND (t.assignee_id = $ OR t.qc_id = $)")) {
    // "own" view: the caller works on / checks a line of the job.
    return options.mine ? [{ "?column?": 1 }] : [];
  }
  if (call.text.startsWith("SELECT id, name, color, is_closed, requires_all_checked FROM production.job_statuses WHERE organization_id = $ AND id = $")) {
    return catalog.filter((row) => row.id === call.values[1]);
  }
  if (call.text.includes("AS created_cursor")) {
    return [jobRow({ leader_id: options.leaderId ?? null })];
  }
  if (call.text.includes("AS job_leader_id")) {
    return options.assignee ? [taskRow(options.assignee)] : [];
  }
  return undefined;
};

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return { code: (error as { code?: string }).code, status: (error as { statusCode?: number }).statusCode, message: (error as Error).message };
  }
  return null;
};
const callsLike = (pattern: RegExp) => db.state.calls.filter((call) => pattern.test(call.text));

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = () => [];
  realtime.published = [];
  clearProductionConfigCache();
});

describe("manual job status — who may change it (PD-038)", () => {
  it("update all, or own when I am the assignee of a live line or the job's leader", () => {
    expect(jobStatusChangeAllowed("all", { assignee: false, leads: false })).toBe(true);
    expect(jobStatusChangeAllowed("own", { assignee: true, leads: false })).toBe(true);
    expect(jobStatusChangeAllowed("own", { assignee: false, leads: true })).toBe(true);
    expect(jobStatusChangeAllowed("own", { assignee: false, leads: false })).toBe(false);
    expect(jobStatusChangeAllowed("none", { assignee: true, leads: true })).toBe(false);
    expect(workEntryAllowed("own")).toBe(true);
    expect(workEntryAllowed("all")).toBe(true);
    expect(workEntryAllowed("none")).toBe(false);
  });

  it("staff without a line of the job get 403 (QC-only involvement does not count); nothing is written", async () => {
    // A QC of a line sees the job ("own" view) but is not its assignee.
    db.state.handler = (call) =>
      call.text.includes("AND (t.assignee_id = $ OR t.qc_id = $)") ? [{ "?column?": 1 }] : jobQueries({ mine: false })(call);
    const result = await failure(changeJobStatus(contextWith(["STAFF"]), jobId, UpdateJobStatusRequestSchema.parse({ statusId: statusDoing })));
    expect(result).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(result?.message).toContain("job mà bạn được giao");
    expect(callsLike(/^UPDATE production\.jobs/)).toHaveLength(0);
    expect(callsLike(/^INSERT INTO production\.task_logs/)).toHaveLength(0);
  });

  it("the assignee of a line changes it: one UPDATE, a JOB history row from → to, a live-sync hint; the line workflow is untouched", async () => {
    db.state.handler = jobQueries({ mine: true, assignee: me });
    const job = await changeJobStatus(contextWith(["STAFF"]), jobId, { statusId: statusDoing });
    const update = callsLike(/^UPDATE production\.jobs SET job_status_id/);
    expect(update).toHaveLength(1);
    expect(update[0]!.values).toEqual([statusDoing, org, jobId]);
    const log = callsLike(/^INSERT INTO production\.task_logs/)[0]!;
    expect(log.text).toContain("'JOB'");
    expect(log.values).toContainEqual({ jobStatusId: statusNew, jobStatusName: "Mới nhận", jobStatusColor: "slate" });
    expect(log.values).toContainEqual({ jobStatusId: statusDoing, jobStatusName: "Đang làm", jobStatusColor: "blue" });
    expect(realtime.published).toEqual([[org, jobId, [], "job", me]]);
    // No task is moved and no workflow status is written.
    expect(callsLike(/production\.tasks SET|status_id = /).filter((call) => !call.text.includes("job_status_id"))).toHaveLength(0);
    expect(job.capabilities.canChangeStatus).toBe(true);
  });

  it("the job's leader may change it with own; ADMIN always, even without lines", async () => {
    db.state.handler = jobQueries({ mine: false, leaderId: me });
    await changeJobStatus(contextWith(["LEADER"]), jobId, { statusId: statusDelivered });
    expect(callsLike(/^UPDATE production\.jobs SET job_status_id/)).toHaveLength(1);
    db.state.calls = [];
    db.state.handler = jobQueries({ mine: false });
    const job = await changeJobStatus(contextWith(["ADMIN"]), jobId, { statusId: statusDelivered });
    expect(callsLike(/^UPDATE production\.jobs SET job_status_id/)).toHaveLength(1);
    expect(job.capabilities.canChangeStatus).toBe(true);
  });

  it("the same status writes nothing; an unknown status is a 400; an archived job is read-only", async () => {
    db.state.handler = jobQueries({ mine: true, assignee: me, current: statusDoing });
    await changeJobStatus(contextWith(["STAFF"]), jobId, { statusId: statusDoing });
    expect(callsLike(/^UPDATE production\.jobs/)).toHaveLength(0);
    expect(callsLike(/^INSERT INTO production\.task_logs/)).toHaveLength(0);
    expect(realtime.published).toHaveLength(0);
    expect(await failure(changeJobStatus(contextWith(["ADMIN"]), jobId, { statusId: "a9999999-9999-4999-8999-999999999999" }))).toMatchObject({
      code: "JOB_STATUS_NOT_FOUND",
      status: 400
    });
    db.state.handler = jobQueries({ archived: true });
    expect(await failure(changeJobStatus(contextWith(["ADMIN"]), jobId, { statusId: statusDoing }))).toMatchObject({ code: "JOB_ARCHIVED", status: 409 });
  });

  it("job detail: canChangeStatus for the assignee, not for someone else's job (own) — the chip is read-only", async () => {
    db.state.handler = jobQueries({ assignee: me });
    expect((await getJobDetail(contextWith(["STAFF"]), jobId)).capabilities.canChangeStatus).toBe(true);
    db.state.handler = jobQueries({ assignee: worker });
    expect((await getJobDetail(contextWith(["ACCOUNT"]), jobId)).capabilities.canChangeStatus).toBe(true);
    // A QC who only checks lines of the job: sees it, cannot change its status.
    db.state.handler = (call) =>
      call.text.includes("AS job_leader_id") ? [{ ...taskRow(worker), qc_id: me, qc: userJson(me) }] : jobQueries({ assignee: worker })(call);
    const detail = await getJobDetail(contextWith(["QC"]), jobId);
    expect(detail.capabilities.canChangeStatus).toBe(false);
    expect(detail.jobStatus).toEqual({ id: statusNew, name: "Mới nhận", color: "slate", isClosed: false, requiresAllChecked: false });
    // PD-045: no job-level line moves, the feedback feature retired; uncheckedTaskCount from the job aggregate.
    expect(detail.capabilities).toMatchObject({ bulkActions: [], canFeedback: false, canCloseFeedback: false });
    expect(detail.uncheckedTaskCount).toBe(0);
    const jobQuery = callsLike(/AS created_cursor/)[0]!;
    expect(jobQuery.text).toContain("js.requires_all_checked AS job_status_requires_all_checked");
    expect(jobQuery.text).toContain("AS unchecked_task_count");
  });
});

describe("job list, create job and the work-entry picker (PD-038)", () => {
  it("the list filters by manual statuses (any of them)", async () => {
    db.state.handler = () => [];
    await listJobs(contextWith(["LEADER"]), JobQuerySchema.parse({ jobStatusId: [statusNew, statusDoing] }));
    const page = callsLike(/WITH page AS MATERIALIZED/)[0]!;
    expect(page.text).toContain("AND j.job_status_id = ANY($::uuid[])");
    expect(page.values).toContainEqual([statusNew, statusDoing]);
  });

  it("Tạo job: the chosen Trạng thái is checked and stored; without one the trigger takes the first status", async () => {
    // PD-073: the Leader is required (here the creator, holding LEADER).
    const base = { projectId, code: "Batch 9", leaderId: me, receivedAt: "2026-10-12T00:00:00+07:00", deadline: "2026-10-13T23:59:00+07:00" };
    db.state.handler = (call) =>
      call.text.includes("AS owned FROM production.projects p") ? [{ owned: true }]
      : call.text.includes("array_agg(ur.role_code)") ? [{ user_id: me, roles: ["LEADER"], superadmin: false }]
      : call.text.startsWith("INSERT INTO production.jobs") ? [{ id: jobId }]
      : jobQueries()(call);
    await createJob(contextWith(["LEADER"]), CreateJobRequestSchema.parse({ ...base, jobStatusId: statusDoing }));
    expect(callsLike(/^INSERT INTO production\.jobs/)[0]!.values).toContain(statusDoing);
    db.state.calls = [];
    await createJob(contextWith(["LEADER"]), CreateJobRequestSchema.parse(base));
    const insert = callsLike(/^INSERT INTO production\.jobs/)[0]!;
    expect(insert.text).toContain("job_status_id");
    expect(insert.values).toContain(null);
    db.state.calls = [];
    expect(await failure(createJob(contextWith(["LEADER"]), CreateJobRequestSchema.parse({ ...base, jobStatusId: "a9999999-9999-4999-8999-999999999999" })))).toMatchObject({
      code: "JOB_STATUS_NOT_FOUND",
      status: 400
    });
    expect(callsLike(/^INSERT INTO production\.jobs/)).toHaveLength(0);
  });

  it("options: create own or all only; every live, unarchived job of the project, open statuses first, then Ngày giao", async () => {
    const rows = [0, 1, 2].map((index) => ({
      id: `b${index}111111-1111-4111-8111-111111111111`,
      code: `Batch ${index}`,
      project_id: projectId,
      deadline: new Date("2026-10-12T16:59:00Z"),
      job_status_id: statusDelivered,
      job_status_name: "Đã giao khách",
      job_status_color: "green",
      job_status_closed: true,
      job_status_requires_all_checked: false
    }));
    db.state.handler = (call) => (call.text.includes("FROM production.jobs j JOIN production.job_statuses js") ? rows : undefined);
    // Since PD-051 neither STAFF nor QC enters work by default: the picker is for "create" own / all (Leader here).
    const result = await listJobOptions(contextWith(["LEADER"]), JobOptionsQuerySchema.parse({ projectId, q: "Bátch", statusIds: statusDelivered, limit: "2" }));
    const query = callsLike(/FROM production\.jobs j JOIN production\.job_statuses js/)[0]!;
    expect(query.text).toContain("j.deleted_at IS NULL AND j.archived_at IS NULL");
    expect(query.text).toContain("ORDER BY js.is_closed, j.deadline DESC, j.id DESC");
    expect(query.text).toContain("public.immutable_unaccent(lower(j.code");
    expect(query.values).toContain("%bátch%");
    expect(query.values).toContainEqual([statusDelivered]);
    expect(query.values).toContain(3);
    // Closed jobs are offered too; only minimal fields; the extra row says "type to narrow".
    expect(result.items).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(Object.keys(result.items[0]!).sort()).toEqual(["code", "deadline", "id", "jobStatus", "projectId"]);
    expect(result.items[0]!.jobStatus).toEqual({ id: statusDelivered, name: "Đã giao khách", color: "green", isClosed: true, requiresAllChecked: false });
  });

  it("options: create none is refused (403) even with view all", async () => {
    db.state.handler = (call) =>
      call.text.startsWith("SELECT key, value FROM production.settings")
        ? [
            {
              key: "job_permissions",
              value: {
                ACCOUNT: { view: "all", create: "none", update: "all", delete: "all" },
                LEADER: { view: "all", create: "all", update: "all", delete: "all" },
                QC: { view: "own", create: "own", update: "own", delete: "own" },
                STAFF: { view: "own", create: "own", update: "own", delete: "own" }
              }
            }
          ]
        : undefined;
    // PD-079: an Account never enters tasks, whatever its "create" (TASK_CREATE_FORBIDDEN); a role whose create is none: FORBIDDEN.
    expect(await failure(listJobOptions(contextWith(["ACCOUNT"]), JobOptionsQuerySchema.parse({ projectId })))).toMatchObject({
      code: "TASK_CREATE_FORBIDDEN",
      status: 403
    });
    expect(await failure(listJobOptions(contextWith(["DIRECTOR"]), JobOptionsQuerySchema.parse({ projectId })))).toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("options: STAFF has create none by default (PD-047) — refused", async () => {
    expect(await failure(listJobOptions(contextWith(["STAFF"]), JobOptionsQuerySchema.parse({ projectId })))).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(callsLike(/FROM production\.jobs j JOIN production\.job_statuses js/)).toHaveLength(0);
  });
});

describe("Cấu hình → Trạng thái job (PD-038)", () => {
  const statusRows = (count: number) =>
    catalog.slice(0, count).map((row, index) => ({ ...row, position: index + 1, job_count: 0, updated_at: new Date(), updated_by: null }));

  it("every member reads the catalog (job counts for ADMIN only); writes are the superadmin's only (PD-050)", async () => {
    db.state.handler = (call) => (call.text.includes("FROM production.job_statuses s") ? statusRows(3) : undefined);
    const list = await listJobStatuses(contextWith(["STAFF"]));
    expect(list.items.map((item) => item.name)).toEqual(["Mới nhận", "Đang làm", "Đã giao khách"]);
    expect(callsLike(/FROM production\.job_statuses s/)[0]!.text).toContain("NULL::int");
    expect(await failure(createJobStatus(contextWith(["LEADER"]), CreateJobStatusRequestSchema.parse({ name: "Chờ duyệt" })))).toMatchObject({ status: 403 });
    expect(await failure(updateJobStatus(contextWith(["STAFF"]), statusNew, UpdateCatalogStatusSchema.parse({ color: "red" })))).toMatchObject({ status: 403 });
    expect(await failure(reorderJobStatuses(contextWith(["ACCOUNT"]), [statusNew]))).toMatchObject({ status: 403 });
    expect(await failure(deleteJobStatus(contextWith(["LEADER"]), statusNew, undefined))).toMatchObject({ status: 403 });
    // A production Admin reads it too, but no longer edits it.
    const admin = contextWith(["ADMIN"]);
    expect(await failure(createJobStatus(admin, CreateJobStatusRequestSchema.parse({ name: "Chờ duyệt" })))).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(await failure(updateJobStatus(admin, statusNew, UpdateCatalogStatusSchema.parse({ color: "red" })))).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(await failure(reorderJobStatuses(admin, [statusNew]))).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(await failure(deleteJobStatus(admin, statusNew, undefined))).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(callsLike(/^(INSERT INTO|UPDATE|DELETE FROM) production\.job_statuses/)).toHaveLength(0);
  });

  it("add appends after the last one and records who; rename / colour / đóng record who too", async () => {
    db.state.handler = (call) => (call.text.startsWith("SELECT count(*)::int AS count FROM production.job_statuses") ? [{ count: 3 }] : undefined);
    await createJobStatus(owner, CreateJobStatusRequestSchema.parse({ name: "  Chờ duyệt ", color: "teal", isClosed: false }));
    const insert = callsLike(/^INSERT INTO production\.job_statuses/)[0]!;
    expect(insert.text).toContain("coalesce(max(position), 0) + 1");
    // requiresAllChecked defaults to false (PD-045); the kind to IN_PROGRESS (PD-080).
    expect(insert.values).toEqual([org, "Chờ duyệt", "teal", false, false, "IN_PROGRESS", me, me, org]);
    db.state.calls = [];
    await createJobStatus(owner, CreateJobStatusRequestSchema.parse({ name: "Xong hết", requiresAllChecked: true }));
    expect(callsLike(/^INSERT INTO production\.job_statuses/)[0]!.text).toContain("requires_all_checked");
    expect(callsLike(/^INSERT INTO production\.job_statuses/)[0]!.values).toEqual([org, "Xong hết", "slate", false, true, "IN_PROGRESS", me, me, org]);
    db.state.handler = (call) => (call.text.startsWith("UPDATE production.job_statuses") ? [{ id: statusNew }] : undefined);
    await updateJobStatus(owner, statusNew, UpdateCatalogStatusSchema.parse({ isClosed: true }));
    expect(callsLike(/^UPDATE production\.job_statuses/)[0]!.values).toContain(me);
    // PD-045: turning "cần check hết dòng" on / off is an update of its own (null = unchanged).
    db.state.calls = [];
    await updateJobStatus(owner, statusNew, UpdateCatalogStatusSchema.parse({ requiresAllChecked: true }));
    const update = callsLike(/^UPDATE production\.job_statuses/)[0]!;
    expect(update.text).toContain("requires_all_checked = coalesce($::boolean, requires_all_checked)");
    expect(update.values.slice(0, 4)).toEqual([null, null, null, true]);
    expect(UpdateCatalogStatusSchema.safeParse({}).success).toBe(false);
    expect(CreateJobStatusRequestSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("the last status cannot be deleted", async () => {
    db.state.handler = (call) => (call.text.includes("ORDER BY position, id FOR UPDATE") ? [catalog[0]] : undefined);
    expect(await failure(deleteJobStatus(owner, statusNew, undefined))).toMatchObject({ code: "JOB_STATUS_LAST", status: 409 });
    expect(callsLike(/^DELETE FROM production\.job_statuses/)).toHaveLength(0);
  });

  it("a status in use needs a replacement; then history rows, one UPDATE moving every job, and the delete", async () => {
    const usage = { total: 4, live: 3 };
    db.state.handler = (call) =>
      call.text.includes("ORDER BY position, id FOR UPDATE") ? catalog
      : call.text.includes("AS total") ? [usage]
      : undefined;
    expect(await failure(deleteJobStatus(owner, statusDoing, undefined))).toMatchObject({ code: "JOB_STATUS_IN_USE", status: 409 });
    expect(await failure(deleteJobStatus(owner, statusDoing, statusDoing))).toMatchObject({ code: "JOB_STATUS_REPLACEMENT_INVALID", status: 400 });
    expect(callsLike(/^(UPDATE production\.jobs|DELETE FROM production\.job_statuses)/)).toHaveLength(0);

    const result = await deleteJobStatus(owner, statusDoing, DeleteJobStatusQuerySchema.parse({ replacementId: statusDelivered }).replacementId);
    expect(result.movedJobs).toBe(3);
    const logs = callsLike(/^INSERT INTO production\.task_logs/);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.text).toContain("SELECT j.organization_id, NULL, j.id");
    expect(logs[0]!.values).toContainEqual({ jobStatusId: statusDelivered, jobStatusName: "Đã giao khách", jobStatusColor: "green", statusDeleted: true });
    const moves = callsLike(/^UPDATE production\.jobs SET job_status_id/);
    expect(moves).toHaveLength(1);
    expect(moves[0]!.values).toEqual([statusDelivered, org, statusDoing]);
    const order = db.state.calls.map((call) => call.text);
    const at = (pattern: RegExp) => order.findIndex((text) => pattern.test(text));
    expect(at(/^INSERT INTO production\.task_logs/)).toBeLessThan(at(/^UPDATE production\.jobs/));
    expect(at(/^UPDATE production\.jobs/)).toBeLessThan(at(/^DELETE FROM production\.job_statuses/));
  });

  it("an unused status is deleted without a replacement", async () => {
    db.state.handler = (call) =>
      call.text.includes("ORDER BY position, id FOR UPDATE") ? catalog
      : call.text.includes("AS total") ? [{ total: 0, live: 0 }]
      : undefined;
    const result = await deleteJobStatus(owner, statusDoing, undefined);
    expect(result.movedJobs).toBe(0);
    expect(callsLike(/^UPDATE production\.jobs/)).toHaveLength(0);
    expect(callsLike(/^DELETE FROM production\.job_statuses/)).toHaveLength(1);
  });
});
