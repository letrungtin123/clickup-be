import { describe, expect, it } from "vitest";

import { hoursPerImageOf } from "../../contracts/production-catalog.js";
import type { Interval } from "./core-clock.js";

import { estimateJobRisk, primaryQcProcessId, qcRateFor, type QcProcess, type RiskContext, type RiskJob, type RiskRow } from "./at-risk.js";

/**
 * PD-080 — the At risk estimate (at-risk.ts, pure part). Wednesday 21/10/2026 14:05 in Asia/Ho_Chi_Minh, core window
 * 09:30 – 16:30: 145 core minutes (2.42 h) are left today. Obviously fake ids.
 */
const at = (local: string) => new Date(`${local.replace(" ", "T")}:00+07:00`);
const now = at("2026-10-21 14:05");
const project = "bbbbbbbb-0000-4000-8000-000000000001";
const retouch = "dddddddd-0000-4000-8000-000000000001";
const clipping = "dddddddd-0000-4000-8000-000000000002";
const checking = "dddddddd-0000-4000-8000-000000000003";
const checkingClip = "dddddddd-0000-4000-8000-000000000004";
const workerA = "aaaaaaaa-0000-4000-8000-000000000001";
const workerB = "aaaaaaaa-0000-4000-8000-000000000002";
const qcPerson = "aaaaaaaa-0000-4000-8000-000000000003";

const qcProcesses: QcProcess[] = [
  { id: checkingClip, name: "Checking Clipping", sortOrder: 1 },
  { id: checking, name: "Checking", sortOrder: 5 }
];
const prices: Record<string, number | null> = { [retouch]: 0.5, [clipping]: 1, [checking]: 0.1, [checkingClip]: 0.3 };
const context = (overrides: Partial<RiskContext> = {}): RiskContext => ({
  now,
  window: { start: "09:30", end: "16:30", timeZone: "Asia/Ho_Chi_Minh" },
  rate: (_projectId, processId) => prices[processId] ?? null,
  qcProcesses,
  leaveOf: () => [],
  ...overrides
});
let seq = 0;
const row = (overrides: Partial<RiskRow> = {}): RiskRow => ({
  id: `11111111-0000-4000-8000-${String((seq += 1)).padStart(12, "0")}`,
  parentId: null,
  processId: retouch,
  isQc: false,
  statusCode: "PROCESSING",
  finished: false,
  qtyAssigned: 10,
  qtyDone: null,
  assigneeId: workerA,
  qcId: qcPerson,
  ...overrides
});
const job = (rows: RiskRow[], overrides: Partial<RiskJob> = {}): RiskJob => ({
  id: "eeeeeeee-0000-4000-8000-000000000001",
  projectId: project,
  deadline: at("2026-10-21 16:30"),
  totalImages: 0,
  rows,
  ...overrides
});

