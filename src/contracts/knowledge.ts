import { z } from "zod";

import { createCursorPageSchema } from "./pagination.js";
import { RichTextDocSchema } from "./rich-text.js";
import { hasBidiControls, hasControlCharacters, IsoDateInputSchema, SafeLineSchema, SafeMultilineSchema, SafeSearchSchema } from "./schemas.js";
import {
  AttachmentSchema,
  ColorTokenSchema,
  PlacementSchema,
  ProjectAccessLevelSchema,
  ProjectIconSchema,
  ProjectVisibilitySchema,
  UserRefSchema
} from "./work.js";

/**
 * Knowledge base ("Kho tri thức") contract — design: docs/product/kho-tri-thuc.html, decisions PD-031.
 *
 * Spaces are public or private like projects, with members at view / submit / manage (same words as projects:
 * Chỉ xem / Thành viên / Quản lý). Public spaces: everyone with `knowledge.view` reads and comments; editing
 * needs membership (submit+). Items live in at most 2 levels of categories, have one of 3 importance levels
 * and a status from the space's own list (each status belongs to a fixed group). Every change is written to an
 * append-only audit log; every content save is a numbered, immutable version.
 *
 * Endpoints (all under /api/v1; every one needs `knowledge.view`; "read" = public space, membership or org admin):
 *   GET    /knowledge/spaces                                → KnowledgeSpaceCollection (live spaces in sidebar order, then the
 *                                                            archived ones the caller is a member of — org admins: all —
 *                                                            with archivedAt set; the sidebar shows live ones only)
 *   GET    /knowledge/spaces/archived                       → KnowledgeSpaceCollection (knowledge.delete + manage)
 *   POST   /knowledge/spaces                                → KnowledgeSpaceDetail 201 (knowledge.create; creator = manager)
 *   GET    /knowledge/spaces/:spaceId                       → KnowledgeSpaceDetail (read)
 *   PATCH  /knowledge/spaces/:spaceId                       → KnowledgeSpaceDetail (knowledge.update + manage)
 *   POST   /knowledge/spaces/:spaceId/archive | /restore    → { ok } | KnowledgeSpaceDetail (knowledge.delete + manage)
 *   DELETE /knowledge/spaces/:spaceId                       → { ok } (knowledge.delete + manage; hidden for good, audit kept,
 *                                                            last entry SPACE_DELETED)
 *   GET    /knowledge/spaces/:spaceId/members               → KnowledgeMemberCollection (read)
 *   POST   /knowledge/spaces/:spaceId/members               → KnowledgeMember (knowledge.manage_members + manage)
 *   PATCH  /knowledge/spaces/:spaceId/members/:userId       → KnowledgeMember (same)
 *   DELETE /knowledge/spaces/:spaceId/members/:userId       → { ok } (same; the last manager cannot leave)
 *   PUT    /knowledge/spaces/:spaceId/statuses              → KnowledgeSpaceDetail (knowledge.update + manage)
 *   POST   /knowledge/spaces/:spaceId/categories            → KnowledgeCategory 201 (knowledge.update + manage)
 *   PATCH  /knowledge/spaces/:spaceId/categories/:id        → KnowledgeCategory (rename, move, reorder via placement)
 *   DELETE /knowledge/spaces/:spaceId/categories/:id        → { ok } (items move to the parent; sub-categories to the top)
 *   GET    /knowledge/spaces/:spaceId/items                 → KnowledgeItemPage (KnowledgeItemQuerySchema; drafts only submit+)
 *   POST   /knowledge/spaces/:spaceId/items                 → KnowledgeItemDetail 201 (submit+)
 *   GET    /knowledge/spaces/:spaceId/trash                 → KnowledgeTrashPage (submit+; KnowledgePageQuerySchema)
 *   GET    /knowledge/spaces/:spaceId/audit                 → KnowledgeAuditPage (manage / org admin; KnowledgeAuditQuerySchema)
 *   GET    /knowledge/spaces/:spaceId/audit/export          → .xlsx (same filters, KnowledgeAuditExportQuerySchema)
 *   GET    /knowledge/items/:itemId                         → KnowledgeItemDetail (trashed items: submit+, deletedAt set)
 *   PATCH  /knowledge/items/:itemId                         → KnowledgeItemDetail (submit+; 409 KNOWLEDGE_VERSION_CONFLICT)
 *   DELETE /knowledge/items/:itemId        body Reason      → { ok } (submit+; to the space trash, kept 30 days)
 *   POST   /knowledge/items/:itemId/restore body Reason     → KnowledgeItemDetail (submit+)
 *   POST   /knowledge/items/:itemId/purge  body Reason      → { ok } (knowledge.delete + manage; trashed items only)
 *   POST   /knowledge/items/:itemId/editing                 → KnowledgeEditingState (submit+; presence heartbeat ≤ 60 s)
 *   GET    /knowledge/items/:itemId/versions                → KnowledgeVersionPage (canViewHistory; newest first)
 *   GET    /knowledge/items/:itemId/versions/:number        → KnowledgeVersion (canViewHistory)
 *   POST   /knowledge/items/:itemId/versions/:number/restore body Reason → KnowledgeItemDetail (submit+; new version)
 *   GET    /knowledge/items/:itemId/history                 → KnowledgeAuditPage (canViewHistory; newest first)
 *   POST   /knowledge/items/:itemId/follow  | DELETE        → KnowledgeFollowState (read)
 *   GET    /knowledge/items/:itemId/comments                → KnowledgeCommentPage (root comments, newest first)
 *   GET    /knowledge/items/:itemId/comments/:id/replies    → KnowledgeCommentPage (oldest first)
 *   POST   /knowledge/items/:itemId/comments                → KnowledgeComment 201 (read = canComment)
 *   PATCH  /knowledge/items/:itemId/comments/:id            → KnowledgeComment (author)
 *   DELETE /knowledge/items/:itemId/comments/:id            → { ok } (author, or space manager — audit keeps the text)
 *   POST   /knowledge/items/:itemId/comments/:id/resolve    → KnowledgeComment (root comments; submit+, owner or author)
 *   POST   /knowledge/items/:itemId/attachments             → UploadTicket 201 (work.ts CreateUploadRequestSchema)
 *   POST   /knowledge/attachments/:attachmentId/complete    → KnowledgeAttachment (CompleteKnowledgeUploadRequestSchema)
 *   POST   /knowledge/attachments/urls                      → AttachmentUrlCollection (work.ts AttachmentUrlRequestSchema;
 *                                                            readers of the item; also body images hidden from the list)
 *   DELETE /knowledge/attachments/:attachmentId             → { ok } (uploader who may edit the item, or manager)
 * Errors carry `error.details` for KNOWLEDGE_VERSION_CONFLICT (KnowledgeVersionConflictSchema). Global search
 * (`GET /search`, group "knowledge") and the realtime room `knowledge:<spaceId>` (event `knowledge:changed`) are
 * described in search.ts / realtime.ts.
 *
 * Owner decisions 2026-10-11 (PD-031 addendum):
 *   - Approval step on ⇒ published items (status group active or retired) are changed only by space managers / org
 *     admins: content, fields, importance, status, tags, category, files, trash / restore, version restore and edit
 *     presence answer 403 KNOWLEDGE_PUBLISHED_LOCKED to members (submit), who still create items, edit drafts,
 *     comment and follow. Item capabilities reflect it. Approval off: unchanged.
 *   - Item bodies (create, update, version restore) use the "knowledge" rich-text profile: tables and images
 *     (rich-text.ts knowledgeBodySpec / knowledgeBodyLimits / sanitizeKnowledgeBody). Comments keep the shared schema.
 *     Every image.attachmentId must be a completed image file (PNG, JPEG, GIF, WebP, AVIF) of the same item, uploaded
 *     with POST /knowledge/items/:itemId/attachments and completed with target "item" — so a new item is saved (as a
 *     draft) before its first image; otherwise 400 KNOWLEDGE_IMAGE_INVALID. Files used by any version body are never
 *     removed from storage while the item exists: deleting one only hides it from `attachments` (old versions keep
 *     rendering it, /attachments/urls still signs it, and saving a body that still uses it stays valid).
 *     Render images by collecting the attachmentIds of the body and asking POST /knowledge/attachments/urls.
 *
 * Archived spaces (2026-10-11): read-only, and only for their members and org admins — a public archived space no
 * longer opens for the rest of the company, and archived spaces stay out of search and the inbox. Reads work as
 * usual (space detail, members, items, item pages, versions, history, comments, file URLs, trash list, and the
 * space log / export for managers); every write answers 409 KNOWLEDGE_SPACE_ARCHIVED (Vietnamese message) — items,
 * comments, follows, uploads, settings, members, statuses, categories, purge. Capabilities say so: everything false
 * except canRead, canViewAudit (managers) and canArchive (manage + knowledge.delete: restore / delete the space).
 * Item capabilities: canEdit / canChangeStatus / canDelete / canRestore / canComment false, allowedStatusIds [].
 */

