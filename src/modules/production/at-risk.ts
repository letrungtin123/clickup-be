import { finishedJobStatusKinds, hoursPerImageOf } from "../../contracts/production-catalog.js";
import type { OverviewRiskReason } from "../../contracts/production-overview.js";
import { getSql } from "../../db/client.js";
import { logger } from "../../lib/logger.js";
import type { QuerySql } from "../../lib/db-types.js";
import { loadSettings } from "./catalog.service.js";
import { coreDayMinutes, coreHoursBetween, coreMinutesBetween, coreWindowOf, zonedDay, type CoreWindow, type Interval } from "./core-clock.js";
import { loadWorkflowModel } from "./jobs.repo.js";
import { isLineFinished, lineFinishStatusIds } from "./workflow.js";

/**
 * PD-080 — "At risk": an ESTIMATE that a job may miss its client deadline while there is still time to add people or warn
 * the client. Never written to points, never shown to Staff / QC. The worker re-evaluates every open job about every 15
 * minutes (`runAtRiskScan`) and keeps the history in production.job_risk_episodes (one row per on → off episode).
 *
 * Evaluated for live, not archived jobs whose kind is before COMPLETE and whose client deadline is still ahead. ON when:
 *  - CAPACITY: the job has lines, at least one still with its worker (Mới giao / Đang làm / Cần sửa lại / Feedback), and
 *      remaining work hours > capacity, where
 *      remaining work hours = Σ over unfinished rows (lines and subtasks) of images × "Giờ/tấm" (project × process; a
 *        work row waiting for / at QC uses the project's PRIMARY QC rate, see `qcRateFor`) + unassigned images (Tổng
 *        tấm − images given on work rows) × the job's average Giờ/tấm (weighted by images);
 *      capacity = Σ over the people working on it now (assignees of rows with their worker or open Checking lines, QC of
 *        rows waiting for / at QC) of core-window hours from now to the client deadline, minus their approved leave;
 *  - UNASSIGNED: the job has no line yet and the core time left before the client deadline is at most one core day.
 * OFF by itself when the job catches up / gets people, every line is past its worker (Done or later), the job reaches
 * COMPLETE or later (FINISHED), its deadline passes (CLIENT_LATE: it is then simply client-late), or it is archived /
 * deleted (REMOVED). Giờ/tấm: the price's own value, else credit ÷ 11 (`hoursPerImageOf`); no price → 0 hours.
 *
 * Several QC-type processes may exist (PD-080b: "Checking", "Checking Clipping", "Checking Shoe"). Work waiting for / at QC
 * is estimated with the PRIMARY QC process's Giờ/tấm for the job's project — primary = the active QC process named
 * "Checking" (case-insensitive), else the active QC process with the lowest sort order —; when the primary one has no price
 * for the project, the average Giờ/tấm of the project's priced QC processes; else 0.
 */

export type RiskRow = {
  id: string;
  /** null for a line; the line's id for a subtask (it follows its line's status). */
  parentId: string | null;
  processId: string;
  isQc: boolean;
  statusCode: string;
  finished: boolean;
  qtyAssigned: number | null;
  qtyDone: number | null;
  assigneeId: string;
  qcId: string | null;
};

export type RiskJob = { id: string; projectId: string; deadline: Date; totalImages: number; rows: readonly RiskRow[] };

export type RiskContext = {
  now: Date;
  window: CoreWindow;
  /** Giờ/tấm of (project, process), null without a price. */
  rate: (projectId: string, processId: string) => number | null;
  /** The organization's active QC-type processes (Checking …), for work waiting for / at QC (`qcRateFor`). */
  qcProcesses: readonly QcProcess[];
  /** Approved leave of a person (instants). */
  leaveOf: (userId: string) => readonly Interval[];
};

export type RiskEstimate = {
  atRisk: boolean;
  reason: OverviewRiskReason | null;
  workHours: number;
  capacityHours: number;
  hoursLeft: number;
  people: number;
  /** Every line is past its worker (Done or later): the episode ends as FINISHED. */
  workerDone: boolean;
};

/** An active QC-type process (`processes.is_qc`). */
export type QcProcess = { id: string; name: string; sortOrder: number };

/** The primary QC process: the one named "Checking" (case-insensitive), else the lowest sort order (then name). */
export const primaryQcProcessId = (qcProcesses: readonly QcProcess[]) =>
  (
    qcProcesses.find((process) => process.name.trim().toLowerCase() === "checking") ??
    [...qcProcesses].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))[0]
  )?.id ?? null;

