import {
  anomalyKinds,
  fastDoneMinutes,
  type Anomaly,
  type AnomalyKind,
  type AnomalyList
} from "../../contracts/production-reports.js";
import type { UserRef } from "../../contracts/work.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { toIso, type QuerySql } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { assertProductionRole, isProductionAdmin } from "./access.js";
import { loadSettings } from "./catalog.service.js";

/**
 * Anomalies report (SPEC Phase 5 §5, PLAN §10) — LEADER: tasks of the jobs they lead; ADMIN: every job.
 * Window: the last `days` days (default 30) by first Done (tasks) / recording time (scores).
 *  - QTY_MISMATCH: Done with qty_done ≠ qty_assigned; who set the quantity = latest QTY correction log,
 *    else the Done log that recorded it. Key "<task>:<qty_done>" (a new correction shows it again).
 *  - QC_FAIL_REPEAT: qc_fail_count ≥ 2. Key "<task>:<count>".
 *  - WORKER_FAIL_RATE: per assignee over tasks Done in the window, fb_rate (FB_WRONG / tasks) or
 *    qc_fail_rate (tasks failed by QC at least once / tasks) strictly above settings.anomalyFailRate.
 *    Key "<user>:<fb_wrong>:<qc_failed>" (new incidents show it again).
 *  - FAST_DONE: first Done ≤ 5 minutes after assigned_at. Key "<task>".
 *  - MISSING_CREDIT_RULE: original score entries recorded without a credit rule (0 credits; not FB_WRONG,
 *    which never earns). Key "<entry>".
 * "Đã xem" (production.anomaly_reviews) hides a row until its key changes; includeReviewed lists them too.
 */

const org = (context: AccessContext) => context.organization.id;
const perKindLimit = 500;

type UserCols = { id: string; display_name: string; email: string | null; avatar_url: string | null };
const userRef = (row: UserCols | null): UserRef | null =>
  row ? { id: row.id, displayName: row.display_name, email: row.email, avatarUrl: row.avatar_url } : null;
type TaskCols = { task_id: string; task_number: string; job_id: string; job_code: string };
const taskRef = (row: TaskCols) => ({ id: row.task_id, number: Number(row.task_number), jobId: row.job_id, jobCode: row.job_code });

type ReviewRow = { kind: AnomalyKind; subject_key: string; reviewed_at: Date; note: string | null; reviewer: UserCols | null };

const leaderScope = (sql: QuerySql, leaderId: string | null) => (leaderId ? sql`AND j.leader_id = ${leaderId}` : sql``);

type Draft = Omit<Anomaly, "reviewed"> & { reviewed?: never };

