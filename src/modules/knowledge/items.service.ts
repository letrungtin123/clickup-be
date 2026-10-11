import type postgres from "postgres";

import type {
  CreateKnowledgeItemRequest,
  KnowledgeItemDetail,
  KnowledgeItemPage,
  KnowledgeItemQuery,
  KnowledgeTrashedItem,
  UpdateKnowledgeItemRequest
} from "../../contracts/knowledge.js";
import { knowledgeLimits } from "../../contracts/knowledge.js";
import { Permission } from "../../contracts/permissions.js";
import type { RichTextDoc } from "../../contracts/rich-text.js";
import type { UserRef } from "../../contracts/work.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import {
  decodeCursor,
  decodeKeysetCursor,
  decodeTimeCursor,
  encodeCursor,
  encodeKeysetCursor,
  encodeTimeCursor,
  escapeLike,
  invalidCursor,
  isCursorTimestamp,
  isUuid,
  nullableText,
  timestampParamSql,
  timestampTextSql,
  toIso,
  toPrefixTsQuery,
  type QuerySql,
  type SqlFragment
} from "../../lib/db-types.js";
import { logger } from "../../lib/logger.js";
import { getOptionalRedis } from "../../lib/redis.js";
import { removeObjects } from "../../lib/storage.js";
import type { AccessContext } from "../access/access-context.js";
import { enqueueDomainEvents, type DomainEventInput } from "../events/outbox.js";
import { knowledgeItemChangedEvent } from "./events.js";
import { toColor, toUserRef, type UserRefJson } from "../work/mappers.js";
import {
  assertSpaceAccess,
  authorizeItem,
  forbidden,
  knowledgePermissionFlags,
  loadReaderCandidates,
  requireKnowledgePermission,
  type ItemCore,
  type SpaceAccess
} from "./access.js";
import {
  assertBodyImages,
  attachmentsJsonSql,
  auditColumnsSql,
  auditFor,
  canonicalJson,
  insertVersion,
  itemColumnsSql,
  loadStatuses,
  publishKnowledge,
  sanitizeItemBody,
  toAuditEntry,
  toItemSummary,
  toKnowledgeAttachment,
  userJsonSql,
  type AttachmentRow,
  type AuditInput,
  type AuditRow,
  type ItemRow,
  type StatusRow
} from "./repo.js";
import {
  allowedStatusIds,
  assertItemEditable,
  assertStatusAllowed,
  businessDay,
  canEditItem,
  canViewItemHistory,
  checkExpectedVersion,
  firstDraftStatus,
  isApprovalRequest,
  newlyMentioned,
  normalizeTags,
  reasonRequired,
  resolveReason,
  sameStringSet,
  seesAllDrafts,
  spaceReaders
} from "./rules.js";

// Shared checks --------------------------------------------------------------------------------------

const findStatus = (statuses: StatusRow[], statusId: string) => {
  const status = statuses.find((entry) => entry.id === statusId);
  if (!status) {
    throw new AppError("KNOWLEDGE_STATUS_NOT_FOUND", "Trạng thái không thuộc kho này.", 400);
  }
  return status;
};

const statusLike = (status: StatusRow) => ({ id: status.id, group: status.status_group, position: Number(status.position) });

const assertCategoryInSpace = async (sql: QuerySql, spaceId: string, categoryId: string | null) => {
  if (!categoryId) {
    return null;
  }
  const row = (
    await sql<{ id: string; name: string }[]>`SELECT id, name FROM knowledge.categories WHERE id = ${categoryId} AND space_id = ${spaceId}`
  )[0];
  if (!row) {
    throw new AppError("KNOWLEDGE_CATEGORY_NOT_FOUND", "Chuyên mục không thuộc kho này.", 400);
  }
  return row;
};

/** The owner ("Người phụ trách") must be an active member of the organization who can read the space. */
const assertOwnerCanRead = async (sql: QuerySql, context: AccessContext, access: SpaceAccess, ownerId: string | null) => {
  if (!ownerId) {
    return null;
  }
  const candidates = await loadReaderCandidates(sql, context.organization.id, access.spaceId, [ownerId]);
  if (spaceReaders(candidates, access.visibility).length === 0) {
    throw new AppError("KNOWLEDGE_OWNER_INVALID", "Người phụ trách phải là người xem được kho này.", 400);
  }
  return (await sql<{ display_name: string }[]>`SELECT display_name FROM public.app_users WHERE id = ${ownerId}`)[0]?.display_name ?? null;
};

const versionConflict = async (sql: QuerySql, itemId: string, currentVersion: number) => {
  const latest = (
    await sql<{ number: number; author: UserRefJson | null; created_at: Date }[]>`
      SELECT v.number, v.created_at, (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = v.author_user_id) AS author
      FROM knowledge.item_versions v WHERE v.item_id = ${itemId} ORDER BY v.number DESC LIMIT 1
    `
  )[0];
  return new AppError(
    "KNOWLEDGE_VERSION_CONFLICT",
    "Có người vừa lưu phiên bản mới hơn của mục này. Hãy xem khác biệt rồi lưu lại.",
    409,
    {
      latestVersion: Number(latest?.number ?? currentVersion),
      savedBy: toUserRef(latest?.author ?? null),
      savedAt: toIso(latest?.created_at ?? new Date())
    }
  );
};

const itemEvent = (context: AccessContext, item: { spaceId: string; itemId: string }, payload: Record<string, postgres.JSONValue>): DomainEventInput => ({
  organizationId: context.organization.id,
  type: knowledgeItemChangedEvent,
  aggregateType: "knowledge_item",
  aggregateId: item.itemId,
  actorUserId: context.user.id,
  payload: { spaceId: item.spaceId, itemId: item.itemId, ...payload }
});

const followItem = async (sql: QuerySql, context: AccessContext, spaceId: string, itemId: string, userIds: (string | null)[]) => {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) {
    return;
  }
  await sql`
    INSERT INTO knowledge.followers (organization_id, space_id, item_id, user_id)
    SELECT ${context.organization.id}, ${spaceId}, ${itemId}, u.id FROM unnest(${ids}::uuid[]) AS u(id)
    ON CONFLICT (item_id, user_id) DO NOTHING
  `;
};

