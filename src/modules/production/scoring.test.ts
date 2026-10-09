import { describe, expect, it } from "vitest";

import {
  computeAdjustment,
  computeQcEntry,
  computeWorkerEntry,
  countWorkingDays,
  effectiveTarget,
  forecast,
  kpiProgress,
  latestClosedPeriod,
  percentKpi,
  periodCloseInstant,
  periodMonth,
  periodOfDay,
  periodRange,
  periodsIn,
  prorateTarget,
  rankByPoints,
  rollupKpi,
  rollupKey,
  rolesToRecord,
  settlePeriod,
  settleUser,
  shouldAutoSettle,
  summarize,
  totals,
  weekStart,
  type RuleSnapshot,
  type SummaryEntry
} from "./scoring.js";

/**
 * SPEC Phase 3 §6 (mandatory cases). Fake project codes, same numbers as the reference table:
 * PRJA Normal Retouch 3.00 / 15 000, PRJA Checking 0.50 / —, PRJB Light Retouch 1.00 / —.
 */
const prjaNormal: RuleSnapshot = { id: "rule-prja-normal", creditPerImage: 3, moneyPerImage: 15000 };
const prjaChecking: RuleSnapshot = { id: "rule-prja-checking", creditPerImage: 0.5, moneyPerImage: null };
const prjbLight: RuleSnapshot = { id: "rule-prjb-light", creditPerImage: 1, moneyPerImage: null };

describe("computeWorkerEntry / computeQcEntry (SPEC §5.6)", () => {
  it("PRJA Normal Retouch 10 images, official shift → WORKER 30.00 credits, 0 money", () => {
    expect(computeWorkerEntry({ rule: prjaNormal, qtyDone: 10, payMode: "POINTS", kind: "NORMAL" })).toEqual({
      role: "WORKER",
      payMode: "POINTS",
      creditRuleId: "rule-prja-normal",
      qty: 10,
      unitCredits: 3,
      unitMoney: 0,
      credits: 30,
      money: 0
    });
  });

  it("PRJA Normal Retouch 10 images, Khoán shift → 30.00 credits, 150 000 provisional money", () => {
    const entry = computeWorkerEntry({ rule: prjaNormal, qtyDone: 10, payMode: "MONEY_IF_KPI", kind: "NORMAL" });
    expect(entry).toMatchObject({ role: "WORKER", payMode: "MONEY_IF_KPI", credits: 30, money: 150000, unitMoney: 15000 });
  });

  it("PRJA Checking 10 images → QC 5.00 credits, never money, always POINTS", () => {
    expect(computeQcEntry({ rule: prjaChecking, qtyDone: 10, kind: "NORMAL" })).toEqual({
      role: "QC",
      payMode: "POINTS",
      creditRuleId: "rule-prja-checking",
      qty: 10,
      unitCredits: 0.5,
      unitMoney: 0,
      credits: 5,
      money: 0
    });
    // Even if a QC rule carried a price, QC credit has no money (PD-010).
    expect(computeQcEntry({ rule: { ...prjaChecking, moneyPerImage: 999 }, qtyDone: 10, kind: "NORMAL" }).money).toBe(0);
  });

  it("PRJB Light Retouch 4 images, Khoán shift, no price → 4.00 credits, 0 money", () => {
    expect(computeWorkerEntry({ rule: prjbLight, qtyDone: 4, payMode: "MONEY_IF_KPI", kind: "NORMAL" })).toMatchObject({
      credits: 4,
      money: 0,
      payMode: "MONEY_IF_KPI"
    });
  });

  it("FB_WRONG task of 5 images → entry 0 / 0 that keeps qty 5 (worker and QC)", () => {
    expect(computeWorkerEntry({ rule: prjaNormal, qtyDone: 5, payMode: "MONEY_IF_KPI", kind: "FB_WRONG" })).toMatchObject({
      qty: 5,
      credits: 0,
      money: 0,
      unitCredits: 0,
      unitMoney: 0,
      creditRuleId: "rule-prja-normal"
    });
    expect(computeQcEntry({ rule: prjaChecking, qtyDone: 5, kind: "FB_WRONG" })).toMatchObject({ qty: 5, credits: 0, money: 0 });
  });

  it("FB_EXTRA is priced like a normal task", () => {
    expect(computeWorkerEntry({ rule: prjaNormal, qtyDone: 2, payMode: "POINTS", kind: "FB_EXTRA" }).credits).toBe(6);
  });

  it("no credit rule for the pair → recorded with 0 credits and no rule id (anomaly)", () => {
    expect(computeWorkerEntry({ rule: null, qtyDone: 7, payMode: "MONEY_IF_KPI", kind: "NORMAL" })).toEqual({
      role: "WORKER",
      payMode: "MONEY_IF_KPI",
      creditRuleId: null,
      qty: 7,
      unitCredits: 0,
      unitMoney: 0,
      credits: 0,
      money: 0
    });
    expect(computeQcEntry({ rule: null, qtyDone: 7, kind: "NORMAL" })).toMatchObject({ creditRuleId: null, credits: 0 });
  });

  it("keeps exact 2-decimal credits (no float drift)", () => {
    const entry = computeWorkerEntry({ rule: { id: "r", creditPerImage: 1.48, moneyPerImage: 9000 }, qtyDone: 3, payMode: "POINTS", kind: "NORMAL" });
    expect(entry.credits).toBe(4.44);
    expect(computeWorkerEntry({ rule: { id: "r", creditPerImage: 0.1, moneyPerImage: null }, qtyDone: 3, payMode: "POINTS", kind: "NORMAL" }).credits).toBe(0.3);
  });
});

