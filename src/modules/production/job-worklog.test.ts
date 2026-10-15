import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultJobPermissions, effectiveJobScopes, type JobPermissionMatrix } from "../../contracts/production-catalog.js";
import { CreateTaskLineSchema, CreateWorkEntryRequestSchema, TransitionTaskRequestSchema } from "../../contracts/production-jobs.js";
import type { AccessContext } from "../access/access-context.js";
import type * as JobsRepoModule from "./jobs.repo.js";
import type * as NotificationsModule from "./notifications.js";
import type { TaskRow } from "./jobs.repo.js";
import type { Workflow, WorkflowStatus } from "./workflow.js";

/**
 * PD-035 (a job carries the work-log Excel's fields: optional leader, Ngày nhận / Ngày giao, automatic Tổng tấm,
 * Hình lỗi, optional Giờ OT, "Nhập công việc") and PD-036 (job permission matrix, delete semantics), without a
 * database (same fake `sql` as security.test.ts). Fake names and ids only: the repository is public.
 *
 * PD-047 made the STAFF default view all / create none / update own / delete none. Most tests here exercise the "own"
 * scope, so the fake organization stores a matrix with STAFF "own" everywhere (`db.state.settings`, read by
 * loadSettings); tests of the new defaults clear it.
 */
type Call = { text: string; values: unknown[] };
type Fragment = { readonly isFragment: true; text: string; values: unknown[] };

const db = vi.hoisted(() => {
  const state = {
    calls: [] as Call[],
    handler: (() => []) as (call: Call) => unknown[] | undefined,
    /** Rows of `SELECT key, value FROM production.settings` (null: asked to the handler). */
    settings: null as unknown[] | null
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
          const settings = state.settings && call.text.startsWith("SELECT key, value FROM production.settings") ? state.settings : null;
          resolve(settings ?? state.handler(call) ?? []);
        } catch (error) {
          reject(error);
        }
      }
    };
  };
  const fake = Object.assign(sql, {
    json: (value: unknown) => value,
    begin: <T>(fn: (tx: unknown) => Promise<T>) => fn(fake)
  });
  return { state, sql: fake };
});
const fixtures = vi.hoisted(() => {
  const state: { workflow: unknown } = { workflow: null };
  return state;
});
const hooks = vi.hoisted(() => ({ deleted: [] as { taskId: string; taskNumber: number }[] }));

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
vi.mock("./scoring-hooks.js", () => ({
  onTaskStatusEntered: vi.fn(() => Promise.resolve()),
  onTaskQtyChanged: vi.fn(() => Promise.resolve()),
  onTaskDeleted: vi.fn((_sql: unknown, input: { taskId: string; taskNumber: number }) => {
    hooks.deleted.push({ taskId: input.taskId, taskNumber: input.taskNumber });
    return Promise.resolve(2);
  })
}));
vi.mock("./notifications.js", async (importOriginal) => ({
  ...(await importOriginal<typeof NotificationsModule>()),
  enqueueProductionEvents: vi.fn(() => Promise.resolve())
}));
vi.mock("./jobs.repo.js", async (importOriginal) => ({
  ...(await importOriginal<typeof JobsRepoModule>()),
  loadWorkflowModel: vi.fn(() => Promise.resolve(fixtures.workflow as Workflow))
}));

const { actsAsJobLeader } = await import("./access.js");
const { jobViewAllowed, lineAllowed, lineCreateErrors, rolesWithAll, subtaskDeleteAllowed, wholeJobAllowed } = await import("./job-permissions.js");
const { relationOf, taskCapabilities } = await import("./jobs.repo.js");
const { assignProductionTask, createProductionTasks, deleteProductionTask, moveTasks, updateProductionTask } = await import("./tasks.service.js");
const { createJob, deleteJob, updateJob } = await import("./jobs.service.js");
const { createWorkEntry } = await import("./work-entries.service.js");
const { deleteProcess } = await import("./catalog.service.js");
const { workLogCells, workLogColumns } = await import("./exports.service.js");
const { clearProductionConfigCache } = await import("./catalog-cache.js");
const { allowedTransitions } = await import("./workflow.js");
const scoringHooks = await import("./scoring-hooks.js");

const org = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const worker = "33333333-3333-4333-8333-333333333333";
const checker = "44444444-4444-4444-8444-444444444444";
const taskId = "55555555-5555-4555-8555-555555555555";
const jobId = "66666666-6666-4666-8666-666666666666";
const processId = "77777777-7777-4777-8777-777777777777";
const shiftId = "88888888-8888-4888-8888-888888888888";
const projectId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const contextWith = (roles: string[], full = false) =>
  ({ user: { id: me }, organization: { id: org }, hasFullOrganizationAuthority: full, productionRoles: roles, role: { permissions: [] } }) as unknown as AccessContext;

const status = (code: string, sortOrder: number, flags: Partial<WorkflowStatus> = {}): WorkflowStatus => ({
  id: code,
  code,
  name: code,
  sortOrder,
  countsDone: false,
  countsChecked: false,
  isTerminal: false,
  isInitial: false,
  setByRoles: [],
  active: true,
  ...flags
});
const workflow: Workflow = {
  statuses: [
    status("ASSIGNED", 1, { isInitial: true }),
    status("PROCESSING", 2),
    status("DONE", 3, { countsDone: true }),
    status("WAITING_QC", 4),
    status("CHECKED", 5, { countsChecked: true }),
    status("COMPLETE", 6),
    status("DELIVERING", 7),
    status("FEEDBACK", 8),
    status("DELIVERED", 9, { isTerminal: true })
  ],
  transitions: [
    { fromStatusId: "PROCESSING", toStatusId: "DONE", actors: ["ASSIGNEE"], requiresNote: false },
    { fromStatusId: "CHECKED", toStatusId: "COMPLETE", actors: ["JOB_LEADER"], requiresNote: false }
  ]
};
fixtures.workflow = workflow;

const userJson = (id: string) => ({ id, display_name: `User ${id.slice(0, 4)}`, email: null, avatar_url: null });
const taskRow = (overrides: Partial<TaskRow> = {}): TaskRow => ({
  id: taskId,
  number: 7,
  job_id: jobId,
  job_code: "Folder/Batch 1",
  job_leader_id: null,
  project_id: projectId,
  project_code: "P1",
  project_name: "Project",
  assignee_id: me,
  assignee: userJson(me),
  qc_id: null,
  qc: null,
  process_id: processId,
  process_name: "Retouch",
  process_is_qc: false,
  shift_id: shiftId,
  shift_name: "OT",
  pay_mode: "POINTS",
  requires_ot_hours: true,
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
  status_name: "PROCESSING",
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
  pending_qty_request: null,
  ...overrides
});

