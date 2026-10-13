import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProductionSettings } from "../../contracts/production-catalog.js";
import type { QuerySql } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import type * as CatalogModule from "./catalog.service.js";
import type * as JobsRepoModule from "./jobs.repo.js";
import type * as NotificationsModule from "./notifications.js";
import type { TaskRow } from "./jobs.repo.js";
import type { Workflow, WorkflowStatus } from "./workflow.js";

/**
 * Service-level checks of the wave-2 production fixes (SEC2-03, -04, -08, -09, -11) without a database: a
 * fake tagged-template `sql` records every statement and answers from a per-test handler, so each test can
 * assert both the outcome and that nothing was written when a request is refused.
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
    begin: <T>(fn: (tx: unknown) => Promise<T>) => fn(fake)
  });
  return { state, sql: fake };
});

const fixtures = vi.hoisted(() => {
  const state: { settings: Record<string, unknown>; workflow: unknown } = {
    settings: { scoresPublic: false, moneyPublic: false, anomalyFailRate: 0.2 },
    workflow: null
  };
  return state;
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
vi.mock("./scoring-hooks.js", () => ({ onTaskStatusEntered: vi.fn(() => Promise.resolve()), onTaskQtyChanged: vi.fn(() => Promise.resolve()) }));
vi.mock("./notifications.js", async (importOriginal) => ({
  ...(await importOriginal<typeof NotificationsModule>()),
  enqueueProductionEvents: vi.fn(() => Promise.resolve())
}));
vi.mock("./catalog.service.js", async (importOriginal) => {
  const { defaultJobPermissions } = await import("../../contracts/production-catalog.js");
  return {
    ...(await importOriginal<typeof CatalogModule>()),
    // The default job permission matrix (PD-036) unless a test sets its own.
    loadSettings: vi.fn(() => Promise.resolve({ jobPermissions: defaultJobPermissions, ...fixtures.settings } as ProductionSettings))
  };
});
vi.mock("./jobs.repo.js", async (importOriginal) => ({
  ...(await importOriginal<typeof JobsRepoModule>()),
  loadWorkflowModel: vi.fn(() => Promise.resolve(fixtures.workflow as Workflow))
}));

const { leadsJob } = await import("./access.js");
const { relationOf, toProductionTask, assertJobVisible } = await import("./jobs.repo.js");
const { effectiveJobScopes, defaultJobPermissions } = await import("../../contracts/production-catalog.js");
/** The caller's access with the default job permission matrix (PD-036). */
const accessOf = (roles: string[], userId = me) => ({ scopes: effectiveJobScopes(roles as never, defaultJobPermissions), userId });
const { moveTasks, transitionProductionTask, updateProductionTaskQty } = await import("./tasks.service.js");
const { updateJob } = await import("./jobs.service.js");
const { getTaskScores } = await import("./scores.service.js");
const { deleteProductionComment } = await import("./timeline.service.js");
const { reviewAnomaly, unreviewAnomaly, workerFailRateKeys } = await import("./anomalies.service.js");
const { redactColleagueEmails, seesColleagueEmails } = await import("./http.js");

const org = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const third = "44444444-4444-4444-8444-444444444444";
const taskId = "55555555-5555-4555-8555-555555555555";
const jobId = "66666666-6666-4666-8666-666666666666";
const commentId = "77777777-7777-4777-8777-777777777777";

const contextWith = (roles: string[], full = false, userId = me) =>
  ({
    user: { id: userId },
    organization: { id: org },
    hasFullOrganizationAuthority: full,
    productionRoles: roles,
    role: { permissions: [] }
  }) as unknown as AccessContext;

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
    { fromStatusId: "ASSIGNED", toStatusId: "PROCESSING", actors: ["ASSIGNEE"], requiresNote: false },
    { fromStatusId: "PROCESSING", toStatusId: "DONE", actors: ["ASSIGNEE"], requiresNote: false },
    { fromStatusId: "CHECKED", toStatusId: "COMPLETE", actors: ["JOB_LEADER"], requiresNote: false }
  ]
};
fixtures.workflow = workflow;
const statusOf = (code: string) => workflow.statuses.find((item) => item.code === code)!;

