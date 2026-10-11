/**
 * Engine of seed-knowledge.ts (LOCAL DEVELOPMENT ONLY). Replays scripts/seed-knowledge/content.ts through the real
 * knowledge services (spaces, members, categories, items, versions, status changes, comments, trash), so versions,
 * audit entries, followers and search vectors are exactly what the app writes. After each step the rows it created
 * are moved to the planned business time (session_replication_role = replica, like seed-workspace's backdating;
 * the append-only triggers on audit_log / item_versions are row triggers and stay off only for that statement).
 * Everything created is listed in nesso_dev.seed_manifest (dev-only schema), so --reset removes exactly that.
 */
import type postgres from "postgres";

import type { RichTextDoc, RichTextNode } from "../../src/contracts/rich-text.js";
import { closeDatabase, getSql } from "../../src/db/client.js";
import { closeRedis } from "../../src/lib/redis.js";
import { removeObjects } from "../../src/lib/storage.js";
import type { AccessContext } from "../../src/modules/access/access-context.js";
import { createComment, resolveComment } from "../../src/modules/knowledge/comments.service.js";
import { createItem, deleteItem, getItemDetail, updateItem } from "../../src/modules/knowledge/items.service.js";
import { createCategory, createSpace, upsertMember } from "../../src/modules/knowledge/spaces.service.js";
import { deliverNotifications } from "../../src/modules/notifications/notifications.service.js";
import { getWorkspaceContext } from "../../src/modules/workspace/workspace.service.js";
import { spaces, type Block, type Inline, type ItemSeed, type Para, type Person, type SpaceSeed, type StatusName } from "./content.js";

const SEED = "seed-knowledge";
const log = (message: string) => console.log(`[seed-knowledge] ${message}`);

type PersonRow = { id: string; label: string; context: AccessContext };

