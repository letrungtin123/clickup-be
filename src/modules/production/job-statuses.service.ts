import type {
  CreateJobStatusRequest,
  DeleteJobStatusResult,
  JobStatusCollection,
  JobStatusKind,
  UpdateJobStatusRequest
} from "../../contracts/production-catalog.js";
import { jobStatusLimit } from "../../contracts/production-catalog.js";
import type { JobStatusRef } from "../../contracts/production-jobs.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { toIso, type QuerySql } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { toColor, toUserRef, type UserRefJson } from "../work/mappers.js";
import { userJsonSql } from "../work/tasks.repo.js";
import { assertConfigEditor, assertProductionMember, isProductionAdmin } from "./access.js";

/**
 * Manual job status catalog (PD-038, "Cấu hình → Trạng thái job"): the ClickUp-style status people set on a job,
 * separate from the 9-step line workflow (PD-014, untouched). Reads for every production member (chips, filters,
 * pickers); writes for ADMIN, each row keeping who changed it last and when (like production.settings). Names are unique
 * per organization, case-insensitive (production_job_statuses_name_uidx → 409 JOB_STATUS_NAME_TAKEN). The last status
 * cannot be deleted; deleting a status that jobs use moves all of them to a replacement in one statement, with a JOB
 * history row per job. Migration 20261013_0200 seeds the six defaults (production.ensure_job_statuses).
 *
 * PD-045 `requires_all_checked` ("Đã xong" by default): a status a job can take only when every live line of it is
 * "Đã check" (a Checking line: Done) — enforced by changeJobStatus / createJob (409 JOB_NOT_READY). Job statuses are
 * read straight from the table (no catalog cache), so a change applies to the next request.
 */

const org = (context: AccessContext) => context.organization.id;

type JobStatusRow = {
  id: string;
  name: string;
  color: string;
  position: number;
  is_closed: boolean;
  requires_all_checked: boolean;
  kind: JobStatusKind;
  job_count: number | null;
  updated_at: Date;
  updated_by: UserRefJson | null;
};

const statusNotFound = () => new AppError("JOB_STATUS_NOT_FOUND", "Không tìm thấy trạng thái job.", 404);

/** One status of the organization as a job ref; 400 when it is not one of them (a request named it). */
export const loadJobStatus = async (sql: QuerySql, organizationId: string, id: string): Promise<JobStatusRef> => {
  const row = (
    await sql<{ id: string; name: string; color: string; is_closed: boolean; requires_all_checked: boolean }[]>`
      SELECT id, name, color, is_closed, requires_all_checked FROM production.job_statuses WHERE organization_id = ${organizationId} AND id = ${id}
    `
  )[0];
  if (!row) {
    throw new AppError("JOB_STATUS_NOT_FOUND", "Trạng thái job không tồn tại.", 400);
  }
  return { id: row.id, name: row.name, color: toColor(row.color), isClosed: row.is_closed, requiresAllChecked: row.requires_all_checked };
};

/** A status in a job history row (task_logs action JOB): kept by value, so a later rename or delete keeps the story. */
export const jobStatusLogValue = (status: Pick<JobStatusRef, "id" | "name" | "color">) => ({
  jobStatusId: status.id,
  jobStatusName: status.name,
  jobStatusColor: status.color
});

const selectStatuses = (sql: QuerySql, organizationId: string, withCounts: boolean) => sql<JobStatusRow[]>`
  SELECT s.id, s.name, s.color, s.position, s.is_closed, s.requires_all_checked, s.kind, s.updated_at,
    ${
      withCounts
        ? sql`(SELECT count(*)::int FROM production.jobs j
            WHERE j.organization_id = s.organization_id AND j.job_status_id = s.id AND j.deleted_at IS NULL)`
        : sql`NULL::int`
    } AS job_count,
    (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = s.updated_by) AS updated_by
  FROM production.job_statuses s
  WHERE s.organization_id = ${organizationId}
  ORDER BY s.position, s.created_at, s.id
`;

