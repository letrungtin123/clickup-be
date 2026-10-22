import { JobQuerySchema } from "../../contracts/production-jobs.js";
import { taskJobScopes, type JobStatusKind } from "../../contracts/production-catalog.js";
import {
  defaultOverviewScope,
  getsAccountNeeds,
  getsLeaderNeeds,
  hasOverviewScopeSwitch,
  overviewLeaderMine,
  overviewTaskStages,
  seesOverview,
  seesRiskHistory,
  type OverviewRange,
  type OverviewTaskStage,
  type ProductionOverview,
  type ProductionOverviewQuery,
  type RiskHistory,
  type RiskHistoryQuery,
  type TeamLoad
} from "../../contracts/production-overview.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { toIso, type QuerySql } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { visibleUserIdSql, visibleUserSql } from "../access/test-accounts.js";
import { toColor, toUserRef, type UserRefJson } from "../work/mappers.js";
import { userJsonSql } from "../work/tasks.repo.js";
import { assertProductionMember, productionRolesOf } from "./access.js";
import { loadSettings } from "./catalog.service.js";
import { alertMinutesOf, coreWindowOf, zonedDay, zonedInstant } from "./core-clock.js";
import { forbidden, loadJobScopes } from "./job-permissions.js";
import { loadWorkflowModel, notSubtaskSql } from "./jobs.repo.js";
import { jobListFilterSql, ownedProjectJobSql } from "./jobs.service.js";
import { accountNeedsOf, buildOverviewJobs, leaderNeedsOf, overviewCards, type OverviewJobRow, type OverviewLineRow, type OverviewRiskRow } from "./overview-model.js";
import { taskCode } from "./task-codes.js";
import { addDays } from "./time.js";
import { isLineFinished, lineFinishStatusIds, type Workflow } from "./workflow.js";

/**
 * PD-080 — "Tổng quan" (Overview V2) of Photo Retouch for Leaders, Accounts, Quản trị and Director: GET /production/overview
 * (cards, "Cần bạn xử lý", the jobs grouped by project in the app), GET /production/team-load (Chia task suggestions) and
 * GET /production/overview/risk-history (superadmin / Director). Definitions: contracts/production-overview.ts; the rules
 * themselves are pure functions in overview-model.ts (time rules, stages, cards, needs), core-clock.ts (core-window
 * clocks) and at-risk.ts (the worker's estimate, read here from production.job_risk_episodes).
 *
 * The overview read is a fixed number of grouped queries whatever the data: the candidate jobs (client deadline in the
 * range, client-late, or with a line due in the range / overdue — with their last activity, creator role and "owned"
 * flag), their lines (subtask quantities summed, when each waiting line entered Chờ QC), who is on leave now, and the open
 * At risk episodes. Settings and workflow come from the per-organization config cache.
 */

const overviewForbidden = () =>
  new AppError("OVERVIEW_FORBIDDEN", "Tổng quan dành cho Leader, Account, Quản trị và Director — xem “Việc của tôi”.", 403);

/** Calendar day (YYYY-MM-DD) of `at` in `timeZone`. */
export const dayInTimeZone = (at: Date, timeZone: string) => zonedDay(at, timeZone);

/** The range asked for; a missing end is the other one, both missing = today. */
export const resolveOverviewRange = (query: Pick<ProductionOverviewQuery, "from" | "to">, today: string): OverviewRange => ({
  from: query.from ?? query.to ?? today,
  to: query.to ?? query.from ?? today
});

/** [start, end) instants of a range of organization days. */
export const rangeInstants = (range: OverviewRange, timeZone: string) => ({
  start: zonedInstant(range.from, "00:00", timeZone),
  end: zonedInstant(addDays(range.to, 1), "00:00", timeZone)
});

/** The organization's names of the dropdown stages (from the workflow statuses; Complete for the later ones). */
export const stageNamesOf = (workflow: Workflow) =>
  overviewTaskStages.map((stage) => ({
    stage,
    name: workflow.statuses.find((status) => status.code === stage)?.name ?? stageFallbackNames[stage]
  }));
