import { finishedJobStatusKinds, deliveredJobStatusKinds, type JobStatusKind } from "../../contracts/production-catalog.js";
import {
  groupOfStage,
  overviewJobOrder,
  type OverviewAccountNeeds,
  type OverviewCards,
  type OverviewJob,
  type OverviewJobPhase,
  type OverviewLeaderNeeds,
  type OverviewRisk,
  type OverviewTask,
  type OverviewTaskStage
} from "../../contracts/production-overview.js";
import type { ColorToken, UserRef } from "../../contracts/work.js";
import { coreMinutesBetween, type CoreWindow } from "./core-clock.js";

/**
 * PD-080 — Overview V2 as pure functions over the rows the service reads (unit tested without a database): which jobs and
 * lines the time range shows, each line's stage, the job's phase / images / clocks, the five cards and "Cần bạn xử lý".
 * Definitions: contracts/production-overview.ts.
 */

export type OverviewLineRow = {
  id: string;
  jobId: string;
  number: number;
  code: string;
  process: { id: string; name: string; isQc: boolean };
  assignee: UserRef;
  qc: UserRef | null;
  status: { id: string; code: string; name: string; color: ColorToken };
  assignedAt: Date;
  deadline: Date;
  doneAt: Date | null;
  /** Finished per the workflow rule (PD-045 `isLineFinished`), for statuses outside the known codes. */
  finished: boolean;
  /** Line + subtasks; null when neither has a quantity. */
  qtyAssigned: number | null;
  qtyDone: number | null;
  note: string | null;
  /** When the line last entered Chờ QC (task_logs), for a line waiting for QC. */
  waitingSince: Date | null;
};

export type OverviewJobRow = {
  id: string;
  code: string;
  name: string | null;
  project: { id: string; code: string; name: string };
  leader: UserRef | null;
  receivedAt: Date;
  deadline: Date;
  createdAt: Date;
  /** The creator holds ACCOUNT. */
  createdByAccount: boolean;
  totalImages: number;
  status: { id: string; name: string; color: string; kind: JobStatusKind };
  owned: boolean;
  lastActivityAt: Date;
};

export type OverviewRiskRow = Omit<OverviewRisk, "since" | "evaluatedAt"> & { since: Date; evaluatedAt: Date };

export type OverviewBuildInput = {
  now: Date;
  /** [start, end) instants of the range's days. */
  range: { start: Date; end: Date };
  window: CoreWindow;
  alertMinutes: number;
  jobs: readonly OverviewJobRow[];
  /** Every live line (not subtasks) of those jobs. */
  lines: readonly OverviewLineRow[];
  /** People on approved leave at `now`. */
  onLeaveNow: ReadonlySet<string>;
  risks: ReadonlyMap<string, OverviewRiskRow>;
};

const knownStages: Record<string, OverviewTaskStage> = {
  ASSIGNED: "ASSIGNED",
  PROCESSING: "PROCESSING",
  REWORK: "REWORK",
  WAITING_QC: "WAITING_QC",
  QC_CHECKING: "QC_CHECKING",
  FEEDBACK: "FEEDBACK",
  CHECKED: "CHECKED",
  COMPLETE: "COMPLETE",
  DELIVERING: "COMPLETE",
  DELIVERED: "COMPLETE"
};

/**
 * Stage of a line: by its status code; Done = waiting for QC (the system moves it to Chờ QC as soon as a QC is named) —
 * except a Checking line, whose work is over once Done (CHECKED). Other (admin-added) statuses: finished → CHECKED, else
 * PROCESSING.
 */
export const stageOfLine = (line: Pick<OverviewLineRow, "status" | "process" | "doneAt" | "finished">): OverviewTaskStage => {
  if (line.status.code === "DONE") {
    return line.process.isQc && line.doneAt !== null ? "CHECKED" : "WAITING_QC";
  }
  return knownStages[line.status.code] ?? (line.finished ? "CHECKED" : "PROCESSING");
};

