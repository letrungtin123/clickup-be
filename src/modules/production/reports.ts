import type postgres from "postgres";

import { customFieldEmptyValue } from "../../contracts/production-catalog.js";
import {
  isCustomFieldDimension,
  parseCustomFieldDimension,
  reportDimensionInfo,
  reportDimensions,
  reportMaxRangeDays,
  reportMeasureInfo,
  reportMeasures,
  reportRowLimit,
  taskKindLabels,
  type CustomFieldDimension,
  type CustomFieldDimensionEntity,
  type ReportColumn,
  type ReportConfig,
  type ReportDimension,
  type ReportDimensionKey,
  type ReportFilters,
  type ReportMeasure,
  type ReportRangePreset,
  type ReportResult,
  type ReportRow
} from "../../contracts/production-reports.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import type { QuerySql } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { assertProductionRole, isProductionAdmin } from "./access.js";
import { closeDaysOf, customFieldsForbidden, loadSettings } from "./catalog.service.js";
import { daysInclusive, periodOfDay, periodRange, shiftPeriod, weekStart, type KpiCloseDays } from "./scoring.js";
import { addDays, businessDay, businessTimeZone, isValidDay, startOfBusinessDay } from "./time.js";

/**
 * Report query layer (SPEC Phase 5 §1). `buildReportQuery` turns a validated ReportConfig into ONE SQL
 * statement assembled only from the constant fragments below (whitelisted dimension / measure / filter
 * names); every value — organization, dates, ids, timezone, close day, limit — is a bound parameter.
 * No text from the request is ever concatenated into SQL.
 *
 * Sources (see also contracts/production-reports.ts):
 *  - SCORES (points, points_khoan, money_khoan): production.score_entries, by business_day, adjustments
 *    included (their deltas sum to the current value). user = earner (worker or QC).
 *  - TASKS (every other measure): production.tasks anchored on config.taskDate — DONE = done_at (the first
 *    Done; open tasks excluded), ASSIGNED = assigned_at, DEADLINE = deadline — within
 *    [from 00:00, to + 1 00:00) business time. user = assignee.
 * Each source is aggregated with GROUPING SETS ((dimensions), ()) — the () set is the totals row — and the
 * two are merged with UNION ALL + GROUP BY on the dimension keys (NULL keys group together).
 * Runs in a READ ONLY transaction with a statement timeout; at most reportRowLimit rows.
 */

const statementTimeoutMs = 15_000;

type Source = "SCORES" | "TASKS";
type JoinName = "task" | "job" | "project" | "client" | "member";

/**
 * Expressions shared by the fragments of one statement (placeholders bound on first use). `close(day)` is the KPI
 * close day of the month of `day` (one bound value, or a CASE over the close-day versions, G15).
 */
type ExprContext = { day: () => string; close: (day: string) => string };

const joinSql: Record<Source, Partial<Record<JoinName, string>>> = {
  SCORES: {
    task: "JOIN production.tasks t ON t.organization_id = e.organization_id AND t.id = e.task_id",
    job: "JOIN production.jobs j ON j.organization_id = e.organization_id AND j.id = e.job_id",
    project: "LEFT JOIN production.projects p ON p.organization_id = e.organization_id AND p.id = e.project_id",
    client: "LEFT JOIN production.clients c ON c.organization_id = p.organization_id AND c.id = p.client_id",
    member: "LEFT JOIN production.member_profiles mp ON mp.organization_id = e.organization_id AND mp.user_id = e.user_id"
  },
  TASKS: {
    job: "JOIN production.jobs j ON j.organization_id = t.organization_id AND j.id = t.job_id",
    project: "LEFT JOIN production.projects p ON p.organization_id = j.organization_id AND p.id = j.project_id",
    client: "LEFT JOIN production.clients c ON c.organization_id = p.organization_id AND c.id = p.client_id",
    member: "LEFT JOIN production.member_profiles mp ON mp.organization_id = t.organization_id AND mp.user_id = t.assignee_id"
  }
};
const joinOrder: JoinName[] = ["task", "job", "project", "client", "member"];
/** Joins a join depends on (TASKS reach projects through jobs; clients through projects). */
const joinRequires: Record<Source, Partial<Record<JoinName, JoinName[]>>> = {
  SCORES: { client: ["project"] },
  TASKS: { project: ["job"], client: ["project", "job"] }
};

// Custom-field dimensions & filters (PLAN §8/§10) --------------------------------------------------------------

/** Definition of a custom field used by a report (loaded from production.custom_fields, active only). */
export type ReportCustomField = {
  entity: CustomFieldDimensionEntity;
  key: string;
  label: string;
  type: "SELECT" | "MULTISELECT" | "TEXT";
  options: { value: string; label: string }[];
};
export type ReportCustomFields = ReadonlyMap<string, ReportCustomField>;

/** Where each entity's custom_values live, per source, and the joins that reach it. */
const customFieldColumn: Record<CustomFieldDimensionEntity, { column: string; joins: Record<Source, JoinName[]> }> = {
  user: { column: "mp.custom_values", joins: { SCORES: ["member"], TASKS: ["member"] } },
  job: { column: "j.custom_values", joins: { SCORES: ["job"], TASKS: ["job"] } },
  task: { column: "t.custom_values", joins: { SCORES: ["task"], TASKS: [] } },
  client: { column: "c.custom_values", joins: { SCORES: ["client"], TASKS: ["client"] } }
};

const customFieldEntityCodes: Record<CustomFieldDimensionEntity, "USER" | "JOB" | "TASK" | "CLIENT"> = {
  user: "USER",
  job: "JOB",
  task: "TASK",
  client: "CLIENT"
};

