import { describe, expect, it } from "vitest";

import type { JobStatusKind } from "../../contracts/production-catalog.js";
import {
  defaultOverviewScope,
  getsAccountNeeds,
  getsLeaderNeeds,
  hasOverviewScopeSwitch,
  seesOverview,
  seesRiskHistory
} from "../../contracts/production-overview.js";
import type { CoreWindow } from "./core-clock.js";
import {
  accountNeedsOf,
  buildOverviewJobs,
  jobPhaseOf,
  leaderNeedsOf,
  lineImages,
  overviewCards,
  stageOfLine,
  type OverviewBuildInput,
  type OverviewJobRow,
  type OverviewLineRow,
  type OverviewRiskRow
} from "./overview-model.js";

/**
 * PD-080 — Overview V2 rules as pure functions (overview-model.ts): time rules 1–4, line stages and images, job phase,
 * clocks, cards and "Cần bạn xử lý". Obviously fake ids, codes ("AXP", "BRX") and names (public repository).
 */
const window: CoreWindow = { start: "09:30", end: "16:30", timeZone: "Asia/Ho_Chi_Minh" };
const at = (local: string) => new Date(`${local.replace(" ", "T")}:00+07:00`);
// Wednesday 21/10/2026 14:05 in Asia/Ho_Chi_Minh; the range is "Hôm nay".
const now = at("2026-10-21 14:05");
const range = { start: at("2026-10-21 00:00"), end: at("2026-10-22 00:00") };

let seq = 0;
const uuid = (prefix: string) => `${prefix.padEnd(8, "0").slice(0, 8)}-0000-4000-8000-${String((seq += 1)).padStart(12, "0")}`;
const person = (name: string) => ({ id: uuid("aaaa"), displayName: name, email: null, avatarUrl: null });
const worker = person("Worker One");
const worker2 = person("Worker Two");
const checker = person("Checker Three");
const leader = person("Leader Four");
const projectAxp = { id: uuid("bbbb"), code: "AXP", name: "Project AXP" };
const projectBrx = { id: uuid("bbbb"), code: "BRX", name: "Project BRX" };
const statusIds: Record<string, string> = {};
const statusOf = (code: string) => {
  statusIds[code] ??= uuid("cccc");
  return { id: statusIds[code], code, name: code, color: "blue" as const };
};
const work = { id: uuid("dddd"), name: "Retouch", isQc: false };
const checking = { id: uuid("dddd"), name: "Checking", isQc: true };

const jobRow = (code: string, overrides: Partial<OverviewJobRow> & { kind?: JobStatusKind } = {}): OverviewJobRow => {
  const { kind = "IN_PROGRESS", ...rest } = overrides;
  return {
    id: uuid("eeee"),
    code,
    name: null,
    project: projectAxp,
    leader,
    receivedAt: at("2026-10-20 08:00"),
    deadline: at("2026-10-21 23:59"),
    createdAt: at("2026-10-20 08:00"),
    createdByAccount: false,
    totalImages: 0,
    status: { id: uuid("ffff"), name: kind, color: "blue", kind },
    owned: true,
    lastActivityAt: at("2026-10-21 14:00"),
    ...rest
  };
};
let number = 1000;
const lineRow = (job: OverviewJobRow, code: string, overrides: Partial<OverviewLineRow> = {}): OverviewLineRow => {
  number += 1;
  return {
    id: uuid("1111"),
    jobId: job.id,
    number,
    code: String(number),
    process: work,
    assignee: worker,
    qc: checker,
    status: statusOf(code),
    assignedAt: at("2026-10-21 08:00"),
    deadline: at("2026-10-21 17:00"),
    doneAt: ["DONE", "WAITING_QC", "QC_CHECKING", "CHECKED", "COMPLETE"].includes(code) ? at("2026-10-21 12:00") : null,
    finished: ["CHECKED", "COMPLETE", "DELIVERING", "DELIVERED"].includes(code),
    qtyAssigned: 10,
    qtyDone: ["DONE", "WAITING_QC", "QC_CHECKING", "CHECKED", "COMPLETE"].includes(code) ? 10 : null,
    note: null,
    waitingSince: null,
    ...overrides
  };
};
const build = (jobs: OverviewJobRow[], lines: OverviewLineRow[], extra: Partial<OverviewBuildInput> = {}) =>
  buildOverviewJobs({ now, range, window, alertMinutes: 120, jobs, lines, onLeaveNow: new Set(), risks: new Map(), ...extra });