// Listing ---------------------------------------------------------------------------------------------

type KeyPart = { expr: () => SqlFragment; value: () => SqlFragment; dir: "asc" | "desc" };

/** Keyset "after this row" for mixed sort directions: (k1 ⋚ v1) OR (k1 = v1 AND (rest…)). */
const keysetAfter = (sql: QuerySql, parts: KeyPart[]): SqlFragment => {
  const [first, ...rest] = parts;
  if (!first) {
    return sql`FALSE`;
  }
  const compare = first.dir === "asc" ? sql`${first.expr()} > ${first.value()}` : sql`${first.expr()} < ${first.value()}`;
  if (rest.length === 0) {
    return sql`(${compare})`;
  }
  return sql`(${compare} OR (${first.expr()} = ${first.value()} AND ${keysetAfter(sql, rest)}))`;
};

const asArray = <T>(value: T | T[] | undefined): T[] | null => (value === undefined ? null : Array.isArray(value) ? value : [value]);

type SortSpec = {
  /** ORDER BY after the retired flag. */
  order: (sql: QuerySql) => SqlFragment;
  /** Values for the cursor of a row. */
  values: (row: SortRow) => (string | number)[];
  /** Keyset parts after the retired flag from decoded cursor values. */
  parts: (sql: QuerySql, values: (string | number | null)[]) => KeyPart[];
  /** Expected cursor value kinds after [sort, retired]. */
  kinds: ("timestamp" | "text" | "integer" | "date")[];
};

type SortRow = { k_at: string; k_created: string; k_title: string; k_importance: number; k_review: string; id: string };

const sorts: Record<KnowledgeItemQuery["sort"], SortSpec> = {
  updated: {
    order: (sql) => sql`i.updated_at DESC, i.id DESC`,
    values: (row) => [row.k_at],
    parts: (sql, [at]) => [{ expr: () => sql`i.updated_at`, value: () => timestampParamSql(sql, String(at)), dir: "desc" }],
    kinds: ["timestamp"]
  },
  created: {
    order: (sql) => sql`i.created_at DESC, i.id DESC`,
    values: (row) => [row.k_created],
    parts: (sql, [at]) => [{ expr: () => sql`i.created_at`, value: () => timestampParamSql(sql, String(at)), dir: "desc" }],
    kinds: ["timestamp"]
  },
  title: {
    order: (sql) => sql`lower(public.immutable_unaccent(i.title)) COLLATE "C" ASC, i.id ASC`,
    values: (row) => [row.k_title],
    parts: (sql, [title]) => [
      { expr: () => sql`lower(public.immutable_unaccent(i.title)) COLLATE "C"`, value: () => sql`${String(title)}::text COLLATE "C"`, dir: "asc" }
    ],
    kinds: ["text"]
  },
  importance: {
    order: (sql) => sql`(CASE i.importance WHEN 'critical' THEN 3 WHEN 'important' THEN 2 ELSE 1 END) DESC, i.updated_at DESC, i.id DESC`,
    values: (row) => [row.k_importance, row.k_at],
    parts: (sql, [importance, at]) => [
      { expr: () => sql`(CASE i.importance WHEN 'critical' THEN 3 WHEN 'important' THEN 2 ELSE 1 END)`, value: () => sql`${Number(importance)}::int`, dir: "desc" },
      { expr: () => sql`i.updated_at`, value: () => timestampParamSql(sql, String(at)), dir: "desc" }
    ],
    kinds: ["integer", "timestamp"]
  },
  reviewBy: {
    order: (sql) => sql`coalesce(i.review_by, 'infinity'::date) ASC, i.id ASC`,
    values: (row) => [row.k_review],
    parts: (sql, [day]) => [{ expr: () => sql`coalesce(i.review_by, 'infinity'::date)`, value: () => sql`(${String(day)}::text)::date`, dir: "asc" }],
    kinds: ["date"]
  }
};

const idDirection = (sort: KnowledgeItemQuery["sort"]) => (sort === "title" || sort === "reviewBy" ? "asc" : "desc");

const validCursorValue = (kind: SortSpec["kinds"][number], value: unknown) => {
  if (kind === "timestamp") {
    return isCursorTimestamp(value);
  }
  if (kind === "integer") {
    return typeof value === "number" && Number.isSafeInteger(value);
  }
  if (kind === "date") {
    return typeof value === "string" && (value === "infinity" || /^\d{4}-\d{2}-\d{2}$/.test(value));
  }
  return typeof value === "string" && value.length <= 1000 && !value.includes("\u0000");
};