const jobReceived = new Date("2026-10-11T17:00:00Z");
const jobDeadline = new Date("2026-10-15T16:59:00Z");

/** Reads of a job, its people and catalog, for line creation. `manual`: the job's Tổng tấm was typed. */
const lineQueries = (options: { manual?: boolean; extra?: (call: Call) => unknown[] | undefined } = {}) => (call: Call) => {
  const answer = options.extra?.(call);
  if (answer) {
    return answer;
  }
  if (call.text.includes("FROM production.jobs j JOIN production.projects p")) {
    return [
      {
        id: jobId,
        leader_id: null,
        received_at: jobReceived,
        deadline: jobDeadline,
        total_images: options.manual ? 5 : 0,
        total_images_manual: options.manual ?? false,
        qc_buffer_hours: 4,
        archived_at: null
      }
    ];
  }
  if (call.text.startsWith("SELECT om.user_id")) {
    return [
      { user_id: me, roles: ["STAFF"], superadmin: false },
      { user_id: worker, roles: ["STAFF"], superadmin: false },
      { user_id: checker, roles: ["QC"], superadmin: false }
    ];
  }
  if (call.text.startsWith("SELECT id, active, is_qc, name FROM production.processes")) {
    return [{ id: processId, active: true, is_qc: false, name: "Retouch" }];
  }
  if (call.text.startsWith("SELECT id, active FROM production.shifts")) {
    return [{ id: shiftId, active: true }];
  }
  if (call.text.includes("coalesce(sum(qty_assigned), 0)::int AS total")) {
    return [{ total: 0 }];
  }
  if (call.text.includes("SELECT EXISTS (SELECT 1 FROM production.feedbacks")) {
    return [{ open: false }];
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
// PD-047: a new work line names its QC.
const line = (overrides: Record<string, unknown> = {}) =>
  CreateTaskLineSchema.parse({ assigneeId: me, qcId: checker, processId, shiftId, qtyAssigned: 5, ...overrides });

/** The fake organization's matrix: STAFF keeps "own" everywhere (as before PD-047), see the file comment. */
const ownStaff: JobPermissionMatrix = { ...defaultJobPermissions, STAFF: { view: "own", create: "own", update: "own", delete: "own" } };
const ownStaffSettings = [{ key: "job_permissions", value: ownStaff }];

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = () => [];
  db.state.settings = ownStaffSettings;
  hooks.deleted = [];
  clearProductionConfigCache();
});

// PD-036 — the matrix -------------------------------------------------------------------------------------------

