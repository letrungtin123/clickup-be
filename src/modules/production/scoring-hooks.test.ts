import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Score recording hooks without a database (fake `sql` recording every statement): PD-037 (one entry per line at its
 * first Done — WORKER for a work line, QC for a Checking line, priced and paid like the line's shift; Checked records
 * nothing) and PD-036 (a deleted line's entries are brought back to zero by adjustment rows). Fake ids only.
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
  return { state, sql: Object.assign(sql, { json: (value: unknown) => value }) };
});

vi.mock("./catalog.service.js", () => ({
  loadSettings: vi.fn(() => Promise.resolve({ kpiCloseDay: 25, kpiCloseDays: [{ fromPeriod: null, closeDay: 25 }] })),
  closeDaysOf: (settings: { kpiCloseDays: unknown }) => settings.kpiCloseDays
}));
vi.mock("./credit-rules.js", () => ({
  getCreditRule: vi.fn((_sql: unknown, _org: string, _project: string, processId: string) =>
    Promise.resolve(
      processId === checkingProcess
        ? { id: "rule-checking", creditPerImage: 0.5, moneyPerImage: null }
        : { id: "rule-retouch", creditPerImage: 3, moneyPerImage: 15000 }
    )
  )
}));

const { onTaskDeleted, onTaskStatusEntered } = await import("./scoring-hooks.js");

const org = "11111111-1111-4111-8111-111111111111";
const qcPerson = "22222222-2222-4222-8222-222222222222";
const worker = "33333333-3333-4333-8333-333333333333";
const taskId = "55555555-5555-4555-8555-555555555555";
const checkingProcess = "77777777-7777-4777-8777-777777777777";
const retouchProcess = "99999999-9999-4999-8999-999999999999";
const at = new Date("2026-10-12T03:00:00Z");

const line = (overrides: Record<string, unknown> = {}) => ({
  id: taskId,
  job_id: "66666666-6666-4666-8666-666666666666",
  project_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  assignee_id: qcPerson,
  qc_id: null,
  process_id: checkingProcess,
  process_is_qc: true,
  shift_id: "88888888-8888-4888-8888-888888888888",
  pay_mode: "POINTS",
  kind: "NORMAL",
  qty_done: 40,
  qty_assigned: 40,
  ...overrides
});

const answer = (task: Record<string, unknown>, originals: Record<string, unknown>[] = [], ledgerQty = 0) => (call: Call) =>
  call.text.includes("FROM production.tasks t") ? [task]
  : call.text.includes("AND adjusts_entry_id IS NULL") ? originals
  : call.text.includes("coalesce(sum(qty), 0)::int AS qty") ? [{ qty: ledgerQty }]
  : undefined;
const inserts = () => db.state.calls.filter((call) => call.text.startsWith("INSERT INTO production.score_entries"));

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = () => [];
});

describe("PD-037 — Checking is a work line", () => {
  it("a Checking line's first Done records ONE QC entry for its assignee at the Checking rate", async () => {
    db.state.handler = answer(line());
    await onTaskStatusEntered(db.sql as never, { organizationId: org, taskId, status: { id: "DONE", countsDone: true, countsChecked: false }, at });
    expect(inserts()).toHaveLength(1);
    const values = inserts()[0]!.values;
    // user, task, …, role, pay mode, kind, rule, unit credits, unit money, qty, credits, money
    expect(values.slice(0, 2)).toEqual([org, qcPerson]);
    expect(values).toContain("QC");
    expect(values).toContain("POINTS");
    expect(values).toContain("rule-checking");
    expect(values).toContain(20); // 0.5 × 40
    expect(db.state.calls.find((call) => call.text.includes("FROM production.tasks t"))!.text).toContain("pr.is_qc AS process_is_qc");
  });

  it("on a Khoán shift the Checking entry is Khoán (outside the official total), like a work line", async () => {
    db.state.handler = answer(line({ pay_mode: "MONEY_IF_KPI" }));
    await onTaskStatusEntered(db.sql as never, { organizationId: org, taskId, status: { id: "DONE", countsDone: true, countsChecked: false }, at });
    expect(inserts()[0]!.values).toContain("MONEY_IF_KPI");
    expect(inserts()[0]!.values).toContain("QC");
  });

  it("a work line records WORKER for its assignee; entering Checked records nothing any more (no task-level QC credit)", async () => {
    db.state.handler = answer(line({ assignee_id: worker, qc_id: qcPerson, process_id: retouchProcess, process_is_qc: false, qty_done: 10 }));
    await onTaskStatusEntered(db.sql as never, { organizationId: org, taskId, status: { id: "DONE", countsDone: true, countsChecked: false }, at });
    expect(inserts()).toHaveLength(1);
    expect(inserts()[0]!.values).toContain("WORKER");
    expect(inserts()[0]!.values).toContain(worker);

    db.state.calls = [];
    await onTaskStatusEntered(db.sql as never, { organizationId: org, taskId, status: { id: "CHECKED", countsDone: false, countsChecked: true }, at });
    expect(db.state.calls).toHaveLength(0);
  });

  it("Done again after a quantity change adjusts the existing entry instead of writing a second one", async () => {
    const original = {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      role: "QC",
      user_id: qcPerson,
      job_id: line().job_id,
      project_id: line().project_id,
      process_id: checkingProcess,
      shift_id: line().shift_id,
      pay_mode: "POINTS",
      kind: "NORMAL",
      credit_rule_id: "rule-checking",
      unit_credits: "0.50",
      unit_money: "0"
    };
    db.state.handler = answer(line({ qty_done: 36 }), [original], 40);
    await onTaskStatusEntered(db.sql as never, { organizationId: org, taskId, status: { id: "DONE", countsDone: true, countsChecked: false }, at });
    expect(inserts()).toHaveLength(1);
    expect(inserts()[0]!.text).toContain("adjusts_entry_id");
    expect(inserts()[0]!.values).toContain(-4);
    expect(inserts()[0]!.values).toContain(-2);
  });
});

describe("PD-036 — deleting a line reverses its entries", () => {
  it("every original entry is brought back to zero with an adjustment row, dated at the deletion", async () => {
    const entry = (role: string, user: string, unit: string) => ({
      id: role === "WORKER" ? "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1" : "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2",
      role,
      user_id: user,
      job_id: line().job_id,
      project_id: line().project_id,
      process_id: retouchProcess,
      shift_id: line().shift_id,
      pay_mode: "MONEY_IF_KPI",
      kind: "NORMAL",
      credit_rule_id: "rule-retouch",
      unit_credits: unit,
      unit_money: role === "WORKER" ? "15000" : "0"
    });
    db.state.handler = answer(line(), [entry("WORKER", worker, "3.00"), entry("QC", qcPerson, "0.50")], 10);
    expect(await onTaskDeleted(db.sql as never, { organizationId: org, taskId, taskNumber: 12, at })).toBe(2);
    expect(inserts()).toHaveLength(2);
    const [workerRow, qcRow] = inserts();
    expect(workerRow!.values).toContain(-10);
    expect(workerRow!.values).toContain(-30);
    expect(workerRow!.values).toContain(-150000);
    expect(workerRow!.values).toContain("Xoá task #12");
    expect(qcRow!.values).toContain(-5);
  });

  it("nothing recorded → nothing written", async () => {
    db.state.handler = answer(line(), []);
    expect(await onTaskDeleted(db.sql as never, { organizationId: org, taskId, taskNumber: 3, at })).toBe(0);
    expect(inserts()).toHaveLength(0);
  });
});