describe("time rules (PD-080)", () => {
  it("1. a client deadline in the range shows every line and counts unassigned images", () => {
    const job = jobRow("AXP-1", { totalImages: 30 });
    const later = lineRow(job, "PROCESSING", { deadline: at("2026-10-22 17:00") });
    const earlier = lineRow(job, "CHECKED", { deadline: at("2026-10-20 17:00") });
    const [shown] = build([job], [later, earlier]);
    expect(shown!.full).toBe(true);
    expect(shown!.tasks.map((task) => task.id)).toEqual([earlier.id, later.id]);
    expect(shown!.images).toEqual({ done: 10, inProgress: 10, unassigned: 10, total: 30 });
  });

  it("2. another job shows only its lines due in the range; none left → hidden", () => {
    const job = jobRow("AXP-2", { deadline: at("2026-10-25 17:00"), totalImages: 50 });
    const today = lineRow(job, "PROCESSING", { deadline: at("2026-10-21 18:00") });
    const later = lineRow(job, "PROCESSING", { deadline: at("2026-10-23 17:00") });
    const hidden = jobRow("AXP-3", { deadline: at("2026-10-25 17:00") });
    const [shown, ...rest] = build([job, hidden], [today, later, lineRow(hidden, "ASSIGNED", { deadline: at("2026-10-23 17:00") })]);
    expect(rest).toHaveLength(0);
    expect(shown!.full).toBe(false);
    expect(shown!.tasks.map((task) => task.id)).toEqual([today.id]);
    // Rule 4: no "chưa chia" images outside rule 1.
    expect(shown!.images.unassigned).toBe(0);
    expect(shown!.lineCount).toBe(2);
  });

  it("3. unfinished late work always shows: overdue lines and client-late jobs; delivered jobs are never client-late", () => {
    const job = jobRow("AXP-4", { deadline: at("2026-10-25 17:00") });
    const overdue = lineRow(job, "PROCESSING", { deadline: at("2026-10-19 17:00") });
    // Done on time, waiting for QC: not late (the app's "Trễ hạn").
    const waiting = lineRow(job, "WAITING_QC", { deadline: at("2026-10-19 17:00") });
    const late = jobRow("AXP-5", { deadline: at("2026-10-19 17:00") });
    const lateLine = lineRow(late, "PROCESSING", { deadline: at("2026-10-23 17:00") });
    const delivered = jobRow("AXP-6", { deadline: at("2026-10-19 17:00"), kind: "DELIVERED" });
    const delivering = jobRow("AXP-7", { deadline: at("2026-10-19 17:00"), kind: "DELIVERING" });
    const shown = build([job, late, delivered, delivering], [overdue, waiting, lateLine]);
    expect(shown.map((item) => item.code)).toEqual(["AXP-5", "AXP-4"]);
    const [lateJob, open] = shown;
    expect(lateJob!.clientLate).toBe(true);
    expect(lateJob!.full).toBe(true);
    expect(lateJob!.tasks.map((task) => task.id)).toEqual([lateLine.id]);
    expect(open!.tasks.map((task) => [task.id, task.overdue])).toEqual([[overdue.id, true]]);
    expect(build([delivered], [])).toEqual([]);
  });

  it("4. chưa chia = a full job without any line, not COMPLETE or later", () => {
    const fresh = jobRow("AXP-8", { totalImages: 40, kind: "NEW" });
    const complete = jobRow("AXP-9", { totalImages: 40, kind: "COMPLETE" });
    const lateEmpty = jobRow("AXP-10", { totalImages: 15, deadline: at("2026-10-20 12:00") });
    const later = jobRow("AXP-11", { totalImages: 15, deadline: at("2026-10-30 12:00") });
    const shown = build([fresh, complete, lateEmpty, later], []);
    expect(shown.map((job) => [job.code, job.noTasks, job.images.unassigned])).toEqual([
      ["AXP-10", true, 15],
      ["AXP-8", true, 40],
      ["AXP-9", false, 0]
    ]);
    expect(overviewCards(shown).unassigned).toEqual({ jobs: 2, images: 55 });
  });
});