describe("job permission matrix (PD-036)", () => {
  it("a user's scope is the most permissive over their roles; ADMIN is always all; no role is none", () => {
    // PD-047 defaults: staff see every job and update their own tasks, but neither enter work nor delete tasks.
    expect(effectiveJobScopes(["STAFF"], defaultJobPermissions)).toEqual({ view: "all", create: "none", update: "own", delete: "none" });
    expect(effectiveJobScopes(["QC"], defaultJobPermissions)).toEqual({ view: "own", create: "own", update: "own", delete: "own" });
    expect(effectiveJobScopes(["STAFF", "QC"], defaultJobPermissions)).toEqual({ view: "all", create: "own", update: "own", delete: "own" });
    expect(effectiveJobScopes(["STAFF", "LEADER"], defaultJobPermissions)).toEqual({ view: "all", create: "all", update: "all", delete: "all" });
    expect(effectiveJobScopes(["STAFF"], ownStaff)).toEqual({ view: "own", create: "own", update: "own", delete: "own" });
    const strict: JobPermissionMatrix = {
      ...defaultJobPermissions,
      ACCOUNT: { view: "all", create: "none", update: "own", delete: "none" },
      STAFF: { view: "own", create: "own", update: "none", delete: "none" }
    };
    expect(effectiveJobScopes(["ACCOUNT", "STAFF"], strict)).toEqual({ view: "all", create: "own", update: "own", delete: "none" });
    expect(effectiveJobScopes(["ADMIN"], strict)).toEqual({ view: "all", create: "all", update: "all", delete: "all" });
    expect(effectiveJobScopes([], strict)).toEqual({ view: "none", create: "none", update: "none", delete: "none" });
    expect(rolesWithAll(strict, "view")).toEqual(["ADMIN", "ACCOUNT", "LEADER"]);
    expect(rolesWithAll(strict, "create")).toEqual(["ADMIN", "LEADER"]);
  });

  it("own: my lines; a whole job only when it has lines and all of them are mine", () => {
    expect(lineAllowed("own", true)).toBe(true);
    expect(lineAllowed("own", false)).toBe(false);
    expect(lineAllowed("all", false)).toBe(true);
    expect(lineAllowed("none", true)).toBe(false);
    expect(wholeJobAllowed("own", [me, me], me)).toBe(true);
    expect(wholeJobAllowed("own", [me, worker], me)).toBe(false);
    expect(wholeJobAllowed("own", [], me)).toBe(false);
    expect(wholeJobAllowed("all", [], me)).toBe(true);
    expect(jobViewAllowed("own", { involved: true, leads: false })).toBe(true);
    expect(jobViewAllowed("own", { involved: false, leads: false })).toBe(false);
    expect(jobViewAllowed("none", { involved: true, leads: true })).toBe(false);
    expect(lineCreateErrors("own", [me, worker], me)).toEqual(["Task 2: bạn chỉ tạo được công việc của chính mình."]);
    expect(lineCreateErrors("all", [worker], me)).toEqual([]);
    expect(lineCreateErrors("none", [me], me)).toHaveLength(1);
  });

  it("task capabilities follow the update / delete scopes; moves keep the workflow rules", () => {
    const own = { scopes: effectiveJobScopes(["STAFF"], ownStaff), userId: me };
    const none = {
      canEdit: false,
      canAssign: false,
      canChangeAssignee: false,
      canEditQty: false,
      canEditQtyAssigned: false,
      canRequestQty: false,
      canDecideQtyRequest: false,
      canCreateSubtask: false,
      canDelete: false
    };
    // My line entered by the Leader: I ask for a new "Số lượng giao" (PD-044) and may split subtasks.
    expect(taskCapabilities(taskRow(), own)).toEqual({ ...none, canEdit: true, canAssign: true, canRequestQty: true, canCreateSubtask: true, canDelete: true });
    expect(taskCapabilities(taskRow({ assignee_id: worker }), own)).toEqual(none);
    const all = { scopes: effectiveJobScopes(["LEADER"], defaultJobPermissions), userId: me };
    expect(taskCapabilities(taskRow({ assignee_id: worker, done_at: new Date() }), all)).toMatchObject({ canChangeAssignee: false, canEditQty: true });
    expect(taskCapabilities(taskRow({ job_archived: true }), all)).toEqual(none);
  });

  it("PD-044 capabilities: Số lượng giao, quantity requests, Done quantity, subtasks", () => {
    const own = { scopes: effectiveJobScopes(["STAFF"], ownStaff), userId: me };
    const all = { scopes: effectiveJobScopes(["LEADER"], defaultJobPermissions), userId: me };
    // A line I entered myself: I change its quantity directly, no request.
    expect(taskCapabilities(taskRow({ created_by: me }), own)).toMatchObject({ canEditQtyAssigned: true, canRequestQty: false });
    // The job's Leader (even with an "own" scope) changes it directly and decides an open request.
    const pending = {
      id: jobId,
      task_id: taskId,
      from_qty: 10,
      to_qty: 12,
      reason: "Thiếu ảnh",
      status: "PENDING" as const,
      requested_by_id: worker,
      requested_by: userJson(worker),
      created_at: "2026-10-14T03:00:00.000Z",
      decided_by: null,
      decided_at: null,
      decision_note: null
    };
    const led = taskRow({ assignee_id: worker, pending_qty_request: pending });
    expect(taskCapabilities(led, own, true)).toMatchObject({ canEditQtyAssigned: true, canDecideQtyRequest: true, canCreateSubtask: true });
    expect(taskCapabilities(led, own)).toMatchObject({ canEditQtyAssigned: false, canDecideQtyRequest: false, canCreateSubtask: false });
    // One open request per line.
    expect(taskCapabilities(taskRow({ pending_qty_request: pending }), own)).toMatchObject({ canRequestQty: false });
    // Done quantity: the worker until QC checked the line, "update: all" any time.
    expect(taskCapabilities(taskRow({ done_at: new Date() }), own)).toMatchObject({ canEditQty: true, canRequestQty: false, canCreateSubtask: false });
    expect(taskCapabilities(taskRow({ done_at: new Date(), checked_at: new Date() }), own)).toMatchObject({ canEditQty: false });
    expect(taskCapabilities(taskRow({ assignee_id: worker, done_at: new Date(), checked_at: new Date() }), all)).toMatchObject({ canEditQty: true });
    // Checking lines and feedback redo lines are not split.
    expect(taskCapabilities(taskRow({ process_is_qc: true }), own)).toMatchObject({ canCreateSubtask: false });
    expect(taskCapabilities(taskRow({ kind: "FB_WRONG", feedback_id: jobId }), own)).toMatchObject({ canCreateSubtask: false, canRequestQty: false });
    // A subtask: its worker edits its process / quantity (moved from its line), deletes it before Done; never assigned
    // on its own, never split again, never asks for a quantity.
    const subtask = taskRow({ parent_task_id: jobId, split_reason: "Cắt nền riêng" });
    expect(taskCapabilities(subtask, own)).toEqual({
      canEdit: true,
      canAssign: false,
      canChangeAssignee: false,
      canEditQty: false,
      canEditQtyAssigned: true,
      canRequestQty: false,
      canDecideQtyRequest: false,
      canCreateSubtask: false,
      canDelete: true
    });
    // After Done only "delete: all" deletes a subtask.
    expect(taskCapabilities({ ...subtask, done_at: new Date() }, own)).toMatchObject({ canDelete: false, canEditQty: true });
    expect(taskCapabilities({ ...subtask, assignee_id: worker, done_at: new Date() }, all)).toMatchObject({ canDelete: true });
  });

  it("PD-047 capabilities with the staff defaults: my task is edited, never deleted; my subtasks are deleted before Done", () => {
    const staff = { scopes: effectiveJobScopes(["STAFF"], defaultJobPermissions), userId: me };
    // The task the Leader gave me: edit, change its QC, ask for a quantity, split — no delete.
    expect(taskCapabilities(taskRow(), staff)).toMatchObject({ canEdit: true, canAssign: true, canRequestQty: true, canCreateSubtask: true, canDelete: false });
    expect(taskCapabilities(taskRow({ created_by: me }), staff)).toMatchObject({ canDelete: false });
    // Someone else's task: visible (view all) but nothing to change.
    expect(taskCapabilities(taskRow({ assignee_id: worker }), staff)).toMatchObject({ canEdit: false, canDelete: false, canCreateSubtask: false });
    // My subtask: deleted before its task's Done whatever the delete scope; after Done only "delete: all".
    const subtask = taskRow({ parent_task_id: jobId, split_reason: "Cắt nền riêng" });
    expect(taskCapabilities(subtask, staff)).toMatchObject({ canEdit: true, canDelete: true });
    expect(taskCapabilities({ ...subtask, done_at: new Date() }, staff)).toMatchObject({ canDelete: false });
    expect(taskCapabilities({ ...subtask, assignee_id: worker }, staff)).toMatchObject({ canDelete: false });
    expect(subtaskDeleteAllowed({ leads: false, deleteScope: "none", mine: true, done: false })).toBe(true);
    expect(subtaskDeleteAllowed({ leads: false, deleteScope: "none", mine: true, done: true })).toBe(false);
    expect(subtaskDeleteAllowed({ leads: false, deleteScope: "none", mine: false, done: false })).toBe(false);
    expect(subtaskDeleteAllowed({ leads: true, deleteScope: "none", mine: false, done: false })).toBe(true);
  });

  it("PD-047 staff defaults: no Chia task, no Nhập công việc, no task delete (403); own subtasks are deleted", async () => {
    db.state.settings = null;
    db.state.handler = lineQueries();
    const chia = await failure(createProductionTasks(contextWith(["STAFF"]), jobId, [line()]));
    expect(chia).toEqual({ code: "FORBIDDEN", status: 403, message: "Bạn không có quyền tạo công việc." });
    const entry = CreateWorkEntryRequestSchema.parse({
      projectId,
      jobId,
      processId,
      shiftId,
      qcId: checker,
      qtyAssigned: 3,
      assignedAt: "2026-10-12T00:00:00+07:00",
      deadline: "2026-10-12T23:59:00+07:00"
    });
    expect(await failure(createWorkEntry(contextWith(["STAFF"]), entry))).toEqual({ code: "FORBIDDEN", status: 403, message: "Bạn không có quyền tạo công việc." });
    expect(callsLike(/^INSERT INTO production\.tasks/)).toHaveLength(0);

    // My own task: not deleted with "delete: none".
    db.state.handler = (call) =>
      call.text.startsWith("SELECT job_id FROM production.tasks") ? [{ job_id: jobId }]
      : call.text.includes("AS job_leader_id") ? [taskRow()]
      : undefined;
    expect(await failure(deleteProductionTask(contextWith(["STAFF"]), taskId))).toEqual({
      code: "FORBIDDEN",
      status: 403,
      message: "Bạn không có quyền xoá công việc."
    });
    expect(callsLike(/^UPDATE production\.tasks SET deleted_at/)).toHaveLength(0);

    // My own subtask before Done: deleted, its quantity goes back to the task.
    db.state.calls = [];
    const parentId = "99999999-9999-4999-8999-999999999999";
    db.state.handler = (call) =>
      call.text.startsWith("SELECT job_id FROM production.tasks") ? [{ job_id: jobId }]
      : call.text.includes("AS job_leader_id") ? [taskRow({ parent_task_id: parentId, qty_assigned: 4, sub_seq: 1, parent_number: 7 })]
      : call.text.startsWith("SELECT id, qty_assigned, done_at FROM production.tasks") ? [{ id: parentId, qty_assigned: 6, done_at: null }]
      : call.text.includes("AS open") ? [{ open: false }]
      : undefined;
    expect(await deleteProductionTask(contextWith(["STAFF"]), taskId)).toEqual({ taskId, jobId, reversedEntries: 2 });
    expect(callsLike(/^UPDATE production\.tasks SET deleted_at/)).toHaveLength(1);
    expect(callsLike(/^UPDATE production\.tasks SET qty_assigned = \$/)[0]?.values).toContain(10);

    // After the task's Done the subtask stays (only "delete: all").
    db.state.calls = [];
    db.state.handler = (call) =>
      call.text.startsWith("SELECT job_id FROM production.tasks") ? [{ job_id: jobId }]
      : call.text.includes("AS job_leader_id") ? [taskRow({ parent_task_id: parentId, qty_assigned: 4, sub_seq: 1, parent_number: 7 })]
      : call.text.startsWith("SELECT id, qty_assigned, done_at FROM production.tasks") ? [{ id: parentId, qty_assigned: 6, done_at: new Date() }]
      : undefined;
    expect(await failure(deleteProductionTask(contextWith(["STAFF"]), taskId))).toEqual({
      code: "FORBIDDEN",
      status: 403,
      message: "Task đã Done — chỉ người có quyền xoá mọi công việc mới xoá được subtask."
    });
    expect(callsLike(/^UPDATE production\.tasks SET deleted_at/)).toHaveLength(0);
  });

  it("POST /jobs (a job without lines) needs create all; STAFF enters work through Nhập công việc", async () => {
    const input = { projectId, code: "Folder/Batch 1", receivedAt: "2026-10-12T00:00:00+07:00", deadline: "2026-10-15T23:59:00+07:00" };
    expect(await failure(createJob(contextWith(["STAFF"]), input))).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(callsLike(/^INSERT INTO production\.jobs/)).toHaveLength(0);
  });

  it("Chia task with create own: lines for myself only", async () => {
    db.state.handler = lineQueries({ extra: (call) => (call.text.includes("AND (t.assignee_id = $ OR t.qc_id = $)") ? [{ "?column?": 1 }] : undefined) });
    const result = await failure(createProductionTasks(contextWith(["STAFF"]), jobId, [line(), line({ assigneeId: worker })]));
    expect(result).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(result?.message).toBe("Task 2: bạn chỉ tạo được công việc của chính mình.");
    expect(callsLike(/^INSERT INTO production\.tasks/)).toHaveLength(0);
  });

  it("a line of someone else cannot be edited or deleted with own; my own line can", async () => {
    const visibleJob = (call: Call) => (call.text.includes("AND (t.assignee_id = $ OR t.qc_id = $)") ? [{ "?column?": 1 }] : undefined);
    db.state.handler = (call) =>
      call.text.startsWith("SELECT job_id FROM production.tasks") ? [{ job_id: jobId }]
      : call.text.includes("AS job_leader_id") ? [taskRow({ assignee_id: worker, qc_id: me })]
      : visibleJob(call);
    expect(await failure(updateProductionTask(contextWith(["QC"]), taskId, { note: "x" }))).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(await failure(deleteProductionTask(contextWith(["QC"]), taskId))).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(callsLike(/^UPDATE production\.tasks/)).toHaveLength(0);

    db.state.calls = [];
    db.state.handler = (call) =>
      call.text.startsWith("SELECT job_id FROM production.tasks") ? [{ job_id: jobId }]
      : call.text.includes("AS job_leader_id") ? [taskRow()]
      : call.text.includes("AS open") ? [{ open: false }]
      : undefined;
    expect(await deleteProductionTask(contextWith(["STAFF"]), taskId)).toEqual({ taskId, jobId, reversedEntries: 2 });
  });

  it("deleting a line reverses its points first, hides it and logs DELETE; the job is settled", async () => {
    db.state.handler = (call) =>
      call.text.startsWith("SELECT job_id FROM production.tasks") ? [{ job_id: jobId }]
      : call.text.includes("AS job_leader_id") ? [taskRow({ done_at: new Date("2026-10-12T03:00:00Z"), qty_done: 10 })]
      : call.text.includes("AS open") ? [{ open: false }]
      : undefined;
    await deleteProductionTask(contextWith(["LEADER"]), taskId);
    expect(hooks.deleted).toEqual([{ taskId, taskNumber: 7 }]);
    const hide = callsLike(/^UPDATE production\.tasks SET deleted_at = \$, deleted_by = \$/)[0];
    expect(hide?.values).toContain(me);
    const log = callsLike(/^INSERT INTO production\.task_logs/)[0];
    expect(JSON.stringify(log?.values)).toContain('"action":"DELETE"');
    expect(JSON.stringify(log?.values)).toContain('"reversedEntries":2');
    // Settled afterwards: derived status and the automatic Tổng tấm skip deleted lines.
    expect(callsLike(/^UPDATE production\.jobs j SET total_images = s\.total/)[0]?.text).toContain("t.deleted_at IS NULL");
  });

  it("a job can be deleted with own only when every line is mine; then every line goes, then the job", async () => {
    const jobQueries = (assignees: string[]) => (call: Call) =>
      call.text.includes("FROM production.jobs j JOIN production.projects p") ? [{ id: jobId, leader_id: null, archived_at: null }]
      : call.text.includes("AND (t.assignee_id = $ OR t.qc_id = $)") ? [{ "?column?": 1 }]
      : call.text.startsWith("SELECT id FROM production.tasks") ? assignees.map((_, index) => ({ id: `${taskId.slice(0, -1)}${index}` }))
      : call.text.includes("AS job_leader_id")
        ? assignees.map((assignee, index) => taskRow({ id: `${taskId.slice(0, -1)}${index}`, number: index + 1, assignee_id: assignee }))
        : undefined;
    db.state.handler = jobQueries([me, worker]);
    expect(await failure(deleteJob(contextWith(["STAFF"]), jobId))).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(callsLike(/^UPDATE production\.jobs SET deleted_at/)).toHaveLength(0);

    db.state.calls = [];
    db.state.handler = jobQueries([me, me]);
    expect(await deleteJob(contextWith(["STAFF"]), jobId)).toEqual({ jobId, deletedTasks: 2, reversedEntries: 4 });
    expect(hooks.deleted.map((entry) => entry.taskNumber)).toEqual([1, 2]);
    expect(callsLike(/^UPDATE production\.jobs SET deleted_at = now\(\), deleted_by = \$/)).toHaveLength(1);
    const jobLog = callsLike(/^INSERT INTO production\.task_logs .* 'JOB'/)[0];
    expect(jobLog?.values).toContainEqual({ deleted: true, deletedTasks: 2, reversedEntries: 4 });
  });

  it("the leader and archiving need update all; own may not change them", async () => {
    db.state.handler = (call) =>
      call.text.includes("AND deleted_at IS NULL FOR UPDATE")
        ? [
            {
              code: "B1",
              name: null,
              project_id: projectId,
              leader_id: null,
              received_at: jobReceived,
              deadline: jobDeadline,
              total_images: 0,
              total_images_manual: false,
              drive_link: null,
              custom_values: {},
              archived_at: null
            }
          ]
        : call.text.includes("AND (t.assignee_id = $ OR t.qc_id = $)") ? [{ "?column?": 1 }]
        : call.text.startsWith("SELECT assignee_id FROM production.tasks") ? [{ assignee_id: me }]
        : undefined;
    expect(await failure(updateJob(contextWith(["STAFF"]), jobId, { archived: true }))).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(await failure(updateJob(contextWith(["STAFF"]), jobId, { leaderId: worker }))).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(callsLike(/^UPDATE production\.jobs SET/)).toHaveLength(0);
  });
});