/** Items of a space the caller can read, filtered and sorted; retired items always come last. */
export const listItems = async (context: AccessContext, spaceId: string, query: KnowledgeItemQuery): Promise<KnowledgeItemPage> => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  const sql = getSql();
  const access = await assertSpaceAccess(sql, context, spaceId, "view", { intent: "read" });
  const sort = sorts[query.sort];
  let after: SqlFragment = sql`TRUE`;
  if (query.cursor) {
    const decoded = decodeCursor(query.cursor, 3 + sort.kinds.length);
    if (!decoded || decoded[0] !== query.sort || (decoded[1] !== 0 && decoded[1] !== 1)) {
      throw invalidCursor();
    }
    const values = decoded.slice(2, 2 + sort.kinds.length);
    const id = decoded[decoded.length - 1];
    if (!isUuid(id) || !sort.kinds.every((kind, index) => validCursorValue(kind, values[index]))) {
      throw invalidCursor();
    }
    after = keysetAfter(sql, [
      { expr: () => sql`(st.status_group = 'retired')::int`, value: () => sql`${Number(decoded[1])}::int`, dir: "asc" },
      ...sort.parts(sql, values),
      { expr: () => sql`i.id`, value: () => sql`${id}::uuid`, dir: idDirection(query.sort) }
    ]);
  }
  const statusIds = asArray(query.statusId);
  const groups = asArray(query.group);
  const importances = asArray(query.importance);
  const tags = asArray(query.tag);
  const tsQuery = query.q ? toPrefixTsQuery(query.q) : null;
  const like = query.q ? `%${escapeLike(query.q.toLowerCase())}%` : null;
  const today = businessDay();
  const rows = await sql<(ItemRow & SortRow & { k_retired: number })[]>`
    SELECT ${itemColumnsSql(sql)},
      (st.status_group = 'retired')::int AS k_retired,
      ${timestampTextSql(sql, () => sql`i.updated_at`)} AS k_at,
      ${timestampTextSql(sql, () => sql`i.created_at`)} AS k_created,
      lower(public.immutable_unaccent(i.title)) AS k_title,
      (CASE i.importance WHEN 'critical' THEN 3 WHEN 'important' THEN 2 ELSE 1 END) AS k_importance,
      coalesce(i.review_by, 'infinity'::date)::text AS k_review
    FROM knowledge.items i
    JOIN knowledge.statuses st ON st.id = i.status_id
    WHERE i.space_id = ${spaceId} AND i.organization_id = ${context.organization.id} AND i.deleted_at IS NULL
      AND ${seesAllDrafts(access.level) ? sql`TRUE` : sql`(st.status_group <> 'draft' OR i.created_by = ${context.user.id})`}
      ${
        query.categoryId
          ? sql`AND (i.category_id = ${query.categoryId} OR i.category_id IN (
              SELECT c.id FROM knowledge.categories c WHERE c.space_id = ${spaceId} AND c.parent_id = ${query.categoryId}
            ))`
          : sql``
      }
      ${query.uncategorized === "true" ? sql`AND i.category_id IS NULL` : query.uncategorized === "false" ? sql`AND i.category_id IS NOT NULL` : sql``}
      ${statusIds ? sql`AND i.status_id = ANY(${statusIds}::uuid[])` : sql``}
      ${groups ? sql`AND st.status_group = ANY(${groups}::text[])` : sql``}
      ${importances ? sql`AND i.importance = ANY(${importances}::text[])` : sql``}
      ${tags ? sql`AND i.tags && ${normalizeTags(tags)}::text[]` : sql``}
      ${query.ownerId ? sql`AND i.owner_user_id = ${query.ownerId}` : sql``}
      ${query.pinned === "true" ? sql`AND i.pinned` : query.pinned === "false" ? sql`AND NOT i.pinned` : sql``}
      ${
        query.reviewDue === "true"
          ? sql`AND st.status_group = 'active' AND i.review_by <= (${today}::text)::date`
          : query.reviewDue === "false"
            ? sql`AND NOT (st.status_group = 'active' AND coalesce(i.review_by <= (${today}::text)::date, false))`
            : sql``
      }
      ${
        like
          ? sql`AND (
              ${tsQuery ? sql`i.search_vector @@ to_tsquery('simple', ${tsQuery})` : sql`FALSE`}
              OR public.immutable_unaccent(lower(i.title)) LIKE public.immutable_unaccent(${like})
            )`
          : sql``
      }
      AND ${after}
    ORDER BY (st.status_group = 'retired')::int ASC, ${sort.order(sql)}
    LIMIT ${query.limit + 1}
  `;
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  const hasMore = rows.length > query.limit;
  return {
    items: page.map((row) => toItemSummary(row, today)),
    pageInfo: {
      hasMore,
      nextCursor: hasMore && last ? encodeCursor([query.sort, Number(last.k_retired), ...sort.values(last), last.id]) : null
    }
  };
};

// Detail ----------------------------------------------------------------------------------------------

type DetailRow = ItemRow & {
  body_json: RichTextDoc;
  owner_user_id: string | null;
  attachments: AttachmentRow[];
  is_following: boolean;
  follower_count: number;
  category_name: string | null;
  category_parent_id: string | null;
  category_parent_name: string | null;
  space_name: string;
  space_color: string;
  space_visibility: "public" | "private";
  deleted_at: Date | null;
};

const presenceKey = (itemId: string) => `kb:editing:${itemId}`;
const presenceTtlMs = 60_000;
const recentSaveMinutes = 5;

const presenceHolders = async (itemId: string) => {
  const redis = getOptionalRedis();
  if (!redis) {
    return [];
  }
  try {
    return await redis.zrangebyscore(presenceKey(itemId), Date.now(), "+inf");
  } catch (error) {
    logger.warn({ err: error }, "Edit presence read failed");
    return [];
  }
};

/** Other people editing: holders of the edit presence and authors of a version saved in the last few minutes. */
const loadEditing = async (sql: QuerySql, context: AccessContext, itemId: string): Promise<UserRef[]> => {
  const holders = (await presenceHolders(itemId)).filter((id) => isUuid(id) && id !== context.user.id);
  const rows = await sql<{ user: UserRefJson }[]>`
    SELECT ${userJsonSql(sql)} AS user
    FROM public.app_users au
    WHERE au.id <> ${context.user.id} AND au.deleted_at IS NULL AND (
      au.id = ANY(${holders}::uuid[])
      OR au.id IN (
        SELECT v.author_user_id FROM knowledge.item_versions v
        WHERE v.item_id = ${itemId} AND v.created_at > now() - make_interval(mins => ${recentSaveMinutes})
      )
    )
    ORDER BY au.display_name, au.id
    LIMIT 20
  `;
  return rows.map((row) => toUserRef(row.user)!);
};

