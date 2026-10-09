import { Router, type RequestHandler, type Router as ExpressRouter } from "express";

import {
  AddChannelMembersRequestSchema,
  AddChannelMembersResponseSchema,
  ChannelBrowsePageSchema,
  ChannelBrowseQuerySchema,
  ChannelMemberPageSchema,
  ChannelMemberQuerySchema,
  ChatAttachmentSchema,
  ChatAttachmentUrlCollectionSchema,
  ChatAttachmentUrlRequestSchema,
  ChatChannelCollectionSchema,
  ChatChannelDetailSchema,
  ChatChannelMemberSchema,
  ChatMentionsQuerySchema,
  ChatMessageSchema,
  ChatOkSchema,
  ChatSearchPageSchema,
  ChatSearchQuerySchema,
  ChatSettingsSchema,
  ChatUploadRequestSchema,
  ChatUploadTicketSchema,
  CreateChannelRequestSchema,
  EditMessageRequestSchema,
  MarkReadRequestSchema,
  MessageHistoryQuerySchema,
  MessageHistorySchema,
  MyMembershipSchema,
  OpenDmRequestSchema,
  ReactionQuerySchema,
  ReactionRequestSchema,
  ReactionResultSchema,
  ReadStateSchema,
  SendMessageRequestSchema,
  ThreadPageSchema,
  ThreadQuerySchema,
  UpdateChannelMemberRequestSchema,
  UpdateChannelRequestSchema,
  UpdateMyMembershipRequestSchema
} from "../../contracts/chat.js";
import { getSql } from "../../db/client.js";
import { requireSupabaseUser, type AuthenticatedRequest } from "../../middleware/auth.js";
import { chatAttachmentsEnabled } from "./chat-settings.js";
import { registerMessageSearchProvider } from "../search/search.service.js";
import { handle, param } from "../work/http.js";
import { completeChatUpload, createChatAttachmentUrls, createChatUpload, deleteUnsentChatAttachment } from "./attachments.service.js";
import {
  addChannelMembers,
  browseChannels,
  createChannel,
  deleteChannel,
  getChannel,
  joinChannel,
  leaveChannel,
  listChannelMembers,
  listMyChannels,
  openDirectConversation,
  removeChannelMember,
  setChannelArchived,
  updateChannel,
  updateChannelMember,
  updateMyMembership
} from "./channels.service.js";
import {
  deleteMessage,
  editMessage,
  getMessageHistory,
  getThread,
  listMyMentions,
  markRead,
  searchMessages,
  sendMessage,
  setReaction
} from "./messages.service.js";

/** Authenticates unless an earlier router in the chain already did (avoids verifying the token twice). */
const requireAuth: RequestHandler = (req, res, next) => {
  if ((req as Partial<AuthenticatedRequest>).auth) {
    next();
    return;
  }
  void requireSupabaseUser(req, res, next);
};