describe("rolesToRecord — first entry only (SPEC §5.2)", () => {
  it("Done writes WORKER; Checked writes QC when the task has a QC", () => {
    expect(rolesToRecord({ countsDone: true, countsChecked: false, hasQc: true, recorded: new Set() })).toEqual(["WORKER"]);
    expect(rolesToRecord({ countsDone: false, countsChecked: true, hasQc: true, recorded: new Set(["WORKER"]) })).toEqual(["QC"]);
    expect(rolesToRecord({ countsDone: false, countsChecked: true, hasQc: false, recorded: new Set(["WORKER"]) })).toEqual([]);
    expect(rolesToRecord({ countsDone: false, countsChecked: false, hasQc: true, recorded: new Set() })).toEqual([]);
  });

  it("QC fail → Done again: no second entry", () => {
    // Done (WORKER recorded) → Waiting QC → QC fail → Processing → Done again.
    expect(rolesToRecord({ countsDone: true, countsChecked: false, hasQc: true, recorded: new Set(["WORKER"]) })).toEqual([]);
    expect(rolesToRecord({ countsDone: false, countsChecked: true, hasQc: true, recorded: new Set(["WORKER", "QC"]) })).toEqual([]);
  });

  it("a status flagged both done and checked records both once", () => {
    expect(rolesToRecord({ countsDone: true, countsChecked: true, hasQc: true, recorded: new Set() })).toEqual(["WORKER", "QC"]);
  });
});

describe("computeAdjustment — Leader edits qty after Done (SPEC §5.2)", () => {
  it("qty 10 → 8: −6.00 WORKER credits, −1.00 QC credits", () => {
    const worker = computeWorkerEntry({ rule: prjaNormal, qtyDone: 10, payMode: "POINTS", kind: "NORMAL" });
    const qc = computeQcEntry({ rule: prjaChecking, qtyDone: 10, kind: "NORMAL" });
    expect(computeAdjustment(worker, 10, 8)).toEqual({ qty: -2, credits: -6, money: 0 });
    expect(computeAdjustment(qc, 10, 8)).toEqual({ qty: -2, credits: -1, money: 0 });
  });

  it("adjusts provisional money of a Khoán entry, and nothing when the qty is unchanged", () => {
    const khoan = computeWorkerEntry({ rule: prjaNormal, qtyDone: 10, payMode: "MONEY_IF_KPI", kind: "NORMAL" });
    expect(computeAdjustment(khoan, 10, 12)).toEqual({ qty: 2, credits: 6, money: 30000 });
    expect(computeAdjustment(khoan, 10, 10)).toBeNull();
  });

  it("price change after Done leaves the entry alone; adjustments reuse the recorded unit price", () => {
    const rule = { ...prjaNormal };
    const entry = computeWorkerEntry({ rule, qtyDone: 10, payMode: "POINTS", kind: "NORMAL" });
    rule.creditPerImage = 4;
    rule.moneyPerImage = 20000;
    expect(entry.credits).toBe(30);
    expect(entry.unitCredits).toBe(3);
    expect(computeAdjustment(entry, 10, 8)).toEqual({ qty: -2, credits: -6, money: 0 });
  });

  it("FB_WRONG adjustments move the qty but never credits", () => {
    const entry = computeWorkerEntry({ rule: prjaNormal, qtyDone: 5, payMode: "POINTS", kind: "FB_WRONG" });
    expect(computeAdjustment(entry, 5, 3)).toEqual({ qty: -2, credits: 0, money: 0 });
  });
});