const Id = z.string().uuid();
const IsoDate = z.string().datetime({ offset: true });
/** Calendar day "YYYY-MM-DD" (effective date, review date). */
const DayInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const atLeastOneField = (value: Record<string, unknown>) => Object.values(value).some((entry) => entry !== undefined);

// Enums -------------------------------------------------------------------------------------------------------

export const KnowledgeVisibilitySchema = ProjectVisibilitySchema;
export const KnowledgeAccessLevelSchema = ProjectAccessLevelSchema;
export type KnowledgeAccessLevel = z.infer<typeof KnowledgeAccessLevelSchema>;

/** Fixed scale (PD-031): Bình thường / Quan trọng / Rất quan trọng. */
export const KnowledgeImportanceSchema = z.enum(["normal", "important", "critical"]);
export type KnowledgeImportance = z.infer<typeof KnowledgeImportanceSchema>;

/**
 * Status groups give custom statuses a meaning: draft = being written or awaiting approval (only the author and
 * members with submit+ see it); active = the official version (everyone who sees the space; searchable);
 * retired = no longer applies (visible with a warning, sorted last).
 */
export const KnowledgeStatusGroupSchema = z.enum(["draft", "active", "retired"]);
export type KnowledgeStatusGroup = z.infer<typeof KnowledgeStatusGroupSchema>;

