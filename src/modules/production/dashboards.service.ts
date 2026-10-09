import {
  ReportConfigSchema,
  type AdminDashboard,
  type DashboardTask,
  type LeaderDashboard,
  type ReportConfig,
  type ReportConfigInput
} from "../../contracts/production-reports.js";
import type { UserRef } from "../../contracts/work.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { toIso } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { assertProductionAdmin, assertProductionRole, isProductionAdmin } from "./access.js";
import { loadSettings } from "./catalog.service.js";
import { getKpiReport } from "./kpi-settlement.service.js";
import { executeReport } from "./reports.js";
import { listPinnedReports } from "./saved-reports.service.js";
import { periodOfDay, periodRange, weekStart } from "./scoring.js";
import { addDays, businessDay, startOfBusinessDay } from "./time.js";

/** Leader and Admin dashboards (SPEC Phase 5 §2–§3). Report-backed cards run through executeReport. */

const org = (context: AccessContext) => context.organization.id;
const taskListLimit = 200;
const teamWeeks = 8;

type UserCols = { id: string; display_name: string; email: string | null; avatar_url: string | null };
const userRef = (row: UserCols): UserRef => ({ id: row.id, displayName: row.display_name, email: row.email, avatarUrl: row.avatar_url });

type OpenTaskRow = {
  id: string;
  number: string;
  job_id: string;
  job_code: string;
  assignee: UserCols;
  qc: UserCols | null;
  status_id: string;
  status_code: string;
  status_name: string;
  status_color: string;
  qty_assigned: number;
  deadline: Date;
};

const toDashboardTask = (row: OpenTaskRow, now: number): DashboardTask => ({
  id: row.id,
  number: Number(row.number),
  job: { id: row.job_id, code: row.job_code },
  assignee: userRef(row.assignee),
  qc: row.qc ? userRef(row.qc) : null,
  status: { id: row.status_id, code: row.status_code, name: row.status_name, color: row.status_color as DashboardTask["status"]["color"] },
  qtyAssigned: row.qty_assigned,
  deadline: toIso(row.deadline),
  minutes: Math.max(0, Math.round(Math.abs(row.deadline.getTime() - now) / 60_000))
});

/**
 * GET /production/dashboard/leader — LEADER: open tasks of the jobs they lead that are late (red) or due
 * within settings.dueSoonHours (amber); today's workload of every worker (all jobs, so the leader can
 * pick who to give work to); team points per week. ADMIN sees every job, or one leader's with leaderId.
 */
