import {
  newProjectOwnerPick,
  projectCapabilitiesFor,
  requestedProjectOwners,
  type ProductionProject,
  type ProjectViewer,
  type UpdateProductionProjectRequest,
  type UpsertProductionProjectRequest
} from "../../contracts/production-catalog.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { toIso, type QuerySql } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { visibleUserIdSql } from "../access/test-accounts.js";
import { toUserRef, type UserRefJson } from "../work/mappers.js";
import { userJsonSql } from "../work/tasks.repo.js";
import { assertProductionMember, productionRolesOf } from "./access.js";

/**
 * PD-078 / PD-079 — Photo Retouch projects (production.projects; hierarchy Project > Job Code > Task > Subtask): every
 * project has one or more owners ("Người phụ trách", production.project_owners in order: members holding LEADER or ADMIN)
 * and records who created it. `projects.leader_id` is kept in sync as the FIRST owner (code still reading it sees a valid
 * owner). The rules are the shared pure ones of contracts/production-catalog.ts (`projectCapabilitiesFor`,
 * `newProjectOwnerPick`), enforced here:
 * - read (GET /production/projects): every production member — the pickers need them; projects created by a temporary QA
 *   test account are hidden from real viewers (PD-063);
 * - create: LEADER, ADMIN or ACCOUNT — the superadmin names ≥ 1 owners, an Admin or an Account exactly one, a Leader owns
 *   what they create;
 * - edit: an owner (while holding LEADER / ADMIN), any Admin, or the Account who created it; owners: the superadmin any
 *   list, an Admin the single owner of a project with at most one; nobody else;
 * - delete: whoever may edit, never once the project has a job row (live, archived or in the trash) or a score entry —
 *   409 PROJECT_HAS_JOBS; its prices ("Bảng đơn giá" rows, never used without jobs) and owners go with it.
 * Not in the production config cache (catalog-cache.ts): nothing to invalidate.
 */

const org = (context: AccessContext) => context.organization.id;
const forbidden = (message: string) => new AppError("FORBIDDEN", message, 403);
const projectNotFound = () => new AppError("PROJECT_NOT_FOUND", "Không tìm thấy Project.", 404);
const ownerRequired = (message: string) => new AppError("PROJECT_OWNER_REQUIRED", message, 400);
const severalOwnersForbidden = (message: string) => new AppError("PROJECT_OWNERS_SUPERADMIN_ONLY", message, 403);
export const projectHasJobsMessage = "Project đã có job — không xoá được (chỉ có thể ngừng hoạt động).";

const viewerOf = (context: AccessContext): ProjectViewer => ({
  roles: productionRolesOf(context),
  me: context.user.id,
  superadmin: context.hasFullOrganizationAuthority
});

type ProjectRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  client_id: string | null;
  client_name: string | null;
  qc_buffer_hours: number;
  active: boolean;
  created_by: string | null;
  owners: UserRefJson[] | null;
  creator: UserRefJson | null;
  created_at: Date | string;
  job_count: number;
  has_jobs: boolean;
};

/**
 * Every project of the organization with its owners (in order), creator and job counts — active ones first, then by code.
 * `jobCount`: its jobs not deleted (archived ones count) the viewer may see (PD-063); `hasJobs`: any job row at all.
 */
export const selectProductionProjects = (sql: QuerySql, context: AccessContext) => sql<ProjectRow[]>`
  SELECT p.id, p.code, p.name, p.description, p.client_id, c.name AS client_name, p.qc_buffer_hours, p.active,
    p.created_by, p.created_at,
    (
      SELECT json_agg(${userJsonSql(sql, "oa")} ORDER BY po.position, po.added_at, oa.display_name)
      FROM production.project_owners po
      JOIN public.app_users oa ON oa.id = po.user_id
      WHERE po.organization_id = p.organization_id AND po.project_id = p.id
    ) AS owners,
    CASE WHEN cb.id IS NULL THEN NULL ELSE ${userJsonSql(sql, "cb")} END AS creator,
    coalesce(jc.job_count, 0)::int AS job_count,
    (jc.project_id IS NOT NULL) AS has_jobs
  FROM production.projects p
  LEFT JOIN production.clients c ON c.id = p.client_id AND c.organization_id = p.organization_id
  LEFT JOIN public.app_users cb ON cb.id = p.created_by
  LEFT JOIN (
    SELECT j.project_id,
      count(*) FILTER (WHERE j.deleted_at IS NULL AND ${visibleUserIdSql(sql, context, sql`j.created_by`)})::int AS job_count
    FROM production.jobs j
    WHERE j.organization_id = ${org(context)}
    GROUP BY j.project_id
  ) jc ON jc.project_id = p.id
  WHERE p.organization_id = ${org(context)} AND ${visibleUserIdSql(sql, context, sql`p.created_by`)}
  ORDER BY p.active DESC, upper(p.code)
  LIMIT 2000
`;