export const knowledgeLimits = {
  tagsPerItem: 10,
  tagLength: 40,
  statusesPerSpace: 12,
  categoryDepth: 2,
  attachmentsPerItem: 30,
  /** Trashed items are purged automatically after this many days. */
  trashRetentionDays: 30,
  /** Reasons (critical items) need at least this many characters. */
  reasonMinLength: 3
} as const;

/** Item / comment file (same fields as task attachments, `itemId` instead of `taskId`). */
export const KnowledgeAttachmentSchema = AttachmentSchema.omit({ taskId: true }).extend({ itemId: Id });
export type KnowledgeAttachment = z.infer<typeof KnowledgeAttachmentSchema>;

/** POST /knowledge/attachments/:id/complete — "item" = file of the item, "comment" = file for a comment draft. */
export const CompleteKnowledgeUploadRequestSchema = z.object({ target: z.enum(["item", "comment"]).default("item") }).strict();

/** Cursor paging for versions, comments, history and the trash. */
export const KnowledgePageQuerySchema = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30)
});

// Statuses & categories ---------------------------------------------------------------------------------------

export const KnowledgeStatusSchema = z.object({
  id: Id,
  name: z.string(),
  color: ColorTokenSchema,
  group: KnowledgeStatusGroupSchema,
  position: z.number().int()
});
export type KnowledgeStatus = z.infer<typeof KnowledgeStatusSchema>;

/**
 * Replaces the whole status list of a space (manage). Existing ids keep their items; a removed status must name
 * where its items go (`reassign[removedId] = keptId`). At least one status per group.
 */
