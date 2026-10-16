import type { Department } from "../../contracts/departments.js";
import { getSql } from "../../db/client.js";
import type { QuerySql, SqlFragment } from "../../lib/db-types.js";
import { logger } from "../../lib/logger.js";
import { evictUsersFromRoom } from "../../realtime/publisher.js";
import type { AccessContext } from "../access/access-context.js";
import { departmentMemberSql } from "../access/departments.js";
import { purgeNotificationsFor } from "../notifications/notifications.service.js";
import { channelInfoColumnsSql, toChannelInfo, type ChannelInfoRow } from "./chat-mappers.js";
import {
  advanceReadMarkers,
  channelRoom,
  insertSystemMessage,
  publishChannelEvent,
  publishMessages,
  systemActorContext
} from "./chat.repo.js";

/**
 * Department channels (PD-053): a public channel belongs to one department and every member of that department (the
 * superadmin included, `public.is_department_member`) is a member of it — nobody adds people by hand.
 *   - `addDepartmentMembers`: everyone of the department joins a channel made public (create, private → public);
 *   - `syncDepartmentChannels` + `publishDepartmentChannelSync`: a person who gains a department joins its public
 *     channels, one who loses it leaves them — called in the transaction that changes their departments (every
 *     caller of `replaceUserDepartments`, account creation, a promotion to / demotion from superadmin), published after
 *     the commit. Quiet: system messages and realtime hints, no inbox notification. Private channels and DMs never
 *     change. Disabled accounts keep their channels like before (existing behaviour); they are not added to new ones.
 * PD-063: temporary QA test accounts and real accounts never meet through this: a public channel created by a test
 * account takes only the department's test accounts, any other one only its real accounts (`sameWorldAsChannelSql`).
 */

/**
 * The person (`isTestAccount`, a boolean SQL expression) is on the same side as the channel `channelId`: test accounts
 * with channels a test account created, real accounts with every other channel (creator real or removed).
 */
const sameWorldAsChannelSql = (sql: QuerySql, channelId: SqlFragment, isTestAccount: SqlFragment) =>
  sql`${isTestAccount} = coalesce((
    SELECT creator.is_test_account FROM public.channels ch JOIN public.app_users creator ON creator.id = ch.created_by
    WHERE ch.id = ${channelId}
  ), false)`;

/** Someone added to a channel: id and display name (for the "X added …" system message). */
export type AddedMember = { userId: string; displayName: string };

/**
 * Adds every active organization member of `department` who is not in the channel yet (role member, send access,
 * read marker at `lastReadSeq`; the caller advances it past its system message). Returns them by name.
 */
export const addDepartmentMembers = async (
  tx: QuerySql,
  context: AccessContext,
  channelId: string,
  department: Department,
  lastReadSeq: number
): Promise<AddedMember[]> => {
  const rows = await tx<{ user_id: string; display_name: string }[]>`
    WITH added AS (
      INSERT INTO public.channel_members (organization_id, channel_id, user_id, access, role, last_read_seq, added_by)
      SELECT om.organization_id, ${channelId}::uuid, om.user_id, 'submit', 'member', ${lastReadSeq}::bigint, ${context.user.id}::uuid
      FROM public.organization_memberships om
      JOIN public.app_users au ON au.id = om.user_id AND au.deleted_at IS NULL
      WHERE om.organization_id = ${context.organization.id}
        AND om.status = 'active'
        AND om.deleted_at IS NULL
        AND ${departmentMemberSql(tx, tx`om.organization_id`, tx`om.user_id`, department)}
        AND ${sameWorldAsChannelSql(tx, tx`${channelId}::uuid`, tx`au.is_test_account`)}
      ON CONFLICT (organization_id, channel_id, user_id) WHERE deleted_at IS NULL DO NOTHING
      RETURNING user_id
    )
    SELECT added.user_id, au.display_name
    FROM added
    JOIN public.app_users au ON au.id = added.user_id
    ORDER BY au.display_name, added.user_id
  `;
  return rows.map((row) => ({ userId: row.user_id, displayName: row.display_name }));
};

/** What `syncDepartmentChannels` changed, for `publishDepartmentChannelSync` after the commit. */
export type DepartmentChannelSync = {
  /** Who made the change (names the system messages). */
  actor: AccessContext;
  userId: string;
  joined: { channelId: string; messageId: string }[];
  /** `messageId` null in archived channels (read-only: no system message). */
  left: { channelId: string; messageId: string | null }[];
};

/**
 * Inside the transaction that changes a person's departments: they join every non-deleted, non-archived public channel
 * of the departments in `join` (role member, send access, caught up) and leave the public channels of the departments
 * in `leave` (archived ones too). `join` / `leave` are effective departments gained / lost (a superadmin belongs to
 * all); joining again is harmless. System messages "X added Y" / "X removed Y" (or "Y joined" / "Y left" when the
 * person acts on themselves); no inbox notification. Returns null when nothing changed.
 */