/** Custom-field ids ("cf_user:nang_luc") a config uses, as dimensions or filters. */
export const customFieldIdsOf = (config: Pick<ReportConfig, "dimensions" | "filters">) => [
  ...new Set<string>([
    ...config.dimensions.filter((dim) => isCustomFieldDimension(dim)),
    ...(config.filters.customFields ?? []).map((filter) => filter.field)
  ])
];

/**
 * Loads the custom fields a config uses: each must be an active SELECT, MULTISELECT or TEXT field of its entity
 * (400 REPORT_INVALID otherwise).
 */
export const loadReportCustomFields = async (sql: QuerySql, organizationId: string, config: Pick<ReportConfig, "dimensions" | "filters">): Promise<ReportCustomFields> => {
  const ids = customFieldIdsOf(config);
  const result = new Map<string, ReportCustomField>();
  if (ids.length === 0) {
    return result;
  }
  const wanted = ids.map((id) => parseCustomFieldDimension(id)!);
  const rows = await sql<{ entity: string; key: string; label: string; type: string; options: { value: string; label: string }[] }[]>`
    SELECT entity, key, label, type, options FROM production.custom_fields
    WHERE organization_id = ${organizationId} AND active
      AND (entity, key) IN (SELECT * FROM unnest(${wanted.map((item) => customFieldEntityCodes[item.entity])}::text[], ${wanted.map((item) => item.key)}::text[]))
  `;
  for (const item of wanted) {
    const row = rows.find((candidate) => candidate.entity === customFieldEntityCodes[item.entity] && candidate.key === item.key);
    if (!row || !["SELECT", "MULTISELECT", "TEXT"].includes(row.type)) {
      throw new AppError("REPORT_INVALID", `Trường tuỳ biến "${item.key}" không dùng được trong báo cáo (chỉ trường chọn hoặc văn bản đang dùng).`, 400);
    }
    result.set(`cf_${item.entity}:${item.key}`, {
      entity: item.entity,
      key: item.key,
      label: row.label,
      type: row.type as ReportCustomField["type"],
      options: (row.options ?? []).map((option) => ({ value: option.value, label: option.label }))
    });
  }
  return result;
};

const customFieldOf = (fields: ReportCustomFields | undefined, id: string) => {
  const field = fields?.get(id);
  if (!field) {
    throw unknownName("trường tuỳ biến");
  }
  return field;
};

type DimensionSpec = {
  expr: Record<Source, (ctx: ExprContext) => string>;
  joins: Record<Source, JoinName[]>;
  /**
   * Entity label lookup for the final rows (table alias gets the dimension index). `scoped`: the table has
   * organization_id; `member`: a global user row, looked up only for people with a membership (any status) in
   * the organization (SEC2-27).
   */
  label?: { table: string; column: string; scoped: boolean; member?: boolean };
  nullLabel: string;
};

/** "YYYY-MM" KPI period of a date expression, given the SQL of its close day (`day` and `close` are trusted SQL). */
const kpiPeriodSql = (day: string, close: string) =>
  `to_char(${day} + CASE WHEN extract(day FROM ${day}) <= ${close} THEN interval '0 months' ELSE interval '1 month' END, 'YYYY-MM')`;

const dimensionSpecs: Record<ReportDimension, DimensionSpec> = {
  user: {
    expr: { SCORES: () => "e.user_id", TASKS: () => "t.assignee_id" },
    joins: { SCORES: [], TASKS: [] },
    label: { table: "public.app_users", column: "display_name", scoped: false, member: true },
    nullLabel: "Không rõ"
  },
  team: {
    expr: { SCORES: () => "mp.team_id", TASKS: () => "mp.team_id" },
    joins: { SCORES: ["member"], TASKS: ["member"] },
    label: { table: "production.teams", column: "name", scoped: true },
    nullLabel: "Chưa có team"
  },
  project: {
    expr: { SCORES: () => "e.project_id", TASKS: () => "j.project_id" },
    joins: { SCORES: [], TASKS: ["job"] },
    label: { table: "production.projects", column: "code", scoped: true },
    nullLabel: "Không rõ"
  },
  client: {
    expr: { SCORES: () => "p.client_id", TASKS: () => "p.client_id" },
    joins: { SCORES: ["project"], TASKS: ["project"] },
    label: { table: "production.clients", column: "name", scoped: true },
    nullLabel: "Chưa có client"
  },
  process: {
    expr: { SCORES: () => "e.process_id", TASKS: () => "t.process_id" },
    joins: { SCORES: [], TASKS: [] },
    label: { table: "production.processes", column: "name", scoped: true },
    nullLabel: "Không có quy trình"
  },
  shift: {
    expr: { SCORES: () => "e.shift_id", TASKS: () => "t.shift_id" },
    joins: { SCORES: [], TASKS: [] },
    label: { table: "production.shifts", column: "name", scoped: true },
    nullLabel: "Không rõ"
  },
  status: {
    expr: { SCORES: () => "t.status_id", TASKS: () => "t.status_id" },
    joins: { SCORES: ["task"], TASKS: [] },
    label: { table: "production.statuses", column: "name", scoped: true },
    nullLabel: "Không rõ"
  },
  task_kind: {
    expr: { SCORES: () => "e.kind", TASKS: () => "t.kind" },
    joins: { SCORES: [], TASKS: [] },
    nullLabel: "Không rõ"
  },
  job: {
    expr: { SCORES: () => "e.job_id", TASKS: () => "t.job_id" },
    joins: { SCORES: [], TASKS: [] },
    label: { table: "production.jobs", column: "code", scoped: true },
    nullLabel: "Không rõ"
  },
  day: {
    expr: { SCORES: () => "to_char(e.business_day, 'YYYY-MM-DD')", TASKS: (ctx) => `to_char(${ctx.day()}, 'YYYY-MM-DD')` },
    joins: { SCORES: [], TASKS: [] },
    nullLabel: ""
  },
  week: {
    expr: {
      SCORES: () => "to_char(date_trunc('week', e.business_day), 'YYYY-MM-DD')",
      TASKS: (ctx) => `to_char(date_trunc('week', ${ctx.day()}), 'YYYY-MM-DD')`
    },
    joins: { SCORES: [], TASKS: [] },
    nullLabel: ""
  },
  month: {
    expr: { SCORES: () => "to_char(e.business_day, 'YYYY-MM')", TASKS: (ctx) => `to_char(${ctx.day()}, 'YYYY-MM')` },
    joins: { SCORES: [], TASKS: [] },
    nullLabel: ""
  },
  period: {
    // KPI period: day ≤ close day of its month → this month, else next month, with the organization's close-day
    // versions like the board and the settlement (PR-17, G15) — never the stored period_month. 31 "Cuối tháng"
    // (PD-032) keeps every day in its own month (no day number exceeds 31, so no clamping is needed here).
    expr: {
      SCORES: (ctx) => kpiPeriodSql("e.business_day", ctx.close("e.business_day")),
      TASKS: (ctx) => kpiPeriodSql(ctx.day(), ctx.close(ctx.day()))
    },
    joins: { SCORES: [], TASKS: [] },
    nullLabel: ""
  }
};

