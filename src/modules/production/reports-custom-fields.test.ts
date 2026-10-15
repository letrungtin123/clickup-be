import { describe, expect, it } from "vitest";

import { ReportConfigSchema, type ReportConfig } from "../../contracts/production-reports.js";
import type { AccessContext } from "../access/access-context.js";
import { assertReportAllowed, buildReportQuery, mapReportRows, presetRange, reportColumns, type ReportCustomField } from "./reports.js";

/** Report builder: custom-field dimensions / filters (PLAN §8/§10 "Năng lực") and the close-day versions (G15). */

const org = "11111111-1111-4111-8111-111111111111";
const userA = "22222222-2222-4222-8222-222222222222";
const config = (input: unknown): ReportConfig => ReportConfigSchema.parse(input);
const contextWith = (roles: string[], full = false) =>
  ({ user: { id: userA }, organization: { id: org }, hasFullOrganizationAuthority: full, productionRoles: roles }) as unknown as AccessContext;
const errorCode = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return { code: (error as { code?: string }).code, status: (error as { statusCode?: number }).statusCode };
  }
  return null;
};

const fields = new Map<string, ReportCustomField>([
  [
    "cf_user:nang_luc",
    {
      entity: "user",
      key: "nang_luc",
      label: "Năng lực",
      type: "SELECT",
      options: [
        { value: "a_plus_plus", label: "A++" },
        { value: "a", label: "A" },
        { value: "b", label: "B" }
      ]
    }
  ],
  ["cf_job:ma_don_hang", { entity: "job", key: "ma_don_hang", label: "Mã đơn hàng", type: "TEXT", options: [] }],
  ["cf_task:do_kho", { entity: "task", key: "do_kho", label: "Độ khó", type: "SELECT", options: [{ value: "kho", label: "Khó" }] }],
  ["cf_client:kenh", { entity: "client", key: "kenh", label: "Kênh", type: "MULTISELECT", options: [{ value: "gdrive", label: "Google Drive" }] }]
]);
const buildCf = (input: unknown) => buildReportQuery(config(input), { organizationId: org, from: "2026-09-26", to: "2026-10-25", closeDay: 25, customFields: fields });

