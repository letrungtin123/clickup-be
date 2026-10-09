import { describe, expect, it } from "vitest";

import { ReportConfigSchema, reportRowLimit, type ReportConfig } from "../../contracts/production-reports.js";
import type { AccessContext } from "../access/access-context.js";
import { assertReportAllowed, assertWhitelisted, buildReportQuery, mapReportRows, presetRange, resolveReportRange, timeLabel } from "./reports.js";

const org = "11111111-1111-4111-8111-111111111111";
const userA = "22222222-2222-4222-8222-222222222222";
const team = "33333333-3333-4333-8333-333333333333";
const tag = "44444444-4444-4444-8444-444444444444";
const config = (input: unknown): ReportConfig => ReportConfigSchema.parse(input);
const build = (input: unknown, range = { from: "2026-09-26", to: "2026-10-25" }) =>
  buildReportQuery(config(input), { organizationId: org, ...range, closeDay: 25 });

const contextWith = (roles: string[], full = false) =>
  ({
    user: { id: userA },
    organization: { id: org },
    hasFullOrganizationAuthority: full,
    productionRoles: roles
  }) as unknown as AccessContext;

const errorCode = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return { code: (error as { code?: string }).code, status: (error as { statusCode?: number }).statusCode };
  }
  return null;
};

describe("report config whitelist", () => {
  it("rejects unknown dimensions, measures, filters and sort keys in the contract", () => {
    expect(ReportConfigSchema.safeParse({ dimensions: ["user; DROP TABLE x"], measures: ["points"] }).success).toBe(false);
    expect(ReportConfigSchema.safeParse({ dimensions: ["user"], measures: ["credits"] }).success).toBe(false);
    expect(ReportConfigSchema.safeParse({ measures: ["points"], filters: { email: ["x"] } }).success).toBe(false);
    expect(ReportConfigSchema.safeParse({ measures: ["points"], filters: { user: ["not-a-uuid"] } }).success).toBe(false);
    expect(ReportConfigSchema.safeParse({ measures: ["points"], sort: { key: "fb_rate" } }).success).toBe(false);
    expect(ReportConfigSchema.safeParse({ measures: ["points"], extra: 1 }).success).toBe(false);
    expect(ReportConfigSchema.safeParse({ measures: [] }).success).toBe(false);
  });

  it("rejects duplicates, half ranges, preset + range, reversed ranges and stray view dimensions", () => {
    expect(ReportConfigSchema.safeParse({ dimensions: ["user", "user"], measures: ["points"] }).success).toBe(false);
    expect(ReportConfigSchema.safeParse({ measures: ["points", "points"] }).success).toBe(false);
    expect(ReportConfigSchema.safeParse({ measures: ["points"], from: "2026-10-01" }).success).toBe(false);
    expect(ReportConfigSchema.safeParse({ measures: ["points"], preset: "TODAY", from: "2026-10-01", to: "2026-10-02" }).success).toBe(false);
    expect(ReportConfigSchema.safeParse({ measures: ["points"], from: "2026-10-02", to: "2026-10-01" }).success).toBe(false);
    expect(ReportConfigSchema.safeParse({ dimensions: ["user"], measures: ["points"], view: { rows: ["team"] } }).success).toBe(false);
    expect(ReportConfigSchema.safeParse({ measures: ["points"], limit: reportRowLimit + 1 }).success).toBe(false);
  });

  it("the builder re-checks every name even if the contract was bypassed", () => {
    const bad = (patch: Partial<Record<keyof ReportConfig, unknown>>) =>
      errorCode(() => assertWhitelisted({ dimensions: [], measures: ["points"], filters: {}, ...patch } as unknown as ReportConfig));
    expect(bad({ dimensions: ["email"] })).toEqual({ code: "REPORT_INVALID", status: 400 });
    expect(bad({ measures: ["1;DROP TABLE production.tasks"] })).toEqual({ code: "REPORT_INVALID", status: 400 });
    expect(bad({ measures: [] })).toEqual({ code: "REPORT_INVALID", status: 400 });
    expect(bad({ filters: { "t.id": ["x"] } })).toEqual({ code: "REPORT_INVALID", status: 400 });
    expect(bad({ sort: { key: "credits", direction: "desc" } })).toEqual({ code: "REPORT_INVALID", status: 400 });
    expect(bad({ dimensions: ["user"], sort: { key: "user", direction: "desc; DROP" } })).toEqual({ code: "REPORT_INVALID", status: 400 });
    expect(bad({ dimensions: ["user", "user"] })).toEqual({ code: "REPORT_INVALID", status: 400 });
    expect(bad({})).toBeNull();
  });
});