export const getItemDetail = async (context: AccessContext, itemId: string, sql: QuerySql = getSql()): Promise<KnowledgeItemDetail> => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  const { item, access } = await authorizeItem(sql, context, itemId, { trashed: "include", intent: "read" });
  const row = (
    await sql<DetailRow[]>`
      SELECT ${itemColumnsSql(sql)}, i.body_json, i.owner_user_id,
        ${attachmentsJsonSql(sql, sql`a.item_id = i.id AND a.purpose = 'item'`)} AS attachments,
        EXISTS (SELECT 1 FROM knowledge.followers f WHERE f.item_id = i.id AND f.user_id = ${context.user.id}) AS is_following,
        (SELECT count(*)::int FROM knowledge.followers f WHERE f.item_id = i.id) AS follower_count,
        c.name AS category_name, pc.id AS category_parent_id, pc.name AS category_parent_name,
        s.name AS space_name, s.color AS space_color, s.visibility AS space_visibility
      FROM knowledge.items i
      JOIN knowledge.statuses st ON st.id = i.status_id
      JOIN knowledge.spaces s ON s.id = i.space_id
      LEFT JOIN knowledge.categories c ON c.id = i.category_id
      LEFT JOIN knowledge.categories pc ON pc.id = c.parent_id
      WHERE i.id = ${itemId} AND i.organization_id = ${context.organization.id}
    `
  )[0];
  if (!row) {
    throw new AppError("KNOWLEDGE_ITEM_NOT_FOUND", "Không tìm thấy mục tri thức.", 404);
  }
  const [statuses, editing] = await Promise.all([loadStatuses(sql, item.space_id), loadEditing(sql, context, itemId)]);
  const deleted = row.deleted_at !== null;
  // Approval on: published items (active / retired) are for managers only (PD-031 addendum). An archived space is
  // read-only for everyone: no edit, status, trash / restore, comment or file deletion.
  const editable = canEditItem(access.level, access.approvalRequired, row.status_group) && !access.archived;
  const canEdit = editable && !deleted;
  const today = businessDay();
  return {
    ...toItemSummary(row, today),
    body: row.body_json,
    attachments: (row.attachments ?? []).map((attachment) =>
      toKnowledgeAttachment(
        attachment,
        !deleted && !access.archived && (access.level === "manage" || (attachment.uploaded_by?.id === context.user.id && canEdit))
      )
    ),
    isFollowing: row.is_following,
    followerCount: Number(row.follower_count),
    category: row.category_id
      ? {
          id: row.category_id,
          name: row.category_name ?? "",
          parent: row.category_parent_id ? { id: row.category_parent_id, name: row.category_parent_name ?? "" } : null
        }
      : null,
    space: { id: row.space_id, name: row.space_name, color: toColor(row.space_color, "blue"), visibility: row.space_visibility },
    editing,
    capabilities: {
      canEdit,
      canChangeStatus: canEdit,
      allowedStatusIds: canEdit
        ? allowedStatusIds(
            statuses.map(statusLike),
            access.approvalRequired,
            access.level,
            row.status_id
          )
        : [],
      canDelete: canEdit,
      canRestore: deleted && editable,
      canComment: !deleted && !access.archived,
      canViewHistory: canViewItemHistory(access.isMember, access.orgAdmin)
    },
    deletedAt: row.deleted_at ? toIso(row.deleted_at) : null
  };
};

// Create ----------------------------------------------------------------------------------------------

export const createItem = async (context: AccessContext, spaceId: string, input: CreateKnowledgeItemRequest): Promise<KnowledgeItemDetail> => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  const sql = getSql();
  const created = await sql.begin(async (tx) => {
    const access = await assertSpaceAccess(tx, context, spaceId, "submit");
    const statuses = await loadStatuses(tx, spaceId);
    const firstDraft = firstDraftStatus(statuses.map(statusLike));
    const status = input.statusId ? findStatus(statuses, input.statusId) : statuses.find((entry) => entry.id === firstDraft?.id);
    if (!status) {
      throw new AppError("KNOWLEDGE_STATUS_NOT_FOUND", "Kho chưa có trạng thái nháp.", 409);
    }
    assertStatusAllowed(access.approvalRequired, statusLike(status), access.level);
    const category = await assertCategoryInSpace(tx, spaceId, input.categoryId ?? null);
    const ownerId = input.ownerId ?? null;
    await assertOwnerCanRead(tx, context, access, ownerId);
    const body = await sanitizeItemBody(tx, context, access, input.body);
    // Images are files of the item itself: a new item has none yet (the editor saves a draft before the first upload).
    await assertBodyImages(tx, null, body.images);
    const tags = normalizeTags(input.tags);
    const summary = nullableText(input.summary) ?? null;
    const row = (
      await tx<{ id: string }[]>`
        INSERT INTO knowledge.items (
          organization_id, space_id, category_id, status_id, title, summary, body_json, body_text, importance, owner_user_id,
          tags, pinned, effective_from, review_by, version, mentioned_user_ids, created_by, updated_by
        ) VALUES (
          ${context.organization.id}, ${spaceId}, ${category?.id ?? null}, ${status.id}, ${input.title}, ${summary},
          ${tx.json(body.doc)}, ${body.text}, ${input.importance}, ${ownerId},
          ${tags}::text[], ${input.pinned}, (${input.effectiveFrom ?? null}::text)::date, (${input.reviewBy ?? null}::text)::date, 1,
          ${body.mentions}::uuid[], ${context.user.id}, ${context.user.id}
        )
        RETURNING id
      `
    )[0]!;
    await insertVersion(tx, context, {
      spaceId,
      itemId: row.id,
      number: 1,
      title: input.title,
      summary,
      body: body.doc,
      bodyText: body.text,
      note: null,
      restoredFrom: null
    });
    await auditFor(context)(tx, [
      {
        spaceId,
        itemId: row.id,
        itemTitle: input.title,
        action: "ITEM_CREATED",
        versionNumber: 1,
        after: {
          title: input.title,
          statusId: status.id,
          statusName: status.name,
          group: status.status_group,
          importance: input.importance,
          categoryId: category?.id ?? null,
          categoryName: category?.name ?? null,
          ownerId,
          tags
        }
      }
    ]);
    // Creator and owner follow the item (design §07).
    await followItem(tx, context, spaceId, row.id, [context.user.id, ownerId]);
    await enqueueDomainEvents(tx, [
      itemEvent(context, { spaceId, itemId: row.id }, {
        created: true,
        version: 1,
        newVersion: true,
        statusChanged: false,
        published: status.status_group === "active",
        approvalRequested: isApprovalRequest({
          approvalRequired: access.approvalRequired,
          level: access.level,
          target: statusLike(status),
          firstDraftId: firstDraft?.id ?? null
        }),
        statusName: status.name,
        statusGroup: status.status_group,
        importance: input.importance,
        mentionedUserIds: body.mentions.filter((id) => id !== context.user.id)
      })
    ]);
    return row.id;
  });
  publishKnowledge(spaceId, "item_created", { itemId: created, actorId: context.user.id, version: 1 });
  return await getItemDetail(context, created);
};

// Update ----------------------------------------------------------------------------------------------

const fieldsSnapshot = (item: ItemCore, ownerName: string | null) => ({
  ownerId: item.owner_user_id,
  ownerName,
  tags: item.tags,
  effectiveFrom: item.effective_from,
  reviewBy: item.review_by,
  pinned: item.pinned
});

