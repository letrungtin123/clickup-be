import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MyOverviewQuerySchema,
  MyOverviewSchema,
  myOverviewOrder,
  myOverviewRowLimit,
  myOverviewTagsOf,
  type MyOverview
} from "../../contracts/production-my-overview.js";
import type { AccessContext } from "../access/access-context.js";
import type * as JobsRepoModule from "./jobs.repo.js";
import type { CoreClock } from "./my-overview-clock.js";
import type { TaskRow } from "./jobs.repo.js";
import type { Workflow, WorkflowStatus } from "./workflow.js";

/**
 * PD-081 — "Tổng quan của tôi" (GET /production/my-overview), without a database: a fake tagged-template `sql` records
 * every statement (fragments inlined like postgres.js) and answers from a per-test handler (as pd076.test.ts). The clock,
 * classification, order and count rules are tested directly. Obviously fake ids, codes and names only: the repository is
 * public.
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

const statusOf = (code: string, sortOrder: number, extra: Partial<WorkflowStatus> = {}): WorkflowStatus => ({
  id: `a${String(sortOrder).padStart(7, "0")}-1111-4111-8111-111111111111`,
  code,
  name: code,
  sortOrder,
  countsDone: code === "DONE",
  countsChecked: code === "CHECKED",
  isTerminal: false,
  isInitial: false,
  setByRoles: [],
  active: true,
  ...extra
});
const statuses = {
  ASSIGNED: statusOf("ASSIGNED", 1, { isInitial: true }),
  REWORK: statusOf("REWORK", 2),
  PROCESSING: statusOf("PROCESSING", 3),
  DONE: statusOf("DONE", 4),
  WAITING_QC: statusOf("WAITING_QC", 5),
  QC_CHECKING: statusOf("QC_CHECKING", 6),
  CHECKED: statusOf("CHECKED", 7),
  COMPLETE: statusOf("COMPLETE", 8),
  FEEDBACK: statusOf("FEEDBACK", 10),
  DELIVERED: statusOf("DELIVERED", 11, { isTerminal: true })
};
type Code = keyof typeof statuses;
const workflow: Workflow = {
  statuses: Object.values(statuses),
  transitions: [
    { fromStatusId: statuses.ASSIGNED.id, toStatusId: statuses.PROCESSING.id, actors: ["ASSIGNEE"], requiresNote: false },
    { fromStatusId: statuses.PROCESSING.id, toStatusId: statuses.DONE.id, actors: ["ASSIGNEE"], requiresNote: false },
    { fromStatusId: statuses.REWORK.id, toStatusId: statuses.PROCESSING.id, actors: ["ASSIGNEE"], requiresNote: false },
    { fromStatusId: statuses.WAITING_QC.id, toStatusId: statuses.QC_CHECKING.id, actors: ["QC"], requiresNote: false },
    { fromStatusId: statuses.QC_CHECKING.id, toStatusId: statuses.CHECKED.id, actors: ["QC"], requiresNote: false },
    { fromStatusId: statuses.QC_CHECKING.id, toStatusId: statuses.REWORK.id, actors: ["QC"], requiresNote: true }
  ]
};

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
  loadWorkflowModel: vi.fn(() => Promise.resolve(workflow))
}));

const { coreClockOf, coreMinutesBetween, dayIn } = await import("./my-overview-clock.js");
const {
  classifyMyLine,
  getMyOverview,
  lineImages,
  needsOf,
  noLogTimes,
  qcClockOf,
  qcQueueOrder,
  statusCountsOf,
  tagOf
} = await import("./my-overview.service.js");
const { lineFinishStatusIds } = await import("./workflow.js");
const { clearProductionConfigCache } = await import("./catalog-cache.js");

const org = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const worker = "33333333-3333-4333-8333-333333333333";
const projectId = "88888888-8888-4888-8888-888888888881";
const jobId = "66666666-6666-4666-8666-666666666666";
const processId = "99999999-9999-4999-8999-999999999999";
const checkingProcessId = "99999999-9999-4999-8999-999999999998";
const shiftId = "55555555-5555-4555-8555-555555555555";
const taskId = (n: number) => `77777777-7777-4777-8777-${String(n).padStart(12, "0")}`;

/** Thursday 2026-10-22, 16:00 in Asia/Ho_Chi_Minh (UTC+7): 30 minutes of today's core window left. */
const now = new Date("2026-10-22T09:00:00Z");
/** A wall-clock time in Asia/Ho_Chi_Minh. */
const vn = (day: string, time: string) => new Date(`${day}T${time}:00+07:00`);
const clock: CoreClock = coreClockOf({ timezone: "Asia/Ho_Chi_Minh" });
const finish = lineFinishStatusIds(workflow);

const contextWith = (roles: string[], options: { test?: boolean } = {}) =>
  ({
    user: { id: me },
    organization: { id: org },
    hasFullOrganizationAuthority: false,
    productionRoles: roles,
    role: { permissions: [] },
    ...(options.test ? { isTestAccount: true } : {})
  }) as unknown as AccessContext;

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return { code: (error as { code?: string }).code, status: (error as { statusCode?: number }).statusCode };
  }
  return null;
};

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = () => [];
  clearProductionConfigCache();
});

// Query ----------------------------------------------------------------------------------------------------------------

