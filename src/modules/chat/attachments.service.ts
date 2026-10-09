import { randomUUID } from "node:crypto";

import type { ChatAttachment, ChatAttachmentUrlCollection, ChatUploadRequest, ChatUploadTicket } from "../../contracts/chat.js";
import { chatLimits } from "../../contracts/chat.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { logger } from "../../lib/logger.js";
import {
  baseMime,
  createSignedDownloadUrl,
  createSignedUploadUrl,
  getObjectInfo,
  isAllowedUploadType,
  removeObjects,
  sanitizeFileName,
  storageSafeSegment,
  uploadTypeRejected
} from "../../lib/storage.js";
import type { AccessContext } from "../access/access-context.js";
import { assertCanPost, loadChannel, requireChannel } from "./chat-access.js";
import { isInlineImage, toAttachment } from "./chat-mappers.js";
import { consumeChatQuota } from "./chat-rate-limit.js";
import { assertChatAttachmentsEnabled } from "./chat-settings.js";

/** Chat files follow the owning channel's authorization (product §28, §50). */

const downloadTtlSeconds = 10 * 60;
const uploadTtlMs = 2 * 60 * 60 * 1000;
const maxUnsentPerHour = 50;

const notFound = () => new AppError("CHAT_ATTACHMENT_NOT_FOUND", "Attachment was not found.", 404);

