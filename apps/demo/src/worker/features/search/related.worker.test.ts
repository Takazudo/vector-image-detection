import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import type { PlatformProviders } from "../../providers";
import { applyMigration } from "../../../../test-support/apply-migration";
import { getRelatedPhotos } from "./related";
import migration from "../../../../migrations/0001_public_photo_library.sql?raw";

describe("related photos endpoint", () => {
  // Applied once for the whole file: row mutations from one test are visible
  // to the next (this pool does not roll back D1 storage between `it`s), so
  // every test below seeds its own uniquely-prefixed photo ids.
  beforeAll(async () => {
    await applyMigration(env.DB, migration);
  });

  it("excludes the source photo from its own results", async () => {
    const database = env.DB;
    await seedReadyPhoto(database, "excl-source", { canonicalIndexedRevision: 1 });
    await seedReadyPhoto(database, "excl-sibling", { canonicalIndexedRevision: 1 });

    const response = await getRelatedPhotos(
      "excl-source",
      { version: "v1" },
      fakeProviders(database, async () => ({
        count: 2,
        matches: [
          { id: "excl-source:1", score: 1 },
          { id: "excl-sibling:1", score: 0.9 },
        ],
      })),
    );

    expect(response).not.toBe("not_found");
    const result = response as Exclude<typeof response, "not_found">;
    expect(result.items.map((item) => item.photo.id)).toEqual(["excl-sibling"]);
    expect(result.degraded).toBe(false);
    expect(result.degradedReason).toBeNull();
  });

  it("rejects a stale generation the way GET /search does", async () => {
    const database = env.DB;
    await seedReadyPhoto(database, "stale-source", { canonicalIndexedRevision: 1 });
    // Vectorize still holds a leftover match for an older, non-canonical
    // generation of "stale-photo" (revision 1) even though D1's canonical
    // vector for it is now revision 2.
    await seedReadyPhoto(database, "stale-photo", { canonicalIndexedRevision: 2 });

    const response = await getRelatedPhotos(
      "stale-source",
      { version: "v1" },
      fakeProviders(database, async () => ({
        count: 2,
        matches: [
          { id: "stale-source:1", score: 1 },
          { id: "stale-photo:1", score: 0.95 },
        ],
      })),
    );

    expect(response).not.toBe("not_found");
    const result = response as Exclude<typeof response, "not_found">;
    expect(result.items).toEqual([]);
    expect(result.degraded).toBe(false);
  });

  it("reports vector_pending when the source vector resolves without itself among the matches", async () => {
    const database = env.DB;
    // D1's canonical fields are already committed, but Vectorize's async
    // upsert hasn't actually indexed the vector yet — queryById cannot even
    // return the reference vector as its own nearest neighbour.
    await seedReadyPhoto(database, "unindexed-source", { canonicalIndexedRevision: 1 });
    await seedReadyPhoto(database, "unindexed-sibling", { canonicalIndexedRevision: 1 });

    const response = await getRelatedPhotos(
      "unindexed-source",
      { version: "v1" },
      fakeProviders(database, async () => ({
        count: 1,
        matches: [{ id: "unindexed-sibling:1", score: 0.4 }],
      })),
    );

    expect(response).not.toBe("not_found");
    const result = response as Exclude<typeof response, "not_found">;
    expect(result.items).toEqual([]);
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe("vector_pending");
  });

  it("lets a D1 canonicalization failure surface as a thrown error, not a degraded response", async () => {
    const database = env.DB;
    await seedReadyPhoto(database, "d1-fail-source", { canonicalIndexedRevision: 1 });
    await seedReadyPhoto(database, "d1-fail-sibling", { canonicalIndexedRevision: 1 });

    await expect(
      getRelatedPhotos(
        "d1-fail-source",
        { version: "v1" },
        fakeProviders(
          databaseFailingCanonicalLookup(database),
          async () => ({
            count: 2,
            matches: [
              { id: "d1-fail-source:1", score: 1 },
              { id: "d1-fail-sibling:1", score: 0.5 },
            ],
          }),
        ),
      ),
    ).rejects.toThrow();
  });

  it("reports vector_pending, never an empty list, for a not-yet-indexed source photo", async () => {
    const database = env.DB;
    await seedReadyPhoto(database, "pending-source", { canonicalIndexedRevision: null });

    let providerCalled = false;
    const response = await getRelatedPhotos(
      "pending-source",
      { version: "v1" },
      fakeProviders(database, async () => {
        providerCalled = true;
        throw new Error("must not query Vectorize for an unindexed source photo");
      }),
    );

    expect(providerCalled).toBe(false);
    expect(response).not.toBe("not_found");
    const result = response as Exclude<typeof response, "not_found">;
    expect(result.items).toEqual([]);
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe("vector_pending");
  });

  it("degrades instead of throwing when the Vectorize lookup fails", async () => {
    const database = env.DB;
    await seedReadyPhoto(database, "failing-source", { canonicalIndexedRevision: 1 });

    const response = await getRelatedPhotos(
      "failing-source",
      { version: "v1" },
      fakeProviders(database, async () => {
        throw new Error("vectorize unavailable");
      }),
    );

    expect(response).not.toBe("not_found");
    const result = response as Exclude<typeof response, "not_found">;
    expect(result.items).toEqual([]);
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe("provider_unavailable");
  });

  it("reports not_found for an unknown photo id", async () => {
    const database = env.DB;

    const response = await getRelatedPhotos(
      "does-not-exist",
      { version: "v1" },
      fakeProviders(database, async () => ({ count: 0, matches: [] })),
    );

    expect(response).toBe("not_found");
  });
});

function databaseFailingCanonicalLookup(database: D1Database): D1Database {
  return {
    prepare(sql: string) {
      if (sql.includes("p.canonical_indexed_revision IS NOT NULL")) {
        return {
          bind: () => ({
            all: async () => {
              throw new Error("d1 canonical lookup failed");
            },
          }),
        };
      }
      return database.prepare(sql);
    },
  } as unknown as D1Database;
}

function fakeProviders(
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
  options: { canonicalIndexedRevision: number | null },
): Promise<void> {
  const timestamp = "2026-08-10T00:00:00.000Z";
  const objectKey = `photos/${id}`;
  const uploadId = `upload-${id}`;
  const canonicalVectorId =
    options.canonicalIndexedRevision === null ? null : `${id}:${options.canonicalIndexedRevision}`;
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
      options.canonicalIndexedRevision ?? 1,
      options.canonicalIndexedRevision,
      canonicalVectorId,
      timestamp,
      timestamp,
      timestamp,
    )
    .run();
}
