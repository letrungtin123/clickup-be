import type postgres from "postgres";

import {
  reportDimensionInfo,
  reportDimensions,
  reportMaxRangeDays,
  reportMeasureInfo,
  reportMeasures,
  reportRowLimit,
  taskKindLabels,
  type ReportColumn,
  type ReportConfig,
  type ReportDimension,
  type ReportFilters,
  type ReportMeasure,
  type ReportRangePreset,
  type ReportResult,
  type ReportRow
} from "../../contracts/production-reports.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import type { AccessContext } from "../access/access-context.js";
import { assertProductionRole, isProductionAdmin } from "./access.js";
import { loadSettings } from "./catalog.service.js";
import { daysInclusive, periodOfDay, periodRange, shiftPeriod, weekStart } from "./scoring.js";
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
type JoinName = "task" | "job" | "project" | "member";

/** Expressions shared by the fragments of one statement (placeholders bound on first use). */
type ExprContext = { day: () => string; close: () => string };

const joinSql: Record<Source, Partial<Record<JoinName, string>>> = {
  SCORES: {
    task: "JOIN production.tasks t ON t.organization_id = e.organization_id AND t.id = e.task_id",
    project: "LEFT JOIN production.projects p ON p.organization_id = e.organization_id AND p.id = e.project_id",
    member: "LEFT JOIN production.member_profiles mp ON mp.organization_id = e.organization_id AND mp.user_id = e.user_id"
  },
  TASKS: {
    job: "JOIN production.jobs j ON j.organization_id = t.organization_id AND j.id = t.job_id",
    project: "LEFT JOIN production.projects p ON p.organization_id = j.organization_id AND p.id = j.project_id",
    member: "LEFT JOIN production.member_profiles mp ON mp.organization_id = t.organization_id AND mp.user_id = t.assignee_id"
  }
};
const joinOrder: JoinName[] = ["task", "job", "project", "member"];
/** Joins a join depends on (TASKS reach projects through jobs). */
const joinRequires: Record<Source, Partial<Record<JoinName, JoinName[]>>> = { SCORES: {}, TASKS: { project: ["job"] } };

type DimensionSpec = {
  expr: Record<Source, (ctx: ExprContext) => string>;
  joins: Record<Source, JoinName[]>;
  /** Entity label lookup for the final rows (table alias gets the dimension index). */
  label?: { table: string; column: string; scoped: boolean };
  nullLabel: string;
};

