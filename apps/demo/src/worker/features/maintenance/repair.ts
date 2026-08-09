import { VALIDATION_LIMITS } from "../../config";
import { vectorIdFor } from "../../contracts/domain";
import {
  photoQueueMessageSchema,
  type PhotoQueueMessage,
  type RepairQueueMessage,
} from "../../contracts/queue";
import type { PlatformProviders } from "../../providers";
import type { EnrichmentProviders } from "../processing/providers";

const REPAIR_BATCH_SIZE = 50;

export async function drainOutbox(providers: PlatformProviders): Promise<number> {
  const now = providers.clock.now().toISOString();
  const rows = await providers.database
    .prepare(
      `SELECT id, payload_json, attempt_count AS attemptCount FROM queue_outbox
     WHERE available_at <= ? AND (state IN ('pending', 'failed') OR (state = 'dispatching' AND lease_expires_at < ?))
       AND attempt_count < ?
     ORDER BY available_at, created_at, id LIMIT ?`,
    )
    .bind(now, now, VALIDATION_LIMITS.maximumQueueAttempts, REPAIR_BATCH_SIZE)
    .all<{ id: string; payload_json: string; attemptCount: number }>();
  let dispatched = 0;
  for (const row of rows.results) {
    const leaseToken = providers.ids.generate();
    const leaseExpiresAt = new Date(
      providers.clock.now().getTime() + VALIDATION_LIMITS.processingLeaseSeconds * 1_000,
    ).toISOString();
    const claim = await providers.database
      .prepare(
        `UPDATE queue_outbox SET state = 'dispatching', lease_token = ?, lease_expires_at = ?,
       attempt_count = attempt_count + 1, updated_at = ?
       WHERE id = ? AND (state IN ('pending', 'failed') OR (state = 'dispatching' AND lease_expires_at < ?))`,
      )
      .bind(leaseToken, leaseExpiresAt, now, row.id, now)
      .run();
    if (claim.meta.changes !== 1) continue;
    try {
      const message = photoQueueMessageSchema.parse(JSON.parse(row.payload_json));
      await providers.queue.send(message);
      await providers.database
        .prepare(
          `UPDATE queue_outbox SET state = 'dispatched', lease_token = NULL, lease_expires_at = NULL,
         dispatched_at = ?, updated_at = ?, last_error_code = NULL, last_error_message = NULL
         WHERE id = ? AND lease_token = ?`,
        )
        .bind(now, now, row.id, leaseToken)
        .run();
      dispatched++;
    } catch (error) {
      const availableAt = new Date(
        providers.clock.now().getTime() + retryBackoffMilliseconds(row.attemptCount + 1),
      ).toISOString();
      await providers.database
        .prepare(
          `UPDATE queue_outbox SET state = 'failed', lease_token = NULL, lease_expires_at = NULL,
         last_error_code = 'dispatch_failed', last_error_message = ?, available_at = ?, updated_at = ?
         WHERE id = ? AND lease_token = ?`,
        )
        .bind(errorMessage(error), availableAt, now, row.id, leaseToken)
        .run();
    }
  }
  return dispatched;
}

export async function repairExpiredUploads(providers: PlatformProviders): Promise<number> {
  const now = providers.clock.now().toISOString();
  const rows = await providers.database
    .prepare(
      `SELECT u.id, u.photo_id AS photoId, u.r2_object_key AS objectKey, p.state AS photoState
     FROM upload_operations u LEFT JOIN photos p ON p.id = u.photo_id
     WHERE u.expires_at < ? AND u.state IN ('pending', 'object_stored', 'failed', 'purge_pending')
       AND (p.id IS NULL OR p.state IN ('pending', 'failed', 'enqueue_failed'))
     ORDER BY u.expires_at, u.id LIMIT ?`,
    )
    .bind(now, REPAIR_BATCH_SIZE)
    .all<{
      id: string;
      photoId: string | null;
      objectKey: string;
      photoState: string | null;
    }>();
  let repaired = 0;
  for (const row of rows.results) {
    try {
      await providers.photos.delete(row.objectKey);
      if (row.photoId) {
        await providers.database
          .prepare("DELETE FROM photos WHERE id = ? AND state <> 'ready'")
          .bind(row.photoId)
          .run();
      }
      await providers.database
        .prepare(
          `UPDATE upload_operations SET photo_id = NULL, state = 'expired', error_code = 'upload_expired',
         error_retryable = 0, updated_at = ? WHERE id = ?`,
        )
        .bind(now, row.id)
        .run();
      repaired++;
    } catch (error) {
      await providers.database
        .prepare(
          `UPDATE upload_operations SET state = 'purge_pending', attempt_count = attempt_count + 1,
         error_code = 'cleanup_failed', error_message = ?, error_retryable = 1, updated_at = ? WHERE id = ?`,
        )
        .bind(errorMessage(error), now, row.id)
        .run();
    }
  }
  return repaired;
}