const queryQtyMismatch = async (sql: QuerySql, organizationId: string, since: Date, leaderId: string | null): Promise<Draft[]> => {
  const rows = await sql<
    (TaskCols & { assignee: UserCols; qty_assigned: number; qty_done: number; done_at: Date; changed_by: UserCols | null; changed_at: Date | null; action: string | null })[]
  >`
    SELECT t.id AS task_id, t.number::text AS task_number, t.job_id, j.code AS job_code,
      json_build_object('id', ua.id, 'display_name', ua.display_name, 'email', ua.email, 'avatar_url', ua.avatar_url) AS assignee,
      t.qty_assigned, t.qty_done, t.done_at,
      CASE WHEN uc.id IS NULL THEN NULL
        ELSE json_build_object('id', uc.id, 'display_name', uc.display_name, 'email', uc.email, 'avatar_url', uc.avatar_url) END AS changed_by,
      lg.created_at AS changed_at, lg.action
    FROM production.tasks t
    JOIN production.jobs j ON j.organization_id = t.organization_id AND j.id = t.job_id
    JOIN public.app_users ua ON ua.id = t.assignee_id
    LEFT JOIN LATERAL (
      SELECT l.user_id, l.created_at, l.action FROM production.task_logs l
      WHERE l.organization_id = t.organization_id AND l.task_id = t.id
        AND (l.action = 'QTY' OR (l.action = 'STATUS' AND l.to_value ? 'qtyDone'))
      ORDER BY l.created_at DESC
      LIMIT 1
    ) lg ON true
    LEFT JOIN public.app_users uc ON uc.id = lg.user_id
    WHERE t.organization_id = ${organizationId} AND t.done_at >= ${since} AND t.qty_done IS NOT NULL AND t.qty_done <> t.qty_assigned
      ${leaderScope(sql, leaderId)}
    ORDER BY t.done_at DESC, t.id
    LIMIT ${perKindLimit + 1}
  `;
  return rows.map((row) => ({
    kind: "QTY_MISMATCH" as const,
    key: `${row.task_id}:${row.qty_done}`,
    at: toIso(row.changed_at ?? row.done_at),
    task: taskRef(row),
    user: userRef(row.assignee),
    qtyAssigned: row.qty_assigned,
    qtyDone: row.qty_done,
    difference: row.qty_done - row.qty_assigned,
    changedBy: userRef(row.changed_by),
    changedAt: row.changed_at ? toIso(row.changed_at) : null,
    source: row.action === "QTY" ? ("CORRECTION" as const) : row.action === "STATUS" ? ("DONE" as const) : null
  }));
};

const queryQcFailRepeat = async (sql: QuerySql, organizationId: string, since: Date, leaderId: string | null): Promise<Draft[]> => {
  const rows = await sql<
    (TaskCols & { assignee: UserCols; qc_fail_count: number; updated_at: Date; status_id: string; status_code: string; status_name: string; status_color: string })[]
  >`
    SELECT t.id AS task_id, t.number::text AS task_number, t.job_id, j.code AS job_code,
      json_build_object('id', ua.id, 'display_name', ua.display_name, 'email', ua.email, 'avatar_url', ua.avatar_url) AS assignee,
      t.qc_fail_count, t.updated_at, s.id AS status_id, s.code AS status_code, s.name AS status_name, s.color AS status_color
    FROM production.tasks t
    JOIN production.jobs j ON j.organization_id = t.organization_id AND j.id = t.job_id
    JOIN production.statuses s ON s.organization_id = t.organization_id AND s.id = t.status_id
    JOIN public.app_users ua ON ua.id = t.assignee_id
    WHERE t.organization_id = ${organizationId} AND t.done_at >= ${since} AND t.qc_fail_count >= 2
      ${leaderScope(sql, leaderId)}
    ORDER BY t.updated_at DESC, t.id
    LIMIT ${perKindLimit + 1}
  `;
  return rows.map((row) => ({
    kind: "QC_FAIL_REPEAT" as const,
    key: `${row.task_id}:${row.qc_fail_count}`,
    at: toIso(row.updated_at),
    task: taskRef(row),
    user: userRef(row.assignee),
    qcFailCount: row.qc_fail_count,
    status: { id: row.status_id, code: row.status_code, name: row.status_name, color: row.status_color as Extract<Anomaly, { kind: "QC_FAIL_REPEAT" }>["status"]["color"] }
  }));
};

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