const dimensionSpecs: Record<ReportDimension, DimensionSpec> = {
  user: {
    expr: { SCORES: () => "e.user_id", TASKS: () => "t.assignee_id" },
    joins: { SCORES: [], TASKS: [] },
    label: { table: "public.app_users", column: "display_name", scoped: false },
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
    // KPI period: day ≤ close day → this month, else next month (closeDay ≤ 28).
    expr: {
      SCORES: () => "to_char(e.period_month, 'YYYY-MM')",
      TASKS: (ctx) => `to_char(date_trunc('month', (${ctx.day()} - ${ctx.close()}) + interval '1 month'), 'YYYY-MM')`
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
  taskState: { condition: { SCORES: null, TASKS: null }, joins: { SCORES: [], TASKS: [] }, cast: "none" }
};

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
  if (!Array.isArray(config.dimensions) || config.dimensions.some((name) => !knownDimensions.has(name))) {
    throw unknownName("chiều");
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
export const presetRange = (preset: ReportRangePreset, today: string, closeDay: number): { from: string; to: string } => {
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

export const resolveReportRange = (config: Pick<ReportConfig, "preset" | "from" | "to">, today: string, closeDay: number) => {
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
  input: { organizationId: string; from: string; to: string; closeDay: number; limit?: number }
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
  const ctx: ExprContext = { day: () => `(${anchor} AT TIME ZONE ${tz()})::date`, close: once(() => params.bind(input.closeDay, "int")) };
  const dimAlias = (index: number) => `d${index}`;

  const ctes = sources.map((source) => {
    const joins = new Set<JoinName>();
    for (const dim of dims) {
      dimensionSpecs[dim].joins[source].forEach((join) => joins.add(join));
    }
    const where: string[] = [];
    if (source === "SCORES") {
      where.push(`e.organization_id = ${org}`, `e.business_day BETWEEN ${params.bind(input.from, "date")} AND ${params.bind(input.to, "date")}`);
    } else {
      const fromTs = startOfBusinessDay(input.from).toISOString();
      const toTs = startOfBusinessDay(addDays(input.to, 1)).toISOString();
      where.push(`t.organization_id = ${org}`, `${anchor} >= ${params.bind(fromTs, "timestamptz")}`, `${anchor} < ${params.bind(toTs, "timestamptz")}`);
    }
    for (const key of filters) {
      const spec = filterSpecs[key];
      if (key === "taskState") {
        if (source === "TASKS") {
          where.push(config.filters.taskState === "OPEN" ? "t.done_at IS NULL" : "t.done_at IS NOT NULL");
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

    const dimSelect = dims.map((dim, index) => `${dimensionSpecs[dim].expr[source](ctx)} AS ${dimAlias(index)}`);
    const extra = source === "TASKS" && measures.includes("qty_per_worker_day") ? [`(t.done_at AT TIME ZONE ${tz()})::date AS done_day`] : [];
    const base = source === "SCORES" ? "production.score_entries e" : "production.tasks t";
    const fact = [
      `SELECT ${[...dimSelect, factColumns[source], ...extra].join(", ")}`,
      `FROM ${base}`,
      ...withRequirements(source, joins).map((join) => joinSql[source][join]!),
      `WHERE ${where.join(" AND ")}`
    ].join("\n    ");

    const keys = dims.map((_, index) => `f.${dimAlias(index)}`);
    const aggregates = measures.map((measure) =>
      measureSpecs[measure].source === source ? `(${measureSpecs[measure].aggregate})::numeric AS m_${measure}` : `NULL::numeric AS m_${measure}`
    );
    const name = source === "SCORES" ? "s" : "k";
    const select =
      dims.length > 0
        ? `SELECT ${[...keys, `(GROUPING(${keys.join(", ")}) <> 0) AS is_total`, ...aggregates].join(", ")}\n  FROM (\n    ${fact}\n  ) f\n  GROUP BY GROUPING SETS ((${keys.join(", ")}), ())`
        : `SELECT ${["true AS is_total", ...aggregates].join(", ")}\n  FROM (\n    ${fact}\n  ) f`;
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
    const label = dimensionSpecs[dim].label;
    if (!label) {
      return;
    }
    const alias = `l${index}`;
    labelJoins.push(
      `LEFT JOIN ${label.table} ${alias} ON ${label.scoped ? `${alias}.organization_id = ${org} AND ` : ""}${alias}.id = r.${dimAlias(index)}`
    );
    labelCols.push(`${alias}.${label.column} AS ${dimAlias(index)}_label`);
  });

  const sortExprOf = (key: string) => {
    const dimIndex = (dims as string[]).indexOf(key);
    if (dimIndex >= 0) {
      const label = dimensionSpecs[dims[dimIndex]!].label;
      return label ? `l${dimIndex}.${label.column}` : `r.${dimAlias(dimIndex)}`;
    }
    return `r.m_${key}`;
  };
  const order: string[] = ["r.is_total DESC"];
  if (config.sort) {
    order.push(`${sortExprOf(config.sort.key)} ${config.sort.direction === "asc" ? "ASC" : "DESC"} NULLS LAST`);
  } else if (!dims.some((dim) => reportDimensionInfo[dim].kind === "time") && dims.length > 0) {
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

export const reportColumns = (config: Pick<ReportConfig, "dimensions" | "measures">): ReportColumn[] => [
  ...config.dimensions.map((dim) => ({ key: dim, kind: "dimension" as const, label: reportDimensionInfo[dim].label, format: reportDimensionInfo[dim].format })),
  ...config.measures.map((measure) => ({ key: measure, kind: "measure" as const, label: reportMeasureInfo[measure].label, format: reportMeasureInfo[measure].format }))
];

export const mapReportRows = (config: Pick<ReportConfig, "dimensions" | "measures">, raw: readonly Record<string, unknown>[], limit: number) => {
  const totalsRow = raw.find((row) => row.is_total === true);
  const dataRows = raw.filter((row) => row.is_total !== true);
  const rows: ReportRow[] = dataRows.slice(0, limit).map((row) => {
    const out: ReportRow = {};
    config.dimensions.forEach((dim, index) => {
      const key = row[`d${index}`];
      const text = typeof key === "string" ? key : key === null || key === undefined ? null : JSON.stringify(key);
      out[dim] = text;
      let label: string;
      if (text === null) {
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
  options: { today: string; closeDay: number }
): Promise<ReportResult> => {
  const { from, to } = resolveReportRange(config, options.today, options.closeDay);
  const query = buildReportQuery(config, { organizationId, from, to, closeDay: options.closeDay });
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
  const mapped = mapReportRows(config, raw, query.limit);
  return {
    config,
    from,
    to,
    generatedAt: new Date().toISOString(),
    columns: reportColumns(config),
    rows: mapped.rows,
    totals: mapped.totals,
    truncated: mapped.truncated,
    rowLimit: query.limit
  };
};

const pointMeasures = new Set<ReportMeasure>(["points", "points_khoan"]);

/**
 * Who may run what: ADMIN and LEADER use reports (LEADER sees every job — PD-014). Money (money_khoan)
 * is ADMIN only — refused, never silently dropped. When settings.scoresPublic is off, non-admins cannot
 * break points down by person (dimension or filter `user`).
 */
export const assertReportAllowed = (context: AccessContext, config: Pick<ReportConfig, "dimensions" | "measures" | "filters">, scoresPublic: boolean) => {
  assertProductionRole(context, "LEADER");
  const admin = isProductionAdmin(context);
  if (!admin && config.measures.some((measure) => reportMeasureInfo[measure].adminOnly)) {
    throw new AppError("MONEY_FORBIDDEN", "Chỉ Admin được xem tiền khoán.", 403);
  }
  if (
    !admin &&
    !scoresPublic &&
    config.measures.some((measure) => pointMeasures.has(measure)) &&
    (config.dimensions.includes("user") || (config.filters.user?.length ?? 0) > 0)
  ) {
    throw new AppError("SCORES_PRIVATE", "Bảng điểm đang để riêng tư; không xem được điểm theo từng người.", 403);
  }
};

/** POST /production/reports/query. */
export const runReport = async (context: AccessContext, config: ReportConfig): Promise<ReportResult> => {
  const sql = getSql();
  const settings = await loadSettings(sql, context.organization.id);
  assertReportAllowed(context, config, settings.scoresPublic);
  return await executeReport(sql, context.organization.id, config, { today: businessDay(new Date()), closeDay: settings.kpiCloseDay });
};