const userName = async (sql: QuerySql, userId: string | null) =>
  userId ? ((await sql<{ display_name: string }[]>`SELECT display_name FROM public.app_users WHERE id = ${userId}`)[0]?.display_name ?? null) : null;

export const updateItem = async (context: AccessContext, itemId: string, input: UpdateKnowledgeItemRequest): Promise<KnowledgeItemDetail> => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  const sql = getSql();
  const outcome = await sql.begin(async (tx) => {
    const { item, access } = await authorizeItem(tx, context, itemId, { required: "submit", lock: true });
    assertItemEditable(access.level, access.approvalRequired, item.status_group);
    const contentTouched = input.title !== undefined || input.summary !== undefined || input.body !== undefined;
    const versionCheck = checkExpectedVersion(contentTouched, input.expectedVersion, Number(item.version));
    if (versionCheck === "missing") {
      throw new AppError("KNOWLEDGE_EXPECTED_VERSION_REQUIRED", "Thiếu số phiên bản đang sửa (expectedVersion).", 400);
    }
    if (versionCheck === "conflict") {
      throw await versionConflict(tx, itemId, Number(item.version));
    }
    const nextImportance = input.importance ?? item.importance;

    // Status (approval step).
    const statuses = await loadStatuses(tx, item.space_id);
    const currentStatus = findStatus(statuses, item.status_id);
    const nextStatus = input.statusId !== undefined && input.statusId !== item.status_id ? findStatus(statuses, input.statusId) : null;
    if (nextStatus) {
      assertStatusAllowed(access.approvalRequired, statusLike(nextStatus), access.level);
    }

    // Content.
    const body = input.body !== undefined ? await sanitizeItemBody(tx, context, access, input.body) : null;
    if (body) {
      await assertBodyImages(tx, itemId, body.images);
    }
    const current = (
      await tx<{ body_json: RichTextDoc; body_text: string }[]>`SELECT body_json, body_text FROM knowledge.items WHERE id = ${itemId}`
    )[0]!;
    const nextTitle = input.title ?? item.title;
    const nextSummary = input.summary !== undefined ? (nullableText(input.summary) ?? null) : item.summary;
    const titleChanged = nextTitle !== item.title;
    const summaryChanged = nextSummary !== item.summary;
    const bodyChanged = body !== null && canonicalJson(body.doc) !== canonicalJson(current.body_json);
    const newVersion = titleChanged || summaryChanged || bodyChanged;
    const version = newVersion ? Number(item.version) + 1 : Number(item.version);

    // Fields.
    const categoryChanged = input.categoryId !== undefined && input.categoryId !== item.category_id;
    const category = categoryChanged ? await assertCategoryInSpace(tx, item.space_id, input.categoryId ?? null) : null;
    const ownerChanged = input.ownerId !== undefined && input.ownerId !== item.owner_user_id;
    const ownerName = ownerChanged ? await assertOwnerCanRead(tx, context, access, input.ownerId ?? null) : null;
    const tags = input.tags !== undefined ? normalizeTags(input.tags) : item.tags;
    const tagsChanged = !sameStringSet(tags, item.tags);
    const effectiveChanged = input.effectiveFrom !== undefined && input.effectiveFrom !== item.effective_from;
    const reviewChanged = input.reviewBy !== undefined && input.reviewBy !== item.review_by;
    const pinnedChanged = input.pinned !== undefined && input.pinned !== item.pinned;
    const importanceChanged = nextImportance !== item.importance;
    const fieldsChanged = ownerChanged || tagsChanged || effectiveChanged || reviewChanged || pinnedChanged;
    const anyChange = newVersion || nextStatus !== null || categoryChanged || importanceChanged || fieldsChanged;
    if (!anyChange) {
      return { spaceId: item.space_id, changed: false, version };
    }
    const reason = resolveReason(reasonRequired(item.importance, nextImportance), input.reason);

    const mentions = body ? body.mentions : item.mentioned_user_ids;
    await tx`
      UPDATE knowledge.items
      SET title = ${nextTitle}, summary = ${nextSummary},
          body_json = ${body ? tx.json(body.doc) : tx`body_json`},
          body_text = ${body ? body.text : tx`body_text`},
          mentioned_user_ids = ${mentions}::uuid[],
          version = ${version},
          status_id = ${nextStatus?.id ?? item.status_id},
          category_id = ${categoryChanged ? (category?.id ?? null) : item.category_id},
          importance = ${nextImportance},
          owner_user_id = ${ownerChanged ? (input.ownerId ?? null) : item.owner_user_id},
          tags = ${tags}::text[],
          effective_from = (${effectiveChanged ? (input.effectiveFrom ?? null) : item.effective_from}::text)::date,
          review_by = (${reviewChanged ? (input.reviewBy ?? null) : item.review_by}::text)::date,
          pinned = ${input.pinned ?? item.pinned},
          updated_at = now(), updated_by = ${context.user.id}
      WHERE id = ${itemId}
    `;
    if (newVersion) {
      await insertVersion(tx, context, {
        spaceId: item.space_id,
        itemId,
        number: version,
        title: nextTitle,
        summary: nextSummary,
        body: body?.doc ?? current.body_json,
        bodyText: body?.text ?? current.body_text,
        note: nullableText(input.versionNote) ?? null,
        restoredFrom: null
      });
    }

    const base = { spaceId: item.space_id, itemId, itemTitle: nextTitle, reason };
    const audits: AuditInput[] = [];
    if (newVersion) {
      audits.push({
        ...base,
        action: "ITEM_CONTENT_UPDATED",
        versionNumber: version,
        before: { version: Number(item.version), ...(titleChanged ? { title: item.title } : {}) },
        after: {
          version,
          ...(titleChanged ? { title: nextTitle } : {}),
          changed: [titleChanged && "title", summaryChanged && "summary", bodyChanged && "body"].filter(Boolean),
          note: nullableText(input.versionNote) ?? null
        }
      });
    }
    if (nextStatus) {
      audits.push({
        ...base,
        action: "ITEM_STATUS_CHANGED",
        before: { statusId: currentStatus.id, statusName: currentStatus.name, group: currentStatus.status_group },
        after: { statusId: nextStatus.id, statusName: nextStatus.name, group: nextStatus.status_group }
      });
    }
    if (importanceChanged) {
      audits.push({ ...base, action: "ITEM_IMPORTANCE_CHANGED", before: { importance: item.importance }, after: { importance: nextImportance } });
    }
    if (categoryChanged) {
      const previous = await assertCategoryInSpace(tx, item.space_id, item.category_id).catch(() => null);
      audits.push({
        ...base,
        action: "ITEM_MOVED",
        before: { categoryId: item.category_id, categoryName: previous?.name ?? null },
        after: { categoryId: category?.id ?? null, categoryName: category?.name ?? null }
      });
    }
    if (fieldsChanged) {
      const beforeFields = fieldsSnapshot(item, await userName(tx, item.owner_user_id));
      const afterFields = {
        ownerId: ownerChanged ? (input.ownerId ?? null) : item.owner_user_id,
        ownerName: ownerChanged ? ownerName : beforeFields.ownerName,
        tags,
        effectiveFrom: effectiveChanged ? (input.effectiveFrom ?? null) : item.effective_from,
        reviewBy: reviewChanged ? (input.reviewBy ?? null) : item.review_by,
        pinned: input.pinned ?? item.pinned
      };
      const keys = [
        ...(ownerChanged ? ["ownerId", "ownerName"] : []),
        ...(tagsChanged ? ["tags"] : []),
        ...(effectiveChanged ? ["effectiveFrom"] : []),
        ...(reviewChanged ? ["reviewBy"] : []),
        ...(pinnedChanged ? ["pinned"] : [])
      ] as (keyof typeof afterFields)[];
      audits.push({
        ...base,
        action: "ITEM_FIELDS_UPDATED",
        before: Object.fromEntries(keys.map((key) => [key, beforeFields[key]])),
        after: Object.fromEntries(keys.map((key) => [key, afterFields[key]]))
      });
    }
    await auditFor(context)(tx, audits);
    if (ownerChanged && input.ownerId) {
      await followItem(tx, context, item.space_id, itemId, [input.ownerId]);
    }

    const finalStatus = nextStatus ?? currentStatus;
    const firstDraft = firstDraftStatus(statuses.map(statusLike));
    const addedMentions = body ? newlyMentioned(body.mentions, item.mentioned_user_ids).filter((id) => id !== context.user.id) : [];
    if (newVersion || nextStatus || addedMentions.length > 0 || importanceChanged) {
      await enqueueDomainEvents(tx, [
        itemEvent(context, { spaceId: item.space_id, itemId }, {
          created: false,
          version,
          newVersion,
          statusChanged: nextStatus !== null,
          published: nextStatus !== null && nextStatus.status_group === "active" && currentStatus.status_group !== "active",
          approvalRequested:
            nextStatus !== null &&
            isApprovalRequest({
              approvalRequired: access.approvalRequired,
              level: access.level,
              target: statusLike(nextStatus),
              firstDraftId: firstDraft?.id ?? null
            }),
          statusName: finalStatus.name,
          statusGroup: finalStatus.status_group,
          importance: nextImportance,
          mentionedUserIds: addedMentions
        })
      ]);
    }
    return { spaceId: item.space_id, changed: true, version };
  });
  if (outcome.changed) {
    publishKnowledge(outcome.spaceId, "item_updated", { itemId, actorId: context.user.id, version: outcome.version });
  }
  return await getItemDetail(context, itemId);
};

