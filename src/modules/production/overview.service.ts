import { JobQuerySchema } from "../../contracts/production-jobs.js";
import {
  overviewChartMinDays,
  overviewDaySpan,
  overviewDueLimit,
  overviewLeaderMine,
  overviewProjectSlices,
  type OverviewDay,
  type OverviewDueList,
  type OverviewProjectProgress,
  type OverviewRange,
  type OverviewStats,
  type OverviewStatusSlice,
  type OverviewVolumeSlice,
  type ProductionOverview,
  type ProductionOverviewQuery
} from "../../contracts/production-overview.js";
import { getSql } from "../../db/client.js";
import { toIso, type SqlFragment } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { visibleUserIdSql } from "../access/test-accounts.js";
import { toColor, toUserRef, type UserRefJson } from "../work/mappers.js";
import { userJsonSql } from "../work/tasks.repo.js";
import { assertProductionMember } from "./access.js";
import { loadSettings } from "./catalog.service.js";
import { forbidden, loadJobScopes } from "./job-permissions.js";
import { lineFinishedSql, lineFinishStatusIds, loadWorkflowModel, notSubtaskSql } from "./jobs.repo.js";
import { hasScopeTabs, jobListFilterSql, ownedProjectJobSql } from "./jobs.service.js";
import { addDays, businessDay } from "./time.js";
import { isLineFinished, statusById, type Workflow } from "./workflow.js";

/**
 * PD-076 — "Tổng quan" of Photo Retouch (GET /production/overview): stats, charts, project progress and due lines in
 * one read. Definitions and visibility: contracts/production-overview.ts. A fixed number of grouped queries whatever
 * the data (settings, workflow and job scopes come from the per-organization config cache): the range's lines by status
 * (with the comparison days, and the "Tôi quản lý" split for a Leader / Admin), the chart days, the volume per project, the
 * open jobs' progress per project, and the two due lists.
 */

// Pure helpers (unit tested) ------------------------------------------------------------------------------------------

/** Calendar day (YYYY-MM-DD) of `at` in `timeZone`; the business timezone when the setting is not a known zone. */
export const dayInTimeZone = (at: Date, timeZone: string) => {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return businessDay(at);
  }
};

/** The range asked for; a missing end is the other one, both missing = today. */
export const resolveOverviewRange = (query: Pick<ProductionOverviewQuery, "from" | "to">, today: string): OverviewRange => ({
  from: query.from ?? query.to ?? today,
  to: query.to ?? query.from ?? today
});

/** The chart's days: the range, or — shorter than `overviewChartMinDays` (e.g. "Hôm nay") — that many days ending on its last day. */
export const overviewChartRange = (range: OverviewRange): OverviewRange =>
  overviewDaySpan(range.from, range.to) >= overviewChartMinDays
    ? range
    : { from: addDays(range.to, -(overviewChartMinDays - 1)), to: range.to };

/**
 * "So với …": the days just before the range, as many as the range has up to today (a range running into the future —
 * "Tháng này" — is compared with the same number of days, not a whole month). null when the range starts after today.
 */
export const overviewComparisonRange = (range: OverviewRange, today: string): OverviewRange | null => {
  const end = range.to < today ? range.to : today;
  if (end < range.from) {
    return null;
  }
  const days = overviewDaySpan(range.from, end);
  return { from: addDays(range.from, -days), to: addDays(range.from, -1) };
};

/** Monday – Sunday of the week holding `day`. */
export const weekOfDay = (day: string): OverviewRange => {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  const monday = addDays(day, -((weekday + 6) % 7));
  return { from: monday, to: addDays(monday, 6) };
};

/** Every day of the range, oldest first, with its counts (0 when absent). */
export const fillOverviewDays = (
  range: OverviewRange,
  received: ReadonlyMap<string, number>,
  done: ReadonlyMap<string, number>
): OverviewDay[] => {
  const days: OverviewDay[] = [];
  for (let day = range.from; day <= range.to && days.length <= 1000; day = addDays(day, 1)) {
    days.push({ day, received: received.get(day) ?? 0, done: done.get(day) ?? 0 });
  }
  return days;
};