/** Step 1: authorize (submit access), record a pending attachment, return a signed direct-upload URL. */
export const createChatUpload = async (context: AccessContext, channelId: string, input: ChatUploadRequest): Promise<ChatUploadTicket> => {
  const mimeType = baseMime(input.mimeType);
  if (!isAllowedUploadType(mimeType)) {
    throw uploadTypeRejected("CHAT_ATTACHMENT_TYPE_BLOCKED");
  }
  const sql = getSql();
  assertCanPost(await requireChannel(sql, context, channelId));
  await assertChatAttachmentsEnabled(sql, context.organization.id);
  await consumeChatQuota("upload", context.user.id);

  // Bound abandoned uploads per user.
  const pending = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM public.message_attachments
    WHERE organization_id = ${context.organization.id} AND uploaded_by = ${context.user.id}
      AND message_id IS NULL AND deleted_at IS NULL AND created_at > now() - interval '1 hour'
  `;
  if ((pending[0]?.count ?? 0) >= maxUnsentPerHour) {
    throw new AppError("CHAT_RATE_LIMITED", "Too many unsent uploads. Send or remove some files first.", 429);
  }

  const attachmentId = randomUUID();
  const fileName = sanitizeFileName(input.fileName);
  const objectPath = `org/${context.organization.id}/channels/${channelId}/${attachmentId}/${storageSafeSegment(fileName)}`;
  await sql`
    INSERT INTO public.message_attachments (id, organization_id, channel_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
    VALUES (${attachmentId}, ${context.organization.id}, ${channelId}, ${objectPath}, ${fileName}, ${mimeType},
            ${input.sizeBytes}, ${context.user.id})
  `;
  try {
    const uploadUrl = await createSignedUploadUrl(objectPath);
    return { attachmentId, uploadUrl, expiresAt: new Date(Date.now() + uploadTtlMs).toISOString() };
  } catch (error) {
    await sql`DELETE FROM public.message_attachments WHERE id = ${attachmentId} AND status = 'pending'`.catch(() => undefined);
    throw error;
  }
};

type AttachmentRecord = {
  id: string;
  channel_id: string;
  message_id: string | null;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: string;
  status: "pending" | "ready";
  uploaded_by: string | null;
};

const selectOwnUnsent = async (context: AccessContext, attachmentId: string) => {
  const row = (
    await getSql()<AttachmentRecord[]>`
      SELECT id, channel_id, message_id, storage_path, file_name, mime_type, size_bytes, status, uploaded_by
      FROM public.message_attachments
      WHERE organization_id = ${context.organization.id} AND id = ${attachmentId} AND deleted_at IS NULL
    `
  )[0];
  // Only the uploader manages an attachment before it is sent.
  if (!row || row.uploaded_by !== context.user.id) {
    throw notFound();
  }
  return row;
};

const discard = async (context: AccessContext, row: AttachmentRecord) => {
  await removeObjects([row.storage_path]).catch(() => undefined);
  await getSql()`
    UPDATE public.message_attachments SET deleted_at = now(), deleted_by = ${context.user.id}
    WHERE id = ${row.id} AND organization_id = ${context.organization.id}
  `;
};

/** Step 2: verify the object really landed in storage (size, type) before it can be sent. */
export const completeChatUpload = async (context: AccessContext, attachmentId: string): Promise<ChatAttachment> => {
  const row = await selectOwnUnsent(context, attachmentId);
  const resolved = await loadChannel(getSql(), context, row.channel_id);
  if (!resolved) {
    throw notFound();
  }
  if (row.status === "ready") {
    return toAttachment(row);
  }
  assertCanPost(resolved);
  await assertChatAttachmentsEnabled(getSql(), context.organization.id);

  const info = await getObjectInfo(row.storage_path);
  if (!info || info.size === null) {
    throw new AppError("CHAT_ATTACHMENT_NOT_UPLOADED", "The file has not been uploaded yet.", 409);
  }
  if (info.size < 1) {
    await discard(context, row);
    throw new AppError("CHAT_ATTACHMENT_EMPTY", "The uploaded file is empty.", 400);
  }
  if (info.size > chatLimits.attachmentBytesMax || info.size > Number(row.size_bytes) * 1.01 + 1024) {
    await discard(context, row);
    throw new AppError("CHAT_ATTACHMENT_TOO_LARGE", "The uploaded file is larger than allowed.", 400);
  }
  // Storage serves the Content-Type sent with the upload (it decides inline rendering vs download): it must be
  // the declared, allowed type (SEC-API-01).
  const storedType = info.contentType ? baseMime(info.contentType) : null;
  if (!storedType || storedType !== baseMime(row.mime_type) || !isAllowedUploadType(storedType)) {
    await discard(context, row);
    throw new AppError("CHAT_ATTACHMENT_TYPE_MISMATCH", "Loại tệp đã tải lên không khớp với loại đã khai báo.", 400);
  }
  const mimeType = storedType;

  await getSql()`
    UPDATE public.message_attachments
    SET status = 'ready', size_bytes = ${info.size}, mime_type = ${mimeType}, completed_at = now()
    WHERE id = ${attachmentId} AND organization_id = ${context.organization.id} AND status = 'pending'
  `;
  return toAttachment({ ...row, size_bytes: info.size, mime_type: mimeType });
};

/** Removes an uploaded file that was never sent (e.g. the user removed it from the composer). */
export const deleteUnsentChatAttachment = async (context: AccessContext, attachmentId: string) => {
  const row = await selectOwnUnsent(context, attachmentId);
  if (row.message_id !== null) {
    throw new AppError("CHAT_ATTACHMENT_SENT", "This file was already sent; delete the message instead.", 409);
  }
  await discard(context, row);
  return { ok: true as const };
};

/**
 * Short-lived signed URLs. Each id is authorized through its channel (caller must be able to read
 * it); files of deleted messages are never served; unsent files only to their uploader.
 * Unknown or unauthorized ids are omitted. Non-image files are forced to download.
 */
export const createChatAttachmentUrls = async (context: AccessContext, ids: string[]): Promise<ChatAttachmentUrlCollection> => {
  const sql = getSql();
  const rows = await sql<(AttachmentRecord & { message_deleted: boolean | null })[]>`
    SELECT a.id, a.channel_id, a.message_id, a.storage_path, a.file_name, a.mime_type, a.size_bytes, a.status, a.uploaded_by,
      (m.deleted_at IS NOT NULL) AS message_deleted
    FROM public.message_attachments a
    LEFT JOIN public.messages m ON m.organization_id = a.organization_id AND m.id = a.message_id
    WHERE a.organization_id = ${context.organization.id}
      AND a.id = ANY(${ids}::uuid[])
      AND a.status = 'ready'
      AND a.deleted_at IS NULL
  `;
  const visible = rows.filter((row) =>
    row.message_id === null ? row.uploaded_by === context.user.id : row.message_deleted === false
  );

  const readable = new Map<string, boolean>();
  for (const channelId of new Set(visible.map((row) => row.channel_id))) {
    const resolved = await loadChannel(sql, context, channelId);
    readable.set(channelId, resolved?.caps.canRead === true);
  }

  const expiresAt = new Date(Date.now() + downloadTtlSeconds * 1000).toISOString();
  const items = await Promise.all(
    visible
      .filter((row) => readable.get(row.channel_id))
      .map(async (row) => ({
        id: row.id,
        url: await createSignedDownloadUrl(row.storage_path, {
          expiresIn: downloadTtlSeconds,
          ...(isInlineImage(row.mime_type) ? {} : { downloadName: row.file_name })
        }),
        expiresAt
      }))
  );
  if (items.length < ids.length) {
    logger.debug({ requested: ids.length, granted: items.length }, "Chat attachment URLs filtered by authorization");
  }
  return { items };
};