type MeasureSpec = {
  source: Source;
  /** Aggregate over the fact rows `f` (cast to numeric). */
  aggregate: string;
  /** Sums/counts read 0 when a group has no fact rows of this source; rates/averages stay null. */
  zeroWhenEmpty: boolean;
};

const ratio = (numerator: string) => `round((${numerator})::numeric / nullif(count(*), 0), 4)`;
const measureSpecs: Record<ReportMeasure, MeasureSpec> = {
  points: { source: "SCORES", aggregate: "coalesce(sum(f.credits) FILTER (WHERE f.pay_mode = 'POINTS'), 0)", zeroWhenEmpty: true },
  points_khoan: { source: "SCORES", aggregate: "coalesce(sum(f.credits) FILTER (WHERE f.pay_mode = 'MONEY_IF_KPI'), 0)", zeroWhenEmpty: true },
  money_khoan: { source: "SCORES", aggregate: "coalesce(sum(f.money) FILTER (WHERE f.pay_mode = 'MONEY_IF_KPI'), 0)", zeroWhenEmpty: true },
  qty_done: { source: "TASKS", aggregate: "coalesce(sum(f.qty_done), 0)", zeroWhenEmpty: true },
  qty_assigned: { source: "TASKS", aggregate: "coalesce(sum(f.qty_assigned), 0)", zeroWhenEmpty: true },
  task_count: { source: "TASKS", aggregate: "count(*)", zeroWhenEmpty: true },
  late_count: { source: "TASKS", aggregate: "count(*) FILTER (WHERE f.is_late)", zeroWhenEmpty: true },
  late_rate: { source: "TASKS", aggregate: ratio("count(*) FILTER (WHERE f.is_late)"), zeroWhenEmpty: false },
  fb_wrong_count: { source: "TASKS", aggregate: "count(*) FILTER (WHERE f.kind = 'FB_WRONG')", zeroWhenEmpty: true },
  fb_rate: { source: "TASKS", aggregate: ratio("count(*) FILTER (WHERE f.kind = 'FB_WRONG')"), zeroWhenEmpty: false },
  qc_fail_count: { source: "TASKS", aggregate: "coalesce(sum(f.qc_fail_count), 0)", zeroWhenEmpty: true },
  qc_fail_rate: { source: "TASKS", aggregate: ratio("count(*) FILTER (WHERE f.qc_fail_count > 0)"), zeroWhenEmpty: false },
  avg_hours_done: {
    source: "TASKS",
    aggregate: "round((avg(extract(epoch FROM f.done_at - f.assigned_at) / 3600.0) FILTER (WHERE f.done_at IS NOT NULL))::numeric, 2)",
    zeroWhenEmpty: false
  },
  ot_hours: { source: "TASKS", aggregate: "coalesce(sum(f.ot_hours), 0)", zeroWhenEmpty: true },
  qty_per_worker_day: {
    source: "TASKS",
    aggregate:
      "round(sum(f.qty_done)::numeric / nullif(count(DISTINCT (f.assignee_id, f.done_day)) FILTER (WHERE f.done_at IS NOT NULL), 0), 2)",
    zeroWhenEmpty: false
  }
};

/** Columns every fact subquery exposes to the aggregates. */
const factColumns: Record<Source, string> = {
  SCORES: "e.credits, e.money, e.pay_mode",
  TASKS: "t.qty_done, t.qty_assigned, t.is_late, t.kind, t.qc_fail_count, t.done_at, t.assigned_at, t.ot_hours, t.assignee_id"
};

type FilterKey = keyof ReportFilters;
type FilterSpec = {
  /** Condition with the bound list placeholder; null = the filter does not apply to this source. */
  condition: Record<Source, ((list: string, org: string) => string) | null>;
  joins: Record<Source, JoinName[]>;
  cast: "uuid[]" | "text[]" | "none";
};

