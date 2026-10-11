import { Router, type Router as ExpressRouter } from "express";
import { z } from "zod";

import {
  CompleteKnowledgeUploadRequestSchema,
  CreateKnowledgeCategoryRequestSchema,
  CreateKnowledgeCommentRequestSchema,
  CreateKnowledgeItemRequestSchema,
  CreateKnowledgeSpaceRequestSchema,
  KnowledgeAttachmentSchema,
  KnowledgeAuditPageSchema,
  KnowledgeAuditQuerySchema,
  KnowledgeCategorySchema,
  KnowledgeCommentPageSchema,
  KnowledgeCommentSchema,
  KnowledgeEditingRequestSchema,
  KnowledgeEditingStateSchema,
  KnowledgeFollowStateSchema,
  KnowledgeItemDetailSchema,
  KnowledgeItemPageSchema,
  KnowledgeItemQuerySchema,
  KnowledgeMemberCollectionSchema,
  KnowledgeMemberSchema,
  KnowledgePageQuerySchema,
  KnowledgeReasonRequestSchema,
  KnowledgeSpaceCollectionSchema,
  KnowledgeSpaceDetailSchema,
  KnowledgeTrashPageSchema,
  KnowledgeVersionPageSchema,
  KnowledgeVersionSchema,
  ReplaceKnowledgeStatusesRequestSchema,
  ResolveKnowledgeCommentRequestSchema,
  UpdateKnowledgeCategoryRequestSchema,
  UpdateKnowledgeCommentRequestSchema,
  UpdateKnowledgeItemRequestSchema,
  UpdateKnowledgeMemberRequestSchema,
  UpdateKnowledgeSpaceRequestSchema,
  UpsertKnowledgeMemberRequestSchema
} from "../../contracts/knowledge.js";
import {
  AttachmentUrlCollectionSchema,
  AttachmentUrlRequestSchema,
  CreateUploadRequestSchema,
  UploadTicketSchema
} from "../../contracts/work.js";
import { requireSupabaseUser } from "../../middleware/auth.js";
import { registerKnowledgeSearchProvider } from "../search/search.service.js";
import { handle, param } from "../work/http.js";
import {
  completeKnowledgeUpload,
  createKnowledgeAttachmentUrls,
  createKnowledgeUpload,
  deleteKnowledgeAttachment
} from "./attachments.service.js";
import { createComment, deleteComment, listComments, listReplies, resolveComment, updateComment } from "./comments.service.js";
import {
  createItem,
  deleteItem,
  getItemDetail,
  getVersion,
  listItemHistory,
  listItems,
  listTrash,
  listVersions,
  purgeItem,
  restoreItem,
  restoreVersion,
  setEditing,
  setFollowing,
  updateItem
} from "./items.service.js";
import { searchKnowledge } from "./search.js";
import {
  archiveSpace,
  createCategory,
  createSpace,
  deleteCategory,
  deleteSpace,
  exportSpaceAudit,
  getSpaceAudit,
  getSpaceDetail,
  listArchivedSpaces,
  listMembers,
  listSpaces,
  removeMember,
  replaceStatuses,
  restoreSpace,
  updateCategory,
  updateSpace,
  upsertMember
} from "./spaces.service.js";

const VersionNumberParam = z.coerce.number().int().min(1).max(1_000_000);
const reasonBody = (body: unknown) => KnowledgeReasonRequestSchema.parse(body ?? {});