/** GET /production/job-statuses — in position order; job counts for ADMIN only (the settings page). */
export const listJobStatuses = async (context: AccessContext): Promise<JobStatusCollection> => {
  assertProductionMember(context);
  const sql = getSql();
  const admin = isProductionAdmin(context);
  let rows = await selectStatuses(sql, org(context), admin);
  if (rows.length === 0) {
    // An organization created after migration 20261013_0200: its defaults (no-op once it has any).
    await sql`SELECT production.ensure_job_statuses(${org(context)}::uuid)`;
    rows = await selectStatuses(sql, org(context), admin);
  }
  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      color: toColor(row.color),
      position: row.position,
      isClosed: row.is_closed,
      requiresAllChecked: row.requires_all_checked,
      kind: row.kind,
      jobCount: row.job_count,
      updatedAt: toIso(row.updated_at),
      updatedBy: toUserRef(row.updated_by)
    }))
  };
};

/** POST /production/job-statuses (superadmin, PD-050): appended after the last one. */
export const createJobStatus = async (context: AccessContext, input: Omit<CreateJobStatusRequest, "kind"> & { kind?: JobStatusKind | undefined }) => {
  assertConfigEditor(context);
  const sql = getSql();
  await sql.begin(async (tx) => {
    const count = (
      await tx<{ count: number }[]>`SELECT count(*)::int AS count FROM production.job_statuses WHERE organization_id = ${org(context)}`
    )[0]!.count;
    if (count >= jobStatusLimit) {
      throw new AppError("JOB_STATUS_LIMIT", `Tối đa ${jobStatusLimit} trạng thái job.`, 409);
    }
    await tx`
      INSERT INTO production.job_statuses (organization_id, name, color, position, is_closed, requires_all_checked, kind, created_by, updated_by)
      SELECT ${org(context)}, ${input.name}, ${input.color}, coalesce(max(position), 0) + 1, ${input.isClosed}, ${input.requiresAllChecked}, ${input.kind ?? "IN_PROGRESS"},
        ${context.user.id}, ${context.user.id}
      FROM production.job_statuses WHERE organization_id = ${org(context)}
    `;
  });
  return await listJobStatuses(context);
};

/**
 * PATCH /production/job-statuses/:id (superadmin, PD-050): rename, colour, "đóng", "cần check hết task" (requiresAllChecked, PD-045 —
 * turning it on moves no job: jobs already in the status keep it), its kind (PD-080, the Overview's meaning). Jobs keep the
 * status (they hold its id).
 */
export const updateJobStatus = async (context: AccessContext, id: string, input: UpdateJobStatusRequest) => {
  assertConfigEditor(context);
  const sql = getSql();
  const name = input.name ?? null;
  const color = input.color ?? null;
  const closed = input.isClosed ?? null;
  const allChecked = input.requiresAllChecked ?? null;
  const kind = input.kind ?? null;
  const rows = await sql<{ id: string }[]>`
    UPDATE production.job_statuses
    SET name = coalesce(${name}, name), color = coalesce(${color}, color), is_closed = coalesce(${closed}::boolean, is_closed),
      requires_all_checked = coalesce(${allChecked}::boolean, requires_all_checked), kind = coalesce(${kind}, kind), updated_by = ${context.user.id}
    WHERE organization_id = ${org(context)} AND id = ${id}
      AND (name, color, is_closed, requires_all_checked, kind) IS DISTINCT FROM
        (coalesce(${name}, name), coalesce(${color}, color), coalesce(${closed}::boolean, is_closed), coalesce(${allChecked}::boolean, requires_all_checked),
          coalesce(${kind}, kind))
    RETURNING id
  `;
  if (rows.length === 0) {
    // Nothing changed, or no such status.
    const found = await sql`SELECT 1 FROM production.job_statuses WHERE organization_id = ${org(context)} AND id = ${id}`;
    if (found.length === 0) {
      throw statusNotFound();
    }
  }
  return await listJobStatuses(context);
};