const anyOf = (column: string) => (list: string) => `${column} = ANY(${list})`;
const filterSpecs: Record<FilterKey, FilterSpec> = {
  user: { condition: { SCORES: anyOf("e.user_id"), TASKS: anyOf("t.assignee_id") }, joins: { SCORES: [], TASKS: [] }, cast: "uuid[]" },
  team: { condition: { SCORES: anyOf("mp.team_id"), TASKS: anyOf("mp.team_id") }, joins: { SCORES: ["member"], TASKS: ["member"] }, cast: "uuid[]" },
  project: { condition: { SCORES: anyOf("e.project_id"), TASKS: anyOf("j.project_id") }, joins: { SCORES: [], TASKS: ["job"] }, cast: "uuid[]" },
  client: { condition: { SCORES: anyOf("p.client_id"), TASKS: anyOf("p.client_id") }, joins: { SCORES: ["project"], TASKS: ["project"] }, cast: "uuid[]" },
  process: { condition: { SCORES: anyOf("e.process_id"), TASKS: anyOf("t.process_id") }, joins: { SCORES: [], TASKS: [] }, cast: "uuid[]" },
  shift: { condition: { SCORES: anyOf("e.shift_id"), TASKS: anyOf("t.shift_id") }, joins: { SCORES: [], TASKS: [] }, cast: "uuid[]" },
  status: { condition: { SCORES: anyOf("t.status_id"), TASKS: anyOf("t.status_id") }, joins: { SCORES: ["task"], TASKS: [] }, cast: "uuid[]" },
  job: { condition: { SCORES: anyOf("e.job_id"), TASKS: anyOf("t.job_id") }, joins: { SCORES: [], TASKS: [] }, cast: "uuid[]" },
  taskKind: { condition: { SCORES: anyOf("e.kind"), TASKS: anyOf("t.kind") }, joins: { SCORES: [], TASKS: [] }, cast: "text[]" },
  tag: {
    condition: {
      SCORES: (list, org) =>
        `EXISTS (SELECT 1 FROM production.entity_tags et WHERE et.organization_id = ${org} AND et.tag_id = ANY(${list}) AND (` +
        "(et.entity = 'JOB' AND et.entity_id = e.job_id) OR (et.entity = 'TASK' AND et.entity_id = e.task_id) OR " +
        "(et.entity = 'USER' AND et.entity_id = e.user_id) OR (et.entity = 'CLIENT' AND et.entity_id = p.client_id)))",
      TASKS: (list, org) =>
        `EXISTS (SELECT 1 FROM production.entity_tags et WHERE et.organization_id = ${org} AND et.tag_id = ANY(${list}) AND (` +
        "(et.entity = 'JOB' AND et.entity_id = t.job_id) OR (et.entity = 'TASK' AND et.entity_id = t.id) OR " +
        "(et.entity = 'USER' AND et.entity_id = t.assignee_id) OR (et.entity = 'CLIENT' AND et.entity_id = p.client_id)))"
    },
    joins: { SCORES: ["project"], TASKS: ["project"] },
    cast: "uuid[]"
  },
  scoreRole: { condition: { SCORES: anyOf("e.role"), TASKS: null }, joins: { SCORES: [], TASKS: [] }, cast: "text[]" },
  taskState: { condition: { SCORES: null, TASKS: null }, joins: { SCORES: [], TASKS: [] }, cast: "none" },
  jobState: { condition: { SCORES: null, TASKS: null }, joins: { SCORES: ["job"], TASKS: ["job"] }, cast: "none" },
  // Built per field in buildReportQuery (customFieldCondition).
  customFields: { condition: { SCORES: null, TASKS: null }, joins: { SCORES: [], TASKS: [] }, cast: "none" }
};

/** Text of a custom-field value per record (SELECT / TEXT; MULTISELECT is unnested per option). */
const customValueText = (column: string, key: string) => `(${column} ->> ${key})`;
const customValueArray = (column: string, key: string) =>
  `(CASE WHEN jsonb_typeof(${column} -> ${key}) = 'array' THEN ${column} -> ${key} ELSE '[]'::jsonb END)`;
const customValueEmpty = (column: string, key: string) =>
  `(${column} IS NULL OR NOT (${column} ? ${key}) OR ${column} -> ${key} IN ('null'::jsonb, '""'::jsonb, '[]'::jsonb))`;

const taskAnchors: Record<ReportConfig["taskDate"], string> = { DONE: "t.done_at", ASSIGNED: "t.assigned_at", DEADLINE: "t.deadline" };

// Validation -------------------------------------------------------------------------------------------

const knownDimensions = new Set<string>(reportDimensions);
const knownMeasures = new Set<string>(reportMeasures);
const knownFilters = new Set<string>(Object.keys(filterSpecs));

const unknownName = (what: string) => new AppError("REPORT_INVALID", `Báo cáo có ${what} không hợp lệ.`, 400);

/**
 * Defense in depth: the contract already restricts names, but the builder never trusts its input —
 * any name outside the whitelists is rejected before SQL is assembled.
 */
export const assertWhitelisted = (config: Pick<ReportConfig, "dimensions" | "measures" | "filters"> & { sort?: ReportConfig["sort"] }) => {
  if (!Array.isArray(config.dimensions) || config.dimensions.some((name) => !knownDimensions.has(name) && !isCustomFieldDimension(name))) {
    throw unknownName("chiều");
  }
  if ((config.filters?.customFields ?? []).some((filter) => !isCustomFieldDimension(filter.field) || !Array.isArray(filter.values) || filter.values.length === 0)) {
    throw unknownName("bộ lọc trường tuỳ biến");
  }
  if (!Array.isArray(config.measures) || config.measures.length === 0 || config.measures.some((name) => !knownMeasures.has(name))) {
    throw unknownName("chỉ số");
  }
  if (new Set(config.dimensions).size !== config.dimensions.length || new Set(config.measures).size !== config.measures.length) {
    throw unknownName("chiều/chỉ số trùng");
  }
  if (Object.keys(config.filters ?? {}).some((name) => !knownFilters.has(name))) {
    throw unknownName("bộ lọc");
  }
  if (config.sort && !(config.dimensions as string[]).includes(config.sort.key) && !(config.measures as string[]).includes(config.sort.key)) {
    throw unknownName("cột sắp xếp");
  }
  if (config.sort && config.sort.direction !== "asc" && config.sort.direction !== "desc") {
    throw unknownName("chiều sắp xếp");
  }
};