export const getLeaderDashboard = async (context: AccessContext, query: { leaderId?: string | undefined }): Promise<LeaderDashboard> => {
  assertProductionRole(context, "LEADER");
  const admin = isProductionAdmin(context);
  if (query.leaderId && !admin && query.leaderId !== context.user.id) {
    throw new AppError("FORBIDDEN", "Bạn chỉ xem được dashboard của mình.", 403);
  }
  const leaderId = query.leaderId ?? (admin ? null : context.user.id);
  const sql = getSql();
  const organizationId = org(context);
  const settings = await loadSettings(sql, organizationId);
  const now = new Date();
  const today = businessDay(now);
  const dueSoonHours = settings.dueSoonHours;
  const dueSoonUntil = new Date(now.getTime() + dueSoonHours * 3_600_000);
  const todayStart = startOfBusinessDay(today);
  const tomorrowStart = startOfBusinessDay(addDays(today, 1));

  const scope = leaderId ? sql`AND j.leader_id = ${leaderId}` : sql``;
  const openTasks = (window: ReturnType<typeof sql>) => sql<OpenTaskRow[]>`
    SELECT t.id, t.number::text AS number, t.job_id, j.code AS job_code,
      json_build_object('id', ua.id, 'display_name', ua.display_name, 'email', ua.email, 'avatar_url', ua.avatar_url) AS assignee,
      CASE WHEN uq.id IS NULL THEN NULL
        ELSE json_build_object('id', uq.id, 'display_name', uq.display_name, 'email', uq.email, 'avatar_url', uq.avatar_url) END AS qc,
      s.id AS status_id, s.code AS status_code, s.name AS status_name, s.color AS status_color, t.qty_assigned, t.deadline
    FROM production.tasks t
    JOIN production.jobs j ON j.organization_id = t.organization_id AND j.id = t.job_id
    JOIN production.statuses s ON s.organization_id = t.organization_id AND s.id = t.status_id
    JOIN public.app_users ua ON ua.id = t.assignee_id
    LEFT JOIN public.app_users uq ON uq.id = t.qc_id
    WHERE t.organization_id = ${organizationId} AND t.done_at IS NULL ${window}
      AND j.archived_at IS NULL ${scope}
    ORDER BY t.deadline, t.number
    LIMIT ${taskListLimit}
  `;
  const [late, dueSoon, counts, workload] = await Promise.all([
    openTasks(sql`AND t.deadline < ${now}`),
    openTasks(sql`AND t.deadline >= ${now} AND t.deadline < ${dueSoonUntil}`),
    sql<{ late: number; due_soon: number }[]>`
      SELECT count(*) FILTER (WHERE t.deadline < ${now})::int AS late, count(*) FILTER (WHERE t.deadline >= ${now})::int AS due_soon
      FROM production.tasks t
      JOIN production.jobs j ON j.organization_id = t.organization_id AND j.id = t.job_id
      WHERE t.organization_id = ${organizationId} AND t.done_at IS NULL AND t.deadline < ${dueSoonUntil}
        AND j.archived_at IS NULL ${scope}
    `,
    sql<
      {
        user_id: string;
        display_name: string;
        email: string | null;
        avatar_url: string | null;
        team_id: string | null;
        team_name: string | null;
        qty_not_started: number;
        qty_processing: number;
        open_tasks: number;
        qty_done_today: number;
        tasks_done_today: number;
        leave_today: "FULL_DAY" | "MORNING" | "AFTERNOON" | null;
      }[]
    >`
      WITH open_tasks AS (
        SELECT t.assignee_id,
          coalesce(sum(t.qty_assigned) FILTER (WHERE s.code = 'ASSIGNED'), 0)::int AS qty_not_started,
          coalesce(sum(t.qty_assigned) FILTER (WHERE s.code = 'PROCESSING'), 0)::int AS qty_processing,
          count(*)::int AS open_tasks
        FROM production.tasks t
        JOIN production.statuses s ON s.organization_id = t.organization_id AND s.id = t.status_id
        WHERE t.organization_id = ${organizationId} AND s.code IN ('ASSIGNED', 'PROCESSING')
        GROUP BY t.assignee_id
      ), done_today AS (
        SELECT t.assignee_id, coalesce(sum(t.qty_done), 0)::int AS qty_done_today, count(*)::int AS tasks_done_today
        FROM production.tasks t
        WHERE t.organization_id = ${organizationId} AND t.done_at >= ${todayStart} AND t.done_at < ${tomorrowStart}
        GROUP BY t.assignee_id
      ), leave_today AS (
        SELECT user_id,
          CASE WHEN bool_or(part = 'FULL_DAY') OR (bool_or(part = 'MORNING') AND bool_or(part = 'AFTERNOON')) THEN 'FULL_DAY'
               WHEN bool_or(part = 'MORNING') THEN 'MORNING' ELSE 'AFTERNOON' END AS part
        FROM production.leave_requests
        WHERE organization_id = ${organizationId} AND status = 'APPROVED' AND from_date <= ${today}::date AND to_date >= ${today}::date
        GROUP BY user_id
      ), workers AS (
        SELECT ur.user_id FROM production.user_roles ur
        JOIN public.organization_memberships om
          ON om.organization_id = ur.organization_id AND om.user_id = ur.user_id AND om.deleted_at IS NULL AND om.status = 'active'
        WHERE ur.organization_id = ${organizationId} AND ur.role_code IN ('STAFF', 'LEADER')
        UNION SELECT assignee_id FROM open_tasks
        UNION SELECT assignee_id FROM done_today
      )
      SELECT au.id AS user_id, au.display_name, au.email, au.avatar_url, mp.team_id, tm.name AS team_name,
        coalesce(o.qty_not_started, 0) AS qty_not_started, coalesce(o.qty_processing, 0) AS qty_processing,
        coalesce(o.open_tasks, 0) AS open_tasks, coalesce(d.qty_done_today, 0) AS qty_done_today,
        coalesce(d.tasks_done_today, 0) AS tasks_done_today, lv.part AS leave_today
      FROM workers w
      JOIN public.app_users au ON au.id = w.user_id
      LEFT JOIN open_tasks o ON o.assignee_id = w.user_id
      LEFT JOIN done_today d ON d.assignee_id = w.user_id
      LEFT JOIN leave_today lv ON lv.user_id = w.user_id
      LEFT JOIN production.member_profiles mp ON mp.organization_id = ${organizationId} AND mp.user_id = w.user_id
      LEFT JOIN production.teams tm ON tm.organization_id = ${organizationId} AND tm.id = mp.team_id
      ORDER BY au.display_name, au.id
      LIMIT 1000
    `
  ]);

  // Team points per week (last 8 weeks, current one included) through the report layer.
  const lastWeek = weekStart(today);
  const weeks = Array.from({ length: teamWeeks }, (_, index) => addDays(lastWeek, (index - (teamWeeks - 1)) * 7));
  const teamReport = await executeReport(
    sql,
    organizationId,
    ReportConfigSchema.parse({ dimensions: ["team", "week"], measures: ["points", "points_khoan"], from: weeks[0], to: addDays(lastWeek, 6) }),
    { today, closeDay: settings.kpiCloseDay }
  );
  const series = new Map<string, { teamId: string | null; teamName: string; points: number[]; pointsKhoan: number[] }>();
  for (const row of teamReport.rows) {
    const teamId = (row.team as string | null) ?? null;
    const key = teamId ?? "";
    const entry = series.get(key) ?? { teamId, teamName: String(row.team_label), points: weeks.map(() => 0), pointsKhoan: weeks.map(() => 0) };
    const index = weeks.indexOf(String(row.week));
    if (index >= 0) {
      entry.points[index] = Number(row.points ?? 0);
      entry.pointsKhoan[index] = Number(row.points_khoan ?? 0);
    }
    series.set(key, entry);
  }

  const nowMs = now.getTime();
  return {
    generatedAt: now.toISOString(),
    today,
    dueSoonHours,
    leaderId,
    counts: { late: counts[0]?.late ?? 0, dueSoon: counts[0]?.due_soon ?? 0 },
    late: late.map((row) => toDashboardTask(row, nowMs)),
    dueSoon: dueSoon.map((row) => toDashboardTask(row, nowMs)),
    workload: workload.map((row) => ({
      user: { id: row.user_id, displayName: row.display_name, email: row.email, avatarUrl: row.avatar_url },
      teamId: row.team_id,
      teamName: row.team_name,
      qtyNotStarted: row.qty_not_started,
      qtyProcessing: row.qty_processing,
      openTasks: row.open_tasks,
      qtyDoneToday: row.qty_done_today,
      tasksDoneToday: row.tasks_done_today,
      leaveToday: row.leave_today
    })),
    teamPoints: {
      weeks,
      series: [...series.values()].sort((a, b) => (a.teamId === null ? 1 : b.teamId === null ? -1 : a.teamName.localeCompare(b.teamName, "vi")))
    }
  };
};