export const toProductionProject = (context: AccessContext, row: ProjectRow): ProductionProject => {
  const owners = (row.owners ?? []).map((owner) => toUserRef(owner)!);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    clientId: row.client_id,
    clientName: row.client_name,
    qcBufferHours: row.qc_buffer_hours,
    active: row.active,
    owners,
    owner: owners[0] ?? null,
    createdBy: toUserRef(row.creator),
    createdAt: toIso(row.created_at),
    jobCount: row.job_count,
    hasJobs: row.has_jobs,
    capabilities: projectCapabilitiesFor(viewerOf(context), {
      ownerIds: owners.map((owner) => owner.id),
      createdById: row.created_by,
      hasJobs: row.has_jobs
    })
  };
};

/** GET /production/projects — every production member (pickers); `canCreate` / `ownerPick` for LEADER / ADMIN / ACCOUNT. */
export const listProjects = async (context: AccessContext) => {
  assertProductionMember(context);
  const rows = await selectProductionProjects(getSql(), context);
  const ownerPick = newProjectOwnerPick(viewerOf(context));
  return { items: rows.map((row) => toProductionProject(context, row)), canCreate: ownerPick !== null, ownerPick };
};

/**
 * Project owners must be active members holding LEADER or ADMIN (the organization superadmin counts as ADMIN, like
 * jobs.repo loadMemberRoles) — else 400 PROJECT_OWNER_INVALID.
 */
const assertOwnerCandidates = async (sql: QuerySql, organizationId: string, userIds: readonly string[]) => {
  if (userIds.length === 0) {
    return;
  }
  const rows = await sql<{ user_id: string }[]>`
    SELECT om.user_id
    FROM public.organization_memberships om
    JOIN public.app_users au ON au.id = om.user_id AND au.deleted_at IS NULL
    WHERE om.organization_id = ${organizationId} AND om.user_id = ANY(${[...userIds]}::uuid[])
      AND om.deleted_at IS NULL AND om.status = 'active'
      AND (
        EXISTS (
          SELECT 1 FROM production.user_roles ur
          WHERE ur.organization_id = om.organization_id AND ur.user_id = om.user_id AND ur.role_code IN ('LEADER', 'ADMIN')
        )
        OR EXISTS (SELECT 1 FROM public.roles r WHERE r.id = om.role_id AND r.key = 'superadmin')
      )
  `;
  const valid = new Set(rows.map((row) => row.user_id));
  if (userIds.some((id) => !valid.has(id))) {
    throw new AppError("PROJECT_OWNER_INVALID", "Người phụ trách phải là Leader hoặc Quản trị Photo Retouch.", 400);
  }
};

const assertClient = async (sql: QuerySql, organizationId: string, clientId: string | null | undefined) => {
  if (!clientId) {
    return;
  }
  const rows = await sql`SELECT 1 FROM production.clients WHERE organization_id = ${organizationId} AND id = ${clientId}`;
  if (rows.length === 0) {
    throw new AppError("CLIENT_NOT_FOUND", "Không tìm thấy client.", 404);
  }
};

/**
 * The owners of a new project (pure, unit tested; callers check `mayCreateProject` first): the superadmin names ≥ 1, an
 * Admin or an Account exactly one (none → 400 PROJECT_OWNER_REQUIRED, several → 403 PROJECT_OWNERS_SUPERADMIN_ONLY); a
 * Leader (without ADMIN / ACCOUNT) owns what they create — anyone else → 403 PROJECT_OWNER_LOCKED.
 */