// Range ------------------------------------------------------------------------------------------------

const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
const nextMonthStart = (day: string) => `${shiftPeriod(day.slice(0, 7), 1)}-01`;

/** Business-day range of a preset relative to `today`. */
export const presetRange = (preset: ReportRangePreset, today: string, closeDay: KpiCloseDays): { from: string; to: string } => {
  switch (preset) {
    case "TODAY":
      return { from: today, to: today };
    case "YESTERDAY":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "THIS_WEEK": {
      const monday = weekStart(today);
      return { from: monday, to: addDays(monday, 6) };
    }
    case "LAST_WEEK": {
      const monday = addDays(weekStart(today), -7);
      return { from: monday, to: addDays(monday, 6) };
    }
    case "LAST_7_DAYS":
      return { from: addDays(today, -6), to: today };
    case "LAST_30_DAYS":
      return { from: addDays(today, -29), to: today };
    case "THIS_MONTH":
      return { from: monthStart(today), to: addDays(nextMonthStart(today), -1) };
    case "LAST_MONTH": {
      const first = `${shiftPeriod(today.slice(0, 7), -1)}-01`;
      return { from: first, to: addDays(monthStart(today), -1) };
    }
    case "THIS_PERIOD":
      return periodRange(periodOfDay(today, closeDay), closeDay);
    case "LAST_PERIOD":
      return periodRange(shiftPeriod(periodOfDay(today, closeDay), -1), closeDay);
  }
};

export const resolveReportRange = (config: Pick<ReportConfig, "preset" | "from" | "to">, today: string, closeDay: KpiCloseDays) => {
  const range = config.from !== undefined && config.to !== undefined ? { from: config.from, to: config.to } : presetRange(config.preset ?? "THIS_PERIOD", today, closeDay);
  if (!isValidDay(range.from) || !isValidDay(range.to) || range.from > range.to || daysInclusive(range.from, range.to) > reportMaxRangeDays) {
    throw new AppError("INVALID_RANGE", `Khoảng ngày không hợp lệ (tối đa ${reportMaxRangeDays} ngày).`, 400);
  }
  return range;
};

// Builder ----------------------------------------------------------------------------------------------

export type ReportParam = string | number | string[];
export type BuiltReportQuery = { text: string; params: ReportParam[]; sources: Source[]; limit: number };

class Params {
  readonly values: ReportParam[] = [];
  bind(value: ReportParam, cast?: string) {
    this.values.push(value);
    return `$${this.values.length}${cast ? `::${cast}` : ""}`;
  }
}

const sourcesOf = (measures: readonly ReportMeasure[]): Source[] =>
  (["SCORES", "TASKS"] as const).filter((source) => measures.some((measure) => measureSpecs[measure].source === source));

const withRequirements = (source: Source, joins: Set<JoinName>) => {
  for (const join of [...joins]) {
    for (const required of joinRequires[source][join] ?? []) {
      joins.add(required);
    }
  }
  return joinOrder.filter((join) => joins.has(join) && joinSql[source][join]);
};

const activeFilters = (filters: ReportFilters) =>
  (Object.keys(filterSpecs) as FilterKey[]).filter((key) => {
    const value = filters[key];
    return Array.isArray(value) ? value.length > 0 : value !== undefined;
  });

/**
 * Builds the statement for one report. Pure (no I/O) so the whitelisting and the generated SQL are
 * unit-tested. `from` / `to` are validated business days.
 */