/** "2026-09-03", 9, 30 → that instant in Asia/Ho_Chi_Minh. */
const at = (day: string, hour: number, minute = 0) =>
  new Date(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+07:00`);

// People --------------------------------------------------------------------------------------------------

const resolvePeople = async (sql: postgres.Sql) => {
  const org = (await sql<{ id: string }[]>`SELECT id FROM public.organizations WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`)[0];
  if (!org) {
    throw new Error("No organization found.");
  }
  // The owner is whoever holds the superadmin role (earliest active membership); the e-mail is never hardcoded.
  const owner = (
    await sql<{ id: string }[]>`
      SELECT om.user_id AS id FROM public.organization_memberships om
      JOIN public.roles r ON r.id = om.role_id AND r.organization_id = om.organization_id AND r.key = 'superadmin' AND r.deleted_at IS NULL
      JOIN public.app_users au ON au.id = om.user_id AND au.deleted_at IS NULL
      WHERE om.organization_id = ${org.id} AND om.status = 'active' AND om.deleted_at IS NULL
      ORDER BY om.joined_at NULLS LAST, om.created_at LIMIT 1
    `
  )[0];
  if (!owner) {
    throw new Error("No active superadmin found.");
  }
  // Demo people: invented dev accounts only (@test.local first, then @nesso.test).
  const candidates = await sql<{ id: string; role: string }[]>`
    SELECT au.id, r.key AS role
    FROM public.organization_memberships om
    JOIN public.roles r ON r.id = om.role_id AND r.organization_id = om.organization_id AND r.deleted_at IS NULL
    JOIN public.app_users au ON au.id = om.user_id AND au.deleted_at IS NULL
    WHERE om.organization_id = ${org.id} AND om.status = 'active' AND om.deleted_at IS NULL AND r.key <> 'superadmin'
      AND (au.email ILIKE '%@test.local' OR au.email ILIKE '%@nesso.test')
    ORDER BY (au.email ILIKE '%@test.local') DESC, om.created_at, au.id
  `;
  const leads = candidates.filter((row) => ["admin", "manager", "truong_nhom_du_an"].includes(row.role));
  const staff = candidates.filter((row) => row.role === "member");
  const pick = (pool: { id: string }[], fallback: { id: string }[], index: number) => pool[index] ?? fallback[index] ?? null;
  const ids: Record<Person, string | null> = {
    owner: owner.id,
    lead1: pick(leads, staff, 0)?.id ?? null,
    lead2: pick(leads, staff, 1)?.id ?? null,
    staff1: pick(staff, leads, 0)?.id ?? null,
    staff2: pick(staff, leads, 1)?.id ?? null,
    staff3: pick(staff, leads, 2)?.id ?? null,
    staff4: pick(staff, leads, 3)?.id ?? null,
    staff5: pick(staff, leads, 4)?.id ?? null,
    staff6: pick(staff, leads, 5)?.id ?? null
  };
  const used = new Set(Object.values(ids).filter(Boolean));
  if (used.size < 9) {
    throw new Error("Not enough active dev accounts (need 2 leads + 6 members besides the superadmin). Run seed-dev-users / seed-workspace first.");
  }
  const people = {} as Record<Person, PersonRow>;
  for (const [key, id] of Object.entries(ids) as [Person, string][]) {
    const context = await getWorkspaceContext(id);
    people[key] = { id, label: context.user.displayName, context };
  }
  return { organizationId: org.id, people };
};

// Rich text -----------------------------------------------------------------------------------------------

const toDoc = (blocks: Block[], people: Record<Person, PersonRow>): RichTextDoc => {
  const inline = (part: Inline): RichTextNode => {
    if (typeof part === "string") {
      return { type: "text", text: part };
    }
    if ("mention" in part) {
      const person = people[part.mention];
      return { type: "mention", attrs: { id: person.id, label: person.label } };
    }
    return { type: "text", text: part.bold, marks: [{ type: "bold" }] };
  };
  const paragraph = (para: Para): RichTextNode => ({ type: "paragraph", content: (typeof para === "string" ? [para] : para).map(inline) });
  const list = (type: "bulletList" | "orderedList", entries: Para[]): RichTextNode => ({
    type,
    content: entries.map((entry) => ({ type: "listItem", content: [paragraph(entry)] }))
  });
  return {
    type: "doc",
    content: blocks.map((block): RichTextNode => {
      if ("h" in block) {
        return { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: block.h }] };
      }
      if ("p" in block) {
        return paragraph(block.p);
      }
      if ("ul" in block) {
        return list("bulletList", block.ul);
      }
      if ("ol" in block) {
        return list("orderedList", block.ol);
      }
      return { type: "blockquote", content: [paragraph(block.note)] };
    })
  };
};

// Backdating ------------------------------------------------------------------------------------------------

const stampColumns: [string, string, string[]][] = [
  ["knowledge.spaces", "id", ["created_at", "updated_at", "archived_at"]],
  ["knowledge.space_members", "space_id", ["created_at", "updated_at"]],
  ["knowledge.statuses", "space_id", ["created_at", "updated_at"]],
  ["knowledge.categories", "space_id", ["created_at", "updated_at"]],
  ["knowledge.items", "space_id", ["created_at", "updated_at", "deleted_at"]],
  ["knowledge.item_versions", "space_id", ["created_at"]],
  ["knowledge.comments", "space_id", ["created_at", "edited_at", "resolved_at", "deleted_at"]],
  ["knowledge.followers", "space_id", ["created_at"]],
  ["knowledge.audit_log", "space_id", ["created_at"]]
];

/**
 * Runs one step through the services, then moves every timestamp it wrote in this space to `planned` (keeping the
 * order within the step). Rows of other spaces — e.g. someone using the app meanwhile — are never touched.
 */
const stamp = async <T>(sql: postgres.Sql, spaceId: () => string, planned: Date, step: () => Promise<T>): Promise<T> => {
  const started = (await sql<{ t: string }[]>`SELECT clock_timestamp()::text AS t`)[0]!.t;
  const result = await step();
  const space = spaceId();
  await sql.begin(async (tx) => {
    await tx`SET LOCAL session_replication_role = replica`;
    for (const [table, key, columns] of stampColumns) {
      for (const column of columns) {
        await tx`
          UPDATE ${tx(table)} SET ${tx(column)} = ${planned.toISOString()}::timestamptz + (${tx(column)} - ${started}::timestamptz)
          WHERE ${tx(key)} = ${space} AND ${tx(column)} >= ${started}::timestamptz
        `;
      }
    }
  });
  return result;
};

// Manifest & reset --------------------------------------------------------------------------------------------

const ensureManifest = async (sql: postgres.Sql) => {
  const present = (await sql<{ present: boolean }[]>`SELECT to_regclass('nesso_dev.seed_manifest') IS NOT NULL AS present`)[0]?.present;
  if (present) {
    return;
  }
  await sql`
    CREATE TABLE nesso_dev.seed_manifest (
      seed text NOT NULL,
      kind text NOT NULL,
      id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (seed, kind, id)
    )
  `;
  await sql`REVOKE ALL ON TABLE nesso_dev.seed_manifest FROM PUBLIC`;
};

const resetSeed = async (sql: postgres.Sql) => {
  const ids = (await sql<{ id: string }[]>`SELECT id FROM nesso_dev.seed_manifest WHERE seed = ${SEED} AND kind = 'space'`).map((row) => row.id);
  if (ids.length === 0) {
    log("nothing to remove");
    return;
  }
  const paths = await sql<{ storage_path: string }[]>`SELECT storage_path FROM knowledge.item_attachments WHERE space_id = ANY(${ids}::uuid[])`;
  await sql.begin(async (tx) => {
    // Replica mode: the audit log and versions are append-only by trigger; FK actions are off too, so every table
    // is emptied explicitly (children first).
    await tx`SET LOCAL session_replication_role = replica`;
    await tx`DELETE FROM public.notifications WHERE type LIKE 'knowledge.%' AND payload->>'knowledgeSpaceId' = ANY(${ids}::text[])`;
    for (const table of [
      "knowledge.audit_log",
      "knowledge.item_attachments",
      "knowledge.followers",
      "knowledge.comments",
      "knowledge.item_versions",
      "knowledge.items",
      "knowledge.categories",
      "knowledge.statuses",
      "knowledge.space_members"
    ]) {
      await tx`DELETE FROM ${tx(table)} WHERE space_id = ANY(${ids}::uuid[])`;
    }
    await tx`DELETE FROM knowledge.spaces WHERE id = ANY(${ids}::uuid[])`;
    await tx`DELETE FROM nesso_dev.seed_manifest WHERE seed = ${SEED}`;
  });
  if (paths.length > 0) {
    await removeObjects(paths.map((row) => row.storage_path)).catch((error: unknown) => log(`storage cleanup failed: ${String(error)}`));
  }
  log(`removed ${ids.length} spaces`);
};

// Replay ------------------------------------------------------------------------------------------------------

type SpaceState = { id: string; statuses: Map<StatusName, string>; categories: Map<string, string> };

const seedSpace = async (sql: postgres.Sql, people: Record<Person, PersonRow>, seed: SpaceSeed) => {
  const existing = await sql<{ id: string }[]>`
    SELECT id FROM knowledge.spaces WHERE lower(name) = lower(${seed.name}) AND deleted_at IS NULL
  `;
  if (existing.length > 0) {
    log(`skipped "${seed.name}": a space with this name already exists (not created by this seed)`);
    return null;
  }
  const owner = people.owner.context;
  const state: SpaceState = { id: "", statuses: new Map(), categories: new Map() };
  const space = () => state.id;

  const created = await stamp(sql, () => state.id, at(seed.day, 8, 30), async () => {
    const detail = await createSpace(owner, {
      name: seed.name,
      description: seed.description,
      visibility: seed.visibility,
      color: seed.color as never,
      icon: seed.icon,
      approvalRequired: seed.approvalRequired
    });
    state.id = detail.id;
    await sql`INSERT INTO nesso_dev.seed_manifest (seed, kind, id) VALUES (${SEED}, 'space', ${detail.id}) ON CONFLICT DO NOTHING`;
    return detail;
  });
  for (const status of created.statuses) {
    state.statuses.set(status.name as StatusName, status.id);
  }
  await stamp(sql, space, at(seed.day, 8, 40), async () => {
    for (const member of seed.members) {
      await upsertMember(owner, state.id, { userId: people[member.who].id, accessLevel: member.level });
    }
  });
  await stamp(sql, space, at(seed.day, 8, 50), async () => {
    for (const category of seed.categories) {
      const root = await createCategory(owner, state.id, { name: category.name });
      state.categories.set(category.name, root.id);
      for (const child of category.children ?? []) {
        const sub = await createCategory(owner, state.id, { name: child, parentId: root.id });
        state.categories.set(`${category.name}/${child}`, sub.id);
      }
    }
  });

  const levels = new Map<Person, "view" | "submit" | "manage">([["owner", "manage"], ...seed.members.map((member) => [member.who, member.level] as const)]);
  const items = [...seed.items].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  let index = 0;
  for (const item of items) {
    await seedItem(sql, people, seed, state, levels, item, index);
    index += 1;
  }
  log(`"${seed.name}": ${items.length} items`);
  return state;
};

const statusId = (state: SpaceState, name: StatusName) => {
  const id = state.statuses.get(name);
  if (!id) {
    throw new Error(`Status ${name} missing`);
  }
  return id;
};

const seedItem = async (
  sql: postgres.Sql,
  people: Record<Person, PersonRow>,
  seed: SpaceSeed,
  state: SpaceState,
  levels: Map<Person, "view" | "submit" | "manage">,
  item: ItemSeed,
  index: number
) => {
  const space = () => state.id;
  const critical = item.importance === "critical";
  const reason = (text: string) => (critical ? text : undefined);
  const minute = (index * 7) % 50;
  const authorLevel = levels.get(item.author) ?? "view";
  const target = item.status;
  const directActive = !seed.approvalRequired && target !== "Nháp" && target !== "Chờ duyệt";

  const detail = await stamp(sql, space, at(item.day, 9, minute), () =>
    createItem(people[item.author].context, state.id, {
      title: item.title,
      summary: item.summary ?? null,
      body: toDoc(item.body, people),
      categoryId: item.category ? (state.categories.get(item.category) ?? null) : null,
      importance: item.importance,
      statusId: directActive ? statusId(state, "Đã ban hành") : undefined,
      ownerId: item.owner ? people[item.owner].id : null,
      effectiveFrom: item.effectiveFrom ?? null,
      reviewBy: item.reviewBy ?? null,
      tags: item.tags,
      pinned: item.pinned ?? false
    } as Parameters<typeof createItem>[2])
  );
  const itemId = detail.id;
  let version = detail.version;

  // Approval step: a member below manage sends it for approval, a manager publishes.
  if (seed.approvalRequired && target !== "Nháp") {
    if (authorLevel !== "manage" || target === "Chờ duyệt") {
      await stamp(sql, space, at(item.day, 11, minute), () =>
        updateItem(people[item.author].context, itemId, { statusId: statusId(state, "Chờ duyệt"), reason: reason("Gửi duyệt") })
      );
    }
    if (target !== "Chờ duyệt") {
      const publisher = item.publishedBy ?? "owner";
      await stamp(sql, space, at(item.publishDay ?? item.day, 15, minute), () =>
        updateItem(people[publisher].context, itemId, { statusId: statusId(state, "Đã ban hành"), reason: reason("Duyệt ban hành") })
      );
    }
  }

  let currentBody = item.body;
  for (const [revisionIndex, revision] of (item.revisions ?? []).entries()) {
    currentBody = revision.body ?? [...currentBody, { p: revision.note }];
    const saved = await stamp(sql, space, at(revision.day, 14, minute + revisionIndex), () =>
      updateItem(people[revision.by].context, itemId, {
        expectedVersion: version,
        body: toDoc(currentBody, people),
        versionNote: revision.note,
        reason: revision.reason ?? reason("Cập nhật nội dung")
      })
    );
    version = saved.version;
  }

  if (target === "Cần cập nhật" || target === "Hết hiệu lực") {
    await stamp(sql, space, at(item.finalStatusDay ?? item.day, 16, minute), () =>
      updateItem(people[item.finalStatusBy ?? item.author].context, itemId, {
        statusId: statusId(state, target),
        reason: item.finalStatusReason ?? reason("Đổi trạng thái")
      })
    );
  }

  for (const [commentIndex, comment] of (item.comments ?? []).entries()) {
    const root = await stamp(sql, space, at(comment.day, 10 + commentIndex, (minute + 13) % 60), () =>
      createComment(people[comment.by].context, itemId, { body: toDoc([{ p: comment.text }], people), attachmentIds: [] })
    );
    for (const [replyIndex, reply] of (comment.replies ?? []).entries()) {
      await stamp(sql, space, at(reply.day, 13 + replyIndex, (minute + 21) % 60), () =>
        createComment(people[reply.by].context, itemId, { body: toDoc([{ p: reply.text }], people), parentCommentId: root.id, attachmentIds: [] })
      );
    }
    if (comment.resolvedBy) {
      const resolver = comment.resolvedBy;
      await stamp(sql, space, at(comment.replies?.at(-1)?.day ?? comment.day, 17, minute), () =>
        resolveComment(people[resolver].context, itemId, root.id, true)
      );
    }
  }

  if (item.trashedBy) {
    const by = item.trashedBy;
    await stamp(sql, space, at(item.trashedDay ?? item.day, 17, 30), () =>
      deleteItem(people[by].context, itemId, { reason: item.trashedReason })
    );
  }
  return itemId;
};

// Owner inbox ----------------------------------------------------------------------------------------------------

/**
 * Replayed history never reached the outbox (stubbed for this process): a few inbox entries for the owner are
 * written directly, dated like the comments / status changes they describe.
 */
const seedOwnerInbox = async (sql: postgres.Sql, organizationId: string, people: Record<Person, PersonRow>) => {
  const owner = people.owner;
  const findItem = async (title: string) =>
    (
      await sql<{ id: string; space_id: string; space_name: string; importance: string }[]>`
        SELECT i.id, i.space_id, s.name AS space_name, i.importance FROM knowledge.items i
        JOIN knowledge.spaces s ON s.id = i.space_id
        JOIN nesso_dev.seed_manifest m ON m.seed = ${SEED} AND m.kind = 'space' AND m.id = s.id
        WHERE i.title = ${title} AND i.deleted_at IS NULL
      `
    )[0];
  const commentMentioning = async (itemId: string) =>
    (
      await sql<{ id: string; author_user_id: string; body_text: string; created_at: Date }[]>`
        SELECT id, author_user_id, body_text, created_at FROM knowledge.comments
        WHERE item_id = ${itemId} AND ${owner.id} = ANY(mentioned_user_ids) AND deleted_at IS NULL
        ORDER BY created_at LIMIT 1
      `
    )[0];
  const entries: { type: "knowledge.approval_requested" | "knowledge.mentioned"; title: string; actor: Person; at: Date; comment: boolean }[] = [
    { type: "knowledge.approval_requested", title: "Quy trình retouch ảnh cưới", actor: "staff2", at: at("2026-10-07", 11, 5), comment: false },
    { type: "knowledge.mentioned", title: "Quy trình retouch ảnh cưới", actor: "lead2", at: at("2026-10-08", 10, 40), comment: true },
    { type: "knowledge.mentioned", title: "Kế hoạch kinh doanh quý IV/2026", actor: "lead1", at: at("2026-10-04", 10, 15), comment: true }
  ];
  let count = 0;
  for (const entry of entries) {
    const target = await findItem(entry.title);
    if (!target) {
      continue;
    }
    const comment = entry.comment ? await commentMentioning(target.id) : null;
    if (entry.comment && !comment) {
      continue;
    }
    const dedupeKey = `seed-knowledge:${target.id}:${entry.type}`;
    await deliverNotifications({
      organizationId,
      recipientIds: [owner.id],
      type: entry.type,
      actorUserId: people[entry.actor].id,
      title: entry.title,
      body: comment?.body_text.slice(0, 280) ?? null,
      commentId: comment?.id ?? null,
      payload: {
        knowledgeSpaceId: target.space_id,
        knowledgeItemId: target.id,
        spaceName: target.space_name,
        importance: target.importance,
        ...(comment ? { commentId: comment.id, source: "comment" } : { statusName: "Chờ duyệt", version: 1 })
      },
      dedupeKey
    });
    await sql`
      UPDATE public.notifications SET created_at = ${comment?.created_at ?? entry.at}
      WHERE recipient_user_id = ${owner.id} AND dedupe_key = ${dedupeKey}
    `;
    count += 1;
  }
  log(`owner inbox: ${count} notifications`);
};

// Entry -------------------------------------------------------------------------------------------------------------

export const main = async (args: string[]) => {
  const sql = getSql();
  try {
    await ensureManifest(sql);
    await resetSeed(sql);
    if (args.includes("--reset")) {
      return;
    }
    const { organizationId, people } = await resolvePeople(sql);
    log(`owner: ${people.owner.label}; people: ${(Object.keys(people) as Person[]).filter((key) => key !== "owner").map((key) => people[key].label).join(", ")}`);
    let total = 0;
    for (const space of spaces) {
      const state = await seedSpace(sql, people, space);
      if (state) {
        total += space.items.length;
      }
    }
    await seedOwnerInbox(sql, organizationId, people);
    // Sanity: one item per space opens with the owner's context (capabilities computed by the service).
    const sample = (await sql<{ id: string }[]>`
      SELECT i.id FROM knowledge.items i JOIN nesso_dev.seed_manifest m ON m.seed = ${SEED} AND m.id = i.space_id
      WHERE i.deleted_at IS NULL LIMIT 1
    `)[0];
    if (sample) {
      await getItemDetail(people.owner.context, sample.id);
    }
    log(`done: ${spaces.length} spaces, ${total} items`);
  } finally {
    await closeRedis().catch(() => undefined);
    await closeDatabase();
  }
};
