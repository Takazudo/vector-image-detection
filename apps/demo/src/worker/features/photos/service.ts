import { VALIDATION_LIMITS } from "../../config";
import type {
  PhotoDetail,
  PhotoSummary,
  SourceAttribution,
  SupportedImageMimeType,
  UploadOperationState,
} from "../../contracts/domain";
import type { EnrichQueueMessage } from "../../contracts/queue";
import type { PlatformProviders } from "../../providers";
import type { ValidatedImage } from "./image";

const PENDING_ETAG = "pending-r2-write";
const SEED_COLLECTION_VERSION = "public-ai-photo-library-v1";

export interface UploadInput {
  image: ValidatedImage;
  filename: string;
  attribution?: SourceAttribution;
  seed?: { id: string; sourcePath: string; checksum: string };
}

export interface UploadResult {
  operationId: string;
  photoId: string;
  state: UploadOperationState;
  retryable: boolean;
  errorCode: string | null;
  updatedAt: string;
}

export class PhotoServiceError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(status: number, code: string, message: string, retryable = false) {
    super(message);
    this.name = "PhotoServiceError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export async function enforceUploadQuota(
  providers: PlatformProviders,
  subjectKey: string,
): Promise<void> {
  const rate = await providers.rateLimit.limit({ key: subjectKey });
  if (!rate.success)
    throw new PhotoServiceError(429, "rate_limited", "Upload rate limit exceeded.", true);

  const now = providers.clock.now();
  const windowStart = `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
  const expiresAt = new Date(Date.parse(windowStart) + 86_400_000).toISOString();
  const result = await providers.database
    .prepare(
      `INSERT INTO quota_counters
       (scope, subject_key, window_start, window_seconds, used, quota_limit, updated_at, expires_at)
     VALUES ('global_upload', 'all', ?, 86400, 1, ?, ?, ?)
     ON CONFLICT(scope, subject_key, window_start) DO UPDATE SET
       used = used + 1, updated_at = excluded.updated_at
     WHERE quota_counters.used < quota_counters.quota_limit`,
    )
    .bind(windowStart, VALIDATION_LIMITS.dailyUploadQuota, now.toISOString(), expiresAt)
    .run();
  if (result.meta.changes !== 1) {
    throw new PhotoServiceError(429, "daily_quota_exceeded", "Daily upload quota exceeded.", true);
  }
}

async function reserveStoredPhotoQuota(providers: PlatformProviders): Promise<void> {
  const now = providers.clock.now();
  const stored = await providers.database
    .prepare(
      `INSERT INTO quota_counters
       (scope, subject_key, window_start, window_seconds, used, quota_limit, updated_at, expires_at)
       SELECT 'global_stored_photo', 'all', '1970-01-01T00:00:00.000Z', 253402300799,
         current_count + 1, ?, ?, '9999-12-31T23:59:59.999Z'
       FROM (SELECT COUNT(*) AS current_count FROM photos WHERE state NOT IN ('tombstoned', 'failed'))
       WHERE current_count < ?
       ON CONFLICT(scope, subject_key, window_start) DO UPDATE SET
         used = used + 1, updated_at = excluded.updated_at
       WHERE quota_counters.used < quota_counters.quota_limit`,
    )
    .bind(
      VALIDATION_LIMITS.globalStoredPhotoQuota,
      now.toISOString(),
      VALIDATION_LIMITS.globalStoredPhotoQuota,
    )
    .run();
  if (stored.meta.changes !== 1) {
    throw new PhotoServiceError(
      503,
      "storage_quota_exceeded",
      "Photo storage quota reached.",
      true,
    );
  }
}

export async function releaseStoredPhotoQuota(
  database: D1Database,
  timestamp: string,
): Promise<void> {
  await database
    .prepare(
      `UPDATE quota_counters SET used = MAX(0, used - 1), updated_at = ?
       WHERE scope = 'global_stored_photo' AND subject_key = 'all'
       AND window_start = '1970-01-01T00:00:00.000Z'`,
    )
    .bind(timestamp)
    .run();
}

export async function createPhotoUpload(
  providers: PlatformProviders,
  input: UploadInput,
): Promise<UploadResult> {
  const now = providers.clock.now();
  const timestamp = now.toISOString();
  const operationId = input.seed ? `seed-op-${input.seed.id}` : providers.ids.generate();
  const photoId = input.seed ? `seed-${input.seed.id}` : providers.ids.generate();
  const objectKey = `photos/${photoId}/${providers.ids.generate()}`;
  const expiresAt = new Date(
    now.getTime() + VALIDATION_LIMITS.uploadOperationExpirySeconds * 1_000,
  ).toISOString();
  const attribution = input.attribution;

  await reserveStoredPhotoQuota(providers);
  try {
    await providers.database.batch([
      providers.database
        .prepare(
          `INSERT INTO upload_operations
       (id, photo_id, state, client_filename, declared_mime_type, detected_mime_type,
        expected_byte_size, actual_byte_size, expected_sha256, actual_sha256, r2_object_key,
        attempt_count, created_at, updated_at, expires_at)
       VALUES (?, NULL, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        )
        .bind(
          operationId,
          input.filename,
          input.image.mimeType,
          input.image.mimeType,
          input.image.byteSize,
          input.image.byteSize,
          input.image.sha256,
          input.image.sha256,
          objectKey,
          timestamp,
          timestamp,
          expiresAt,
        ),
      providers.database
        .prepare(
          `INSERT INTO photos
       (id, state, mime_type, byte_size, width, height, sha256, r2_object_key, r2_etag,
        r2_uploaded_at, upload_operation_id, source_url, license_name, license_url,
        author_name, author_url, seed_collection_version, seed_source_path, seed_sha256,
        created_at, updated_at)
       VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          photoId,
          input.image.mimeType,
          input.image.byteSize,
          input.image.width,
          input.image.height,
          input.image.sha256,
          objectKey,
          PENDING_ETAG,
          timestamp,
          operationId,
          attribution?.sourceUrl ?? null,
          attribution?.licenseName ?? null,
          attribution?.licenseUrl ?? null,
          attribution?.authorName ?? null,
          attribution?.authorUrl ?? null,
          input.seed ? SEED_COLLECTION_VERSION : null,
          input.seed?.sourcePath ?? null,
          input.seed?.checksum ?? null,
          timestamp,
          timestamp,
        ),
      providers.database
        .prepare("UPDATE upload_operations SET photo_id = ?, updated_at = ? WHERE id = ?")
        .bind(photoId, timestamp, operationId),
    ]);
  } catch (error) {
    await releaseQuotaAfterFailure(providers);
    throw error;
  }

  let stored: R2Object;
  try {
    stored = await providers.photos.put(objectKey, input.image.bytes, {
      httpMetadata: { contentType: input.image.mimeType },
      customMetadata: { photoId, operationId, sha256: input.image.sha256 },
      sha256: input.image.sha256,
    });
  } catch (error) {
    await recordUploadFailure(providers, operationId, photoId, "r2_write_failed", error, true);
    await releaseQuotaAfterFailure(providers);
    throw new PhotoServiceError(503, "r2_write_failed", "Image storage temporarily failed.", true);
  }

  const queueOperationId = providers.ids.generate();
  const message: EnrichQueueMessage = {
    version: 1,
    type: "enrich",
    operationId: queueOperationId,
    photoId,
    requestedDocumentRevision: 1,
    enqueuedAt: timestamp,
  };
  try {
    await providers.database.batch([
      providers.database
        .prepare(
          `UPDATE upload_operations SET state = 'object_stored', r2_version = ?, r2_etag = ?,
         r2_uploaded_at = ?, r2_custom_metadata_json = ?, object_stored_at = ?, updated_at = ?
         WHERE id = ? AND state = 'pending'`,
        )
        .bind(
          stored.version,
          stored.etag,
          timestamp,
          JSON.stringify(stored.customMetadata ?? {}),
          timestamp,
          timestamp,
          operationId,
        ),
      providers.database
        .prepare(
          `UPDATE photos SET r2_version = ?, r2_etag = ?, r2_uploaded_at = ?,
         r2_custom_metadata_json = ?, reindex_required_revision = 1, updated_at = ? WHERE id = ?`,
        )
        .bind(
          stored.version,
          stored.etag,
          timestamp,
          JSON.stringify(stored.customMetadata ?? {}),
          timestamp,
          photoId,
        ),
      providers.database
        .prepare(
          `INSERT INTO queue_outbox
         (id, operation_id, photo_id, requested_document_revision, message_type, payload_version,
          payload_json, state, attempt_count, available_at, created_at, updated_at)
         VALUES (?, ?, ?, 1, 'enrich', 1, ?, 'pending', 0, ?, ?, ?)`,
        )
        .bind(
          providers.ids.generate(),
          queueOperationId,
          photoId,
          JSON.stringify(message),
          timestamp,
          timestamp,
          timestamp,
        ),
      providers.database
        .prepare(
          "UPDATE upload_operations SET state = 'completed', completed_at = ?, updated_at = ? WHERE id = ?",
        )
        .bind(timestamp, timestamp, operationId),
    ]);
  } catch (error) {
    try {
      await providers.photos.delete(objectKey);
    } catch {
      // The durable operation and object key intentionally remain for repair.
    }
    await recordUploadFailure(
      providers,
      operationId,
      photoId,
      "post_r2_database_failed",
      error,
      true,
    );
    await releaseQuotaAfterFailure(providers);
    throw new PhotoServiceError(
      503,
      "post_r2_database_failed",
      "Upload finalization temporarily failed.",
      true,
    );
  }

  try {
    await providers.queue.send(message);
    await providers.database
      .prepare(
        "UPDATE queue_outbox SET state = 'dispatched', dispatched_at = ?, updated_at = ? WHERE operation_id = ?",
      )
      .bind(timestamp, timestamp, queueOperationId)
      .run();
  } catch (error) {
    const summary = errorMessage(error);
    await providers.database.batch([
      providers.database
        .prepare(
          `UPDATE photos SET state = 'enqueue_failed', last_error_code = 'queue_dispatch_failed',
         last_error_message = ?, last_error_retryable = 1, updated_at = ? WHERE id = ?`,
        )
        .bind(summary, timestamp, photoId),
      providers.database
        .prepare(
          `UPDATE upload_operations SET state = 'enqueue_failed', error_code = 'queue_dispatch_failed',
         error_message = ?, error_retryable = 1, updated_at = ? WHERE id = ?`,
        )
        .bind(summary, timestamp, operationId),
      providers.database
        .prepare(
          `UPDATE queue_outbox SET state = 'pending', last_error_code = 'queue_dispatch_failed',
         last_error_message = ?, updated_at = ? WHERE operation_id = ?`,
        )
        .bind(summary, timestamp, queueOperationId),
    ]);
    return {
      operationId,
      photoId,
      state: "enqueue_failed",
      retryable: true,
      errorCode: "queue_dispatch_failed",
      updatedAt: timestamp,
    };
  }

  return {
    operationId,
    photoId,
    state: "completed",
    retryable: false,
    errorCode: null,
    updatedAt: timestamp,
  };
}

export async function findUnchangedSeed(
  database: D1Database,
  sourcePath: string,
  checksum: string,
): Promise<{ id: string } | null> {
  return database
    .prepare(
      `SELECT id FROM photos WHERE seed_collection_version = ? AND seed_source_path = ?
     AND seed_sha256 = ? AND state <> 'tombstoned' LIMIT 1`,
    )
    .bind(SEED_COLLECTION_VERSION, sourcePath, checksum)
    .first<{ id: string }>();
}

export async function getUploadStatus(database: D1Database, operationId: string) {
  return database
    .prepare(
      `SELECT id AS operationId, photo_id AS photoId, state, error_retryable AS retryable,
      error_code AS errorCode, updated_at AS updatedAt FROM upload_operations WHERE id = ?`,
    )
    .bind(operationId)
    .first<{
      operationId: string;
      photoId: string | null;
      state: UploadOperationState;
      retryable: number;
      errorCode: string | null;
      updatedAt: string;
    }>();
}

export async function listReadyPhotos(
  database: D1Database,
  limit: number,
  cursor: { createdAt: string; id: string } | null,
): Promise<{ items: PhotoSummary[]; nextCursor: string | null }> {
  const statement = cursor
    ? database
        .prepare(
          `SELECT * FROM photos WHERE state = 'ready' AND (created_at < ? OR (created_at = ? AND id < ?))
       ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .bind(cursor.createdAt, cursor.createdAt, cursor.id, limit + 1)
    : database
        .prepare(
          "SELECT * FROM photos WHERE state = 'ready' ORDER BY created_at DESC, id DESC LIMIT ?",
        )
        .bind(limit + 1);
  const { results } = await statement.all<PhotoRow>();
  const visible = results.slice(0, limit);
  const items = await Promise.all(visible.map((row) => hydrateSummary(database, row)));
  const last = visible.at(-1);
  return {
    items,
    nextCursor: results.length > limit && last ? encodeCursor(last.created_at, last.id) : null,
  };
}

export async function getReadyPhoto(
  database: D1Database,
  photoId: string,
): Promise<PhotoDetail | null> {
  const row = await database
    .prepare("SELECT * FROM photos WHERE id = ? AND state = 'ready'")
    .bind(photoId)
    .first<PhotoRow>();
  if (!row) return null;
  return {
    ...(await hydrateSummary(database, row)),
    byteSize: row.byte_size,
    sha256: row.sha256,
    aiCaption: row.ai_caption,
    canonicalIndexedRevision: row.canonical_indexed_revision,
    reindexRequiredRevision: row.reindex_required_revision,
  };
}

export function decodeCursor(value: string | null): { createdAt: string; id: string } | null {
  if (!value) return null;
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const parsed: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    return typeof record.createdAt === "string" &&
      !Number.isNaN(Date.parse(record.createdAt)) &&
      typeof record.id === "string" &&
      record.id.length >= 1 &&
      record.id.length <= 47
      ? { createdAt: record.createdAt, id: record.id }
      : null;
  } catch {
    return null;
  }
}