describe("GET /production/my-overview query (PD-081)", () => {
  it("days are optional; from ≤ to; at most 92 days; impossible days refused", () => {
    expect(MyOverviewQuerySchema.parse({})).toEqual({});
    expect(MyOverviewQuerySchema.parse({ from: "2026-10-19", to: "2026-10-25" })).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(MyOverviewQuerySchema.safeParse({ from: "2026-10-25", to: "2026-10-19" }).success).toBe(false);
    expect(MyOverviewQuerySchema.safeParse({ from: "2026-07-01", to: "2026-09-30" }).success).toBe(true);
    expect(MyOverviewQuerySchema.safeParse({ from: "2026-07-01", to: "2026-10-01" }).success).toBe(false);
    expect(MyOverviewQuerySchema.safeParse({ from: "2026-02-31" }).success).toBe(false);
  });
});

// Clock ----------------------------------------------------------------------------------------------------------------

describe("core-window clock (PD-081)", () => {
  it("counts only 09:30 – 16:30 of working days (Mon – Sat), organization time", () => {
    expect(coreMinutesBetween(vn("2026-10-22", "10:00"), vn("2026-10-22", "12:15"), clock)).toBe(135);
    // Before and after the window: nothing.
    expect(coreMinutesBetween(vn("2026-10-22", "06:00"), vn("2026-10-22", "09:30"), clock)).toBe(0);
    expect(coreMinutesBetween(vn("2026-10-22", "16:30"), vn("2026-10-22", "23:00"), clock)).toBe(0);
    // A whole working day is 7 hours.
    expect(coreMinutesBetween(vn("2026-10-22", "00:00"), vn("2026-10-23", "00:00"), clock)).toBe(420);
    // Reversed or empty spans are 0.
    expect(coreMinutesBetween(vn("2026-10-22", "12:00"), vn("2026-10-22", "11:00"), clock)).toBe(0);
  });

  it("16:00 → the next working day: 30 minutes today + the morning (Sunday skipped)", () => {
    expect(coreMinutesBetween(vn("2026-10-22", "16:00"), vn("2026-10-23", "10:00"), clock)).toBe(60);
    expect(coreMinutesBetween(vn("2026-10-22", "16:00"), vn("2026-10-23", "13:30"), clock)).toBe(270);
    // Saturday 16:00 → Monday 10:00: Sunday is not a working day.
    expect(coreMinutesBetween(vn("2026-10-24", "16:00"), vn("2026-10-26", "10:00"), clock)).toBe(60);
  });

  it("stops at the cap", () => {
    expect(coreMinutesBetween(vn("2026-10-19", "09:30"), vn("2026-10-31", "16:30"), clock, 600)).toBe(600);
  });

  it("uses the Overview V2 settings when present and valid, else 09:30 – 16:30 and 2 hours", () => {
    expect(coreClockOf({ timezone: "Asia/Ho_Chi_Minh" })).toEqual({
      start: "09:30",
      end: "16:30",
      timeZone: "Asia/Ho_Chi_Minh",
      dueSoonMinutes: 180,
      qcAlertMinutes: 120
    });
    const custom = coreClockOf({ timezone: "Asia/Ho_Chi_Minh", coreWindowStart: "08:00", coreWindowEnd: "17:00", alertAfterHours: 1.5 });
    expect(custom).toMatchObject({ start: "08:00", end: "17:00", qcAlertMinutes: 90, dueSoonMinutes: 180 });
    expect(coreMinutesBetween(vn("2026-10-22", "16:00"), vn("2026-10-23", "10:00"), custom)).toBe(180);
    // A window that does not run forward, or malformed values, fall back to the defaults.
    expect(coreClockOf({ coreWindowStart: "17:00", coreWindowEnd: "08:00", alertAfterHours: -1 })).toMatchObject({
      start: "09:30",
      end: "16:30",
      qcAlertMinutes: 120
    });
    expect(dayIn(now, "Asia/Ho_Chi_Minh")).toBe("2026-10-22");
    expect(dayIn(vn("2026-10-23", "00:30"), "Asia/Ho_Chi_Minh")).toBe("2026-10-23");
  });
});

// Classification -------------------------------------------------------------------------------------------------------

const facts = (code: Code, deadline: Date, extra: Partial<Parameters<typeof classifyMyLine>[2]> = {}) => ({
  statusId: statuses[code].id,
  statusCode: code,
  isChecking: false,
  doneAt: null,
  deadline,
  finishedAt: null,
  deadlineInRange: false,
  finishedInRange: false,
  ...extra
});
const classify = (line: ReturnType<typeof facts>) => classifyMyLine(workflow, finish, line, now, clock);

