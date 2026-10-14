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

const { productionRecipients, productionNotificationHandlers, notifyDeadline } = await import("./notifications.js");

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

  it("leave requested → approvers (team leaders, admins, superadmins) but never the requester", async () => {
    db.state.handler = (call) => {
      if (call.text.includes("FROM production.leave_requests lr")) {
        return [{ user_id: assignee, display_name: "NV", from_date: "2026-10-12", to_date: "2026-10-12", part: "FULL_DAY", status: "PENDING", decision_note: null, team_id: null }];
      }
      if (call.text.includes("ur.role_code = 'ADMIN'")) {
        return [{ user_id: leader }, { user_id: superadmin }, { user_id: assignee }];
      }
      return undefined;
    };
    await productionNotificationHandlers["production.leave.requested"]!(envelope("production.leave.requested", { leaveId: "ffffffff-ffff-4fff-8fff-ffffffffffff" }, assignee));
    expect(sorted(draftsOf("production.leave_requested")[0]!.recipientIds)).toEqual(sorted([leader, superadmin]));
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
