import { Permission } from "../../contracts/permissions.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import type { QuerySql } from "../../lib/db-types.js";
import { logger } from "../../lib/logger.js";
import type { AccessContext } from "../access/access-context.js";
import { createChannel, setSystemChannelMembers, updateChannelMember } from "../chat/channels.service.js";
import { assertProductionMember, hasProductionRole, isProductionAdmin, leadsJob } from "./access.js";
import { assertJobVisible, jobArchivedError, loadMemberRoles } from "./jobs.repo.js";
import { publishProductionChange } from "./realtime.js";

/**
 * "Tạo nhóm cho job này" (SPEC §6 Phase 4 §2): one private chat channel per job.
 *
 * Membership (SPEC: "tự thêm leader, account, mọi assignee/qc của job"; SEC-API-05, BUG-PR-13, PD-022): the people
 * related to the job belong to the chat, as long as they are active organization members:
 *   - its leader, while they still lead (hold LEADER or ADMIN, or are superadmin — SEC2-04);
 *   - its creator, while they may still see every job (Account / Leader / Admin, superadmin);
 *   - every holder of the production ACCOUNT role;
 *   - every worker and QC of its tasks.
 * Assignment changes reconcile it: newly related people are added, members without a relation are removed unless
 * they may see every job anyway (Account / Leader / Admin, superadmins), so someone taken off a job stops reading
 * its chat. Losing LEADER / ACCOUNT / ADMIN reconciles every job chat of that person (`syncJobChatsForMember`),
 * so a demoted leader leaves the chats they were only in as leader. Gaining ACCOUNT does not touch existing chats
 * at once: the new Account joins each one at its next reconcile (assignment change or someone opening it). Anyone
 * who may see the job and opens "Nhóm chat" is added (an Admin who was not a member gets in instead of a channel
 * they cannot open), and opening it also brings in people involved since.
 *
 * The production module owns this membership policy and applies it through the chat module's own service
 * functions (system messages, events, realtime and eviction stay the chat module's), acting as the caller
 * with channel-management rights on this one channel (see `membershipContext`).
 */

type JobChatRow = {
  code: string;
  leader_id: string;
  created_by: string;
  channel_id: string | null;
  channel_alive: boolean;
  archived: boolean;
  related: string[];
};

const loadJobChat = async (sql: QuerySql, organizationId: string, jobId: string) =>
  (
    await sql<JobChatRow[]>`
      SELECT j.code, j.leader_id, j.created_by, j.channel_id, j.archived_at IS NOT NULL AS archived,
        EXISTS (
          SELECT 1 FROM public.channels c WHERE c.id = j.channel_id AND c.deleted_at IS NULL AND c.archived_at IS NULL
        ) AS channel_alive,
        -- Related people who are still active organization members (people may have left since); see above.
        coalesce((
          SELECT array_agg(DISTINCT om.user_id)
          FROM public.organization_memberships om
          LEFT JOIN public.roles r ON r.id = om.role_id AND r.organization_id = om.organization_id
          WHERE om.organization_id = j.organization_id AND om.status = 'active' AND om.deleted_at IS NULL
            AND (
              (om.user_id = j.leader_id AND (r.key = 'superadmin' OR EXISTS (
                SELECT 1 FROM production.user_roles ur
                WHERE ur.organization_id = om.organization_id AND ur.user_id = om.user_id AND ur.role_code IN ('LEADER', 'ADMIN')
              )))
              OR (om.user_id = j.created_by AND (r.key = 'superadmin' OR EXISTS (
                SELECT 1 FROM production.user_roles ur
                WHERE ur.organization_id = om.organization_id AND ur.user_id = om.user_id AND ur.role_code IN ('ADMIN', 'ACCOUNT', 'LEADER')
              )))
              OR EXISTS (
                SELECT 1 FROM production.user_roles ur
                WHERE ur.organization_id = om.organization_id AND ur.user_id = om.user_id AND ur.role_code = 'ACCOUNT'
              )
              OR EXISTS (
                SELECT 1 FROM production.tasks t
                WHERE t.organization_id = j.organization_id AND t.job_id = j.id AND (t.assignee_id = om.user_id OR t.qc_id = om.user_id)
              )
            )
        ), '{}') AS related
      FROM production.jobs j WHERE j.organization_id = ${organizationId} AND j.id = ${jobId}
    `
  )[0];

/**
 * The caller, with the rights to manage the members of the job's channel (and create it): the job-chat
 * policy above is the production module's, whatever the caller's own chat permissions are. Used only for the
 * membership calls below.
 */
const membershipContext = (context: AccessContext): AccessContext => ({
  ...context,
  hasFullOrganizationAuthority: true,
  role: {
    ...context.role,
    permissions: [
      ...new Set([...context.role.permissions, Permission.ChannelView, Permission.ChannelCreate, Permission.ChannelManageMembers])
    ] as AccessContext["role"]["permissions"]
  }
});

const viewsAllJobs = (roles: ReadonlySet<string> | undefined) => Boolean(roles && (roles.has("ADMIN") || roles.has("ACCOUNT") || roles.has("LEADER")));

/**
 * Brings the job chat's members in line with the job (see above). `include` adds people who opened the chat
 * and may see the job. No-op when the job has no live channel or is archived.
 */
