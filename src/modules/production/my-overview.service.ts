import {
  myOverviewOrder,
  myOverviewQcLimit,
  myOverviewRowLimit,
  type MyOverview,
  type MyOverviewImages,
  type MyOverviewPoints,
  type MyOverviewQcTask,
  type MyOverviewQuery,
  type MyOverviewStatusCount,
  type MyOverviewTag,
  type MyOverviewTask
} from "../../contracts/production-my-overview.js";
import type { ProductionSettings } from "../../contracts/production-catalog.js";
import type { ProductionTask } from "../../contracts/production-jobs.js";
import { getSql } from "../../db/client.js";
import { toIso, type QuerySql, type SqlFragment } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { visibleUserIdSql } from "../access/test-accounts.js";
import { toColor, toUserRef, type UserRefJson } from "../work/mappers.js";
import { userJsonSql } from "../work/tasks.repo.js";
import { assertProductionMember, hasProductionRole } from "./access.js";
import { closeDaysOf, loadSettings } from "./catalog.service.js";
import { loadJobScopes, loadTaskScopes } from "./job-permissions.js";
import {
  lineFinishedSql,
  lineFinishStatusIds,
  loadWorkflowModel,
  notSubtaskSql,
  relationOf,
  taskSelectSql,
  toProductionTask,
  type TaskAccess,
  type TaskRow
} from "./jobs.repo.js";
import { loadKpiRequirement } from "./kpi-targets.service.js";
import { approvedLeaveDays } from "./leave.service.js";
import { coreClockOf, coreMinutesBetween, dayIn, type CoreClock } from "./my-overview-clock.js";
import { loadTargetVersions } from "./scores.service.js";
import { effectiveTarget, forecast, periodOfDay, periodRange, weekStart } from "./scoring.js";
import { isLineFinished, qcStageCodes, type LineFinishStatusIds, type Workflow } from "./workflow.js";

/**
 * PD-081 — "Tổng quan của tôi" (GET /production/my-overview). Definitions: contracts/production-my-overview.ts.
 *
 * Reads, whatever the data: the per-organization config (settings, workflow, scopes — cached), then in parallel my lines
 * (a light row each: status, dates, quantities — every open line and the finished ones of the range), the QC queue (QC
 * holders), the points of the KPI period / week and the KPI target (+ requirement, + approved leave when prorated); then
 * the task DTOs of the listed lines and the status history times (entered Done / Chờ QC / Đang check, the latest QC fail)
 * of the listed and queued lines. The clock rules (late, due soon, waiting for QC) are pure functions below.
 */

/** Done and waiting for QC: Done (until the system moves it), Chờ QC, Đang check. */
export const withQcCodes: ReadonlySet<string> = new Set(["DONE", "WAITING_QC", "QC_CHECKING"]);

/** The retired line status "Feedback" (PD-045) counts as open work, whatever its place in the workflow (as PD-080). */
const openFeedbackCode = "FEEDBACK";

/** Due-soon minutes are counted up to a week of core time (the result is only compared with a few hours). */
const dueCoreCap = 7 * 24 * 60;

// Pure rules (unit tested) ---------------------------------------------------------------------------------------------

/** What the rules need of one of my lines; the two range flags come from the database (organization-calendar days). */
export type MyLineFacts = {
  statusId: string;
  statusCode: string;
  isChecking: boolean;
  doneAt: Date | null;
  deadline: Date;
  /** closed_at, else checked_at, else done_at. */
  finishedAt: Date | null;
  deadlineInRange: boolean;
  finishedInRange: boolean;
};

export type MyLineClass = {
  finished: boolean;
  late: boolean;
  rework: boolean;
  withQc: boolean;
  dueSoon: boolean;
  dueCoreMinutes: number | null;
  /** In the range, or always shown (late, rework, with QC, due soon). */
  shown: boolean;
};