export const ReplaceKnowledgeStatusesRequestSchema = z
  .object({
    statuses: z
      .array(
        z
          .object({
            id: Id.optional(),
            name: SafeLineSchema(40),
            color: ColorTokenSchema,
            group: KnowledgeStatusGroupSchema
          })
          .strict()
      )
      .min(3)
      .max(knowledgeLimits.statusesPerSpace),
    reassign: z.record(Id, Id).default({})
  })
  .strict();
export type ReplaceKnowledgeStatusesRequest = z.infer<typeof ReplaceKnowledgeStatusesRequestSchema>;

export const KnowledgeCategorySchema = z.object({
  id: Id,
  parentId: Id.nullable(),
  name: z.string(),
  rank: z.string(),
  itemCount: z.number().int()
});
export type KnowledgeCategory = z.infer<typeof KnowledgeCategorySchema>;

export const CreateKnowledgeCategoryRequestSchema = z
  .object({ name: SafeLineSchema(80), parentId: Id.nullable().optional() })
  .strict();
export const UpdateKnowledgeCategoryRequestSchema = z
  .object({ name: SafeLineSchema(80).optional(), parentId: Id.nullable().optional(), placement: PlacementSchema.optional() })
  .strict()
  .refine(atLeastOneField, { message: "At least one field is required." });

// Spaces ------------------------------------------------------------------------------------------------------

export const KnowledgeSpaceCapabilitiesSchema = z.object({
  canRead: z.boolean(),
  canComment: z.boolean(),
  /**
   * submit+: create items, edit drafts; edit / change status / restore versions / trash published items too unless
   * the approval step is on (then managers only — see the item's own capabilities).
   */
  canEdit: z.boolean(),
  /** manage: publish when approval is on, members, visibility, statuses, categories, full audit log, purge. */
  canManage: z.boolean(),
  canViewAudit: z.boolean(),
  canPurge: z.boolean(),
  /** manage + `knowledge.update`: info, visibility, approval step, statuses, categories (like projects). */
  canUpdate: z.boolean(),
  /** manage + `knowledge.manage_members`. */
  canManageMembers: z.boolean(),
  /** manage + `knowledge.delete`: archive, restore and delete the space (stays true while it is archived). */
  canArchive: z.boolean()
});
export type KnowledgeSpaceCapabilities = z.infer<typeof KnowledgeSpaceCapabilitiesSchema>;

export const KnowledgeSpaceSchema = z.object({
  id: Id,
  name: z.string(),
  description: z.string().nullable(),
  visibility: KnowledgeVisibilitySchema,
  color: ColorTokenSchema,
  icon: z.string().nullable(),
  rank: z.string(),
  /**
   * Moving an item into an "active" status needs manage; published items (active / retired) are then changed by
   * managers only (owner decision 2026-10-11).
   */
  approvalRequired: z.boolean(),
  /** null when the caller is not a member (public space, or an org admin). */
  myAccess: KnowledgeAccessLevelSchema.nullable(),
  isMember: z.boolean(),
  memberCount: z.number().int(),
  itemCount: z.number().int(),
  capabilities: KnowledgeSpaceCapabilitiesSchema,
  archivedAt: IsoDate.nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate
});
export type KnowledgeSpace = z.infer<typeof KnowledgeSpaceSchema>;
export const KnowledgeSpaceCollectionSchema = z.object({ items: z.array(KnowledgeSpaceSchema) });

export const KnowledgeSpaceDetailSchema = KnowledgeSpaceSchema.extend({
  statuses: z.array(KnowledgeStatusSchema),
  categories: z.array(KnowledgeCategorySchema),
  /** Tags used in this space, most used first (suggestions). */
  tags: z.array(z.object({ name: z.string(), count: z.number().int() }))
});
export type KnowledgeSpaceDetail = z.infer<typeof KnowledgeSpaceDetailSchema>;