// Admin --------------------------------------------------------------------------------------------------

const config = (input: ReportConfigInput): ReportConfig => ReportConfigSchema.parse(input);

/** The report-builder configs behind the Admin cards (also what a click on a card opens). */
export const adminCardConfigs = () => ({
  pointsToday: config({ dimensions: ["team"], measures: ["points", "points_khoan", "qty_done"], preset: "TODAY", view: { type: "BAR", rows: ["team"] } }),
  lateJobs: config({
    dimensions: ["job"],
    measures: ["late_count", "task_count"],
    taskDate: "DEADLINE",
    filters: { taskState: "OPEN" },
    preset: "LAST_30_DAYS",
    sort: { key: "late_count", direction: "desc" }
  }),
  fbRateByUser: config({
    dimensions: ["user"],
    measures: ["fb_rate", "fb_wrong_count", "task_count"],
    preset: "THIS_MONTH",
    sort: { key: "fb_rate", direction: "desc" },
    limit: 5,
    view: { type: "BAR", rows: ["user"] }
  }),
  fbRateByClient: config({
    dimensions: ["client"],
    measures: ["fb_rate", "fb_wrong_count", "task_count"],
    preset: "THIS_MONTH",
    sort: { key: "fb_rate", direction: "desc" },
    limit: 5,
    view: { type: "BAR", rows: ["client"] }
  }),
  productivityByShift: config({
    dimensions: ["shift"],
    measures: ["qty_per_worker_day", "qty_done", "task_count"],
    preset: "THIS_MONTH",
    view: { type: "BAR", rows: ["shift"] }
  }),
  kpiAttainment: config({ dimensions: ["user"], measures: ["points"], preset: "THIS_PERIOD", sort: { key: "points", direction: "desc" } })
});

const kpiBuckets = [
  { key: "LT50", label: "Dưới 50%", max: 50 },
  { key: "LT80", label: "50% – dưới 80%", max: 80 },
  { key: "LT100", label: "80% – dưới 100%", max: 100 },
  { key: "MET", label: "Đạt từ 100%", max: Number.POSITIVE_INFINITY }
] as const;