export const buildReportQuery = (
  config: ReportConfig,
  input: { organizationId: string; from: string; to: string; closeDay: KpiCloseDays; limit?: number; customFields?: ReportCustomFields }
): BuiltReportQuery => {
  assertWhitelisted(config);
  const params = new Params();
  const org = params.bind(input.organizationId, "uuid");
  const dims = config.dimensions;
  const measures = config.measures;
  const sources = sourcesOf(measures);
  const filters = activeFilters(config.filters);
  const limit = Math.min(Math.max(1, Math.trunc(input.limit ?? config.limit ?? reportRowLimit)), reportRowLimit);
  const once = (bind: () => string) => {
    let placeholder: string | null = null;
    return () => (placeholder ??= bind());
  };
  const tz = once(() => params.bind(businessTimeZone, "text"));
  const anchor = taskAnchors[config.taskDate];
  // G15: the close day of the day's month — one bound value, or a CASE over the close-day versions (newest first).
  const versions =
    typeof input.closeDay === "number"
      ? [{ fromPeriod: null, closeDay: input.closeDay }]
      : [...input.closeDay].sort((a, b) => ((a.fromPeriod ?? "") < (b.fromPeriod ?? "") ? -1 : 1));
  const versionParams = versions.map((version) => ({
    from: version.fromPeriod === null ? null : once(() => params.bind(`${version.fromPeriod}-01`, "date")),
    day: once(() => params.bind(version.closeDay, "int"))
  }));
  const closeOf = (day: string) => {
    if (versionParams.length === 1) {
      return versionParams[0]!.day();
    }
    const branches = versionParams
      .slice(1)
      .reverse()
      .map((version) => `WHEN ${day} >= ${version.from!()} THEN ${version.day()}`);
    return `(CASE ${branches.join(" ")} ELSE ${versionParams[0]!.day()} END)`;
  };
  const ctx: ExprContext = { day: () => `(${anchor} AT TIME ZONE ${tz()})::date`, close: closeOf };
  const dimAlias = (index: number) => `d${index}`;
  const cfKey = new Map<string, () => string>();
  const keyParam = (id: string) => {
    if (!cfKey.has(id)) {
      cfKey.set(id, once(() => params.bind(customFieldOf(input.customFields, id).key, "text")));
    }
    return cfKey.get(id)!();
  };
  const isMulti = (dim: ReportDimensionKey) => isCustomFieldDimension(dim) && customFieldOf(input.customFields, dim).type === "MULTISELECT";
  const unnests = dims.some(isMulti);

  /** Custom-field condition of one filter (any of the values; "__empty__" = no value). */
  const customFieldCondition = (source: Source, joins: Set<JoinName>, filter: { field: CustomFieldDimension; values: string[] }) => {
    const field = customFieldOf(input.customFields, filter.field);
    const place = customFieldColumn[field.entity];
    place.joins[source].forEach((join) => joins.add(join));
    const key = keyParam(filter.field);
    const values = filter.values.filter((value) => value !== customFieldEmptyValue);
    const alternatives: string[] = [];
    if (filter.values.includes(customFieldEmptyValue)) {
      alternatives.push(customValueEmpty(place.column, key));
    }
    if (values.length > 0) {
      const list = params.bind(values, "text[]");
      alternatives.push(field.type === "MULTISELECT" ? `(${place.column} -> ${key}) ?| ${list}` : `${customValueText(place.column, key)} = ANY(${list})`);
    }
    return `(${alternatives.join(" OR ")})`;
  };

  const ctes = sources.map((source) => {
    const joins = new Set<JoinName>();
    const laterals: string[] = [];
    const dimSelect = dims.map((dim, index) => {
      if (isCustomFieldDimension(dim)) {
        const field = customFieldOf(input.customFields, dim);
        const place = customFieldColumn[field.entity];
        place.joins[source].forEach((join) => joins.add(join));
        if (field.type === "MULTISELECT") {
          // One row per chosen option; records without a value keep one row with a NULL key.
          laterals.push(`LEFT JOIN LATERAL jsonb_array_elements_text(${customValueArray(place.column, keyParam(dim))}) AS mv${index}(value) ON true`);
          return `mv${index}.value AS ${dimAlias(index)}`;
        }
        return `nullif(${customValueText(place.column, keyParam(dim))}, '') AS ${dimAlias(index)}`;
      }
      dimensionSpecs[dim].joins[source].forEach((join) => joins.add(join));
      return `${dimensionSpecs[dim].expr[source](ctx)} AS ${dimAlias(index)}`;
    });
    const where: string[] = [];
    if (source === "SCORES") {
      where.push(`e.organization_id = ${org}`, `e.business_day BETWEEN ${params.bind(input.from, "date")} AND ${params.bind(input.to, "date")}`);
    } else {
      const fromTs = startOfBusinessDay(input.from).toISOString();
      const toTs = startOfBusinessDay(addDays(input.to, 1)).toISOString();
      // Deleted lines (PD-036) are not work any more; their score rows net to zero on the SCORES side.
      where.push(`t.organization_id = ${org}`, "t.deleted_at IS NULL", `${anchor} >= ${params.bind(fromTs, "timestamptz")}`, `${anchor} < ${params.bind(toTs, "timestamptz")}`);
    }
    for (const key of filters) {
      const spec = filterSpecs[key];
      if (key === "taskState") {
        if (source === "TASKS") {
          // Open work = not Done and not closed (a task closed by an override without Done is not open, PR-08).
          where.push(config.filters.taskState === "OPEN" ? "t.done_at IS NULL AND t.closed_at IS NULL" : "t.done_at IS NOT NULL");
        }
        continue;
      }
      if (key === "jobState") {
        spec.joins[source].forEach((join) => joins.add(join));
        where.push(config.filters.jobState === "ACTIVE" ? "j.archived_at IS NULL" : "j.archived_at IS NOT NULL");
        continue;
      }
      if (key === "customFields") {
        for (const filter of config.filters.customFields ?? []) {
          where.push(customFieldCondition(source, joins, filter));
        }
        continue;
      }
      const condition = spec.condition[source];
      if (!condition) {
        continue;
      }
      spec.joins[source].forEach((join) => joins.add(join));
      const value = config.filters[key] as string[];
      where.push(condition(params.bind([...value], spec.cast === "none" ? undefined : spec.cast), org));
    }

    const extra = source === "TASKS" && measures.includes("qty_per_worker_day") ? [`(t.done_at AT TIME ZONE ${tz()})::date AS done_day`] : [];
    const base = source === "SCORES" ? "production.score_entries e" : "production.tasks t";
    const joinLines = withRequirements(source, joins).map((join) => joinSql[source][join]!);
    const fact = [
      `SELECT ${[...dimSelect, factColumns[source], ...extra].join(", ")}`,
      `FROM ${base}`,
      ...joinLines,
      ...laterals,
      `WHERE ${where.join(" AND ")}`
    ].join("\n    ");

    const keys = dims.map((_, index) => `f.${dimAlias(index)}`);
    const aggregates = measures.map((measure) =>
      measureSpecs[measure].source === source ? `(${measureSpecs[measure].aggregate})::numeric AS m_${measure}` : `NULL::numeric AS m_${measure}`
    );
    const name = source === "SCORES" ? "s" : "k";
    let select: string;
    if (dims.length === 0) {
      select = `SELECT ${["true AS is_total", ...aggregates].join(", ")}\n  FROM (\n    ${fact}\n  ) f`;
    } else if (!unnests) {
      select = `SELECT ${[...keys, `(GROUPING(${keys.join(", ")}) <> 0) AS is_total`, ...aggregates].join(", ")}\n  FROM (\n    ${fact}\n  ) f\n  GROUP BY GROUPING SETS ((${keys.join(", ")}), ())`;
    } else {
      // A MULTISELECT dimension repeats a record once per option: the totals row is computed on the records
      // themselves (no unnest), so every record still counts once in the totals.
      const plain = [`SELECT ${[factColumns[source], ...extra].join(", ")}`, `FROM ${base}`, ...joinLines, `WHERE ${where.join(" AND ")}`].join("\n    ");
      select =
        `SELECT ${[...keys, "false AS is_total", ...aggregates].join(", ")}\n  FROM (\n    ${fact}\n  ) f\n  GROUP BY ${keys.join(", ")}\n` +
        `  UNION ALL\n  SELECT ${[...keys.map(() => "NULL"), "true AS is_total", ...aggregates].join(", ")}\n  FROM (\n    ${plain}\n  ) f`;
    }
    return { name, sql: `${name} AS (\n  ${select}\n)` };
  });

  // Merge the sources: one row per dimension key (NULL keys group together), max() picks each source's value.
  const keyCols = dims.map((_, index) => dimAlias(index));
  const mergedMeasures = measures.map((measure) => {
    const merged = sources.length > 1 ? `max(u.m_${measure})` : `u.m_${measure}`;
    return measureSpecs[measure].zeroWhenEmpty ? `coalesce(${merged}, 0) AS m_${measure}` : `${merged} AS m_${measure}`;
  });
  const union = ctes.map((cte) => `SELECT ${[...keyCols, "is_total", ...measures.map((measure) => `m_${measure}`)].join(", ")} FROM ${cte.name}`).join("\n  UNION ALL\n  ");
  const merged =
    sources.length > 1
      ? `SELECT ${[...keyCols.map((col) => `u.${col}`), "u.is_total", ...mergedMeasures].join(", ")}\n  FROM (\n  ${union}\n  ) u\n  GROUP BY ${[...keyCols.map((col) => `u.${col}`), "u.is_total"].join(", ")}`
      : `SELECT ${[...keyCols.map((col) => `u.${col}`), "u.is_total", ...mergedMeasures].join(", ")}\n  FROM ${ctes[0]!.name} u`;

  // Labels of entity dimensions.
  const labelJoins: string[] = [];
  const labelCols: string[] = [];
  dims.forEach((dim, index) => {
    // Custom-field labels (option labels) are added when the rows are mapped.
    const label = isCustomFieldDimension(dim) ? undefined : dimensionSpecs[dim].label;
    if (!label) {
      return;
    }
    const alias = `l${index}`;
    labelJoins.push(
      `LEFT JOIN ${label.table} ${alias} ON ${label.scoped ? `${alias}.organization_id = ${org} AND ` : ""}${alias}.id = r.${dimAlias(index)}` +
        (label.member
          ? ` AND EXISTS (SELECT 1 FROM public.organization_memberships om${index} WHERE om${index}.organization_id = ${org} AND om${index}.user_id = ${alias}.id)`
          : "")
    );
    labelCols.push(`${alias}.${label.column} AS ${dimAlias(index)}_label`);
  });

  const sortExprOf = (key: string) => {
    const dimIndex = (dims as string[]).indexOf(key);
    if (dimIndex >= 0) {
      const dim = dims[dimIndex]!;
      const label = isCustomFieldDimension(dim) ? undefined : dimensionSpecs[dim].label;
      return label ? `l${dimIndex}.${label.column}` : `r.${dimAlias(dimIndex)}`;
    }
    return `r.m_${key}`;
  };
  const order: string[] = ["r.is_total DESC"];
  if (config.sort) {
    order.push(`${sortExprOf(config.sort.key)} ${config.sort.direction === "asc" ? "ASC" : "DESC"} NULLS LAST`);
  } else if (!dims.some((dim) => !isCustomFieldDimension(dim) && reportDimensionInfo[dim].kind === "time") && dims.length > 0) {
    order.push(`r.m_${measures[0]!} DESC NULLS LAST`);
  }
  dims.forEach((dim) => order.push(`${sortExprOf(dim)} ASC NULLS LAST`));
  dims.forEach((_, index) => order.push(`r.${dimAlias(index)} ASC NULLS LAST`));

  const text = [
    `WITH ${ctes.map((cte) => cte.sql).join(",\n")}`,
    `SELECT r.*${labelCols.length > 0 ? `, ${labelCols.join(", ")}` : ""}`,
    `FROM (\n  ${merged}\n) r`,
    ...labelJoins,
    `ORDER BY ${[...new Set(order)].join(", ")}`,
    // + totals row + one more to detect truncation
    `LIMIT ${params.bind(limit + 2, "int")}`
  ].join("\n");

  return { text, params: params.values, sources, limit };
};

