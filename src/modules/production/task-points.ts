import type { JobPoints, TaskPoints } from "../../contracts/production-jobs.js";
import type { QuerySql } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { creditRuleKey, getCreditRules } from "./credit-rules.js";
import { hasFeature } from "./features.js";
import { computeLineEntry, lineScoreRole, type PayMode, type ScoreRole, type TaskKind } from "./scoring.js";
import { businessDay } from "./time.js";

/**
 * PD-070 "Điểm" of the job List view: per task row (a line or a subtask, PD-048) the assignee's points on an official
 * shift, and a job's total. Recorded rows read the score ledger; rows not recorded yet get the points their first Done
 * would record today — the rule getCreditRule resolves and computeLineEntry's price (scoring-hooks.ts onTaskStatusEntered),
 * never a second formula. Khoán rows (MONEY_IF_KPI) show nothing: never money, never points. Someone else's row needs
 * `view_others_scores` (PD-065; the superadmin always). Batched: one ledger and one rule query per page of rows.
 */

/** One task row as its points need it. */
export type PointsLine = {
  id: string;
  assigneeId: string;
  projectId: string;
  processId: string;
  processIsQc: boolean;
  payMode: PayMode;
  kind: TaskKind;
  qtyAssigned: number | null;
  qtyDone: number | null;
};

/** The row's own ledger: entries of its role (original + adjustments). */
type Ledger = {
  /** Credits of its POINTS entries, in cents (null: none). */
  officialCents: number | null;
  /** Some entry was recorded for someone other than the viewer. */
  others: boolean;
};

export type PointsViewer = { userId: string; seesOthers: boolean };

/** Whether the caller sees other people's points (PD-065 `view_others_scores`; the superadmin always). */
export const pointsViewer = async (context: AccessContext, sql: QuerySql): Promise<PointsViewer> => ({
  userId: context.user.id,
  seesOthers: await hasFeature(context, "view_others_scores", sql)
});

const toCents = (value: number) => Math.round(value * 100);
/** `+ 0` turns -0 into 0. */
const fromCents = (cents: number) => cents / 100 + 0;

/**
 * The points of one row from its ledger (undefined: nothing recorded) and today's rule of its (project, process)
 * (undefined / null: none). null: a Khoán row or a row the viewer may not see.
 */
export const linePoints = (
  line: PointsLine,
  ledger: Ledger | undefined,
  rule: { id: string; creditPerImage: number; moneyPerImage: number | null } | null | undefined,
  viewer: PointsViewer
): TaskPoints | null => {
  const visible = viewer.seesOthers || (line.assigneeId === viewer.userId && !ledger?.others);
  if (!visible) {
    return null;
  }
  if (ledger) {
    // Recorded: the ledger's pay mode decides (the entry keeps the shift it was recorded on).
    return ledger.officialCents === null ? null : { credits: fromCents(ledger.officialCents), expected: false, missing: null };
  }
  if (line.payMode !== "POINTS") {
    return null;
  }
  const qty = line.qtyDone ?? line.qtyAssigned;
  if (qty === null) {
    return { credits: null, expected: true, missing: "QTY" };
  }
  if (!rule) {
    return { credits: null, expected: true, missing: "RULE" };
  }
  const entry = computeLineEntry({ role: lineScoreRole(line.processIsQc), rule, qtyDone: qty, payMode: line.payMode, kind: line.kind });
  return { credits: entry.credits, expected: true, missing: null };
};

/**
 * Points of many rows (ids unique or not) for the viewer: their ledgers (the line's role, PD-037: WORKER, or QC for a
 * Checking line) and today's rules, two queries run together. Rows the viewer may not see are not looked up.
 */