/** One group of the range's lines (status × Checking × Done once × in the range or the comparison days × in a project I own). */
export type OverviewLineGroup = {
  status_id: string;
  status_code: string;
  status_name: string;
  status_color: string;
  status_order: number;
  is_checking: boolean;
  was_done: boolean;
  /** In the range (false: the comparison days before it). */
  current: boolean;
  /** The job is in a project the caller owns (PD-078 "Tôi quản lý"; only told apart for a Leader / Admin, else false). */
  led: boolean;
  lines: number;
  /** Not Done yet and past Ngày giao (finished groups ignore it). */
  past_deadline: number;
};

const doneMarker = new Date(0);

/**
 * Stats, status slices, the comparison counts and the Leader tab counts from the grouped lines. `mineOnly`: the stats
 * cover the led groups only ("Tôi quản lý"); the tab counts always cover both.
 */
export const summarizeOverviewLines = (workflow: Workflow, groups: readonly OverviewLineGroup[], mineOnly: boolean) => {
  const ids = lineFinishStatusIds(workflow);
  const stats: OverviewStats = { total: 0, notStarted: 0, inProgress: 0, done: 0, overdue: 0 };
  const previous = { total: 0, done: 0 };
  const tabs = { all: 0, mine: 0 };
  const slices = new Map<string, OverviewStatusSlice & { order: number }>();
  for (const group of groups) {
    const finished = isLineFinished(
      workflow,
      { statusId: group.status_id, isChecking: group.is_checking, doneAt: group.was_done ? doneMarker : null },
      ids
    );
    if (group.current) {
      tabs.all += group.lines;
      if (group.led) {
        tabs.mine += group.lines;
      }
    }
    if (mineOnly && !group.led) {
      continue;
    }
    if (!group.current) {
      previous.total += group.lines;
      previous.done += finished ? group.lines : 0;
      continue;
    }
    const overdue = finished ? 0 : group.past_deadline;
    stats.total += group.lines;
    stats.overdue += overdue;
    if (finished) {
      stats.done += group.lines;
    } else if (statusById(workflow, group.status_id)?.isInitial) {
      stats.notStarted += group.lines;
    } else {
      stats.inProgress += group.lines;
    }
    const slice = slices.get(group.status_id) ?? {
      status: { id: group.status_id, code: group.status_code, name: group.status_name, color: toColor(group.status_color) },
      count: 0,
      overdue: 0,
      order: group.status_order
    };
    slice.count += group.lines;
    slice.overdue += overdue;
    slices.set(group.status_id, slice);
  }
  const byStatus = [...slices.values()]
    .sort((a, b) => a.order - b.order || a.status.name.localeCompare(b.status.name))
    .map(({ status, count, overdue }) => ({ status, count, overdue }));
  return { stats, previous, tabs, byStatus };
};

export type OverviewVolumeRow = { project_id: string; code: string; name: string; qty: number; lines: number; without_qty: number };

/** Largest projects first (images, then lines, then code); after `take` of them the rest is one "Khác" slice. */
export const overviewVolumeSlices = (rows: readonly OverviewVolumeRow[], take = overviewProjectSlices): OverviewVolumeSlice[] => {
  const ranked = rows
    .filter((row) => row.qty > 0)
    .sort((a, b) => b.qty - a.qty || b.lines - a.lines || a.code.localeCompare(b.code));
  // A single leftover project is shown as itself rather than as "Khác (1 dự án)".
  const head = ranked.length === take + 1 ? ranked : ranked.slice(0, take);
  const rest = ranked.slice(head.length);
  const slices: OverviewVolumeSlice[] = head.map((row) => ({
    project: { id: row.project_id, code: row.code, name: row.name },
    projectCount: 1,
    qty: row.qty,
    lines: row.lines
  }));
  if (rest.length > 0) {
    slices.push({
      project: null,
      projectCount: rest.length,
      qty: rest.reduce((sum, row) => sum + row.qty, 0),
      lines: rest.reduce((sum, row) => sum + row.lines, 0)
    });
  }
  return slices;
};

// Reads ----------------------------------------------------------------------------------------------------------------

