import { randomUUID } from "node:crypto";

import type { KnowledgeAttachment } from "../../contracts/knowledge.js";
import { knowledgeLimits } from "../../contracts/knowledge.js";
import { Permission } from "../../contracts/permissions.js";
import type { CreateUploadRequest, UploadTicket } from "../../contracts/work.js";
import { maxAttachmentBytes } from "../../contracts/work.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import type { QuerySql } from "../../lib/db-types.js";
import { logger } from "../../lib/logger.js";
import {
  baseMime,
  createSignedDownloadUrl,
  createSignedUploadUrl,
  getObjectInfo,
  isAllowedUploadType,
  isInlineImage,
  removeObjects,
  sanitizeFileName,
  storageSafeSegment,
  uploadTypeRejected
} from "../../lib/storage.js";
import type { AccessContext } from "../access/access-context.js";
import { authorizeItem, forbidden, requireKnowledgePermission } from "./access.js";
import { auditFor, publishKnowledge, toKnowledgeAttachment, usedInVersionsSql, userJsonSql, type AttachmentRow } from "./repo.js";
import { assertItemEditable, canEditItem, levelAtLeast } from "./rules.js";

const downloadTtlSeconds = 10 * 60;

/**
 * Upload quotas per person (KB-SEC-02). Every reader of a public space may attach files to comments, so tickets are
 * bounded like chat files: at most `perMinute` new uploads a minute, and at most `unsentPerHour` files that are still
 * pending or completed for a comment that was never posted (counting only pending files let a reader complete
 * unlimited unattached 50 MB "comment" files and fill the storage).
 */
export const knowledgeUploadQuota = { perMinute: 30, unsentPerHour: 50 } as const;

export const assertUploadQuota = async (sql: QuerySql, userId: string) => {
  const rows = await sql<{ minute: number; unsent: number }[]>`
    SELECT count(*) FILTER (WHERE a.created_at > now() - interval '1 minute')::int AS minute,
      count(*) FILTER (
        WHERE a.deleted_at IS NULL AND (a.status = 'pending' OR (a.purpose = 'comment' AND a.comment_id IS NULL))
      )::int AS unsent
    FROM knowledge.item_attachments a
    WHERE a.uploaded_by = ${userId} AND a.created_at > now() - interval '1 hour'
  `;
  const usage = rows[0] ?? { minute: 0, unsent: 0 };
  if (Number(usage.minute) >= knowledgeUploadQuota.perMinute) {
    throw new AppError("ATTACHMENT_RATE_LIMITED", "Bạn đang tải lên quá nhanh. Thử lại sau một phút.", 429);
  }
  if (Number(usage.unsent) >= knowledgeUploadQuota.unsentPerHour) {
    throw new AppError(
      "ATTACHMENT_RATE_LIMITED",
      "Đang có quá nhiều tệp chờ tải lên hoặc chưa gửi kèm bình luận. Hãy gửi hoặc xoá bớt rồi thử lại.",
      429
    );
  }
};

/**
 * Item and comment files (Supabase Storage, prefix org/<org>/knowledge/<space>/<item>/<attachment>/<name>), the
 * task attachment flow: ticket → direct upload → complete (the object is checked) → short-lived signed URLs.
 * Readers may attach files to comments; item files need submit+.
 */
export const createKnowledgeUpload = async (context: AccessContext, itemId: string, input: CreateUploadRequest): Promise<UploadTicket> => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  const mimeType = baseMime(input.mimeType);
  if (!isAllowedUploadType(mimeType)) {
    throw uploadTypeRejected();
  }
  const sql = getSql();
  const { item } = await authorizeItem(sql, context, itemId);
  await assertUploadQuota(sql, context.user.id);
  const attachmentId = randomUUID();
  const fileName = sanitizeFileName(input.fileName);
  const objectPath = `org/${context.organization.id}/knowledge/${item.space_id}/${itemId}/${attachmentId}/${storageSafeSegment(fileName)}`;
  await sql`
    INSERT INTO knowledge.item_attachments (id, organization_id, space_id, item_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
    VALUES (${attachmentId}, ${context.organization.id}, ${item.space_id}, ${itemId}, ${objectPath}, ${fileName}, ${mimeType},
            ${input.sizeBytes}, ${context.user.id})
  `;
  const { url: uploadUrl, expiresAt } = await createSignedUploadUrl(objectPath);
  return { attachmentId, uploadUrl, expiresAt };
};