describe("my lines: range rules and definitions (PD-081)", () => {
  it("open work shows when its task deadline is in the range; finished work when it was finished in the range", () => {
    expect(classify(facts("PROCESSING", vn("2026-10-23", "17:00"), { deadlineInRange: true })).shown).toBe(true);
    expect(classify(facts("PROCESSING", vn("2026-10-30", "17:00"))).shown).toBe(false);
    const checked = classify(facts("CHECKED", vn("2026-10-10", "17:00"), { doneAt: vn("2026-10-21", "10:00"), finishedInRange: true, deadlineInRange: false }));
    expect(checked).toMatchObject({ finished: true, shown: true, late: false });
    // A finished line is never shown by its deadline, nor late.
    expect(classify(facts("CHECKED", vn("2026-10-22", "17:00"), { doneAt: vn("2026-10-01", "10:00"), deadlineInRange: true })).shown).toBe(false);
    expect(classify(facts("COMPLETE", vn("2026-10-01", "17:00"), { finishedInRange: true }))).toMatchObject({ finished: true, shown: true });
    expect(classify(facts("DELIVERED", vn("2026-10-01", "17:00"), { finishedInRange: true }))).toMatchObject({ finished: true, shown: true });
  });

  it("always shown whatever the range: late work, Cần sửa lại, with QC (Done / Chờ QC / Đang check), due within 3h", () => {
    const late = classify(facts("ASSIGNED", vn("2026-10-20", "17:00")));
    expect(late).toMatchObject({ finished: false, late: true, shown: true, dueCoreMinutes: null });
    const rework = classify(facts("REWORK", vn("2026-10-30", "17:00"), { doneAt: vn("2026-10-19", "10:00") }));
    expect(rework).toMatchObject({ rework: true, late: false, shown: true });
    for (const code of ["DONE", "WAITING_QC", "QC_CHECKING"] as const) {
      const waiting = classify(facts(code, vn("2026-10-01", "17:00"), { doneAt: vn("2026-10-01", "10:00") }));
      expect(waiting).toMatchObject({ withQc: true, late: false, shown: true, dueSoon: false, dueCoreMinutes: null });
    }
    // 16:00 today → tomorrow 10:00 is 1 hour of core time: due soon, shown although the range is only today.
    expect(classify(facts("PROCESSING", vn("2026-10-23", "10:00")))).toMatchObject({ dueSoon: true, dueCoreMinutes: 60, shown: true });
  });

  it("Trễ = open, not with QC, past the task deadline — a line sent back (Cần sửa lại) is late again once past it", () => {
    expect(classify(facts("REWORK", vn("2026-10-21", "17:00"), { doneAt: vn("2026-10-21", "10:00") }))).toMatchObject({ late: true, rework: true });
    expect(classify(facts("WAITING_QC", vn("2026-10-21", "17:00"), { doneAt: vn("2026-10-21", "18:00") })).late).toBe(false);
    expect(classify(facts("QC_CHECKING", vn("2026-10-21", "17:00"), { doneAt: vn("2026-10-21", "18:00") })).late).toBe(false);
    expect(classify(facts("PROCESSING", vn("2026-10-22", "15:59"))).late).toBe(true);
    // The retired line status Feedback is open work (as PD-080), so it can be late.
    expect(classify(facts("FEEDBACK", vn("2026-10-21", "17:00"), { doneAt: vn("2026-10-20", "10:00") }))).toMatchObject({ finished: false, late: true });
  });

  it("đến hạn trong 3h counts core time: at 16:00 a deadline at 18:00 has 30 minutes left, tomorrow 13:30 has 4h 30m", () => {
    expect(classify(facts("ASSIGNED", vn("2026-10-22", "18:00"), { deadlineInRange: true }))).toMatchObject({ dueSoon: true, dueCoreMinutes: 30 });
    // Exactly 3 hours (30 minutes today + 09:30 – 12:00 tomorrow) is still due soon; one minute more is not.
    expect(classify(facts("ASSIGNED", vn("2026-10-23", "12:00")))).toMatchObject({ dueSoon: true, dueCoreMinutes: 180 });
    expect(classify(facts("ASSIGNED", vn("2026-10-23", "12:01")))).toMatchObject({ dueSoon: false, dueCoreMinutes: 181 });
    expect(classify(facts("ASSIGNED", vn("2026-10-23", "13:30")))).toMatchObject({ dueSoon: false, dueCoreMinutes: 270, shown: false });
    // Saturday 16:00 → Monday 10:00 with Sunday off: also due soon.
    const saturday = classifyMyLine(workflow, finish, facts("ASSIGNED", vn("2026-10-26", "10:00")), vn("2026-10-24", "16:00"), clock);
    expect(saturday).toMatchObject({ dueSoon: true, dueCoreMinutes: 60 });
    // Lines with QC are never "due".
    expect(classify(facts("WAITING_QC", vn("2026-10-22", "17:00"), { doneAt: vn("2026-10-22", "11:00") })).dueSoon).toBe(false);
  });

  it("a Checking line (the QC's own work) is finished once Done; any other line only from Đã check", () => {
    const checkingDone = classify(facts("DONE", vn("2026-10-22", "17:00"), { isChecking: true, doneAt: vn("2026-10-22", "11:00"), finishedInRange: true }));
    expect(checkingDone).toMatchObject({ finished: true, withQc: false, shown: true });
    expect(classify(facts("DONE", vn("2026-10-22", "17:00"), { doneAt: vn("2026-10-22", "11:00") }))).toMatchObject({ finished: false, withQc: true });
  });
});