// PD-047 — a task's QC is changed, never removed --------------------------------------------------------------------

describe("PD-047 — a work task keeps a QC", () => {
  const otherQc = "45454545-4545-4545-8545-454545454545";
  const assignQueries = (row: TaskRow, processIsQc = false) =>
    lineQueries({
      extra: (call) =>
        call.text.startsWith("SELECT job_id FROM production.tasks") ? [{ job_id: jobId }]
        : call.text.includes("AS job_leader_id") ? [row]
        : call.text.startsWith("SELECT om.user_id")
          ? [
              { user_id: me, roles: ["STAFF"], superadmin: false },
              { user_id: worker, roles: ["STAFF"], superadmin: false },
              { user_id: checker, roles: ["QC"], superadmin: false },
              { user_id: otherQc, roles: ["QC"], superadmin: false }
            ]
        : call.text.startsWith("SELECT id, active, is_qc, name FROM production.processes") ? [{ id: processId, active: true, is_qc: processIsQc, name: "Retouch" }]
        : undefined
    });
  const assignUpdates = () => callsLike(/^UPDATE production\.tasks SET assignee_id = \$, qc_id = \$/);

  it("removing the QC of a work task → 400 QC_REQUIRED, nothing written; changing it to another QC is fine", async () => {
    db.state.handler = assignQueries(taskRow({ qc_id: checker, qc: userJson(checker) }));
    expect(await failure(assignProductionTask(contextWith(["STAFF"]), taskId, { qcId: null }))).toEqual({
      code: "QC_REQUIRED",
      status: 400,
      message: "Task phải có QC — chỉ đổi sang QC khác."
    });
    expect(await failure(assignProductionTask(contextWith(["LEADER"]), taskId, { assigneeId: worker, qcId: null }))).toMatchObject({ code: "QC_REQUIRED" });
    expect(assignUpdates()).toHaveLength(0);

    await assignProductionTask(contextWith(["STAFF"]), taskId, { qcId: otherQc });
    expect(assignUpdates()[0]?.values).toEqual([me, otherQc, org, taskId]);
  });

  it("a task created without QC before PD-047 stays as it is; a Checking task never needs one", async () => {
    // Re-assigning a legacy task without QC: allowed, still without QC.
    db.state.handler = assignQueries(taskRow({ qc_id: null }));
    await assignProductionTask(contextWith(["LEADER"]), taskId, { assigneeId: worker });
    expect(assignUpdates()[0]?.values).toEqual([worker, null, org, taskId]);

    // A Checking task (its assignee is the checker) has no QC of its own: clearing a historic one is allowed.
    db.state.calls = [];
    db.state.handler = assignQueries(taskRow({ assignee_id: checker, qc_id: otherQc, process_is_qc: true }), true);
    await assignProductionTask(contextWith(["LEADER"]), taskId, { qcId: null });
    expect(assignUpdates()[0]?.values).toEqual([checker, null, org, taskId]);
  });
});