/** The PD-081 classification of one of my lines at `now` (see the contract). */
export const classifyMyLine = (
  workflow: Workflow,
  finish: LineFinishStatusIds,
  line: MyLineFacts,
  now: Date,
  clock: CoreClock
): MyLineClass => {
  const finished =
    line.statusCode !== openFeedbackCode &&
    isLineFinished(workflow, { statusId: line.statusId, isChecking: line.isChecking, doneAt: line.doneAt }, finish);
  const open = !finished;
  const withQc = open && withQcCodes.has(line.statusCode);
  const rework = open && line.statusCode === "REWORK";
  const late = open && !withQc && line.deadline.getTime() < now.getTime();
  const dueCoreMinutes = open && !withQc && !late ? coreMinutesBetween(now, line.deadline, clock, dueCoreCap) : null;
  const dueSoon = dueCoreMinutes !== null && dueCoreMinutes <= clock.dueSoonMinutes;
  const inRange = finished ? line.finishedInRange : line.deadlineInRange;
  return { finished, late, rework, withQc, dueSoon, dueCoreMinutes, shown: inRange || late || rework || withQc || dueSoon };
};

/** Quantities of a line and its subtasks (subtask sums: null without subtasks or without known numbers). */
export type MyLineQuantities = {
  qtyAssigned: number | null;
  qtyDone: number | null;
  doneAt: Date | null;
  subQtyAssigned: number | null;
  subQtyDone: number | null;
};

/**
 * Images of a line: its "Số lượng giao" plus its subtasks' (null while the line has none, PD-058), and once Done its Done
 * quantity plus its subtasks' (null before Done).
 */
export const lineImages = (line: MyLineQuantities): MyOverviewImages => ({
  assigned: line.qtyAssigned === null ? null : line.qtyAssigned + (line.subQtyAssigned ?? 0),
  done: line.doneAt === null ? null : (line.qtyDone ?? line.qtyAssigned ?? 0) + (line.subQtyDone ?? 0)
});

/** The images a tag adds up for a line: the Done quantity of finished work, else the assigned one (null = unknown). */
export const tagImagesOf = (line: { finished: boolean; images: MyOverviewImages }) =>
  line.finished ? (line.images.done ?? line.images.assigned) : (line.images.assigned ?? line.images.done);

export const tagOf = (lines: readonly { finished: boolean; images: MyOverviewImages }[]): MyOverviewTag => {
  let images = 0;
  let withoutQty = 0;
  for (const line of lines) {
    const value = tagImagesOf(line);
    if (value === null) {
      withoutQty += 1;
    } else {
      images += value;
    }
  }
  return { count: lines.length, images, withoutQty };
};

export type StatusMeta = { id: string; code: string; name: string; color: string; order: number };

/** The statuses present among `lines` with their counts, in workflow order. */
export const statusCountsOf = (lines: readonly { status: StatusMeta }[]): MyOverviewStatusCount[] => {
  const counts = new Map<string, { status: StatusMeta; count: number }>();
  for (const line of lines) {
    const entry = counts.get(line.status.id) ?? { status: line.status, count: 0 };
    entry.count += 1;
    counts.set(line.status.id, entry);
  }
  return [...counts.values()]
    .sort((a, b) => a.status.order - b.status.order || a.status.name.localeCompare(b.status.name))
    .map(({ status, count }) => ({ status: { id: status.id, code: status.code, name: status.name, color: toColor(status.color) }, count }));
};

/** Latest status-history times of a line (null when it has no such row). */
export type LineLogTimes = {
  DONE: Date | null;
  WAITING_QC: Date | null;
  QC_CHECKING: Date | null;
  QC_FAIL: { at: Date; note: string | null; by: UserRefJson | null } | null;
};
export const noLogTimes: LineLogTimes = { DONE: null, WAITING_QC: null, QC_CHECKING: null, QC_FAIL: null };

/**
 * A queued line's QC clock: since when it waits (the latest entry into Chờ QC; else its latest / first Done) and the core
 * minutes waited — until now in Chờ QC, until the check started in Đang check; the alert once Chờ QC has lasted the
 * threshold.
 */
export const qcClockOf = (
  line: { statusCode: string; doneAt: Date | null },
  logs: LineLogTimes,
  now: Date,
  clock: CoreClock
) => {
  const waitingSince = logs.WAITING_QC ?? logs.DONE ?? line.doneAt;
  const checking = line.statusCode === "QC_CHECKING";
  const checkingSince = checking ? logs.QC_CHECKING : null;
  const waitMinutes = waitingSince ? coreMinutesBetween(waitingSince, checking ? (checkingSince ?? now) : now, clock) : 0;
  return { waitingSince, checkingSince, waitMinutes, alert: !checking && waitMinutes >= clock.qcAlertMinutes };
};

