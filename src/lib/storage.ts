import { env } from "../config/env.js";
import { AppError } from "./app-error.js";
import { logger } from "./logger.js";

/**
 * Supabase Storage access with the service role key — server side only. Browsers receive
 * short-lived signed URLs after the API has authorized the owning resource.
 */

const storageUrl = (path: string) => new URL(`/storage/v1${path}`, env.SUPABASE_URL).toString();

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
  return new URL(`/storage/v1${body.url}`, env.SUPABASE_URL).toString();
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
  const url = new URL(`/storage/v1${body.signedURL}`, env.SUPABASE_URL);
  if (options.downloadName) {
    url.searchParams.set("download", options.downloadName);
  }
  return url.toString();
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

/** Keeps names readable while removing path separators and control characters. */
export const sanitizeFileName = (name: string) => {
  const cleaned = name
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex -- stripping control characters is intended
    .replace(/[\u0000-\u001f\u007f/\\]+/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180);
  return cleaned.length > 0 ? cleaned : "file";
};

/** Object keys use ASCII only; the display name is kept in the database. */
export const storageSafeSegment = (name: string) =>
  sanitizeFileName(name)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .slice(0, 120) || "file";
