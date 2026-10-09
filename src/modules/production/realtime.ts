import { getSql } from "../../db/client.js";
import type { QuerySql } from "../../lib/db-types.js";
import { logger } from "../../lib/logger.js";
import { publishToUsers } from "../../realtime/publisher.js";

/**
 * `production:changed` cache hints (ids only) after a committed production change.
 *
 * PR-20: the hint names a job and its tasks, so it is not broadcast to the organization's production room
 * (every production member). It goes to the personal rooms of the people who may see that job: holders of an
 * all-jobs role (Account / Leader / Admin, and organization superadmins = production Admin) plus the job's
 * leader and everyone working on or checking one of its tasks (PD-014 visibility), plus `extraUserIds` —
 * e.g. someone just taken off a task, whose lists must drop it. Members outside that set get no hint (their
 * screens refresh on focus / their own changes); the client handles the event the same way whatever the room.
 */

export type ProductionChangeKind = "job" | "tasks" | "feedback" | "comment";

/** People allowed to see the job (see above); active organization members only. */
export const jobAudience = async (sql: QuerySql, organizationId: string, jobId: string) =>
  (
    await sql<{ user_id: string }[]>`
      SELECT om.user_id
      FROM public.organization_memberships om
      WHERE om.organization_id = ${organizationId} AND om.deleted_at IS NULL AND om.status = 'active'
        AND (
          EXISTS (SELECT 1 FROM public.roles r WHERE r.id = om.role_id AND r.key = 'superadmin')
          OR EXISTS (
            SELECT 1 FROM production.user_roles ur
            WHERE ur.organization_id = om.organization_id AND ur.user_id = om.user_id AND ur.role_code IN ('ADMIN', 'ACCOUNT', 'LEADER')
          )
          OR EXISTS (SELECT 1 FROM production.jobs j WHERE j.organization_id = om.organization_id AND j.id = ${jobId} AND j.leader_id = om.user_id)
          OR EXISTS (
            SELECT 1 FROM production.tasks t
            WHERE t.organization_id = om.organization_id AND t.job_id = ${jobId} AND (t.assignee_id = om.user_id OR t.qc_id = om.user_id)
          )
        )
    `
  ).map((row) => row.user_id);

export const publishProductionChange = (
  organizationId: string,
  jobId: string,
  taskIds: string[],
  kind: ProductionChangeKind,
  actorId: string | null,
  extraUserIds: readonly (string | null)[] = []
) => {
  const at = new Date().toISOString();
  jobAudience(getSql(), organizationId, jobId)
    .then((audience) => {
      const recipients = [...audience, ...extraUserIds.filter((id): id is string => Boolean(id))];
      publishToUsers(recipients, "production:changed", { jobId, taskIds, kind, actorId, at });
    })
    .catch((error: unknown) => logger.warn({ err: error, jobId }, "Production realtime hint failed"));
};