interface PhotoRow {
  id: string;
  state: PhotoSummary["state"];
  mime_type: SupportedImageMimeType;
  byte_size: number;
  width: number;
  height: number;
  sha256: string;
  created_at: string;
  ready_at: string | null;
  document_revision: number;
  ai_caption: string | null;
  canonical_indexed_revision: number | null;
  reindex_required_revision: number | null;
  source_url: string | null;
  license_name: string | null;
  license_url: string | null;
  author_name: string | null;
  author_url: string | null;
}

async function hydrateSummary(database: D1Database, row: PhotoRow): Promise<PhotoSummary> {
  const words = await database
    .prepare(
      `SELECT word, normalized_word AS normalizedWord, confidence, model_run_id AS modelRunId,
       document_revision AS documentRevision FROM photo_ai_words
       WHERE photo_id = ? AND document_revision = ? ORDER BY position`,
    )
    .bind(row.id, row.document_revision)
    .all<{
      word: string;
      normalizedWord: string;
      confidence: number | null;
      modelRunId: string;
      documentRevision: number;
    }>();
  const tags = await database
    .prepare(
      `SELECT h.id, h.name, h.normalized_name AS normalizedName, h.created_at AS createdAt
       FROM human_tags h JOIN photo_human_tags p ON p.tag_id = h.id
       WHERE p.photo_id = ? ORDER BY h.normalized_name`,
    )
    .bind(row.id)
    .all<{ id: string; name: string; normalizedName: string; createdAt: string }>();
  const hasAttribution = [
    row.source_url,
    row.license_name,
    row.license_url,
    row.author_name,
    row.author_url,
  ].some(Boolean);
  return {
    id: row.id,
    state: row.state,
    width: row.width,
    height: row.height,
    mimeType: row.mime_type,
    mediaUrl: `/api/v1/photos/${encodeURIComponent(row.id)}/media`,
    createdAt: row.created_at,
    readyAt: row.ready_at,
    documentRevision: row.document_revision,
    aiWords: words.results.map((word) => ({ kind: "ai-word", ...word })),
    humanTags: tags.results.map((tag) => ({ kind: "human-tag", ...tag })),
    attribution: hasAttribution
      ? {
          sourceUrl: row.source_url,
          licenseName: row.license_name,
          licenseUrl: row.license_url,
          authorName: row.author_name,
          authorUrl: row.author_url,
        }
      : null,
  };
}