export const CreateKnowledgeSpaceRequestSchema = z
  .object({
    name: SafeLineSchema(120),
    description: SafeMultilineSchema(1000).nullable().optional(),
    visibility: KnowledgeVisibilitySchema.default("private"),
    color: ColorTokenSchema.default("blue"),
    icon: ProjectIconSchema.nullable().optional(),
    approvalRequired: z.boolean().default(false)
  })
  .strict();
export type CreateKnowledgeSpaceRequest = z.infer<typeof CreateKnowledgeSpaceRequestSchema>;

export const UpdateKnowledgeSpaceRequestSchema = z
  .object({
    name: SafeLineSchema(120).optional(),
    description: SafeMultilineSchema(1000).nullable().optional(),
    visibility: KnowledgeVisibilitySchema.optional(),
    color: ColorTokenSchema.optional(),
    icon: ProjectIconSchema.nullable().optional(),
    approvalRequired: z.boolean().optional(),
    placement: PlacementSchema.optional()
  })
  .strict()
  .refine(atLeastOneField, { message: "At least one field is required." });
export type UpdateKnowledgeSpaceRequest = z.infer<typeof UpdateKnowledgeSpaceRequestSchema>;

export const KnowledgeMemberSchema = z.object({
  user: UserRefSchema,
  accessLevel: KnowledgeAccessLevelSchema,
  createdAt: IsoDate
});
export type KnowledgeMember = z.infer<typeof KnowledgeMemberSchema>;
export const KnowledgeMemberCollectionSchema = z.object({ items: z.array(KnowledgeMemberSchema) });
export const UpsertKnowledgeMemberRequestSchema = z
  .object({ userId: Id, accessLevel: KnowledgeAccessLevelSchema.default("view") })
  .strict();
export const UpdateKnowledgeMemberRequestSchema = z.object({ accessLevel: KnowledgeAccessLevelSchema }).strict();

// Items -------------------------------------------------------------------------------------------------------

