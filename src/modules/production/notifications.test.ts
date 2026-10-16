import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NotificationDraft } from "../notifications/notifications.service.js";
import type { DomainEventEnvelope } from "../events/outbox.js";

/**
 * SPEC §6 Phase 4 §1 / PLAN §8 notification recipients: the pure rules (`productionRecipients`) and the worker
 * handlers that load the people, against a fake tagged-template `sql` (no database).
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
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
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
  return { state, sql: Object.assign(sql, { json: (value: unknown) => value }) };
});

const delivered = vi.hoisted(() => ({ drafts: [] as NotificationDraft[] }));

vi.mock("../../db/client.js", () => ({ getSql: () => db.sql }));
vi.mock("../notifications/notifications.service.js", () => ({
  deliverNotifications: vi.fn((draft: NotificationDraft) => {
    delivered.drafts.push(draft);
    return Promise.resolve(draft.recipientIds.length);
  })
}));

const { productionRecipients, productionNotificationHandlers, notifyDeadline, leaveRequestedBody, leaveReasonExcerpt } = await import("./notifications.js");

const org = "11111111-1111-4111-8111-111111111111";
const assignee = "22222222-2222-4222-8222-222222222222";
const qc = "33333333-3333-4333-8333-333333333333";
const leader = "44444444-4444-4444-8444-444444444444";
const creator = "55555555-5555-4555-8555-555555555555";
const writer = "66666666-6666-4666-8666-666666666666";
const otherWorker = "77777777-7777-4777-8777-777777777777";
const superadmin = "88888888-8888-4888-8888-888888888888";
const admin = "99999999-9999-4999-8999-999999999999";
const taskId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const jobId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const commentId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const envelope = (type: string, payload: Record<string, unknown>, actorUserId: string | null = writer): DomainEventEnvelope => ({
  id: "1001",
  type,
  organizationId: org,
  aggregateType: "x",
  aggregateId: null,
  actorUserId,
  payload,
  occurredAt: "2026-10-11T00:00:00.000Z"
});

const taskInfo = (overrides: Record<string, unknown> = {}) => ({
  id: taskId,
  number: 3,
  job_id: jobId,
  job_code: "JOB-9",
  leader_id: leader,
  leader_active: true,
  assignee_id: assignee,
  qc_id: qc,
  process_name: "Retouch",
  qty_assigned: 10,
  qty_done: null,
  deadline: new Date("2026-10-12T00:00:00Z"),
  ...overrides
});

const draftsOf = (type: string) => delivered.drafts.filter((draft) => draft.type === type);
const sorted = (ids: string[]) => [...ids].sort();

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = () => [];
  delivered.drafts = [];
});

describe("productionRecipients (SPEC Phase 4 / PLAN §8)", () => {
  const people = { assigneeId: assignee, qcId: qc, leaderId: leader };

  it("task events go to the right single person", () => {
    expect(productionRecipients.taskAssigned(people)).toEqual([assignee]);
    expect(productionRecipients.waitingQc(people)).toEqual([qc]);
    expect(productionRecipients.qcFailed(people)).toEqual([assignee]);
    expect(productionRecipients.checked(people)).toEqual([leader]);
    expect(productionRecipients.qtyChanged(people)).toEqual([assignee]);
  });

  it("a job given to a Leader notifies that Leader only; no Leader notifies nobody", () => {
    expect(productionRecipients.jobLeaderAssigned(leader)).toEqual([leader]);
    expect(productionRecipients.jobLeaderAssigned(null)).toEqual([]);
  });

  it("late / due soon → assignee + leader; no QC → waiting QC notifies nobody", () => {
    expect(sorted(productionRecipients.deadline(people))).toEqual(sorted([assignee, leader]));
    expect(productionRecipients.waitingQc({ ...people, qcId: null })).toEqual([]);
  });

  it("a leader who lost LEADER (leaderId null) is not told about the job any more (SEC2-04)", () => {
    const demoted = { ...people, leaderId: null };
    expect(productionRecipients.checked(demoted)).toEqual([]);
    expect(productionRecipients.deadline(demoted)).toEqual([assignee]);
    expect(productionRecipients.feedback(null, [assignee])).toEqual([assignee]);
  });

  it("feedback → leader + previous workers, de-duplicated", () => {
    expect(sorted(productionRecipients.feedback(leader, [assignee, otherWorker, assignee]))).toEqual(sorted([leader, assignee, otherWorker]));
  });

  it("task comment → assignee, QC, leader; never the writer; mentioned people only get the mention", () => {
    expect(sorted(productionRecipients.taskComment(people, writer))).toEqual(sorted([assignee, qc, leader]));
    expect(sorted(productionRecipients.taskComment(people, assignee))).toEqual(sorted([qc, leader]));
    expect(productionRecipients.taskComment(people, writer, [qc, leader])).toEqual([assignee]);
  });

  it("job comment → leader, creator, every worker and QC of the job; never the writer (PD-023)", () => {
    const job = { leaderId: leader, creatorId: creator, workerIds: [assignee, qc, otherWorker, writer] };
    expect(sorted(productionRecipients.jobComment(job, writer))).toEqual(sorted([leader, creator, assignee, qc, otherWorker]));
    expect(sorted(productionRecipients.jobComment(job, leader, [otherWorker]))).toEqual(sorted([creator, assignee, qc, writer]));
    expect(productionRecipients.jobComment({ leaderId: null, creatorId: null, workerIds: [] }, writer)).toEqual([]);
  });

  it("mentions never include the writer", () => {
    expect(productionRecipients.mentioned([writer, qc, qc], writer)).toEqual([qc]);
  });

  it("leave: request → approvers minus the requester; decision → requester", () => {
    expect(sorted(productionRecipients.leaveRequested([leader, admin, assignee], assignee))).toEqual(sorted([leader, admin]));
    expect(productionRecipients.leaveDecided(assignee)).toEqual([assignee]);
  });

  it("KPI settled → each person + every admin (superadmin included)", () => {
    expect(productionRecipients.kpiSettledPerson(assignee)).toEqual([assignee]);
    expect(sorted(productionRecipients.kpiSettledAdmins([admin, superadmin, admin]))).toEqual(sorted([admin, superadmin]));
  });

  it("PD-044 quantity request → the job's active Leader, else the Admins (never the requester); decision → the requester", () => {
    expect(productionRecipients.qtyChangeRequested(people, [admin, superadmin], assignee)).toEqual([leader]);
    // No active Leader (none, or demoted: leaderId null) → the production Admins.
    expect(sorted(productionRecipients.qtyChangeRequested({ ...people, leaderId: null }, [admin, superadmin, admin], assignee))).toEqual(
      sorted([admin, superadmin])
    );
    // The Leader asking on their own line, or an Admin asking: never told about their own request.
    expect(productionRecipients.qtyChangeRequested({ ...people, assigneeId: leader }, [admin], leader)).toEqual([admin]);
    expect(productionRecipients.qtyChangeRequested({ ...people, leaderId: null, assigneeId: admin }, [admin, superadmin], admin)).toEqual([superadmin]);
    expect(productionRecipients.qtyChangeDecided(assignee)).toEqual([assignee]);
  });

  it("PD-045 job status changed → the active Leader + every Account / Admin (superadmins included), never the actor", () => {
    expect(sorted(productionRecipients.jobStatusChanged(leader, [admin, superadmin, creator, admin], assignee))).toEqual(sorted([leader, admin, superadmin, creator]));
    // The Leader (or an Admin) who changed it is not told; no active Leader → the Account / Admin people only.
    expect(sorted(productionRecipients.jobStatusChanged(leader, [admin, superadmin], leader))).toEqual(sorted([admin, superadmin]));
    expect(sorted(productionRecipients.jobStatusChanged(null, [admin, superadmin], admin))).toEqual([superadmin]);
    expect(productionRecipients.jobStatusChanged(null, [], writer)).toEqual([]);
  });
});

describe("worker handlers load the people the rules need", () => {
  it("TASK_CHECKED goes to the job leader only while they still lead", async () => {
    db.state.handler = (call) => (call.text.includes("AS leader_active") && call.text.includes("FROM production.tasks t") ? [taskInfo()] : undefined);
    await productionNotificationHandlers["production.task.status_changed"]!(envelope("production.task.status_changed", { taskId, enteredChecked: true }, qc));
    expect(draftsOf("production.task_checked")[0]?.recipientIds).toEqual([leader]);
    // The SQL decides "still leads" from LEADER / ADMIN or superadmin.
    const query = db.state.calls.find((call) => call.text.includes("AS leader_active"))!;
    expect(query.text).toContain("'LEADER', 'ADMIN'");
    expect(query.text).toContain("'superadmin'");

    delivered.drafts = [];
    db.state.handler = (call) => (call.text.includes("AS leader_active") ? [taskInfo({ leader_active: false })] : undefined);
    await productionNotificationHandlers["production.task.status_changed"]!(envelope("production.task.status_changed", { taskId, enteredChecked: true }, qc));
    expect(draftsOf("production.task_checked")[0]?.recipientIds).toEqual([]);
  });

  it("QC fail → assignee with the note; Done with a QC → QC", async () => {
    db.state.handler = (call) => (call.text.includes("AS leader_active") ? [taskInfo()] : undefined);
    await productionNotificationHandlers["production.task.status_changed"]!(
      envelope("production.task.status_changed", { taskId, qcFail: true, note: "Sai màu" }, qc)
    );
    await productionNotificationHandlers["production.task.status_changed"]!(envelope("production.task.status_changed", { taskId, enteredWaitingQc: true }, assignee));
    expect(draftsOf("production.qc_failed")[0]).toMatchObject({ recipientIds: [assignee], body: "Sai màu" });
    expect(draftsOf("production.task_waiting_qc")[0]?.recipientIds).toEqual([qc]);
  });

  it("PD-044 quantity request → the active Leader with the request in the payload; no Leader → the Admins", async () => {
    const requestId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const request = (status: string) => ({
      id: requestId,
      from_qty: 10,
      to_qty: 12,
      reason: "Thư mục có thêm 2 ảnh",
      status,
      requested_by: assignee,
      decision_note: status === "REJECTED" ? "Đã đủ ảnh" : null
    });
    let state = { leaderActive: true, status: "PENDING" };
    db.state.handler = (call) => {
      if (call.text.includes("AS leader_active") && call.text.includes("FROM production.tasks t")) {
        return [taskInfo({ leader_active: state.leaderActive })];
      }
      if (call.text.includes("FROM production.task_qty_requests")) {
        return [request(state.status)];
      }
      if (call.text.includes("role_code = 'ADMIN'")) {
        return [{ user_id: admin }, { user_id: superadmin }];
      }
      return undefined;
    };
    await productionNotificationHandlers["production.task.qty_change_requested"]!(envelope("production.task.qty_change_requested", { taskId, requestId }, assignee));
    const [asked] = draftsOf("production.qty_change_requested");
    expect(asked).toMatchObject({ recipientIds: [leader], body: "#3: 10 → 12 tấm — Thư mục có thêm 2 ảnh" });
    expect(asked!.payload).toMatchObject({
      productionTaskId: taskId,
      requestId,
      fromQty: 10,
      toQty: 12,
      reason: "Thư mục có thêm 2 ảnh",
      approved: null,
      decisionNote: null
    });
    expect(db.state.calls.some((call) => call.text.includes("role_code = 'ADMIN'"))).toBe(false);

    delivered.drafts = [];
    state = { leaderActive: false, status: "PENDING" };
    await productionNotificationHandlers["production.task.qty_change_requested"]!(envelope("production.task.qty_change_requested", { taskId, requestId }, assignee));
    expect(sorted(draftsOf("production.qty_change_requested")[0]!.recipientIds)).toEqual(sorted([admin, superadmin]));

    // Cancelled before the worker ran: nobody is told.
    delivered.drafts = [];
    state = { leaderActive: true, status: "CANCELLED" };
    await productionNotificationHandlers["production.task.qty_change_requested"]!(envelope("production.task.qty_change_requested", { taskId, requestId }, assignee));
    expect(delivered.drafts).toHaveLength(0);

    // The decision goes back to the worker who asked.
    state = { leaderActive: true, status: "REJECTED" };
    await productionNotificationHandlers["production.task.qty_change_decided"]!(envelope("production.task.qty_change_decided", { taskId, requestId }, leader));
    const [decided] = draftsOf("production.qty_change_decided");
    expect(decided).toMatchObject({ recipientIds: [assignee], body: "#3: 10 → 12 tấm bị từ chối — Đã đủ ảnh" });
    expect(decided!.payload).toMatchObject({ approved: false, decisionNote: "Đã đủ ảnh" });
  });

  it("PD-045: a subtask is named by its code (1216a) in the body and the payload", async () => {
    db.state.handler = (call) =>
      call.text.includes("AS leader_active") && call.text.includes("FROM production.tasks t") ? [taskInfo({ number: 1300, sub_seq: 1, parent_number: "1216" })] : undefined;
    await productionNotificationHandlers["production.task.status_changed"]!(envelope("production.task.status_changed", { taskId, enteredWaitingQc: true }, assignee));
    const [draft] = draftsOf("production.task_waiting_qc");
    expect(draft).toMatchObject({ body: "#1216a · Retouch · 10 tấm" });
    expect(draft!.payload).toMatchObject({ taskNumber: 1300, taskCode: "1216a" });
    // The task query reads the subtask's letter and its line's number.
    const query = db.state.calls.find((call) => call.text.includes("AS leader_active"))!;
    expect(query.text).toContain("t.sub_seq");
    expect(query.text).toContain("AS parent_number");

    delivered.drafts = [];
    db.state.handler = (call) => (call.text.includes("AS leader_active") && call.text.includes("FROM production.tasks t") ? [taskInfo({ sub_seq: null, parent_number: null })] : undefined);
    await productionNotificationHandlers["production.task.status_changed"]!(envelope("production.task.status_changed", { taskId, enteredWaitingQc: true }, assignee));
    expect(draftsOf("production.task_waiting_qc")[0]).toMatchObject({ body: "#3 · Retouch · 10 tấm", payload: { taskCode: "3" } });
  });

  it("PD-045 job status changed → active Leader + Account / Admin (minus the actor), title the job code, body from → to", async () => {
    const accountant = "abababab-abab-4bab-8bab-abababababab";
    const from = { id: "a1111111-1111-4111-8111-111111111111", name: "Đang làm", color: "blue" };
    const to = { id: "a2222222-2222-4222-8222-222222222222", name: "Đã xong", color: "green" };
    let leaderActive = true;
    db.state.handler = (call) => {
      if (call.text.includes("AS leader_active FROM production.jobs j")) {
        return [{ code: "JOB-9", name: "Lô ảnh 9", leader_id: leader, leader_active: leaderActive }];
      }
      if (call.text.includes("ur.role_code = ANY(")) {
        return [{ user_id: accountant }, { user_id: admin }, { user_id: superadmin }];
      }
      return undefined;
    };
    await productionNotificationHandlers["production.job.status_changed"]!(envelope("production.job.status_changed", { jobId, from, to }, admin));
    const [draft] = draftsOf("production.job_status_changed");
    expect(sorted(draft!.recipientIds)).toEqual(sorted([leader, accountant, superadmin]));
    expect(draft).toMatchObject({ title: "JOB-9", body: "Đang làm → Đã xong", actorUserId: admin, payload: { jobId, jobCode: "JOB-9", jobName: "Lô ảnh 9", from, to } });
    // ACCOUNT / ADMIN holders, superadmins included.
    const roleQuery = db.state.calls.find((call) => call.text.includes("ur.role_code = ANY("))!;
    expect(roleQuery.values).toContainEqual(["ACCOUNT", "ADMIN"]);
    expect(roleQuery.text).toContain("r.key = 'superadmin'");

    // A demoted Leader is not told; a malformed event or a deleted job tells nobody.
    delivered.drafts = [];
    leaderActive = false;
    await productionNotificationHandlers["production.job.status_changed"]!(envelope("production.job.status_changed", { jobId, from, to }, admin));
    expect(sorted(draftsOf("production.job_status_changed")[0]!.recipientIds)).toEqual(sorted([accountant, superadmin]));
    delivered.drafts = [];
    await productionNotificationHandlers["production.job.status_changed"]!(envelope("production.job.status_changed", { jobId, from }, admin));
    db.state.handler = () => [];
    await productionNotificationHandlers["production.job.status_changed"]!(envelope("production.job.status_changed", { jobId, from, to }, admin));
    expect(delivered.drafts).toHaveLength(0);
  });

  it("a job comment notifies leader, creator and every worker / QC of the job, never the writer", async () => {
    db.state.handler = (call) => {
      if (call.text.startsWith("SELECT 1 FROM production.comments")) {
        return [{ "?column?": 1 }];
      }
      if (call.text.includes("AS creator_sees_jobs")) {
        return [
          { code: "JOB-9", leader_id: leader, leader_active: true, created_by: creator, creator_sees_jobs: true, workers: [assignee, qc, otherWorker, writer] }
        ];
      }
      return undefined;
    };
    await productionNotificationHandlers["production.comment.created"]!(
      envelope("production.comment.created", { jobId, taskId: null, commentId, excerpt: "Xin chào", mentionedUserIds: [otherWorker] })
    );
    expect(draftsOf("production.mentioned")[0]?.recipientIds).toEqual([otherWorker]);
    expect(sorted(draftsOf("production.commented")[0]!.recipientIds)).toEqual(sorted([leader, creator, assignee, qc]));
    expect(draftsOf("production.commented")[0]?.payload).toMatchObject({ jobId, commentId });
  });

  it("a job comment skips a demoted leader and a creator who no longer sees jobs", async () => {
    db.state.handler = (call) => {
      if (call.text.startsWith("SELECT 1 FROM production.comments")) {
        return [{ "?column?": 1 }];
      }
      if (call.text.includes("AS creator_sees_jobs")) {
        return [{ code: "JOB-9", leader_id: leader, leader_active: false, created_by: creator, creator_sees_jobs: false, workers: [assignee] }];
      }
      return undefined;
    };
    await productionNotificationHandlers["production.comment.created"]!(envelope("production.comment.created", { jobId, taskId: null, commentId, mentionedUserIds: [] }));
    expect(draftsOf("production.commented")[0]?.recipientIds).toEqual([assignee]);
  });

  it("a task comment notifies the task's worker, QC and leader; a comment deleted meanwhile notifies nobody", async () => {
    db.state.handler = (call) => {
      if (call.text.startsWith("SELECT 1 FROM production.comments")) {
        return [{ "?column?": 1 }];
      }
      if (call.text.includes("AS creator_sees_jobs")) {
        return [{ code: "JOB-9", leader_id: leader, leader_active: true, created_by: creator, creator_sees_jobs: true, workers: [assignee, qc, otherWorker] }];
      }
      if (call.text.includes("AS leader_active") && call.text.includes("FROM production.tasks t")) {
        return [taskInfo()];
      }
      return undefined;
    };
    await productionNotificationHandlers["production.comment.created"]!(
      envelope("production.comment.created", { jobId, taskId, commentId, mentionedUserIds: [] }, assignee)
    );
    expect(sorted(draftsOf("production.commented")[0]!.recipientIds)).toEqual(sorted([qc, leader]));

    delivered.drafts = [];
    db.state.handler = () => [];
    await productionNotificationHandlers["production.comment.created"]!(envelope("production.comment.created", { jobId, taskId, commentId, mentionedUserIds: [qc] }));
    expect(delivered.drafts).toHaveLength(0);
  });

  it("feedback → active leader + the previous workers", async () => {
    db.state.handler = (call) => (call.text.includes("AS workers") ? [{ code: "JOB-9", leader_id: leader, leader_active: true, workers: [assignee] }] : undefined);
    await productionNotificationHandlers["production.feedback.created"]!(
      envelope("production.feedback.created", { jobId, type: "WRONG", note: "Sai", sourceTaskId: null, taskIds: [taskId] }, creator)
    );
    expect(sorted(draftsOf("production.feedback")[0]!.recipientIds)).toEqual(sorted([leader, assignee]));
  });

  it("late / due soon → assignee + active leader", async () => {
    db.state.handler = (call) => (call.text.includes("AS leader_active") ? [taskInfo(), taskInfo({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", leader_active: false })] : undefined);
    await notifyDeadline("production.task_late", [
      { organization_id: org, id: taskId },
      { organization_id: org, id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }
    ]);
    const late = draftsOf("production.task_late");
    expect(sorted(late[0]!.recipientIds)).toEqual(sorted([assignee, leader]));
    expect(late[1]!.recipientIds).toEqual([assignee]);
  });

  it("KPI settled → each settled person and every production ADMIN including organization superadmins", async () => {
    db.state.handler = (call) => {
      if (call.text.includes("FROM production.kpi_settlement_runs")) {
        return [{ period: "2026-10", user_count: 1, met_count: 1, not_met_count: 0 }];
      }
      if (call.text.includes("FROM production.kpi_settlements")) {
        return [
          { user_id: assignee, met: true, target_points: "2600", points_official: "2700", khoan_points_converted: "0", khoan_money: "0", total_points: "2700" }
        ];
      }
      if (call.text.includes("role_code = 'ADMIN'")) {
        return [{ user_id: admin }, { user_id: superadmin }];
      }
      return undefined;
    };
    await productionNotificationHandlers["production.kpi.settled"]!(envelope("production.kpi.settled", { runId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }, null));
    const [personal, summary] = draftsOf("production.kpi_settled");
    expect(personal?.recipientIds).toEqual([assignee]);
    expect(sorted(summary!.recipientIds)).toEqual(sorted([admin, superadmin]));
    const adminQuery = db.state.calls.find((call) => call.text.includes("role_code = 'ADMIN'"))!;
    expect(adminQuery.text).toContain("r.key = 'superadmin'");
  });

  it("leave requested → the approvers only: active production admins and superadmins (PD-057: no Leaders), never the requester", async () => {
    db.state.handler = (call) => {
      if (call.text.includes("FROM production.leave_requests lr")) {
        return [{ user_id: assignee, display_name: "NV", from_date: "2026-10-12", to_date: "2026-10-12", part: "FULL_DAY", status: "PENDING", note: "Việc gia đình", decision_note: null }];
      }
      if (call.text.includes("ur.role_code = 'ADMIN'")) {
        return [{ user_id: admin }, { user_id: superadmin }, { user_id: assignee }];
      }
      return undefined;
    };
    await productionNotificationHandlers["production.leave.requested"]!(envelope("production.leave.requested", { leaveId: "ffffffff-ffff-4fff-8fff-ffffffffffff" }, assignee));
    const [draft] = draftsOf("production.leave_requested");
    expect(sorted(draft!.recipientIds)).toEqual(sorted([admin, superadmin]));
    // What, when and why for the approver (PD-057).
    expect(draft!.body).toBe("Nghỉ cả ngày 12/10: Việc gia đình");
    expect(draft!.payload).toMatchObject({ requesterName: "NV", fromDate: "2026-10-12", part: "FULL_DAY", reason: "Việc gia đình", note: null });
    const approverQuery = db.state.calls.find((call) => call.text.includes("ur.role_code = 'ADMIN'"))!;
    // Admins must be active members; superadmins are implicit Admins; Leaders are not asked any more.
    expect(approverQuery.text).toContain("om.status = 'active'");
    expect(approverQuery.text).toContain("r.key = 'superadmin'");
    expect(db.state.calls.some((call) => call.text.includes("LEADER"))).toBe(false);
  });

  it("leave request body: part, dates and the reason, cut to 200 characters on one line", () => {
    const leave = (part: string, from: string, to: string, note: string | null) => ({ part, from_date: from, to_date: to, note });
    expect(leaveRequestedBody(leave("FULL_DAY", "2026-10-20", "2026-10-21", "Việc gia đình"))).toBe("Nghỉ cả ngày 20/10 – 21/10: Việc gia đình");
    expect(leaveRequestedBody(leave("MORNING", "2026-10-20", "2026-10-20", " Khám\n bệnh "))).toBe("Nghỉ buổi sáng 20/10: Khám bệnh");
    expect(leaveRequestedBody(leave("AFTERNOON", "2026-12-31", "2026-12-31", null))).toBe("Nghỉ buổi chiều 31/12");
    expect(leaveRequestedBody(leave("FULL_DAY", "2026-12-30", "2027-01-02", "   "))).toBe("Nghỉ cả ngày 30/12 – 02/01");
    const long = leaveReasonExcerpt("ố".repeat(500))!;
    expect([...long]).toHaveLength(200);
    expect(long.endsWith("…")).toBe(true);
    expect(leaveReasonExcerpt("a".repeat(200))).toBe("a".repeat(200));
    expect(leaveReasonExcerpt(null)).toBeNull();
  });

  it("leader removed → production admins get the list of open jobs; nothing once the person leads again", async () => {
    const jobs = [{ id: jobId, code: "JOB-9", name: null, deadline: new Date("2026-10-20T00:00:00Z"), job_status_id: jobId, job_status_name: "Đang làm", job_status_color: "blue", job_status_closed: false, task_count: 2 }];
    let leaderActive = false;
    db.state.handler = (call) => {
      if (call.text.includes("AS leader_active FROM public.app_users")) {
        return [{ display_name: "Lead Một", leader_active: leaderActive }];
      }
      // Open = manual job status not closed (PD-038).
      if (call.text.includes("FROM production.jobs j JOIN production.job_statuses js") && call.text.includes("NOT js.is_closed")) {
        return jobs;
      }
      if (call.text.includes("role_code = 'ADMIN'")) {
        return [{ user_id: admin }, { user_id: superadmin }];
      }
      return undefined;
    };
    await productionNotificationHandlers["production.member.leader_removed"]!(envelope("production.member.leader_removed", { userId: leader, reason: "role_removed" }, admin));
    const [draft] = draftsOf("production.leader_removed");
    expect(sorted(draft!.recipientIds)).toEqual(sorted([admin, superadmin]));
    expect(draft!.payload).toMatchObject({ userId: leader, jobCount: 1, jobs: [{ id: jobId, code: "JOB-9" }] });

    delivered.drafts = [];
    leaderActive = true;
    await productionNotificationHandlers["production.member.leader_removed"]!(envelope("production.member.leader_removed", { userId: leader }, admin));
    expect(delivered.drafts).toHaveLength(0);
  });
});

describe("PD-058 a quantity filled in (production.qty_filled) and tasks without a quantity", () => {
  const people = { assigneeId: assignee, qcId: qc, leaderId: leader };

  it("goes to the job's active Leader (never the person who filled it in); without one to the production Admins", () => {
    expect(productionRecipients.qtyFilled(people, [admin], assignee)).toEqual([leader]);
    // The Leader filling it in tells nobody.
    expect(productionRecipients.qtyFilled(people, [admin], leader)).toEqual([]);
    expect(sorted(productionRecipients.qtyFilled({ ...people, leaderId: null }, [admin, superadmin], assignee))).toEqual(sorted([admin, superadmin]));
    expect(productionRecipients.qtyFilled({ ...people, leaderId: null }, [admin, superadmin], admin)).toEqual([superadmin]);
  });

  it("the handler names the task and the number filled in (payload filledQty / atDone); no Leader → the Admins", async () => {
    let leaderActive = true;
    db.state.handler = (call) => {
      if (call.text.includes("AS leader_active") && call.text.includes("FROM production.tasks t")) {
        return [taskInfo({ leader_active: leaderActive, qty_assigned: 120, qty_done: null })];
      }
      if (call.text.includes("role_code = 'ADMIN'")) {
        return [{ user_id: admin }, { user_id: superadmin }];
      }
      return undefined;
    };
    await productionNotificationHandlers["production.task.qty_filled"]!(envelope("production.task.qty_filled", { taskId, qty: 120, atDone: false }, assignee));
    const [draft] = draftsOf("production.qty_filled");
    expect(draft).toMatchObject({ recipientIds: [leader], title: "JOB-9", body: "#3 · Retouch · 120 tấm", actorUserId: assignee });
    expect(draft!.payload).toMatchObject({ productionTaskId: taskId, taskCode: "3", qty: 120, filledQty: 120, atDone: false });
    expect(db.state.calls.some((call) => call.text.includes("role_code = 'ADMIN'"))).toBe(false);

    delivered.drafts = [];
    leaderActive = false;
    await productionNotificationHandlers["production.task.qty_filled"]!(envelope("production.task.qty_filled", { taskId, qty: 30, atDone: true }, assignee));
    const [atDone] = draftsOf("production.qty_filled");
    expect(sorted(atDone!.recipientIds)).toEqual(sorted([admin, superadmin]));
    expect(atDone!.payload).toMatchObject({ filledQty: 30, atDone: true });

    // A deleted task or a malformed event tells nobody.
    delivered.drafts = [];
    await productionNotificationHandlers["production.task.qty_filled"]!(envelope("production.task.qty_filled", { taskId }, assignee));
    db.state.handler = () => [];
    await productionNotificationHandlers["production.task.qty_filled"]!(envelope("production.task.qty_filled", { taskId, qty: 5 }, assignee));
    expect(delivered.drafts).toHaveLength(0);
  });

  it("a task without a quantity is named without '· N tấm' and carries qty null", async () => {
    db.state.handler = (call) =>
      call.text.includes("AS leader_active") && call.text.includes("FROM production.tasks t") ? [taskInfo({ qty_assigned: null, qty_done: null })] : undefined;
    await productionNotificationHandlers["production.task.assigned"]!(envelope("production.task.assigned", { taskId }, leader));
    const [draft] = draftsOf("production.task_assigned");
    expect(draft).toMatchObject({ body: "#3 · Retouch" });
    expect(draft!.payload).toMatchObject({ qty: null });

    await notifyDeadline("production.task_late", [{ organization_id: org, id: taskId }]);
    expect(draftsOf("production.task_late")[0]).toMatchObject({ body: "#3 · Retouch" });
  });
});
