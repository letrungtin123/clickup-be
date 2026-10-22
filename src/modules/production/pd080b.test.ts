import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PD-080b — priced processes only (pricing.ts) and the official price workbook import (credit-workbook.ts), without a
 * database (fake tagged-template `sql` as in pd076 / job-worklog tests). Obviously fake codes, processes and prices only:
 * the repository is public and the real workbook is company data.
 */
type Call = { text: string; values: unknown[] };
type Fragment = { readonly isFragment: true; text: string; values: unknown[] };

const db = vi.hoisted(() => {
  const state = { calls: [] as Call[], handler: (() => []) as (call: Call) => unknown[] | undefined };
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

const { assertProcessesPriced, pricingDay, pricingProblems, processNotPricedMessage, projectNotPricedMessage } = await import("./pricing.js");
const { applyCreditImport, parseCreditSheet, planCreditImport } = await import("./credit-workbook.js");
const { importCreditRules } = await import("./credit-rules.js");

const org = "11111111-1111-4111-8111-111111111111";
const projectA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const projectB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const retouch = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const checking = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return { code: (error as { code?: string }).code, status: (error as { statusCode?: number }).statusCode, message: (error as Error).message };
  }
  return null;
};

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = () => [];
});

describe("priced processes only (PD-080b)", () => {
  const row = (index: number, priced: boolean, projectPriced = true) => ({
    index,
    process_name: "Retouch",
    project_code: "AXP",
    priced,
    project_priced: projectPriced
  });

  it("a priced process passes; an unpriced one names the process, the project and the day", () => {
    const checks = [{ processId: retouch, day: "2026-10-26" }];
    expect(pricingProblems(checks, [row(1, true)])).toEqual([]);
    expect(pricingProblems(checks, [row(1, false)])).toEqual([processNotPricedMessage("Retouch", "AXP", "2026-10-26")]);
    expect(processNotPricedMessage("Retouch", "AXP", "2026-10-26")).toBe(
      "Quy trình “Retouch” chưa có đơn giá cho Project “AXP” ngày 26/10/2026 — liên hệ Quản trị."
    );
  });

  it("a project without any price that day: one clear message per day, whatever the lines", () => {
    const checks = [
      { processId: retouch, day: "2026-10-26", prefix: "Task 1: " },
      { processId: checking, day: "2026-10-26", prefix: "Task 2: " },
      { processId: retouch, day: "2026-10-27", prefix: "Task 3: " }
    ];
    expect(pricingProblems(checks, [row(1, false, false), row(2, false, false), row(3, false, false)])).toEqual([
      `Task 1: ${projectNotPricedMessage("AXP")}`,
      `Task 3: ${projectNotPricedMessage("AXP")}`
    ]);
    expect(projectNotPricedMessage("AXP")).toBe("Project “AXP” chưa có đơn giá — liên hệ Quản trị.");
  });

  it("the day is the Ngày nhận in the organization calendar (else today): 25/10 vs 26/10", () => {
    expect(pricingDay("2026-10-25T16:59:00Z")).toBe("2026-10-25");
    expect(pricingDay("2026-10-25T17:00:00Z")).toBe("2026-10-26");
    expect(pricingDay(null, new Date("2026-10-26T03:00:00Z"))).toBe("2026-10-26");
    expect(pricingDay(undefined, new Date("2026-10-24T20:00:00Z"))).toBe("2026-10-25");
  });

  it("one grouped query for every line; failing lines → 400 PROCESS_NOT_PRICED; nothing asked without lines", async () => {
    db.state.handler = (call) =>
      call.text.includes("AS project_priced")
        ? [
            { index: 1, process_name: "Retouch", project_code: "AXP", priced: true, project_priced: true },
            { index: 2, process_name: "Checking", project_code: "AXP", priced: false, project_priced: true }
          ]
        : undefined;
    const result = await failure(
      assertProcessesPriced(db.sql as never, org, projectA, [
        { processId: retouch, day: "2026-10-25", prefix: "Task 1: " },
        { processId: checking, day: "2026-10-26", prefix: "Task 2: " }
      ])
    );
    expect(result).toEqual({ code: "PROCESS_NOT_PRICED", status: 400, message: `Task 2: ${processNotPricedMessage("Checking", "AXP", "2026-10-26")}` });
    const calls = db.state.calls.filter((call) => call.text.includes("AS project_priced"));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.text).toContain("r.effective_from <= c.day AND (r.effective_to IS NULL OR c.day < r.effective_to)");
    expect(calls[0]!.values).toContainEqual([retouch, checking]);
    expect(calls[0]!.values).toContainEqual(["2026-10-25", "2026-10-26"]);

    db.state.calls = [];
    await assertProcessesPriced(db.sql as never, org, projectA, []);
    expect(db.state.calls).toHaveLength(0);
  });
});