// PD-035 — work-log fields ---------------------------------------------------------------------------------------

describe("work-log fields (PD-035)", () => {
  it("a job without a leader is led by every Leader / Admin (JOB_LEADER actor), not by staff", () => {
    expect(actsAsJobLeader(contextWith(["LEADER"]), null)).toBe(true);
    expect(actsAsJobLeader(contextWith(["STAFF"]), null)).toBe(false);
    expect(actsAsJobLeader(contextWith(["LEADER"]), worker)).toBe(false);
    const checked = taskRow({ status_id: "CHECKED", status_code: "CHECKED", assignee_id: worker });
    // The job's Complete action (PD-044: never one line at a time).
    const targets = (roles: string[]) =>
      allowedTransitions(workflow, "CHECKED", relationOf(contextWith(roles), checked), "job").map((option) => option.toStatusId);
    expect(targets(["LEADER"])).toContain("COMPLETE");
    expect(targets(["STAFF"])).not.toContain("COMPLETE");
  });

  it("Giờ OT is optional at Done, also on the OT shift; sent, it is stored", async () => {
    const done = workflow.statuses.find((item) => item.code === "DONE")!;
    const [moved] = await moveTasks(db.sql as never, org, workflow, [taskRow()], done, me, null, { qtyDone: 10 });
    expect(moved!.ot_hours).toBeNull();
    const [withHours] = await moveTasks(db.sql as never, org, workflow, [taskRow({ ot_hours: "1.5" })], done, me, null, { qtyDone: 10 });
    expect(withHours!.ot_hours).toBe("1.5");
    const [replaced] = await moveTasks(db.sql as never, org, workflow, [taskRow({ ot_hours: "1.5" })], done, me, null, { otHours: 2 });
    expect(replaced!.ot_hours).toBe("2");
    expect(TransitionTaskRequestSchema.safeParse({ toStatusId: jobId }).success).toBe(true);
  });

  it("a line defaults to the job's Ngày nhận / Ngày giao and stores Hình lỗi and Giờ OT", async () => {
    db.state.handler = lineQueries();
    await createProductionTasks(contextWith(["LEADER"]), jobId, [line({ errorQty: 3, otHours: 1.5 })]);
    const insert = callsLike(/^INSERT INTO production\.tasks/)[0]!;
    expect(insert.text).toContain("error_qty, ot_hours");
    const [row] = insert.values.find((value) => Array.isArray(value)) as Record<string, unknown>[];
    expect(row).toMatchObject({ assigneeId: me, qcId: checker, errorQty: 3, otHours: 1.5, assignedAt: jobReceived.toISOString(), deadline: jobDeadline.toISOString() });
    // Automatic Tổng tấm: no over-allocation warning, synced from the lines when the job is settled.
    expect(JSON.stringify(callsLike(/^INSERT INTO production\.task_logs/)[0]?.values)).not.toContain("warning");
    expect(callsLike(/^UPDATE production\.jobs j SET total_images = s\.total/)[0]?.text).toContain("NOT j.total_images_manual");
  });

  it("explicit Ngày nhận / Ngày giao win; Ngày giao before Ngày nhận is refused", async () => {
    db.state.handler = lineQueries({ manual: true });
    await createProductionTasks(contextWith(["LEADER"]), jobId, [
      line({ assignedAt: "2026-10-13T00:00:00+07:00", deadline: "2026-10-14T23:59:00+07:00", qtyAssigned: 9 })
    ]);
    const [row] = callsLike(/^INSERT INTO production\.tasks/)[0]!.values.find((value) => Array.isArray(value)) as Record<string, unknown>[];
    expect(row).toMatchObject({ assignedAt: "2026-10-12T17:00:00.000Z", deadline: "2026-10-14T16:59:00.000Z" });
    // A typed Tổng tấm (5) is exceeded: warned, still allowed.
    expect(JSON.stringify(callsLike(/^INSERT INTO production\.task_logs/)[0]?.values)).toContain("warning");

    db.state.calls = [];
    const wrong = await failure(
      createProductionTasks(contextWith(["LEADER"]), jobId, [line({ assignedAt: "2026-10-14T00:00:00+07:00", deadline: "2026-10-13T23:59:00+07:00" })])
    );
    expect(wrong).toMatchObject({ code: "TASK_LINES_INVALID", status: 400 });
    expect(callsLike(/^INSERT INTO production\.tasks/)).toHaveLength(0);
  });

  it("editing a line changes Ngày nhận, Hình lỗi and Giờ OT (history FIELD), never points", async () => {
    db.state.handler = (call) =>
      call.text.startsWith("SELECT job_id FROM production.tasks") ? [{ job_id: jobId }]
      : call.text.includes("AS job_leader_id") ? [taskRow({ done_at: new Date("2026-10-12T03:00:00Z"), qty_done: 10 })]
      : undefined;
    await failure(updateProductionTask(contextWith(["STAFF"]), taskId, { errorQty: 2, otHours: 3, assignedAt: "2026-10-11T00:00:00+07:00" }));
    const update = callsLike(/^UPDATE production\.tasks SET qty_assigned/)[0]!;
    expect(update.text).toContain("error_qty = $, ot_hours = $");
    expect(update.values).toContain(2);
    expect(update.values).toContain(3);
    const log = callsLike(/^INSERT INTO production\.task_logs/)[0]!;
    expect(JSON.stringify(log.values)).toContain('"errorQty":2');
    // Hình lỗi / Giờ OT are display-only: no score hook, no total sync.
    expect(vi.mocked(scoringHooks.onTaskQtyChanged)).not.toHaveBeenCalled();
    expect(callsLike(/total_images = s.total/)).toHaveLength(0);
  });

  it("Tổng tấm: null goes back to the sum of the lines (synced), a number is kept as typed", async () => {
    const before = {
      code: "B1",
      name: null,
      project_id: projectId,
      leader_id: null,
      received_at: jobReceived,
      deadline: jobDeadline,
      total_images: 40,
      total_images_manual: true,
      drive_link: null,
      custom_values: {},
      archived_at: null
    };
    db.state.handler = (call) => (call.text.includes("AND deleted_at IS NULL FOR UPDATE") ? [before] : undefined);
    await failure(updateJob(contextWith(["LEADER"]), jobId, { totalImages: null }));
    const update = callsLike(/^UPDATE production\.jobs SET/)[0]!;
    expect(update.text).toContain("total_images_manual = $");
    expect(update.values).toContain(false);
    expect(callsLike(/^UPDATE production\.jobs j SET total_images = s\.total/)).toHaveLength(1);

    db.state.calls = [];
    await failure(updateJob(contextWith(["LEADER"]), jobId, { totalImages: 55 }));
    expect(callsLike(/^UPDATE production\.jobs SET/)[0]!.values).toContain(55);
    expect(callsLike(/^UPDATE production\.jobs j SET total_images = s\.total/)).toHaveLength(0);
  });

  it("PD-047: Chia task and Nhập công việc refuse a work line without QC (400, nothing written); a Checking line has none", async () => {
    db.state.handler = lineQueries();
    const missing = await failure(createProductionTasks(contextWith(["LEADER"]), jobId, [line(), line({ qcId: null }), line({ qcId: undefined })]));
    expect(missing).toEqual({ code: "TASK_LINES_INVALID", status: 400, message: "Task 2: Chọn QC cho task. Task 3: Chọn QC cho task." });
    const entry = CreateWorkEntryRequestSchema.parse({
      projectId,
      jobId,
      processId,
      shiftId,
      qtyAssigned: 3,
      assignedAt: "2026-10-12T00:00:00+07:00",
      deadline: "2026-10-12T23:59:00+07:00"
    });
    db.state.handler = lineQueries({
      extra: (call) =>
        call.text.startsWith("SELECT 1 FROM production.projects") ? [{ "?column?": 1 }]
        : call.text.startsWith("SELECT project_id FROM production.jobs") ? [{ project_id: projectId }]
        : undefined
    });
    expect(await failure(createWorkEntry(contextWith(["LEADER"]), entry))).toEqual({
      code: "TASK_LINES_INVALID",
      status: 400,
      message: "Task 1: Chọn QC cho task."
    });
    expect(callsLike(/^INSERT INTO production\.tasks/)).toHaveLength(0);

    // A Checking line (QC process) is the checker's own work: no QC of its own, nothing required.
    const checkingId = "abababab-abab-4bab-8bab-abababababab";
    db.state.handler = lineQueries({
      extra: (call) =>
        call.text.startsWith("SELECT id, active, is_qc, name FROM production.processes")
          ? [
              { id: processId, active: true, is_qc: false, name: "Retouch" },
              { id: checkingId, active: true, is_qc: true, name: "Checking" }
            ]
          : undefined
    });
    await createProductionTasks(contextWith(["LEADER"]), jobId, [line({ assigneeId: checker, qcId: null, processId: checkingId })]);
    const [row] = callsLike(/^INSERT INTO production\.tasks/)[0]!.values.find((value) => Array.isArray(value)) as Record<string, unknown>[];
    expect(row).toMatchObject({ assigneeId: checker, qcId: null, processId: checkingId });
  });

  it("Nhập công việc never creates a job: it needs an existing job of the chosen project (PD-038)", async () => {
    const base = { projectId, processId, shiftId, qcId: checker, qtyAssigned: 12, assignedAt: "2026-10-12T00:00:00+07:00", deadline: "2026-10-12T23:59:00+07:00" };
    // The free package text is gone from the contract: a job id is required.
    expect(CreateWorkEntryRequestSchema.safeParse({ ...base, jobCode: "Folder 2026/Batch 7" }).success).toBe(false);
    expect(CreateWorkEntryRequestSchema.safeParse(base).success).toBe(false);
    const input = CreateWorkEntryRequestSchema.parse({ ...base, jobId });
    // Unknown (or deleted) job: 404, nothing written.
    db.state.handler = (call) => (call.text.startsWith("SELECT 1 FROM production.projects") ? [{ "?column?": 1 }] : undefined);
    expect(await failure(createWorkEntry(contextWith(["STAFF"]), input))).toMatchObject({ code: "JOB_NOT_FOUND", status: 404 });
    // A job of another project: 400.
    db.state.handler = (call) =>
      call.text.startsWith("SELECT 1 FROM production.projects") ? [{ "?column?": 1 }]
      : call.text.startsWith("SELECT project_id FROM production.jobs") ? [{ project_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }]
      : undefined;
    expect(await failure(createWorkEntry(contextWith(["STAFF"]), input))).toMatchObject({ code: "JOB_PROJECT_MISMATCH", status: 400 });
    expect(callsLike(/^INSERT INTO production.(jobs|tasks)/)).toHaveLength(0);
  });

  it("Nhập công việc: the line goes into the chosen job (also a closed one); with own, only for myself", async () => {
    const base = {
      projectId,
      jobId,
      processId,
      shiftId,
      qcId: checker,
      qtyAssigned: 3,
      assignedAt: "2026-10-12T00:00:00+07:00",
      deadline: "2026-10-12T23:59:00+07:00",
      errorQty: 1
    };
    expect(await failure(createWorkEntry(contextWith(["STAFF"]), CreateWorkEntryRequestSchema.parse({ ...base, assigneeId: worker })))).toMatchObject({
      code: "FORBIDDEN",
      status: 403
    });
    db.state.handler = lineQueries({
      extra: (call) =>
        call.text.startsWith("SELECT 1 FROM production.projects") ? [{ "?column?": 1 }]
        : call.text.startsWith("SELECT project_id FROM production.jobs") ? [{ project_id: projectId }]
        : call.text.includes("AS job_leader_id") ? [taskRow({ assignee_id: worker })]
        : undefined
    });
    const result = await createWorkEntry(contextWith(["LEADER"]), CreateWorkEntryRequestSchema.parse({ ...base, assigneeId: worker }));
    expect(result.jobId).toBe(jobId);
    expect(callsLike(/^INSERT INTO production.jobs/)).toHaveLength(0);
    // The job is locked (archived jobs refuse lines) and the line lands in it.
    expect(callsLike(/FROM production.jobs j JOIN production.projects p/)[0]!.values).toContain(jobId);
    const [row] = callsLike(/^INSERT INTO production.tasks/)[0]!.values.find((value) => Array.isArray(value)) as Record<string, unknown>[];
    expect(row).toMatchObject({ assigneeId: worker, qtyAssigned: 3, errorQty: 1, assignedAt: "2026-10-11T17:00:00.000Z" });
  });

  it("a process is deleted only when nothing refers to it", async () => {
    db.state.handler = (call) => (call.text.includes("AS found") ? [{ found: true, tasks: 3, rules: 1, entries: 0 }] : undefined);
    expect(await failure(deleteProcess(contextWith(["ADMIN"]), processId))).toMatchObject({ code: "PROCESS_IN_USE", status: 409 });
    expect(callsLike(/^DELETE FROM production\.processes/)).toHaveLength(0);
    db.state.handler = (call) => (call.text.includes("AS found") ? [{ found: true, tasks: 0, rules: 0, entries: 0 }] : undefined);
    await deleteProcess(contextWith(["ADMIN"]), processId);
    expect(callsLike(/^DELETE FROM production\.processes/)).toHaveLength(1);
    expect(await failure(deleteProcess(contextWith(["LEADER"]), processId))).toMatchObject({ status: 403 });
  });

  it("the work-log export has exactly the Excel's 11 headers in order, then Trạng thái, QC, Trạng thái job and Link chia việc", () => {
    expect(workLogColumns.map((column) => column.header)).toEqual([
      "Nhân viên thực hiện",
      "Dự án",
      "Gói công việc (Folder hình, hỏi leader nếu không rõ)",
      "Quy trình",
      "Ngày nhận",
      "Ngày giao",
      "Ca làm việc",
      "Số lượng",
      "Hình lỗi",
      "Giờ OT",
      "Ghi chú",
      "Trạng thái",
      "QC",
      "Trạng thái job",
      "Link chia việc"
    ]);
  });
});