describe("KPI periods (close day, Asia/Ho_Chi_Minh)", () => {
  it("26/09 belongs to period 10/2026; 25/09 to period 09/2026", () => {
    expect(periodMonth(new Date("2026-09-26T08:00:00+07:00"), 25)).toBe("2026-10-01");
    expect(periodMonth(new Date("2026-09-25T08:00:00+07:00"), 25)).toBe("2026-09-01");
  });

  it("uses the business calendar day, not UTC", () => {
    // 25/10 23:30 VN = 25/10 16:30 UTC → period 10; 26/10 00:10 VN = 25/10 17:10 UTC → period 11.
    expect(periodMonth(new Date("2026-10-25T16:30:00Z"), 25)).toBe("2026-10-01");
    expect(periodMonth(new Date("2026-10-25T17:10:00Z"), 25)).toBe("2026-11-01");
  });

  it("rolls over the year and follows a changed close day", () => {
    expect(periodOfDay("2026-12-26", 25)).toBe("2027-01");
    expect(periodOfDay("2026-12-25", 25)).toBe("2026-12");
    expect(periodOfDay("2026-10-21", 20)).toBe("2026-11");
    expect(periodOfDay("2026-10-20", 20)).toBe("2026-10");
  });

  it("period ranges", () => {
    expect(periodRange("2026-10", 25)).toEqual({ from: "2026-09-26", to: "2026-10-25" });
    expect(periodRange("2027-01", 25)).toEqual({ from: "2026-12-26", to: "2027-01-25" });
    expect(periodRange("2026-03", 28)).toEqual({ from: "2026-03-01", to: "2026-03-28" });
  });

  it("quarters and years are sums of monthly periods", () => {
    expect(periodsIn("MONTH", "2026-11")).toEqual(["2026-11"]);
    expect(periodsIn("QUARTER", "2026-11")).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(periodsIn("YEAR", "2026-11")).toHaveLength(12);
    expect(periodsIn("YEAR", "2026-11")[0]).toBe("2026-01");
  });

  it("working days are Monday–Saturday; weeks start on Monday", () => {
    // 2026-10-05 is a Monday; 05..11 = Mon..Sun.
    expect(countWorkingDays("2026-10-05", "2026-10-11")).toBe(6);
    expect(countWorkingDays("2026-10-11", "2026-10-11")).toBe(0);
    expect(countWorkingDays("2026-10-12", "2026-10-05")).toBe(0);
    expect(weekStart("2026-10-09")).toBe("2026-10-05");
    expect(weekStart("2026-10-11")).toBe("2026-10-05");
    expect(weekStart("2026-10-05")).toBe("2026-10-05");
  });
});

const entry = (patch: Partial<SummaryEntry>): SummaryEntry => ({
  businessDay: "2026-10-01",
  role: "WORKER",
  payMode: "POINTS",
  credits: 0,
  money: 0,
  qty: 0,
  projectId: "p-a",
  projectCode: "PRJA",
  ...patch
});