/**
 * Giờ/tấm of work waiting for / at QC in a project: the primary QC process's price; without one, the average over the
 * project's priced QC processes; else 0.
 */
export const qcRateFor = (projectId: string, qcProcesses: readonly QcProcess[], rate: RiskContext["rate"]) => {
  const primary = primaryQcProcessId(qcProcesses);
  const own = primary ? rate(projectId, primary) : null;
  if (own !== null) {
    return own;
  }
  const priced = qcProcesses.map((process) => rate(projectId, process.id)).filter((value): value is number => value !== null);
  return priced.length > 0 ? priced.reduce((sum, value) => sum + value, 0) / priced.length : 0;
};

const workerCodes = new Set(["ASSIGNED", "PROCESSING", "REWORK", "FEEDBACK"]);
const qcCodes = new Set(["DONE", "WAITING_QC", "QC_CHECKING"]);
const round2 = (value: number) => Math.round(value * 100) / 100;

/** Pure estimate of one job (see above). */
export const estimateJobRisk = (job: RiskJob, context: RiskContext): RiskEstimate => {
  const { now, window } = context;
  const hoursLeft = coreHoursBetween(now, job.deadline, window);
  const lines = job.rows.filter((row) => row.parentId === null);
  if (lines.length === 0) {
    const unassigned = coreMinutesBetween(now, job.deadline, window) <= coreDayMinutes(window);
    return { atRisk: unassigned, reason: unassigned ? "UNASSIGNED" : null, workHours: 0, capacityHours: 0, hoursLeft, people: 0, workerDone: false };
  }
  const statusOf = new Map(lines.map((line) => [line.id, line]));
  // A subtask follows its line (status, finished).
  const effective = job.rows.map((row) => {
    const line = row.parentId ? statusOf.get(row.parentId) : row;
    return { row, statusCode: line?.statusCode ?? row.statusCode, finished: line?.finished ?? row.finished };
  });
  const workerDone = !lines.some((line) => !line.finished && workerCodes.has(line.statusCode));
  const people = new Set<string>();
  let workHours = 0;
  let workImages = 0;
  let weightedRate = 0;
  const rates: number[] = [];
  const qcRate = qcRateFor(job.projectId, context.qcProcesses, context.rate);
  for (const { row, statusCode, finished } of effective) {
    const rate = context.rate(job.projectId, row.processId) ?? 0;
    if (!row.isQc) {
      const given = row.qtyAssigned ?? row.qtyDone ?? 0;
      workImages += given;
      weightedRate += given * rate;
      rates.push(rate);
    }
    if (finished) {
      continue;
    }
    if (row.isQc || workerCodes.has(statusCode)) {
      workHours += (row.qtyAssigned ?? 0) * rate;
      people.add(row.assigneeId);
    } else if (qcCodes.has(statusCode)) {
      workHours += (row.qtyDone ?? row.qtyAssigned ?? 0) * qcRate;
      if (row.qcId) {
        people.add(row.qcId);
      }
    }
  }
  const averageRate = workImages > 0 ? weightedRate / workImages : rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
  workHours += Math.max(0, job.totalImages - workImages) * averageRate;
  let capacityHours = 0;
  for (const person of people) {
    capacityHours += coreMinutesBetween(now, job.deadline, window, context.leaveOf(person)) / 60;
  }
  workHours = round2(workHours);
  capacityHours = round2(capacityHours);
  const atRisk = !workerDone && workHours > capacityHours;
  return { atRisk, reason: atRisk ? "CAPACITY" : null, workHours, capacityHours, hoursLeft, people: people.size, workerDone };
};

// Scan -----------------------------------------------------------------------------------------------------------------

type JobDbRow = { id: string; project_id: string; leader_id: string | null; deadline: Date; total_images: number };
type RowDbRow = {
  id: string;
  job_id: string;
  parent_id: string | null;
  process_id: string;
  is_qc: boolean;
  status_id: string;
  status_code: string;
  done_at: Date | null;
  qty_assigned: number | null;
  qty_done: number | null;
  assignee_id: string;
  qc_id: string | null;
};
type OpenEpisode = { id: string; job_id: string };