export const loadLinePoints = async (
  sql: QuerySql,
  organizationId: string,
  viewer: PointsViewer,
  lines: readonly PointsLine[],
  at: Date = new Date()
): Promise<Map<string, TaskPoints | null>> => {
  const result = new Map<string, TaskPoints | null>();
  const unique = [...new Map(lines.map((line) => [line.id, line])).values()];
  const looked = unique.filter((line) => viewer.seesOthers || line.assigneeId === viewer.userId);
  if (looked.length === 0) {
    for (const line of unique) {
      result.set(line.id, null);
    }
    return result;
  }
  // Rules only where a Done today would price something (official shift, a quantity); recorded rows ignore them.
  const priced = looked.filter((line) => line.payMode === "POINTS" && (line.qtyDone ?? line.qtyAssigned) !== null);
  const [entries, rules] = await Promise.all([
    sql<{ task_id: string; role: ScoreRole; official: string | null; others: boolean }[]>`
      SELECT task_id, role, (sum(credits) FILTER (WHERE pay_mode = 'POINTS'))::text AS official, bool_or(user_id <> ${viewer.userId}) AS others
      FROM production.score_entries
      WHERE organization_id = ${organizationId} AND task_id = ANY(${looked.map((line) => line.id)}::uuid[])
      GROUP BY task_id, role
    `,
    getCreditRules(sql, organizationId, priced, businessDay(at))
  ]);
  const ledgers = new Map<string, Ledger>();
  const roleOf = new Map(looked.map((line) => [line.id, lineScoreRole(line.processIsQc)]));
  for (const row of entries) {
    // The row's own entry only (a work line's old task-level QC credit, PD-010, belongs to its QC, not to the row).
    if (roleOf.get(row.task_id) === row.role) {
      ledgers.set(row.task_id, { officialCents: row.official === null ? null : toCents(Number(row.official)), others: row.others });
    }
  }
  for (const line of unique) {
    result.set(
      line.id,
      linePoints(line, ledgers.get(line.id), rules.get(creditRuleKey(line.projectId, line.processId)), viewer)
    );
  }
  return result;
};

/**
 * A job's "Điểm" from its rows' points: the sum of what is known (recorded + expected), `expected` when any official row
 * the viewer sees is not recorded yet; null when no row has points (Khoán / hidden rows are null and never count).
 */
export const sumPoints = (points: readonly (TaskPoints | null | undefined)[]): JobPoints | null => {
  let cents = 0;
  let known = false;
  let expected = false;
  for (const item of points) {
    if (!item) {
      continue;
    }
    expected ||= item.expected;
    if (item.credits !== null) {
      cents += toCents(item.credits);
      known = true;
    }
  }
  return known ? { credits: fromCents(cents), expected } : null;
};

/**
 * PD-070 job totals of a page of the job list: one query for the live rows of those jobs (only the `personId` person's in
 * the per-person view), then loadLinePoints. Keyed by job id; jobs without points are absent.
 */
export const loadJobPoints = async (
  sql: QuerySql,
  organizationId: string,
  viewer: PointsViewer,
  jobIds: readonly string[],
  personId?: string
): Promise<Map<string, JobPoints>> => {
  const result = new Map<string, JobPoints>();
  const assignee = personId ?? (viewer.seesOthers ? null : viewer.userId);
  if (jobIds.length === 0 || (personId && !viewer.seesOthers && personId !== viewer.userId)) {
    return result;
  }
  const rows = await sql<
    {
      id: string;
      job_id: string;
      assignee_id: string;
      project_id: string;
      process_id: string;
      process_is_qc: boolean;
      pay_mode: PayMode;
      kind: TaskKind;
      qty_assigned: number | null;
      qty_done: number | null;
    }[]
  >`
    SELECT t.id, t.job_id, t.assignee_id, j.project_id, t.process_id, pr.is_qc AS process_is_qc, sh.pay_mode, t.kind,
      t.qty_assigned, t.qty_done
    FROM production.tasks t
    JOIN production.jobs j ON j.organization_id = t.organization_id AND j.id = t.job_id
    JOIN production.processes pr ON pr.organization_id = t.organization_id AND pr.id = t.process_id
    JOIN production.shifts sh ON sh.organization_id = t.organization_id AND sh.id = t.shift_id
    WHERE t.organization_id = ${organizationId} AND t.job_id = ANY(${[...jobIds]}::uuid[]) AND t.deleted_at IS NULL
      ${assignee ? sql`AND t.assignee_id = ${assignee}` : sql``}
  `;
  const lines = rows.map(
    (row): PointsLine & { jobId: string } => ({
      id: row.id,
      jobId: row.job_id,
      assigneeId: row.assignee_id,
      projectId: row.project_id,
      processId: row.process_id,
      processIsQc: row.process_is_qc,
      payMode: row.pay_mode,
      kind: row.kind,
      qtyAssigned: row.qty_assigned,
      qtyDone: row.qty_done
    })
  );
  const points = await loadLinePoints(sql, organizationId, viewer, lines);
  const byJob = new Map<string, (TaskPoints | null | undefined)[]>();
  for (const line of lines) {
    byJob.set(line.jobId, [...(byJob.get(line.jobId) ?? []), points.get(line.id)]);
  }
  for (const [jobId, items] of byJob) {
    const total = sumPoints(items);
    if (total) {
      result.set(jobId, total);
    }
  }
  return result;
};
