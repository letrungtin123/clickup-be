import type { JobStatusRef } from "../../contracts/production-jobs.js";
import type { QuerySql } from "../../lib/db-types.js";
import { toIso } from "../../lib/db-types.js";
import { toColor } from "../work/mappers.js";

/**
 * Small read helpers shared by the notification handlers (worker) and the production user administration (API).
 * No dependencies on other production services, so both sides can import them without cycles.
 */

/** Active members holding production ADMIN, plus organization superadmins (implicitly ADMIN, PD-011). */
export const loadProductionAdminIds = async (sql: QuerySql, organizationId: string) =>
  (
    await sql<{ user_id: string }[]>`
      SELECT ur.user_id FROM production.user_roles ur
      JOIN public.organization_memberships om
        ON om.organization_id = ur.organization_id AND om.user_id = ur.user_id AND om.deleted_at IS NULL AND om.status = 'active'
      WHERE ur.organization_id = ${organizationId} AND ur.role_code = 'ADMIN'
      UNION
      SELECT om.user_id FROM public.organization_memberships om
      JOIN public.roles r ON r.id = om.role_id AND r.organization_id = om.organization_id AND r.key = 'superadmin'
      WHERE om.organization_id = ${organizationId} AND om.deleted_at IS NULL AND om.status = 'active'
    `
  ).map((row) => row.user_id);

/**
 * Active members holding any of the production `roles`, plus organization superadmins (implicitly ADMIN, PD-011) —
 * e.g. ACCOUNT / ADMIN for the job status notification (PD-045).
 */
export const loadProductionRoleHolderIds = async (sql: QuerySql, organizationId: string, roles: readonly string[]) =>
  (
    await sql<{ user_id: string }[]>`
      SELECT ur.user_id FROM production.user_roles ur
      JOIN public.organization_memberships om
        ON om.organization_id = ur.organization_id AND om.user_id = ur.user_id AND om.deleted_at IS NULL AND om.status = 'active'
      WHERE ur.organization_id = ${organizationId} AND ur.role_code = ANY(${[...roles]}::text[])
      UNION
      SELECT om.user_id FROM public.organization_memberships om
      JOIN public.roles r ON r.id = om.role_id AND r.organization_id = om.organization_id AND r.key = 'superadmin'
      WHERE om.organization_id = ${organizationId} AND om.deleted_at IS NULL AND om.status = 'active'
    `
  ).map((row) => row.user_id);

export type LedJob = {
  id: string;
  code: string;
  name: string | null;
  deadline: string;
  /** Manual job status (PD-038). */
  jobStatus: JobStatusRef;
  taskCount: number;
};

export type LedJobs = {
  displayName: string;
  /** The person still holds LEADER or ADMIN as an active member (or is superadmin): their jobs are fine. */
  leaderActive: boolean;
  /** Open jobs (not archived, not deleted, manual status not closed — PD-038) whose `leader_id` is the person, by deadline. */
  items: LedJob[];
};

/**
 * Open jobs a person is the leader of (SEC2-04 follow-up, PD-024): after LEADER is removed from someone, these are
 * the jobs an Account / Admin must hand to another Leader (`PATCH /production/jobs/:id` leaderId).
 */
export const listOpenJobsLedBy = async (sql: QuerySql, organizationId: string, userId: string): Promise<LedJobs> => {
  const [person] = await sql<{ display_name: string; leader_active: boolean }[]>`
    SELECT au.display_name,
      EXISTS (
        SELECT 1 FROM public.organization_memberships om
        WHERE om.organization_id = ${organizationId} AND om.user_id = au.id AND om.status = 'active' AND om.deleted_at IS NULL
          AND (
            EXISTS (SELECT 1 FROM public.roles r WHERE r.id = om.role_id AND r.key = 'superadmin')
            OR EXISTS (
              SELECT 1 FROM production.user_roles ur
              WHERE ur.organization_id = om.organization_id AND ur.user_id = om.user_id AND ur.role_code IN ('LEADER', 'ADMIN')
            )
          )
      ) AS leader_active
    FROM public.app_users au WHERE au.id = ${userId}
  `;
  const rows = await sql<
    {
      id: string;
      code: string;
      name: string | null;
      deadline: Date;
      job_status_id: string;
      job_status_name: string;
      job_status_color: string;
      job_status_closed: boolean;
      job_status_requires_all_checked: boolean;
      task_count: number;
    }[]
  >`
    SELECT j.id, j.code, j.name, j.deadline,
      js.id AS job_status_id, js.name AS job_status_name, js.color AS job_status_color, js.is_closed AS job_status_closed,
      js.requires_all_checked AS job_status_requires_all_checked,
      -- Lines only: a subtask (PD-044) is part of its line.
      (SELECT count(*)::int FROM production.tasks t
        WHERE t.organization_id = j.organization_id AND t.job_id = j.id AND t.deleted_at IS NULL
          AND NOT (t.kind = 'NORMAL' AND t.parent_task_id IS NOT NULL)) AS task_count
    FROM production.jobs j
    JOIN production.job_statuses js ON js.organization_id = j.organization_id AND js.id = j.job_status_id
    WHERE j.organization_id = ${organizationId} AND j.leader_id = ${userId} AND j.archived_at IS NULL AND j.deleted_at IS NULL
      AND NOT js.is_closed
    ORDER BY j.deadline, j.id
    LIMIT 500
  `;
  return {
    displayName: person?.display_name ?? "",
    leaderActive: person?.leader_active ?? false,
    items: rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      deadline: toIso(row.deadline),
      jobStatus: {
        id: row.job_status_id,
        name: row.job_status_name,
        color: toColor(row.job_status_color),
        isClosed: row.job_status_closed,
        requiresAllChecked: row.job_status_requires_all_checked
      },
      taskCount: row.task_count
    }))
  };
};