const userJson = (id: string) => ({ id, display_name: `User ${id.slice(0, 4)}`, email: `${id.slice(0, 4)}@example.test`, avatar_url: null });

const taskRow = (overrides: Partial<TaskRow> = {}): TaskRow => ({
  id: taskId,
  number: 7,
  job_id: jobId,
  job_code: "JOB-1",
  job_leader_id: other,
  project_id: "88888888-8888-4888-8888-888888888888",
  project_code: "P1",
  project_name: "Project",
  assignee_id: me,
  assignee: userJson(me),
  qc_id: null,
  qc: null,
  process_id: "99999999-9999-4999-8999-999999999999",
  process_name: "Retouch",
  process_is_qc: false,
  shift_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  shift_name: "Chính thức",
  pay_mode: "POINTS",
  requires_ot_hours: false,
  qty_assigned: 10,
  qty_done: null,
  error_qty: null,
  ot_hours: null,
  assigned_at: new Date("2026-10-10T02:00:00Z"),
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
  ...overrides
});

/** Answers the task loaders used by lockedTask / loadTask with `task`. */
const taskQueries = (task: TaskRow) => (call: Call) => {
  if (call.text.startsWith("SELECT job_id FROM production.tasks")) {
    return [{ job_id: task.job_id }];
  }
  if (call.text.includes("AS job_leader_id") && call.text.includes("t.id = ANY(")) {
    return [task];
  }
  return undefined;
};

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return { code: (error as { code?: string }).code, status: (error as { statusCode?: number }).statusCode };
  }
  return null;
};
const wrote = (pattern: RegExp) => db.state.calls.some((call) => pattern.test(call.text));

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = () => [];
  fixtures.settings = { scoresPublic: false, moneyPublic: false, anomalyFailRate: 0.2 };
});

describe("SEC2-03 — declared Done quantity is capped before anything is written", () => {
  it("the assignee's PROCESSING → DONE with 1000/10 is refused (400 QTY_DONE_TOO_HIGH), nothing updated", async () => {
    db.state.handler = taskQueries(taskRow());
    const result = await failure(transitionProductionTask(contextWith(["STAFF"]), taskId, { toStatusId: "DONE", qtyDone: 1000 }));
    expect(result).toEqual({ code: "QTY_DONE_TOO_HIGH", status: 400 });
    expect(wrote(/^UPDATE production\.tasks/)).toBe(false);
    expect(wrote(/INSERT INTO production\.task_logs/)).toBe(false);
  });

  it("12/10 is still accepted (it must show up as a QTY_MISMATCH anomaly)", async () => {
    const [moved] = await moveTasks(db.sql as unknown as QuerySql, org, workflow, [taskRow()], statusOf("DONE"), me, null, { qtyDone: 12 });
    expect(moved?.qty_done).toBe(12);
    const update = db.state.calls.find((call) => call.text.startsWith("UPDATE production.tasks AS t"));
    expect(JSON.stringify(update?.values)).toContain('"qtyDone":12');
  });

  it("applies to any first Done (also an ADMIN override) but not to tasks already Done", async () => {
    expect(
      await failure(moveTasks(db.sql as unknown as QuerySql, org, workflow, [taskRow({ qty_assigned: 1 })], statusOf("DONE"), me, "x", { qtyDone: 12, override: true }))
    ).toEqual({ code: "QTY_DONE_TOO_HIGH", status: 400 });
    expect(db.state.calls).toHaveLength(0);
    // Done again after a QC fail: the quantity is locked, the cap is not re-checked (no qty sent).
    const doneBefore = taskRow({ done_at: new Date("2026-10-10T03:00:00Z"), qty_done: 15, status_id: "PROCESSING" });
    const [moved] = await moveTasks(db.sql as unknown as QuerySql, org, workflow, [doneBefore], statusOf("DONE"), me, null, {});
    expect(moved?.qty_done).toBe(15);
  });

  it("the job leader's correction after Done keeps its rules (no cap; logged)", async () => {
    const done = taskRow({ done_at: new Date("2026-10-10T03:00:00Z"), qty_done: 10, status_id: "DONE", status_code: "DONE", job_leader_id: me });
    db.state.handler = taskQueries(done);
    await updateProductionTaskQty(contextWith(["LEADER"]), taskId, { qtyDone: 500 }).catch(() => undefined);
    expect(wrote(/^UPDATE production\.tasks SET qty_done/)).toBe(true);
    expect(wrote(/INSERT INTO production\.task_logs/)).toBe(true);
  });
});