describe("lines: stages and images (PD-080)", () => {
  it("stage by status code; Done waits for QC; a Checking line is over once Done; Feedback stays in progress", () => {
    const job = jobRow("BRX-1");
    expect(stageOfLine(lineRow(job, "ASSIGNED"))).toBe("ASSIGNED");
    expect(stageOfLine(lineRow(job, "REWORK"))).toBe("REWORK");
    expect(stageOfLine(lineRow(job, "DONE"))).toBe("WAITING_QC");
    expect(stageOfLine(lineRow(job, "DONE", { process: checking, qc: null }))).toBe("CHECKED");
    expect(stageOfLine(lineRow(job, "QC_CHECKING"))).toBe("QC_CHECKING");
    expect(stageOfLine(lineRow(job, "FEEDBACK", { finished: true }))).toBe("FEEDBACK");
    expect(stageOfLine(lineRow(job, "DELIVERED"))).toBe("COMPLETE");
    expect(stageOfLine(lineRow(job, "CUSTOM", { finished: true }))).toBe("CHECKED");
    expect(stageOfLine(lineRow(job, "CUSTOM", { finished: false }))).toBe("PROCESSING");
  });

  it("images: the given quantity (subtasks included by the query) before Done, the Done quantity after; null unknown", () => {
    expect(lineImages({ doneAt: null, qtyAssigned: 12, qtyDone: null })).toBe(12);
    expect(lineImages({ doneAt: now, qtyAssigned: 12, qtyDone: 11 })).toBe(11);
    expect(lineImages({ doneAt: now, qtyAssigned: 12, qtyDone: null })).toBe(12);
    expect(lineImages({ doneAt: null, qtyAssigned: null, qtyDone: null })).toBeNull();
  });

  it("Checking lines are tasks but their images are not added; lines without a quantity are counted apart", () => {
    const job = jobRow("BRX-2", { totalImages: 20 });
    const lines = [
      lineRow(job, "PROCESSING", { qtyAssigned: 20 }),
      lineRow(job, "PROCESSING", { process: checking, qc: null, qtyAssigned: 20 }),
      lineRow(job, "ASSIGNED", { qtyAssigned: null })
    ];
    const shown = build([job], lines);
    expect(shown[0]!.tasksWithoutQty).toBe(1);
    expect(shown[0]!.images).toEqual({ done: 0, inProgress: 20, unassigned: 0, total: 20 });
    expect(overviewCards(shown)).toMatchObject({ total: { tasks: 3, images: 20, jobs: 1 }, inProgress: { tasks: 3, images: 20 } });
  });

  it("the job phase: its kind, READY when every line is finished before COMPLETE", () => {
    expect(jobPhaseOf("IN_PROGRESS", ["DONE", "DONE"])).toBe("READY");
    expect(jobPhaseOf("FEEDBACK", ["DONE"])).toBe("READY");
    expect(jobPhaseOf("IN_PROGRESS", ["DONE", "IN_PROGRESS"])).toBe("IN_PROGRESS");
    expect(jobPhaseOf("NEW", [])).toBe("NEW");
    expect(jobPhaseOf("COMPLETE", ["DONE"])).toBe("COMPLETE");
    expect(jobPhaseOf("DELIVERED", ["IN_PROGRESS"])).toBe("DELIVERED");
  });
});