describe("my lines: order, tags and counts (PD-081)", () => {
  const line = (n: number, extra: { finished?: boolean; late?: boolean; rework?: boolean; finishedAt?: string | null; deadline: string }) => ({
    finished: extra.finished ?? false,
    late: extra.late ?? false,
    rework: extra.rework ?? false,
    finishedAt: extra.finishedAt ?? null,
    task: { deadline: extra.deadline, number: n }
  });

  it("Cần sửa lại, then late, then open by soonest task deadline, then finished (latest first)", () => {
    const lines = [
      line(1, { finished: true, finishedAt: "2026-10-20T03:00:00Z", deadline: "2026-10-20T10:00:00Z" }),
      line(2, { deadline: "2026-10-23T10:00:00Z" }),
      line(3, { late: true, deadline: "2026-10-21T10:00:00Z" }),
      line(4, { rework: true, deadline: "2026-10-30T10:00:00Z" }),
      line(5, { deadline: "2026-10-22T10:00:00Z" }),
      line(6, { finished: true, finishedAt: "2026-10-22T03:00:00Z", deadline: "2026-10-19T10:00:00Z" }),
      line(7, { late: true, deadline: "2026-10-19T10:00:00Z" }),
      line(8, { rework: true, late: true, deadline: "2026-10-20T10:00:00Z" })
    ];
    expect([...lines].sort(myOverviewOrder).map((item) => item.task.number)).toEqual([8, 4, 7, 3, 5, 2, 6, 1]);
  });

  it("tags: Việc của tôi = every shown line; Đang làm = open; Xong = finished; Trễ = late", () => {
    expect(myOverviewTagsOf({ finished: false, late: false })).toEqual(["mine", "inProgress"]);
    expect(myOverviewTagsOf({ finished: false, late: true })).toEqual(["mine", "inProgress", "late"]);
    expect(myOverviewTagsOf({ finished: true, late: false })).toEqual(["mine", "done"]);
  });

  it("images: the line plus its subtasks; Done quantities for finished lines; unknown quantities counted apart", () => {
    expect(lineImages({ qtyAssigned: 20, qtyDone: null, doneAt: null, subQtyAssigned: 5, subQtyDone: null })).toEqual({ assigned: 25, done: null });
    expect(lineImages({ qtyAssigned: 20, qtyDone: 18, doneAt: now, subQtyAssigned: 5, subQtyDone: 5 })).toEqual({ assigned: 25, done: 23 });
    expect(lineImages({ qtyAssigned: null, qtyDone: null, doneAt: null, subQtyAssigned: null, subQtyDone: null })).toEqual({ assigned: null, done: null });
    expect(
      tagOf([
        { finished: false, images: { assigned: 25, done: null } },
        { finished: true, images: { assigned: 25, done: 23 } },
        { finished: false, images: { assigned: null, done: null } }
      ])
    ).toEqual({ count: 3, images: 48, withoutQty: 1 });
  });

  it("status counts list the statuses present, in workflow order", () => {
    const meta = (code: Code) => ({ id: statuses[code].id, code, name: code, color: "blue", order: statuses[code].sortOrder });
    expect(statusCountsOf([{ status: meta("WAITING_QC") }, { status: meta("ASSIGNED") }, { status: meta("WAITING_QC") }])).toEqual([
      { status: { id: statuses.ASSIGNED.id, code: "ASSIGNED", name: "ASSIGNED", color: "blue" }, count: 1 },
      { status: { id: statuses.WAITING_QC.id, code: "WAITING_QC", name: "WAITING_QC", color: "blue" }, count: 2 }
    ]);
  });

  it("Cần bạn xử lý: rework, late, due soon; the QC items only for QC holders", () => {
    const lines = [
      { rework: true, late: true, dueSoon: false },
      { rework: false, late: true, dueSoon: false },
      { rework: false, late: false, dueSoon: true }
    ];
    expect(needsOf(lines, null)).toEqual({ rework: 1, late: 2, dueSoon: 1, qcWaiting: null, qcOverAlert: null });
    expect(needsOf(lines, [{ alert: true }, { alert: false }])).toEqual({ rework: 1, late: 2, dueSoon: 1, qcWaiting: 2, qcOverAlert: 1 });
  });
});

describe("QC clock (PD-081)", () => {
  it("Chờ QC: core minutes since it entered Chờ QC; the alert from 2 hours", () => {
    const entered = vn("2026-10-22", "13:45");
    const waiting = qcClockOf({ statusCode: "WAITING_QC", doneAt: vn("2026-10-20", "10:00") }, { ...noLogTimes, WAITING_QC: entered }, now, clock);
    expect(waiting).toEqual({ waitingSince: entered, checkingSince: null, waitMinutes: 135, alert: true });
    const fresh = qcClockOf({ statusCode: "WAITING_QC", doneAt: null }, { ...noLogTimes, WAITING_QC: vn("2026-10-22", "14:30") }, now, clock);
    expect(fresh).toMatchObject({ waitMinutes: 90, alert: false });
    // Entered at 16:00 yesterday: 30 minutes yesterday + 6h30 today (core time only).
    const overnight = qcClockOf({ statusCode: "WAITING_QC", doneAt: null }, { ...noLogTimes, WAITING_QC: vn("2026-10-21", "16:00") }, now, clock);
    expect(overnight).toMatchObject({ waitMinutes: 30 + 390, alert: true });
  });

  it("without a history row the Done time is used; Đang check counts the wait until the check started, no alert", () => {
    expect(qcClockOf({ statusCode: "WAITING_QC", doneAt: vn("2026-10-22", "15:00") }, noLogTimes, now, clock)).toMatchObject({
      waitingSince: vn("2026-10-22", "15:00"),
      waitMinutes: 60
    });
    const checking = qcClockOf(
      { statusCode: "QC_CHECKING", doneAt: null },
      { ...noLogTimes, WAITING_QC: vn("2026-10-22", "10:00"), QC_CHECKING: vn("2026-10-22", "15:50") },
      now,
      clock
    );
    expect(checking).toEqual({ waitingSince: vn("2026-10-22", "10:00"), checkingSince: vn("2026-10-22", "15:50"), waitMinutes: 350, alert: false });
  });

  it("longest wait first", () => {
    const rows = [
      { waitingSince: vn("2026-10-22", "11:00"), number: 3 },
      { waitingSince: null, number: 1 },
      { waitingSince: vn("2026-10-21", "11:00"), number: 2 }
    ];
    expect([...rows].sort(qcQueueOrder).map((row) => row.number)).toEqual([2, 3, 1]);
  });
});