describe("SEC2-04 — job-leader powers need the LEADER (or ADMIN) role", () => {
  it("leadsJob", () => {
    expect(leadsJob(contextWith(["LEADER"]), me)).toBe(true);
    expect(leadsJob(contextWith(["LEADER", "QC"]), other)).toBe(false);
    expect(leadsJob(contextWith(["STAFF", "QC"]), me)).toBe(false);
    expect(leadsJob(contextWith(["ADMIN"]), me)).toBe(true);
    expect(leadsJob(contextWith([], true), me)).toBe(true);
    expect(leadsJob(contextWith(["LEADER"]), null)).toBe(false);
  });

  it("a demoted leader (now STAFF/QC) of the job can no longer manage its tasks", () => {
    const task = taskRow({ job_leader_id: me, assignee_id: third, qc_id: me, status_id: "CHECKED", status_code: "CHECKED" });
    const demoted = relationOf(contextWith(["STAFF", "QC"]), task);
    expect(demoted.isJobLeader).toBe(false);
    const view = toProductionTask(task, workflow, demoted, accessOf(["STAFF", "QC"]));
    expect(view.capabilities).toMatchObject({ canEdit: false, canAssign: false, canEditQty: false, canDelete: false });
    // CHECKED → COMPLETE belongs to the JOB_LEADER actor.
    expect(view.capabilities.transitions.map((option) => option.toStatusId)).not.toContain("COMPLETE");

    const leader = relationOf(contextWith(["LEADER"]), task);
    const led = toProductionTask(task, workflow, leader, accessOf(["LEADER"]));
    expect(led.capabilities).toMatchObject({ canEdit: true, canDelete: true });
    expect(led.capabilities.transitions.map((option) => option.toStatusId)).toContain("COMPLETE");
  });

  it("quantity correction by a demoted leader → 403, nothing written", async () => {
    const done = taskRow({ done_at: new Date("2026-10-10T03:00:00Z"), qty_done: 10, status_id: "DONE", job_leader_id: me, assignee_id: third, qc_id: me });
    db.state.handler = taskQueries(done);
    expect(await failure(updateProductionTaskQty(contextWith(["STAFF", "QC"]), taskId, { qtyDone: 99 }))).toEqual({ code: "FORBIDDEN", status: 403 });
    expect(wrote(/^UPDATE production\.tasks/)).toBe(false);
  });

  it("job edit by a demoted leader → 404 (the job is no longer theirs to see), nothing written", async () => {
    db.state.handler = (call) =>
      call.text.startsWith("SELECT leader_id, custom_values, archived_at FROM production.jobs") ? [{ leader_id: me, custom_values: {}, archived_at: null }] : [];
    expect(await failure(updateJob(contextWith(["STAFF"]), jobId, { name: "x" }))).toEqual({ code: "JOB_NOT_FOUND", status: 404 });
    expect(wrote(/^UPDATE production\.jobs/)).toBe(false);
  });

  it("job visibility of non-all-jobs callers no longer goes through leader_id", async () => {
    expect(await failure(assertJobVisible(db.sql as unknown as QuerySql, contextWith(["STAFF"]), jobId))).toEqual({ code: "JOB_NOT_FOUND", status: 404 });
    const check = db.state.calls.at(-1)!;
    expect(check.text).not.toContain("leader_id");
    expect(check.text).toContain("t.assignee_id = $ OR t.qc_id = $");
  });

  it("private score mode: a demoted leader sees only their own rows of the task", async () => {
    const task = taskRow({ job_leader_id: me, assignee_id: third, qc_id: me });
    const scoreQuery = () => db.state.calls.find((call) => call.text.includes("FROM production.score_entries e"))!;
    db.state.handler = taskQueries(task);
    await getTaskScores(contextWith(["STAFF", "QC"]), taskId);
    expect(scoreQuery().text).toContain("AND e.user_id = $");
    db.state.calls = [];
    await getTaskScores(contextWith(["LEADER", "QC"]), taskId);
    expect(scoreQuery().text).not.toContain("AND e.user_id = $");
  });
});

