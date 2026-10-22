import { AppError } from "../../lib/app-error.js";
import type { QuerySql } from "../../lib/db-types.js";
import { businessDay } from "./time.js";

/**
 * PD-080b — only priced processes. A task line ("Chia task", "Nhập Task", a task edit that changes its process or its
 * Ngày nhận) and a subtask (created, or its process changed) may use a process only when a credit rule of the job's
 * project × that process is in force on the line's Ngày nhận (organization calendar day; a line created without a Ngày
 * nhận: today; a subtask: its line's Ngày nhận). Otherwise 400 PROCESS_NOT_PRICED, every offending line at once. The
 * app's pickers offer only those processes (FE priced-processes.ts). Importers / seed scripts (BE/scripts) bypass the
 * rule: they replay history with the prices of that time. One grouped query per request.
 */

/** One process to check: its day (YYYY-MM-DD) and the prefix of its message ("Task 2: ", "" for a single line). */
export type PricedProcessCheck = { processId: string; day: string; prefix?: string };

/** What the database answers for one check. */
export type PricedProcessRow = {
  index: number;
  process_name: string;
  project_code: string;
  /** A rule of the project × process is in force that day. */
  priced: boolean;
  /** The project has a rule of any process in force that day. */
  project_priced: boolean;
};

const dayLabel = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

/** "Project “X” chưa có đơn giá — liên hệ Quản trị." (the whole project has no price that day). */
export const projectNotPricedMessage = (projectCode: string) => `Project “${projectCode}” chưa có đơn giá — liên hệ Quản trị.`;

/** "Quy trình “Y” chưa có đơn giá cho Project “X” ngày dd/MM/yyyy — liên hệ Quản trị." */
export const processNotPricedMessage = (processName: string, projectCode: string, day: string) =>
  `Quy trình “${processName}” chưa có đơn giá cho Project “${projectCode}” ngày ${dayLabel(day)} — liên hệ Quản trị.`;

/** The messages of the checks that fail (pure; one per offending check, a whole-project message once per day). */
export const pricingProblems = (checks: readonly PricedProcessCheck[], rows: readonly PricedProcessRow[]) => {
  const problems: string[] = [];
  const projectDays = new Set<string>();
  for (const row of [...rows].sort((a, b) => a.index - b.index)) {
    const check = checks[row.index - 1];
    if (!check || row.priced) {
      continue;
    }
    if (!row.project_priced) {
      if (projectDays.has(check.day)) {
        continue;
      }
      projectDays.add(check.day);
      problems.push(`${check.prefix ?? ""}${projectNotPricedMessage(row.project_code)}`);
      continue;
    }
    problems.push(`${check.prefix ?? ""}${processNotPricedMessage(row.process_name, row.project_code, check.day)}`);
  }
  return problems;
};

export const processNotPriced = (message: string) => new AppError("PROCESS_NOT_PRICED", message, 400);

/** The calendar day of a Ngày nhận (ISO / Date), else of `now` (today). */
export const pricingDay = (assignedAt: string | Date | null | undefined, now: Date = new Date()) =>
  businessDay(assignedAt ? new Date(assignedAt) : now);

/**
 * Throws 400 PROCESS_NOT_PRICED when a check's process has no price for the project on its day (all messages joined).
 * Unknown process ids are ignored here (the line validation reports them).
 */
export const assertProcessesPriced = async (sql: QuerySql, organizationId: string, projectId: string, checks: readonly PricedProcessCheck[]) => {
  if (checks.length === 0) {
    return;
  }
  const rows = await sql<PricedProcessRow[]>`
    SELECT c.index::int AS index, pr.name AS process_name, p.code AS project_code,
      EXISTS (
        SELECT 1 FROM production.credit_rules r
        WHERE r.organization_id = ${organizationId} AND r.project_id = p.id AND r.process_id = c.process_id
          AND r.effective_from <= c.day AND (r.effective_to IS NULL OR c.day < r.effective_to)
      ) AS priced,
      EXISTS (
        SELECT 1 FROM production.credit_rules r
        WHERE r.organization_id = ${organizationId} AND r.project_id = p.id
          AND r.effective_from <= c.day AND (r.effective_to IS NULL OR c.day < r.effective_to)
      ) AS project_priced
    FROM unnest(${checks.map((check) => check.processId)}::uuid[], ${checks.map((check) => check.day)}::date[]) WITH ORDINALITY AS c(process_id, day, index)
    JOIN production.processes pr ON pr.organization_id = ${organizationId} AND pr.id = c.process_id
    JOIN production.projects p ON p.organization_id = ${organizationId} AND p.id = ${projectId}
  `;
  const problems = pricingProblems(checks, rows);
  if (problems.length > 0) {
    throw processNotPriced(problems.join(" "));
  }
};