const stageFallbackNames: Record<OverviewTaskStage, string> = {
  ASSIGNED: "Mới giao",
  PROCESSING: "Đang làm",
  REWORK: "Cần sửa lại",
  WAITING_QC: "Chờ QC",
  QC_CHECKING: "Đang check",
  FEEDBACK: "Feedback",
  CHECKED: "Đã check",
  COMPLETE: "Complete"
};

type JobDbRow = {
  id: string;
  code: string;
  name: string | null;
  project_id: string;
  project_code: string;
  project_name: string;
  leader: UserRefJson | null;
  received_at: Date;
  deadline: Date;
  created_at: Date;
  created_by_account: boolean;
  total_images: number;
  status_id: string;
  status_name: string;
  status_color: string;
  status_kind: JobStatusKind;
  owned: boolean;
  last_activity_at: Date;
};

type LineDbRow = {
  id: string;
  job_id: string;
  number: string;
  process_id: string;
  process_name: string;
  is_qc: boolean;
  assignee: UserRefJson;
  qc: UserRefJson | null;
  status_id: string;
  status_code: string;
  status_name: string;
  status_color: string;
  assigned_at: Date;
  deadline: Date;
  done_at: Date | null;
  qty_assigned: number | null;
  qty_done: number | null;
  note: string | null;
  waiting_since: Date | null;
};

type RiskDbRow = {
  job_id: string;
  reason: "CAPACITY" | "UNASSIGNED";
  started_at: Date;
  evaluated_at: Date;
  work_hours: string;
  capacity_hours: string;
  hours_left: string;
  people: number;
};

const toJobRow = (row: JobDbRow): OverviewJobRow => ({
  id: row.id,
  code: row.code,
  name: row.name,
  project: { id: row.project_id, code: row.project_code, name: row.project_name },
  leader: toUserRef(row.leader),
  receivedAt: row.received_at,
  deadline: row.deadline,
  createdAt: row.created_at,
  createdByAccount: row.created_by_account,
  totalImages: row.total_images,
  status: { id: row.status_id, name: row.status_name, color: toColor(row.status_color), kind: row.status_kind },
  owned: row.owned,
  lastActivityAt: row.last_activity_at
});

const toLineRow = (row: LineDbRow, workflow: Workflow, finish: ReturnType<typeof lineFinishStatusIds>): OverviewLineRow => ({
  id: row.id,
  jobId: row.job_id,
  number: Number(row.number),
  code: taskCode({ number: Number(row.number), subSeq: null, parentNumber: null }),
  process: { id: row.process_id, name: row.process_name, isQc: row.is_qc },
  assignee: toUserRef(row.assignee)!,
  qc: toUserRef(row.qc),
  status: { id: row.status_id, code: row.status_code, name: row.status_name, color: toColor(row.status_color) },
  assignedAt: row.assigned_at,
  deadline: row.deadline,
  doneAt: row.done_at,
  finished: isLineFinished(workflow, { statusId: row.status_id, isChecking: row.is_qc, doneAt: row.done_at }, finish),
  qtyAssigned: row.qty_assigned,
  qtyDone: row.qty_done,
  note: row.note,
  waitingSince: row.waiting_since
});

/** Who is on approved leave at `now` (organization time), among the organization's members. */
const loadOnLeaveNow = async (sql: QuerySql, organizationId: string, now: Date, timeZone: string) =>
  new Set(
    (
      await sql<{ user_id: string }[]>`
        SELECT DISTINCT user_id FROM production.leave_requests
        WHERE organization_id = ${organizationId} AND status = 'APPROVED'
          AND slot_range @> (${now}::timestamptz AT TIME ZONE ${timeZone}::text)
      `
    ).map((row) => row.user_id)
  );

/**
 * GET /production/overview (PD-080). Holders of LEADER / ACCOUNT / ADMIN / DIRECTOR (else 403 OVERVIEW_FORBIDDEN); the job
 * list's visibility (view scope — "none" → 403 —, live and not archived jobs, PD-063 test accounts). `scope` (default by
 * role) keeps the jobs of the projects the caller co-owns ("mine") or every visible job ("all").
 */