// Trash -----------------------------------------------------------------------------------------------

export const deleteItem = async (context: AccessContext, itemId: string, input: { reason?: string | undefined }) => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  const sql = getSql();
  const outcome = await sql.begin(async (tx) => {
    const { item, access } = await authorizeItem(tx, context, itemId, { required: "submit", lock: true });
    assertItemEditable(access.level, access.approvalRequired, item.status_group);
    const reason = resolveReason(reasonRequired(item.importance), input.reason);
    await tx`UPDATE knowledge.items SET deleted_at = now(), deleted_by = ${context.user.id} WHERE id = ${itemId}`;
    await auditFor(context)(tx, [
      { spaceId: item.space_id, itemId, itemTitle: item.title, action: "ITEM_DELETED", reason, before: { statusName: item.status_name, importance: item.importance } }
    ]);
    return { spaceId: item.space_id };
  });
  await clearPresence(itemId);
  publishKnowledge(outcome.spaceId, "item_deleted", { itemId, actorId: context.user.id });
  return { ok: true as const };
};

export const restoreItem = async (context: AccessContext, itemId: string, input: { reason?: string | undefined }) => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  const sql = getSql();
  const outcome = await sql.begin(async (tx) => {
    const { item, access } = await authorizeItem(tx, context, itemId, { required: "submit", lock: true, trashed: "only" });
    assertItemEditable(access.level, access.approvalRequired, item.status_group);
    const reason = resolveReason(reasonRequired(item.importance), input.reason);
    // Back into its category (moved to the parent / out of any category if that was deleted meanwhile).
    await tx`UPDATE knowledge.items SET deleted_at = NULL, deleted_by = NULL, updated_at = now(), updated_by = ${context.user.id} WHERE id = ${itemId}`;
    await auditFor(context)(tx, [{ spaceId: item.space_id, itemId, itemTitle: item.title, action: "ITEM_RESTORED", reason }]);
    return { spaceId: item.space_id, version: Number(item.version) };
  });
  publishKnowledge(outcome.spaceId, "item_restored", { itemId, actorId: context.user.id, version: outcome.version });
  return await getItemDetail(context, itemId);
};