describe("price workbook import (PD-080b)", () => {
  const catalog = {
    projects: [
      { id: projectA, code: "AXP" },
      { id: projectB, code: "B&R" }
    ],
    processes: [
      { id: retouch, name: "Retouch", isQc: false },
      { id: checking, name: "Checking", isQc: true }
    ]
  };
  const config = {
    processAliases: { qc: "Checking", qcfoo: "Checking Foo" },
    newProcesses: [
      { name: "Checking Foo", isQc: true },
      { name: "Glow", isQc: false }
    ]
  };
  const at = (line: number, code: string, hours: number | null, credit: number | null, money: number | null) => ({ line, code, hours, credit, money });
  const sheet = [
    at(2, "axp", null, null, null),
    at(3, "Retouch", 0.41666, 4.583333, 10000),
    at(4, "QC", 0.1, 1.1, null),
    at(5, "QCFoo", null, 2.2, null),
    at(6, "Glow", null, null, null),
    at(7, "", null, null, null),
    // "BR" matches "B&R" on letters and digits only.
    at(8, "BR", null, null, null),
    at(9, "Retouch", 0.5, 5.5, 12000),
    at(10, "Glow", 0.2, null, 3000)
  ];

  it("blocks start at project rows; process rows carry H / J / K; empty J = no price, empty K / H = null", () => {
    const parsed = parseCreditSheet(sheet, catalog, config);
    expect(parsed).toMatchObject({ blocks: 2, looseBlocks: 1, unmatchedBlocks: 0, skipped: 1, withoutCredit: 1, withoutMoney: 2, withoutHours: 1 });
    expect(parsed.unknownProcesses).toEqual([]);
    expect(parsed.problems).toEqual([]);
    expect(parsed.processesToCreate).toEqual([
      { name: "Checking Foo", isQc: true },
      { name: "Glow", isQc: false }
    ]);
    expect(parsed.entries).toEqual([
      { line: 3, projectId: projectA, processName: "Retouch", credit: 4.58, money: 10000, hours: 0.4167 },
      { line: 4, projectId: projectA, processName: "Checking", credit: 1.1, money: null, hours: 0.1 },
      { line: 5, projectId: projectA, processName: "Checking Foo", credit: 2.2, money: null, hours: null },
      { line: 9, projectId: projectB, processName: "Retouch", credit: 5.5, money: 12000, hours: 0.5 }
    ]);
  });

  it("unknown processes, an unmatched project block, prices before any block and duplicates are reported", () => {
    const parsed = parseCreditSheet(
      [
        at(2, "Retouch", 0.5, 5.5, null),
        at(3, "AXP", null, null, null),
        at(4, "Mystery", 0.5, 5.5, null),
        at(5, "Retouch", 0.5, 5.5, null),
        at(6, "Retouch", 0.6, 6.6, null),
        at(7, "ZZZ", null, null, null),
        at(8, "Retouch", 0.5, 5.5, null)
      ],
      catalog,
      config
    );
    expect(parsed.unknownProcesses).toEqual(["Mystery"]);
    expect(parsed.unmatchedBlocks).toBe(1);
    expect(parsed.problems.map((problem) => problem.line)).toEqual([2, 6, 8]);
    expect(parsed.entries.map((entry) => entry.line)).toEqual([5]);
  });

  const existing = (overrides: Record<string, unknown>) => ({
    id: "r",
    project_id: projectA,
    process_id: retouch,
    credit_per_image: "5.50",
    money_per_image: null,
    hours_per_image: null,
    source: null,
    effective_from: "2026-01-01",
    effective_to: null,
    ...overrides
  });

  it("the plan ends every rule in force on the day (all projects), writes the file's rows, and is empty on a re-run", () => {
    const parsed = parseCreditSheet(sheet, catalog, config);
    const ids = new Map<string, string | null>([
      ["retouch", retouch],
      ["checking", checking],
      ["checking foo", null]
    ]);
    const plan = planCreditImport(
      parsed,
      [
        existing({ id: "old-a" }),
        existing({ id: "old-b", project_id: projectB }),
        existing({ id: "other-project", project_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9" }),
        existing({ id: "already-ended", effective_to: "2026-05-01" })
      ],
      ids,
      "2026-10-26",
      "Fake_File"
    );
    expect(plan.toEnd).toEqual(["old-a", "old-b", "other-project"]);
    expect(plan.toWrite).toHaveLength(4);
    expect(plan.toWrite.find((entry) => entry.processName === "Checking Foo")?.processId).toBeNull();
    expect(plan.conflicting).toBe(0);

    // After the import: the same file plans nothing.
    const after = [
      existing({ id: "old-a", effective_to: "2026-10-26" }),
      existing({ id: "old-b", project_id: projectB, effective_to: "2026-10-26" }),
      existing({ id: "n1", effective_from: "2026-10-26", credit_per_image: "4.58", money_per_image: "10000", hours_per_image: "0.4167", source: "Fake_File" }),
      existing({ id: "n2", effective_from: "2026-10-26", process_id: checking, credit_per_image: "1.10", hours_per_image: "0.1000", source: "Fake_File" }),
      existing({ id: "n3", effective_from: "2026-10-26", process_id: "foo", credit_per_image: "2.20", source: "Fake_File" }),
      existing({ id: "n4", effective_from: "2026-10-26", project_id: projectB, money_per_image: "12000", hours_per_image: "0.5", source: "Fake_File" })
    ];
    const again = planCreditImport(parsed, after, new Map([...ids, ["checking foo", "foo"]]), "2026-10-26", "Fake_File");
    expect(again).toEqual({ toEnd: [], toWrite: [], unchanged: 4, conflicting: 0 });

    // A row starting that day that the file does not have is a conflict (nothing is written).
    const conflict = planCreditImport(parsed, [...after, existing({ id: "x", effective_from: "2026-10-26", project_id: "zz" })], new Map([...ids, ["checking foo", "foo"]]), "2026-10-26", "Fake_File");
    expect(conflict.conflicting).toBe(1);
  });

  it("apply: creates processes, refuses to end a rule that priced scores on / after the day (PR-12), records the version", async () => {
    const parsed = parseCreditSheet(sheet, catalog, config);
    const plan = { toEnd: ["old-a"], toWrite: [], unchanged: 0, conflicting: 0 };
    db.state.handler = (call) =>
      call.text.startsWith("SELECT count(DISTINCT s.credit_rule_id)") ? [{ count: 1 }]
      : call.text.startsWith("INSERT INTO production.processes") ? [{ id: "new" }]
      : undefined;
    const refused = await failure(
      applyCreditImport(db.sql as never, { organizationId: org, parsed, plan, effectiveFrom: "2026-10-26", source: "Fake_File", versionName: "V", userId: null })
    );
    expect(refused).toMatchObject({ code: "CREDIT_RULE_IN_USE", status: 409 });
    expect(db.state.calls.some((call) => call.text.startsWith("UPDATE production.credit_rules SET effective_to"))).toBe(false);

    db.state.calls = [];
    db.state.handler = (call) =>
      call.text.startsWith("SELECT count(DISTINCT s.credit_rule_id)") ? [{ count: 0 }]
      : call.text.startsWith("INSERT INTO production.processes") ? [{ id: "new" }]
      : call.text.startsWith("INSERT INTO production.credit_versions") ? [{ changed: true }]
      : undefined;
    const done = await applyCreditImport(db.sql as never, { organizationId: org, parsed, plan, effectiveFrom: "2026-10-26", source: "Fake_File", versionName: "V", userId: null });
    expect(done).toEqual({ createdProcesses: 2, ended: 1, written: 0, versionChanged: true });
    const created = db.state.calls.filter((call) => call.text.startsWith("INSERT INTO production.processes"));
    expect(created.map((call) => call.values.slice(1, 3))).toEqual([
      ["Checking Foo", true],
      ["Glow", false]
    ]);
    expect(db.state.calls.find((call) => call.text.startsWith("UPDATE production.credit_rules SET effective_to"))?.values).toContain("2026-10-26");

    const conflict = await failure(
      applyCreditImport(db.sql as never, { organizationId: org, parsed, plan: { ...plan, conflicting: 2 }, effectiveFrom: "2026-10-26", source: "F", versionName: null, userId: null })
    );
    expect(conflict).toMatchObject({ code: "CREDIT_IMPORT_CONFLICT", status: 409 });
  });

  it("several QC-type processes: the CSV import creates any missing 'Checking …' process as QC", async () => {
    db.state.handler = (call) =>
      call.text.startsWith("SELECT id, code FROM production.projects") ? [{ id: projectA, code: "AXP" }]
      : call.text.startsWith("SELECT id, name FROM production.processes") ? [{ id: checking, name: "Checking" }]
      : call.text.startsWith("INSERT INTO production.processes") ? [{ id: "new-process" }]
      : call.text.startsWith("INSERT INTO production.credit_rules") ? [{ id: "new-rule" }]
      : undefined;
    const result = await importCreditRules(db.sql as never, {
      organizationId: org,
      csv: "project_code,process_name,credit,money,hours\nAXP,Checking Foo,2.2,,0.2\n",
      effectiveFrom: "2026-10-26",
      createMissing: true,
      userId: null
    });
    expect(result).toMatchObject({ ok: true, imported: 1, createdProcesses: ["Checking Foo"] });
    const insert = db.state.calls.find((call) => call.text.startsWith("INSERT INTO production.processes"))!;
    expect(insert.values).toContain(true);
    // No "is there already a QC process?" check any more.
    expect(db.state.calls.some((call) => call.text.includes("is_qc AND active"))).toBe(false);
  });
});