// Result mapping -------------------------------------------------------------------------------------

const formatDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

/** Display text of a time key (day / Monday of a week / month / KPI period). */
export const timeLabel = (dim: ReportDimension, key: string) => {
  switch (dim) {
    case "day":
      return formatDay(key);
    case "week":
      return `Tuần ${formatDay(key)}`;
    case "month":
      return `${key.slice(5, 7)}/${key.slice(0, 4)}`;
    case "period":
      return `Kỳ ${key.slice(5, 7)}/${key.slice(0, 4)}`;
    default:
      return key;
  }
};

const toNumber = (value: unknown) => (value === null || value === undefined ? null : Number(value));

/** Column label / format of a dimension (custom fields: the field's label). */
export const dimensionColumnInfo = (dim: ReportDimensionKey, customFields?: ReportCustomFields) =>
  isCustomFieldDimension(dim)
    ? { label: customFields?.get(dim)?.label ?? dim, format: "text" as const }
    : { label: reportDimensionInfo[dim].label, format: reportDimensionInfo[dim].format };

export const reportColumns = (config: Pick<ReportConfig, "dimensions" | "measures">, customFields?: ReportCustomFields): ReportColumn[] => [
  ...config.dimensions.map((dim) => ({ key: dim, kind: "dimension" as const, ...dimensionColumnInfo(dim, customFields) })),
  ...config.measures.map((measure) => ({ key: measure, kind: "measure" as const, label: reportMeasureInfo[measure].label, format: reportMeasureInfo[measure].format }))
];

