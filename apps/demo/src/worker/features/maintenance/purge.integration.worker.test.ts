import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { PlatformProviders } from "../../providers";
import { listReadyPhotos } from "../photos/service";
import { FakeEnrichmentProviders } from "../processing/providers";
import { purgePhoto, requestOperatorPurge } from "./purge";
import migration from "../../../../migrations/0001_public_photo_library.sql?raw";

describe("operator purge durability", () => {
  it("retains AI words across tag revisions and a terminal tombstone after deletion", async () => {
    await applyMigration(env.DB, migration);
    const timestamp = "2026-08-10T00:00:00.000Z";
    await env.DB.prepare(
      `INSERT INTO upload_operations
       (id, photo_id, state, client_filename, declared_mime_type, detected_mime_type,
        expected_byte_size, actual_byte_size, expected_sha256, actual_sha256, r2_object_key,
        r2_etag, r2_uploaded_at, attempt_count, error_retryable, created_at, updated_at,
        expires_at, object_stored_at, completed_at)
       VALUES ('upload-1', NULL, 'completed', 'photo.png', 'image/png', 'image/png',
        8, 8, ?, ?, 'photos/photo-1', 'etag', ?, 1, 0, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "a".repeat(64),
        "a".repeat(64),
        timestamp,
        timestamp,
        timestamp,
        timestamp,
        timestamp,
        timestamp,
      )
      .run();
    await env.DB.prepare(
      `INSERT INTO photos
       (id, state, mime_type, byte_size, width, height, sha256, r2_object_key, r2_etag,
        r2_uploaded_at, upload_operation_id, ai_caption, document_revision,
        canonical_indexed_revision, canonical_vector_id, created_at, updated_at, ready_at)
       VALUES ('photo-1', 'ready', 'image/png', 8, 32, 32, ?, 'photos/photo-1', 'etag', ?,
        'upload-1', 'A cat', 2, 2, 'photo-1:2', ?, ?, ?)`,
    )
      .bind("a".repeat(64), timestamp, timestamp, timestamp, timestamp)
      .run();
    await env.DB.prepare(
      "UPDATE upload_operations SET photo_id = 'photo-1' WHERE id = 'upload-1'",
    ).run();
    await env.DB.prepare(
      `INSERT INTO ai_model_runs
       (id, photo_id, operation_id, requested_document_revision, vision_model_id,
        embedding_model_id, prompt_version, document_version, caption, raw_output_bytes,
        started_at, completed_at)
       VALUES ('model-run-1', 'photo-1', 'enrich-1', 1,
        '@cf/moondream/moondream3.1-9B-A2B', '@cf/google/embeddinggemma-300m',
        1, 1, 'A cat', 32, ?, ?)`,
    )
      .bind(timestamp, timestamp)
      .run();
    await env.DB.prepare(
      `INSERT INTO photo_ai_words
       (photo_id, model_run_id, document_revision, word, normalized_word, confidence, position, created_at)
       VALUES ('photo-1', 'model-run-1', 1, 'cat', 'cat', NULL, 0, ?)`,
    )
      .bind(timestamp)
      .run();
    await env.DB.prepare(
      `INSERT INTO quota_counters
       (scope, subject_key, window_start, window_seconds, used, quota_limit, updated_at, expires_at)
       VALUES ('global_stored_photo', 'all', '1970-01-01T00:00:00.000Z', 253402300799,
        1, 10000, ?, '9999-12-31T23:59:59.999Z')`,
    )
      .bind(timestamp)
      .run();
    await env.PHOTOS.put(
      "photos/photo-1",
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );

    const messages: unknown[] = [];
    let nextId = 0;
    const providers = {
      assets: env.ASSETS,
      database: env.DB,
      photos: env.PHOTOS,
      queue: {
        send: async (message: unknown) => void messages.push(message),
        metrics: async () => ({}),
      },
      deadLetterQueue: { send: async () => ({}), metrics: async () => ({}) },
      ai: {},
      vectorize: {},
      rateLimit: { limit: async () => ({ success: true }) },
      clock: { now: () => new Date(timestamp) },
      ids: { generate: () => `purge-test-${++nextId}` },
      operator: {
        settings: () => ({
          environment: "ci",
          publicWritesEnabled: false,
          acknowledgeAnonymousPublicWrites: false,
          acknowledgeRetainedImageMetadata: false,
          acknowledgeReactivePurgeOnlyModeration: false,
          authGateConfigured: false,
        }),
      },
    } as unknown as PlatformProviders;

    const gallery = await listReadyPhotos(env.DB, 10, null);
    expect(gallery.items[0]?.aiWords.map((word) => word.normalizedWord)).toEqual(["cat"]);

    const message = await requestOperatorPurge(providers, "photo-1", "operator", "test");
    const enrichment = new FakeEnrichmentProviders();
    await purgePhoto(providers, enrichment, message);
    await expect(purgePhoto(providers, enrichment, message)).resolves.toBeUndefined();

    expect(await env.PHOTOS.get("photos/photo-1")).toBeNull();
    expect(await env.DB.prepare("SELECT id FROM photos WHERE id = 'photo-1'").first()).toBeNull();
    expect(
      await env.DB.prepare(
        "SELECT purge_state, database_purged_at FROM tombstones WHERE photo_id = 'photo-1'",
      ).first(),
    ).toEqual({ purge_state: "complete", database_purged_at: timestamp });
    expect(
      await env.DB.prepare(
        "SELECT used FROM quota_counters WHERE scope = 'global_stored_photo'",
      ).first(),
    ).toEqual({ used: 0 });
    expect(enrichment.deleted).toEqual(["photo-1:1", "photo-1:2", "photo-1:3"]);
  });
});

async function applyMigration(database: D1Database, source: string): Promise<void> {
  let statement = "";
  let inTrigger = false;
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("CREATE TRIGGER ")) inTrigger = true;
    statement += `${line}\n`;
    if (!trimmed.endsWith(";") || (inTrigger && trimmed !== "END;")) continue;
    await database.exec(statement.replace(/\s+/g, " "));
    statement = "";
    inTrigger = false;
  }
  expect(statement.trim()).toBe("");
}