/** Longest wait first (the oldest entry into Chờ QC), then the code. */
export const qcQueueOrder = (
  a: { waitingSince: Date | null; number: number },
  b: { waitingSince: Date | null; number: number }
) =>
  (a.waitingSince?.getTime() ?? Number.POSITIVE_INFINITY) - (b.waitingSince?.getTime() ?? Number.POSITIVE_INFINITY) ||
  a.number - b.number;

/** "Cần sửa lại" / late / due soon counts of the shown lines and the QC items (null without QC). */
export const needsOf = (
  lines: readonly Pick<MyLineClass, "rework" | "late" | "dueSoon">[],
  qc: readonly { alert: boolean }[] | null
): MyOverview["needs"] => ({
  rework: lines.filter((line) => line.rework).length,
  late: lines.filter((line) => line.late).length,
  dueSoon: lines.filter((line) => line.dueSoon).length,
  qcWaiting: qc ? qc.length : null,
  qcOverAlert: qc ? qc.filter((line) => line.alert).length : null
});

// Reads ----------------------------------------------------------------------------------------------------------------

type LightRow = {
  id: string;
  number: string | number;
  status_id: string;
  status_code: string;
  status_name: string;
  status_color: string;
  status_order: number;
  is_checking: boolean;
  done_at: Date | null;
  deadline: Date;
  finished_at: Date | null;
  deadline_in_range: boolean;
  finished_in_range: boolean;
  qty_assigned: number | null;
  qty_done: number | null;
  sub_qty_assigned: number | null;
  sub_qty_done: number | null;
};

type FolderRow = TaskRow & { drive_link: string | null };

type LogRow = { task_id: string; kind: keyof LineLogTimes; created_at: Date; note: string | null; by_user: UserRefJson | null };

const toCents = (value: string | number) => Math.round(Number(value) * 100);

/** The job's drive / folder link, else the line's "Link chia việc" (blank = none). */
const folderLinkOf = (row: Pick<FolderRow, "drive_link" | "work_link">) => row.drive_link?.trim() || row.work_link?.trim() || null;

/** "Điểm của tôi": today / this week / the KPI period's official points and the KPI target (Bảng điểm's rules, no money). */
const loadMyPoints = async (
  sql: QuerySql,
  organizationId: string,
  userId: string,
  settings: ProductionSettings,
  today: string
): Promise<MyOverviewPoints> => {
  const closeDays = closeDaysOf(settings);
  const period = periodOfDay(today, closeDays);
  const { from, to } = periodRange(period, closeDays);
  const week = { from: weekStart(today), to: today };
  const sumFrom = week.from < from ? week.from : from;
  const sumTo = today > to ? today : to;
  const [days, targets, requirement, leaveDays] = await Promise.all([
    sql<{ business_day: string; credits: string }[]>`
      SELECT to_char(business_day, 'YYYY-MM-DD') AS business_day, sum(credits)::text AS credits
      FROM production.score_entries
      WHERE organization_id = ${organizationId} AND user_id = ${userId} AND pay_mode = 'POINTS'
        AND business_day BETWEEN ${sumFrom}::date AND ${sumTo}::date
      GROUP BY business_day
    `,
    loadTargetVersions(sql, organizationId, userId),
    loadKpiRequirement(sql, organizationId, userId, period),
    settings.kpiProrateLeave ? approvedLeaveDays(sql, organizationId, userId, from, to, { workdaysOnly: true }) : Promise.resolve(null)
  ]);
  const pointsIn = (start: string, end: string) =>
    days.filter((day) => day.business_day >= start && day.business_day <= end).reduce((sum, day) => sum + toCents(day.credits), 0) / 100 + 0;
  const periodPoints = pointsIn(from, to);
  const result = forecast({
    target: effectiveTarget(targets, "MONTH", period),
    pointsOfficial: periodPoints,
    period,
    closeDay: closeDays,
    today,
    prorateLeave: settings.kpiProrateLeave,
    leaveDays
  });
  const perDayNeeded =
    result.remaining === null || result.remaining === 0 || result.workingDaysLeft === 0
      ? null
      : Math.ceil((result.remaining / result.workingDaysLeft) * 100 - 1e-9) / 100 + 0;
  return {
    today: pointsIn(today, today),
    week: { ...week, points: pointsIn(week.from, week.to) },
    period: { period, from, to, points: periodPoints },
    kpi: {
      target: result.target,
      required: requirement.required,
      percent: result.percent,
      remaining: result.remaining,
      workingDaysLeft: result.workingDaysLeft,
      perDayNeeded
    }
  };
};

