import { VALIDATION_LIMITS } from "../../config";
import { vectorIdFor } from "../../contracts/domain";
import type { PurgeQueueMessage } from "../../contracts/queue";
import type { PlatformProviders } from "../../providers";
import type { EnrichmentProviders } from "../processing/providers";

export async function requestOperatorPurge(
  providers: PlatformProviders,
  photoId: string,
  requestedBy: string,
  reason: string,
): Promise<PurgeQueueMessage> {
  const photo = await providers.database
    .prepare(
      "SELECT document_revision, r2_object_key FROM photos WHERE id = ? AND state <> 'tombstoned'",
    )
    .bind(photoId)
    .first<{ document_revision: number; r2_object_key: string }>();
  if (!photo) throw new Error("Photo not found or already tombstoned.");
  const now = providers.clock.now();
  const timestamp = now.toISOString();
  const tombstoneRevision = photo.document_revision + 1;
  const operationId = providers.ids.generate();
  const message: PurgeQueueMessage = {
    version: 1,
    type: "purge",
    operationId,
    photoId,
    tombstoneRevision,
    enqueuedAt: timestamp,
  };
  await providers.database.batch([
    providers.database
      .prepare(
        `UPDATE photos SET state = 'tombstoned', document_revision = ?, reindex_required_revision = NULL,
       tombstoned_at = ?, updated_at = ? WHERE id = ? AND state <> 'tombstoned'`,
      )
      .bind(tombstoneRevision, timestamp, timestamp, photoId),
    providers.database
      .prepare(
        `INSERT INTO tombstones
       (photo_id, tombstone_revision, reason, requested_by, purge_state, retry_count,
        created_at, updated_at, retain_until)
       VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
      )
      .bind(
        photoId,
        tombstoneRevision,
        reason.slice(0, 1_000),
        requestedBy.slice(0, 128),
        timestamp,
        timestamp,
        new Date(now.getTime() + VALIDATION_LIMITS.tombstoneRetentionSeconds * 1_000).toISOString(),
      ),
    providers.database
      .prepare(
        `INSERT INTO queue_outbox
       (id, operation_id, photo_id, requested_document_revision, message_type, payload_version,
        payload_json, state, attempt_count, available_at, created_at, updated_at)
       VALUES (?, ?, ?, NULL, 'purge', 1, ?, 'pending', 0, ?, ?, ?)`,
      )
      .bind(
        providers.ids.generate(),
        operationId,
        photoId,
        JSON.stringify(message),
        timestamp,
        timestamp,
        timestamp,
      ),
  ]);
  try {
    await providers.queue.send(message);
    await providers.database
      .prepare(
        "UPDATE queue_outbox SET state = 'dispatched', dispatched_at = ?, updated_at = ? WHERE operation_id = ?",
      )
      .bind(timestamp, timestamp, operationId)
      .run();
  } catch {
    /* Outbox repair owns delivery. */
  }
  return message;
}

export async function tombstoneExpiredPhotos(providers: PlatformProviders): Promise<number> {
  const now = providers.clock.now().toISOString();
  const rows = await providers.database
    .prepare(
      `SELECT id FROM photos WHERE retention_until IS NOT NULL AND retention_until < ?
     AND state NOT IN ('tombstoned', 'failed') ORDER BY retention_until, id LIMIT 50`,
    )
    .bind(now)
    .all<{ id: string }>();
  for (const row of rows.results) {
    await requestOperatorPurge(providers, row.id, "retention", "retention_expired");
  }
  return rows.results.length;
}

export async function purgePhoto(
  providers: PlatformProviders,
  enrichment: EnrichmentProviders,
  message: PurgeQueueMessage,
): Promise<void> {
  const row = await providers.database
    .prepare(
      `SELECT p.r2_object_key AS objectKey, p.document_revision AS documentRevision,
     p.upload_operation_id AS uploadOperationId, t.purge_state AS purgeState
     FROM photos p JOIN tombstones t ON t.photo_id = p.id
     WHERE p.id = ? AND p.state = 'tombstoned' AND t.tombstone_revision = ?`,
    )
    .bind(message.photoId, message.tombstoneRevision)
    .first<{
      objectKey: string;
      documentRevision: number;
      uploadOperationId: string;
      purgeState: string;
    }>();
  if (!row || row.purgeState === "complete") return;
  const timestamp = providers.clock.now().toISOString();
  await providers.database
    .prepare("UPDATE tombstones SET purge_state = 'processing', updated_at = ? WHERE photo_id = ?")
    .bind(timestamp, message.photoId)
    .run();
  try {
    await providers.photos.delete(row.objectKey);
    await providers.database
      .prepare("UPDATE tombstones SET r2_deleted_at = ?, updated_at = ? WHERE photo_id = ?")
      .bind(timestamp, timestamp, message.photoId)
      .run();
    for (let revision = 1; revision <= row.documentRevision; revision += 100) {
      const count = Math.min(100, row.documentRevision - revision + 1);
      const vectorIds = Array.from({ length: count }, (_, index) =>
        vectorIdFor(message.photoId, revision + index),
      );
      await enrichment.deleteVectors(vectorIds);
    }
    await providers.database
      .prepare("UPDATE tombstones SET vectors_deleted_at = ?, updated_at = ? WHERE photo_id = ?")
      .bind(timestamp, timestamp, message.photoId)
      .run();
    const completedAt = providers.clock.now().toISOString();
    await providers.database.batch([
      providers.database
        .prepare("DELETE FROM photos WHERE id = ? AND state = 'tombstoned'")
        .bind(message.photoId),
      providers.database
        .prepare("DELETE FROM upload_operations WHERE id = ?")
        .bind(row.uploadOperationId),
      providers.database
        .prepare(
          `UPDATE quota_counters SET used = MAX(0, used - 1), updated_at = ?
         WHERE scope = 'global_stored_photo' AND subject_key = 'all'
         AND window_start = '1970-01-01T00:00:00.000Z'`,
        )
        .bind(completedAt),
      providers.database
        .prepare(
          `UPDATE tombstones SET purge_state = 'complete', database_purged_at = ?,
         last_error = NULL, updated_at = ? WHERE photo_id = ?`,
        )
        .bind(completedAt, completedAt, message.photoId),
    ]);
  } catch (error) {
    await providers.database
      .prepare(
        `UPDATE tombstones SET purge_state = 'failed', retry_count = retry_count + 1,
       last_error = ?, updated_at = ? WHERE photo_id = ?`,
      )
      .bind(
        error instanceof Error ? error.message.slice(0, 1_000) : "purge failure",
        timestamp,
        message.photoId,
      )
      .run();
    throw error;
  }
}