/** Permanent deletion (knowledge.delete + manage, trashed items only). The audit log keeps every entry. */
export const purgeItem = async (context: AccessContext, itemId: string, input: { reason?: string | undefined }) => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  requireKnowledgePermission(context, Permission.KnowledgeDelete);
  const sql = getSql();
  const outcome = await sql.begin(async (tx) => {
    const { item } = await authorizeItem(tx, context, itemId, { required: "manage", lock: true, trashed: "only" });
    const reason = resolveReason(reasonRequired(item.importance), input.reason);
    const paths = await tx<{ storage_path: string }[]>`SELECT storage_path FROM knowledge.item_attachments WHERE item_id = ${itemId}`;
    await auditFor(context)(tx, [
      {
        spaceId: item.space_id,
        itemId,
        itemTitle: item.title,
        action: "ITEM_PURGED",
        reason,
        before: { title: item.title, version: Number(item.version), importance: item.importance, statusName: item.status_name }
      }
    ]);
    await tx`DELETE FROM knowledge.items WHERE id = ${itemId}`;
    await tx`
      DELETE FROM public.notifications
      WHERE organization_id = ${context.organization.id} AND type LIKE 'knowledge.%' AND payload->>'knowledgeItemId' = ${itemId}
    `;
    return { spaceId: item.space_id, paths: paths.map((row) => row.storage_path) };
  });
  if (outcome.paths.length > 0) {
    removeObjects(outcome.paths).catch((error: unknown) => logger.warn({ err: error, itemId }, "Knowledge attachment cleanup after purge failed"));
  }
  publishKnowledge(outcome.spaceId, "item_deleted", { itemId, actorId: context.user.id });
  return { ok: true as const };
};

export const listTrash = async (context: AccessContext, spaceId: string, query: { cursor?: string | undefined; limit: number }) => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  const sql = getSql();
  const access = await assertSpaceAccess(sql, context, spaceId, "submit", { intent: "read" });
  const cursor = decodeTimeCursor(query.cursor);
  const rows = await sql<(ItemRow & { deleted_by_user: UserRefJson | null; cursor_at: string; deleted_at: Date })[]>`
    SELECT ${itemColumnsSql(sql)}, ${timestampTextSql(sql, () => sql`i.deleted_at`)} AS cursor_at,
      (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = i.deleted_by) AS deleted_by_user
    FROM knowledge.items i
    JOIN knowledge.statuses st ON st.id = i.status_id
    WHERE i.space_id = ${spaceId} AND i.organization_id = ${context.organization.id} AND i.deleted_at IS NOT NULL
      ${cursor ? sql`AND (i.deleted_at, i.id) < (${timestampParamSql(sql, cursor.at)}, ${cursor.id}::uuid)` : sql``}
    ORDER BY i.deleted_at DESC, i.id DESC
    LIMIT ${query.limit + 1}
  `;
  const canPurge = !access.archived && access.level === "manage" && knowledgePermissionFlags(context).delete;
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  const hasMore = rows.length > query.limit;
  const items: KnowledgeTrashedItem[] = page.map((row) => ({
    ...toItemSummary(row),
    deletedAt: toIso(row.deleted_at),
    deletedBy: toUserRef(row.deleted_by_user),
    purgeAt: toIso(new Date(new Date(row.deleted_at).getTime() + knowledgeLimits.trashRetentionDays * 86_400_000)),
    canRestore: !access.archived && canEditItem(access.level, access.approvalRequired, row.status_group),
    canPurge
  }));
  return { items, pageInfo: { hasMore, nextCursor: hasMore && last ? encodeTimeCursor(last.cursor_at, last.id) : null } };
};

// Versions & history ------------------------------------------------------------------------------------

const assertHistoryAccess = (access: SpaceAccess) => {
  if (!canViewItemHistory(access.isMember, access.orgAdmin)) {
    throw forbidden("Lịch sử và các phiên bản chỉ dành cho thành viên của kho.");
  }
};

type VersionRow = {
  id: string;
  number: number;
  title: string;
  note: string | null;
  author: UserRefJson | null;
  restored_from: number | null;
  created_at: Date;
};

const toVersionSummary = (row: VersionRow) => ({
  number: Number(row.number),
  title: row.title,
  note: row.note,
  author: toUserRef(row.author),
  restoredFrom: row.restored_from === null ? null : Number(row.restored_from),
  createdAt: toIso(row.created_at)
});

const versionColumns = (sql: QuerySql) => sql`
  v.id, v.number, v.title, v.note, v.restored_from, v.created_at,
  (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = v.author_user_id) AS author
`;

export const listVersions = async (context: AccessContext, itemId: string, query: { cursor?: string | undefined; limit: number }) => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  const sql = getSql();
  const { access } = await authorizeItem(sql, context, itemId, { trashed: "include", intent: "read" });
  assertHistoryAccess(access);
  const cursor = decodeKeysetCursor(query.cursor, "version", "integer");
  const rows = await sql<VersionRow[]>`
    SELECT ${versionColumns(sql)} FROM knowledge.item_versions v
    WHERE v.item_id = ${itemId} ${cursor ? sql`AND v.number < ${Number(cursor.value)}` : sql``}
    ORDER BY v.number DESC
    LIMIT ${query.limit + 1}
  `;
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  const hasMore = rows.length > query.limit;
  return {
    items: page.map(toVersionSummary),
    pageInfo: { hasMore, nextCursor: hasMore && last ? encodeKeysetCursor("version", Number(last.number), last.id) : null }
  };
};

const loadVersion = async (sql: QuerySql, itemId: string, number: number) => {
  const row = (
    await sql<(VersionRow & { summary: string | null; body_json: RichTextDoc })[]>`
      SELECT ${versionColumns(sql)}, v.summary, v.body_json FROM knowledge.item_versions v WHERE v.item_id = ${itemId} AND v.number = ${number}
    `
  )[0];
  if (!row) {
    throw new AppError("KNOWLEDGE_VERSION_NOT_FOUND", "Không tìm thấy phiên bản này.", 404);
  }
  return row;
};

export const getVersion = async (context: AccessContext, itemId: string, number: number) => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  const sql = getSql();
  const { access } = await authorizeItem(sql, context, itemId, { trashed: "include", intent: "read" });
  assertHistoryAccess(access);
  const row = await loadVersion(sql, itemId, number);
  return { ...toVersionSummary(row), summary: row.summary, body: row.body_json };
};