const queryWorkerFailRate = async (
  sql: QuerySql,
  organizationId: string,
  since: Date,
  leaderId: string | null,
  threshold: number
): Promise<Draft[]> => {
  const rows = await sql<
    (UserCols & { task_count: number; fb_wrong: number; qc_failed: number; last_incident: Date | null; last_done: Date })[]
  >`
    SELECT ua.id, ua.display_name, ua.email, ua.avatar_url, a.task_count, a.fb_wrong, a.qc_failed, a.last_incident, a.last_done
    FROM (
      SELECT t.assignee_id, count(*)::int AS task_count,
        count(*) FILTER (WHERE t.kind = 'FB_WRONG')::int AS fb_wrong,
        count(*) FILTER (WHERE t.qc_fail_count > 0)::int AS qc_failed,
        max(t.done_at) FILTER (WHERE t.kind = 'FB_WRONG' OR t.qc_fail_count > 0) AS last_incident,
        max(t.done_at) AS last_done
      FROM production.tasks t
      JOIN production.jobs j ON j.organization_id = t.organization_id AND j.id = t.job_id
      WHERE t.organization_id = ${organizationId} AND t.done_at >= ${since} ${leaderScope(sql, leaderId)}
      GROUP BY t.assignee_id
    ) a
    JOIN public.app_users ua ON ua.id = a.assignee_id
    WHERE a.fb_wrong::numeric / a.task_count > ${threshold} OR a.qc_failed::numeric / a.task_count > ${threshold}
    ORDER BY greatest(a.fb_wrong, a.qc_failed)::numeric / a.task_count DESC, ua.display_name
    LIMIT ${perKindLimit + 1}
  `;
  return rows.map((row) => ({
    kind: "WORKER_FAIL_RATE" as const,
    key: `${row.id}:${row.fb_wrong}:${row.qc_failed}`,
    at: toIso(row.last_incident ?? row.last_done),
    task: null,
    user: userRef(row),
    taskCount: row.task_count,
    fbWrongCount: row.fb_wrong,
    fbRate: round4(row.fb_wrong / row.task_count),
    qcFailedCount: row.qc_failed,
    qcFailRate: round4(row.qc_failed / row.task_count),
    threshold
  }));
};

const queryFastDone = async (sql: QuerySql, organizationId: string, since: Date, leaderId: string | null): Promise<Draft[]> => {
  const rows = await sql<(TaskCols & { assignee: UserCols; assigned_at: Date; done_at: Date; qty_done: number | null; seconds: string })[]>`
    SELECT t.id AS task_id, t.number::text AS task_number, t.job_id, j.code AS job_code,
      json_build_object('id', ua.id, 'display_name', ua.display_name, 'email', ua.email, 'avatar_url', ua.avatar_url) AS assignee,
      t.assigned_at, t.done_at, t.qty_done, extract(epoch FROM t.done_at - t.assigned_at)::text AS seconds
    FROM production.tasks t
    JOIN production.jobs j ON j.organization_id = t.organization_id AND j.id = t.job_id
    JOIN public.app_users ua ON ua.id = t.assignee_id
    WHERE t.organization_id = ${organizationId} AND t.done_at >= ${since}
      AND t.done_at <= t.assigned_at + make_interval(mins => ${fastDoneMinutes})
      ${leaderScope(sql, leaderId)}
    ORDER BY t.done_at DESC, t.id
    LIMIT ${perKindLimit + 1}
  `;
  return rows.map((row) => ({
    kind: "FAST_DONE" as const,
    key: row.task_id,
    at: toIso(row.done_at),
    task: taskRef(row),
    user: userRef(row.assignee),
    assignedAt: toIso(row.assigned_at),
    doneAt: toIso(row.done_at),
    minutes: Math.round((Number(row.seconds) / 60) * 10) / 10,
    qtyDone: row.qty_done
  }));
};