type AttachmentRecord = AttachmentRow & {
  storage_path: string;
  status: "pending" | "ready";
  purpose: "item" | "comment";
  size_declared: string;
  uploaded_by_id: string | null;
  space_id: string;
};

const selectAttachment = async (context: AccessContext, attachmentId: string) => {
  const sql = getSql();
  const row = (
    await sql<AttachmentRecord[]>`
      SELECT a.id, a.item_id, a.comment_id, a.file_name, a.mime_type, a.size_bytes, a.size_bytes::text AS size_declared, a.created_at,
        a.storage_path, a.status, a.purpose, a.uploaded_by AS uploaded_by_id, a.space_id,
        (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = a.uploaded_by) AS uploaded_by
      FROM knowledge.item_attachments a
      WHERE a.id = ${attachmentId} AND a.organization_id = ${context.organization.id} AND a.deleted_at IS NULL
    `
  )[0];
  if (!row) {
    throw new AppError("ATTACHMENT_NOT_FOUND", "Không tìm thấy tệp đính kèm.", 404);
  }
  return row;
};

export const completeKnowledgeUpload = async (
  context: AccessContext,
  attachmentId: string,
  target: "item" | "comment"
): Promise<KnowledgeAttachment> => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  const row = await selectAttachment(context, attachmentId);
  if (row.uploaded_by_id !== context.user.id) {
    throw new AppError("ATTACHMENT_NOT_FOUND", "Không tìm thấy tệp đính kèm.", 404);
  }
  const sql = getSql();
  const { item, access } = await authorizeItem(sql, context, row.item_id);
  if (row.status === "ready") {
    return toKnowledgeAttachment(row, true);
  }
  if (target === "item") {
    if (!levelAtLeast(access.level, "submit")) {
      throw forbidden("Bạn cần là Thành viên hoặc Quản lý của kho để đính kèm tệp vào mục.");
    }
    // Files (and body images) of a published item: managers only while the approval step is on.
    assertItemEditable(access.level, access.approvalRequired, item.status_group);
    const count = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM knowledge.item_attachments
      WHERE item_id = ${row.item_id} AND purpose = 'item' AND status = 'ready' AND deleted_at IS NULL
    `;
    if ((count[0]?.count ?? 0) >= knowledgeLimits.attachmentsPerItem) {
      throw new AppError("KNOWLEDGE_ATTACHMENT_LIMIT", `Mỗi mục có tối đa ${knowledgeLimits.attachmentsPerItem} tệp đính kèm.`, 409);
    }
  }
  const info = await getObjectInfo(row.storage_path);
  if (!info || info.size === null) {
    throw new AppError("ATTACHMENT_NOT_UPLOADED", "Tệp chưa được tải lên.", 409);
  }
  const discard = async () => {
    await removeObjects([row.storage_path]).catch(() => undefined);
    await sql`UPDATE knowledge.item_attachments SET deleted_at = now() WHERE id = ${attachmentId}`;
  };
  if (info.size > maxAttachmentBytes || info.size > Number(row.size_declared) * 1.01 + 1024) {
    await discard();
    throw new AppError("ATTACHMENT_TOO_LARGE", "Tệp tải lên lớn hơn mức cho phép.", 400);
  }
  // Storage serves the Content-Type sent with the upload: it must match what was authorized (and be allowed).
  const storedType = info.contentType ? baseMime(info.contentType) : null;
  if (!storedType || storedType !== baseMime(row.mime_type) || !isAllowedUploadType(storedType)) {
    await discard();
    throw new AppError("ATTACHMENT_TYPE_MISMATCH", "Loại tệp tải lên không khớp với loại đã khai báo.", 400);
  }
  await sql.begin(async (tx) => {
    await tx`
      UPDATE knowledge.item_attachments SET status = 'ready', size_bytes = ${info.size}, completed_at = now(), purpose = ${target}
      WHERE id = ${attachmentId}
    `;
    if (target === "item") {
      await auditFor(context)(tx, [
        {
          spaceId: item.space_id,
          itemId: item.id,
          itemTitle: item.title,
          action: "ATTACHMENT_ADDED",
          after: { attachmentId, fileName: row.file_name, sizeBytes: info.size }
        }
      ]);
    }
  });
  if (target === "item") {
    publishKnowledge(item.space_id, "item_updated", { itemId: item.id, actorId: context.user.id, version: null });
  }
  return toKnowledgeAttachment({ ...row, size_bytes: info.size ?? row.size_bytes }, true);
};

/**
 * Short-lived signed URLs; every id is authorized through its item (drafts: submit+ and the author). Images used by a
 * version body are served even when hidden from the attachment list (old versions keep rendering them).
 */
export const createKnowledgeAttachmentUrls = async (context: AccessContext, ids: string[]) => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  const sql = getSql();
  const rows = await sql<{ id: string; item_id: string; storage_path: string; file_name: string; mime_type: string }[]>`
    SELECT a.id, a.item_id, a.storage_path, a.file_name, a.mime_type
    FROM knowledge.item_attachments a
    WHERE a.organization_id = ${context.organization.id} AND a.id = ANY(${ids}::uuid[]) AND a.status = 'ready'
      AND (a.deleted_at IS NULL OR (a.purpose = 'item' AND ${usedInVersionsSql(sql)}))
  `;
  const allowed = new Map<string, boolean>();
  for (const itemId of new Set(rows.map((row) => row.item_id))) {
    allowed.set(
      itemId,
      await authorizeItem(sql, context, itemId, { trashed: "include", intent: "read" }).then(
        () => true,
        () => false
      )
    );
  }
  const expiresAt = new Date(Date.now() + downloadTtlSeconds * 1000).toISOString();
  const items = await Promise.all(
    rows
      .filter((row) => allowed.get(row.item_id))
      .map(async (row) => ({
        id: row.id,
        url: await createSignedDownloadUrl(row.storage_path, {
          expiresIn: downloadTtlSeconds,
          ...(isInlineImage(row.mime_type) ? {} : { downloadName: row.file_name })
        }),
        expiresAt
      }))
  );
  return { items };
};

/**
 * Uploader who may edit the item (comment files: the uploader), or a space manager. An image used by any version body
 * is only hidden from the attachment list: the object stays in storage until the item is purged.
 */
export const deleteKnowledgeAttachment = async (context: AccessContext, attachmentId: string) => {
  requireKnowledgePermission(context, Permission.KnowledgeView);
  const row = await selectAttachment(context, attachmentId);
  const sql = getSql();
  const outcome = await sql.begin(async (tx) => {
    // The item row lock serializes this with saves that could start using the image.
    const { item, access } = await authorizeItem(tx, context, row.item_id, { lock: true });
    const isUploader = row.uploaded_by_id === context.user.id;
    // Uploaders may always cancel an upload that never completed (its purpose is only fixed on completion).
    const allowed =
      access.level === "manage" ||
      (isUploader &&
        (row.purpose === "comment" || row.status === "pending" || canEditItem(access.level, access.approvalRequired, item.status_group)));
    if (!allowed) {
      throw forbidden(
        isUploader && levelAtLeast(access.level, "submit")
          ? "Kho này bật bước duyệt: tệp của mục đã ban hành chỉ Quản lý kho mới xoá được."
          : "Bạn không xoá được tệp này."
      );
    }
    const kept =
      row.purpose === "item" &&
      (
        await tx<{ used: boolean }[]>`
          SELECT ${usedInVersionsSql(tx)} AS used FROM knowledge.item_attachments a WHERE a.id = ${attachmentId}
        `
      )[0]?.used === true;
    await tx`UPDATE knowledge.item_attachments SET deleted_at = now(), deleted_by = ${context.user.id} WHERE id = ${attachmentId}`;
    if (row.purpose === "item" && row.status === "ready") {
      await auditFor(context)(tx, [
        {
          spaceId: item.space_id,
          itemId: item.id,
          itemTitle: item.title,
          action: "ATTACHMENT_REMOVED",
          before: { attachmentId, fileName: row.file_name, sizeBytes: Number(row.size_bytes) },
          ...(kept ? { after: { keptForVersions: true } } : {})
        }
      ]);
    }
    return { spaceId: item.space_id, itemId: item.id, kept };
  });
  if (!outcome.kept) {
    removeObjects([row.storage_path]).catch((error: unknown) => logger.warn({ err: error, attachmentId }, "Knowledge storage cleanup failed"));
  }
  publishKnowledge(outcome.spaceId, row.purpose === "item" ? "item_updated" : "comment", { itemId: outcome.itemId, actorId: context.user.id });
  return { ok: true as const };
};