export const getProductionOverview = async (context: AccessContext, query: ProductionOverviewQuery, now: Date = new Date()): Promise<ProductionOverview> => {
  assertProductionMember(context);
  const roles = [...productionRolesOf(context)];
  if (!seesOverview(roles)) {
    throw overviewForbidden();
  }
  const sql = getSql();
  const organizationId = context.organization.id;
  const [scopes, settings, workflow] = await Promise.all([loadJobScopes(sql, context), loadSettings(sql, organizationId), loadWorkflowModel(sql, organizationId)]);
  if (scopes.view === "none") {
    throw forbidden("Bạn không có quyền xem tổng quan job.");
  }
  const window = coreWindowOf(settings);
  const timeZone = window.timeZone;
  const today = dayInTimeZone(now, timeZone);
  const range = resolveOverviewRange(query, today);
  const instants = rangeInstants(range, timeZone);
  const defaultScope = defaultOverviewScope(roles);
  const scope = query.scope ?? (query.leader === overviewLeaderMine ? "mine" : defaultScope);
  const finish = lineFinishStatusIds(workflow);
  const everyJob = JobQuerySchema.parse({});
  const visibleJobs = () => jobListFilterSql(sql, context, scopes, everyJob, [], { person: false });
  const openLine = () => sql`(t.done_at IS NULL AND t.closed_at IS NULL AND t.deadline < ${now})`;

  const jobs = await sql<JobDbRow[]>`
    SELECT j.id, j.code, j.name, p.id AS project_id, p.code AS project_code, p.name AS project_name,
      CASE WHEN ul.id IS NULL THEN NULL ELSE ${userJsonSql(sql, "ul")} END AS leader,
      j.received_at, j.deadline, j.created_at, j.total_images,
      js.id AS status_id, js.name AS status_name, js.color AS status_color, js.kind AS status_kind,
      ${ownedProjectJobSql(sql, context)} AS owned,
      EXISTS (
        SELECT 1 FROM production.user_roles ur
        WHERE ur.organization_id = j.organization_id AND ur.user_id = j.created_by AND ur.role_code = 'ACCOUNT'
      ) AS created_by_account,
      greatest(
        j.created_at,
        (SELECT max(l.created_at) FROM production.task_logs l WHERE l.organization_id = j.organization_id AND l.job_id = j.id),
        (SELECT max(c.created_at) FROM production.comments c WHERE c.organization_id = j.organization_id AND c.job_id = j.id AND c.deleted_at IS NULL)
      ) AS last_activity_at
    FROM production.jobs j
    JOIN production.job_statuses js ON js.organization_id = j.organization_id AND js.id = j.job_status_id
    JOIN production.projects p ON p.organization_id = j.organization_id AND p.id = j.project_id
    LEFT JOIN public.app_users ul ON ul.id = j.leader_id
    WHERE ${visibleJobs()}
      AND (
        (j.deadline >= ${instants.start} AND j.deadline < ${instants.end})
        OR (j.deadline < ${now} AND js.kind NOT IN ('DELIVERING', 'DELIVERED'))
        OR EXISTS (
          SELECT 1 FROM production.tasks t
          WHERE t.organization_id = j.organization_id AND t.job_id = j.id AND t.deleted_at IS NULL AND ${notSubtaskSql(sql)}
            AND ${visibleUserIdSql(sql, context, sql`t.assignee_id`)}
            AND ((t.deadline >= ${instants.start} AND t.deadline < ${instants.end}) OR ${openLine()})
        )
      )
  `;
  const jobIds = jobs.map((job) => job.id);
  const [lines, onLeaveNow, risks] = await Promise.all([
    jobIds.length === 0
      ? []
      : sql<LineDbRow[]>`
          SELECT t.id, t.job_id, t.number::text AS number, pr.id AS process_id, pr.name AS process_name, pr.is_qc,
            ${userJsonSql(sql, "ua")} AS assignee,
            CASE WHEN uq.id IS NULL THEN NULL ELSE ${userJsonSql(sql, "uq")} END AS qc,
            st.id AS status_id, st.code AS status_code, st.name AS status_name, st.color AS status_color,
            t.assigned_at, t.deadline, t.done_at, t.note,
            CASE WHEN t.qty_assigned IS NULL AND s.qty_assigned IS NULL THEN NULL ELSE (coalesce(t.qty_assigned, 0) + coalesce(s.qty_assigned, 0))::int END AS qty_assigned,
            CASE WHEN t.qty_done IS NULL AND s.qty_done IS NULL THEN NULL ELSE (coalesce(t.qty_done, 0) + coalesce(s.qty_done, 0))::int END AS qty_done,
            w.since AS waiting_since
          FROM production.tasks t
          JOIN production.processes pr ON pr.organization_id = t.organization_id AND pr.id = t.process_id
          JOIN production.statuses st ON st.organization_id = t.organization_id AND st.id = t.status_id
          JOIN public.app_users ua ON ua.id = t.assignee_id
          LEFT JOIN public.app_users uq ON uq.id = t.qc_id
          LEFT JOIN LATERAL (
            SELECT sum(c.qty_assigned)::int AS qty_assigned, sum(c.qty_done)::int AS qty_done
            FROM production.tasks c
            WHERE c.organization_id = t.organization_id AND c.parent_task_id = t.id AND c.kind = 'NORMAL' AND c.deleted_at IS NULL
          ) s ON true
          LEFT JOIN LATERAL (
            SELECT max(l.created_at) AS since FROM production.task_logs l
            WHERE l.organization_id = t.organization_id AND l.task_id = t.id AND l.action = 'STATUS' AND l.to_value->>'code' = 'WAITING_QC'
          ) w ON st.code IN ('DONE', 'WAITING_QC')
          WHERE t.organization_id = ${organizationId} AND t.job_id = ANY(${jobIds}::uuid[]) AND t.deleted_at IS NULL AND ${notSubtaskSql(sql)}
            AND ${visibleUserIdSql(sql, context, sql`t.assignee_id`)}
        `,
    loadOnLeaveNow(sql, organizationId, now, timeZone),
    jobIds.length === 0
      ? []
      : sql<RiskDbRow[]>`
          SELECT job_id, reason, started_at, evaluated_at, work_hours::text, capacity_hours::text, hours_left::text, people
          FROM production.job_risk_episodes
          WHERE organization_id = ${organizationId} AND ended_at IS NULL AND job_id = ANY(${jobIds}::uuid[])
        `
  ]);

  const riskMap = new Map<string, OverviewRiskRow>(
    risks.map((row) => [
      row.job_id,
      {
        reason: row.reason,
        since: row.started_at,
        evaluatedAt: row.evaluated_at,
        workHours: Number(row.work_hours),
        capacityHours: Number(row.capacity_hours),
        hoursLeft: Number(row.hours_left),
        people: row.people
      }
    ])
  );
  const scopeSwitch = hasOverviewScopeSwitch(roles);
  const built = buildOverviewJobs({
    now,
    range: instants,
    window,
    alertMinutes: alertMinutesOf(settings),
    jobs: jobs.map(toJobRow),
    lines: lines.map((row) => toLineRow(row, workflow, finish)),
    onLeaveNow,
    risks: riskMap
  });
  const shown = scope === "mine" ? built.filter((job) => job.owned) : built;
  const leaderNeeds = getsLeaderNeeds(roles);
  const accountNeeds = getsAccountNeeds(roles);
  const taskCreate = taskJobScopes(roles, settings.jobPermissions).create;
  return {
    today,
    timeZone,
    generatedAt: now.toISOString(),
    range,
    scope,
    viewer: {
      scopeSwitch,
      defaultScope,
      leaderNeeds,
      accountNeeds,
      canAssign: taskCreate !== "none" && (roles.includes("LEADER") || roles.includes("ADMIN")),
      riskHistory: seesRiskHistory(roles)
    },
    scopeCounts: { mine: scopeSwitch ? built.filter((job) => job.owned).length : 0, all: built.length },
    clock: { coreStart: window.start, coreEnd: window.end, alertHours: settings.alertAfterHours ?? 2 },
    stageNames: stageNamesOf(workflow),
    cards: overviewCards(shown),
    leaderNeeds: leaderNeeds ? leaderNeedsOf(shown) : null,
    accountNeeds: accountNeeds ? accountNeedsOf(shown) : null,
    jobs: shown
  };
};