const queryMissingRule = async (sql: QuerySql, organizationId: string, since: Date, leaderId: string | null): Promise<Draft[]> => {
  const rows = await sql<
    (TaskCols & { entry_id: string; earner: UserCols; role: "WORKER" | "QC"; project_code: string; process_name: string | null; qty: number; business_day: string; created_at: Date })[]
  >`
    SELECT e.id AS entry_id, t.id AS task_id, t.number::text AS task_number, t.job_id, j.code AS job_code,
      json_build_object('id', u.id, 'display_name', u.display_name, 'email', u.email, 'avatar_url', u.avatar_url) AS earner,
      e.role, p.code AS project_code, pr.name AS process_name, e.qty, to_char(e.business_day, 'YYYY-MM-DD') AS business_day, e.created_at
    FROM production.score_entries e
    JOIN production.tasks t ON t.organization_id = e.organization_id AND t.id = e.task_id
    JOIN production.jobs j ON j.organization_id = e.organization_id AND j.id = e.job_id
    JOIN production.projects p ON p.organization_id = e.organization_id AND p.id = e.project_id
    LEFT JOIN production.processes pr ON pr.organization_id = e.organization_id AND pr.id = e.process_id
    JOIN public.app_users u ON u.id = e.user_id
    WHERE e.organization_id = ${organizationId} AND e.credit_rule_id IS NULL AND e.adjusts_entry_id IS NULL
      AND e.created_at >= ${since} AND e.kind <> 'FB_WRONG'
      ${leaderScope(sql, leaderId)}
    ORDER BY e.created_at DESC, e.id
    LIMIT ${perKindLimit + 1}
  `;
  return rows.map((row) => ({
    kind: "MISSING_CREDIT_RULE" as const,
    key: row.entry_id,
    at: toIso(row.created_at),
    task: taskRef(row),
    user: userRef(row.earner),
    role: row.role,
    projectCode: row.project_code,
    processName: row.process_name,
    qty: row.qty,
    businessDay: row.business_day
  }));
};

const kindQueries: Record<
  AnomalyKind,
  (sql: QuerySql, organizationId: string, since: Date, leaderId: string | null, threshold: number) => Promise<Draft[]>
> = {
  QTY_MISMATCH: queryQtyMismatch,
  QC_FAIL_REPEAT: queryQcFailRepeat,
  WORKER_FAIL_RATE: queryWorkerFailRate,
  FAST_DONE: queryFastDone,
  MISSING_CREDIT_RULE: queryMissingRule
};

/** GET /production/anomalies. */
export const listAnomalies = async (
  context: AccessContext,
  query: { kind?: AnomalyKind | undefined; days: number; includeReviewed: boolean }
): Promise<AnomalyList> => {
  assertProductionRole(context, "LEADER");
  const sql = getSql();
  const organizationId = org(context);
  const leaderId = isProductionAdmin(context) ? null : context.user.id;
  const settings = await loadSettings(sql, organizationId);
  const threshold = settings.anomalyFailRate;
  const since = new Date(Date.now() - query.days * 86_400_000);
  const kinds = query.kind ? [query.kind] : [...anomalyKinds];

  const results = await Promise.all(kinds.map((kind) => kindQueries[kind](sql, organizationId, since, leaderId, threshold)));
  const truncated = results.some((rows) => rows.length > perKindLimit);
  const drafts = results.flatMap((rows) => rows.slice(0, perKindLimit));

  const reviews =
    drafts.length === 0
      ? []
      : await sql<ReviewRow[]>`
          SELECT r.kind, r.subject_key, r.reviewed_at, r.note,
            CASE WHEN u.id IS NULL THEN NULL
              ELSE json_build_object('id', u.id, 'display_name', u.display_name, 'email', u.email, 'avatar_url', u.avatar_url) END AS reviewer
          FROM production.anomaly_reviews r
          LEFT JOIN public.app_users u ON u.id = r.reviewed_by
          WHERE r.organization_id = ${organizationId}
            AND (r.kind, r.subject_key) IN (
              SELECT * FROM unnest(${drafts.map((draft) => draft.kind)}::text[], ${drafts.map((draft) => draft.key)}::text[])
            )
        `;
  const reviewed = new Map(reviews.map((row) => [`${row.kind}|${row.subject_key}`, row]));

  const counts = Object.fromEntries(anomalyKinds.map((kind) => [kind, 0])) as Record<AnomalyKind, number>;
  const items: Anomaly[] = [];
  for (const draft of drafts) {
    const review = reviewed.get(`${draft.kind}|${draft.key}`);
    if (!review) {
      counts[draft.kind] += 1;
    }
    if (review && !query.includeReviewed) {
      continue;
    }
    items.push({
      ...draft,
      reviewed: review ? { by: userRef(review.reviewer), at: toIso(review.reviewed_at), note: review.note } : null
    } as Anomaly);
  }
  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return { since: since.toISOString(), days: query.days, threshold, leaderId, counts, items, truncated };
};

