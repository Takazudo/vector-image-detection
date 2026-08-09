import { photoQueueMessageSchema, type PhotoQueueMessage } from "../../contracts/queue";
import type { PlatformProviders } from "../../providers";

const DEFAULT_DISPATCH_LIMIT = 25;

interface OutboxRow {
  id: string;
  payload_json: string;
}

export interface OutboxDispatchResult {
  attempted: number;
  dispatched: number;
  failed: number;
}

/**
 * Repairs unsent reindex work. Sending intentionally happens before marking the
 * row dispatched, so interruption can duplicate delivery but cannot lose work.
 */
export async function dispatchPendingReindexOutbox(
  providers: PlatformProviders,
  limit = DEFAULT_DISPATCH_LIMIT,
): Promise<OutboxDispatchResult> {
  const boundedLimit = Number.isSafeInteger(limit)
    ? Math.max(1, Math.min(DEFAULT_DISPATCH_LIMIT, limit))
    : DEFAULT_DISPATCH_LIMIT;
  const now = providers.clock.now();
  const nowIso = now.toISOString();
  const rows = await providers.database
    .prepare(
      `SELECT id, payload_json FROM queue_outbox
       WHERE message_type = 'reindex' AND available_at <= ?
         AND (state IN ('pending', 'failed') OR (state = 'dispatching' AND lease_expires_at <= ?))
       ORDER BY available_at ASC, created_at ASC, id ASC
       LIMIT ?`,
    )
    .bind(nowIso, nowIso, boundedLimit)
    .all<OutboxRow>();
  const result: OutboxDispatchResult = { attempted: 0, dispatched: 0, failed: 0 };

  for (const row of rows.results) {
    const message = parseOutboxMessage(row.payload_json);
    const leaseToken = providers.ids.generate();
    const leaseExpiresAt = new Date(now.getTime() + 60_000).toISOString();
    const claim = await providers.database
      .prepare(
        `UPDATE queue_outbox SET
           state = 'dispatching', lease_token = ?, lease_expires_at = ?,
           attempt_count = attempt_count + 1, updated_at = ?
         WHERE id = ? AND (
           state IN ('pending', 'failed') OR (state = 'dispatching' AND lease_expires_at <= ?)
         )`,
      )
      .bind(leaseToken, leaseExpiresAt, nowIso, row.id, nowIso)
      .run();
    if ((claim.meta.changes ?? 0) !== 1) continue;
    result.attempted += 1;
    try {
      await providers.queue.send(message, { contentType: "json" });
      await providers.database
        .prepare(
          `UPDATE queue_outbox SET
             state = 'dispatched', lease_token = NULL, lease_expires_at = NULL,
             dispatched_at = ?, updated_at = ?, last_error_code = NULL, last_error_message = NULL
           WHERE id = ? AND state = 'dispatching' AND lease_token = ?`,
        )
        .bind(nowIso, nowIso, row.id, leaseToken)
        .run();
      result.dispatched += 1;
    } catch (error) {
      await providers.database
        .prepare(
          `UPDATE queue_outbox SET
             state = 'failed', lease_token = NULL, lease_expires_at = NULL,
             available_at = ?, updated_at = ?, last_error_code = 'queue_send_failed',
             last_error_message = ?
           WHERE id = ? AND state = 'dispatching' AND lease_token = ?`,
        )
        .bind(
          nowIso,
          nowIso,
          error instanceof Error ? error.message.slice(0, 1024) : "unknown error",
          row.id,
          leaseToken,
        )
        .run();
      result.failed += 1;
    }
  }
  return result;
}

function parseOutboxMessage(payload: string): PhotoQueueMessage {
  const parsed = photoQueueMessageSchema.safeParse(JSON.parse(payload));
  if (!parsed.success || parsed.data.type !== "reindex") {
    throw new Error("Invalid reindex outbox payload");
  }
  return parsed.data;
}