export async function recoverExpiredLeases(providers: PlatformProviders): Promise<number> {
  const now = providers.clock.now().toISOString();
  const rows = await providers.database
    .prepare(
      `SELECT id, photo_id AS photoId, message_type AS messageType,
     requested_document_revision AS revision, attempt_number AS attempt
     FROM processing_runs WHERE state = 'processing' AND lease_expires_at < ?
     ORDER BY lease_expires_at, id LIMIT ?`,
    )
    .bind(now, REPAIR_BATCH_SIZE)
    .all<{
      id: string;
      photoId: string;
      messageType: "enrich" | "reindex";
      revision: number;
      attempt: number;
    }>();
  let recovered = 0;
  for (const row of rows.results) {
    const terminal = row.attempt >= VALIDATION_LIMITS.maximumQueueAttempts;
    const updated = await providers.database
      .prepare(
        `UPDATE processing_runs SET state = ?, lease_token = NULL, lease_expires_at = NULL,
       error_code = 'lease_expired', error_message = 'Processing lease expired.', error_retryable = ?,
       completed_at = ?, updated_at = ? WHERE id = ? AND state = 'processing' AND lease_expires_at < ?`,
      )
      .bind(
        terminal ? "terminal_error" : "retryable_error",
        terminal ? 0 : 1,
        now,
        now,
        row.id,
        now,
      )
      .run();
    if (updated.meta.changes !== 1) continue;
    await providers.database
      .prepare(
        `UPDATE photos SET state = ?, last_error_code = 'lease_expired',
       last_error_message = 'Processing lease expired.', last_error_retryable = ?, updated_at = ?
       WHERE id = ? AND state = 'processing'`,
      )
      .bind(terminal ? "failed" : "enqueue_failed", terminal ? 0 : 1, now, row.photoId)
      .run();
    if (!terminal) {
      const availableAt = new Date(
        providers.clock.now().getTime() + retryBackoffMilliseconds(row.attempt),
      ).toISOString();
      await enqueueRetry(providers, row.photoId, row.messageType, row.revision, now, availableAt);
    }
    recovered++;
  }
  return recovered;
}

export async function cleanupStaleVectors(
  providers: PlatformProviders,
  enrichment: EnrichmentProviders,
): Promise<number> {
  const rows = await providers.database
    .prepare(
      `SELECT DISTINCT r.photo_id AS photoId, r.requested_document_revision AS revision
     FROM processing_runs r JOIN photos p ON p.id = r.photo_id
     WHERE r.requested_document_revision IS NOT NULL
       AND r.state IN ('succeeded', 'superseded')
       AND (p.canonical_indexed_revision IS NULL OR r.requested_document_revision <> p.canonical_indexed_revision)
       AND NOT EXISTS (
         SELECT 1 FROM purge_progress g
         WHERE g.photo_id = r.photo_id AND g.resource_type = 'vector_generation'
           AND g.resource_key = r.photo_id || ':' || r.requested_document_revision
           AND g.state = 'complete'
       )
     LIMIT ?`,
    )
    .bind(REPAIR_BATCH_SIZE)
    .all<{ photoId: string; revision: number }>();
  const ids = rows.results.map((row) => vectorIdFor(row.photoId, row.revision));
  await enrichment.deleteVectors(ids);
  if (rows.results.length > 0) {
    const timestamp = providers.clock.now().toISOString();
    await providers.database.batch(
      rows.results.map((row, index) =>
        providers.database
          .prepare(
            `INSERT OR IGNORE INTO purge_progress
             (id, photo_id, resource_type, resource_key, state, attempt_count,
              created_at, updated_at, completed_at)
             VALUES (?, ?, 'vector_generation', ?, 'complete', 1, ?, ?, ?)`,
          )
          .bind(
            `${providers.ids.generate()}-${index}`,
            row.photoId,
            vectorIdFor(row.photoId, row.revision),
            timestamp,
            timestamp,
            timestamp,
          ),
      ),
    );
  }
  return ids.length;
}

export async function handleRepairMessage(
  providers: PlatformProviders,
  enrichment: EnrichmentProviders,
  message: RepairQueueMessage,
): Promise<void> {
  switch (message.repairKind) {
    case "outbox":
      await drainOutbox(providers);
      return;
    case "upload":
      await repairExpiredUploads(providers);
      return;
    case "processing":
      await recoverExpiredLeases(providers);
      return;
    case "vector":
      await cleanupStaleVectors(providers, enrichment);
      return;
  }
}

async function enqueueRetry(
  providers: PlatformProviders,
  photoId: string,
  type: "enrich" | "reindex",
  revision: number,
  timestamp: string,
  availableAt: string,
): Promise<void> {
  const operationId = providers.ids.generate();
  const message: PhotoQueueMessage = {
    version: 1,
    type,
    operationId,
    photoId,
    requestedDocumentRevision: revision,
    enqueuedAt: timestamp,
  };
  await providers.database
    .prepare(
      `INSERT INTO queue_outbox
     (id, operation_id, photo_id, requested_document_revision, message_type, payload_version,
      payload_json, state, attempt_count, available_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, 'pending', 0, ?, ?, ?)`,
    )
    .bind(
      providers.ids.generate(),
      operationId,
      photoId,
      revision,
      type,
      JSON.stringify(message),
      availableAt,
      timestamp,
      timestamp,
    )
    .run();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1_000) : "unknown repair failure";
}

export function retryBackoffMilliseconds(attempt: number): number {
  return Math.min(60 * 60 * 1_000, 2 ** Math.max(0, attempt - 1) * 30_000);
}