describe("At risk — CAPACITY (PD-080)", () => {
  it("on when the remaining work hours exceed the people's core hours before the client deadline", () => {
    const estimate = estimateJobRisk(job([row({ qtyAssigned: 30 })]), context());
    expect(estimate).toEqual({ atRisk: true, reason: "CAPACITY", workHours: 15, capacityHours: 2.42, hoursLeft: 2.42, people: 1, workerDone: false });
  });

  it("off when it fits, or once more people work on it", () => {
    expect(estimateJobRisk(job([row({ qtyAssigned: 4 })]), context())).toMatchObject({ atRisk: false, reason: null, workHours: 2 });
    const two = [row({ qtyAssigned: 4 }), row({ qtyAssigned: 4, assigneeId: workerB })];
    expect(estimateJobRisk(job(two), context())).toMatchObject({ atRisk: false, workHours: 4, capacityHours: 4.83, people: 2 });
  });

  it("unassigned images (Tổng tấm − images given) at the job's average Giờ/tấm count as work", () => {
    const estimate = estimateJobRisk(job([row({ qtyAssigned: 2 })], { totalImages: 10 }), context());
    // 2 × 0.5 given + 8 unassigned × 0.5.
    expect(estimate).toMatchObject({ workHours: 5, atRisk: true });
  });

  it("approved leave lowers the capacity of that person", () => {
    const leave: Interval[] = [{ start: at("2026-10-21 12:00"), end: at("2026-10-22 00:00") }];
    const estimate = estimateJobRisk(job([row({ qtyAssigned: 2 })]), context({ leaveOf: (id) => (id === workerA ? leave : []) }));
    expect(estimate).toMatchObject({ workHours: 1, capacityHours: 0, people: 1, atRisk: true });
  });

  it("subtasks follow their line: their own process price while open, nothing once the line is finished", () => {
    const line = row({ qtyAssigned: 4 });
    const sub = row({ parentId: line.id, processId: clipping, qtyAssigned: 3, statusCode: "ASSIGNED" });
    expect(estimateJobRisk(job([line, sub], { deadline: at("2026-10-23 16:30") }), context())).toMatchObject({ workHours: 5, people: 1 });
    const checked = row({ qtyAssigned: 4, statusCode: "CHECKED", finished: true });
    const subOfChecked = row({ parentId: checked.id, processId: clipping, qtyAssigned: 3, statusCode: "PROCESSING" });
    const open = row({ qtyAssigned: 1 });
    expect(estimateJobRisk(job([checked, subOfChecked, open]), context())).toMatchObject({ workHours: 0.5, people: 1 });
  });

  it("work waiting for / at QC uses the primary QC rate (\"Checking\"), else the average of the project's priced QC processes", () => {
    const rows = [row({ statusCode: "WAITING_QC", qtyDone: 20 }), row({ qtyAssigned: 2, assigneeId: workerB })];
    // 20 × 0.1 (Checking) + 2 × 0.5; QC person and worker B are working on it.
    expect(estimateJobRisk(job(rows, { deadline: at("2026-10-23 16:30") }), context())).toMatchObject({ workHours: 3, people: 2 });
    expect(primaryQcProcessId(qcProcesses)).toBe(checking);
    expect(primaryQcProcessId([{ id: checkingClip, name: "Checking Clipping", sortOrder: 9 }, { id: clipping, name: "QC B", sortOrder: 2 }])).toBe(clipping);
    expect(primaryQcProcessId([])).toBeNull();
    const withoutChecking = (_projectId: string, processId: string) => (processId === checking ? null : (prices[processId] ?? null));
    expect(qcRateFor(project, [...qcProcesses, { id: clipping, name: "Checking Shoe", sortOrder: 7 }], withoutChecking)).toBeCloseTo(0.65);
    expect(qcRateFor(project, qcProcesses, () => null)).toBe(0);
  });

  it("a Checking line still open is its assignee's work at its own price", () => {
    const rows = [row({ processId: checking, isQc: true, qtyAssigned: 30, qcId: null, assigneeId: qcPerson }), row({ qtyAssigned: 1 })];
    expect(estimateJobRisk(job(rows), context())).toMatchObject({ workHours: 3.5, people: 2 });
  });

  it("clears once every line is past its worker (Done or later), whatever is left for QC", () => {
    const rows = [row({ statusCode: "WAITING_QC", qtyDone: 500 }), row({ statusCode: "CHECKED", finished: true })];
    expect(estimateJobRisk(job(rows), context())).toMatchObject({ atRisk: false, reason: null, workerDone: true, workHours: 50 });
  });

  it("no price → 0 hours (the line does not count)", () => {
    expect(estimateJobRisk(job([row({ qtyAssigned: 500 })]), context({ rate: () => null }))).toMatchObject({ workHours: 0, atRisk: false });
  });

  it("Giờ/tấm: the price's own hours, else credit ÷ 11", () => {
    expect(hoursPerImageOf({ creditPerImage: 5.5, hoursPerImage: null })).toBe(0.5);
    expect(hoursPerImageOf({ creditPerImage: 4.58, hoursPerImage: 0.4167 })).toBe(0.4167);
    expect(hoursPerImageOf({ creditPerImage: 4.58 })).toBe(0.4164);
    expect(hoursPerImageOf(null)).toBeNull();
  });
});

describe("At risk — UNASSIGNED (PD-080)", () => {
  it("a job without any line is at risk when at most one core day is left before the client deadline", () => {
    // 145 min today + 150 min tomorrow = 295 ≤ 420.
    expect(estimateJobRisk(job([], { deadline: at("2026-10-22 12:00"), totalImages: 40 }), context())).toEqual({
      atRisk: true,
      reason: "UNASSIGNED",
      workHours: 0,
      capacityHours: 0,
      hoursLeft: 4.92,
      people: 0,
      workerDone: false
    });
    // 145 + 420 + 150 = 715 > 420.
    expect(estimateJobRisk(job([], { deadline: at("2026-10-23 12:00") }), context())).toMatchObject({ atRisk: false, reason: null });
    // Sunday does not count: Saturday 16:00 → Monday 10:00 is 60 core minutes.
    expect(estimateJobRisk(job([], { deadline: at("2026-10-26 10:00") }), context({ now: at("2026-10-24 16:00") }))).toMatchObject({
      atRisk: true,
      hoursLeft: 1
    });
  });
});