export const newProjectOwners = (context: AccessContext, input: UpsertProductionProjectRequest): string[] => {
  const pick = newProjectOwnerPick(viewerOf(context));
  const requested = requestedProjectOwners(input) ?? [];
  if (pick === "self") {
    if (requested.some((id) => id !== context.user.id)) {
      throw new AppError("PROJECT_OWNER_LOCKED", "Leader tạo Project thì chính Leader đó là người phụ trách.", 403);
    }
    return [context.user.id];
  }
  if (requested.length === 0) {
    throw ownerRequired("Chọn người phụ trách cho Project.");
  }
  if (pick !== "many" && requested.length > 1) {
    throw severalOwnersForbidden("Chỉ Siêu quản trị đặt được nhiều người phụ trách cho một Project.");
  }
  return requested;
};

/**
 * Whether a PATCH of a project without owner must name one (pure, unit tested): an older project gets its owner at its
 * first edit — anything but switching it active / inactive alone (so an Admin can still retire old projects at once).
 */
export const projectOwnerNeeded = (input: UpdateProductionProjectRequest, currentOwnerCount: number) =>
  currentOwnerCount === 0 &&
  !(requestedProjectOwners(input)?.length) &&
  Object.entries(input).some(([key, value]) => key !== "active" && key !== "ownerId" && key !== "ownerIds" && value !== undefined);

/** Stores the owners of a project in order (rows of the others removed) and mirrors the first into projects.leader_id. */
const writeOwners = async (tx: QuerySql, context: AccessContext, projectId: string, ownerIds: readonly string[]) => {
  const organizationId = org(context);
  await tx`
    DELETE FROM production.project_owners
    WHERE organization_id = ${organizationId} AND project_id = ${projectId} AND NOT (user_id = ANY(${[...ownerIds]}::uuid[]))
  `;
  await tx`
    INSERT INTO production.project_owners (organization_id, project_id, user_id, position, added_by)
    SELECT ${organizationId}, ${projectId}, x.user_id, (x.ord - 1)::int, ${context.user.id}
    FROM unnest(${[...ownerIds]}::uuid[]) WITH ORDINALITY AS x(user_id, ord)
    ON CONFLICT (project_id, user_id) DO UPDATE SET position = EXCLUDED.position
  `;
  await tx`UPDATE production.projects SET leader_id = ${ownerIds[0] ?? null} WHERE organization_id = ${organizationId} AND id = ${projectId}`;
};

/** POST /production/projects (PD-078, PD-079). */
export const createProject = async (context: AccessContext, input: UpsertProductionProjectRequest) => {
  assertProductionMember(context);
  if (newProjectOwnerPick(viewerOf(context)) === null) {
    throw forbidden("Chỉ Leader, Quản trị hoặc Account mới tạo được Project.");
  }
  const ownerIds = newProjectOwners(context, input);
  const organizationId = org(context);
  await getSql().begin(async (tx) => {
    await assertClient(tx, organizationId, input.clientId);
    await assertOwnerCandidates(tx, organizationId, ownerIds);
    const created = (
      await tx<{ id: string }[]>`
        INSERT INTO production.projects (organization_id, code, name, description, client_id, qc_buffer_hours, active, leader_id, created_by)
        VALUES (${organizationId}, ${input.code}, ${input.name}, ${input.description?.trim() || null}, ${input.clientId ?? null},
          ${input.qcBufferHours ?? 0}, ${input.active ?? true}, ${ownerIds[0]!}, ${context.user.id})
        RETURNING id
      `
    )[0]!;
    await writeOwners(tx, context, created.id, ownerIds);
  });
  return await listProjects(context);
};

/** The project row (locked for the transaction) with its owners in order, or 404. */
const lockProject = async (tx: QuerySql, organizationId: string, projectId: string) => {
  const row = (
    await tx<{ created_by: string | null }[]>`
      SELECT created_by FROM production.projects WHERE organization_id = ${organizationId} AND id = ${projectId} FOR UPDATE
    `
  )[0];
  if (!row) {
    throw projectNotFound();
  }
  const owners = await tx<{ user_id: string }[]>`
    SELECT user_id FROM production.project_owners
    WHERE organization_id = ${organizationId} AND project_id = ${projectId}
    ORDER BY position, added_at
  `;
  return { createdById: row.created_by, ownerIds: owners.map((owner) => owner.user_id) };
};

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, index) => id === b[index]);