// Reads ----------------------------------------------------------------------------------------------------------------

type LightRowInput = { n: number; code: Code; deadline: Date; doneAt?: Date | null; finishedAt?: Date | null; checking?: boolean };

const lightRow = (input: LightRowInput) => ({
  id: taskId(input.n),
  number: String(1000 + input.n),
  status_id: statuses[input.code].id,
  status_code: input.code,
  status_name: input.code,
  status_color: "blue",
  status_order: statuses[input.code].sortOrder,
  is_checking: input.checking ?? false,
  done_at: input.doneAt ?? null,
  deadline: input.deadline,
  finished_at: input.finishedAt ?? input.doneAt ?? null,
  deadline_in_range: input.deadline >= vn("2026-10-22", "00:00") && input.deadline < vn("2026-10-23", "00:00"),
  finished_in_range: Boolean(input.finishedAt && input.finishedAt >= vn("2026-10-22", "00:00") && input.finishedAt < vn("2026-10-23", "00:00")),
  qty_assigned: 20,
  qty_done: input.doneAt ? 20 : null,
  sub_qty_assigned: null,
  sub_qty_done: null
});

const fullRow = (input: LightRowInput & { assignee?: string; qc?: string | null; failCount?: number; driveLink?: string | null; workLink?: string | null }) =>
  ({
    id: taskId(input.n),
    number: String(1000 + input.n),
    job_id: jobId,
    job_code: "Batch 07",
    job_leader_id: null,
    project_id: projectId,
    project_code: "AXP",
    project_name: "Dự án A",
    assignee_id: input.assignee ?? me,
    assignee: { id: input.assignee ?? me, display_name: "Người làm", email: null, avatar_url: null },
    qc_id: input.qc === undefined ? worker : input.qc,
    qc: input.qc === null ? null : { id: input.qc ?? worker, display_name: "Người kiểm", email: null, avatar_url: null },
    process_id: input.checking ? checkingProcessId : processId,
    process_name: input.checking ? "Checking" : "Normal Retouch",
    process_is_qc: input.checking ?? false,
    shift_id: shiftId,
    shift_name: "Ca chính",
    pay_mode: "POINTS",
    requires_ot_hours: false,
    qty_assigned: 20,
    qty_done: input.doneAt ? 20 : null,
    error_qty: null,
    ot_hours: null,
    assigned_at: vn("2026-10-20", "08:00"),
    deadline: input.deadline,
    done_at: input.doneAt ?? null,
    checked_at: null,
    status_id: statuses[input.code].id,
    status_code: input.code,
    status_name: input.code,
    status_color: "blue",
    kind: "NORMAL",
    parent_task_id: null,
    feedback_id: null,
    note: null,
    work_link: input.workLink ?? null,
    is_late: false,
    qc_fail_count: input.failCount ?? 0,
    custom_values: {},
    tag_ids: null,
    created_at: vn("2026-10-20", "08:00"),
    updated_at: vn("2026-10-20", "08:00"),
    closed_at: input.finishedAt ?? null,
    sub_seq: null,
    parent_number: null,
    deadline_cursor: input.deadline.toISOString(),
    job_archived: false,
    job_open_feedback: false,
    split_reason: null,
    created_by: null,
    subtasks: null,
    pending_qty_request: null,
    drive_link: input.driveLink === undefined ? "https://drive.example.test/folder-axp-07" : input.driveLink
  }) satisfies TaskRow & { drive_link: string | null };

const mine: LightRowInput[] = [
  { n: 1, code: "PROCESSING", deadline: vn("2026-10-23", "10:00") }, // due in 1h of core time (tomorrow)
  { n: 2, code: "ASSIGNED", deadline: vn("2026-10-20", "17:00") }, // late
  { n: 3, code: "REWORK", deadline: vn("2026-10-30", "17:00"), doneAt: vn("2026-10-21", "10:00") }, // sent back
  { n: 4, code: "WAITING_QC", deadline: vn("2026-10-19", "17:00"), doneAt: vn("2026-10-19", "11:05") }, // with QC
  { n: 5, code: "CHECKED", deadline: vn("2026-10-21", "17:00"), doneAt: vn("2026-10-21", "15:00"), finishedAt: vn("2026-10-22", "09:45") },
  { n: 6, code: "ASSIGNED", deadline: vn("2026-10-29", "17:00") }, // not shown (future, not in today)
  { n: 7, code: "PROCESSING", deadline: vn("2026-10-22", "23:00") } // due today, 30 minutes of core time left
];
const queued: (LightRowInput & { assignee: string })[] = [
  { n: 21, code: "WAITING_QC", deadline: vn("2026-10-22", "17:00"), doneAt: vn("2026-10-22", "14:30"), assignee: worker },
  { n: 22, code: "WAITING_QC", deadline: vn("2026-10-22", "17:00"), doneAt: vn("2026-10-22", "11:00"), assignee: worker },
  { n: 23, code: "QC_CHECKING", deadline: vn("2026-10-22", "17:00"), doneAt: vn("2026-10-22", "09:00"), assignee: worker }
];