/** Knowledge base API (PD-031). Route list and permissions: contracts/knowledge.ts. */
export const createKnowledgeRoutes = (): ExpressRouter => {
  const routes = Router();
  routes.use("/knowledge", requireSupabaseUser);
  registerKnowledgeSearchProvider(searchKnowledge);

  // Spaces
  routes.get("/knowledge/spaces", handle(async (context) => KnowledgeSpaceCollectionSchema.parse(await listSpaces(context))));
  routes.get("/knowledge/spaces/archived", handle(async (context) => KnowledgeSpaceCollectionSchema.parse(await listArchivedSpaces(context))));
  routes.post(
    "/knowledge/spaces",
    handle(async (context, req) => KnowledgeSpaceDetailSchema.parse(await createSpace(context, CreateKnowledgeSpaceRequestSchema.parse(req.body))), 201)
  );
  routes.get(
    "/knowledge/spaces/:spaceId",
    handle(async (context, req) => KnowledgeSpaceDetailSchema.parse(await getSpaceDetail(context, param(req, "spaceId"))))
  );
  routes.patch(
    "/knowledge/spaces/:spaceId",
    handle(async (context, req) =>
      KnowledgeSpaceDetailSchema.parse(await updateSpace(context, param(req, "spaceId"), UpdateKnowledgeSpaceRequestSchema.parse(req.body)))
    )
  );
  routes.post("/knowledge/spaces/:spaceId/archive", handle(async (context, req) => await archiveSpace(context, param(req, "spaceId"))));
  routes.post(
    "/knowledge/spaces/:spaceId/restore",
    handle(async (context, req) => KnowledgeSpaceDetailSchema.parse(await restoreSpace(context, param(req, "spaceId"))))
  );
  routes.delete("/knowledge/spaces/:spaceId", handle(async (context, req) => await deleteSpace(context, param(req, "spaceId"))));

  // Members
  routes.get(
    "/knowledge/spaces/:spaceId/members",
    handle(async (context, req) => KnowledgeMemberCollectionSchema.parse(await listMembers(context, param(req, "spaceId"))))
  );
  routes.post(
    "/knowledge/spaces/:spaceId/members",
    handle(async (context, req) =>
      KnowledgeMemberSchema.parse(await upsertMember(context, param(req, "spaceId"), UpsertKnowledgeMemberRequestSchema.parse(req.body)))
    )
  );
  routes.patch(
    "/knowledge/spaces/:spaceId/members/:userId",
    handle(async (context, req) =>
      KnowledgeMemberSchema.parse(
        await upsertMember(
          context,
          param(req, "spaceId"),
          { userId: param(req, "userId"), ...UpdateKnowledgeMemberRequestSchema.parse(req.body) },
          "update"
        )
      )
    )
  );
  routes.delete(
    "/knowledge/spaces/:spaceId/members/:userId",
    handle(async (context, req) => await removeMember(context, param(req, "spaceId"), param(req, "userId")))
  );

  // Statuses & categories
  routes.put(
    "/knowledge/spaces/:spaceId/statuses",
    handle(async (context, req) =>
      KnowledgeSpaceDetailSchema.parse(await replaceStatuses(context, param(req, "spaceId"), ReplaceKnowledgeStatusesRequestSchema.parse(req.body)))
    )
  );
  routes.post(
    "/knowledge/spaces/:spaceId/categories",
    handle(
      async (context, req) =>
        KnowledgeCategorySchema.parse(await createCategory(context, param(req, "spaceId"), CreateKnowledgeCategoryRequestSchema.parse(req.body))),
      201
    )
  );
  routes.patch(
    "/knowledge/spaces/:spaceId/categories/:categoryId",
    handle(async (context, req) =>
      KnowledgeCategorySchema.parse(
        await updateCategory(context, param(req, "spaceId"), param(req, "categoryId"), UpdateKnowledgeCategoryRequestSchema.parse(req.body))
      )
    )
  );
  routes.delete(
    "/knowledge/spaces/:spaceId/categories/:categoryId",
    handle(async (context, req) => await deleteCategory(context, param(req, "spaceId"), param(req, "categoryId")))
  );

  // Items of a space, trash, audit log
  routes.get(
    "/knowledge/spaces/:spaceId/items",
    handle(async (context, req) =>
      KnowledgeItemPageSchema.parse(await listItems(context, param(req, "spaceId"), KnowledgeItemQuerySchema.parse(req.query)))
    )
  );
  routes.post(
    "/knowledge/spaces/:spaceId/items",
    handle(
      async (context, req) =>
        KnowledgeItemDetailSchema.parse(await createItem(context, param(req, "spaceId"), CreateKnowledgeItemRequestSchema.parse(req.body))),
      201
    )
  );
  routes.get(
    "/knowledge/spaces/:spaceId/trash",
    handle(async (context, req) =>
      KnowledgeTrashPageSchema.parse(await listTrash(context, param(req, "spaceId"), KnowledgePageQuerySchema.parse(req.query)))
    )
  );
  routes.get(
    "/knowledge/spaces/:spaceId/audit",
    handle(async (context, req) =>
      KnowledgeAuditPageSchema.parse(await getSpaceAudit(context, param(req, "spaceId"), KnowledgeAuditQuerySchema.parse(req.query)))
    )
  );
  routes.get(
    "/knowledge/spaces/:spaceId/audit/export",
    handle(async (context, req, res) => {
      await exportSpaceAudit(context, param(req, "spaceId"), req.query, res);
      return undefined;
    })
  );

  // Items
  routes.get("/knowledge/items/:itemId", handle(async (context, req) => KnowledgeItemDetailSchema.parse(await getItemDetail(context, param(req, "itemId")))));
  routes.patch(
    "/knowledge/items/:itemId",
    handle(async (context, req) =>
      KnowledgeItemDetailSchema.parse(await updateItem(context, param(req, "itemId"), UpdateKnowledgeItemRequestSchema.parse(req.body)))
    )
  );
  routes.delete("/knowledge/items/:itemId", handle(async (context, req) => await deleteItem(context, param(req, "itemId"), reasonBody(req.body))));
  routes.post(
    "/knowledge/items/:itemId/restore",
    handle(async (context, req) => KnowledgeItemDetailSchema.parse(await restoreItem(context, param(req, "itemId"), reasonBody(req.body))))
  );
  routes.post("/knowledge/items/:itemId/purge", handle(async (context, req) => await purgeItem(context, param(req, "itemId"), reasonBody(req.body))));
  routes.post(
    "/knowledge/items/:itemId/editing",
    handle(async (context, req) =>
      KnowledgeEditingStateSchema.parse(await setEditing(context, param(req, "itemId"), KnowledgeEditingRequestSchema.parse(req.body).editing))
    )
  );

  // Versions & history
  routes.get(
    "/knowledge/items/:itemId/versions",
    handle(async (context, req) =>
      KnowledgeVersionPageSchema.parse(await listVersions(context, param(req, "itemId"), KnowledgePageQuerySchema.parse(req.query)))
    )
  );
  routes.get(
    "/knowledge/items/:itemId/versions/:number",
    handle(async (context, req) =>
      KnowledgeVersionSchema.parse(await getVersion(context, param(req, "itemId"), VersionNumberParam.parse(req.params.number)))
    )
  );
  routes.post(
    "/knowledge/items/:itemId/versions/:number/restore",
    handle(async (context, req) =>
      KnowledgeItemDetailSchema.parse(
        await restoreVersion(context, param(req, "itemId"), VersionNumberParam.parse(req.params.number), reasonBody(req.body))
      )
    )
  );
  routes.get(
    "/knowledge/items/:itemId/history",
    handle(async (context, req) =>
      KnowledgeAuditPageSchema.parse(await listItemHistory(context, param(req, "itemId"), KnowledgePageQuerySchema.parse(req.query)))
    )
  );

  // Follow
  routes.post(
    "/knowledge/items/:itemId/follow",
    handle(async (context, req) => KnowledgeFollowStateSchema.parse(await setFollowing(context, param(req, "itemId"), true)))
  );
  routes.delete(
    "/knowledge/items/:itemId/follow",
    handle(async (context, req) => KnowledgeFollowStateSchema.parse(await setFollowing(context, param(req, "itemId"), false)))
  );

  // Comments
  routes.get(
    "/knowledge/items/:itemId/comments",
    handle(async (context, req) =>
      KnowledgeCommentPageSchema.parse(await listComments(context, param(req, "itemId"), KnowledgePageQuerySchema.parse(req.query)))
    )
  );
  routes.get(
    "/knowledge/items/:itemId/comments/:commentId/replies",
    handle(async (context, req) => KnowledgeCommentPageSchema.parse(await listReplies(context, param(req, "itemId"), param(req, "commentId"))))
  );
  routes.post(
    "/knowledge/items/:itemId/comments",
    handle(
      async (context, req) =>
        KnowledgeCommentSchema.parse(await createComment(context, param(req, "itemId"), CreateKnowledgeCommentRequestSchema.parse(req.body))),
      201
    )
  );
  routes.patch(
    "/knowledge/items/:itemId/comments/:commentId",
    handle(async (context, req) =>
      KnowledgeCommentSchema.parse(
        await updateComment(context, param(req, "itemId"), param(req, "commentId"), UpdateKnowledgeCommentRequestSchema.parse(req.body).body)
      )
    )
  );
  routes.delete(
    "/knowledge/items/:itemId/comments/:commentId",
    handle(async (context, req) => await deleteComment(context, param(req, "itemId"), param(req, "commentId")))
  );
  routes.post(
    "/knowledge/items/:itemId/comments/:commentId/resolve",
    handle(async (context, req) =>
      KnowledgeCommentSchema.parse(
        await resolveComment(context, param(req, "itemId"), param(req, "commentId"), ResolveKnowledgeCommentRequestSchema.parse(req.body).resolved)
      )
    )
  );

  // Attachments
  routes.post(
    "/knowledge/items/:itemId/attachments",
    handle(
      async (context, req) =>
        UploadTicketSchema.parse(await createKnowledgeUpload(context, param(req, "itemId"), CreateUploadRequestSchema.parse(req.body))),
      201
    )
  );
  routes.post(
    "/knowledge/attachments/urls",
    handle(async (context, req) =>
      AttachmentUrlCollectionSchema.parse(await createKnowledgeAttachmentUrls(context, AttachmentUrlRequestSchema.parse(req.body).ids))
    )
  );
  routes.post(
    "/knowledge/attachments/:attachmentId/complete",
    handle(async (context, req) =>
      KnowledgeAttachmentSchema.parse(
        await completeKnowledgeUpload(context, param(req, "attachmentId"), CompleteKnowledgeUploadRequestSchema.parse(req.body ?? {}).target)
      )
    )
  );
  routes.delete(
    "/knowledge/attachments/:attachmentId",
    handle(async (context, req) => await deleteKnowledgeAttachment(context, param(req, "attachmentId")))
  );

  return routes;
};