export const KnowledgeTagSchema = z
  .string()
  .trim()
  .min(1)
  .max(knowledgeLimits.tagLength)
  .refine((value) => !/[,#]/.test(value) && !hasControlCharacters(value) && !hasBidiControls(value), "Tag cannot contain commas, # or control characters.");

export const KnowledgeItemSummarySchema = z.object({
  id: Id,
  spaceId: Id,
  categoryId: Id.nullable(),
  title: z.string(),
  summary: z.string().nullable(),
  importance: KnowledgeImportanceSchema,
  status: KnowledgeStatusSchema,
  owner: UserRefSchema.nullable(),
  tags: z.array(z.string()),
  pinned: z.boolean(),
  effectiveFrom: z.string().nullable(),
  reviewBy: z.string().nullable(),
  /** reviewBy is today or earlier and the item is active. */
  reviewDue: z.boolean(),
  version: z.number().int(),
  commentCount: z.number().int(),
  openCommentCount: z.number().int(),
  attachmentCount: z.number().int(),
  createdBy: UserRefSchema.nullable(),
  updatedBy: UserRefSchema.nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate
});
export type KnowledgeItemSummary = z.infer<typeof KnowledgeItemSummarySchema>;
export const KnowledgeItemPageSchema = createCursorPageSchema(KnowledgeItemSummarySchema);
export type KnowledgeItemPage = z.infer<typeof KnowledgeItemPageSchema>;

/**
 * What the caller may do with this item. With the approval step on, a published item (active / retired group) is
 * editable by managers only: then canEdit / canChangeStatus / canDelete are false and allowedStatusIds is empty for
 * members. Trashed items: everything false except canRestore (and canViewHistory).
 */
export const KnowledgeItemCapabilitiesSchema = z.object({
  /** Content, fields, files (and body images), version restore, edit presence. */
  canEdit: z.boolean(),
  canChangeStatus: z.boolean(),
  /** Statuses the caller may move this item to (approval rule applied). */
  allowedStatusIds: z.array(Id),
  canDelete: z.boolean(),
  /** Trashed item: may restore it from the trash (approval lock applied). Always sent by the server. */
  canRestore: z.boolean().optional(),
  canComment: z.boolean(),
  canViewHistory: z.boolean()
});

export const KnowledgeItemDetailSchema = KnowledgeItemSummarySchema.extend({
  /** "knowledge" rich-text profile: the shared schema plus tables and images (rich-text.ts knowledgeBodySpec). */
  body: RichTextDocSchema,
  /** Files of the item, images placed in the body included (files hidden after use in a version body are not listed). */
  attachments: z.array(KnowledgeAttachmentSchema),
  isFollowing: z.boolean(),
  followerCount: z.number().int(),
  category: z.object({ id: Id, name: z.string(), parent: z.object({ id: Id, name: z.string() }).nullable() }).nullable(),
  space: z.object({ id: Id, name: z.string(), color: ColorTokenSchema, visibility: KnowledgeVisibilitySchema }),
  /** Someone else saved a version in the last few minutes or holds the edit presence. */
  editing: z.array(UserRefSchema),
  capabilities: KnowledgeItemCapabilitiesSchema,
  deletedAt: IsoDate.nullable()
});
export type KnowledgeItemDetail = z.infer<typeof KnowledgeItemDetailSchema>;

export const KnowledgeItemQuerySchema = z.object({
  categoryId: Id.optional(),
  /** "none" = items outside any category. */
  uncategorized: z.enum(["true", "false"]).optional(),
  statusId: z.union([Id, z.array(Id)]).optional(),
  group: z.union([KnowledgeStatusGroupSchema, z.array(KnowledgeStatusGroupSchema)]).optional(),
  importance: z.union([KnowledgeImportanceSchema, z.array(KnowledgeImportanceSchema)]).optional(),
  tag: z.union([KnowledgeTagSchema, z.array(KnowledgeTagSchema)]).optional(),
  ownerId: Id.optional(),
  q: SafeSearchSchema(120).optional(),
  pinned: z.enum(["true", "false"]).optional(),
  reviewDue: z.enum(["true", "false"]).optional(),
  sort: z.enum(["updated", "title", "importance", "reviewBy", "created"]).default("updated"),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});
export type KnowledgeItemQuery = z.infer<typeof KnowledgeItemQuerySchema>;

export const CreateKnowledgeItemRequestSchema = z
  .object({
    title: SafeLineSchema(200),
    summary: SafeMultilineSchema(400).nullable().optional(),
    /** "knowledge" profile; no images yet (they are files of the item: save the draft first, then upload). */
    body: RichTextDocSchema,
    categoryId: Id.nullable().optional(),
    importance: KnowledgeImportanceSchema.default("normal"),
    /** Defaults to the first "draft" status; an "active" one needs manage when approval is on. */
    statusId: Id.optional(),
    ownerId: Id.nullable().optional(),
    effectiveFrom: DayInput.nullable().optional(),
    reviewBy: DayInput.nullable().optional(),
    tags: z.array(KnowledgeTagSchema).max(knowledgeLimits.tagsPerItem).default([]),
    pinned: z.boolean().default(false)
  })
  .strict();
export type CreateKnowledgeItemRequest = z.infer<typeof CreateKnowledgeItemRequestSchema>;

/**
 * Any change. Content fields (title, summary, body) need `expectedVersion`: when someone saved a newer version
 * the server answers 409 KNOWLEDGE_VERSION_CONFLICT with the latest version number (never overwrites silently).
 * Changes to a critical item (before or after) need a `reason` (≥ 3 characters), kept in the audit log.
 */
export const UpdateKnowledgeItemRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(1).optional(),
    title: SafeLineSchema(200).optional(),
    summary: SafeMultilineSchema(400).nullable().optional(),
    body: RichTextDocSchema.optional(),
    /** Optional note on the version created by a content change ("Sửa bước 3"). */
    versionNote: SafeLineSchema(200).nullable().optional(),
    categoryId: Id.nullable().optional(),
    importance: KnowledgeImportanceSchema.optional(),
    statusId: Id.optional(),
    ownerId: Id.nullable().optional(),
    effectiveFrom: DayInput.nullable().optional(),
    reviewBy: DayInput.nullable().optional(),
    tags: z.array(KnowledgeTagSchema).max(knowledgeLimits.tagsPerItem).optional(),
    pinned: z.boolean().optional(),
    reason: SafeLineSchema(500).optional()
  })
  .strict()
  .refine((value) => Object.entries(value).some(([key, entry]) => key !== "reason" && key !== "expectedVersion" && key !== "versionNote" && entry !== undefined), {
    message: "At least one field is required."
  });