// PD-040 — "Link chia việc" ------------------------------------------------------------------------------------------

describe("Link chia việc (PD-040)", () => {
  const folder = "Y:\\Client\\2026\\Batch 1";
  const lockedRow = (overrides: Partial<TaskRow> = {}) => (call: Call) =>
    call.text.startsWith("SELECT job_id FROM production.tasks") ? [{ job_id: jobId }]
    : call.text.includes("AS job_leader_id") ? [taskRow(overrides)]
    : undefined;
  /** The history rows written by the calls so far (action, from, to). */
  const logRows = () =>
    callsLike(/^INSERT INTO production\.task_logs/).flatMap((call) =>
      (call.values.find((value) => Array.isArray(value)) as { action: string; from: unknown; to: unknown }[]).map(({ action, from, to }) => ({
        action,
        from,
        to
      }))
    );

  it("Chia task stores each line's link (any text, trimmed; empty = none) and reads it back", async () => {
    db.state.handler = lineQueries();
    await createProductionTasks(contextWith(["LEADER"]), jobId, [
      line({ workLink: "  https://drive.example.com/f/abc  " }),
      line({ workLink: folder }),
      line({ workLink: "   " }),
      line()
    ]);
    const insert = callsLike(/^INSERT INTO production\.tasks/)[0]!;
    expect(insert.text).toContain("note, work_link, custom_values");
    expect(insert.text).toContain("r->>'note', r->>'workLink', r->'customValues'");
    const rows = insert.values.find((value) => Array.isArray(value)) as Record<string, unknown>[];
    expect(rows.map((row) => row.workLink)).toEqual(["https://drive.example.com/f/abc", folder, null, null]);
    // The job detail / task reads select the column and map it.
    expect(callsLike(/AS job_leader_id/)[0]?.text).toContain("t.note, t.work_link,");
  });

  it("the task read model carries workLink (job detail, task sheet)", async () => {
    db.state.handler = (call) => (call.text.includes("AS job_leader_id") ? [taskRow({ work_link: folder })] : undefined);
    const { getProductionTask } = await import("./tasks.service.js");
    const task = await getProductionTask(contextWith(["STAFF"]), taskId);
    expect(task.workLink).toBe(folder);
  });

  it("Nhập công việc passes the link to the new line", async () => {
    db.state.handler = lineQueries({
      extra: (call) =>
        call.text.startsWith("SELECT 1 FROM production.projects") ? [{ "?column?": 1 }]
        : call.text.startsWith("SELECT project_id FROM production.jobs") ? [{ project_id: projectId }]
        : call.text.includes("AS job_leader_id") ? [taskRow()]
        : undefined
    });
    const input = CreateWorkEntryRequestSchema.parse({
      projectId,
      jobId,
      processId,
      shiftId,
      qcId: checker,
      qtyAssigned: 3,
      assignedAt: "2026-10-12T00:00:00+07:00",
      deadline: "2026-10-12T23:59:00+07:00",
      workLink: ` ${folder} `
    });
    await createWorkEntry(contextWith(["STAFF"]), input);
    const [row] = callsLike(/^INSERT INTO production.tasks/)[0]!.values.find((value) => Array.isArray(value)) as Record<string, unknown>[];
    expect(row).toMatchObject({ assigneeId: me, qcId: checker, workLink: folder });
  });

  it("editing the link updates work_link and records a FIELD history row; null clears it; unchanged logs nothing", async () => {
    db.state.handler = lockedRow();
    await failure(updateProductionTask(contextWith(["STAFF"]), taskId, { workLink: folder }));
    const update = callsLike(/^UPDATE production\.tasks SET qty_assigned/)[0]!;
    expect(update.text).toContain("note = $, work_link = $, is_late = $");
    expect(update.values).toContain(folder);
    expect(logRows()).toEqual([{ action: "FIELD", from: { workLink: null }, to: { workLink: folder } }]);

    db.state.calls = [];
    db.state.handler = lockedRow({ work_link: "https://drive.example.com/f/abc" });
    await failure(updateProductionTask(contextWith(["STAFF"]), taskId, { workLink: null }));
    expect(callsLike(/^UPDATE production\.tasks SET qty_assigned/)[0]!.values).not.toContain("https://drive.example.com/f/abc");
    expect(logRows()).toEqual([{ action: "FIELD", from: { workLink: "https://drive.example.com/f/abc" }, to: { workLink: null } }]);

    // Sending the same value (or other fields only) keeps the link and adds no history row for it.
    db.state.calls = [];
    db.state.handler = lockedRow({ work_link: folder });
    await failure(updateProductionTask(contextWith(["STAFF"]), taskId, { workLink: ` ${folder} ` }));
    expect(callsLike(/^UPDATE production\.tasks SET qty_assigned/)[0]!.values).toContain(folder);
    expect(logRows()).toEqual([]);
    db.state.calls = [];
    await failure(updateProductionTask(contextWith(["STAFF"]), taskId, { errorQty: 1 }));
    expect(callsLike(/^UPDATE production\.tasks SET qty_assigned/)[0]!.values).toContain(folder);
    expect(logRows()).toEqual([{ action: "FIELD", from: { errorQty: null }, to: { errorQty: 1 } }]);
  });

  it("editing the link follows the Ghi chú rule: own may change only their own line", async () => {
    db.state.handler = (call) =>
      call.text.startsWith("SELECT job_id FROM production.tasks") ? [{ job_id: jobId }]
      : call.text.includes("AS job_leader_id") ? [taskRow({ assignee_id: worker, qc_id: me })]
      : call.text.includes("AND (t.assignee_id = $ OR t.qc_id = $)") ? [{ "?column?": 1 }]
      : undefined;
    expect(await failure(updateProductionTask(contextWith(["QC"]), taskId, { workLink: folder }))).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(await failure(updateProductionTask(contextWith(["QC"]), taskId, { note: "x" }))).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(callsLike(/^UPDATE production\.tasks/)).toHaveLength(0);
    // "update: all" (Leader) edits anyone's line.
    db.state.handler = lockedRow({ assignee_id: worker });
    await failure(updateProductionTask(contextWith(["LEADER"]), taskId, { workLink: folder }));
    expect(callsLike(/^UPDATE production\.tasks SET qty_assigned/)[0]!.values).toContain(folder);
  });

  it("the work-log export writes the link as the last column", () => {
    const cells = workLogCells({
      job_id: jobId,
      assignee: "User A",
      project_code: "P1",
      job_code: "Folder/Batch 1",
      process: "Retouch",
      assigned_at: jobReceived,
      deadline: jobDeadline,
      shift: "Ca 1",
      qty_assigned: 5,
      error_qty: null,
      ot_hours: null,
      note: null,
      status: "PROCESSING",
      qc: null,
      job_status: "Mới nhận",
      work_link: folder
    });
    expect(cells.workLink).toBe(folder);
    expect(workLogColumns.at(-1)).toMatchObject({ header: "Link chia việc", key: "workLink" });
  });
});