describe("summarize", () => {
  const entries = [
    entry({ businessDay: "2026-10-01", credits: 30, qty: 10 }),
    entry({ businessDay: "2026-10-01", payMode: "MONEY_IF_KPI", credits: 30, money: 150000, qty: 10 }),
    entry({ businessDay: "2026-10-03", role: "QC", credits: 5, qty: 10 }),
    entry({ businessDay: "2026-10-03", credits: -6, qty: -2 }),
    entry({ businessDay: "2026-10-03", projectId: "p-b", projectCode: "PRJB", payMode: "MONEY_IF_KPI", credits: 4, qty: 4 }),
    entry({ businessDay: "2026-10-03", credits: 0.1, qty: 1 }),
    entry({ businessDay: "2026-10-03", credits: 0.2, qty: 1 })
  ];

  it("splits official points (POINTS, worker + QC) from Khoán credits and provisional money", () => {
    expect(totals(entries)).toEqual({ pointsOfficial: 29.3, pointsKhoan: 34, moneyKhoanProvisional: 150000, qtyKhoan: 14, qcPoints: 5 });
  });

  it("groups by day (gaps filled inside the range) and by project", () => {
    const summary = summarize(entries, { from: "2026-09-30", to: "2026-10-03" });
    expect(summary.byDay).toEqual([
      { day: "2026-09-30", pointsOfficial: 0, pointsKhoan: 0 },
      { day: "2026-10-01", pointsOfficial: 30, pointsKhoan: 30 },
      { day: "2026-10-02", pointsOfficial: 0, pointsKhoan: 0 },
      { day: "2026-10-03", pointsOfficial: -0.7, pointsKhoan: 4 }
    ]);
    expect(summary.byProject).toEqual([
      { projectId: "p-a", projectCode: "PRJA", pointsOfficial: 29.3, pointsKhoan: 30, qty: 20 },
      { projectId: "p-b", projectCode: "PRJB", pointsOfficial: 0, pointsKhoan: 4, qty: 4 }
    ]);
    expect(summary.pointsOfficial).toBe(29.3);
  });

  it("empty input", () => {
    expect(summarize([])).toEqual({
      pointsOfficial: 0,
      pointsKhoan: 0,
      moneyKhoanProvisional: 0,
      qtyKhoan: 0,
      qcPoints: 0,
      byDay: [],
      byProject: []
    });
  });
});

describe("forecast (SPEC §5.3)", () => {
  it("remaining, days left to the close day (today included), average needed per day", () => {
    const result = forecast({ target: 2600, pointsOfficial: 1000, period: "2026-10", closeDay: 25, today: "2026-10-09", prorateLeave: false, leaveDays: null });
    expect(result).toMatchObject({
      from: "2026-09-26",
      to: "2026-10-25",
      target: 2600,
      targetBase: 2600,
      remaining: 1600,
      daysLeft: 17,
      avgPerDayNeeded: 94.12,
      percent: 38.46
    });
    // 2026-10-09..25 has 14 Monday–Saturday days (11, 18 and 25 are Sundays).
    expect(result.workingDaysLeft).toBe(14);
  });

  it("met target → remaining 0, tone MET", () => {
    const result = forecast({ target: 100, pointsOfficial: 120, period: "2026-10", closeDay: 25, today: "2026-10-09", prorateLeave: false, leaveDays: null });
    expect(result).toMatchObject({ remaining: 0, avgPerDayNeeded: 0, tone: "MET", percent: 120 });
  });

  it("closed period → no days left, no daily average; future period → whole period", () => {
    const past = forecast({ target: 100, pointsOfficial: 80, period: "2026-09", closeDay: 25, today: "2026-10-09", prorateLeave: false, leaveDays: null });
    expect(past).toMatchObject({ daysLeft: 0, workingDaysLeft: 0, avgPerDayNeeded: null, remaining: 20, tone: "BEHIND" });
    const future = forecast({ target: 300, pointsOfficial: 0, period: "2026-11", closeDay: 25, today: "2026-10-09", prorateLeave: false, leaveDays: null });
    expect(future).toMatchObject({ daysLeft: 31, avgPerDayNeeded: 9.68, tone: "ON_TRACK" });
  });

  it("no target → nothing to forecast", () => {
    expect(forecast({ target: null, pointsOfficial: 50, period: "2026-10", closeDay: 25, today: "2026-10-09", prorateLeave: false, leaveDays: null })).toMatchObject({
      target: null,
      remaining: null,
      avgPerDayNeeded: null,
      percent: null,
      tone: "NO_TARGET"
    });
  });

  it("pace tones: on track / at risk / behind", () => {
    // Period 2026-10 (26/09–25/10); today 10/10 → 14 days behind us, 16 days left (today included).
    const at = (points: number) =>
      forecast({ target: 3100, pointsOfficial: points, period: "2026-10", closeDay: 25, today: "2026-10-10", prorateLeave: false, leaveDays: null }).tone;
    expect(at(1500)).toBe("ON_TRACK"); // 107.1/day so far vs 100/day needed
    expect(at(1400)).toBe("AT_RISK"); // 100/day so far vs 106.25/day needed (≥ 80 %)
    expect(at(900)).toBe("BEHIND"); // 64.3/day so far vs 137.5/day needed
  });

  it("leave proration only when the setting is on and leave days are known", () => {
    // The 2026-10 period (26/09–25/10) has 25 working days (Mon–Sat).
    expect(countWorkingDays("2026-09-26", "2026-10-25")).toBe(25);
    const off = forecast({ target: 2600, pointsOfficial: 0, period: "2026-10", closeDay: 25, today: "2026-10-09", prorateLeave: false, leaveDays: 2 });
    expect(off.target).toBe(2600);
    const unknown = forecast({ target: 2600, pointsOfficial: 0, period: "2026-10", closeDay: 25, today: "2026-10-09", prorateLeave: true, leaveDays: null });
    expect(unknown.target).toBe(2600);
    const on = forecast({ target: 2600, pointsOfficial: 0, period: "2026-10", closeDay: 25, today: "2026-10-09", prorateLeave: true, leaveDays: 5 });
    expect(on).toMatchObject({ targetBase: 2600, target: 2080, remaining: 2080, prorateLeave: true, leaveDays: 5 });
    expect(prorateTarget(2600, 25, 30)).toBe(0);
    expect(prorateTarget(2600, 0, 0)).toBe(2600);
  });
});