describe("cards and needs (PD-080)", () => {
  it("Tổng / Chưa chia / Đang làm / Xong / Trễ over the shown jobs", () => {
    const open = jobRow("AXP-20", { totalImages: 60 });
    const late = jobRow("AXP-21", { deadline: at("2026-10-20 12:00"), totalImages: 10 });
    const empty = jobRow("AXP-22", { totalImages: 25, kind: "NEW" });
    const lines = [
      lineRow(open, "PROCESSING", { qtyAssigned: 20, deadline: at("2026-10-20 17:00") }),
      lineRow(open, "WAITING_QC", { qtyAssigned: 15, qtyDone: 14 }),
      lineRow(open, "CHECKED", { qtyAssigned: 10, qtyDone: 10 }),
      lineRow(late, "ASSIGNED", { qtyAssigned: 10, deadline: at("2026-10-22 17:00") })
    ];
    const cards = overviewCards(build([open, late, empty], lines));
    expect(cards).toEqual({
      total: { tasks: 4, images: 54, jobs: 3 },
      unassigned: { jobs: 1, images: 25 },
      inProgress: { tasks: 3, images: 44 },
      done: { tasks: 1, images: 10 },
      overdue: { tasks: 1, clientJobs: 1, images: 20 }
    });
  });

  it("Không cập nhật: core time since the last action on a job with New / Doing / Rework lines; on leave at once", () => {
    const idle = jobRow("AXP-30", { lastActivityAt: at("2026-10-20 16:00") });
    const recent = jobRow("AXP-31", { lastActivityAt: at("2026-10-21 13:30") });
    const away = jobRow("AXP-32", { lastActivityAt: at("2026-10-21 14:00") });
    const qcOnly = jobRow("AXP-33", { lastActivityAt: at("2026-10-19 10:00") });
    const lines = [
      lineRow(idle, "PROCESSING"),
      lineRow(recent, "REWORK"),
      lineRow(away, "ASSIGNED", { assignee: worker2 }),
      lineRow(qcOnly, "WAITING_QC", { waitingSince: at("2026-10-21 13:00") })
    ];
    const byCode = new Map(build([idle, recent, away, qcOnly], lines, { onLeaveNow: new Set([worker2.id]) }).map((job) => [job.code, job]));
    // Tue 16:00 → Wed 14:05: 30 + 275 minutes.
    expect(byCode.get("AXP-30")!.stale).toEqual({ minutes: 305, reason: "IDLE" });
    expect(byCode.get("AXP-31")!.stale).toBeNull();
    expect(byCode.get("AXP-32")!.stale).toEqual({ minutes: 5, reason: "STAFF_ON_LEAVE" });
    expect(byCode.get("AXP-32")!.tasks[0]!.assigneeOnLeave).toBe(true);
    expect(byCode.get("AXP-33")!.stale).toBeNull();
  });

  it("Chờ QC: core minutes since the line entered Chờ QC (else its Done time); alert past the threshold or QC on leave", () => {
    const job = jobRow("AXP-40");
    const fresh = lineRow(job, "WAITING_QC", { waitingSince: at("2026-10-21 13:00") });
    const long = lineRow(job, "WAITING_QC", { waitingSince: at("2026-10-20 16:00"), qtyDone: 8 });
    const noLog = lineRow(job, "DONE", { waitingSince: null, doneAt: at("2026-10-21 12:00"), qc: null });
    const away = lineRow(job, "WAITING_QC", { waitingSince: at("2026-10-21 14:00"), qc: worker2, qtyDone: 5 });
    const [shown] = build([job], [fresh, long, noLog, away], { onLeaveNow: new Set([worker2.id]) });
    const wait = new Map(shown!.tasks.map((task) => [task.id, task.qcWait]));
    expect(wait.get(fresh.id)).toMatchObject({ minutes: 65, alert: false });
    expect(wait.get(long.id)).toMatchObject({ minutes: 305, alert: true });
    expect(wait.get(noLog.id)).toMatchObject({ since: at("2026-10-21 12:00").toISOString(), minutes: 125, alert: true });
    expect(wait.get(away.id)).toMatchObject({ minutes: 5, alert: true });
    expect(shown!.tasks.find((task) => task.id === away.id)!.qcOnLeave).toBe(true);
    // Leader: images waiting QC past the threshold (or QC on leave) = 8 + 10 + 5.
    expect(leaderNeedsOf([shown!]).qcWaitImages).toBe(23);
  });

  it("an Account's new job not split after the threshold of core time; At risk hidden once client-late or finished", () => {
    const old = jobRow("AXP-50", { createdByAccount: true, createdAt: at("2026-10-21 09:00"), kind: "NEW" });
    const young = jobRow("AXP-51", { createdByAccount: true, createdAt: at("2026-10-21 13:30"), kind: "NEW" });
    const notAccount = jobRow("AXP-52", { createdAt: at("2026-10-21 09:00"), kind: "NEW" });
    const risky = jobRow("AXP-53");
    const lateRisky = jobRow("AXP-54", { deadline: at("2026-10-21 12:00") });
    const doneRisky = jobRow("AXP-55", { kind: "COMPLETE" });
    const risk: OverviewRiskRow = { reason: "CAPACITY", since: at("2026-10-21 11:00"), evaluatedAt: at("2026-10-21 14:00"), workHours: 9, capacityHours: 4, hoursLeft: 2.4, people: 2 };
    const risks = new Map([risky, lateRisky, doneRisky].map((job) => [job.id, risk]));
    const lines = [lineRow(risky, "PROCESSING"), lineRow(lateRisky, "PROCESSING"), lineRow(doneRisky, "CHECKED")];
    const byCode = new Map(build([old, young, notAccount, risky, lateRisky, doneRisky], lines, { risks }).map((job) => [job.code, job]));
    expect(byCode.get("AXP-50")!.newNotSplit).toBe(true);
    expect(byCode.get("AXP-51")!.newNotSplit).toBe(false);
    expect(byCode.get("AXP-52")!.newNotSplit).toBe(false);
    expect(byCode.get("AXP-53")!.risk).toMatchObject({ reason: "CAPACITY", workHours: 9, since: at("2026-10-21 11:00").toISOString() });
    expect(byCode.get("AXP-54")!.risk).toBeNull();
    expect(byCode.get("AXP-55")!.risk).toBeNull();
  });

  it("Cần bạn xử lý of a Leader and of an Account", () => {
    const risky = jobRow("AXP-60");
    const empty = jobRow("AXP-61", { kind: "NEW", createdByAccount: true, createdAt: at("2026-10-20 09:00") });
    const feedback = jobRow("AXP-62", { kind: "FEEDBACK" });
    const ready = jobRow("AXP-63");
    const complete = jobRow("AXP-64", { kind: "COMPLETE" });
    const late = jobRow("AXP-65", { deadline: at("2026-10-21 08:00"), lastActivityAt: at("2026-10-20 10:00") });
    const lines = [
      lineRow(risky, "PROCESSING"),
      lineRow(feedback, "PROCESSING"),
      lineRow(ready, "CHECKED"),
      lineRow(complete, "CHECKED"),
      lineRow(late, "PROCESSING")
    ];
    const risk: OverviewRiskRow = { reason: "UNASSIGNED", since: now, evaluatedAt: now, workHours: 0, capacityHours: 0, hoursLeft: 2, people: 0 };
    const jobs = build([risky, empty, feedback, ready, complete, late], lines, { risks: new Map([[risky.id, risk]]) });
    expect(leaderNeedsOf(jobs)).toEqual({ atRisk: 1, unassignedJobs: 1, qcWaitImages: 0, feedbackJobs: 1, readyJobs: 1, staleJobs: 1 });
    expect(accountNeedsOf(jobs)).toEqual({ readyToDeliver: 1, atRisk: 1, clientLate: 1, newNotSplit: 1 });
  });

  it("people: assignees of every live line, first assigned first; jobs by urgency (client-late, then deadline)", () => {
    const job = jobRow("BRX-70", { project: projectBrx });
    const lines = [
      lineRow(job, "PROCESSING", { assignee: worker2, assignedAt: at("2026-10-21 09:00") }),
      lineRow(job, "PROCESSING", { assignee: worker, assignedAt: at("2026-10-21 08:00") }),
      lineRow(job, "PROCESSING", { assignee: worker2, assignedAt: at("2026-10-21 10:00") })
    ];
    const [shown] = build([job], lines);
    expect(shown!.people.map((user) => user.id)).toEqual([worker.id, worker2.id]);
    const order = build(
      [jobRow("C", { deadline: at("2026-10-21 20:00") }), jobRow("A", { deadline: at("2026-10-21 18:00") }), jobRow("B", { deadline: at("2026-10-19 08:00") })],
      []
    );
    expect(order.map((item) => item.code)).toEqual(["B", "A", "C"]);
  });
});