/** Restoring an old version writes a new version with its content (the old one is never overwritten). */
export const restoreVersion = async (context: AccessContext, itemId: string, number: number, input: { reason?: string | undefined }) => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  const sql = getSql();
  const outcome = await sql.begin(async (tx) => {
    const { item, access } = await authorizeItem(tx, context, itemId, { required: "submit", lock: true });
    assertItemEditable(access.level, access.approvalRequired, item.status_group);
    const reason = resolveReason(reasonRequired(item.importance), input.reason);
    const source = await loadVersion(tx, itemId, number);
    if (Number(source.number) === Number(item.version)) {
      throw new AppError("KNOWLEDGE_VERSION_CURRENT", "Đây đã là phiên bản hiện tại.", 409);
    }
    // Mentions are re-checked: people who can no longer read the space become plain text.
    const body = await sanitizeItemBody(tx, context, access, source.body_json);
    // The source version uses its images, so they are still in storage (also when hidden from the list).
    await assertBodyImages(tx, itemId, body.images);
    const version = Number(item.version) + 1;
    await tx`
      UPDATE knowledge.items
      SET title = ${source.title}, summary = ${source.summary}, body_json = ${tx.json(body.doc)},
          body_text = ${body.text}, mentioned_user_ids = ${body.mentions}::uuid[], version = ${version},
          updated_at = now(), updated_by = ${context.user.id}
      WHERE id = ${itemId}
    `;
    await insertVersion(tx, context, {
      spaceId: item.space_id,
      itemId,
      number: version,
      title: source.title,
      summary: source.summary,
      body: body.doc,
      bodyText: body.text,
      note: `Khôi phục từ phiên bản ${number}`,
      restoredFrom: Number(source.number)
    });
    await auditFor(context)(tx, [
      {
        spaceId: item.space_id,
        itemId,
        itemTitle: source.title,
        action: "VERSION_RESTORED",
        versionNumber: version,
        reason,
        before: { version: Number(item.version), title: item.title },
        after: { version, restoredFrom: Number(source.number), title: source.title }
      }
    ]);
    await enqueueDomainEvents(tx, [
      itemEvent(context, { spaceId: item.space_id, itemId }, {
        created: false,
        version,
        newVersion: true,
        restoredFrom: Number(source.number),
        statusChanged: false,
        published: false,
        approvalRequested: false,
        statusName: item.status_name,
        statusGroup: item.status_group,
        importance: item.importance,
        mentionedUserIds: []
      })
    ]);
    return { spaceId: item.space_id, version };
  });
  publishKnowledge(outcome.spaceId, "item_updated", { itemId, actorId: context.user.id, version: outcome.version });
  return await getItemDetail(context, itemId);
};

/** Per-item history (members and org admins). Deleted comments' text stays visible to managers only. */
export const listItemHistory = async (context: AccessContext, itemId: string, query: { cursor?: string | undefined; limit: number }) => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  const sql = getSql();
  const { access } = await authorizeItem(sql, context, itemId, { trashed: "include", intent: "read" });
  assertHistoryAccess(access);
  const cursor = decodeTimeCursor(query.cursor);
  const rows = await sql<(AuditRow & { cursor_at: string })[]>`
    SELECT ${auditColumnsSql(sql)}, ${timestampTextSql(sql, () => sql`l.created_at`)} AS cursor_at
    FROM knowledge.audit_log l
    WHERE l.item_id = ${itemId} AND l.space_id = ${access.spaceId}
      ${cursor ? sql`AND (l.created_at, l.id) < (${timestampParamSql(sql, cursor.at)}, ${cursor.id}::uuid)` : sql``}
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT ${query.limit + 1}
  `;
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  const hasMore = rows.length > query.limit;
  return {
    items: page.map((row) => toAuditEntry(row, { redactDeletedComments: access.level !== "manage" })),
    pageInfo: { hasMore, nextCursor: hasMore && last ? encodeTimeCursor(last.cursor_at, last.id) : null }
  };
};

// Follow & presence -------------------------------------------------------------------------------------

const followState = async (sql: QuerySql, context: AccessContext, itemId: string) => {
  const row = (
    await sql<{ following: boolean; count: number }[]>`
      SELECT EXISTS (SELECT 1 FROM knowledge.followers WHERE item_id = ${itemId} AND user_id = ${context.user.id}) AS following,
        (SELECT count(*)::int FROM knowledge.followers WHERE item_id = ${itemId}) AS count
    `
  )[0];
  return { isFollowing: row?.following ?? false, followerCount: Number(row?.count ?? 0) };
};

export const setFollowing = async (context: AccessContext, itemId: string, following: boolean) => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  const sql = getSql();
  const { item } = await authorizeItem(sql, context, itemId);
  if (following) {
    await followItem(sql, context, item.space_id, itemId, [context.user.id]);
  } else {
    await sql`DELETE FROM knowledge.followers WHERE item_id = ${itemId} AND user_id = ${context.user.id}`;
  }
  return await followState(sql, context, itemId);
};

const clearPresence = async (itemId: string) => {
  try {
    await getOptionalRedis()?.del(presenceKey(itemId));
  } catch (error) {
    logger.warn({ err: error }, "Edit presence cleanup failed");
  }
};

/** Edit presence heartbeat ("X đang sửa mục này"); expires after 60 s without a heartbeat. */
export const setEditing = async (context: AccessContext, itemId: string, editing: boolean) => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  const sql = getSql();
  // Leaving the editor (editing: false) only drops the presence: allowed after the space was archived meanwhile.
  const { item, access } = await authorizeItem(sql, context, itemId, { required: "submit", intent: editing ? "write" : "read" });
  if (editing) {
    assertItemEditable(access.level, access.approvalRequired, item.status_group);
  }
  const redis = getOptionalRedis();
  let changed = false;
  if (redis) {
    const key = presenceKey(itemId);
    try {
      const now = Date.now();
      if (editing) {
        const before = await redis.zscore(key, context.user.id);
        await redis.zadd(key, now + presenceTtlMs, context.user.id);
        changed = before === null || Number(before) < now;
      } else {
        changed = (await redis.zrem(key, context.user.id)) > 0;
      }
      await redis.zremrangebyscore(key, "-inf", now);
      await redis.pexpire(key, presenceTtlMs * 2);
    } catch (error) {
      logger.warn({ err: error }, "Edit presence update failed");
    }
  }
  if (changed) {
    publishKnowledge(item.space_id, "item_updated", { itemId, actorId: context.user.id, version: null });
  }
  return { editing: await loadEditing(sql, context, itemId) };
};