export type UpdateKnowledgeItemRequest = z.infer<typeof UpdateKnowledgeItemRequestSchema>;

export const KnowledgeVersionConflictSchema = z.object({
  latestVersion: z.number().int(),
  savedBy: UserRefSchema.nullable(),
  savedAt: IsoDate
});

/** Reason for deleting / restoring a critical item or restoring an old version. */
export const KnowledgeReasonRequestSchema = z.object({ reason: SafeLineSchema(500).optional() }).strict();

/** GET /knowledge/spaces/:spaceId/trash — newest deletion first. */
export const KnowledgeTrashedItemSchema = KnowledgeItemSummarySchema.extend({
  deletedAt: IsoDate,
  deletedBy: UserRefSchema.nullable(),
  /** Purged automatically at this time (deletedAt + trashRetentionDays). */
  purgeAt: IsoDate,
  canRestore: z.boolean(),
  canPurge: z.boolean()
});
export type KnowledgeTrashedItem = z.infer<typeof KnowledgeTrashedItemSchema>;
export const KnowledgeTrashPageSchema = createCursorPageSchema(KnowledgeTrashedItemSchema);

/** POST / DELETE /knowledge/items/:itemId/follow. */
export const KnowledgeFollowStateSchema = z.object({ isFollowing: z.boolean(), followerCount: z.number().int() });

/**
 * POST /knowledge/items/:itemId/editing — edit presence: send `editing: true` when the editor opens and every
 * ~30 s while it stays open (expires after 60 s), `false` when it closes. Answers the other people editing now.
 */
export const KnowledgeEditingRequestSchema = z.object({ editing: z.boolean() }).strict();
export const KnowledgeEditingStateSchema = z.object({ editing: z.array(UserRefSchema) });

// Versions ----------------------------------------------------------------------------------------------------

export const KnowledgeVersionSummarySchema = z.object({
  number: z.number().int(),
  title: z.string(),
  note: z.string().nullable(),
  author: UserRefSchema.nullable(),
  /** Version this one was restored from, if any. */
  restoredFrom: z.number().int().nullable(),
  createdAt: IsoDate
});
export const KnowledgeVersionPageSchema = createCursorPageSchema(KnowledgeVersionSummarySchema);
export const KnowledgeVersionSchema = KnowledgeVersionSummarySchema.extend({
  summary: z.string().nullable(),
  body: RichTextDocSchema
});
export type KnowledgeVersion = z.infer<typeof KnowledgeVersionSchema>;

// Comments ----------------------------------------------------------------------------------------------------

export const KnowledgeCommentSchema = z.object({
  id: Id,
  itemId: Id,
  parentCommentId: Id.nullable(),
  author: UserRefSchema.nullable(),
  body: RichTextDocSchema,
  bodyText: z.string(),
  mentionedUserIds: z.array(Id),
  replyCount: z.number().int(),
  /** Feedback handled ("Đã xử lý"), root comments only. */
  resolvedAt: IsoDate.nullable(),
  resolvedBy: UserRefSchema.nullable(),
  attachments: z.array(KnowledgeAttachmentSchema),
  createdAt: IsoDate,
  editedAt: IsoDate.nullable(),
  canEdit: z.boolean(),
  canDelete: z.boolean(),
  canResolve: z.boolean()
});
export type KnowledgeComment = z.infer<typeof KnowledgeCommentSchema>;
export const KnowledgeCommentPageSchema = createCursorPageSchema(KnowledgeCommentSchema);
export const CreateKnowledgeCommentRequestSchema = z
  .object({
    body: RichTextDocSchema,
    parentCommentId: Id.nullable().optional(),
    attachmentIds: z.array(Id).max(10).default([])
  })
  .strict();
