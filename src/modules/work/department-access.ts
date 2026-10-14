import type { Department } from "../../contracts/departments.js";
import { getSql } from "../../db/client.js";
import type { QuerySql } from "../../lib/db-types.js";
import { logger } from "../../lib/logger.js";
import { evictUsersFromRoom, publishToRoom } from "../../realtime/publisher.js";
import type { AccessContext } from "../access/access-context.js";
import { insertActivities } from "./tasks.repo.js";

export type DepartmentRevokedTask = { id: string; projectId: string; listId: string; parentTaskId: string | null };

/**
 * PD-041 on department loss (like PD-006 on project access loss): when `userId` leaves `department`, they stop being
 * assignees of tasks in PUBLIC workspace projects of that department where they are not explicit project members
 * (one TASK_ASSIGNEE_REMOVED activity per task, reason "department_removed") and lose the inbox entries about those
 * projects. Runs inside the caller's transaction (before or after the department row is deleted — the caller decides
 * that the user leaves); the organization superadmin implicitly keeps every department, so nothing changes for them.
 * Private projects are untouched (explicit membership only, independent of departments). Returns the affected tasks;
 * after the commit pass them to `publishDepartmentAccessRevoked` (and refresh the access contexts).
 */
export const revokeDepartmentAccessEffects = async (
  tx: QuerySql,
  context: AccessContext,
  userId: string,
  department: Department
): Promise<DepartmentRevokedTask[]> => {
  const organizationId = context.organization.id;
  const superadmin = await tx<{ ok: number }[]>`
    SELECT 1 AS ok
    FROM public.organization_memberships om
    JOIN public.roles r ON r.id = om.role_id AND r.organization_id = om.organization_id AND r.key = 'superadmin'
    WHERE om.organization_id = ${organizationId} AND om.user_id = ${userId} AND om.deleted_at IS NULL
    LIMIT 1
  `;
  if (superadmin.length > 0) {
    return [];
  }

  // Public projects of the department the user only saw through it (no explicit, active project membership).
  const lostProjects = () => tx`
    SELECT p.id FROM public.projects p
    WHERE p.organization_id = ${organizationId}
      AND p.department = ${department}
      AND p.visibility = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM public.project_memberships pm
        WHERE pm.organization_id = p.organization_id AND pm.project_id = p.id
          AND pm.user_id = ${userId} AND pm.status = 'active' AND pm.deleted_at IS NULL
      )
  `;

  const unassigned = await tx<{ task_id: string; project_id: string; list_id: string; parent_task_id: string | null }[]>`
    UPDATE public.task_assignees ta
    SET removed_at = now(), removed_by = ${context.user.id}
    FROM public.tasks t
    WHERE t.id = ta.task_id AND t.organization_id = ta.organization_id
      AND ta.organization_id = ${organizationId}
      AND ta.assignee_user_id = ${userId}
      AND ta.removed_at IS NULL
      AND t.project_id IN (${lostProjects()})
    RETURNING ta.task_id, t.project_id, t.list_id, t.parent_task_id
  `;
  await insertActivities(
    tx,
    context,
    unassigned.map((row) => ({
      taskId: row.task_id,
      action: "TASK_ASSIGNEE_REMOVED",
      targetType: "user",
      targetId: userId,
      // The timeline names the user from targetId; the reason tells why nobody unassigned them by hand.
      previousValue: { reason: "department_removed" }
    }))
  );

  await tx`
    DELETE FROM public.notifications n
    WHERE n.organization_id = ${organizationId}
      AND n.recipient_user_id = ${userId}
      AND n.project_id IN (${lostProjects()})
  `;

  const tasks = new Map(
    unassigned.map((row) => [
      row.task_id,
      { id: row.task_id, projectId: row.project_id, listId: row.list_id, parentTaskId: row.parent_task_id }
    ])
  );
  return [...tasks.values()];
};

/**
 * After the commit of a department loss (never throws): live hints for the tasks `revokeDepartmentAccessEffects`
 * unassigned, and the user's sockets leave the rooms of that department's public projects they can no longer see
 * (`access:revoked`; task rooms re-check access on the next join).
 */
export const publishDepartmentAccessRevoked = async (
  context: AccessContext,
  userId: string,
  department: Department,
  tasks: DepartmentRevokedTask[]
) => {
  const at = new Date().toISOString();
  for (const task of tasks.slice(0, 500)) {
    publishToRoom({ type: "project", id: task.projectId }, "task:changed", {
      projectId: task.projectId,
      listId: task.listId,
      taskId: task.id,
      parentTaskId: task.parentTaskId,
      kind: "updated",
      actorId: context.user.id,
      at
    });
  }
  try {
    const sql = getSql();
    const projects = await sql<{ id: string }[]>`
      SELECT p.id FROM public.projects p
      WHERE p.organization_id = ${context.organization.id}
        AND p.department = ${department}
        AND p.visibility = 'public'
        AND p.deleted_at IS NULL
        AND NOT public.is_department_member(p.organization_id, ${userId}::uuid, p.department)
        AND NOT EXISTS (
          SELECT 1 FROM public.project_memberships pm
          WHERE pm.organization_id = p.organization_id AND pm.project_id = p.id
            AND pm.user_id = ${userId} AND pm.status = 'active' AND pm.deleted_at IS NULL
        )
      LIMIT 2000
    `;
    for (const project of projects) {
      evictUsersFromRoom([userId], { type: "project", id: project.id });
    }
  } catch (error) {
    logger.warn({ err: error, userId, department }, "Department access revocation hints failed");
  }
};