/** Evaluates one organization inside the scan's transaction; returns how many episodes started / ended. */
const scanOrganization = async (sql: QuerySql, organizationId: string, now: Date) => {
  const settings = await loadSettings(sql, organizationId);
  const window = coreWindowOf(settings);
  const today = zonedDay(now, window.timeZone);
  const jobs = await sql<JobDbRow[]>`
    SELECT j.id, j.project_id, j.leader_id, j.deadline, j.total_images
    FROM production.jobs j
    JOIN production.job_statuses js ON js.organization_id = j.organization_id AND js.id = j.job_status_id
    WHERE j.organization_id = ${organizationId} AND j.deleted_at IS NULL AND j.archived_at IS NULL
      AND j.deadline > ${now} AND NOT (js.kind = ANY(${[...finishedJobStatusKinds]}::text[]))
  `;
  const jobIds = jobs.map((job) => job.id);
  const [workflow, rows] = await Promise.all([
    loadWorkflowModel(sql, organizationId),
    jobIds.length === 0
      ? []
      : sql<RowDbRow[]>`
          SELECT t.id, t.job_id, CASE WHEN t.kind = 'NORMAL' THEN t.parent_task_id END AS parent_id, t.process_id, pr.is_qc,
            t.status_id, st.code AS status_code, t.done_at, t.qty_assigned, t.qty_done, t.assignee_id, t.qc_id
          FROM production.tasks t
          JOIN production.processes pr ON pr.organization_id = t.organization_id AND pr.id = t.process_id
          JOIN production.statuses st ON st.organization_id = t.organization_id AND st.id = t.status_id
          WHERE t.organization_id = ${organizationId} AND t.job_id = ANY(${jobIds}::uuid[]) AND t.deleted_at IS NULL
        `
  ]);
  const finishIds = lineFinishStatusIds(workflow);
  const projectIds = [...new Set(jobs.map((job) => job.project_id))];
  const [rules, qcProcesses, leave] = await Promise.all([
    projectIds.length === 0
      ? []
      : sql<{ project_id: string; process_id: string; credit_per_image: string; hours_per_image: string | null }[]>`
          SELECT project_id, process_id, credit_per_image::text, hours_per_image::text
          FROM production.credit_rules
          WHERE organization_id = ${organizationId} AND project_id = ANY(${projectIds}::uuid[])
            AND effective_from <= ${today}::date AND (effective_to IS NULL OR ${today}::date < effective_to)
        `,
    sql<{ id: string; name: string; sort_order: number }[]>`
      SELECT id, name, sort_order FROM production.processes WHERE organization_id = ${organizationId} AND is_qc AND active
    `,
    jobIds.length === 0
      ? []
      : sql<{ user_id: string; start_at: Date; end_at: Date }[]>`
          SELECT user_id, lower(slot_range) AT TIME ZONE ${window.timeZone}::text AS start_at, upper(slot_range) AT TIME ZONE ${window.timeZone}::text AS end_at
          FROM production.leave_requests
          WHERE organization_id = ${organizationId} AND status = 'APPROVED' AND to_date >= ${today}::date
        `
  ]);
  const rateMap = new Map(
    rules.map((rule) => [
      `${rule.project_id}:${rule.process_id}`,
      hoursPerImageOf({ creditPerImage: Number(rule.credit_per_image), hoursPerImage: rule.hours_per_image === null ? null : Number(rule.hours_per_image) })
    ])
  );
  const leaveMap = new Map<string, Interval[]>();
  for (const item of leave) {
    const list = leaveMap.get(item.user_id) ?? [];
    list.push({ start: item.start_at, end: item.end_at });
    leaveMap.set(item.user_id, list);
  }
  const rowsByJob = new Map<string, RiskRow[]>();
  for (const row of rows) {
    const list = rowsByJob.get(row.job_id) ?? [];
    list.push({
      id: row.id,
      parentId: row.parent_id,
      processId: row.process_id,
      isQc: row.is_qc,
      statusCode: row.status_code,
      // The retired line status Feedback still counts as work to do (as on the Overview).
      finished: row.status_code !== "FEEDBACK" && isLineFinished(workflow, { statusId: row.status_id, isChecking: row.is_qc, doneAt: row.done_at }, finishIds),
      qtyAssigned: row.qty_assigned,
      qtyDone: row.qty_done,
      assigneeId: row.assignee_id,
      qcId: row.qc_id
    });
    rowsByJob.set(row.job_id, list);
  }
  const context: RiskContext = {
    now,
    window,
    rate: (projectId, processId) => rateMap.get(`${projectId}:${processId}`) ?? null,
    qcProcesses: qcProcesses.map((process) => ({ id: process.id, name: process.name, sortOrder: process.sort_order })),
    leaveOf: (userId) => leaveMap.get(userId) ?? []
  };

  const open = await sql<OpenEpisode[]>`
    SELECT id, job_id FROM production.job_risk_episodes WHERE organization_id = ${organizationId} AND ended_at IS NULL FOR UPDATE
  `;
  const openByJob = new Map(open.map((episode) => [episode.job_id, episode]));
  let started = 0;
  let ended = 0;
  for (const job of jobs) {
    const estimate = estimateJobRisk(
      { id: job.id, projectId: job.project_id, deadline: job.deadline, totalImages: job.total_images, rows: rowsByJob.get(job.id) ?? [] },
      context
    );
    const episode = openByJob.get(job.id);
    openByJob.delete(job.id);
    if (estimate.atRisk && estimate.reason) {
      if (episode) {
        await sql`
          UPDATE production.job_risk_episodes
          SET reason = ${estimate.reason}, deadline = ${job.deadline}, work_hours = ${estimate.workHours}, capacity_hours = ${estimate.capacityHours},
            hours_left = ${estimate.hoursLeft}, people = ${estimate.people}, evaluated_at = ${now}
          WHERE id = ${episode.id}
        `;
      } else {
        await sql`
          INSERT INTO production.job_risk_episodes
            (organization_id, job_id, project_id, leader_id, reason, started_at, deadline, work_hours, capacity_hours, hours_left, people, evaluated_at)
          VALUES (${organizationId}, ${job.id}, ${job.project_id}, ${job.leader_id}, ${estimate.reason}, ${now}, ${job.deadline},
            ${estimate.workHours}, ${estimate.capacityHours}, ${estimate.hoursLeft}, ${estimate.people}, ${now})
        `;
        started += 1;
      }
    } else if (episode) {
      await sql`
        UPDATE production.job_risk_episodes
        SET ended_at = ${now}, end_reason = ${estimate.workerDone ? "FINISHED" : "CLEARED"}, evaluated_at = ${now}
        WHERE id = ${episode.id}
      `;
      ended += 1;
    }
  }
  // Open episodes of jobs no longer evaluated: late, finished, archived or deleted.
  const leftover = [...openByJob.values()];
  if (leftover.length > 0) {
    await sql`
      UPDATE production.job_risk_episodes e
      SET ended_at = greatest(${now}::timestamptz, e.started_at), evaluated_at = ${now},
        end_reason = coalesce((
          SELECT CASE
              WHEN j.deleted_at IS NOT NULL OR j.archived_at IS NOT NULL THEN 'REMOVED'
              WHEN js.kind = ANY(${[...finishedJobStatusKinds]}::text[]) THEN 'FINISHED'
              ELSE 'CLIENT_LATE'
            END
          FROM production.jobs j
          JOIN production.job_statuses js ON js.organization_id = j.organization_id AND js.id = j.job_status_id
          WHERE j.organization_id = e.organization_id AND j.id = e.job_id
        ), 'REMOVED')
      WHERE e.organization_id = ${organizationId} AND e.id = ANY(${leftover.map((episode) => episode.id)}::uuid[])
    `;
    ended += leftover.length;
  }
  return { started, ended };
};

