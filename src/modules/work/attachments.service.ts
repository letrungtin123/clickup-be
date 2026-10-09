import { randomUUID } from "node:crypto";

import { Permission } from "../../contracts/permissions.js";
import type { Attachment, CreateUploadRequest, UploadTicket } from "../../contracts/work.js";
import { maxAttachmentBytes } from "../../contracts/work.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { logger } from "../../lib/logger.js";
import {
  createSignedDownloadUrl,
  createSignedUploadUrl,
  getObjectInfo,
  inlineImageTypes,
  isBlockedMimeType,
  removeObjects,
  sanitizeFileName,
  storageSafeSegment
} from "../../lib/storage.js";
import { publishToRoom } from "../../realtime/publisher.js";
import type { AccessContext } from "../access/access-context.js";
import { getProjectAccess, hasPermission, projectLevelAtLeast } from "../access/resource-access.js";
import { toAttachment, type AttachmentRow } from "./mappers.js";
import { insertActivities, userJsonSql } from "./tasks.repo.js";
import { authorizeTask } from "./tasks.service.js";

const downloadTtlSeconds = 10 * 60;

/** Upload step 1: authorize, record a pending attachment, hand out a signed direct-upload URL. */
export const createTaskUpload = async (context: AccessContext, taskId: string, input: CreateUploadRequest): Promise<UploadTicket> => {
  if (!hasPermission(context, Permission.TaskUpdate) && !hasPermission(context, Permission.TaskComment)) {
    throw new AppError("FORBIDDEN", "You do not have permission to attach files.", 403);
  }
  const mimeType = input.mimeType.toLowerCase();
  if (isBlockedMimeType(mimeType)) {
    throw new AppError("ATTACHMENT_TYPE_BLOCKED", "This file type is not allowed.", 400);
  }
  const sql = getSql();
  const { task } = await authorizeTask(sql, context, taskId, "submit");

  // Bound abandoned uploads per user.
  const pending = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM public.task_attachments
    WHERE organization_id = ${context.organization.id} AND uploaded_by = ${context.user.id}
      AND status = 'pending' AND created_at > now() - interval '1 hour'
  `;
  if ((pending[0]?.count ?? 0) >= 50) {
    throw new AppError("ATTACHMENT_RATE_LIMITED", "Too many uploads in progress. Try again shortly.", 429);
  }

  const attachmentId = randomUUID();
  const fileName = sanitizeFileName(input.fileName);
  const objectPath = `org/${context.organization.id}/tasks/${taskId}/${attachmentId}/${storageSafeSegment(fileName)}`;
  await sql`
    INSERT INTO public.task_attachments (id, organization_id, project_id, task_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
    VALUES (${attachmentId}, ${context.organization.id}, ${task.project_id}, ${taskId}, ${objectPath}, ${fileName}, ${mimeType},
            ${input.sizeBytes}, ${context.user.id})
  `;
  const uploadUrl = await createSignedUploadUrl(objectPath);
  return { attachmentId, uploadUrl, expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() };
};

const selectAttachment = async (context: AccessContext, attachmentId: string) => {
  const sql = getSql();
  const row = (
    await sql<(AttachmentRow & { storage_path: string; status: string; size_declared: string; uploaded_by_id: string | null; project_id: string })[]>`
      SELECT a.id, a.task_id, a.comment_id, a.file_name, a.mime_type, a.size_bytes, a.size_bytes::text AS size_declared, a.created_at,
        a.storage_path, a.status, a.uploaded_by AS uploaded_by_id, a.project_id,
        (SELECT ${userJsonSql(sql)} FROM public.app_users au WHERE au.id = a.uploaded_by) AS uploaded_by
      FROM public.task_attachments a
      WHERE a.id = ${attachmentId} AND a.organization_id = ${context.organization.id} AND a.deleted_at IS NULL
    `
  )[0];
  if (!row) {
    throw new AppError("ATTACHMENT_NOT_FOUND", "Attachment was not found.", 404);
  }
  return row;
};

/** Upload step 2: verify the object really landed in storage before exposing it. */
export const completeTaskUpload = async (context: AccessContext, attachmentId: string, target: "task" | "comment"): Promise<Attachment> => {
  const row = await selectAttachment(context, attachmentId);
  if (row.uploaded_by_id !== context.user.id) {
    throw new AppError("ATTACHMENT_NOT_FOUND", "Attachment was not found.", 404);
  }
  const sql = getSql();
  await authorizeTask(sql, context, row.task_id, "submit");
  if (row.status === "ready") {
    return toAttachment(row, (mime) => inlineImageTypes.has(mime));
  }

  const info = await getObjectInfo(row.storage_path);
  if (!info || info.size === null) {
    throw new AppError("ATTACHMENT_NOT_UPLOADED", "The file has not been uploaded yet.", 409);
  }
  if (info.size > maxAttachmentBytes || info.size > Number(row.size_declared) * 1.01 + 1024) {
    await removeObjects([row.storage_path]).catch(() => undefined);
    await sql`UPDATE public.task_attachments SET deleted_at = now() WHERE id = ${attachmentId}`;
    throw new AppError("ATTACHMENT_TOO_LARGE", "The uploaded file is larger than allowed.", 400);
  }

  await sql.begin(async (tx) => {
    await tx`
      UPDATE public.task_attachments SET status = 'ready', size_bytes = ${info.size}, completed_at = now()
      WHERE id = ${attachmentId} AND organization_id = ${context.organization.id}
    `;
    if (target === "task") {
      await insertActivities(tx, context, [
        { taskId: row.task_id, action: "TASK_ATTACHMENT_ADDED", targetType: "attachment", targetId: attachmentId, newValue: { fileName: row.file_name } }
      ]);
    }
  });

  if (target === "task") {
    publishToRoom({ type: "task", id: row.task_id }, "task:timeline", {
      projectId: row.project_id,
      taskId: row.task_id,
      actorId: context.user.id,
      at: new Date().toISOString()
    });
  }
  return toAttachment({ ...row, size_bytes: info.size }, (mime) => inlineImageTypes.has(mime));
};

/** Short-lived signed URLs; every id is authorized through its task's project. */
export const createAttachmentUrls = async (context: AccessContext, ids: string[]) => {
  const sql = getSql();
  const rows = await sql<{ id: string; project_id: string; storage_path: string; file_name: string; mime_type: string }[]>`
    SELECT a.id, a.project_id, a.storage_path, a.file_name, a.mime_type
    FROM public.task_attachments a
    JOIN public.tasks t ON t.id = a.task_id AND t.organization_id = a.organization_id AND t.deleted_at IS NULL
    WHERE a.organization_id = ${context.organization.id} AND a.id = ANY(${ids}::uuid[])
      AND a.status = 'ready' AND a.deleted_at IS NULL
  `;
  const accessByProject = new Map<string, boolean>();
  for (const projectId of new Set(rows.map((row) => row.project_id))) {
    const access = await getProjectAccess(context, projectId, sql);
    accessByProject.set(projectId, access !== null && hasPermission(context, Permission.TaskView));
  }
  const expiresAt = new Date(Date.now() + downloadTtlSeconds * 1000).toISOString();
  const items = await Promise.all(
    rows
      .filter((row) => accessByProject.get(row.project_id))
      .map(async (row) => ({
        id: row.id,
        url: await createSignedDownloadUrl(row.storage_path, {
          expiresIn: downloadTtlSeconds,
          ...(inlineImageTypes.has(row.mime_type) ? {} : { downloadName: row.file_name })
        }),
        expiresAt
      }))
  );
  return { items };
};

export const deleteAttachment = async (context: AccessContext, attachmentId: string) => {
  const row = await selectAttachment(context, attachmentId);
  const sql = getSql();
  const { access } = await authorizeTask(sql, context, row.task_id, "view");
  if (row.uploaded_by_id !== context.user.id && !projectLevelAtLeast(access.level, "manage")) {
    throw new AppError("FORBIDDEN", "You cannot delete this attachment.", 403);
  }
  await sql.begin(async (tx) => {
    await tx`UPDATE public.task_attachments SET deleted_at = now(), deleted_by = ${context.user.id} WHERE id = ${attachmentId}`;
    if (!row.comment_id && row.status === "ready") {
      await insertActivities(tx, context, [
        { taskId: row.task_id, action: "TASK_ATTACHMENT_REMOVED", targetType: "attachment", targetId: attachmentId, previousValue: { fileName: row.file_name } }
      ]);
    }
  });
  removeObjects([row.storage_path]).catch((error: unknown) => logger.warn({ err: error, attachmentId }, "Storage object cleanup failed"));
  publishToRoom({ type: "task", id: row.task_id }, "task:timeline", {
    projectId: row.project_id,
    taskId: row.task_id,
    actorId: context.user.id,
    at: new Date().toISOString()
  });
  return { ok: true as const };
};