export const UpdateKnowledgeCommentRequestSchema = z.object({ body: RichTextDocSchema }).strict();
export const ResolveKnowledgeCommentRequestSchema = z.object({ resolved: z.boolean() }).strict();

// Audit log ---------------------------------------------------------------------------------------------------

export const KnowledgeAuditActionSchema = z.enum([
  "SPACE_CREATED",
  "SPACE_UPDATED",
  "SPACE_ARCHIVED",
  "SPACE_RESTORED",
  /** The space was deleted (soft: its rows and this log stay in the database). Added 2026-10-11. */
  "SPACE_DELETED",
  "MEMBER_ADDED",
  "MEMBER_UPDATED",
  "MEMBER_REMOVED",
  "STATUSES_REPLACED",
  "CATEGORY_CREATED",
  "CATEGORY_UPDATED",
  "CATEGORY_DELETED",
  "ITEM_CREATED",
  "ITEM_CONTENT_UPDATED",
  "ITEM_FIELDS_UPDATED",
  "ITEM_STATUS_CHANGED",
  "ITEM_IMPORTANCE_CHANGED",
  "ITEM_MOVED",
  "ITEM_DELETED",
  "ITEM_RESTORED",
  "ITEM_PURGED",
  "VERSION_RESTORED",
  "ATTACHMENT_ADDED",
  "ATTACHMENT_REMOVED",
  "COMMENT_DELETED",
  "COMMENT_RESOLVED",
  "COMMENT_EDITED"
]);
export type KnowledgeAuditAction = z.infer<typeof KnowledgeAuditActionSchema>;

export const KnowledgeAuditEntrySchema = z.object({
  id: Id,
  spaceId: Id,
  itemId: Id.nullable(),
  /** Title at the time of the entry (items can be renamed or purged later). */
  itemTitle: z.string().nullable(),
  actor: UserRefSchema.nullable(),
  action: KnowledgeAuditActionSchema,
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  reason: z.string().nullable(),
  versionNumber: z.number().int().nullable(),
  createdAt: IsoDate
});
export type KnowledgeAuditEntry = z.infer<typeof KnowledgeAuditEntrySchema>;
export const KnowledgeAuditPageSchema = createCursorPageSchema(KnowledgeAuditEntrySchema);

export const KnowledgeAuditQuerySchema = z.object({
  itemId: Id.optional(),
  actorId: Id.optional(),
  action: z.union([KnowledgeAuditActionSchema, z.array(KnowledgeAuditActionSchema)]).optional(),
  from: IsoDateInputSchema.optional(),
  to: IsoDateInputSchema.optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});
export type KnowledgeAuditQuery = z.infer<typeof KnowledgeAuditQuerySchema>;
/** GET /knowledge/spaces/:spaceId/audit/export — same filters, every matching row (capped at 20 000). */
export const KnowledgeAuditExportQuerySchema = KnowledgeAuditQuerySchema.omit({ cursor: true, limit: true });

// Realtime ----------------------------------------------------------------------------------------------------

/**
 * Event `knowledge:changed` in socket room `knowledge:<spaceId>` (members and, for public spaces, readers; join with
 * `room:join { type: "knowledge", id: spaceId }`). Payloads never carry content — refetch what is shown.
 * `kind: "space"` / `"members"` events are also sent to the organization room (public spaces) or to the members'
 * user rooms (private spaces) so the sidebar list can refresh without joining every space.
 */
export const KnowledgeChangedEventSchema = z.object({
  spaceId: Id,
  itemId: Id.nullable(),
  kind: z.enum(["space", "item_created", "item_updated", "item_deleted", "item_restored", "comment", "members", "structure"]),
  actorId: Id.nullable(),
  version: z.number().int().nullable(),
  at: IsoDate
});
export type KnowledgeChangedEvent = z.infer<typeof KnowledgeChangedEventSchema>;
