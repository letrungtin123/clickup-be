import { env } from "../config/env.js";
import { AppError } from "./app-error.js";
import { logger } from "./logger.js";

/**
 * Supabase Storage access with the service role key — server side only. Browsers receive
 * short-lived signed URLs after the API has authorized the owning resource.
 */

const storageUrl = (path: string) => new URL(`/storage/v1${path}`, env.SUPABASE_URL).toString();

/** URL handed to browsers: absolute when STORAGE_PUBLIC_URL is set, otherwise a same-origin path. */
const browserUrl = (path: string, query?: Record<string, string>) => {
  const url = new URL(`/storage/v1${path}`, env.STORAGE_PUBLIC_URL ?? "http://same-origin.invalid");
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }
  return env.STORAGE_PUBLIC_URL ? url.toString() : `${url.pathname}${url.search}`;
};

const serviceHeaders = () => {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new AppError("STORAGE_NOT_CONFIGURED", "File storage is not configured.", 503);
  }
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
  };
};

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

const storageFetch = async (path: string, init: RequestInit) => {
  const response = await fetch(storageUrl(path), {
    ...init,
    headers: { ...serviceHeaders(), ...init.headers }
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    logger.warn({ status: response.status, path: path.split("/").slice(0, 4).join("/"), body: body.slice(0, 300) }, "Storage request failed");
    throw new AppError("STORAGE_ERROR", "File storage request failed.", response.status === 404 ? 404 : 502);
  }
  return response;
};

/** Raster formats safe to render inline. SVG/HTML are always downloaded, never rendered. */
export const inlineImageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);

/** Active-content types are refused outright (defence in depth; everything non-raster is downloaded anyway). */
const blockedTypes = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/xml",
  "application/xml",
  "application/javascript",
  "text/javascript",
  "application/ecmascript",
  "text/ecmascript",
  "application/x-msdownload",
  "application/x-sh",
  "application/x-httpd-php"
]);

export const baseMime = (mimeType: string) => mimeType.toLowerCase().split(";")[0]!.trim();

export const isBlockedMimeType = (mimeType: string) => {
  const base = baseMime(mimeType);
  return blockedTypes.has(base) || base.endsWith("+xml");
};

/**
 * Upload allowlist (SEC-API-01): everything else is refused. Raster images in `inlineImageTypes` render
 * inline; every other type (incl. the download-only image formats below) is always served as a download.
 */
export const allowedUploadTypes = new Set([
  // Images (inline)
  ...inlineImageTypes,
  // Images (download only): retouch sources and phone photos
  "image/tiff",
  "image/bmp",
  "image/heic",
  "image/heif",
  "image/vnd.adobe.photoshop",
  // Documents
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/rtf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  // Archives
  "application/zip",
  "application/x-zip-compressed",
  // Video
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-matroska",
  // Audio
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/webm"
]);

export const isAllowedUploadType = (mimeType: string) => {
  const base = baseMime(mimeType);
  return allowedUploadTypes.has(base) && !isBlockedMimeType(base);
};

/** 400 for a type outside the allowlist (each module keeps its established error code). */
export const uploadTypeRejected = (code = "ATTACHMENT_TYPE_BLOCKED") =>
  new AppError(code, "Loại tệp này không được hỗ trợ. Hãy nén thành .zip hoặc chọn tệp khác.", 400);

/** Only verified raster images may be rendered inline; everything else is served as a download. */
export const isInlineImage = (mimeType: string) => inlineImageTypes.has(baseMime(mimeType));

let bucketReady: Promise<void> | undefined;

/** Creates the private bucket with a hard size limit on first use. */
export const ensureBucket = () => {
  bucketReady ??= (async () => {
    const response = await fetch(storageUrl(`/bucket/${encodeURIComponent(env.STORAGE_BUCKET)}`), {
      headers: serviceHeaders()
    });
    if (response.ok) {
      return;
    }
    await storageFetch("/bucket", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: env.STORAGE_BUCKET,
        name: env.STORAGE_BUCKET,
        public: false,
        file_size_limit: 50 * 1024 * 1024
      })
    });
    logger.info({ bucket: env.STORAGE_BUCKET }, "Storage bucket created");
  })().catch((error: unknown) => {
    bucketReady = undefined;
    throw error;
  });
  return bucketReady;
};

/** Signed upload URL the browser PUTs the file to directly (valid ~2 hours, single object path). */
export const createSignedUploadUrl = async (objectPath: string) => {
  await ensureBucket();
  const response = await storageFetch(`/object/upload/sign/${encodeURIComponent(env.STORAGE_BUCKET)}/${encodePath(objectPath)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  const body = (await response.json()) as { url?: string; token?: string };
  if (!body.url) {
    throw new AppError("STORAGE_ERROR", "File storage did not return an upload URL.", 502);
  }
  return browserUrl(body.url);
};

export const getObjectInfo = async (objectPath: string) => {
  const response = await fetch(
    storageUrl(`/object/info/authenticated/${encodeURIComponent(env.STORAGE_BUCKET)}/${encodePath(objectPath)}`),
    { headers: serviceHeaders() }
  );
  if (response.status === 404 || response.status === 400) {
    return null;
  }
  if (!response.ok) {
    throw new AppError("STORAGE_ERROR", "File storage request failed.", 502);
  }
  const body = (await response.json()) as { size?: number; content_type?: string; metadata?: { size?: number; mimetype?: string } };
  return {
    size: body.size ?? body.metadata?.size ?? null,
    contentType: body.content_type ?? body.metadata?.mimetype ?? null
  };
};

/** Short-lived download URL. Non-image files are forced to download (Content-Disposition: attachment). */
export const createSignedDownloadUrl = async (objectPath: string, options: { expiresIn: number; downloadName?: string }) => {
  const response = await storageFetch(`/object/sign/${encodeURIComponent(env.STORAGE_BUCKET)}/${encodePath(objectPath)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expiresIn: options.expiresIn })
  });
  const body = (await response.json()) as { signedURL?: string };
  if (!body.signedURL) {
    throw new AppError("STORAGE_ERROR", "File storage did not return a download URL.", 502);
  }
  return browserUrl(body.signedURL, options.downloadName ? { download: options.downloadName } : undefined);
};

export const removeObjects = async (objectPaths: string[]) => {
  if (objectPaths.length === 0) {
    return;
  }
  await storageFetch(`/object/${encodeURIComponent(env.STORAGE_BUCKET)}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prefixes: objectPaths })
  });
};

/** Bidi overrides/isolates/marks and zero-width characters: they disguise names ("gpj.exe" shown as "exe.jpg"). */
const disguisingCharacters = /[\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

/** A name that is empty or only dots (".", "..") must never become a path segment. */
const withoutDotSegments = (value: string) => value.replace(/^[.\s]+/, "").trim();

/** Keeps names readable while removing path separators, control and disguising characters. */
export const sanitizeFileName = (name: string) => {
  const cleaned = withoutDotSegments(
    name
      .normalize("NFC")
      .replace(disguisingCharacters, "")
      // eslint-disable-next-line no-control-regex -- stripping control characters is intended
      .replace(/[\u0000-\u001f\u007f/\\]+/g, "_")
      .trim()
  ).slice(0, 180);
  return cleaned.length > 0 ? cleaned : "file";
};

/**
 * Object keys use ASCII only; the display name is kept in the database. Dot segments are stripped again
 * after the ASCII folding: "́.." (a lone combining mark + dots) would otherwise become "..".
 */
export const storageSafeSegment = (name: string) =>
  withoutDotSegments(
    sanitizeFileName(name)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
  ).slice(0, 120) || "file";