describe("report SQL builder", () => {
  it("binds every value: ids, dates and the organization never appear in the SQL text", () => {
    const query = build({ dimensions: ["user"], measures: ["points", "task_count"], filters: { user: [userA], team: [team], tag: [tag] } });
    for (const value of [org, userA, team, tag, "2026-09-26", "2026-10-25"]) {
      expect(query.text).not.toContain(value);
    }
    expect(query.params).toContain(org);
    expect(query.params).toContainEqual([userA]);
    expect(query.params).toContainEqual([team]);
    expect(query.params).toContainEqual([tag]);
    expect(query.text).toMatch(/e\.user_id = ANY\(\$\d+::uuid\[\]\)/);
    expect(query.text).toMatch(/t\.assignee_id = ANY\(\$\d+::uuid\[\]\)/);
    // Every placeholder has a parameter and vice versa.
    const placeholders = new Set([...query.text.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])));
    expect(Math.max(...placeholders)).toBe(query.params.length);
    expect(placeholders.size).toBe(query.params.length);
  });

  it("combination 1 — scores only: user × points / Khoán points / Khoán money", () => {
    const query = build({ dimensions: ["user"], measures: ["points", "points_khoan", "money_khoan"] });
    expect(query.sources).toEqual(["SCORES"]);
    expect(query.text).toContain("FROM production.score_entries e");
    expect(query.text).not.toContain("FROM production.tasks t");
    expect(query.text).toContain("e.business_day BETWEEN $2::date AND $3::date");
    expect(query.text).toContain("sum(f.credits) FILTER (WHERE f.pay_mode = 'POINTS')");
    expect(query.text).toContain("sum(f.credits) FILTER (WHERE f.pay_mode = 'MONEY_IF_KPI')");
    expect(query.text).toContain("sum(f.money) FILTER (WHERE f.pay_mode = 'MONEY_IF_KPI')");
    expect(query.text).toContain("GROUP BY GROUPING SETS ((f.d0), ())");
    expect(query.text).toContain("LEFT JOIN public.app_users l0 ON l0.id = r.d0");
    expect(query.text).not.toContain("UNION ALL");
    expect(query.params).toEqual([org, "2026-09-26", "2026-10-25", reportRowLimit + 2]);
  });

  it("combination 2 — tasks only: user × week × task count / FB rate / late count, by first Done in business time", () => {
    const query = build({ dimensions: ["user", "week"], measures: ["task_count", "fb_rate", "late_count"] });
    expect(query.sources).toEqual(["TASKS"]);
    expect(query.text).toContain("FROM production.tasks t");
    expect(query.text).not.toContain("score_entries");
    expect(query.text).toMatch(/t\.done_at >= \$\d+::timestamptz AND t\.done_at < \$\d+::timestamptz/);
    // [from 00:00, to + 1 00:00) in Asia/Ho_Chi_Minh.
    expect(query.params).toContain("2026-09-25T17:00:00.000Z");
    expect(query.params).toContain("2026-10-25T17:00:00.000Z");
    expect(query.params).toContain("Asia/Ho_Chi_Minh");
    expect(query.text).toMatch(/date_trunc\('week', \(t\.done_at AT TIME ZONE \$\d+::text\)::date\)/);
    expect(query.text).toContain("round((count(*) FILTER (WHERE f.kind = 'FB_WRONG'))::numeric / nullif(count(*), 0), 4)");
    expect(query.text).toContain("count(*) FILTER (WHERE f.is_late)");
    expect(query.text).toContain("GROUP BY GROUPING SETS ((f.d0, f.d1), ())");
  });

  it("combination 3 — mixed sources: project × month × points / images done / FB rate", () => {
    const query = build({ dimensions: ["project", "month"], measures: ["points", "qty_done", "fb_rate"] });
    expect(query.sources).toEqual(["SCORES", "TASKS"]);
    expect(query.text).toContain("e.project_id AS d0");
    expect(query.text).toContain("j.project_id AS d0");
    expect(query.text).toContain("JOIN production.jobs j ON j.organization_id = t.organization_id AND j.id = t.job_id");
    expect(query.text).toContain("to_char(e.business_day, 'YYYY-MM') AS d1");
    expect(query.text).toContain("UNION ALL");
    expect(query.text).toContain("GROUP BY u.d0, u.d1, u.is_total");
    // Sums read 0 for a source without rows in a group; rates stay null.
    expect(query.text).toContain("coalesce(max(u.m_points), 0) AS m_points");
    expect(query.text).toContain("max(u.m_fb_rate) AS m_fb_rate");
    expect(query.text).not.toContain("coalesce(max(u.m_fb_rate)");
  });

  it("joins only what the dimensions and filters need", () => {
    const scores = build({ dimensions: ["team", "status"], measures: ["points"] });
    expect(scores.text).toContain("LEFT JOIN production.member_profiles mp ON mp.organization_id = e.organization_id AND mp.user_id = e.user_id");
    expect(scores.text).toContain("JOIN production.tasks t ON t.organization_id = e.organization_id AND t.id = e.task_id");
    expect(scores.text).not.toContain("production.projects p");
    const tasks = build({ dimensions: ["client"], measures: ["task_count"] });
    // Clients hang off projects, which tasks reach through jobs.
    expect(tasks.text.indexOf("JOIN production.jobs j")).toBeLessThan(tasks.text.indexOf("LEFT JOIN production.projects p"));
    const plain = build({ dimensions: ["shift"], measures: ["task_count"] });
    expect(plain.text).not.toContain("production.jobs j");
    expect(plain.text).not.toContain("member_profiles");
  });

  it("anchors tasks on assigned_at / deadline and applies task-only and score-only filters to their source", () => {
    const assigned = build({ dimensions: ["day"], measures: ["task_count", "points"], taskDate: "ASSIGNED", filters: { scoreRole: ["QC"], taskState: "OPEN" } });
    expect(assigned.text).toMatch(/t\.assigned_at >= \$\d+::timestamptz/);
    expect(assigned.text).toContain("t.done_at IS NULL");
    expect(assigned.text).toMatch(/e\.role = ANY\(\$\d+::text\[\]\)/);
    expect(assigned.text).not.toMatch(/t\.role/);
    const deadline = build({ dimensions: ["job"], measures: ["late_count"], taskDate: "DEADLINE", filters: { taskState: "DONE", taskKind: ["FB_WRONG"] } });
    expect(deadline.text).toMatch(/t\.deadline >= \$\d+::timestamptz/);
    expect(deadline.text).toContain("t.done_at IS NOT NULL");
    expect(deadline.text).toMatch(/t\.kind = ANY\(\$\d+::text\[\]\)/);
    expect(deadline.params).toContainEqual(["FB_WRONG"]);
  });

  it("tag filter matches tags on the job, task, person or client", () => {
    const query = build({ measures: ["task_count"], filters: { tag: [tag] } });
    expect(query.text).toContain("EXISTS (SELECT 1 FROM production.entity_tags et WHERE et.organization_id = $1::uuid");
    expect(query.text).toContain("(et.entity = 'CLIENT' AND et.entity_id = p.client_id)");
    expect(query.text).toContain("LEFT JOIN production.projects p");
  });

  it("KPI period dimension binds the close day; totals-only reports have no GROUP BY", () => {
    const query = build({ dimensions: ["period"], measures: ["task_count"] });
    expect(query.text).toMatch(/date_trunc\('month', \(\(t\.done_at AT TIME ZONE \$\d+::text\)::date - \$\d+::int\) \+ interval '1 month'\)/);
    expect(query.params).toContain(25);
    const totals = build({ measures: ["points", "task_count"] });
    expect(totals.text).not.toContain("GROUPING");
    expect(totals.text).toContain("true AS is_total");
  });

  it("sorts by the chosen key and bounds the result", () => {
    const query = build({ dimensions: ["user"], measures: ["fb_rate"], sort: { key: "fb_rate", direction: "desc" }, limit: 5 });
    expect(query.text).toContain("ORDER BY r.is_total DESC, r.m_fb_rate DESC NULLS LAST, l0.display_name ASC NULLS LAST");
    expect(query.params[query.params.length - 1]).toBe(7);
    expect(query.limit).toBe(5);
    const byLabel = build({ dimensions: ["team", "day"], measures: ["points"], sort: { key: "team", direction: "asc" } });
    expect(byLabel.text).toContain("ORDER BY r.is_total DESC, l0.name ASC NULLS LAST");
  });
});