// Team load ------------------------------------------------------------------------------------------------------------

type MemberDbRow = { user: UserRefJson; roles: string[]; leave_part: "FULL_DAY" | "MORNING" | "AFTERNOON" | null; leave_now: boolean };
type LoadDbRow = { assignee_id: string; project_id: string; project_code: string; images: number; tasks: number; without_qty: number };

/**
 * GET /production/team-load (PD-080): "ảnh đang ôm" of every active production member holding STAFF, QC or LEADER (lines
 * and subtasks in Mới giao / Đang làm / Cần sửa lại of live, not archived jobs — not Chờ QC), per project, and their
 * approved leave today. For LEADER / ADMIN (they split tasks). Two grouped queries.
 */
export const getTeamLoad = async (context: AccessContext, now: Date = new Date()): Promise<TeamLoad> => {
  assertProductionMember(context);
  const roles = productionRolesOf(context);
  if (!roles.has("LEADER") && !roles.has("ADMIN")) {
    throw forbidden("Chỉ Leader và Quản trị xem tải việc của team.");
  }
  const sql = getSql();
  const organizationId = context.organization.id;
  const settings = await loadSettings(sql, organizationId);
  const timeZone = coreWindowOf(settings).timeZone;
  const today = dayInTimeZone(now, timeZone);
  const [members, loads] = await Promise.all([
    sql<MemberDbRow[]>`
      SELECT ${userJsonSql(sql, "au")} AS user, array_agg(DISTINCT ur.role_code ORDER BY ur.role_code) AS roles,
        (SELECT lr.part FROM production.leave_requests lr
          WHERE lr.organization_id = ur.organization_id AND lr.user_id = ur.user_id AND lr.status = 'APPROVED'
            AND ${today}::date BETWEEN lr.from_date AND lr.to_date
          ORDER BY (lr.part = 'FULL_DAY') DESC, lr.from_date LIMIT 1) AS leave_part,
        EXISTS (SELECT 1 FROM production.leave_requests lr
          WHERE lr.organization_id = ur.organization_id AND lr.user_id = ur.user_id AND lr.status = 'APPROVED'
            AND lr.slot_range @> (${now}::timestamptz AT TIME ZONE ${timeZone}::text)) AS leave_now
      FROM production.user_roles ur
      JOIN public.organization_memberships om
        ON om.organization_id = ur.organization_id AND om.user_id = ur.user_id AND om.deleted_at IS NULL AND om.status = 'active'
      JOIN public.app_users au ON au.id = ur.user_id
      WHERE ur.organization_id = ${organizationId} AND ur.role_code IN ('STAFF', 'QC', 'LEADER')
        AND ${visibleUserSql(sql, context)}
      GROUP BY ur.organization_id, ur.user_id, au.id, au.display_name, au.email, au.avatar_url
    `,
    sql<LoadDbRow[]>`
      SELECT t.assignee_id, p.id AS project_id, p.code AS project_code,
        coalesce(sum(t.qty_assigned), 0)::int AS images,
        count(*) FILTER (WHERE ${notSubtaskSql(sql)})::int AS tasks,
        count(*) FILTER (WHERE ${notSubtaskSql(sql)} AND t.qty_assigned IS NULL AND NOT EXISTS (
          SELECT 1 FROM production.tasks c
          WHERE c.organization_id = t.organization_id AND c.parent_task_id = t.id AND c.kind = 'NORMAL' AND c.deleted_at IS NULL AND c.qty_assigned IS NOT NULL
        ))::int AS without_qty
      FROM production.tasks t
      JOIN production.statuses st ON st.organization_id = t.organization_id AND st.id = t.status_id
      JOIN production.jobs j ON j.organization_id = t.organization_id AND j.id = t.job_id AND j.deleted_at IS NULL AND j.archived_at IS NULL
      JOIN production.projects p ON p.organization_id = j.organization_id AND p.id = j.project_id
      WHERE t.organization_id = ${organizationId} AND t.deleted_at IS NULL AND st.code IN ('ASSIGNED', 'PROCESSING', 'REWORK')
      GROUP BY t.assignee_id, p.id, p.code
    `
  ]);
  const byPerson = new Map<string, LoadDbRow[]>();
  for (const row of loads) {
    const list = byPerson.get(row.assignee_id) ?? [];
    list.push(row);
    byPerson.set(row.assignee_id, list);
  }
  return {
    today,
    generatedAt: now.toISOString(),
    members: members
      .map((member) => {
        const user = toUserRef(member.user)!;
        const rows = (byPerson.get(user.id) ?? []).sort((a, b) => b.images - a.images || b.tasks - a.tasks || a.project_code.localeCompare(b.project_code));
        return {
          user,
          roles: member.roles.filter((role): role is "STAFF" | "QC" | "LEADER" => role === "STAFF" || role === "QC" || role === "LEADER"),
          leave: member.leave_part ? { part: member.leave_part, now: member.leave_now } : member.leave_now ? { part: "FULL_DAY" as const, now: true } : null,
          openTasks: rows.reduce((sum, row) => sum + row.tasks, 0),
          images: rows.reduce((sum, row) => sum + row.images, 0),
          tasksWithoutQty: rows.reduce((sum, row) => sum + row.without_qty, 0),
          byProject: rows.map((row) => ({ project: { id: row.project_id, code: row.project_code }, images: row.images, tasks: row.tasks }))
        };
      })
      .sort((a, b) => a.user.displayName.localeCompare(b.user.displayName, "vi"))
  };
};