type DueRow = {
  id: string;
  number: string;
  job_id: string;
  job_code: string;
  project_id: string;
  project_code: string;
  project_name: string;
  process_id: string;
  process_name: string;
  assignee: UserRefJson;
  status_id: string;
  status_code: string;
  status_name: string;
  status_color: string;
  deadline: Date;
  overdue: boolean;
  qty_assigned: number | null;
  total: number;
};

type ProjectRow = {
  project_id: string;
  code: string;
  name: string;
  open_jobs: number;
  late_jobs: number;
  images_total: number;
  images_done: number;
  images_checked: number;
};

const toDueList = (window: OverviewRange, rows: readonly DueRow[]): OverviewDueList => ({
  ...window,
  total: rows[0]?.total ?? 0,
  items: rows.map((row) => ({
    id: row.id,
    code: String(row.number),
    jobId: row.job_id,
    jobCode: row.job_code,
    project: { id: row.project_id, code: row.project_code, name: row.project_name },
    process: { id: row.process_id, name: row.process_name },
    assignee: toUserRef(row.assignee)!,
    status: { id: row.status_id, code: row.status_code, name: row.status_name, color: toColor(row.status_color) },
    deadline: toIso(row.deadline),
    overdue: row.overdue,
    qtyAssigned: row.qty_assigned
  }))
});

const toProjectProgress = (row: ProjectRow): OverviewProjectProgress => ({
  project: { id: row.project_id, code: row.code, name: row.name },
  openJobs: row.open_jobs,
  lateJobs: row.late_jobs,
  imagesTotal: row.images_total,
  imagesDone: row.images_done,
  imagesChecked: row.images_checked
});

/**
 * GET /production/overview (PD-076). Any production member whose job "view" scope is not "none" (else 403, like the
 * job list); what they see is the job list's visibility (jobListFilterSql: view scope, live and not archived jobs,
 * PD-063 test accounts) plus lines assigned to a test account hidden from a real viewer. `scope=mine` (or the older
 * `leader=me`) keeps the jobs of the projects the caller owns (PD-078). A caller holding LEADER or ADMIN also gets the tab
 * counts (the status query then groups by "in a project I own" instead of filtering, so the tabs cost no extra query).
 */