/** One scan of every organization (one worker instance at a time: transaction-scoped advisory lock). */
export const runAtRiskScan = async (now: Date = new Date()) => {
  const result = await getSql().begin(async (sql) => {
    const locked = await sql<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended('production:at-risk', 0)) AS locked`;
    if (!locked[0]?.locked) {
      return null;
    }
    const organizations = await sql<{ id: string }[]>`
      SELECT o.id FROM public.organizations o
      WHERE o.deleted_at IS NULL AND EXISTS (SELECT 1 FROM production.jobs j WHERE j.organization_id = o.id)
    `;
    let started = 0;
    let ended = 0;
    for (const organization of organizations) {
      const counts = await scanOrganization(sql, organization.id, now);
      started += counts.started;
      ended += counts.ended;
    }
    return { started, ended };
  });
  if (result && (result.started > 0 || result.ended > 0)) {
    logger.info(result, "Production At risk scan");
  }
};

const intervalMs = 15 * 60 * 1000;

/** Worker scheduler: first scan 45 s after start, then every 15 minutes. */
export const startAtRiskScheduler = () => {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const tick = () => {
    if (stopped) {
      return;
    }
    runAtRiskScan()
      .catch((error: unknown) => logger.error({ err: error }, "Production At risk scan failed"))
      .finally(() => {
        if (!stopped) {
          timer = setTimeout(tick, intervalMs);
        }
      });
  };
  timer = setTimeout(tick, 45_000);
  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
    return Promise.resolve();
  };
};