const reads = () => {
  const find = (marker: string) => db.state.calls.filter((call) => call.text.includes(marker));
  return {
    light: find("AS deadline_in_range")[0],
    qc: find("t.qc_id = $")[0],
    full: find("t.id = ANY($::uuid[])")[0],
    logs: find("FROM production.task_logs l")[0],
    points: find("FROM production.score_entries")[0],
    targets: find("FROM production.kpi_targets WHERE")[0],
    leave: find("FROM production.leave_requests")[0]
  };
};

const answer = (options: { settings?: { key: string; value: unknown }[]; lines?: LightRowInput[] } = {}) => (call: Call): unknown[] | undefined => {
  const lines = options.lines ?? mine;
  if (call.text.includes("FROM production.settings")) {
    return options.settings ?? [];
  }
  if (call.text.includes("AS deadline_in_range")) {
    return lines.map(lightRow);
  }
  if (call.text.includes("t.qc_id = $")) {
    return queued.map((line) => fullRow({ ...line, qc: me }));
  }
  if (call.text.includes("t.id = ANY($::uuid[])")) {
    const ids = call.values.find((value) => Array.isArray(value)) as string[];
    return lines
      .filter((line) => ids.includes(taskId(line.n)))
      .map((line) =>
        fullRow({
          ...line,
          ...(line.n === 3 ? { failCount: 1 } : {}),
          ...(line.n === 7 ? { driveLink: null, workLink: "\\\\nas\\retouch\\axp-07" } : {})
        })
      );
  }
  if (call.text.includes("FROM production.task_logs l")) {
    return [
      { task_id: taskId(3), kind: "QC_FAIL", created_at: vn("2026-10-21", "15:00"), note: "Viền nền ảnh 3, 7 chưa sạch", by_user: { id: worker, display_name: "Người kiểm", email: null, avatar_url: null } },
      { task_id: taskId(4), kind: "DONE", created_at: vn("2026-10-22", "11:05"), note: null, by_user: null },
      { task_id: taskId(4), kind: "WAITING_QC", created_at: vn("2026-10-22", "11:05"), note: null, by_user: null },
      { task_id: taskId(21), kind: "WAITING_QC", created_at: vn("2026-10-22", "14:30"), note: null, by_user: null },
      { task_id: taskId(22), kind: "WAITING_QC", created_at: vn("2026-10-22", "11:00"), note: null, by_user: null },
      { task_id: taskId(23), kind: "WAITING_QC", created_at: vn("2026-10-22", "09:00"), note: null, by_user: null },
      { task_id: taskId(23), kind: "QC_CHECKING", created_at: vn("2026-10-22", "15:50"), note: null, by_user: null }
    ];
  }
  if (call.text.includes("FROM production.score_entries")) {
    return [
      { business_day: "2026-10-01", credits: "100.00" },
      { business_day: "2026-10-19", credits: "50.25" },
      { business_day: "2026-10-22", credits: "26.40" }
    ];
  }
  if (call.text.includes("FROM production.kpi_targets WHERE")) {
    return [{ period_type: "MONTH", target_points: "2600", effective_from: "2026-01" }];
  }
  if (call.text.includes("FROM public.organization_memberships om")) {
    return [{ id: me, display_name: "Tôi", email: null, avatar_url: null, team_id: null, team_name: null, roles: ["STAFF"], has_target: true }];
  }
  if (call.text.includes("FROM production.leave_requests")) {
    return [{ user_id: me, from_date: "2026-10-20", to_date: "2026-10-20", part: "FULL_DAY" }];
  }
  return undefined;
};

/** Every key of a JSON value, deeply. */
const keysOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap(keysOf)
    : value && typeof value === "object"
      ? Object.entries(value).flatMap(([key, child]) => [key, ...keysOf(child)])
      : [];

