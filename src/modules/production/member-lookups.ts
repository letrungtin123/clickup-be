import type { QuerySql } from "../../lib/db-types.js";
import { toIso } from "../../lib/db-types.js";

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

export type LedJob = {
  id: string;
  code: string;
  name: string | null;
  deadline: string;
  statusCode: string | null;
  statusName: string | null;
  taskCount: number;
};

export type LedJobs = {
  displayName: string;
  /** The person still holds LEADER or ADMIN as an active member (or is superadmin): their jobs are fine. */
  leaderActive: boolean;
  /** Open jobs (not archived, not in a terminal status) whose `leader_id` is the person, by deadline. */
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
    { id: string; code: string; name: string | null; deadline: Date; status_code: string | null; status_name: string | null; task_count: number }[]
  >`
    SELECT j.id, j.code, j.name, j.deadline, s.code AS status_code, s.name AS status_name,
      (SELECT count(*)::int FROM production.tasks t WHERE t.organization_id = j.organization_id AND t.job_id = j.id) AS task_count
    FROM production.jobs j
    LEFT JOIN production.statuses s ON s.organization_id = j.organization_id AND s.id = j.status_id
    WHERE j.organization_id = ${organizationId} AND j.leader_id = ${userId} AND j.archived_at IS NULL
      AND (s.id IS NULL OR NOT s.is_terminal)
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
      statusCode: row.status_code,
      statusName: row.status_name,
      taskCount: row.task_count
    }))
  };
};