/** Images of a line: Done quantities once the worker is done, the given ones before (line + subtasks); null = unknown. */
export const lineImages = (line: Pick<OverviewLineRow, "doneAt" | "qtyAssigned" | "qtyDone">) =>
  line.doneAt !== null ? (line.qtyDone ?? line.qtyAssigned) : (line.qtyAssigned ?? line.qtyDone);

/** Images given to someone on a line (for "chưa chia" of the bar): its quantity, else its Done quantity, else 0. */
const assignedImages = (line: Pick<OverviewLineRow, "qtyAssigned" | "qtyDone">) => line.qtyAssigned ?? line.qtyDone ?? 0;

const within = (at: Date, range: { start: Date; end: Date }) => at >= range.start && at < range.end;

/** Stages whose line is still with its worker (the "Không cập nhật" clock watches them). */
const workerStages: readonly OverviewTaskStage[] = ["ASSIGNED", "PROCESSING", "REWORK"];

/** The job phase: its status kind, except READY (every line finished, kind before COMPLETE). */
export const jobPhaseOf = (kind: JobStatusKind, lineGroups: readonly ("IN_PROGRESS" | "DONE")[]): OverviewJobPhase => {
  if (finishedJobStatusKinds.includes(kind)) {
    return kind;
  }
  return lineGroups.length > 0 && lineGroups.every((group) => group === "DONE") ? "READY" : kind;
};

const sumImages = (lines: readonly OverviewTask[]) => lines.reduce((sum, line) => sum + (line.process.isQc ? 0 : (line.images ?? 0)), 0);

/** Builds the shown jobs (time rules 1–4) with their lines, images, clocks and At risk. */
export const buildOverviewJobs = (input: OverviewBuildInput): OverviewJob[] => {
  const { now, range, window, alertMinutes, onLeaveNow } = input;
  const linesByJob = new Map<string, OverviewLineRow[]>();
  for (const line of input.lines) {
    const list = linesByJob.get(line.jobId) ?? [];
    list.push(line);
    linesByJob.set(line.jobId, list);
  }
  const jobs: OverviewJob[] = [];
  for (const job of input.jobs) {
    const kind = job.status.kind;
    const lines = (linesByJob.get(job.id) ?? []).slice().sort((a, b) => a.deadline.getTime() - b.deadline.getTime() || a.number - b.number);
    const clientLate = job.deadline < now && !deliveredJobStatusKinds.includes(kind);
    const full = within(job.deadline, range) || clientLate;
    const tasks: OverviewTask[] = lines.map((line) => {
      const stage = stageOfLine(line);
      const group = groupOfStage(stage);
      const qcOnLeave = line.qc !== null && onLeaveNow.has(line.qc.id);
      let qcWait: OverviewTask["qcWait"] = null;
      if (stage === "WAITING_QC") {
        const since = line.waitingSince ?? line.doneAt ?? line.assignedAt;
        const minutes = coreMinutesBetween(since, now, window);
        qcWait = { since: since.toISOString(), minutes, alert: minutes >= alertMinutes || qcOnLeave };
      }
      return {
        id: line.id,
        code: line.code,
        process: line.process,
        assignee: line.assignee,
        qc: line.qc,
        status: line.status,
        stage,
        group,
        deadline: line.deadline.toISOString(),
        overdue: group === "IN_PROGRESS" && line.doneAt === null && line.deadline < now,
        images: lineImages(line),
        note: line.note,
        qcWait,
        assigneeOnLeave: onLeaveNow.has(line.assignee.id),
        qcOnLeave
      };
    });
    const shown = full ? tasks : tasks.filter((task, index) => within(lines[index]!.deadline, range) || task.overdue);
    if (!full && shown.length === 0) {
      continue;
    }
    const workDone = finishedJobStatusKinds.includes(kind);
    const assigned = lines.reduce((sum, line) => sum + (line.process.isQc ? 0 : assignedImages(line)), 0);
    const done = sumImages(shown.filter((task) => task.group === "DONE"));
    const inProgress = sumImages(shown.filter((task) => task.group === "IN_PROGRESS"));
    const unassigned = full && !workDone ? Math.max(0, job.totalImages - assigned) : 0;
    const noTasks = full && lines.length === 0 && !workDone;

    // "Không cập nhật": only while a line is still with its worker.
    const open = tasks.filter((task) => workerStages.includes(task.stage));
    let stale: OverviewJob["stale"] = null;
    if (open.length > 0) {
      const minutes = coreMinutesBetween(job.lastActivityAt, now, window);
      if (open.some((task) => task.assigneeOnLeave)) {
        stale = { minutes, reason: "STAFF_ON_LEAVE" };
      } else if (minutes >= alertMinutes) {
        stale = { minutes, reason: "IDLE" };
      }
    }
    const riskRow = input.risks.get(job.id);
    const risk = riskRow && !clientLate && !workDone ? { ...riskRow, since: riskRow.since.toISOString(), evaluatedAt: riskRow.evaluatedAt.toISOString() } : null;
    const people = new Map<string, UserRef>();
    for (const line of lines.slice().sort((a, b) => a.assignedAt.getTime() - b.assignedAt.getTime() || a.number - b.number)) {
      people.set(line.assignee.id, line.assignee);
    }
    jobs.push({
      id: job.id,
      code: job.code,
      name: job.name,
      project: job.project,
      leader: job.leader,
      receivedAt: job.receivedAt.toISOString(),
      deadline: job.deadline.toISOString(),
      createdAt: job.createdAt.toISOString(),
      status: job.status,
      phase: jobPhaseOf(kind, tasks.map((task) => task.group)),
      totalImages: job.totalImages,
      full,
      clientLate,
      noTasks,
      lineCount: lines.length,
      images: { done, inProgress, unassigned, total: done + inProgress + unassigned },
      tasksWithoutQty: shown.filter((task) => !task.process.isQc && task.images === null).length,
      lastActivityAt: job.lastActivityAt.toISOString(),
      stale,
      risk,
      newNotSplit: noTasks && job.createdByAccount && coreMinutesBetween(job.createdAt, now, window) >= alertMinutes,
      owned: job.owned,
      people: [...people.values()],
      tasks: shown
    });
  }
  return jobs.sort(overviewJobOrder);
};