const reconcile = async (context: AccessContext, job: JobChatRow, include: string[]) => {
  const organizationId = context.organization.id;
  const sql = getSql();
  const channelId = job.channel_id!;
  const entitled = new Set([...job.related, ...include]);
  const members = await sql<{ user_id: string; role: "admin" | "member" }[]>`
    SELECT user_id, role FROM public.channel_members
    WHERE organization_id = ${organizationId} AND channel_id = ${channelId} AND deleted_at IS NULL
  `;
  const present = new Set(members.map((row) => row.user_id));
  const toAdd = [...entitled].filter((id) => !present.has(id));
  const unrelated = members.filter((row) => !entitled.has(row.user_id));
  const roles = await loadMemberRoles(sql, organizationId, unrelated.map((row) => row.user_id));
  const toRemove = unrelated.filter((row) => !viewsAllJobs(roles.get(row.user_id)) && row.user_id !== context.user.id);
  if (toAdd.length === 0 && toRemove.length === 0) {
    return;
  }
  if (toRemove.length > 0) {
    // The chat keeps an admin while it has members: hand it to someone who stays (the job leader first).
    const removing = new Set(toRemove.map((row) => row.user_id));
    const staying = members.filter((row) => !removing.has(row.user_id));
    if (staying.length > 0 && !staying.some((row) => row.role === "admin")) {
      const heir = staying.find((row) => row.user_id === job.leader_id) ?? staying[0]!;
      await updateChannelMember(membershipContext(context), channelId, heir.user_id, { role: "admin" });
    }
  }
  // System-level membership change: the production module's policy decides, not the caller's chat rights.
  await setSystemChannelMembers({
    organizationId,
    channelId,
    add: toAdd,
    remove: toRemove.map((row) => row.user_id),
    actorId: context.user.id,
    access: "submit"
  });
};

/**
 * After assignment changes (tasks created or re-assigned, job leader changed): reconcile the job chat.
 * Never fails the change that triggered it — problems are logged.
 */
export const syncJobChat = async (context: AccessContext, jobId: string) => {
  try {
    const job = await loadJobChat(getSql(), context.organization.id, jobId);
    if (job?.channel_id && job.channel_alive && !job.archived) {
      await reconcile(context, job, []);
    }
  } catch (error) {
    logger.warn({ err: error, jobId }, "Job chat membership sync failed");
  }
};

/**
 * After someone lost LEADER, ACCOUNT or ADMIN (PD-022, SEC2-04 follow-up): reconciles every live job chat they are
 * a member of or whose job they still lead, so they leave the chats they were only in through that role. Returns
 * how many chats were checked. Never throws (problems are logged per job by `syncJobChat`).
 */
export const syncJobChatsForMember = async (context: AccessContext, userId: string) => {
  const organizationId = context.organization.id;
  let jobs: { id: string }[] = [];
  try {
    jobs = await getSql()<{ id: string }[]>`
      SELECT j.id FROM production.jobs j
      JOIN public.channels c ON c.id = j.channel_id AND c.organization_id = j.organization_id AND c.deleted_at IS NULL AND c.archived_at IS NULL
      WHERE j.organization_id = ${organizationId} AND j.archived_at IS NULL
        AND (j.leader_id = ${userId} OR EXISTS (
          SELECT 1 FROM public.channel_members cm
          WHERE cm.organization_id = j.organization_id AND cm.channel_id = j.channel_id AND cm.user_id = ${userId} AND cm.deleted_at IS NULL
        ))
      ORDER BY j.id
      LIMIT 2000
    `;
  } catch (error) {
    logger.warn({ err: error, userId }, "Listing job chats of a member failed");
    return 0;
  }
  for (const job of jobs) {
    await syncJobChat(context, job.id);
  }
  return jobs.length;
};

/** POST /production/jobs/:jobId/chat — opens (creating if needed) the job chat for anyone who may see the job. */
export const openJobChat = async (context: AccessContext, jobId: string): Promise<{ channelId: string; created: boolean }> => {
  assertProductionMember(context);
  const organizationId = context.organization.id;
  const sql = getSql();
  await assertJobVisible(sql, context, jobId);
  const job = await loadJobChat(sql, organizationId, jobId);
  if (!job) {
    throw new AppError("JOB_NOT_FOUND", "Không tìm thấy job.", 404);
  }
  if (job.archived) {
    throw jobArchivedError();
  }

  if (job.channel_id && job.channel_alive) {
    await reconcile(context, job, [context.user.id]);
    return { channelId: job.channel_id, created: false };
  }

  if (!leadsJob(context, job.leader_id) && !isProductionAdmin(context) && !hasProductionRole(context, "ACCOUNT")) {
    throw new AppError("FORBIDDEN", "Chỉ Leader của job, Account hoặc Quản trị được tạo nhóm chat cho job.", 403);
  }
  const members = [...new Set([...job.related, context.user.id])];
  // Channel names are unique per organization: suffix on collision.
  const base = `job ${job.code}`.slice(0, 72);
  let channel: { id: string } | null = null;
  for (let attempt = 0; attempt < 5 && !channel; attempt += 1) {
    try {
      channel = await createChannel(membershipContext(context), {
        kind: "private",
        name: attempt === 0 ? base : `${base} (${attempt + 1})`,
        description: `Nhóm chat của job ${job.code}`.slice(0, 1000),
        memberIds: members.filter((id) => id !== context.user.id)
      });
    } catch (error) {
      if (!(error instanceof AppError) || error.statusCode !== 409) {
        throw error;
      }
    }
  }
  if (!channel) {
    throw new AppError("CHANNEL_NAME_TAKEN", "Không tạo được tên nhóm chat cho job này.", 409);
  }
  await sql`
    UPDATE production.jobs SET channel_id = ${channel.id}, updated_at = now()
    WHERE organization_id = ${organizationId} AND id = ${jobId}
  `;
  publishProductionChange(organizationId, jobId, [], "job", context.user.id);
  return { channelId: channel.id, created: true };
};