export const syncDepartmentChannels = async (
  tx: QuerySql,
  input: {
    organizationId: string;
    userId: string;
    actorUserId: string | null;
    join: readonly Department[];
    leave: readonly Department[];
  }
): Promise<DepartmentChannelSync | null> => {
  const leave = [...new Set(input.leave)];
  const join = [...new Set(input.join)].filter((department) => !leave.includes(department));
  if (join.length === 0 && leave.length === 0) {
    return null;
  }
  const { organizationId, userId } = input;
  const actorId = input.actorUserId ?? userId;

  const leftRows =
    leave.length === 0
      ? []
      : await tx<{ channel_id: string; archived: boolean }[]>`
          UPDATE public.channel_members cm
          SET deleted_at = now(), deleted_by = ${actorId}::uuid
          FROM public.channels c
          WHERE cm.organization_id = ${organizationId} AND cm.user_id = ${userId} AND cm.deleted_at IS NULL
            AND c.organization_id = cm.organization_id AND c.id = cm.channel_id
            AND c.kind = 'public' AND c.department = ANY(${leave}::text[]) AND c.deleted_at IS NULL
          RETURNING cm.channel_id, c.archived_at IS NOT NULL AS archived
        `;
  const joinedRows =
    join.length === 0
      ? []
      : await tx<{ channel_id: string }[]>`
          INSERT INTO public.channel_members (organization_id, channel_id, user_id, access, role, last_read_seq, added_by)
          SELECT c.organization_id, c.id, ${userId}::uuid, 'submit', 'member', c.last_message_seq, ${actorId}::uuid
          FROM public.channels c
          WHERE c.organization_id = ${organizationId} AND c.kind = 'public' AND c.department = ANY(${join}::text[])
            AND c.deleted_at IS NULL AND c.archived_at IS NULL
            AND ${sameWorldAsChannelSql(
              tx,
              tx`c.id`,
              tx`coalesce((SELECT person.is_test_account FROM public.app_users person WHERE person.id = ${userId}::uuid), false)`
            )}
          ORDER BY c.id
          ON CONFLICT (organization_id, channel_id, user_id) WHERE deleted_at IS NULL DO NOTHING
          RETURNING channel_id
        `;
  if (leftRows.length === 0 && joinedRows.length === 0) {
    return null;
  }

  const actor = await systemActorContext(tx, organizationId, actorId);
  const self = actorId === userId;
  const name =
    (await tx<{ display_name: string }[]>`SELECT display_name FROM public.app_users WHERE id = ${userId}`)[0]?.display_name ?? null;
  const names = name ? [name] : [];
  // Each system message locks its channel row: always in id order (no deadlock with a concurrent sync).
  const byId = (a: { channel_id: string }, b: { channel_id: string }) => a.channel_id.localeCompare(b.channel_id);

  const left: DepartmentChannelSync["left"] = [];
  for (const row of [...leftRows].sort(byId)) {
    const messageId = row.archived
      ? null
      : (
          await insertSystemMessage(
            tx,
            actor,
            row.channel_id,
            self ? { type: "left", actorId, userIds: [userId] } : { type: "member_removed", actorId, userIds: [userId] },
            names
          )
        ).id;
    left.push({ channelId: row.channel_id, messageId });
  }
  const joined: DepartmentChannelSync["joined"] = [];
  for (const row of [...joinedRows].sort(byId)) {
    const message = await insertSystemMessage(
      tx,
      actor,
      row.channel_id,
      self ? { type: "joined", actorId, userIds: [userId] } : { type: "members_added", actorId, userIds: [userId] },
      names
    );
    // They start caught up.
    await advanceReadMarkers(tx, actor, row.channel_id, [userId], message.seq);
    joined.push({ channelId: row.channel_id, messageId: message.id });
  }
  return { actor, userId, joined, left };
};

/**
 * After the commit of `syncDepartmentChannels`: system messages to each channel room, `chat:channel` "joined" / "left"
 * to the room and the person (their sidebar updates live), the person evicted from the rooms they left and their inbox
 * entries about those channels purged. Never throws: the department change is already committed.
 */
export const publishDepartmentChannelSync = async (sync: DepartmentChannelSync | null | undefined) => {
  if (!sync) {
    return;
  }
  const { actor, userId } = sync;
  try {
    const sql = getSql();
    const channelIds = [...sync.joined, ...sync.left].map((entry) => entry.channelId);
    const infos = new Map(
      (
        await sql<ChannelInfoRow[]>`
          SELECT ${channelInfoColumnsSql(sql)} FROM public.channels c
          WHERE c.organization_id = ${actor.organization.id} AND c.id = ANY(${channelIds}::uuid[])
        `
      ).map((row) => [row.id, toChannelInfo(row)])
    );
    for (const { channelId, messageId } of sync.joined) {
      await publishMessages(sql, actor, channelId, [messageId]);
      publishChannelEvent({
        kind: "joined",
        channelId,
        channel: infos.get(channelId) ?? null,
        userIds: [userId],
        actorId: actor.user.id,
        toRoom: true,
        toUsers: [userId]
      });
    }
    for (const { channelId, messageId } of sync.left) {
      await publishMessages(sql, actor, channelId, messageId ? [messageId] : []);
      publishChannelEvent({
        kind: "left",
        channelId,
        channel: infos.get(channelId) ?? null,
        userIds: [userId],
        actorId: actor.user.id,
        toRoom: true,
        toUsers: [userId]
      });
      evictUsersFromRoom([userId], channelRoom(channelId));
      await purgeNotificationsFor({ organizationId: actor.organization.id, userIds: [userId], channelId });
    }
  } catch (error) {
    logger.error({ err: error, userId }, "Publishing department channel changes failed");
  }
};