/** PUT /production/job-statuses/order (superadmin, PD-050): position = place in `ids`; ids of other organizations are ignored. */
export const reorderJobStatuses = async (context: AccessContext, ids: string[]) => {
  assertConfigEditor(context);
  const sql = getSql();
  await sql`
    UPDATE production.job_statuses AS s SET position = data.position, updated_by = ${context.user.id}
    FROM unnest(${ids}::uuid[]) WITH ORDINALITY AS data(id, position)
    WHERE s.organization_id = ${org(context)} AND s.id = data.id AND s.position IS DISTINCT FROM data.position::int
  `;
  return await listJobStatuses(context);
};

/**
 * DELETE /production/job-statuses/:id?replacementId= (superadmin, PD-050). The last status stays (409 JOB_STATUS_LAST). While jobs
 * use it (deleted jobs included: they keep a status) a replacement is required (409 JOB_STATUS_IN_USE); every live job
 * gets a JOB history row (from → replacement, statusDeleted), then all of them move in one statement and the status goes.
 */
export const deleteJobStatus = async (context: AccessContext, id: string, replacementId: string | undefined): Promise<DeleteJobStatusResult> => {
  assertConfigEditor(context);
  const sql = getSql();
  const organizationId = org(context);
  const movedJobs = await sql.begin(async (tx) => {
    // Locks the catalog: concurrent deletes cannot remove the last two statuses at once.
    const statuses = await tx<{ id: string; name: string; color: string; is_closed: boolean }[]>`
      SELECT id, name, color, is_closed FROM production.job_statuses WHERE organization_id = ${organizationId}
      ORDER BY position, id FOR UPDATE
    `;
    const status = statuses.find((row) => row.id === id);
    if (!status) {
      throw statusNotFound();
    }
    if (statuses.length <= 1) {
      throw new AppError("JOB_STATUS_LAST", "Phải còn ít nhất một trạng thái job.", 409);
    }
    const usage = (
      await tx<{ total: number; live: number }[]>`
        SELECT count(*)::int AS total, count(*) FILTER (WHERE deleted_at IS NULL)::int AS live
        FROM production.jobs WHERE organization_id = ${organizationId} AND job_status_id = ${id}
      `
    )[0] ?? { total: 0, live: 0 };
    if (usage.total > 0) {
      const replacement = statuses.find((row) => row.id === replacementId && row.id !== id);
      if (!replacementId) {
        throw new AppError(
          "JOB_STATUS_IN_USE",
          `${usage.live} job đang ở trạng thái "${status.name}" — chọn trạng thái thay thế để chuyển các job này sang.`,
          409
        );
      }
      if (!replacement) {
        throw new AppError("JOB_STATUS_REPLACEMENT_INVALID", "Trạng thái thay thế không hợp lệ.", 400);
      }
      const from = jobStatusLogValue({ id: status.id, name: status.name, color: toColor(status.color) });
      const to = { ...jobStatusLogValue({ id: replacement.id, name: replacement.name, color: toColor(replacement.color) }), statusDeleted: true };
      await tx`
        INSERT INTO production.task_logs (organization_id, task_id, job_id, user_id, action, from_value, to_value)
        SELECT j.organization_id, NULL, j.id, ${context.user.id}, 'JOB', ${tx.json(from)}, ${tx.json(to)}
        FROM production.jobs j
        WHERE j.organization_id = ${organizationId} AND j.job_status_id = ${id} AND j.deleted_at IS NULL
      `;
      await tx`
        UPDATE production.jobs SET job_status_id = ${replacement.id}, updated_at = now()
        WHERE organization_id = ${organizationId} AND job_status_id = ${id}
      `;
    }
    await tx`DELETE FROM production.job_statuses WHERE organization_id = ${organizationId} AND id = ${id}`;
    return usage.live;
  });
  return { ...(await listJobStatuses(context)), movedJobs };
};