export const getProductionOverview = async (
  context: AccessContext,
  query: ProductionOverviewQuery,
  now: Date = new Date()
): Promise<ProductionOverview> => {
  assertProductionMember(context);
  const sql = getSql();
  const organizationId = context.organization.id;
  const [scopes, settings, workflow] = await Promise.all([
    loadJobScopes(sql, context),
    loadSettings(sql, organizationId),
    loadWorkflowModel(sql, organizationId)
  ]);
  if (scopes.view === "none") {
    throw forbidden("Bạn không có quyền xem tổng quan job.");
  }
  const timeZone = settings.timezone;
  const today = dayInTimeZone(now, timeZone);
  const range = resolveOverviewRange(query, today);
  const chart = overviewChartRange(range);
  const comparison = overviewComparisonRange(range, today);
  const week = weekOfDay(today);
  const finish = lineFinishStatusIds(workflow);
  const mineOnly = query.scope === "mine" || query.leader === overviewLeaderMine;
  const leaderTabs = hasScopeTabs(context);
  const scopedJobs = JobQuerySchema.parse(mineOnly ? { scope: "mine" } : {});
  const everyJob = JobQuerySchema.parse({});

  // postgres.js fragments: a fresh one per use.
  const startOf = (day: string) => sql`((${day}::date)::timestamp AT TIME ZONE ${timeZone}::text)`;
  const endOf = (day: string) => sql`(((${day}::date) + 1)::timestamp AT TIME ZONE ${timeZone}::text)`;
  const dayOf = (column: SqlFragment) => sql`to_char(${column} AT TIME ZONE ${timeZone}::text, 'YYYY-MM-DD')`;
  const finishedAt = () => sql`coalesce(t.closed_at, t.checked_at, t.done_at)`;
  const visibleJobs = (jobQuery = scopedJobs) => jobListFilterSql(sql, context, scopes, jobQuery, [], { person: false });
  /**
   * Live lines (`subtasks`: and their subtasks) of the visible jobs, on t / j / pr (process) / st (status), plus `join`.
   * Lines assigned to a test account are hidden from a real viewer (PD-063).
   */
  const lines = ({ jobQuery = scopedJobs, subtasks = false, join = sql`` }: { jobQuery?: typeof scopedJobs; subtasks?: boolean; join?: SqlFragment } = {}) => sql`
    FROM production.tasks t
    JOIN production.jobs j ON j.organization_id = t.organization_id AND j.id = t.job_id
    JOIN production.processes pr ON pr.organization_id = t.organization_id AND pr.id = t.process_id
    JOIN production.statuses st ON st.organization_id = t.organization_id AND st.id = t.status_id
    ${join}
    WHERE t.organization_id = ${organizationId} AND t.deleted_at IS NULL
      ${subtasks ? sql`` : sql`AND ${notSubtaskSql(sql)}`}
      AND ${visibleUserIdSql(sql, context, sql`t.assignee_id`)}
      AND ${visibleJobs(jobQuery)}
  `;
  const received = () => sql`AND t.assigned_at >= ${startOf(range.from)} AND t.assigned_at < ${endOf(range.to)}`;
  const projectJoin = () => sql`JOIN production.projects p ON p.organization_id = j.organization_id AND p.id = j.project_id`;
  const dueLines = (window: OverviewRange) => sql<DueRow[]>`
    SELECT t.id, t.number::text AS number, t.job_id, j.code AS job_code,
      p.id AS project_id, p.code AS project_code, p.name AS project_name, pr.id AS process_id, pr.name AS process_name,
      ${userJsonSql(sql, "ua")} AS assignee,
      st.id AS status_id, st.code AS status_code, st.name AS status_name, st.color AS status_color,
      t.deadline, (t.done_at IS NULL AND t.deadline < ${now}) AS overdue, t.qty_assigned, count(*) OVER ()::int AS total
    ${lines({ join: sql`${projectJoin()} JOIN public.app_users ua ON ua.id = t.assignee_id` })}
      AND NOT ${lineFinishedSql(sql, finish, "pr")}
      AND t.deadline >= ${startOf(window.from)} AND t.deadline < ${endOf(window.to)}
    ORDER BY t.deadline, t.number
    LIMIT ${overviewDueLimit}
  `;

  const [groups, daily, volume, projects, dueToday, dueThisWeek] = await Promise.all([
    // The range's lines (and the comparison days before it) by status. A Leader's / Admin's lines are split by "in a
    // project I own" (the tab counts) instead of filtered; the stats then keep those for "Tôi quản lý".
    sql<OverviewLineGroup[]>`
      SELECT t.status_id, st.code AS status_code, st.name AS status_name, st.color AS status_color, st.sort_order AS status_order,
        pr.is_qc AS is_checking, (t.done_at IS NOT NULL) AS was_done, (t.assigned_at >= ${startOf(range.from)}) AS current,
        ${leaderTabs ? ownedProjectJobSql(sql, context) : sql`false`} AS led,
        count(*)::int AS lines, count(*) FILTER (WHERE t.done_at IS NULL AND t.deadline < ${now})::int AS past_deadline
      ${lines({ jobQuery: leaderTabs ? everyJob : scopedJobs })}
        AND t.assigned_at >= ${startOf(comparison?.from ?? range.from)} AND t.assigned_at < ${endOf(range.to)}
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9
    `,
    // Chart: lines received per day, and lines finished per day (whenever received).
    sql<{ kind: "received" | "done"; day: string; count: number }[]>`
      SELECT 'received' AS kind, ${dayOf(sql`t.assigned_at`)} AS day, count(*)::int AS count
      ${lines()}
        AND t.assigned_at >= ${startOf(chart.from)} AND t.assigned_at < ${endOf(chart.to)}
      GROUP BY 2
      UNION ALL
      SELECT 'done' AS kind, ${dayOf(finishedAt())} AS day, count(*)::int AS count
      ${lines()}
        AND ${lineFinishedSql(sql, finish, "pr")}
        AND ${finishedAt()} >= ${startOf(chart.from)} AND ${finishedAt()} < ${endOf(chart.to)}
      GROUP BY 2
    `,
    // Volume per project: images of the work rows (NORMAL lines and subtasks, not Checking) received in the range.
    sql<OverviewVolumeRow[]>`
      SELECT p.id AS project_id, p.code, p.name,
        coalesce(sum(t.qty_assigned) FILTER (WHERE t.kind = 'NORMAL' AND NOT pr.is_qc), 0)::int AS qty,
        count(*) FILTER (WHERE ${notSubtaskSql(sql)})::int AS lines,
        count(*) FILTER (WHERE t.kind = 'NORMAL' AND NOT pr.is_qc AND t.qty_assigned IS NULL)::int AS without_qty
      ${lines({ subtasks: true, join: projectJoin() })}
        ${received()}
      GROUP BY p.id, p.code, p.name
    `,
    // Progress of the active projects over their open jobs (not "đóng"): image totals as the job list computes them.
    sql<ProjectRow[]>`
      WITH open_jobs AS MATERIALIZED (
        SELECT j.id, j.project_id, j.total_images
        FROM production.jobs j
        JOIN production.job_statuses js ON js.organization_id = j.organization_id AND js.id = j.job_status_id
        WHERE ${visibleJobs()} AND NOT js.is_closed
      ),
      job_work AS (
        SELECT t.job_id,
          sum(coalesce(t.qty_done, 0)) FILTER (WHERE t.done_at IS NOT NULL AND t.kind = 'NORMAL' AND NOT tp.is_qc) AS qty_done,
          sum(coalesce(t.qty_done, 0)) FILTER (WHERE t.kind = 'NORMAL' AND (t.checked_at IS NOT NULL OR (tp.is_qc AND t.done_at IS NOT NULL))) AS qty_checked,
          bool_or(t.is_late AND t.done_at IS NULL AND t.closed_at IS NULL AND ${notSubtaskSql(sql)}) AS late
        FROM production.tasks t
        JOIN production.processes tp ON tp.organization_id = t.organization_id AND tp.id = t.process_id
        WHERE t.organization_id = ${organizationId} AND t.deleted_at IS NULL AND t.job_id IN (SELECT id FROM open_jobs)
        GROUP BY t.job_id
      )
      SELECT p.id AS project_id, p.code, p.name, count(*)::int AS open_jobs,
        count(*) FILTER (WHERE w.late)::int AS late_jobs,
        coalesce(sum(oj.total_images), 0)::int AS images_total,
        coalesce(sum(w.qty_done), 0)::int AS images_done,
        coalesce(sum(w.qty_checked), 0)::int AS images_checked
      FROM open_jobs oj
      JOIN production.projects p ON p.organization_id = ${organizationId} AND p.id = oj.project_id AND p.active
      LEFT JOIN job_work w ON w.job_id = oj.id
      GROUP BY p.id, p.code, p.name
      ORDER BY late_jobs DESC, open_jobs DESC, lower(p.code), p.id
    `,
    dueLines({ from: today, to: today }),
    dueLines(week)
  ]);

  const summary = summarizeOverviewLines(workflow, groups, mineOnly && leaderTabs);
  const dayCounts = (kind: "received" | "done") => new Map(daily.filter((row) => row.kind === kind).map((row) => [row.day, row.count]));
  return {
    today,
    timeZone,
    generatedAt: now.toISOString(),
    range,
    leaderTabs: leaderTabs ? summary.tabs : null,
    stats: summary.stats,
    previous: comparison ? { ...comparison, ...summary.previous } : null,
    byStatus: summary.byStatus,
    daily: { ...chart, days: fillOverviewDays(chart, dayCounts("received"), dayCounts("done")) },
    volume: {
      totalQty: volume.reduce((sum, row) => sum + row.qty, 0),
      withoutQty: volume.reduce((sum, row) => sum + row.without_qty, 0),
      slices: overviewVolumeSlices(volume)
    },
    projects: projects.map(toProjectProgress),
    dueToday: toDueList({ from: today, to: today }, dueToday),
    dueThisWeek: toDueList(week, dueThisWeek)
  };
};