describe("SEC2-08 — deleting a production comment has the same checks as editing", () => {
  const comment = (entity: "TASK" | "JOB") => ({
    id: commentId,
    cursor_at: "2026-10-10 03:00:00.000000+00",
    entity,
    entity_id: entity === "TASK" ? taskId : jobId,
    job_id: jobId,
    user_id: me,
    author: userJson(me),
    body: "hi",
    mentioned_user_ids: [],
    created_at: new Date(),
    edited_at: null
  });
  const answer = (entity: "TASK" | "JOB", task: TaskRow, job = { archived: false, people: [me] }) => (call: Call) =>
    call.text.includes("FROM production.comments c WHERE c.organization_id") ? [comment(entity)]
    : call.text.includes("AS archived, coalesce(") ? [job]
    : taskQueries(task)(call);

  it("archived job → 409 JOB_ARCHIVED, comment kept", async () => {
    db.state.handler = answer("TASK", taskRow({ job_archived: true }));
    expect(await failure(deleteProductionComment(contextWith(["STAFF"]), commentId))).toEqual({ code: "JOB_ARCHIVED", status: 409 });
    expect(wrote(/^UPDATE production\.comments/)).toBe(false);

    db.state.handler = answer("JOB", taskRow(), { archived: true, people: [me] });
    expect(await failure(deleteProductionComment(contextWith(["STAFF"]), commentId))).toEqual({ code: "JOB_ARCHIVED", status: 409 });
    expect(wrote(/^UPDATE production\.comments/)).toBe(false);
  });

  it("an author taken off the task can no longer delete there (404)", async () => {
    db.state.handler = answer("TASK", taskRow({ assignee_id: third }));
    expect(await failure(deleteProductionComment(contextWith(["STAFF"]), commentId))).toEqual({ code: "TASK_NOT_FOUND", status: 404 });
    expect(wrote(/^UPDATE production\.comments/)).toBe(false);
  });

  it("the author on a live task still deletes", async () => {
    db.state.handler = answer("TASK", taskRow());
    expect(await deleteProductionComment(contextWith(["STAFF"]), commentId)).toEqual({ ok: true });
    expect(wrote(/^UPDATE production\.comments SET deleted_at/)).toBe(true);
  });
});

describe("SEC2-09 — colleagues' e-mails in production responses", () => {
  it("only Admin / Leader / Account see them", () => {
    expect(seesColleagueEmails(contextWith(["STAFF"]))).toBe(false);
    expect(seesColleagueEmails(contextWith(["STAFF", "QC"]))).toBe(false);
    expect(seesColleagueEmails(contextWith(["QC", "LEADER"]))).toBe(true);
    expect(seesColleagueEmails(contextWith(["ACCOUNT"]))).toBe(true);
    expect(seesColleagueEmails(contextWith([], true))).toBe(true);
  });

  it("nulls every person's email except the caller's, deep, without touching other fields", () => {
    const body = {
      assignee: { id: other, displayName: "B", email: "b@x.test", avatarUrl: null },
      qc: { id: me, displayName: "Me", email: "me@x.test", avatarUrl: null },
      items: [{ userId: third, displayName: "C", email: "c@x.test", roles: ["QC"], customValues: { email: "keep" } }],
      log: { toValue: { email: "not-a-person@x.test" } },
      nothing: null
    };
    const redacted = redactColleagueEmails(body, me);
    expect(redacted.assignee.email).toBeNull();
    expect(redacted.qc.email).toBe("me@x.test");
    expect(redacted.items[0]!.email).toBeNull();
    expect(redacted.items[0]!.roles).toEqual(["QC"]);
    // Objects that are not people (no displayName) keep their values.
    expect(redacted.items[0]!.customValues).toEqual({ email: "keep" });
    expect(redacted.log.toValue.email).toBe("not-a-person@x.test");
    // The input is not mutated.
    expect(body.assignee.email).toBe("b@x.test");
    expect(redactColleagueEmails(undefined, me)).toBeUndefined();
  });
});

