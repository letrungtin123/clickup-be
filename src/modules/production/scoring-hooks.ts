import type { QuerySql } from "../../lib/db-types.js";
import { loadSettings } from "./catalog.service.js";
import { getCreditRule } from "./credit-rules.js";
import {
  computeAdjustment,
  computeQcEntry,
  computeWorkerEntry,
  periodMonth,
  rolesToRecord,
  type PayMode,
  type ScoreDraft,
  type ScoreRole,
  type TaskKind
} from "./scoring.js";
import { businessDay } from "./time.js";

/**
 * Seams between the task workflow engine (Phase 2) and score recording (Phase 3). The engine calls
 * these inside the same transaction as the task change, after the task row is updated.
 * Rules: scoring.ts. Storage: production.score_entries (immutable; corrections are adjustment rows).
 */

export type StatusEnteredInput = {
  organizationId: string;
  taskId: string;
  /** Flags of the status the task just entered. */
  status: { id: string; countsDone: boolean; countsChecked: boolean };
  at: Date;
};

type TaskScoreRow = {
  id: string;
  job_id: string;
  project_id: string;
  assignee_id: string;
  qc_id: string | null;
  process_id: string;
  shift_id: string;
  pay_mode: PayMode;
  kind: TaskKind;
  qty_done: number | null;
  qty_assigned: number;
};

type OriginalRow = {
  id: string;
  role: ScoreRole;
  user_id: string;
  job_id: string;
  project_id: string;
  process_id: string | null;
  shift_id: string;
  pay_mode: PayMode;
  kind: TaskKind;
  credit_rule_id: string | null;
  unit_credits: string;
  unit_money: string;
};

/** Business day and KPI period of the event, from the organization's close day. */
type EventTime = { at: Date; day: string; period: string };

const loadTask = async (sql: QuerySql, organizationId: string, taskId: string) =>
  (
    await sql<TaskScoreRow[]>`
      SELECT t.id, t.job_id, j.project_id, t.assignee_id, t.qc_id, t.process_id, t.shift_id, s.pay_mode, t.kind,
        t.qty_done, t.qty_assigned
      FROM production.tasks t
      JOIN production.jobs j ON j.organization_id = t.organization_id AND j.id = t.job_id
      JOIN production.shifts s ON s.organization_id = t.organization_id AND s.id = t.shift_id
      WHERE t.organization_id = ${organizationId} AND t.id = ${taskId}
    `
  )[0];

const loadOriginals = (sql: QuerySql, organizationId: string, taskId: string) => sql<OriginalRow[]>`
  SELECT id, role, user_id, job_id, project_id, process_id, shift_id, pay_mode, kind, credit_rule_id,
    unit_credits::text AS unit_credits, unit_money::text AS unit_money
  FROM production.score_entries
  WHERE organization_id = ${organizationId} AND task_id = ${taskId} AND adjusts_entry_id IS NULL
`;

const eventTime = async (sql: QuerySql, organizationId: string, at: Date): Promise<EventTime> => {
  const settings = await loadSettings(sql, organizationId);
  return { at, day: businessDay(at), period: periodMonth(at, settings.kpiCloseDay) };
};

/** The single active QC process ("Checking") whose rule prices QC credit (PD-010). */
const qcProcessId = async (sql: QuerySql, organizationId: string) =>
  (
    await sql<{ id: string }[]>`
      SELECT id FROM production.processes WHERE organization_id = ${organizationId} AND is_qc AND active
      ORDER BY sort_order, created_at LIMIT 1
    `
  )[0]?.id ?? null;

const insertOriginal = async (
  sql: QuerySql,
  organizationId: string,
  task: TaskScoreRow,
  entry: ScoreDraft,
  context: { userId: string; processId: string | null; time: EventTime }
) => {
  await sql`
    INSERT INTO production.score_entries (
      organization_id, user_id, task_id, job_id, project_id, process_id, shift_id, role, pay_mode, kind,
      credit_rule_id, unit_credits, unit_money, qty, credits, money, business_day, period_month, created_at
    ) VALUES (
      ${organizationId}, ${context.userId}, ${task.id}, ${task.job_id}, ${task.project_id}, ${context.processId}, ${task.shift_id},
      ${entry.role}, ${entry.payMode}, ${task.kind}, ${entry.creditRuleId}, ${entry.unitCredits}, ${entry.unitMoney}, ${entry.qty},
      ${entry.credits}, ${entry.money}, ${context.time.day}::date, ${context.time.period}::date, ${context.time.at}
    )
    ON CONFLICT (organization_id, task_id, role) WHERE adjusts_entry_id IS NULL DO NOTHING
  `;
};