/**
 * GET /production/my-overview (PD-081): any production member, for their own work. My lines: assignee = me, live and not
 * archived jobs, lines only (as "Việc của tôi"; one's own list is not filtered for QA test accounts, PD-063). The QC queue
 * (holders of QC): lines whose QC is me in Chờ QC / Đang check, not archived (as "Hàng chờ QC"), lines of a QA test
 * account hidden from a real viewer (PD-063).
 */
export const getMyOverview = async (context: AccessContext, query: MyOverviewQuery, now: Date = new Date()): Promise<MyOverview> => {
  assertProductionMember(context);
  const sql = getSql();
  const organizationId = context.organization.id;
  const me = context.user.id;
  const [settings, workflow, scopes, taskScopes] = await Promise.all([
    loadSettings(sql, organizationId),
    loadWorkflowModel(sql, organizationId),
    loadJobScopes(sql, context),
    loadTaskScopes(sql, context)
  ]);
  const clock = coreClockOf(settings);
  const timeZone = clock.timeZone;
  const today = dayIn(now, timeZone);
  const range = { from: query.from ?? query.to ?? today, to: query.to ?? query.from ?? today };
  const finish = lineFinishStatusIds(workflow);
  const isQc = hasProductionRole(context, "QC");
  const qcStageIds = workflow.statuses.filter((status) => qcStageCodes.has(status.code)).map((status) => status.id);

  // postgres.js fragments: a fresh one per use.
  const startOf = (day: string) => sql`((${day}::date)::timestamp AT TIME ZONE ${timeZone}::text)`;
  const endOf = (day: string) => sql`(((${day}::date) + 1)::timestamp AT TIME ZONE ${timeZone}::text)`;
  const finishedAt = () => sql`coalesce(t.closed_at, t.checked_at, t.done_at)`;
  const finishedLine = () => sql`(${lineFinishedSql(sql, finish, "pr")} AND st.code <> ${openFeedbackCode})`;
  const withFolder = (where: SqlFragment) => sql<FolderRow[]>`
    SELECT x.*, jx.drive_link
    FROM (${taskSelectSql(sql)} ${where}) x
    JOIN production.jobs jx ON jx.organization_id = ${organizationId} AND jx.id = x.job_id
  `;

  const [lightRows, qcRows, points] = await Promise.all([
    // Every open line of mine (late and due-soon work shows whatever the range) and my lines finished in the range.
    sql<LightRow[]>`
      SELECT t.id, t.number, t.status_id, st.code AS status_code, st.name AS status_name, st.color AS status_color,
        st.sort_order AS status_order, pr.is_qc AS is_checking, t.done_at, t.deadline, ${finishedAt()} AS finished_at,
        (t.deadline >= ${startOf(range.from)} AND t.deadline < ${endOf(range.to)}) AS deadline_in_range,
        coalesce(${finishedAt()} >= ${startOf(range.from)} AND ${finishedAt()} < ${endOf(range.to)}, false) AS finished_in_range,
        t.qty_assigned, t.qty_done, sub.qty_assigned AS sub_qty_assigned, sub.qty_done AS sub_qty_done
      FROM production.tasks t
      JOIN production.jobs j ON j.organization_id = t.organization_id AND j.id = t.job_id
      JOIN production.processes pr ON pr.organization_id = t.organization_id AND pr.id = t.process_id
      JOIN production.statuses st ON st.organization_id = t.organization_id AND st.id = t.status_id
      LEFT JOIN LATERAL (
        SELECT sum(s.qty_assigned)::int AS qty_assigned, sum(s.qty_done)::int AS qty_done
        FROM production.tasks s
        WHERE s.organization_id = t.organization_id AND s.parent_task_id = t.id AND s.kind = 'NORMAL' AND s.deleted_at IS NULL
      ) sub ON true
      WHERE t.organization_id = ${organizationId} AND t.deleted_at IS NULL AND t.assignee_id = ${me}
        AND ${notSubtaskSql(sql)} AND j.deleted_at IS NULL AND j.archived_at IS NULL
        AND (NOT ${finishedLine()} OR (${finishedAt()} >= ${startOf(range.from)} AND ${finishedAt()} < ${endOf(range.to)}))
    `,
    isQc && qcStageIds.length > 0
      ? withFolder(sql`
          WHERE t.organization_id = ${organizationId} AND t.qc_id = ${me} AND t.assignee_id <> ${me}
            AND t.status_id = ANY(${qcStageIds}::uuid[]) AND j.archived_at IS NULL AND ${notSubtaskSql(sql)}
            AND ${visibleUserIdSql(sql, context, sql`t.assignee_id`)}
          ORDER BY t.done_at NULLS LAST, t.id
          LIMIT ${myOverviewQcLimit}
        `)
      : Promise.resolve([] as FolderRow[]),
    loadMyPoints(sql, organizationId, me, settings, today)
  ]);

  // Classify, keep the shown lines, order them as the list does.
  const lines = lightRows
    .map((row) => {
      const facts: MyLineFacts = {
        statusId: row.status_id,
        statusCode: row.status_code,
        isChecking: row.is_checking,
        doneAt: row.done_at,
        deadline: row.deadline,
        finishedAt: row.finished_at,
        deadlineInRange: row.deadline_in_range,
        finishedInRange: row.finished_in_range
      };
      const rule = classifyMyLine(workflow, finish, facts, now, clock);
      return {
        row,
        ...rule,
        finishedAt: rule.finished ? (row.finished_at ? toIso(row.finished_at) : null) : null,
        images: lineImages({
          qtyAssigned: row.qty_assigned,
          qtyDone: row.qty_done,
          doneAt: row.done_at,
          subQtyAssigned: row.sub_qty_assigned,
          subQtyDone: row.sub_qty_done
        }),
        status: { id: row.status_id, code: row.status_code, name: row.status_name, color: row.status_color, order: row.status_order },
        task: { deadline: toIso(row.deadline), number: Number(row.number) }
      };
    })
    .filter((line) => line.shown)
    .sort(myOverviewOrder);
  const page = lines.slice(0, myOverviewRowLimit);

  const pageIds = page.map((line) => line.row.id);
  const logIds = [...pageIds, ...qcRows.map((row) => row.id)];
  const [fullRows, logRows] = await Promise.all([
    pageIds.length > 0
      ? withFolder(sql`WHERE t.organization_id = ${organizationId} AND t.id = ANY(${pageIds}::uuid[])`)
      : Promise.resolve([] as FolderRow[]),
    logIds.length > 0
      ? sql<LogRow[]>`
          SELECT DISTINCT ON (l.task_id, k.kind) l.task_id, k.kind, l.created_at, l.note,
            CASE WHEN k.kind = 'QC_FAIL' THEN (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = l.user_id) END AS by_user
          FROM production.task_logs l
          CROSS JOIN LATERAL (
            SELECT CASE WHEN l.to_value @> '{"qcFail": true}'::jsonb THEN 'QC_FAIL' ELSE l.to_value->>'code' END AS kind
          ) k
          WHERE l.organization_id = ${organizationId} AND l.task_id = ANY(${logIds}::uuid[]) AND l.action = 'STATUS'
            AND (l.to_value @> '{"qcFail": true}'::jsonb OR l.to_value->>'code' IN ('DONE', 'WAITING_QC', 'QC_CHECKING'))
          ORDER BY l.task_id, k.kind, l.created_at DESC, l.id DESC
        `
      : Promise.resolve([] as LogRow[])
  ]);

  const logs = new Map<string, LineLogTimes>();
  for (const row of logRows) {
    const entry = logs.get(row.task_id) ?? { ...noLogTimes };
    if (row.kind === "QC_FAIL") {
      entry.QC_FAIL = { at: row.created_at, note: row.note, by: row.by_user };
    } else {
      entry[row.kind] = row.created_at;
    }
    logs.set(row.task_id, entry);
  }
  const logsOf = (taskId: string) => logs.get(taskId) ?? noLogTimes;
  const access: TaskAccess = { scopes, userId: me, taskUpdateScope: taskScopes.update };
  // The usual task DTO without money, prices or points: `myCredits` empty, `points` (and the subtasks') null.
  const toTask = (row: TaskRow): ProductionTask => {
    const fail = row.qc_fail_count > 0 ? logsOf(row.id).QC_FAIL : null;
    return toProductionTask(row, workflow, relationOf(context, row), access, {
      myCredits: [],
      lastQcFail: fail ? { note: fail.note, at: toIso(fail.at), by: toUserRef(fail.by) } : null
    });
  };

  const fullById = new Map(fullRows.map((row) => [row.id, row]));
  const tasks: MyOverviewTask[] = page.flatMap((line) => {
    const row = fullById.get(line.row.id);
    if (!row) {
      return [];
    }
    const times = logsOf(row.id);
    const lastDone = times.DONE ?? row.done_at;
    const waiting = line.withQc && row.status_code === "WAITING_QC" ? qcClockOf({ statusCode: row.status_code, doneAt: lastDone }, times, now, clock) : null;
    return [
      {
        task: toTask(row),
        folderLink: folderLinkOf(row),
        finished: line.finished,
        late: line.late,
        rework: line.rework,
        withQc: line.withQc,
        dueSoon: line.dueSoon,
        dueCoreMinutes: line.dueCoreMinutes,
        finishedAt: line.finishedAt,
        lastDoneAt: lastDone ? toIso(lastDone) : null,
        qcWait: waiting?.waitingSince ? { since: toIso(waiting.waitingSince), minutes: waiting.waitMinutes } : null,
        images: line.images
      }
    ];
  });

  const qcQueue: MyOverviewQcTask[] = qcRows
    .map((row) => ({
      row,
      qcClock: qcClockOf({ statusCode: row.status_code, doneAt: row.done_at }, logsOf(row.id), now, clock),
      images: lineImages({
        qtyAssigned: row.qty_assigned,
        qtyDone: row.qty_done,
        doneAt: row.done_at,
        subQtyAssigned: (row.subtasks ?? []).reduce((sum, subtask) => sum + (subtask.qty_assigned ?? 0), 0),
        subQtyDone: (row.subtasks ?? []).reduce((sum, subtask) => sum + (subtask.qty_done ?? 0), 0)
      })
    }))
    .sort((a, b) =>
      qcQueueOrder(
        { waitingSince: a.qcClock.waitingSince, number: Number(a.row.number) },
        { waitingSince: b.qcClock.waitingSince, number: Number(b.row.number) }
      )
    )
    .map(({ row, qcClock, images }) => ({
      task: toTask(row),
      folderLink: folderLinkOf(row),
      waitingSince: qcClock.waitingSince ? toIso(qcClock.waitingSince) : null,
      waitMinutes: qcClock.waitMinutes,
      alert: qcClock.alert,
      checkingSince: qcClock.checkingSince ? toIso(qcClock.checkingSince) : null,
      images: images.done ?? images.assigned
    }));

  const open = lines.filter((line) => !line.finished);
  const finishedLines = lines.filter((line) => line.finished);
  const late = lines.filter((line) => line.late);
  const waitingQc = qcQueue.filter((line) => line.task.status.code !== "QC_CHECKING");
  return {
    today,
    timeZone,
    generatedAt: now.toISOString(),
    range,
    viewer: { qc: isQc },
    clock: { coreStart: clock.start, coreEnd: clock.end, dueSoonMinutes: clock.dueSoonMinutes, qcAlertMinutes: clock.qcAlertMinutes },
    points,
    tags: {
      mine: tagOf(lines),
      inProgress: tagOf(open),
      done: tagOf(finishedLines),
      late: tagOf(late),
      qc: isQc
        ? {
            count: qcQueue.length,
            overAlert: waitingQc.filter((line) => line.alert).length,
            longestWaitMinutes: waitingQc.reduce((longest, line) => Math.max(longest, line.waitMinutes), 0)
          }
        : null
    },
    needs: needsOf(lines, isQc ? qcQueue : null),
    statusCounts: {
      mine: statusCountsOf(lines),
      inProgress: statusCountsOf(open),
      done: statusCountsOf(finishedLines),
      late: statusCountsOf(late)
    },
    tasks,
    truncated: lines.length > page.length,
    qcQueue: isQc ? qcQueue : null
  };
};