/** PATCH /production/projects/:projectId (partial, PD-078, PD-079). */
export const updateProject = async (context: AccessContext, projectId: string, input: UpdateProductionProjectRequest) => {
  assertProductionMember(context);
  const organizationId = org(context);
  await getSql().begin(async (tx) => {
    const current = await lockProject(tx, organizationId, projectId);
    const capabilities = projectCapabilitiesFor(viewerOf(context), { ...current, hasJobs: true });
    if (!capabilities.canEdit) {
      throw forbidden(
        current.ownerIds.length > 0
          ? "Bạn chỉ sửa được Project do mình phụ trách hoặc mình tạo."
          : "Project chưa có người phụ trách — chỉ Quản trị sửa được."
      );
    }
    const requested = requestedProjectOwners(input);
    if (requested !== undefined && requested.length === 0) {
      throw ownerRequired("Project phải có người phụ trách — chỉ đổi sang người khác.");
    }
    const ownersChange = requested !== undefined && !sameList(requested, current.ownerIds);
    if (ownersChange) {
      if (capabilities.ownerEdit === "none") {
        throw current.ownerIds.length > 1 && productionRolesOf(context).has("ADMIN")
          ? severalOwnersForbidden("Project có nhiều người phụ trách — chỉ Siêu quản trị đổi được danh sách này.")
          : forbidden("Chỉ Quản trị mới đổi được người phụ trách Project.");
      }
      if (capabilities.ownerEdit === "one" && requested.length > 1) {
        throw severalOwnersForbidden("Chỉ Siêu quản trị đặt được nhiều người phụ trách cho một Project.");
      }
    }
    if (projectOwnerNeeded(input, current.ownerIds.length)) {
      throw ownerRequired("Project chưa có người phụ trách — chọn người phụ trách để lưu thay đổi.");
    }
    if (ownersChange) {
      // Only the newly added people are checked: an owner who has since lost the role may stay listed.
      await assertOwnerCandidates(
        tx,
        organizationId,
        requested.filter((id) => !current.ownerIds.includes(id))
      );
    }
    await assertClient(tx, organizationId, input.clientId);
    await tx`
      UPDATE production.projects
      SET code = coalesce(${input.code ?? null}, code),
          name = coalesce(${input.name ?? null}, name),
          description = CASE WHEN ${input.description !== undefined} THEN ${input.description?.trim() || null} ELSE description END,
          client_id = CASE WHEN ${input.clientId !== undefined} THEN ${input.clientId ?? null}::uuid ELSE client_id END,
          qc_buffer_hours = coalesce(${input.qcBufferHours ?? null}, qc_buffer_hours),
          active = coalesce(${input.active ?? null}, active)
      WHERE organization_id = ${organizationId} AND id = ${projectId}
    `;
    if (ownersChange) {
      await writeOwners(tx, context, projectId, requested);
    }
  });
  return await listProjects(context);
};

/**
 * DELETE /production/projects/:projectId (PD-078): whoever may edit it (an owner, an Admin, the creating Account) and
 * only while the project never had a job — any job row (live, archived, in the trash) or score entry → 409
 * PROJECT_HAS_JOBS, whoever asks (the Director must keep seeing that data). Answers the remaining list.
 */
export const deleteProject = async (context: AccessContext, projectId: string) => {
  assertProductionMember(context);
  const organizationId = org(context);
  await getSql().begin(async (tx) => {
    const current = await lockProject(tx, organizationId, projectId);
    if (!projectCapabilitiesFor(viewerOf(context), { ...current, hasJobs: false }).canDelete) {
      throw forbidden("Bạn chỉ xoá được Project do mình phụ trách hoặc mình tạo.");
    }
    // The row lock above waits for a job being inserted in the project (its FK check locks the row too), so a job
    // committed just before is seen here; the FK refuses the delete anyway.
    const used = (
      await tx<{ used: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM production.jobs WHERE organization_id = ${organizationId} AND project_id = ${projectId})
          OR EXISTS (SELECT 1 FROM production.score_entries WHERE organization_id = ${organizationId} AND project_id = ${projectId}) AS used
      `
    )[0];
    if (used?.used) {
      throw new AppError("PROJECT_HAS_JOBS", projectHasJobsMessage, 409);
    }
    await tx`DELETE FROM production.credit_rules WHERE organization_id = ${organizationId} AND project_id = ${projectId}`;
    // Its owners go with it (project_owners ON DELETE CASCADE).
    await tx`DELETE FROM production.projects WHERE organization_id = ${organizationId} AND id = ${projectId}`;
  });
  return await listProjects(context);
};
