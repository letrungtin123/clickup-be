import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import type { AccessContext } from "../access/access-context.js";
import { addChannelMembers, createChannel } from "../chat/channels.service.js";
import { assertProductionMember, hasProductionRole, isProductionAdmin } from "./access.js";
import { assertJobVisible } from "./jobs.service.js";
import { publishProductionChange } from "./tasks.service.js";

/**
 * "Tạo nhóm cho job này" (SPEC §6 Phase 4 §2): one private chat channel per job with the leader, the
 * job creator and every worker / QC. Calling it again adds people who joined the job since.
 */
export const openJobChat = async (context: AccessContext, jobId: string): Promise<{ channelId: string; created: boolean }> => {
  assertProductionMember(context);
  const organizationId = context.organization.id;
  const sql = getSql();
  await assertJobVisible(sql, context, jobId);
  const job = (
    await sql<{ code: string; leader_id: string; created_by: string; channel_id: string | null; channel_alive: boolean; people: string[] }[]>`
      SELECT j.code, j.leader_id, j.created_by, j.channel_id,
        EXISTS (SELECT 1 FROM public.channels c WHERE c.id = j.channel_id AND c.deleted_at IS NULL) AS channel_alive,
        coalesce((
          SELECT array_agg(DISTINCT p) FROM production.tasks t, unnest(ARRAY[t.assignee_id, t.qc_id]) AS p
          WHERE t.organization_id = j.organization_id AND t.job_id = j.id AND p IS NOT NULL
        ), '{}') AS people
      FROM production.jobs j WHERE j.organization_id = ${organizationId} AND j.id = ${jobId} AND j.archived_at IS NULL
    `
  )[0];
  if (!job) {
    throw new AppError("JOB_NOT_FOUND", "Không tìm thấy job.", 404);
  }
  if (job.leader_id !== context.user.id && !isProductionAdmin(context) && !hasProductionRole(context, "ACCOUNT")) {
    throw new AppError("FORBIDDEN", "Chỉ Leader của job, Account hoặc Quản trị được tạo nhóm chat cho job.", 403);
  }
  // Active organization members only (people may have left since they worked on the job).
  const members = (
    await sql<{ user_id: string }[]>`
      SELECT om.user_id FROM public.organization_memberships om
      WHERE om.organization_id = ${organizationId} AND om.status = 'active' AND om.deleted_at IS NULL
        AND om.user_id = ANY(${[...new Set([job.leader_id, job.created_by, ...job.people])]}::uuid[])
    `
  ).map((row) => row.user_id);

  if (job.channel_id && job.channel_alive) {
    const existing = await sql<{ user_id: string }[]>`
      SELECT user_id FROM public.channel_members WHERE organization_id = ${organizationId} AND channel_id = ${job.channel_id} AND deleted_at IS NULL
    `;
    const present = new Set(existing.map((row) => row.user_id));
    const missing = members.filter((id) => !present.has(id));
    if (missing.length > 0 && present.has(context.user.id)) {
      await addChannelMembers(context, job.channel_id, { userIds: missing, access: "submit" });
    }
    return { channelId: job.channel_id, created: false };
  }

  // Channel names are unique per organization: suffix on collision.
  const base = `job ${job.code}`.slice(0, 72);
  let channel: { id: string } | null = null;
  for (let attempt = 0; attempt < 5 && !channel; attempt += 1) {
    try {
      channel = await createChannel(context, {
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
