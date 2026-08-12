import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { WORKER_INTEGRATION_TIMEOUT_MS } from "../../../../test-support/worker-timeouts";
import { applyMigration } from "../../../../test-support/apply-migration";
import type { BulkHumanTagMutationRequest } from "../../contracts/api";
import type { ReindexQueueMessage } from "../../contracts/queue";
import type { PlatformProviders } from "../../providers";
import { mutateHumanTag } from "../tags/mutation";
import { handleReindexMessage } from "../tags/reindex";
import { getRelatedPhotos } from "./related";
import migration from "../../../../migrations/0001_public_photo_library.sql?raw";

// #75 acceptance criterion: canonical-revision filtering must be verified after
// a *real* human-tag revision bump, not just a plain read of pre-seeded rows —
// see related.worker.test.ts's "rejects a stale generation" test for that
// synthetic case. This file drives the actual production pipeline instead:
// attach a tag through mutateHumanTag (bumps document_revision, enqueues a
// reindex job), settle the reindex through handleReindexMessage (the same
// handler the Queue consumer calls), and only then assert on getRelatedPhotos.
describe("related photos after a real human-tag revision bump", () => {
  beforeAll(async () => {
    await applyMigration(env.DB, migration);
  });

  it("stops surfacing a sibling's pre-bump vector generation once its reindex settles", async () => {
    const database = env.DB;
    await seedReadyPhoto(database, "revbump-source", 1);
    await seedReadyPhoto(database, "revbump-sibling", 1);

    const queued: ReindexQueueMessage[] = [];
    const mutationProviders = integrationMutationProviders(database, queued);

    const mutationResponse = await mutateHumanTag(
      {
        version: "v1",
        action: "attach",
        photoIds: ["revbump-sibling"],
        humanTagNames: ["studio-light"],
      } satisfies BulkHumanTagMutationRequest,
      { quotaSubject: "integration-test" },
      mutationProviders,
    );
    expect(mutationResponse.results).toMatchObject([
      { photoId: "revbump-sibling", status: "updated", documentRevision: 2 },
    ]);
    expect(queued).toHaveLength(1);

    // Let the reindex settle: process the queued job for real, through the
    // same handler the Queue consumer calls. This is what actually advances
    // canonical_indexed_revision/canonical_vector_id in D1 from 1 to 2.
    const outcome = await handleReindexMessage(queued[0]!, mutationProviders);
    expect(outcome).toBe("indexed");

    const settled = await database
      .prepare("SELECT canonical_indexed_revision, canonical_vector_id FROM photos WHERE id = ?")
      .bind("revbump-sibling")
      .first<{ canonical_indexed_revision: number; canonical_vector_id: string }>();
    expect(settled?.canonical_indexed_revision).toBe(2);
    expect(settled?.canonical_vector_id).toBe("revbump-sibling:2");

    // Vectorize still holds a leftover match for the sibling's pre-bump vector
    // (revision 1) alongside its fresh post-bump vector (revision 2) — the
    // exact eventual-consistency shape a live index has right after a reindex
    // settles, before the stale point is ever swept.
    const response = await getRelatedPhotos(
      "revbump-source",
      { version: "v1" },
      fakeQueryProviders(database, async () => ({
        count: 3,
        matches: [
          { id: "revbump-source:1", score: 1 },
          { id: "revbump-sibling:1", score: 0.97 },
          { id: "revbump-sibling:2", score: 0.95 },
        ],
      })),
    );

    expect(response).not.toBe("not_found");
    const result = response as Exclude<typeof response, "not_found">;
    expect(result.items.map((item) => item.photo.id)).toEqual(["revbump-sibling"]);
    expect(result.items[0]?.reason).toMatchObject({
      tier: "semantic",
      vectorId: "revbump-sibling:2",
    });
    expect(result.degraded).toBe(false);
  }, WORKER_INTEGRATION_TIMEOUT_MS);
});

function integrationMutationProviders(
  database: D1Database,
  queued: ReindexQueueMessage[],
): PlatformProviders {
  let nextId = 0;
  return {
    database,
    queue: {
      send: async (message: ReindexQueueMessage) => {
        queued.push(message);
        return {};
      },
      metrics: async () => ({}),
    },
    ai: { run: async () => ({ data: [Array.from({ length: 768 }, () => 0.125)] }) },
    vectorize: { upsert: async () => {} },
    clock: { now: () => new Date("2026-08-12T00:00:00.000Z") },
    ids: { generate: () => `revbump-integration-${++nextId}` },
  } as unknown as PlatformProviders;
}

function fakeQueryProviders(
  database: D1Database,
  queryById: (vectorId: string, options: Record<string, unknown>) => Promise<unknown>,
): PlatformProviders {
  return {
    database,
    vectorize: { queryById },
  } as unknown as PlatformProviders;
}

async function seedReadyPhoto(
  database: D1Database,
  id: string,
  documentRevision: number,
): Promise<void> {
  const timestamp = "2026-08-10T00:00:00.000Z";
  const objectKey = `photos/${id}`;
  const uploadId = `upload-${id}`;
  const canonicalVectorId = `${id}:${documentRevision}`;
  await database
    .prepare(
      `INSERT INTO upload_operations
       (id, photo_id, state, client_filename, declared_mime_type, detected_mime_type,
        expected_byte_size, actual_byte_size, expected_sha256, actual_sha256, r2_object_key,
        r2_etag, r2_uploaded_at, attempt_count, error_retryable, created_at, updated_at,
        expires_at, object_stored_at, completed_at)
       VALUES (?, NULL, 'completed', 'photo.png', 'image/png', 'image/png',
        8, 8, ?, ?, ?, 'etag', ?, 1, 0, ?, ?, ?, ?, ?)`,
    )
    .bind(
      uploadId,
      "a".repeat(64),
      "a".repeat(64),
      objectKey,
      timestamp,
      timestamp,
      timestamp,
      timestamp,
      timestamp,
      timestamp,
    )
    .run();
  await database
    .prepare(
      `INSERT INTO photos
       (id, state, mime_type, byte_size, width, height, sha256, r2_object_key, r2_etag,
        r2_uploaded_at, upload_operation_id, document_revision,
        canonical_indexed_revision, canonical_vector_id, created_at, updated_at, ready_at)
       VALUES (?, 'ready', 'image/png', 8, 32, 32, ?, ?, 'etag', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      "a".repeat(64),
      objectKey,
      timestamp,
      uploadId,
      documentRevision,
      documentRevision,
      canonicalVectorId,
      timestamp,
      timestamp,
      timestamp,
    )
    .run();
}
