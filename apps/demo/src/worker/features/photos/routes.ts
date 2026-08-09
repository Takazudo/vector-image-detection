import { VALIDATION_LIMITS } from "../../config";
import type { SourceAttribution } from "../../contracts/domain";
import {
  apiError,
  defineApiRoute,
  json,
  type ApiRequestContext,
  type ApiRoute,
} from "../../router";
import { paginationSchema } from "../../validation";
import { ImageValidationError, validateImageFile } from "./image";
import {
  createPhotoUpload,
  decodeCursor,
  enforceUploadQuota,
  getReadyPhoto,
  getUploadStatus,
  listReadyPhotos,
  PhotoServiceError,
} from "./service";

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export const photoRoutes: readonly ApiRoute[] = [
  defineApiRoute("POST", "/api/v1/photos", uploadPhoto),
  defineApiRoute("GET", "/api/v1/photos", listPhotos),
  defineApiRoute("GET", "/api/v1/photos/:photoId", getPhoto),
  defineApiRoute("GET", "/api/v1/uploads/:operationId", uploadStatus),
  defineApiRoute("GET", "/api/v1/photos/:photoId/media", getMedia),
];

async function uploadPhoto(request: Request, context: ApiRequestContext): Promise<Response> {
  const requestId = context.providers.ids.generate();
  try {
    requirePublicUpload(request, context);
    const contentLength = Number(request.headers.get("content-length"));
    if (!Number.isSafeInteger(contentLength) || contentLength < 1) {
      throw new PhotoServiceError(
        411,
        "content_length_required",
        "A bounded Content-Length is required.",
      );
    }
    if (contentLength > VALIDATION_LIMITS.maximumUploadBytes + MULTIPART_OVERHEAD_BYTES) {
      throw new PhotoServiceError(413, "upload_too_large", "Multipart upload exceeds 5 MiB.");
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) {
      throw new PhotoServiceError(415, "multipart_required", "Use multipart/form-data.");
    }
    const form = await request.formData();
    const files = form.getAll("file");
    const allFiles = [...form.values()].filter((value): value is File => value instanceof File);
    if (files.length !== 1 || allFiles.length !== 1 || !(files[0] instanceof File)) {
      throw new PhotoServiceError(400, "one_file_required", "Exactly one file field is required.");
    }
    const image = await validateImageFile(files[0]);
    const attribution = parseAttribution(form.get("attribution"));
    await enforceUploadQuota(
      context.providers,
      request.headers.get("cf-connecting-ip") ?? "unidentified-client",
    );
    const result = await createPhotoUpload(context.providers, {
      image,
      filename: files[0].name || "upload",
      ...(attribution ? { attribution } : {}),
    });
    return json({ version: "v1", ...result }, 202);
  } catch (error) {
    if (error instanceof PhotoServiceError) {
      return apiError(requestId, error.status, error.code, error.message, error.retryable);
    }
    if (error instanceof ImageValidationError) {
      return apiError(
        requestId,
        error.code === "invalid_size" ? 413 : 415,
        error.code,
        error.message,
      );
    }
    return apiError(requestId, 500, "upload_failed", "Upload could not be completed.", true);
  }
}