describe("who sees what (PD-080)", () => {
  it("Overview for Leader / Account / Quản trị / Director; not Staff / QC alone", () => {
    expect(seesOverview(["LEADER"])).toBe(true);
    expect(seesOverview(["ACCOUNT"])).toBe(true);
    expect(seesOverview(["ADMIN", "DIRECTOR"])).toBe(true);
    expect(seesOverview(["STAFF"])).toBe(false);
    expect(seesOverview(["QC", "STAFF"])).toBe(false);
    expect(seesOverview(["STAFF", "LEADER"])).toBe(true);
  });

  it("default scope: My Projects for a Leader; Tất cả for Quản trị / Director / Account (also with LEADER) and the superadmin", () => {
    expect(defaultOverviewScope(["LEADER"])).toBe("mine");
    expect(defaultOverviewScope(["LEADER", "STAFF"])).toBe("mine");
    expect(defaultOverviewScope(["LEADER", "ACCOUNT"])).toBe("all");
    expect(defaultOverviewScope(["ACCOUNT"])).toBe("all");
    expect(defaultOverviewScope(["DIRECTOR"])).toBe("all");
    // The superadmin holds ADMIN + DIRECTOR (and often LEADER).
    expect(defaultOverviewScope(["ADMIN", "DIRECTOR", "LEADER"])).toBe("all");
  });

  it("scope switch for LEADER / ADMIN; Leader needs for LEADER / ADMIN / DIRECTOR; Account needs for ACCOUNT; history for DIRECTOR", () => {
    expect(hasOverviewScopeSwitch(["LEADER"])).toBe(true);
    expect(hasOverviewScopeSwitch(["ADMIN"])).toBe(true);
    expect(hasOverviewScopeSwitch(["ACCOUNT", "DIRECTOR"])).toBe(false);
    expect(getsLeaderNeeds(["DIRECTOR"])).toBe(true);
    expect(getsLeaderNeeds(["ACCOUNT"])).toBe(false);
    expect(getsAccountNeeds(["ACCOUNT"])).toBe(true);
    expect(getsAccountNeeds(["ADMIN", "DIRECTOR"])).toBe(false);
    expect(seesRiskHistory(["ADMIN", "DIRECTOR"])).toBe(true);
    expect(seesRiskHistory(["ADMIN"])).toBe(false);
    expect(seesRiskHistory(["LEADER", "ACCOUNT"])).toBe(false);
  });
});