describe("SEC2-11 — anomaly reviews", () => {
  const leader = contextWith(["LEADER"]);
  const admin = contextWith(["ADMIN"]);
  const fastRow = {
    task_id: taskId,
    task_number: "7",
    job_id: jobId,
    job_code: "JOB-1",
    assignee: userJson(third),
    assigned_at: new Date(Date.now() - 3_600_000),
    done_at: new Date(Date.now() - 3_480_000),
    qty_done: 10,
    seconds: "120"
  };
  const qtyRow = { ...fastRow, qty_assigned: 10, qty_done: 12, changed_by: null, changed_at: null, action: "STATUS" };

  it("workerFailRateKeys lists the counts of every look-back window above the threshold", () => {
    const now = new Date("2026-10-11T00:00:00Z");
    const day = (n: number) => new Date(now.getTime() - n * 86_400_000 + 1000);
    const tasks = [
      { doneAt: day(1), fbWrong: false, qcFailed: true },
      { doneAt: day(1), fbWrong: false, qcFailed: false },
      { doneAt: day(10), fbWrong: false, qcFailed: false },
      { doneAt: day(10), fbWrong: false, qcFailed: false },
      { doneAt: day(100), fbWrong: true, qcFailed: false }
    ];
    const keys = workerFailRateKeys(third, tasks, now, 0.2);
    expect(keys.has(`${third}:0:1`)).toBe(true); // 1/2 in the 1–9 day windows, 1/4 in 10–99
    expect(keys.has(`${third}:1:1`)).toBe(false); // 100+ days: 1/5 FB and 1/5 QC — not above 20 %
    expect(keys.has(`${third}:0:2`)).toBe(false);
    expect(workerFailRateKeys(third, [], now, 0.2).size).toBe(0);
  });

  it("a key that is not in the caller's own computed list → 404, nothing stored", async () => {
    db.state.handler = () => [];
    expect(await failure(reviewAnomaly(leader, { kind: "FAST_DONE", key: taskId }))).toEqual({ code: "ANOMALY_NOT_FOUND", status: 404 });
    const check = db.state.calls.find((call) => call.text.includes("make_interval(mins"))!;
    // Scoped to the leader's jobs and to the subject.
    expect(check.text).toContain("AND (j.leader_id = $ OR j.leader_id IS NULL)");
    expect(check.values).toContain(me);
    expect(check.values).toContain(taskId);
    expect(wrote(/INSERT INTO production\.anomaly_reviews/)).toBe(false);
  });

  it("only the exact key is accepted (a changed suffix is refused)", async () => {
    db.state.handler = (call) => (call.text.includes("t.qty_done <> t.qty_assigned") ? [qtyRow] : [{ reviewed_at: new Date() }]);
    expect(await failure(reviewAnomaly(leader, { kind: "QTY_MISMATCH", key: `${taskId}:13` }))).toEqual({ code: "ANOMALY_NOT_FOUND", status: 404 });
    expect(wrote(/INSERT INTO production\.anomaly_reviews/)).toBe(false);
    const result = await reviewAnomaly(leader, { kind: "QTY_MISMATCH", key: `${taskId}:12` });
    expect(result.reviewedAt).toBeTruthy();
    const insert = db.state.calls.find((call) => call.text.startsWith("INSERT INTO production.anomaly_reviews"))!;
    expect(insert.values).toContain(taskId);
  });

  it("a leader cannot review an ADMIN-scope worker key the leader's own jobs do not produce", async () => {
    const recent = new Date(Date.now() - 86_400_000);
    // In the leader's jobs the worker has 1 failed task out of 3 → key ":0:1"; the forged key claims ":0:2".
    db.state.handler = (call) =>
      call.text.includes("t.qc_fail_count > 0 AS qc_failed")
        ? [
            { done_at: recent, fb_wrong: false, qc_failed: true },
            { done_at: recent, fb_wrong: false, qc_failed: false },
            { done_at: recent, fb_wrong: false, qc_failed: false }
          ]
        : [{ reviewed_at: new Date() }];
    expect(await failure(reviewAnomaly(leader, { kind: "WORKER_FAIL_RATE", key: `${third}:0:2` }))).toEqual({ code: "ANOMALY_NOT_FOUND", status: 404 });
    expect(wrote(/INSERT INTO production\.anomaly_reviews/)).toBe(false);
    const scope = db.state.calls.find((call) => call.text.includes("t.qc_fail_count > 0 AS qc_failed"))!;
    expect(scope.text).toContain("AND (j.leader_id = $ OR j.leader_id IS NULL)");
    await reviewAnomaly(leader, { kind: "WORKER_FAIL_RATE", key: `${third}:0:1` });
    expect(wrote(/INSERT INTO production\.anomaly_reviews/)).toBe(true);
  });

  it("someone else's review is not taken over by a second mark", async () => {
    const earlier = new Date("2026-10-01T00:00:00Z");
    db.state.handler = (call) =>
      call.text.includes("make_interval(mins") ? [fastRow]
      : call.text.startsWith("INSERT INTO production.anomaly_reviews") ? [] // conflict, WHERE false → not updated
      : call.text.startsWith("SELECT reviewed_at FROM production.anomaly_reviews") ? [{ reviewed_at: earlier }]
      : [];
    const result = await reviewAnomaly(leader, { kind: "FAST_DONE", key: taskId });
    expect(result.reviewedAt).toBe(earlier.toISOString());
    const insert = db.state.calls.find((call) => call.text.startsWith("INSERT INTO production.anomaly_reviews"))!;
    expect(insert.text).toContain("WHERE $::boolean OR r.reviewed_by = $");
    expect(insert.values).toContain(false);
  });

  it("un-review: only the original reviewer or an ADMIN", async () => {
    const reviewBy = (userId: string | null) => (call: Call) =>
      call.text.startsWith("SELECT reviewed_by FROM production.anomaly_reviews") ? [{ reviewed_by: userId }] : [];
    db.state.handler = reviewBy(other);
    expect(await failure(unreviewAnomaly(leader, { kind: "FAST_DONE", key: taskId }))).toEqual({ code: "ANOMALY_REVIEW_NOT_OWNER", status: 403 });
    expect(wrote(/^DELETE FROM production\.anomaly_reviews/)).toBe(false);

    db.state.handler = reviewBy(me);
    expect(await unreviewAnomaly(leader, { kind: "FAST_DONE", key: taskId })).toEqual({ kind: "FAST_DONE", key: taskId, reviewedAt: null });
    expect(wrote(/^DELETE FROM production\.anomaly_reviews/)).toBe(true);

    db.state.calls = [];
    db.state.handler = reviewBy(other);
    await unreviewAnomaly(admin, { kind: "FAST_DONE", key: taskId });
    expect(wrote(/^DELETE FROM production\.anomaly_reviews/)).toBe(true);

    db.state.calls = [];
    db.state.handler = () => [];
    expect((await unreviewAnomaly(leader, { kind: "FAST_DONE", key: taskId })).reviewedAt).toBeNull();
    expect(wrote(/^DELETE FROM production\.anomaly_reviews/)).toBe(false);
  });
});