async function listPhotos(request: Request, context: ApiRequestContext): Promise<Response> {
  const url = new URL(request.url);
  const parsed = paginationSchema.safeParse({
    version: url.searchParams.get("version") ?? "v1",
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success)
    return apiError(
      context.providers.ids.generate(),
      400,
      "invalid_pagination",
      "Invalid gallery pagination.",
    );
  const cursor = decodeCursor(parsed.data.cursor ?? null);
  if (parsed.data.cursor && !cursor)
    return apiError(
      context.providers.ids.generate(),
      400,
      "invalid_cursor",
      "Invalid gallery cursor.",
    );
  const result = await listReadyPhotos(context.providers.database, parsed.data.limit, cursor);
  return json({ version: "v1", ...result });
}

async function getPhoto(_request: Request, context: ApiRequestContext): Promise<Response> {
  const photo = await getReadyPhoto(context.providers.database, context.params.photoId ?? "");
  return photo ? json({ version: "v1", photo }) : notFound(context);
}

async function uploadStatus(_request: Request, context: ApiRequestContext): Promise<Response> {
  const status = await getUploadStatus(
    context.providers.database,
    context.params.operationId ?? "",
  );
  if (!status) return notFound(context);
  return json({ version: "v1", ...status, retryable: status.retryable === 1 });
}

async function getMedia(request: Request, context: ApiRequestContext): Promise<Response> {
  const row = await context.providers.database
    .prepare(
      `SELECT id, mime_type AS mimeType, byte_size AS byteSize, r2_object_key AS objectKey,
     r2_etag AS etag FROM photos WHERE id = ? AND state = 'ready'`,
    )
    .bind(context.params.photoId ?? "")
    .first<{
      id: string;
      mimeType: string;
      byteSize: number;
      objectKey: string;
      etag: string;
    }>();
  if (!row) return notFound(context);
  const object = await context.providers.photos.get(row.objectKey);
  if (!object || object.size !== row.byteSize) return notFound(context);
  const etag = object.httpEtag || `"${row.etag}"`;
  const headers = mediaHeaders(row.mimeType, object.size, etag);
  if (request.headers.get("if-none-match") === etag)
    return new Response(null, { status: 304, headers });
  return new Response(object.body, { status: 200, headers });
}

function requirePublicUpload(request: Request, context: ApiRequestContext): void {
  validateUploadRequestHeaders(request, context.providers.operator.settings().publicWritesEnabled);
}

export function validateUploadRequestHeaders(request: Request, publicWritesEnabled: boolean): void {
  if (!publicWritesEnabled) {
    throw new PhotoServiceError(503, "public_writes_disabled", "Public uploads are disabled.");
  }
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin) {
    throw new PhotoServiceError(403, "cross_site_request", "Upload must be same-origin.");
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") {
    throw new PhotoServiceError(403, "cross_site_request", "Upload must be same-origin.");
  }
}

function parseAttribution(value: string | File | null): SourceAttribution | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 2_048) {
    throw new PhotoServiceError(
      400,
      "invalid_attribution",
      "Attribution must be a small JSON object.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new PhotoServiceError(400, "invalid_attribution", "Attribution JSON is invalid.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new PhotoServiceError(400, "invalid_attribution", "Attribution JSON is invalid.");
  }
  const record = parsed as Record<string, unknown>;
  const fields = ["sourceUrl", "licenseName", "licenseUrl", "authorName", "authorUrl"] as const;
  for (const field of fields) {
    if (
      record[field] !== null &&
      record[field] !== undefined &&
      typeof record[field] !== "string"
    ) {
      throw new PhotoServiceError(
        400,
        "invalid_attribution",
        "Attribution values must be strings or null.",
      );
    }
  }
  return {
    sourceUrl: boundedUrl(record.sourceUrl),
    licenseName: boundedText(record.licenseName),
    licenseUrl: boundedUrl(record.licenseUrl),
    authorName: boundedText(record.authorName),
    authorUrl: boundedUrl(record.authorUrl),
  };
}

function boundedUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value);
  if (text.length > 1_024)
    throw new PhotoServiceError(400, "invalid_attribution", "Attribution URL is too long.");
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("protocol");
  } catch {
    throw new PhotoServiceError(400, "invalid_attribution", "Attribution URL is invalid.");
  }
  return text;
}

function boundedText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (text.length > 128)
    throw new PhotoServiceError(400, "invalid_attribution", "Attribution text is too long.");
  return text || null;
}

export function mediaHeaders(mimeType: string, byteSize: number, etag: string): Headers {
  return new Headers({
    "content-type": mimeType,
    "content-length": String(byteSize),
    "content-disposition": "inline",
    "cache-control": "public, max-age=3600, immutable",
    etag,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
  });
}

function notFound(context: ApiRequestContext): Response {
  return apiError(context.providers.ids.generate(), 404, "not_found", "Photo not found.");
}