export const createChatRoutes = (): ExpressRouter => {
  // Global search (modules/search) includes messages through this membership-filtered provider.
  registerMessageSearchProvider(async (context, q, limit) =>
    q.trim().length < 2 ? [] : (await searchMessages(context, { q, limit })).items
  );

  const routes = Router();
  routes.use(["/channels", "/dms", "/messages", "/chat-attachments", "/chat"], requireAuth);

  // Channels (sidebar, browse, CRUD) ------------------------------------------------------------
  routes.get("/channels", handle(async (context) => ChatChannelCollectionSchema.parse(await listMyChannels(context))));
  routes.get(
    "/channels/browse",
    handle(async (context, req) => ChannelBrowsePageSchema.parse(await browseChannels(context, ChannelBrowseQuerySchema.parse(req.query))))
  );
  routes.post(
    "/channels",
    handle(
      async (context, req) => ChatChannelDetailSchema.parse(await createChannel(context, CreateChannelRequestSchema.parse(req.body))),
      201
    )
  );
  routes.get("/channels/:channelId", handle(async (context, req) => ChatChannelDetailSchema.parse(await getChannel(context, param(req, "channelId")))));
  routes.patch(
    "/channels/:channelId",
    handle(async (context, req) =>
      ChatChannelDetailSchema.parse(await updateChannel(context, param(req, "channelId"), UpdateChannelRequestSchema.parse(req.body)))
    )
  );
  routes.post(
    "/channels/:channelId/archive",
    handle(async (context, req) => ChatChannelDetailSchema.parse(await setChannelArchived(context, param(req, "channelId"), true)))
  );
  routes.post(
    "/channels/:channelId/unarchive",
    handle(async (context, req) => ChatChannelDetailSchema.parse(await setChannelArchived(context, param(req, "channelId"), false)))
  );
  routes.delete("/channels/:channelId", handle(async (context, req) => ChatOkSchema.parse(await deleteChannel(context, param(req, "channelId")))));

  // Membership ----------------------------------------------------------------------------------
  routes.post("/channels/:channelId/join", handle(async (context, req) => ChatChannelDetailSchema.parse(await joinChannel(context, param(req, "channelId")))));
  routes.post("/channels/:channelId/leave", handle(async (context, req) => ChatOkSchema.parse(await leaveChannel(context, param(req, "channelId")))));
  routes.get(
    "/channels/:channelId/members",
    handle(async (context, req) =>
      ChannelMemberPageSchema.parse(await listChannelMembers(context, param(req, "channelId"), ChannelMemberQuerySchema.parse(req.query)))
    )
  );
  routes.post(
    "/channels/:channelId/members",
    handle(async (context, req) =>
      AddChannelMembersResponseSchema.parse(
        await addChannelMembers(context, param(req, "channelId"), AddChannelMembersRequestSchema.parse(req.body))
      )
    )
  );
  routes.patch(
    "/channels/:channelId/members/:userId",
    handle(async (context, req) =>
      ChatChannelMemberSchema.parse(
        await updateChannelMember(context, param(req, "channelId"), param(req, "userId"), UpdateChannelMemberRequestSchema.parse(req.body))
      )
    )
  );
  routes.delete(
    "/channels/:channelId/members/:userId",
    handle(async (context, req) => ChatOkSchema.parse(await removeChannelMember(context, param(req, "channelId"), param(req, "userId"))))
  );
  routes.patch(
    "/channels/:channelId/me",
    handle(async (context, req) =>
      MyMembershipSchema.parse(await updateMyMembership(context, param(req, "channelId"), UpdateMyMembershipRequestSchema.parse(req.body)))
    )
  );
  routes.post(
    "/channels/:channelId/read",
    handle(async (context, req) =>
      ReadStateSchema.parse(await markRead(context, param(req, "channelId"), MarkReadRequestSchema.parse(req.body).seq))
    )
  );

  // Direct messages: 201 when created, 200 when the conversation already existed.
  routes.post(
    "/dms",
    handle(async (context, req, res) => {
      const result = await openDirectConversation(context, OpenDmRequestSchema.parse(req.body));
      res.status(result.created ? 201 : 200).json(ChatChannelDetailSchema.parse(result.channel));
      return undefined;
    })
  );

  // Messages ------------------------------------------------------------------------------------
  routes.get(
    "/channels/:channelId/messages",
    handle(async (context, req) =>
      MessageHistorySchema.parse(await getMessageHistory(context, param(req, "channelId"), MessageHistoryQuerySchema.parse(req.query)))
    )
  );
  // 201 when created, 200 when replaying an already-sent clientMessageId.
  routes.post(
    "/channels/:channelId/messages",
    handle(async (context, req, res) => {
      const result = await sendMessage(context, param(req, "channelId"), SendMessageRequestSchema.parse(req.body));
      res.status(result.created ? 201 : 200).json(ChatMessageSchema.parse(result.message));
      return undefined;
    })
  );
  routes.patch(
    "/messages/:messageId",
    handle(async (context, req) =>
      ChatMessageSchema.parse(await editMessage(context, param(req, "messageId"), EditMessageRequestSchema.parse(req.body).body))
    )
  );
  routes.delete("/messages/:messageId", handle(async (context, req) => ChatOkSchema.parse(await deleteMessage(context, param(req, "messageId")))));
  routes.get(
    "/messages/:messageId/thread",
    handle(async (context, req) => ThreadPageSchema.parse(await getThread(context, param(req, "messageId"), ThreadQuerySchema.parse(req.query))))
  );
  routes.put(
    "/messages/:messageId/reactions",
    handle(async (context, req) =>
      ReactionResultSchema.parse(await setReaction(context, param(req, "messageId"), ReactionRequestSchema.parse(req.body).emoji, true))
    )
  );
  routes.delete(
    "/messages/:messageId/reactions",
    handle(async (context, req) =>
      ReactionResultSchema.parse(await setReaction(context, param(req, "messageId"), ReactionQuerySchema.parse(req.query).emoji, false))
    )
  );

  // Attachments ---------------------------------------------------------------------------------
  routes.post(
    "/channels/:channelId/attachments",
    handle(
      async (context, req) =>
        ChatUploadTicketSchema.parse(await createChatUpload(context, param(req, "channelId"), ChatUploadRequestSchema.parse(req.body))),
      201
    )
  );
  routes.post(
    "/chat-attachments/urls",
    handle(async (context, req) =>
      ChatAttachmentUrlCollectionSchema.parse(await createChatAttachmentUrls(context, ChatAttachmentUrlRequestSchema.parse(req.body).ids))
    )
  );
  routes.post(
    "/chat-attachments/:attachmentId/complete",
    handle(async (context, req) => ChatAttachmentSchema.parse(await completeChatUpload(context, param(req, "attachmentId"))))
  );
  routes.delete(
    "/chat-attachments/:attachmentId",
    handle(async (context, req) => ChatOkSchema.parse(await deleteUnsentChatAttachment(context, param(req, "attachmentId"))))
  );

  // Settings (composer): file sharing on/off (PD-013) ------------------------------------------------
  routes.get(
    "/chat/settings",
    handle(async (context) =>
      ChatSettingsSchema.parse({ attachmentsEnabled: await chatAttachmentsEnabled(getSql(), context.organization.id) })
    )
  );

  // Search & mentions ---------------------------------------------------------------------------
  routes.get(
    "/chat/search",
    handle(async (context, req) => ChatSearchPageSchema.parse(await searchMessages(context, ChatSearchQuerySchema.parse(req.query))))
  );
  routes.get(
    "/chat/mentions",
    handle(async (context, req) => ChatSearchPageSchema.parse(await listMyMentions(context, ChatMentionsQuerySchema.parse(req.query))))
  );

  return routes;
};