/** GET /production/dashboard/admin — the 6 SPEC cards plus the pinned saved reports. ADMIN only. */
export const getAdminDashboard = async (context: AccessContext): Promise<AdminDashboard> => {
  assertProductionAdmin(context);
  const sql = getSql();
  const organizationId = org(context);
  const settings = await loadSettings(sql, organizationId);
  const now = new Date();
  const today = businessDay(now);
  const closeDay = settings.kpiCloseDay;
  const period = periodOfDay(today, closeDay);
  const configs = adminCardConfigs();
  const run = (cardConfig: ReportConfig) => executeReport(sql, organizationId, cardConfig, { today, closeDay });

  const [pointsToday, fbRateByUser, fbRateByClient, productivityByShift, lateJobs, kpi, pinned] = await Promise.all([
    run(configs.pointsToday),
    run(configs.fbRateByUser),
    run(configs.fbRateByClient),
    run(configs.productivityByShift),
    sql<
      {
        id: string;
        number: string;
        code: string;
        project_code: string;
        leader: UserCols;
        deadline: Date;
        late_tasks: number;
        oldest: Date;
        job_count: number;
        task_count: number;
      }[]
    >`
      SELECT j.id, j.number::text AS number, j.code, p.code AS project_code,
        json_build_object('id', u.id, 'display_name', u.display_name, 'email', u.email, 'avatar_url', u.avatar_url) AS leader,
        j.deadline, count(*)::int AS late_tasks, min(t.deadline) AS oldest,
        (count(*) OVER ())::int AS job_count, (sum(count(*)) OVER ())::int AS task_count
      FROM production.tasks t
      JOIN production.jobs j ON j.organization_id = t.organization_id AND j.id = t.job_id
      JOIN production.projects p ON p.organization_id = j.organization_id AND p.id = j.project_id
      JOIN public.app_users u ON u.id = j.leader_id
      WHERE t.organization_id = ${organizationId} AND t.done_at IS NULL AND t.deadline < ${now} AND j.archived_at IS NULL
      GROUP BY j.id, p.code, u.id
      ORDER BY min(t.deadline), j.code
      LIMIT 50
    `,
    // Phase 6 KPI report (settled figures, or what a settlement would give now): % = total points / target.
    getKpiReport(context, { from: period, to: period }),
    listPinnedReports(sql, organizationId)
  ]);

  const kpiRows = kpi.rows.filter((row) => row.period === period);
  const withTarget = kpiRows.filter((row) => row.percent !== null);
  const buckets = kpiBuckets.map((bucket, index) => {
    const min = index === 0 ? Number.NEGATIVE_INFINITY : kpiBuckets[index - 1]!.max;
    return { key: bucket.key, label: bucket.label, count: withTarget.filter((row) => row.percent! >= min && row.percent! < bucket.max).length };
  });
  const range = periodRange(period, closeDay);

  return {
    generatedAt: now.toISOString(),
    today,
    period: { key: period, from: range.from, to: range.to },
    cards: {
      pointsToday: { title: "Điểm hôm nay toàn team", config: configs.pointsToday, result: pointsToday },
      lateJobs: {
        title: "Job đang trễ",
        config: configs.lateJobs,
        jobCount: lateJobs[0]?.job_count ?? 0,
        taskCount: lateJobs[0]?.task_count ?? 0,
        items: lateJobs.map((row) => ({
          job: { id: row.id, number: Number(row.number), code: row.code },
          projectCode: row.project_code,
          leader: userRef(row.leader),
          deadline: toIso(row.deadline),
          lateTaskCount: row.late_tasks,
          oldestDeadline: toIso(row.oldest)
        }))
      },
      fbRateByUser: { title: "Tỉ lệ FB tháng theo nhân viên (top 5)", config: configs.fbRateByUser, result: fbRateByUser },
      fbRateByClient: { title: "Tỉ lệ FB theo client (top 5)", config: configs.fbRateByClient, result: fbRateByClient },
      productivityByShift: { title: "Năng suất theo ca (tấm/người/ngày)", config: configs.productivityByShift, result: productivityByShift },
      kpiAttainment: {
        title: "% đạt KPI kỳ hiện tại",
        config: configs.kpiAttainment,
        period,
        members: kpiRows.length,
        withoutTarget: kpiRows.length - withTarget.length,
        averagePercent:
          withTarget.length === 0 ? null : Math.round((withTarget.reduce((sum, row) => sum + row.percent!, 0) / withTarget.length) * 100) / 100,
        buckets
      }
    },
    pinned
  };
};