describe("report ranges", () => {
  it("resolves presets in business days", () => {
    expect(presetRange("TODAY", "2026-10-09", 25)).toEqual({ from: "2026-10-09", to: "2026-10-09" });
    expect(presetRange("THIS_WEEK", "2026-10-09", 25)).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(presetRange("LAST_WEEK", "2026-10-05", 25)).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(presetRange("LAST_30_DAYS", "2026-10-09", 25)).toEqual({ from: "2026-09-10", to: "2026-10-09" });
    expect(presetRange("THIS_MONTH", "2026-02-10", 25)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(presetRange("LAST_MONTH", "2026-01-15", 25)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(presetRange("THIS_PERIOD", "2026-10-09", 25)).toEqual({ from: "2026-09-26", to: "2026-10-25" });
    expect(presetRange("THIS_PERIOD", "2026-10-26", 25)).toEqual({ from: "2026-10-26", to: "2026-11-25" });
    expect(presetRange("LAST_PERIOD", "2026-10-09", 25)).toEqual({ from: "2026-08-26", to: "2026-09-25" });
  });

  it("defaults to the current KPI period and refuses ranges over 366 days", () => {
    expect(resolveReportRange({}, "2026-10-09", 25)).toEqual({ from: "2026-09-26", to: "2026-10-25" });
    expect(resolveReportRange({ from: "2025-10-09", to: "2026-10-09" }, "2026-10-09", 25)).toEqual({ from: "2025-10-09", to: "2026-10-09" });
    expect(errorCode(() => resolveReportRange({ from: "2025-10-08", to: "2026-10-09" }, "2026-10-09", 25))).toEqual({ code: "INVALID_RANGE", status: 400 });
    expect(errorCode(() => resolveReportRange({ from: "2026-02-30", to: "2026-03-01" }, "2026-10-09", 25))).toEqual({ code: "INVALID_RANGE", status: 400 });
  });
});

describe("report rows", () => {
  it("maps keys, labels, numbers and the totals row; flags truncation", () => {
    const cfg = config({ dimensions: ["team", "task_kind", "week"], measures: ["points", "fb_rate"] });
    const raw = [
      { d0: null, d1: null, d2: null, is_total: true, m_points: "30.50", m_fb_rate: "0.1000" },
      { d0: team, d1: "FB_WRONG", d2: "2026-10-05", is_total: false, m_points: "20.50", m_fb_rate: "0.2500", d0_label: "Team A" },
      { d0: null, d1: "NORMAL", d2: "2026-10-05", is_total: false, m_points: "10", m_fb_rate: null, d0_label: null },
      { d0: null, d1: "NORMAL", d2: "2026-10-12", is_total: false, m_points: "0", m_fb_rate: null, d0_label: null }
    ];
    const mapped = mapReportRows(cfg, raw, 2);
    expect(mapped.truncated).toBe(true);
    expect(mapped.totals).toEqual({ points: 30.5, fb_rate: 0.1 });
    expect(mapped.rows).toEqual([
      { team, team_label: "Team A", task_kind: "FB_WRONG", task_kind_label: "FB sai", week: "2026-10-05", week_label: "Tuần 05/10/2026", points: 20.5, fb_rate: 0.25 },
      { team: null, team_label: "Chưa có team", task_kind: "NORMAL", task_kind_label: "Thường", week: "2026-10-05", week_label: "Tuần 05/10/2026", points: 10, fb_rate: null }
    ]);
  });

  it("a report without dimensions is one row with the totals", () => {
    const mapped = mapReportRows(config({ measures: ["task_count", "late_rate"] }), [{ is_total: true, m_task_count: "20", m_late_rate: "0.1500" }], 10);
    expect(mapped.rows).toEqual([{ task_count: 20, late_rate: 0.15 }]);
  });

  it("formats time labels", () => {
    expect(timeLabel("day", "2026-10-09")).toBe("09/10/2026");
    expect(timeLabel("month", "2026-10")).toBe("10/2026");
    expect(timeLabel("period", "2026-10")).toBe("Kỳ 10/2026");
  });
});

describe("report permissions", () => {
  const moneyConfig = config({ dimensions: ["user"], measures: ["points", "money_khoan"] });
  const pointsByUser = config({ dimensions: ["user"], measures: ["points"] });
  const pointsByTeam = config({ dimensions: ["team"], measures: ["points"] });

  it("money_khoan is refused for everyone but ADMIN", () => {
    expect(errorCode(() => assertReportAllowed(contextWith(["LEADER"]), moneyConfig, true))).toEqual({ code: "MONEY_FORBIDDEN", status: 403 });
    expect(errorCode(() => assertReportAllowed(contextWith(["ADMIN"]), moneyConfig, true))).toBeNull();
    expect(errorCode(() => assertReportAllowed(contextWith([], true), moneyConfig, true))).toBeNull();
  });

  it("only ADMIN / LEADER run reports; non-members get 404", () => {
    expect(errorCode(() => assertReportAllowed(contextWith(["STAFF", "QC"]), pointsByTeam, true))).toEqual({ code: "FORBIDDEN", status: 403 });
    expect(errorCode(() => assertReportAllowed(contextWith([]), pointsByTeam, true))).toEqual({ code: "PRODUCTION_NOT_FOUND", status: 404 });
  });

  it("private scores: no per-person points for non-admins (team totals stay)", () => {
    expect(errorCode(() => assertReportAllowed(contextWith(["LEADER"]), pointsByUser, false))).toEqual({ code: "SCORES_PRIVATE", status: 403 });
    expect(
      errorCode(() => assertReportAllowed(contextWith(["LEADER"]), config({ dimensions: ["team"], measures: ["points"], filters: { user: [userA] } }), false))
    ).toEqual({ code: "SCORES_PRIVATE", status: 403 });
    expect(errorCode(() => assertReportAllowed(contextWith(["LEADER"]), pointsByTeam, false))).toBeNull();
    expect(errorCode(() => assertReportAllowed(contextWith(["LEADER"]), config({ dimensions: ["user"], measures: ["task_count"] }), false))).toBeNull();
    expect(errorCode(() => assertReportAllowed(contextWith(["ADMIN"]), pointsByUser, false))).toBeNull();
  });
});
