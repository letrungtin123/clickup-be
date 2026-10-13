import { describe, expect, it } from "vitest";

import {
  computeAdjustment,
  computeLineEntry,
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
  rollupKpiPeriod,
  rollupKey,
  lineScoreRole,
  settlePeriod,
  settleUser,
  shouldAutoSettle,
  summarize,
  sumKpiFigures,
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

describe("computeWorkerEntry / computeLineEntry (SPEC §5.6, PD-037)", () => {
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

  it("PRJA Checking line of 10 images, official shift → QC 5.00 credits, POINTS (PD-037)", () => {
    expect(computeLineEntry({ role: "QC", rule: prjaChecking, qtyDone: 10, payMode: "POINTS", kind: "NORMAL" })).toEqual({
      role: "QC",
      payMode: "POINTS",
      creditRuleId: "rule-prja-checking",
      qty: 10,
      unitCredits: 0.5,
      unitMoney: 0,
      credits: 5,
      money: 0
    });
  });

  it("a Checking line follows its shift like a work line: Khoán points on a Khoán shift, money only if priced", () => {
    expect(computeLineEntry({ role: "QC", rule: prjaChecking, qtyDone: 10, payMode: "MONEY_IF_KPI", kind: "NORMAL" })).toMatchObject({
      role: "QC",
      payMode: "MONEY_IF_KPI",
      credits: 5,
      money: 0
    });
    expect(computeLineEntry({ role: "QC", rule: { ...prjaChecking, moneyPerImage: 1000 }, qtyDone: 10, payMode: "MONEY_IF_KPI", kind: "NORMAL" }).money).toBe(10000);
    // Khoán Checking credits stay outside the official total, like the Excel.
    const khoan = computeLineEntry({ role: "QC", rule: prjaChecking, qtyDone: 10, payMode: "MONEY_IF_KPI", kind: "NORMAL" });
    expect(totals([{ businessDay: "2026-10-12", role: "QC", payMode: khoan.payMode, credits: khoan.credits, money: khoan.money, qty: 10, projectId: "p", projectCode: "PRJA" }])).toMatchObject({
      pointsOfficial: 0,
      pointsKhoan: 5,
      qtyKhoan: 10,
      qcPoints: 0
    });
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
    expect(computeLineEntry({ role: "QC", rule: prjaChecking, qtyDone: 5, payMode: "POINTS", kind: "FB_WRONG" })).toMatchObject({ qty: 5, credits: 0, money: 0 });
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
    expect(computeLineEntry({ role: "QC", rule: null, qtyDone: 7, payMode: "POINTS", kind: "NORMAL" })).toMatchObject({ creditRuleId: null, credits: 0 });
  });

  it("keeps exact 2-decimal credits (no float drift)", () => {
    const entry = computeWorkerEntry({ rule: { id: "r", creditPerImage: 1.48, moneyPerImage: 9000 }, qtyDone: 3, payMode: "POINTS", kind: "NORMAL" });
    expect(entry.credits).toBe(4.44);
    expect(computeWorkerEntry({ rule: { id: "r", creditPerImage: 0.1, moneyPerImage: null }, qtyDone: 3, payMode: "POINTS", kind: "NORMAL" }).credits).toBe(0.3);
  });
});

describe("lineScoreRole — the role of a line's entry (PD-037)", () => {
  it("a Checking line (QC process) records QC; any other line WORKER", () => {
    expect(lineScoreRole(true)).toBe("QC");
    expect(lineScoreRole(false)).toBe("WORKER");
  });
});

describe("computeAdjustment — Leader edits qty after Done (SPEC §5.2)", () => {
  it("qty 10 → 8: −6.00 WORKER credits, −1.00 QC credits", () => {
    const worker = computeWorkerEntry({ rule: prjaNormal, qtyDone: 10, payMode: "POINTS", kind: "NORMAL" });
    const qc = computeLineEntry({ role: "QC", rule: prjaChecking, qtyDone: 10, payMode: "POINTS", kind: "NORMAL" });
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
      // Every entry is the person's own line since PD-037, so the Checking line's images count too.
      { projectId: "p-a", projectCode: "PRJA", pointsOfficial: 29.3, pointsKhoan: 30, qty: 30 },
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
const ifKpi = { ...base, khoanPolicy: "IF_KPI" as const };
const always = { ...base, khoanPolicy: "ALWAYS" as const };

describe("settleUser — policy IF_KPI: Khoán paid only when the KPI is met (SPEC §8.6)", () => {
  it("target 100, official 120, Khoán 30 credits / 150 000 → met, money paid, nothing converted", () => {
    expect(settleUser({ ...ifKpi, targetBase: 100, pointsOfficial: 120, khoanCredits: 30, khoanMoneyRaw: 150000 })).toEqual({
      targetBase: 100,
      target: 100,
      prorateLeave: false,
      workingDays: 25,
      leaveDays: 0,
      pointsOfficial: 120,
      met: true,
      khoanCredits: 30,
      khoanMoneyRaw: 150000,
      khoanPolicy: "IF_KPI",
      khoanMoney: 150000,
      khoanPointsConverted: 0,
      totalPoints: 120,
      percent: 120,
      difference: 20
    });
  });

  it("target 100, official 80, Khoán 30 → not met, money 0, 30 converted, KPI total 110", () => {
    expect(settleUser({ ...ifKpi, targetBase: 100, pointsOfficial: 80, khoanCredits: 30, khoanMoneyRaw: 150000 })).toMatchObject({
      met: false,
      khoanMoney: 0,
      khoanPointsConverted: 30,
      totalPoints: 110,
      percent: 110,
      difference: 10
    });
  });

  it("no target → met (Khoán money paid)", () => {
    expect(settleUser({ ...ifKpi, targetBase: null, pointsOfficial: 0, khoanCredits: 12.5, khoanMoneyRaw: 40000 })).toMatchObject({
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
    expect(settleUser({ ...ifKpi, targetBase: 100, pointsOfficial: 100, khoanCredits: 0, khoanMoneyRaw: 0 }).met).toBe(true);
    expect(settleUser({ ...ifKpi, targetBase: 100, pointsOfficial: 99.99, khoanCredits: 50, khoanMoneyRaw: 1 }).met).toBe(false);
  });

  it("leave proration (Mon–Sat working days, half days allowed) only when enabled", () => {
    const prorated = settleUser({ ...ifKpi, targetBase: 2600, prorateLeave: true, leaveDays: 2.5, pointsOfficial: 2400, khoanCredits: 0, khoanMoneyRaw: 0 });
    expect(prorated).toMatchObject({ targetBase: 2600, target: 2340, met: true, leaveDays: 2.5 });
    expect(settleUser({ ...ifKpi, targetBase: 2600, leaveDays: 2.5, pointsOfficial: 2400, khoanCredits: 0, khoanMoneyRaw: 0 })).toMatchObject({
      target: 2600,
      met: false
    });
  });
});

describe("settleUser — policy ALWAYS: Khoán money always paid, like the Excel (PD-033)", () => {
  it("not met → the money is still paid, nothing is converted, the KPI total is the official points", () => {
    expect(settleUser({ ...always, targetBase: 100, pointsOfficial: 80, khoanCredits: 30, khoanMoneyRaw: 150000 })).toEqual({
      targetBase: 100,
      target: 100,
      prorateLeave: false,
      workingDays: 25,
      leaveDays: 0,
      pointsOfficial: 80,
      met: false,
      khoanCredits: 30,
      khoanMoneyRaw: 150000,
      khoanPolicy: "ALWAYS",
      khoanMoney: 150000,
      khoanPointsConverted: 0,
      totalPoints: 80,
      percent: 80,
      difference: -20
    });
  });

  it("met, or no target → money paid, nothing converted (same as IF_KPI)", () => {
    const met = { targetBase: 100, pointsOfficial: 120, khoanCredits: 30, khoanMoneyRaw: 150000 };
    expect(settleUser({ ...always, ...met })).toEqual({ ...settleUser({ ...ifKpi, ...met }), khoanPolicy: "ALWAYS" });
    expect(settleUser({ ...always, targetBase: null, pointsOfficial: 0, khoanCredits: 12.5, khoanMoneyRaw: 40000 })).toMatchObject({
      met: true,
      khoanMoney: 40000,
      khoanPointsConverted: 0,
      totalPoints: 0
    });
  });

  it("met = official points (Chính thức + OT + QC) ≥ target: Khoán credits never help, even when they would reach it", () => {
    const result = settleUser({ ...always, targetBase: 100, pointsOfficial: 99.99, khoanCredits: 500, khoanMoneyRaw: 2_500_000 });
    expect(result).toMatchObject({ met: false, khoanMoney: 2_500_000, khoanPointsConverted: 0, totalPoints: 99.99, percent: 99.99, difference: -0.01 });
    expect(settleUser({ ...always, targetBase: 100, pointsOfficial: 100, khoanCredits: 0, khoanMoneyRaw: 0 }).met).toBe(true);
  });

  it("leave proration applies the same way", () => {
    expect(settleUser({ ...always, targetBase: 2600, prorateLeave: true, leaveDays: 2.5, pointsOfficial: 2300, khoanCredits: 10, khoanMoneyRaw: 50000 })).toMatchObject({
      target: 2340,
      met: false,
      khoanMoney: 50000,
      khoanPointsConverted: 0,
      totalPoints: 2300
    });
  });

  it("the two policies differ only for people who miss the KPI with Khoán work", () => {
    const cases = [
      { targetBase: 100, pointsOfficial: 120, khoanCredits: 30, khoanMoneyRaw: 150000 },
      { targetBase: null, pointsOfficial: 5, khoanCredits: 30, khoanMoneyRaw: 150000 },
      { targetBase: 100, pointsOfficial: 40, khoanCredits: 0, khoanMoneyRaw: 0 },
      { targetBase: 100, pointsOfficial: 40, khoanCredits: 30, khoanMoneyRaw: 150000 }
    ];
    const differs = cases.map((input) => {
      const a = settleUser({ ...always, ...input });
      const b = settleUser({ ...ifKpi, ...input });
      return a.met === b.met && (a.khoanMoney !== b.khoanMoney || a.totalPoints !== b.totalPoints);
    });
    expect(differs).toEqual([false, false, false, true]);
  });
});

describe("settlePeriod", () => {
  const users = [
    { userId: "u1", targets: [{ periodType: "MONTH" as const, targetPoints: 100, effectiveFrom: "2026-05" }], pointsOfficial: 120, khoanCredits: 30, khoanMoneyRaw: 150000, leaveDays: 0 },
    { userId: "u2", targets: [{ periodType: "MONTH" as const, targetPoints: 100, effectiveFrom: "2026-11" }], pointsOfficial: 80, khoanCredits: 30, khoanMoneyRaw: 150000, leaveDays: 1 }
  ];

  it("uses the target effective for the period and the period's working days; re-running gives the same result", () => {
    const first = settlePeriod({ period: "2026-10", closeDay: 25, prorateLeave: false, khoanPolicy: "IF_KPI", users });
    expect(first).toMatchObject({ period: "2026-10", from: "2026-09-26", to: "2026-10-25", workingDays: 25 });
    expect(first.items.map((item) => [item.userId, item.target, item.met, item.khoanMoney])).toEqual([
      ["u1", 100, true, 150000],
      // u2's target only starts in 2026-11 → no target for 2026-10 → met.
      ["u2", null, true, 150000]
    ]);
    expect(settlePeriod({ period: "2026-10", closeDay: 25, prorateLeave: false, khoanPolicy: "IF_KPI", users })).toEqual(first);
  });

  it("prorates per user when the setting is on", () => {
    const result = settlePeriod({ period: "2026-11", closeDay: 25, prorateLeave: true, khoanPolicy: "IF_KPI", users });
    // 2026-11 = 26/10–25/11: 31 days, 4 Sundays (1, 8, 15, 22/11) → 27 working days; 1 leave day → 100 × 26/27.
    expect(result.workingDays).toBe(27);
    expect(result.items[1]).toMatchObject({ targetBase: 100, target: 96.3, met: false, khoanPointsConverted: 30, totalPoints: 110 });
  });

  it("passes the Khoán pay policy to every person: re-running with the other policy changes only the not-met rows", () => {
    const ifKpiRun = settlePeriod({ period: "2026-11", closeDay: 25, prorateLeave: true, khoanPolicy: "IF_KPI", users });
    const alwaysRun = settlePeriod({ period: "2026-11", closeDay: 25, prorateLeave: true, khoanPolicy: "ALWAYS", users });
    expect(alwaysRun.items.every((item) => item.khoanPolicy === "ALWAYS")).toBe(true);
    expect(alwaysRun.items[0]).toEqual({ ...ifKpiRun.items[0], khoanPolicy: "ALWAYS" });
    expect(alwaysRun.items[1]).toMatchObject({ met: false, khoanMoney: 150000, khoanPointsConverted: 0, totalPoints: 80 });
    expect(ifKpiRun.items[1]).toMatchObject({ met: false, khoanMoney: 0, khoanPointsConverted: 30, totalPoints: 110 });
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

describe("G15 — changing the close day mid-period: a new close day applies from the next period", () => {
  // 25 until 10/2026; on 2026-10-11 the Admin sets 20 → version from 2026-11 (catalog.service scheduleCloseDay).
  const versions = [
    { fromPeriod: null, closeDay: 25 },
    { fromPeriod: "2026-11", closeDay: 20 }
  ];

  it("the current period keeps its boundaries, the next ones follow the new day", () => {
    expect(periodRange("2026-10", versions)).toEqual({ from: "2026-09-26", to: "2026-10-25" });
    expect(periodRange("2026-11", versions)).toEqual({ from: "2026-10-26", to: "2026-11-20" });
    expect(periodRange("2026-12", versions)).toEqual({ from: "2026-11-21", to: "2026-12-20" });
  });

  it("every day belongs to exactly one period (no overlap, no gap), also when the day moves back up", () => {
    const schedules = [versions, [{ fromPeriod: null, closeDay: 20 }, { fromPeriod: "2026-11", closeDay: 28 }, { fromPeriod: "2027-02", closeDay: 5 }]];
    for (const schedule of schedules) {
      let expectedFrom = periodRange("2026-01", schedule).from;
      for (let period = "2026-01"; period <= "2027-12"; period = `${Number(period.slice(0, 4)) + (period.endsWith("12") ? 1 : 0)}-${String((Number(period.slice(5)) % 12) + 1).padStart(2, "0")}`) {
        const range = periodRange(period, schedule);
        expect(range.from).toBe(expectedFrom);
        for (const day of [range.from, range.to]) {
          expect(periodOfDay(day, schedule)).toBe(period);
        }
        const next = new Date(`${range.to}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        expectedFrom = next.toISOString().slice(0, 10);
      }
    }
  });

  it("entries, close instants and the latest closed period use the period's own close day", () => {
    expect(periodOfDay("2026-10-21", versions)).toBe("2026-10");
    expect(periodOfDay("2026-10-26", versions)).toBe("2026-11");
    expect(periodOfDay("2026-11-21", versions)).toBe("2026-12");
    expect(periodMonth(new Date("2026-11-20T16:30:00Z"), versions)).toBe("2026-11-01"); // 23:30 VN on the 20th
    expect(periodCloseInstant("2026-10", versions).toISOString()).toBe("2026-10-25T16:59:00.000Z");
    expect(periodCloseInstant("2026-11", versions).toISOString()).toBe("2026-11-20T16:59:00.000Z");
    expect(latestClosedPeriod(new Date("2026-11-20T17:00:00Z"), versions)).toBe("2026-11");
    expect(latestClosedPeriod(new Date("2026-11-20T16:00:00Z"), versions)).toBe("2026-10");
    expect(shouldAutoSettle({ now: new Date("2026-11-20T17:00:00Z"), period: "2026-11", closeDay: versions, hasFinalRun: false })).toBe(true);
  });

  it("settlement and forecast cover the period's own days", () => {
    expect(settlePeriod({ period: "2026-11", closeDay: versions, prorateLeave: false, khoanPolicy: "ALWAYS", users: [] })).toMatchObject({
      from: "2026-10-26",
      to: "2026-11-20"
    });
    const result = forecast({ target: 100, pointsOfficial: 0, period: "2026-11", closeDay: versions, today: "2026-11-20", prorateLeave: false, leaveDays: null });
    expect(result).toMatchObject({ from: "2026-10-26", to: "2026-11-20", daysLeft: 1 });
  });
});

describe("PD-032 — close day 31 “Cuối tháng”: a period is the calendar month", () => {
  it("February in a non-leap and a leap year, 30- and 31-day months, across the year end", () => {
    expect(periodRange("2026-02", 31)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange("2026-03", 31)).toEqual({ from: "2026-03-01", to: "2026-03-31" });
    expect(periodRange("2028-02", 31)).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(periodRange("2028-03", 31)).toEqual({ from: "2028-03-01", to: "2028-03-31" });
    expect(periodRange("2026-04", 31)).toEqual({ from: "2026-04-01", to: "2026-04-30" });
    expect(periodRange("2026-05", 31)).toEqual({ from: "2026-05-01", to: "2026-05-31" });
    expect(periodRange("2026-12", 31)).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(periodRange("2027-01", 31)).toEqual({ from: "2027-01-01", to: "2027-01-31" });
  });

  it("every day stays in its own month, last days included", () => {
    expect(periodOfDay("2026-02-01", 31)).toBe("2026-02");
    expect(periodOfDay("2026-02-28", 31)).toBe("2026-02");
    expect(periodOfDay("2028-02-29", 31)).toBe("2028-02");
    expect(periodOfDay("2026-03-01", 31)).toBe("2026-03");
    expect(periodOfDay("2026-04-30", 31)).toBe("2026-04");
    expect(periodOfDay("2026-10-31", 31)).toBe("2026-10");
    expect(periodOfDay("2026-12-31", 31)).toBe("2026-12");
    expect(periodMonth(new Date("2026-10-31T23:30:00+07:00"), 31)).toBe("2026-10-01");
    expect(periodMonth(new Date("2026-11-01T00:10:00+07:00"), 31)).toBe("2026-11-01");
  });

  it("25 until 09/2026, then 31: 10/2026 = 26/09–31/10, then calendar months", () => {
    const versions = [
      { fromPeriod: null, closeDay: 25 },
      { fromPeriod: "2026-10", closeDay: 31 }
    ];
    expect(periodRange("2026-09", versions)).toEqual({ from: "2026-08-26", to: "2026-09-25" });
    expect(periodRange("2026-10", versions)).toEqual({ from: "2026-09-26", to: "2026-10-31" });
    expect(periodRange("2026-11", versions)).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(periodRange("2027-02", versions)).toEqual({ from: "2027-02-01", to: "2027-02-28" });
    expect(periodOfDay("2026-09-25", versions)).toBe("2026-09");
    expect(periodOfDay("2026-09-26", versions)).toBe("2026-10");
    expect(periodOfDay("2026-10-31", versions)).toBe("2026-10");
    expect(periodOfDay("2026-11-01", versions)).toBe("2026-11");
  });

  it("31 until 10/2026, then 25: 11/2026 = 01/11–25/11, 12/2026 = 26/11–25/12", () => {
    const versions = [
      { fromPeriod: null, closeDay: 31 },
      { fromPeriod: "2026-11", closeDay: 25 }
    ];
    expect(periodRange("2026-10", versions)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodRange("2026-11", versions)).toEqual({ from: "2026-11-01", to: "2026-11-25" });
    expect(periodRange("2026-12", versions)).toEqual({ from: "2026-11-26", to: "2026-12-25" });
    expect(periodOfDay("2026-11-25", versions)).toBe("2026-11");
    expect(periodOfDay("2026-11-26", versions)).toBe("2026-12");
  });

  it("no overlap, no gap when 31 alternates with other days (leap February included)", () => {
    const schedule = [
      { fromPeriod: null, closeDay: 25 },
      { fromPeriod: "2026-10", closeDay: 31 },
      { fromPeriod: "2027-03", closeDay: 20 },
      { fromPeriod: "2027-06", closeDay: 31 },
      { fromPeriod: "2028-03", closeDay: 28 }
    ];
    let expectedFrom = periodRange("2026-01", schedule).from;
    for (let period = "2026-01"; period <= "2028-12"; period = `${Number(period.slice(0, 4)) + (period.endsWith("12") ? 1 : 0)}-${String((Number(period.slice(5)) % 12) + 1).padStart(2, "0")}`) {
      const range = periodRange(period, schedule);
      expect(range.from).toBe(expectedFrom);
      expect(range.to <= `${period}-31` && range.to.startsWith(period)).toBe(true);
      for (const day of [range.from, range.to]) {
        expect(periodOfDay(day, schedule)).toBe(period);
      }
      const next = new Date(`${range.to}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      expectedFrom = next.toISOString().slice(0, 10);
    }
    expect(periodRange("2028-02", schedule)).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(periodRange("2028-03", schedule)).toEqual({ from: "2028-03-01", to: "2028-03-28" });
  });

  it("the period closes at 23:59 on the month's last day: that is when the scheduler settles it", () => {
    expect(periodCloseInstant("2026-02", 31).toISOString()).toBe("2026-02-28T16:59:00.000Z");
    expect(periodCloseInstant("2028-02", 31).toISOString()).toBe("2028-02-29T16:59:00.000Z");
    expect(periodCloseInstant("2026-04", 31).toISOString()).toBe("2026-04-30T16:59:00.000Z");
    expect(periodCloseInstant("2026-10", 31).toISOString()).toBe("2026-10-31T16:59:00.000Z");
    expect(latestClosedPeriod(new Date("2026-04-30T23:58:00+07:00"), 31)).toBe("2026-03");
    expect(latestClosedPeriod(new Date("2026-04-30T23:59:00+07:00"), 31)).toBe("2026-04");
    expect(latestClosedPeriod(new Date("2026-05-02T08:00:00+07:00"), 31)).toBe("2026-04");
    const at = (iso: string, period: string) => shouldAutoSettle({ now: new Date(iso), period, closeDay: 31, hasFinalRun: false });
    expect(at("2026-02-28T23:58:00+07:00", "2026-02")).toBe(false);
    expect(at("2026-02-28T23:59:00+07:00", "2026-02")).toBe(true);
    expect(at("2026-10-31T23:59:00+07:00", "2026-10")).toBe(true);
    expect(at("2026-10-30T23:59:00+07:00", "2026-10")).toBe(false);
  });

  it("forecast: days left run to the month's last day", () => {
    const february = forecast({ target: 100, pointsOfficial: 0, period: "2026-02", closeDay: 31, today: "2026-02-20", prorateLeave: false, leaveDays: null });
    expect(february).toMatchObject({ from: "2026-02-01", to: "2026-02-28", daysLeft: 9 });
    const april = forecast({ target: 100, pointsOfficial: 0, period: "2026-04", closeDay: 31, today: "2026-04-30", prorateLeave: false, leaveDays: null });
    expect(april).toMatchObject({ to: "2026-04-30", daysLeft: 1 });
    expect(settlePeriod({ period: "2028-02", closeDay: 31, prorateLeave: false, khoanPolicy: "ALWAYS", users: [] })).toMatchObject({
      from: "2028-02-01",
      to: "2028-02-29",
      workingDays: 25
    });
  });
});

describe("G8 — KPI report quarters / years always cover the whole quarter / year", () => {
  const month = (period: string, target: number | null, totalPoints: number) => ({
    period,
    target,
    pointsOfficial: totalPoints,
    khoanPointsConverted: 0,
    totalPoints,
    khoanMoney: 0
  });
  const started = (period: string) => period <= "2026-10";
  const settled = (period: string) => period <= "2026-09";

  it("a quarter sums its months (also those outside the selected range) against the sum of all its monthly targets", () => {
    const q3 = rollupKpiPeriod({
      periodType: "QUARTER",
      period: "2026-08",
      months: [month("2026-07", 100, 90), month("2026-08", 100, 120), month("2026-09", 110, 100)],
      monthTargets: [],
      explicitTarget: null,
      started,
      settled
    });
    expect(q3).toMatchObject({ key: "2026-Q3", periods: ["2026-07", "2026-08", "2026-09"], target: 310, totalPoints: 310, percent: 100, complete: true, settled: true });
  });

  it("a running quarter: months not started yet count their effective MONTH target; complete / settled are false", () => {
    const q4 = rollupKpiPeriod({
      periodType: "QUARTER",
      period: "2026-10",
      months: [month("2026-10", 120, 60)],
      monthTargets: [{ periodType: "MONTH", targetPoints: 120, effectiveFrom: "2026-10" }],
      explicitTarget: null,
      started,
      settled
    });
    expect(q4).toMatchObject({ periods: ["2026-10"], target: 360, totalPoints: 60, complete: false, settled: false });
    const explicit = rollupKpiPeriod({ periodType: "QUARTER", period: "2026-10", months: [month("2026-10", 120, 60)], monthTargets: [], explicitTarget: 300, started, settled });
    expect(explicit).toMatchObject({ target: 300, percent: 20 });
  });

  it("team / organization totals sum the people; percent = total / target; money only when visible", () => {
    const totalsRow = sumKpiFigures([
      { target: 100, pointsOfficial: 120, khoanPointsConverted: 0, totalPoints: 120, khoanMoney: 150000, met: true, percent: 120 },
      { target: 100, pointsOfficial: 80, khoanPointsConverted: 30, totalPoints: 110, khoanMoney: 0, met: false, percent: 110 },
      { target: null, pointsOfficial: 5, khoanPointsConverted: 0, totalPoints: 5, khoanMoney: 0, met: true, percent: null }
    ]);
    expect(totalsRow).toEqual({
      memberCount: 3,
      withTargetCount: 2,
      metCount: 2,
      target: 200,
      pointsOfficial: 205,
      khoanPointsConverted: 30,
      totalPoints: 235,
      percent: 117.5,
      difference: 35,
      khoanMoney: 150000
    });
    expect(sumKpiFigures([{ target: null, pointsOfficial: 1, khoanPointsConverted: 0, totalPoints: 1, khoanMoney: null, percent: null }])).toMatchObject({
      target: null,
      percent: null,
      khoanMoney: null,
      metCount: 1
    });
  });
});