// At risk history ------------------------------------------------------------------------------------------------------

type EpisodeDbRow = {
  job_id: string;
  job_code: string;
  project_id: string;
  project_code: string;
  project_name: string;
  leader: UserRefJson | null;
  reason: "CAPACITY" | "UNASSIGNED";
  started_at: Date;
  ended_at: Date | null;
  end_reason: "CLEARED" | "FINISHED" | "CLIENT_LATE" | "REMOVED" | null;
  deadline: Date;
  job_deadline: Date;
  delivered_at: Date | null;
  delivered_kind: boolean;
};

/** A job was really client-late: delivered (first move to a DELIVERING / DELIVERED status) after its deadline, or still undelivered past it. */
export const wasClientLate = (row: { deadline: Date; deliveredAt: Date | null; delivered: boolean }, now: Date) =>
  row.deliveredAt ? row.deliveredAt > row.deadline : !row.delivered && row.deadline < now;

/** Monday of the week of a day. */
const mondayOf = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));

/**
 * GET /production/overview/risk-history (PD-080): superadmin and Director only (403 otherwise). Episodes started in the
 * range; one row per job (its first episode in the range), counted per week of that start, per Leader and per project.
 */
export const getRiskHistory = async (context: AccessContext, query: RiskHistoryQuery, now: Date = new Date()): Promise<RiskHistory> => {
  assertProductionMember(context);
  if (!seesRiskHistory([...productionRolesOf(context)])) {
    throw forbidden("Lịch sử At risk dành cho Siêu quản trị và Director.");
  }
  const sql = getSql();
  const organizationId = context.organization.id;
  const settings = await loadSettings(sql, organizationId);
  const timeZone = coreWindowOf(settings).timeZone;
  const today = dayInTimeZone(now, timeZone);
  const range = { from: query.from ?? query.to ?? addDays(mondayOf(today), -49), to: query.to ?? query.from ?? today };
  const instants = rangeInstants(range, timeZone);
  const rows = await sql<EpisodeDbRow[]>`
    SELECT e.job_id, j.code AS job_code, p.id AS project_id, p.code AS project_code, p.name AS project_name,
      CASE WHEN ul.id IS NULL THEN NULL ELSE ${userJsonSql(sql, "ul")} END AS leader,
      e.reason, e.started_at, e.ended_at, e.end_reason, e.deadline, j.deadline AS job_deadline,
      (SELECT min(l.created_at) FROM production.task_logs l
        JOIN production.job_statuses ds ON ds.organization_id = l.organization_id AND ds.id::text = l.to_value->>'jobStatusId'
        WHERE l.organization_id = j.organization_id AND l.job_id = j.id AND l.action = 'JOB' AND ds.kind IN ('DELIVERING', 'DELIVERED')) AS delivered_at,
      js.kind IN ('DELIVERING', 'DELIVERED') AS delivered_kind
    FROM production.job_risk_episodes e
    JOIN production.jobs j ON j.organization_id = e.organization_id AND j.id = e.job_id
    JOIN production.job_statuses js ON js.organization_id = j.organization_id AND js.id = j.job_status_id
    JOIN production.projects p ON p.organization_id = j.organization_id AND p.id = j.project_id
    LEFT JOIN public.app_users ul ON ul.id = e.leader_id
    WHERE e.organization_id = ${organizationId} AND e.started_at >= ${instants.start} AND e.started_at < ${instants.end}
      AND ${visibleUserIdSql(sql, context, sql`j.created_by`)}
    ORDER BY e.started_at DESC
  `;
  type JobEntry = { row: EpisodeDbRow; episodes: number; clientLate: boolean };
  const byJob = new Map<string, JobEntry>();
  // Oldest episode first so a job is counted in the week its first episode of the range started.
  for (const row of [...rows].reverse()) {
    const entry = byJob.get(row.job_id);
    if (entry) {
      entry.episodes += 1;
      // The latest episode's end (rows are oldest first here).
      entry.row = { ...entry.row, ended_at: row.ended_at, end_reason: row.end_reason };
      continue;
    }
    byJob.set(row.job_id, {
      row,
      episodes: 1,
      clientLate: wasClientLate({ deadline: row.job_deadline, deliveredAt: row.delivered_at, delivered: row.delivered_kind }, now)
    });
  }
  const entries = [...byJob.values()];
  const tally = <K>(keyOf: (entry: JobEntry) => K) => {
    const map = new Map<K, { jobs: number; clientLate: number; sample: JobEntry }>();
    for (const entry of entries) {
      const key = keyOf(entry);
      const current = map.get(key) ?? { jobs: 0, clientLate: 0, sample: entry };
      current.jobs += 1;
      current.clientLate += entry.clientLate ? 1 : 0;
      map.set(key, current);
    }
    return [...map.entries()];
  };
  return {
    ...range,
    totals: {
      jobs: entries.length,
      clientLate: entries.filter((entry) => entry.clientLate).length,
      episodes: rows.length,
      open: rows.filter((row) => row.ended_at === null).length
    },
    weeks: tally((entry) => mondayOf(dayInTimeZone(entry.row.started_at, timeZone)))
      .map(([week, value]) => ({ week, jobs: value.jobs, clientLate: value.clientLate }))
      .sort((a, b) => a.week.localeCompare(b.week)),
    leaders: tally((entry) => entry.row.leader?.id ?? null)
      .map(([, value]) => ({ leader: toUserRef(value.sample.row.leader), jobs: value.jobs, clientLate: value.clientLate }))
      .sort((a, b) => b.jobs - a.jobs || (a.leader?.displayName ?? "").localeCompare(b.leader?.displayName ?? "", "vi")),
    projects: tally((entry) => entry.row.project_id)
      .map(([, value]) => ({
        project: { id: value.sample.row.project_id, code: value.sample.row.project_code, name: value.sample.row.project_name },
        jobs: value.jobs,
        clientLate: value.clientLate
      }))
      .sort((a, b) => b.jobs - a.jobs || a.project.code.localeCompare(b.project.code)),
    jobs: entries
      .sort((a, b) => b.row.started_at.getTime() - a.row.started_at.getTime())
      .slice(0, 200)
      .map((entry) => ({
        job: { id: entry.row.job_id, code: entry.row.job_code, project: { id: entry.row.project_id, code: entry.row.project_code } },
        leader: toUserRef(entry.row.leader),
        reason: entry.row.reason,
        startedAt: toIso(entry.row.started_at),
        endedAt: entry.row.ended_at ? toIso(entry.row.ended_at) : null,
        endReason: entry.row.end_reason,
        deadline: toIso(entry.row.job_deadline),
        episodes: entry.episodes,
        clientLate: entry.clientLate
      }))
  };
};