describe("KPI percent by MONTH / QUARTER / YEAR", () => {
  const targets = [
    { periodType: "MONTH" as const, targetPoints: 2400, effectiveFrom: "2026-04" },
    { periodType: "MONTH" as const, targetPoints: 2600, effectiveFrom: "2026-10" },
    { periodType: "QUARTER" as const, targetPoints: 7000, effectiveFrom: "2026-07" }
  ];

  it("percentKpi", () => {
    expect(percentKpi(1300, 2600)).toBe(50);
    expect(percentKpi(1, 3)).toBe(33.33);
    expect(percentKpi(10, null)).toBeNull();
    expect(percentKpi(10, 0)).toBeNull();
  });

  it("effective target = latest version not after the period start", () => {
    expect(effectiveTarget(targets, "MONTH", "2026-03")).toBeNull();
    expect(effectiveTarget(targets, "MONTH", "2026-04")).toBe(2400);
    expect(effectiveTarget(targets, "MONTH", "2026-09")).toBe(2400);
    expect(effectiveTarget(targets, "MONTH", "2026-12")).toBe(2600);
    expect(effectiveTarget(targets, "QUARTER", "2026-08")).toBe(7000);
    expect(effectiveTarget(targets, "QUARTER", "2026-05")).toBeNull();
  });

  it("month, quarter (explicit target or sum of months) and year accumulate monthly periods", () => {
    const monthlyPoints = { "2026-10": 2000, "2026-11": 1900, "2026-08": 2500 };
    expect(kpiProgress({ periodType: "MONTH", period: "2026-10", monthlyPoints, targets })).toEqual({
      periodType: "MONTH",
      periods: ["2026-10"],
      points: 2000,
      target: 2600,
      percent: 76.92
    });
    // Q4 has no QUARTER version of its own: the one effective from Q3 (2026-07) still applies.
    expect(kpiProgress({ periodType: "QUARTER", period: "2026-11", monthlyPoints, targets })).toMatchObject({ points: 3900, target: 7000, percent: 55.71 });
    const monthOnly = targets.filter((target) => target.periodType === "MONTH");
    expect(kpiProgress({ periodType: "QUARTER", period: "2026-11", monthlyPoints, targets: monthOnly })).toMatchObject({ target: 7800, percent: 50 });
    // Year: Jan–Mar have no target; Apr–Sep 2400 × 6; Oct–Dec 2600 × 3.
    expect(kpiProgress({ periodType: "YEAR", period: "2026-11", monthlyPoints, targets: monthOnly })).toMatchObject({
      points: 6400,
      target: 22200,
      percent: 28.83
    });
    expect(kpiProgress({ periodType: "YEAR", period: "2025-11", monthlyPoints: {}, targets: monthOnly })).toMatchObject({ points: 0, target: null, percent: null });
  });
});

describe("rankByPoints", () => {
  it("ranks by official points, ties share a rank", () => {
    const ranked = rankByPoints([
      { id: "a", pointsOfficial: 10, name: "An" },
      { id: "b", pointsOfficial: 30, name: "Bình" },
      { id: "c", pointsOfficial: 10, name: "Chi" },
      { id: "d", pointsOfficial: 0, name: "Dũng" }
    ], (item) => item.name);
    expect(ranked.map((item) => [item.id, item.rank])).toEqual([
      ["b", 1],
      ["a", 2],
      ["c", 2],
      ["d", 4]
    ]);
  });
});