/**
 * Brings an original entry (plus its adjustments) to `nextQty` with an adjustment row priced at the
 * original's unit values. No row when the ledger already matches.
 */
const adjustTo = async (sql: QuerySql, organizationId: string, taskId: string, original: OriginalRow, nextQty: number, time: EventTime) => {
  const ledgerQty = (
    await sql<{ qty: number }[]>`
      SELECT coalesce(sum(qty), 0)::int AS qty FROM production.score_entries
      WHERE organization_id = ${organizationId} AND (id = ${original.id} OR adjusts_entry_id = ${original.id})
    `
  )[0]!.qty;
  const unit = { unitCredits: Number(original.unit_credits), unitMoney: Number(original.unit_money) };
  const delta = computeAdjustment(unit, ledgerQty, nextQty);
  if (!delta) {
    return;
  }
  await sql`
    INSERT INTO production.score_entries (
      organization_id, user_id, task_id, job_id, project_id, process_id, shift_id, role, pay_mode, kind,
      credit_rule_id, unit_credits, unit_money, qty, credits, money, business_day, period_month, adjusts_entry_id, note, created_at
    ) VALUES (
      ${organizationId}, ${original.user_id}, ${taskId}, ${original.job_id}, ${original.project_id}, ${original.process_id},
      ${original.shift_id}, ${original.role}, ${original.pay_mode}, ${original.kind}, ${original.credit_rule_id},
      ${unit.unitCredits}, ${unit.unitMoney}, ${delta.qty}, ${delta.credits}, ${delta.money},
      ${time.day}::date, ${time.period}::date, ${original.id}, ${`Sửa số lượng ${ledgerQty} → ${nextQty}`}, ${time.at}
    )
  `;
};

/**
 * Called after every status change of a task (including SYSTEM follow-ups).
 * First entry into a counts_done status → WORKER entry for the assignee; first entry into a
 * counts_checked status → QC entry for qc_id (QC process rule × qty_done, no money). Rules are looked
 * up at the business day of `at`. Re-entering such a status never writes a second original entry;
 * if qty_done changed in between (e.g. an Admin override), an adjustment brings the entry to it.
 */
export const onTaskStatusEntered = async (sql: QuerySql, input: StatusEnteredInput): Promise<void> => {
  const { countsDone, countsChecked } = input.status;
  if (!countsDone && !countsChecked) {
    return;
  }
  const task = await loadTask(sql, input.organizationId, input.taskId);
  if (!task) {
    return;
  }
  const originals = await loadOriginals(sql, input.organizationId, task.id);
  const recorded = new Set(originals.map((row) => row.role));
  const roles = rolesToRecord({ countsDone, countsChecked, hasQc: task.qc_id !== null, recorded });
  const reentered = originals.filter((row) => (row.role === "WORKER" ? countsDone : countsChecked));
  if (roles.length === 0 && (reentered.length === 0 || task.qty_done === null)) {
    return;
  }

  const time = await eventTime(sql, input.organizationId, input.at);
  const qty = task.qty_done ?? task.qty_assigned;
  for (const role of roles) {
    if (role === "WORKER") {
      const rule = await getCreditRule(sql, input.organizationId, task.project_id, task.process_id, time.day);
      const entry = computeWorkerEntry({ rule, qtyDone: qty, payMode: task.pay_mode, kind: task.kind });
      await insertOriginal(sql, input.organizationId, task, entry, { userId: task.assignee_id, processId: task.process_id, time });
    } else {
      const processId = await qcProcessId(sql, input.organizationId);
      const rule = processId ? await getCreditRule(sql, input.organizationId, task.project_id, processId, time.day) : null;
      const entry = computeQcEntry({ rule, qtyDone: qty, kind: task.kind });
      await insertOriginal(sql, input.organizationId, task, entry, { userId: task.qc_id!, processId, time });
    }
  }
  if (task.qty_done !== null) {
    for (const original of reentered) {
      await adjustTo(sql, input.organizationId, task.id, original, task.qty_done, time);
    }
  }
};

/**
 * Called after a Leader/Admin changed qty_done of a task that was already Done: adjustment entries
 * (new − old, at the original unit price) for the WORKER and QC entries that exist. The old quantity
 * is read from the ledger, so a stale `previousQty` cannot double-count.
 */
export const onTaskQtyChanged = async (
  sql: QuerySql,
  input: { organizationId: string; taskId: string; previousQty: number; nextQty: number; at: Date }
): Promise<void> => {
  const originals = await loadOriginals(sql, input.organizationId, input.taskId);
  if (originals.length === 0) {
    return;
  }
  const time = await eventTime(sql, input.organizationId, input.at);
  for (const original of originals) {
    await adjustTo(sql, input.organizationId, input.taskId, original, input.nextQty, time);
  }
};