/** Records without a value of a custom field. */
export const customFieldNullLabel = "Chưa có";

export const mapReportRows = (
  config: Pick<ReportConfig, "dimensions" | "measures">,
  raw: readonly Record<string, unknown>[],
  limit: number,
  customFields?: ReportCustomFields
) => {
  const totalsRow = raw.find((row) => row.is_total === true);
  const dataRows = raw.filter((row) => row.is_total !== true);
  const rows: ReportRow[] = dataRows.slice(0, limit).map((row) => {
    const out: ReportRow = {};
    config.dimensions.forEach((dim, index) => {
      const key = row[`d${index}`];
      const text = typeof key === "string" ? key : key === null || key === undefined ? null : JSON.stringify(key);
      out[dim] = text;
      let label: string;
      if (isCustomFieldDimension(dim)) {
        const field = customFields?.get(dim);
        label = text === null ? customFieldNullLabel : (field?.options.find((option) => option.value === text)?.label ?? text);
      } else if (text === null) {
        label = dimensionSpecs[dim].nullLabel;
      } else if (reportDimensionInfo[dim].kind === "time") {
        label = timeLabel(dim, text);
      } else if (dim === "task_kind") {
        label = taskKindLabels[text as keyof typeof taskKindLabels] ?? text;
      } else {
        const found = row[`d${index}_label`];
        label = typeof found === "string" ? found : text;
      }
      out[`${dim}_label`] = label;
    });
    for (const measure of config.measures) {
      out[measure] = toNumber(row[`m_${measure}`]);
    }
    return out;
  });
  const totals: Record<string, number | null> = {};
  for (const measure of config.measures) {
    totals[measure] = totalsRow ? toNumber(totalsRow[`m_${measure}`]) : measureSpecs[measure].zeroWhenEmpty ? 0 : null;
  }
  // Without dimensions the report is one row: the totals.
  return { rows: config.dimensions.length === 0 ? [{ ...totals }] : rows, totals, truncated: dataRows.length > limit };
};

// Execution --------------------------------------------------------------------------------------------

const isQueryCanceled = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "57014";

/** Runs a validated config without permission checks (callers check). */
export const executeReport = async (
  sql: postgres.Sql,
  organizationId: string,
  config: ReportConfig,
  options: { today: string; closeDay: KpiCloseDays }
): Promise<ReportResult> => {
  const { from, to } = resolveReportRange(config, options.today, options.closeDay);
  const customFields = await loadReportCustomFields(sql, organizationId, config);
  const query = buildReportQuery(config, { organizationId, from, to, closeDay: options.closeDay, customFields });
  let raw: Record<string, unknown>[];
  try {
    raw = await sql.begin("read only", async (tx): Promise<Record<string, unknown>[]> => {
      await tx`SELECT set_config('statement_timeout', ${String(statementTimeoutMs)}, true)`;
      return await tx.unsafe(query.text, query.params);
    });
  } catch (error) {
    if (isQueryCanceled(error)) {
      throw new AppError("REPORT_TIMEOUT", "Báo cáo chạy quá lâu; hãy thu hẹp khoảng ngày hoặc thêm bộ lọc.", 422);
    }
    throw error;
  }
  const mapped = mapReportRows(config, raw, query.limit, customFields);
  return {
    config,
    from,
    to,
    generatedAt: new Date().toISOString(),
    columns: reportColumns(config, customFields),
    rows: mapped.rows,
    totals: mapped.totals,
    truncated: mapped.truncated,
    rowLimit: query.limit
  };
};

/**
 * Who may run what: ADMIN and LEADER use reports (LEADER sees every job — PD-014). Money (money_khoan)
 * is ADMIN only — refused, never silently dropped. Members' custom fields are Admin data. Points by person / job
 * are open (PD-052: every production member sees everyone's points, so settings.scoresPublic no longer gates PR-11).
 */
export const assertReportAllowed = (context: AccessContext, config: Pick<ReportConfig, "dimensions" | "measures" | "filters">) => {
  assertProductionRole(context, "LEADER");
  const admin = isProductionAdmin(context);
  if (!admin && config.measures.some((measure) => reportMeasureInfo[measure].adminOnly)) {
    throw new AppError("MONEY_FORBIDDEN", "Chỉ Admin được xem tiền khoán.", 403);
  }
  const fields = customFieldIdsOf(config).map((id) => parseCustomFieldDimension(id)!);
  // Members' custom values (e.g. "Năng lực") are Admin data, like in the members list.
  if (!admin && fields.some((field) => field.entity === "user")) {
    throw customFieldsForbidden();
  }
};

/** Permissions plus the custom fields a config uses (saving a report validates it like running it). */
export const assertReportConfigUsable = async (sql: QuerySql, context: AccessContext, config: ReportConfig) => {
  assertReportAllowed(context, config);
  await loadReportCustomFields(sql, context.organization.id, config);
};

/** USER custom fields in a config (dimension or filter): such a saved report is Admin only, like money. */
export const usesMemberCustomFields = (config: Pick<ReportConfig, "dimensions" | "filters">) =>
  customFieldIdsOf(config).some((id) => parseCustomFieldDimension(id)?.entity === "user");

/** POST /production/reports/query. */
export const runReport = async (context: AccessContext, config: ReportConfig): Promise<ReportResult> => {
  const sql = getSql();
  const settings = await loadSettings(sql, context.organization.id);
  assertReportAllowed(context, config);
  return await executeReport(sql, context.organization.id, config, { today: businessDay(new Date()), closeDay: closeDaysOf(settings) });
};