function encodeCursor(createdAt: string, id: string): string {
  return btoa(JSON.stringify({ createdAt, id }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function recordUploadFailure(
  providers: PlatformProviders,
  operationId: string,
  photoId: string,
  code: string,
  error: unknown,
  retryable: boolean,
): Promise<void> {
  const timestamp = providers.clock.now().toISOString();
  const message = errorMessage(error);
  try {
    await providers.database.batch([
      providers.database
        .prepare(
          `UPDATE upload_operations SET state = 'failed', error_code = ?, error_message = ?,
         error_retryable = ?, attempt_count = attempt_count + 1, updated_at = ? WHERE id = ?`,
        )
        .bind(code, message, retryable ? 1 : 0, timestamp, operationId),
      providers.database
        .prepare(
          `UPDATE photos SET state = 'failed', last_error_code = ?, last_error_message = ?,
         last_error_retryable = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(code, message, retryable ? 1 : 0, timestamp, photoId),
    ]);
  } catch {
    // The original durable rows are still eligible for expiry repair.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1_000) : "unknown provider failure";
}

async function releaseQuotaAfterFailure(providers: PlatformProviders): Promise<void> {
  try {
    await releaseStoredPhotoQuota(providers.database, providers.clock.now().toISOString());
  } catch {
    console.error(JSON.stringify({ event: "stored_photo_quota_release_failed" }));
  }
}
