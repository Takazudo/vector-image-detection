// Integration test against a real Qdrant instance — gated on QDRANT_URL so
// it skips cleanly (no Docker/network required) in CI and everywhere else
// QDRANT_URL isn't set. To run it locally:
//   docker run -p 6333:6333 -p 6334:6334 -v "$(pwd)/qdrant_storage:/qdrant/storage:z" qdrant/qdrant
//   QDRANT_URL=http://localhost:6333 pnpm --filter @vector-image-detection/core exec vitest run src/store/qdrant-vector-store.test.ts
import { QdrantClient } from "@qdrant/js-client-rest";
import { afterAll, describe, expect, it } from "vitest";
import { QdrantVectorStore } from "./qdrant-vector-store.js";

const QDRANT_URL = process.env.QDRANT_URL;
const DIM = 4;
const COLLECTION = `vec-store-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

function vec(...values: number[]): Float32Array {
  return Float32Array.from(values);
}

describe.skipIf(!QDRANT_URL)("QdrantVectorStore (integration, requires QDRANT_URL)", () => {
  afterAll(async () => {
    if (!QDRANT_URL) return;
    await new QdrantClient({ url: QDRANT_URL }).deleteCollection(COLLECTION).catch(() => {});
  });

  it("creates the collection, upserts, searches, deletes, and counts", async () => {
    const store = new QdrantVectorStore({
      url: QDRANT_URL as string,
      collection: COLLECTION,
      dim: DIM,
    });

    await store.ensureCollection();
    // Idempotent — calling again must not throw or recreate.
    await store.ensureCollection();

    await store.upsert([
      { id: "cat-1.jpg", vector: vec(1, 0, 0, 0), payload: { tags: ["cat"] } },
      { id: "dog-1.jpg", vector: vec(0, 1, 0, 0), payload: { tags: ["dog"] } },
      { id: "cat-2.jpg", vector: vec(0.9, 0.1, 0, 0), payload: { tags: ["cat"] } },
    ]);

    expect(await store.count()).toBe(3);

    const hits = await store.search(vec(1, 0, 0, 0), 2);
    expect(hits.map((h) => h.id)).toEqual(["cat-1.jpg", "cat-2.jpg"]);
    expect(hits[0]?.payload).toMatchObject({ tags: ["cat"] });

    const filtered = await store.search(
      vec(1, 0, 0, 0),
      5,
      (payload) => Array.isArray(payload?.tags) && (payload.tags as string[]).includes("dog"),
    );
    expect(filtered.map((h) => h.id)).toEqual(["dog-1.jpg"]);

    // Re-upserting the same source id updates the point rather than duplicating it.
    await store.upsert([
      { id: "cat-1.jpg", vector: vec(1, 0, 0, 0), payload: { tags: ["cat", "confirmed"] } },
    ]);
    expect(await store.count()).toBe(3);

    await store.delete(["dog-1.jpg"]);
    expect(await store.count()).toBe(2);
  });

  it("gets items by id with vectors, in request order, skipping missing ids and the internal point-id payload key", async () => {
    const store = new QdrantVectorStore({
      url: QDRANT_URL as string,
      collection: COLLECTION,
      dim: DIM,
    });
    await store.upsert([
      { id: "cat-3.jpg", vector: vec(1, 0, 0, 0), payload: { tags: ["cat"] } },
      { id: "cat-4.jpg", vector: vec(0, 0, 1, 0), payload: { tags: [] } },
    ]);

    const found = await store.get(["cat-4.jpg", "missing.jpg", "cat-3.jpg"]);
    expect(found.map((i) => i.id)).toEqual(["cat-4.jpg", "cat-3.jpg"]);
    expect(Array.from(found[0]!.vector)).toEqual([0, 0, 1, 0]);
    expect(found[1]!.payload).toEqual({ tags: ["cat"] });

    expect(await store.get([])).toEqual([]);
  });

  it("dropCollection removes every point and ensureCollection recreates a fresh collection afterward", async () => {
    const collection = `${COLLECTION}-drop`;
    const store = new QdrantVectorStore({ url: QDRANT_URL as string, collection, dim: DIM });

    await store.upsert([{ id: "a.jpg", vector: vec(1, 0, 0, 0), payload: {} }]);
    expect(await store.count()).toBe(1);

    await store.dropCollection();
    // Idempotent — dropping an already-absent collection must not throw.
    await store.dropCollection();

    await store.upsert([{ id: "b.jpg", vector: vec(0, 1, 0, 0), payload: {} }]);
    expect(await store.count()).toBe(1);
    expect(await store.get(["a.jpg"])).toEqual([]);

    await new QdrantClient({ url: QDRANT_URL as string })
      .deleteCollection(collection)
      .catch(() => {});
  });
});