/** The five cards over the shown jobs (see the contract). */
export const overviewCards = (jobs: readonly OverviewJob[]): OverviewCards => {
  const tasks = jobs.flatMap((job) => job.tasks);
  const inProgress = tasks.filter((task) => task.group === "IN_PROGRESS");
  const done = tasks.filter((task) => task.group === "DONE");
  const overdue = tasks.filter((task) => task.overdue);
  const unassigned = jobs.filter((job) => job.noTasks);
  return {
    total: { tasks: tasks.length, images: sumImages(tasks), jobs: jobs.length },
    unassigned: { jobs: unassigned.length, images: unassigned.reduce((sum, job) => sum + job.totalImages, 0) },
    inProgress: { tasks: inProgress.length, images: sumImages(inProgress) },
    done: { tasks: done.length, images: sumImages(done) },
    overdue: { tasks: overdue.length, clientJobs: jobs.filter((job) => job.clientLate).length, images: sumImages(overdue) }
  };
};

/** "Cần bạn xử lý" of a Leader (also Quản trị / Director). */
export const leaderNeedsOf = (jobs: readonly OverviewJob[]): OverviewLeaderNeeds => ({
  atRisk: jobs.filter((job) => job.risk !== null).length,
  unassignedJobs: jobs.filter((job) => job.noTasks).length,
  qcWaitImages: jobs.reduce((sum, job) => sum + sumImages(job.tasks.filter((task) => task.qcWait?.alert)), 0),
  feedbackJobs: jobs.filter((job) => job.phase === "FEEDBACK").length,
  readyJobs: jobs.filter((job) => job.phase === "READY").length,
  staleJobs: jobs.filter((job) => job.stale !== null).length
});

/** "Cần bạn xử lý" of an Account. */
export const accountNeedsOf = (jobs: readonly OverviewJob[]): OverviewAccountNeeds => ({
  readyToDeliver: jobs.filter((job) => job.phase === "COMPLETE").length,
  atRisk: jobs.filter((job) => job.risk !== null).length,
  clientLate: jobs.filter((job) => job.clientLate).length,
  newNotSplit: jobs.filter((job) => job.newNotSplit).length
});