// Phase 6 — KPI settlement on the close day (SPEC §8, PLAN §6) ------------------------------------------

const base = { prorateLeave: false, workingDays: 25, leaveDays: 0 };

describe("settleUser (SPEC §8.6)", () => {
  it("target 100, official 120, Khoán 30 credits / 150 000 → met, money paid, nothing converted", () => {
    expect(settleUser({ ...base, targetBase: 100, pointsOfficial: 120, khoanCredits: 30, khoanMoneyRaw: 150000 })).toEqual({
      targetBase: 100,
      target: 100,
      prorateLeave: false,
      workingDays: 25,
      leaveDays: 0,
      pointsOfficial: 120,
      met: true,
      khoanCredits: 30,
      khoanMoneyRaw: 150000,
      khoanMoney: 150000,
      khoanPointsConverted: 0,
      totalPoints: 120,
      percent: 120,
      difference: 20
    });
  });

  it("target 100, official 80, Khoán 30 → not met, money 0, 30 converted, KPI total 110", () => {
    expect(settleUser({ ...base, targetBase: 100, pointsOfficial: 80, khoanCredits: 30, khoanMoneyRaw: 150000 })).toMatchObject({
      met: false,
      khoanMoney: 0,
      khoanPointsConverted: 30,
      totalPoints: 110,
      percent: 110,
      difference: 10
    });
  });

  it("no target → met (Khoán money paid)", () => {
    expect(settleUser({ ...base, targetBase: null, pointsOfficial: 0, khoanCredits: 12.5, khoanMoneyRaw: 40000 })).toMatchObject({
      target: null,
      met: true,
      khoanMoney: 40000,
      khoanPointsConverted: 0,
      totalPoints: 0,
      percent: null,
      difference: null
    });
  });

  it("exactly on target is met; official points only decide (Khoán credits never count toward 'met')", () => {
    expect(settleUser({ ...base, targetBase: 100, pointsOfficial: 100, khoanCredits: 0, khoanMoneyRaw: 0 }).met).toBe(true);
    expect(settleUser({ ...base, targetBase: 100, pointsOfficial: 99.99, khoanCredits: 50, khoanMoneyRaw: 1 }).met).toBe(false);
  });

  it("leave proration (Mon–Sat working days, half days allowed) only when enabled", () => {
    const prorated = settleUser({ targetBase: 2600, prorateLeave: true, workingDays: 25, leaveDays: 2.5, pointsOfficial: 2400, khoanCredits: 0, khoanMoneyRaw: 0 });
    expect(prorated).toMatchObject({ targetBase: 2600, target: 2340, met: true, leaveDays: 2.5 });
    expect(settleUser({ targetBase: 2600, prorateLeave: false, workingDays: 25, leaveDays: 2.5, pointsOfficial: 2400, khoanCredits: 0, khoanMoneyRaw: 0 })).toMatchObject({
      target: 2600,
      met: false
    });
  });
});

describe("settlePeriod", () => {
  const users = [
    { userId: "u1", targets: [{ periodType: "MONTH" as const, targetPoints: 100, effectiveFrom: "2026-05" }], pointsOfficial: 120, khoanCredits: 30, khoanMoneyRaw: 150000, leaveDays: 0 },
    { userId: "u2", targets: [{ periodType: "MONTH" as const, targetPoints: 100, effectiveFrom: "2026-11" }], pointsOfficial: 80, khoanCredits: 30, khoanMoneyRaw: 150000, leaveDays: 1 }
  ];

  it("uses the target effective for the period and the period's working days; re-running gives the same result", () => {
    const first = settlePeriod({ period: "2026-10", closeDay: 25, prorateLeave: false, users });
    expect(first).toMatchObject({ period: "2026-10", from: "2026-09-26", to: "2026-10-25", workingDays: 25 });
    expect(first.items.map((item) => [item.userId, item.target, item.met, item.khoanMoney])).toEqual([
      ["u1", 100, true, 150000],
      // u2's target only starts in 2026-11 → no target for 2026-10 → met.
      ["u2", null, true, 150000]
    ]);
    expect(settlePeriod({ period: "2026-10", closeDay: 25, prorateLeave: false, users })).toEqual(first);
  });

  it("prorates per user when the setting is on", () => {
    const result = settlePeriod({ period: "2026-11", closeDay: 25, prorateLeave: true, users });
    // 2026-11 = 26/10–25/11: 31 days, 4 Sundays (1, 8, 15, 22/11) → 27 working days; 1 leave day → 100 × 26/27.
    expect(result.workingDays).toBe(27);
    expect(result.items[1]).toMatchObject({ targetBase: 100, target: 96.3, met: false, khoanPointsConverted: 30, totalPoints: 110 });
  });
});