describe("GET /production/my-overview reads (PD-081)", () => {
  it("a Staff member: my lines of the range plus the always-shown ones, in list order; no QC parts", async () => {
    db.state.handler = answer();
    const overview: MyOverview = MyOverviewSchema.parse(await getMyOverview(contextWith(["STAFF"]), MyOverviewQuerySchema.parse({}), now));
    expect(overview.today).toBe("2026-10-22");
    expect(overview.range).toEqual({ from: "2026-10-22", to: "2026-10-22" });
    expect(overview.viewer).toEqual({ qc: false });
    expect(overview.clock).toEqual({ coreStart: "09:30", coreEnd: "16:30", dueSoonMinutes: 180, qcAlertMinutes: 120 });
    // 3 (rework), 2 (late), then open by deadline: 4 (with QC, deadline 19/10), 7 (today), 1 (tomorrow); then 5 (finished).
    expect(overview.tasks.map((line) => line.task.code)).toEqual(["1003", "1002", "1004", "1007", "1001", "1005"]);
    const byCode = new Map(overview.tasks.map((line) => [line.task.code, line]));
    expect(byCode.get("1003")).toMatchObject({ rework: true, late: false, finished: false });
    expect(byCode.get("1003")!.task.lastQcFail).toMatchObject({ note: "Viền nền ảnh 3, 7 chưa sạch", by: { id: worker } });
    expect(byCode.get("1002")).toMatchObject({ late: true, dueCoreMinutes: null });
    expect(byCode.get("1004")).toMatchObject({
      withQc: true,
      late: false,
      lastDoneAt: vn("2026-10-22", "11:05").toISOString(),
      qcWait: { since: vn("2026-10-22", "11:05").toISOString(), minutes: 295 }
    });
    expect(byCode.get("1007")).toMatchObject({ dueSoon: true, dueCoreMinutes: 30, folderLink: "\\\\nas\\retouch\\axp-07" });
    expect(byCode.get("1001")).toMatchObject({ dueSoon: true, dueCoreMinutes: 60, folderLink: "https://drive.example.test/folder-axp-07" });
    expect(byCode.get("1005")).toMatchObject({ finished: true, finishedAt: vn("2026-10-22", "09:45").toISOString(), images: { assigned: 20, done: 20 } });
    // The moves come from the workflow (Mới giao → Đang làm for the assignee), never invented.
    expect(byCode.get("1002")!.task.capabilities.transitions.map((option) => option.toStatusId)).toEqual([statuses.PROCESSING.id]);
    expect(byCode.get("1007")!.task.capabilities.transitions[0]).toMatchObject({ toStatusId: statuses.DONE.id, asksQty: true });

    expect(overview.tags).toEqual({
      mine: { count: 6, images: 120, withoutQty: 0 },
      inProgress: { count: 5, images: 100, withoutQty: 0 },
      done: { count: 1, images: 20, withoutQty: 0 },
      late: { count: 1, images: 20, withoutQty: 0 },
      qc: null
    });
    expect(overview.needs).toEqual({ rework: 1, late: 1, dueSoon: 2, qcWaiting: null, qcOverAlert: null });
    expect(overview.statusCounts.inProgress.map((entry) => `${entry.status.code}:${entry.count}`)).toEqual([
      "ASSIGNED:1",
      "REWORK:1",
      "PROCESSING:2",
      "WAITING_QC:1"
    ]);
    expect(overview.statusCounts.done.map((entry) => entry.status.code)).toEqual(["CHECKED"]);
    expect(overview.qcQueue).toBeNull();
    expect(overview.truncated).toBe(false);

    const { light, qc, full, logs } = reads();
    expect(qc).toBeUndefined();
    // My lines only (assignee), lines (not subtasks), live and not archived jobs; finished work only from the range.
    expect(light!.text).toContain("t.assignee_id = $");
    expect(light!.text).not.toContain("t.qc_id");
    expect(light!.text).toContain("NOT (t.kind = 'NORMAL' AND t.parent_task_id IS NOT NULL)");
    expect(light!.text).toContain("j.deleted_at IS NULL AND j.archived_at IS NULL");
    expect(light!.text).toContain("coalesce(t.closed_at, t.checked_at, t.done_at) >= (($::date)::timestamp AT TIME ZONE $::text)");
    expect(light!.values).toEqual(expect.arrayContaining([me, "2026-10-22", "Asia/Ho_Chi_Minh"]));
    // The DTOs of the listed lines only (n = 6 is not shown), one history read for them.
    expect(full!.values).toContainEqual([taskId(3), taskId(2), taskId(4), taskId(7), taskId(1), taskId(5)]);
    expect(logs!.values).toContainEqual([taskId(3), taskId(2), taskId(4), taskId(7), taskId(1), taskId(5)]);
  });

  it("a wider range adds the open lines due in it; finished lines need their finish in the range", async () => {
    db.state.handler = (call) => {
      if (call.text.includes("AS deadline_in_range")) {
        return mine.map((line) => ({ ...lightRow(line), deadline_in_range: line.n === 6 || lightRow(line).deadline_in_range }));
      }
      return answer()(call);
    };
    const overview = MyOverviewSchema.parse(
      await getMyOverview(contextWith(["STAFF"]), MyOverviewQuerySchema.parse({ from: "2026-10-19", to: "2026-10-31" }), now)
    );
    expect(overview.range).toEqual({ from: "2026-10-19", to: "2026-10-31" });
    expect(overview.tasks.map((line) => line.task.code)).toContain("1006");
    expect(reads().light!.values).toEqual(expect.arrayContaining(["2026-10-19", "2026-10-31"]));
  });

  it("a QC: the queue (other people's lines whose QC is me, Chờ QC / Đang check), longest wait first, with its clock", async () => {
    db.state.handler = answer();
    const overview = MyOverviewSchema.parse(await getMyOverview(contextWith(["STAFF", "QC"]), {}, now));
    expect(overview.viewer.qc).toBe(true);
    expect(overview.qcQueue!.map((line) => line.task.code)).toEqual(["1023", "1022", "1021"]);
    const [checking, long, fresh] = overview.qcQueue!;
    expect(checking).toMatchObject({ alert: false, checkingSince: vn("2026-10-22", "15:50").toISOString(), waitMinutes: 380 });
    expect(long).toMatchObject({ alert: true, waitMinutes: 300, waitingSince: vn("2026-10-22", "11:00").toISOString(), images: 20 });
    expect(fresh).toMatchObject({ alert: false, waitMinutes: 90 });
    // The QC's moves on someone else's line: start the check (Chờ QC → Đang check).
    expect(long!.task.capabilities.transitions.map((option) => option.toStatusId)).toEqual([statuses.QC_CHECKING.id]);
    expect(overview.tags.qc).toEqual({ count: 3, overAlert: 1, longestWaitMinutes: 300 });
    expect(overview.needs).toMatchObject({ qcWaiting: 3, qcOverAlert: 1 });
    const { qc } = reads();
    expect(qc!.text).toContain("t.qc_id = $ AND t.assignee_id <> $");
    expect(qc!.text).toContain("t.status_id = ANY($::uuid[])");
    expect(qc!.values).toContainEqual([statuses.WAITING_QC.id, statuses.QC_CHECKING.id]);
    expect(qc!.text).toContain("j.archived_at IS NULL");
    // PD-063: lines of a QA test account are hidden from a real QC.
    expect(qc!.text).toContain("NOT EXISTS (SELECT 1 FROM public.app_users test_au WHERE test_au.id = t.assignee_id AND test_au.is_test_account)");
  });

  it("a QA test account sees test accounts' lines in its queue (PD-063); a Leader / Admin without QC gets no QC parts", async () => {
    db.state.handler = answer();
    await getMyOverview(contextWith(["QC"], { test: true }), {}, now);
    expect(reads().qc!.text).not.toContain("test_au");
    db.state.calls = [];
    const leader = MyOverviewSchema.parse(await getMyOverview(contextWith(["LEADER", "ADMIN", "ACCOUNT"]), {}, now));
    expect(leader.viewer.qc).toBe(false);
    expect(leader.qcQueue).toBeNull();
    expect(leader.tags.qc).toBeNull();
    expect(reads().qc).toBeUndefined();
    // The same page of their own lines.
    expect(leader.tasks.length).toBe(6);
  });

  it("Điểm của tôi: today / this week / the KPI period (26 → 25) and the points needed per working day left", async () => {
    db.state.handler = answer();
    const overview = MyOverviewSchema.parse(await getMyOverview(contextWith(["STAFF"]), {}, now));
    expect(overview.points).toEqual({
      today: 26.4,
      week: { from: "2026-10-19", to: "2026-10-22", points: 76.65 },
      period: { period: "2026-10", from: "2026-09-26", to: "2026-10-25", points: 176.65 },
      kpi: {
        target: 2600,
        required: true,
        percent: 6.79,
        remaining: 2423.35,
        // Thursday, Friday, Saturday (Sunday 25/10 is not a working day).
        workingDaysLeft: 3,
        perDayNeeded: 807.79
      }
    });
    const { points, targets, leave } = reads();
    // Official points only (no Khoán, no money), the caller's own.
    expect(points!.text).toContain("pay_mode = 'POINTS'");
    expect(points!.text).not.toContain("money");
    expect(points!.values).toEqual(expect.arrayContaining([me, "2026-09-26", "2026-10-25"]));
    expect(targets!.values).toContain(me);
    expect(leave).toBeUndefined();
  });

  it("the KPI target is prorated by approved leave when the setting is on; no target → no hint", async () => {
    db.state.handler = answer({ settings: [{ key: "kpi_prorate_leave", value: true }] });
    const prorated = MyOverviewSchema.parse(await getMyOverview(contextWith(["STAFF"]), {}, now));
    // 25 working days in kỳ 10/2026, one on leave: 2600 × 24 / 25.
    expect(prorated.points.kpi.target).toBe(2496);
    expect(reads().leave).toBeDefined();
    clearProductionConfigCache();
    db.state.handler = (call) => (call.text.includes("FROM production.kpi_targets WHERE") ? [] : answer()(call));
    const none = MyOverviewSchema.parse(await getMyOverview(contextWith(["STAFF"]), {}, now));
    expect(none.points.kpi).toMatchObject({ target: null, percent: null, remaining: null, perDayNeeded: null, required: true });
  });

  it("never sends money, prices, other people's points or the client deadline", async () => {
    db.state.handler = answer();
    const overview = MyOverviewSchema.parse(await getMyOverview(contextWith(["STAFF", "QC"]), {}, now));
    const keys = new Set(keysOf(overview));
    for (const forbidden of keys) {
      expect(forbidden).not.toMatch(/money|price|unitCredits|creditPerImage|khoan|clientDeadline|jobDeadline|atRisk|risk/i);
    }
    for (const line of [...overview.tasks, ...overview.qcQueue!]) {
      expect(line.task.myCredits).toEqual([]);
      expect(line.task.points).toBeNull();
    }
    // Only the task deadline is sent (the line's own), never the job's.
    expect(keys.has("deadline")).toBe(true);
    expect(JSON.stringify(overview)).not.toContain("receivedAt");
  });

  it("lists at most myOverviewRowLimit lines; the counts still cover every shown line", async () => {
    const many: LightRowInput[] = Array.from({ length: myOverviewRowLimit + 20 }, (_, index) => ({
      n: 100 + index,
      code: "ASSIGNED" as const,
      deadline: vn("2026-10-20", "17:00")
    }));
    db.state.handler = answer({ lines: many });
    const overview = MyOverviewSchema.parse(await getMyOverview(contextWith(["STAFF"]), {}, now));
    expect(overview.tasks).toHaveLength(myOverviewRowLimit);
    expect(overview.truncated).toBe(true);
    expect(overview.tags.mine.count).toBe(myOverviewRowLimit + 20);
    expect(overview.needs.late).toBe(myOverviewRowLimit + 20);
  });

  it("non-members get 404", async () => {
    expect(await failure(getMyOverview(contextWith([]), {}, now))).toEqual({ code: "PRODUCTION_NOT_FOUND", status: 404 });
  });
});