describe("custom-field dimensions and filters", () => {
  it("the contract accepts cf_<entity>:<key> ids only", () => {
    expect(ReportConfigSchema.safeParse({ dimensions: ["cf_user:nang_luc"], measures: ["points"] }).success).toBe(true);
    expect(ReportConfigSchema.safeParse({ dimensions: ["cf_team:x"], measures: ["points"] }).success).toBe(false);
    expect(ReportConfigSchema.safeParse({ dimensions: ["cf_user:Bad-Key"], measures: ["points"] }).success).toBe(false);
    expect(ReportConfigSchema.safeParse({ measures: ["points"], filters: { customFields: [{ field: "cf_user:nang_luc", values: [] }] } }).success).toBe(false);
    expect(ReportConfigSchema.safeParse({ dimensions: ["cf_user:nang_luc"], measures: ["points"], sort: { key: "cf_user:nang_luc" } }).success).toBe(true);
  });

  it("USER field → member profile of the earner (scores) / of the assignee (tasks); the key is a bound parameter", () => {
    const query = buildCf({ dimensions: ["cf_user:nang_luc"], measures: ["points", "task_count"] });
    expect(query.text).toContain("LEFT JOIN production.member_profiles mp ON mp.organization_id = e.organization_id AND mp.user_id = e.user_id");
    expect(query.text).toContain("LEFT JOIN production.member_profiles mp ON mp.organization_id = t.organization_id AND mp.user_id = t.assignee_id");
    expect(query.text).toMatch(/nullif\(\(mp\.custom_values ->> \$\d+::text\), ''\) AS d0/);
    expect(query.text).not.toContain("nang_luc");
    expect(query.params).toContain("nang_luc");
  });

  it("JOB / TASK / CLIENT fields join what they need; MULTISELECT unnests per option and keeps totals per record", () => {
    const query = buildCf({ dimensions: ["cf_client:kenh", "cf_job:ma_don_hang"], measures: ["qty_done"] });
    expect(query.text).toContain("LEFT JOIN production.clients c ON c.organization_id = p.organization_id AND c.id = p.client_id");
    expect(query.text).toContain("LEFT JOIN LATERAL jsonb_array_elements_text(");
    expect(query.text).toContain("SELECT NULL, NULL, true AS is_total");
    expect(query.text).not.toContain("GROUPING SETS");
    const task = buildCf({ dimensions: ["cf_task:do_kho"], measures: ["points"] });
    expect(task.text).toContain("JOIN production.tasks t ON t.organization_id = e.organization_id AND t.id = e.task_id");
    expect(task.text).toContain("GROUPING SETS");
  });

  it("filters: values bound as text[]; MULTISELECT any-of (?|); __empty__ = no value", () => {
    const query = buildCf({
      dimensions: ["team"],
      measures: ["points"],
      filters: {
        customFields: [
          { field: "cf_user:nang_luc", values: ["a", "__empty__"] },
          { field: "cf_client:kenh", values: ["gdrive"] }
        ]
      }
    });
    expect(query.text).toMatch(/\(mp\.custom_values IS NULL OR NOT \(mp\.custom_values \? \$\d+::text\)/);
    expect(query.text).toMatch(/\(mp\.custom_values ->> \$\d+::text\) = ANY\(\$\d+::text\[\]\)/);
    expect(query.text).toMatch(/\(c\.custom_values -> \$\d+::text\) \?\| \$\d+::text\[\]/);
    expect(query.params).toContainEqual(["a"]);
    expect(query.params).toContainEqual(["gdrive"]);
  });

  it("a field missing from the loaded definitions is refused (defense in depth)", () => {
    expect(
      errorCode(() =>
        buildReportQuery(config({ dimensions: ["cf_user:khac"], measures: ["points"] }), {
          organizationId: org,
          from: "2026-10-01",
          to: "2026-10-02",
          closeDay: 25,
          customFields: fields
        })
      )
    ).toEqual({ code: "REPORT_INVALID", status: 400 });
  });

  it("labels: option label, raw text for TEXT, \"Chưa có\" without a value; the column label is the field label", () => {
    const cfConfig = config({ dimensions: ["cf_user:nang_luc", "cf_job:ma_don_hang"], measures: ["points"] });
    const mapped = mapReportRows(
      cfConfig,
      [
        { d0: "a_plus_plus", d1: "PO-1", is_total: false, m_points: "10" },
        { d0: null, d1: null, is_total: false, m_points: "2" },
        { d0: null, d1: null, is_total: true, m_points: "12" }
      ],
      100,
      fields
    );
    expect(mapped.rows[0]).toMatchObject({ "cf_user:nang_luc": "a_plus_plus", "cf_user:nang_luc_label": "A++", "cf_job:ma_don_hang_label": "PO-1", points: 10 });
    expect(mapped.rows[1]).toMatchObject({ "cf_user:nang_luc_label": "Chưa có" });
    expect(mapped.totals.points).toBe(12);
    expect(reportColumns(cfConfig, fields)[0]).toEqual({ key: "cf_user:nang_luc", kind: "dimension", label: "Năng lực", format: "text" });
  });

  it("permissions: USER fields are Admin data; JOB / TASK fields are open to report users (PD-052)", () => {
    const byLevel = config({ dimensions: ["cf_user:nang_luc"], measures: ["points"] });
    expect(errorCode(() => assertReportAllowed(contextWith(["LEADER"]), byLevel))).toEqual({ code: "CUSTOM_FIELDS_FORBIDDEN", status: 403 });
    const filtered = config({ measures: ["points"], filters: { customFields: [{ field: "cf_user:nang_luc", values: ["a"] }] } });
    expect(errorCode(() => assertReportAllowed(contextWith(["LEADER"]), filtered))).toEqual({ code: "CUSTOM_FIELDS_FORBIDDEN", status: 403 });
    expect(errorCode(() => assertReportAllowed(contextWith(["ADMIN"]), byLevel))).toBeNull();
    const byOrder = config({ dimensions: ["cf_job:ma_don_hang"], measures: ["points"] });
    expect(errorCode(() => assertReportAllowed(contextWith(["LEADER"]), byOrder))).toBeNull();
    expect(errorCode(() => assertReportAllowed(contextWith(["LEADER"]), config({ dimensions: ["cf_client:kenh"], measures: ["points"] })))).toBeNull();
  });
});

describe("G15 — the KPI period dimension and presets follow the close-day versions", () => {
  const versions = [
    { fromPeriod: null, closeDay: 25 },
    { fromPeriod: "2026-11", closeDay: 20 }
  ];

  it("several versions: a CASE on the day's month (one version keeps the single bound day)", () => {
    const query = buildReportQuery(config({ dimensions: ["period"], measures: ["points"] }), { organizationId: org, from: "2026-10-01", to: "2026-12-20", closeDay: versions });
    expect(query.text).toMatch(/extract\(day FROM e\.business_day\) <= \(CASE WHEN e\.business_day >= \$\d+::date THEN \$\d+::int ELSE \$\d+::int END\) THEN/);
    expect(query.params).toContain("2026-11-01");
    expect(query.params).toContain(20);
    expect(query.params).toContain(25);
    const single = buildReportQuery(config({ dimensions: ["period"], measures: ["points"] }), { organizationId: org, from: "2026-10-01", to: "2026-10-20", closeDay: [{ fromPeriod: null, closeDay: 25 }] });
    expect(single.text).toMatch(/extract\(day FROM e\.business_day\) <= \$\d+::int THEN/);
  });

  it("PD-032: close day 31 “Cuối tháng” is bound like any day (every day ≤ 31 stays in its month); presets are calendar months", () => {
    const endOfMonth = [
      { fromPeriod: null, closeDay: 25 },
      { fromPeriod: "2026-11", closeDay: 31 }
    ];
    const query = buildReportQuery(config({ dimensions: ["period"], measures: ["points"] }), { organizationId: org, from: "2026-10-01", to: "2026-12-31", closeDay: endOfMonth });
    expect(query.params).toContain(31);
    expect(query.params).toContain("2026-11-01");
    expect(presetRange("THIS_PERIOD", "2026-12-31", endOfMonth)).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(presetRange("LAST_PERIOD", "2026-12-05", endOfMonth)).toEqual({ from: "2026-10-26", to: "2026-11-30" });
  });

  it("THIS_PERIOD / LAST_PERIOD presets", () => {
    expect(presetRange("THIS_PERIOD", "2026-11-05", versions)).toEqual({ from: "2026-10-26", to: "2026-11-20" });
    expect(presetRange("LAST_PERIOD", "2026-11-05", versions)).toEqual({ from: "2026-09-26", to: "2026-10-25" });
  });
});