// "Đã xem" ------------------------------------------------------------------------------------------------

const anomalyNotFound = () => new AppError("ANOMALY_NOT_FOUND", "Không tìm thấy bất thường.", 404);

/**
 * Resolves the subject of a key inside the caller's scope: the task (task kinds), the score entry's task
 * (MISSING_CREDIT_RULE) or the worker (WORKER_FAIL_RATE, who must have worked on a job the LEADER leads).
 * Returns the task id to store, or throws 404.
 */
const resolveSubject = async (sql: QuerySql, context: AccessContext, kind: AnomalyKind, key: string): Promise<string | null> => {
  const organizationId = org(context);
  const subjectId = key.slice(0, 36);
  const leaderId = isProductionAdmin(context) ? null : context.user.id;
  const scope = leaderScope(sql, leaderId);
  if (kind === "WORKER_FAIL_RATE") {
    const found = await sql`
      SELECT 1 FROM production.tasks t
      JOIN production.jobs j ON j.organization_id = t.organization_id AND j.id = t.job_id
      WHERE t.organization_id = ${organizationId} AND t.assignee_id = ${subjectId} ${scope}
      LIMIT 1
    `;
    if (found.length === 0) {
      throw anomalyNotFound();
    }
    return null;
  }
  const rows =
    kind === "MISSING_CREDIT_RULE"
      ? await sql<{ task_id: string }[]>`
          SELECT e.task_id FROM production.score_entries e
          JOIN production.jobs j ON j.organization_id = e.organization_id AND j.id = e.job_id
          WHERE e.organization_id = ${organizationId} AND e.id = ${subjectId} ${scope}
        `
      : await sql<{ task_id: string }[]>`
          SELECT t.id AS task_id FROM production.tasks t
          JOIN production.jobs j ON j.organization_id = t.organization_id AND j.id = t.job_id
          WHERE t.organization_id = ${organizationId} AND t.id = ${subjectId} ${scope}
        `;
  if (!rows[0]) {
    throw anomalyNotFound();
  }
  return rows[0].task_id;
};

/** POST /production/anomalies/review — mark "Đã xem" (idempotent; a second mark updates who/when). */
export const reviewAnomaly = async (context: AccessContext, input: { kind: AnomalyKind; key: string; note?: string | undefined }) => {
  assertProductionRole(context, "LEADER");
  const sql = getSql();
  const taskId = await resolveSubject(sql, context, input.kind, input.key);
  const row = (
    await sql<{ reviewed_at: Date }[]>`
      INSERT INTO production.anomaly_reviews (organization_id, kind, subject_key, task_id, reviewed_by, note)
      VALUES (${org(context)}, ${input.kind}, ${input.key}, ${taskId}, ${context.user.id}, ${input.note?.trim() || null})
      ON CONFLICT (organization_id, kind, subject_key)
      DO UPDATE SET reviewed_by = EXCLUDED.reviewed_by, reviewed_at = now(), note = EXCLUDED.note
      RETURNING reviewed_at
    `
  )[0]!;
  return { kind: input.kind, key: input.key, reviewedAt: toIso(row.reviewed_at) };
};

/** DELETE /production/anomalies/reviews?kind&key — undo "Đã xem". */
export const unreviewAnomaly = async (context: AccessContext, input: { kind: AnomalyKind; key: string }) => {
  assertProductionRole(context, "LEADER");
  const sql = getSql();
  await resolveSubject(sql, context, input.kind, input.key);
  await sql`
    DELETE FROM production.anomaly_reviews
    WHERE organization_id = ${org(context)} AND kind = ${input.kind} AND subject_key = ${input.key}
  `;
  return { kind: input.kind, key: input.key, reviewedAt: null };
};