describe("settlement periods and the close-day schedule", () => {
  it("25/10 23:30 → period 10; 26/10 00:10 → period 11; close day 20 shifts the periods", () => {
    expect(periodMonth(new Date("2026-10-25T23:30:00+07:00"), 25)).toBe("2026-10-01");
    expect(periodMonth(new Date("2026-10-26T00:10:00+07:00"), 25)).toBe("2026-11-01");
    expect(periodMonth(new Date("2026-10-20T23:30:00+07:00"), 20)).toBe("2026-10-01");
    expect(periodMonth(new Date("2026-10-21T00:10:00+07:00"), 20)).toBe("2026-11-01");
    expect(periodMonth(new Date("2026-10-25T23:30:00+07:00"), 20)).toBe("2026-11-01");
    expect(periodRange("2026-11", 20)).toEqual({ from: "2026-10-21", to: "2026-11-20" });
  });

  it("a period closes at 23:59 business time on its close day", () => {
    expect(periodCloseInstant("2026-10", 25).toISOString()).toBe("2026-10-25T16:59:00.000Z");
    expect(latestClosedPeriod(new Date("2026-10-25T23:58:00+07:00"), 25)).toBe("2026-09");
    expect(latestClosedPeriod(new Date("2026-10-25T23:59:00+07:00"), 25)).toBe("2026-10");
    expect(latestClosedPeriod(new Date("2026-10-26T00:10:00+07:00"), 25)).toBe("2026-10");
    expect(latestClosedPeriod(new Date("2026-10-09T12:00:00+07:00"), 25)).toBe("2026-09");
    expect(latestClosedPeriod(new Date("2027-01-02T12:00:00+07:00"), 25)).toBe("2026-12");
  });

  it("automatic run: once the period closed, unless a run already happened after the close; catch-up within 7 days", () => {
    const close = periodCloseInstant("2026-10", 25);
    const at = (iso: string, hasFinalRun = false) => shouldAutoSettle({ now: new Date(iso), period: "2026-10", closeDay: 25, hasFinalRun });
    expect(at("2026-10-25T23:58:00+07:00")).toBe(false);
    expect(at("2026-10-25T23:59:00+07:00")).toBe(true);
    expect(at("2026-10-28T08:00:00+07:00")).toBe(true); // worker was down at 23:59 → catch up
    expect(at("2026-10-28T08:00:00+07:00", true)).toBe(false);
    expect(at(new Date(close.getTime() + 8 * 86_400_000).toISOString())).toBe(false);
  });
});

describe("KPI report rollups (quarter / year = sum of months)", () => {
  const months = [
    { period: "2026-10", target: 100, pointsOfficial: 120, khoanPointsConverted: 0, totalPoints: 120, khoanMoney: 150000 },
    { period: "2026-11", target: 100, pointsOfficial: 80, khoanPointsConverted: 30, totalPoints: 110, khoanMoney: 0 },
    { period: "2026-12", target: null, pointsOfficial: 10, khoanPointsConverted: 0, totalPoints: 10, khoanMoney: 5000 }
  ];

  it("keys", () => {
    expect(rollupKey("QUARTER", "2026-11")).toBe("2026-Q4");
    expect(rollupKey("YEAR", "2026-11")).toBe("2026");
  });

  it("explicit QUARTER/YEAR target wins, otherwise the sum of monthly targets", () => {
    expect(rollupKpi(months, 250)).toEqual({
      pointsOfficial: 210,
      khoanPointsConverted: 30,
      totalPoints: 240,
      khoanMoney: 155000,
      target: 250,
      percent: 96,
      difference: -10
    });
    expect(rollupKpi(months, null)).toMatchObject({ target: 200, percent: 120, difference: 40 });
    expect(rollupKpi([months[2]!], null)).toMatchObject({ target: null, percent: null, difference: null });
  });
});
