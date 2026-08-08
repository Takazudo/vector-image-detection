// QdrantVectorStore — VectorStore adapter backed by a Qdrant collection.
//
// Index files (meta.json + embeddings.bin, see ./node-index-bundle.ts) are
// always the source of truth; a Qdrant collection is a *derived* cache for
// production-scale ANN search. Re-syncing (calling `upsert` with the full
// item set) overwrites the collection's points — Qdrant itself is never
// authoritative for tags or any other item metadata.
//
// Point id mapping: see ./qdrant-point-id.ts — Qdrant point ids must be an
// unsigned integer or a UUID, so our string ids are hashed into a UUID
// deterministically and the original id is round-tripped via the
// `__vecStoreId` payload key (see QDRANT_SOURCE_ID_PAYLOAD_KEY).
//
// To exercise this adapter locally against a real Qdrant instance:
//   docker run -p 6333:6333 -p 6334:6334 -v "$(pwd)/qdrant_storage:/qdrant/storage:z" qdrant/qdrant
// then run the test suite with QDRANT_URL=http://localhost:6333 set — see
// qdrant-vector-store.test.ts, which skips cleanly when QDRANT_URL is unset.
import { QdrantClient } from "@qdrant/js-client-rest";
import type { SearchHit, Vector, VectorStore, VectorStoreItem } from "../types.js";
import { QDRANT_SOURCE_ID_PAYLOAD_KEY, toQdrantPointId } from "./qdrant-point-id.js";

export interface QdrantVectorStoreConfig {
  url: string;
  collection: string;
  dim: number;
}

// `search()`'s filter is an arbitrary JS predicate over the full payload, not
// expressible as a Qdrant server-side filter DSL object, so it can only be
// applied client-side after fetching candidates. To keep results correct
// enough to be useful without an unbounded number of round trips, a filtered
// search over-fetches this many candidates (or 10x k, whichever is larger)
// before filtering and truncating to k. A very selective filter over a very
// large collection may then return fewer than k hits even if more exist.
const FILTERED_SEARCH_MIN_CANDIDATES = 200;

// Max points per upsert request — bounds request size (and peak memory) when
// syncing a whole index; 256 × 768-dim float arrays stays well under default
// HTTP body limits.
const QDRANT_UPSERT_BATCH_SIZE = 256;

/** `VectorStore` backed by a Qdrant collection, via `@qdrant/js-client-rest`. */
export class QdrantVectorStore implements VectorStore {
  private readonly client: QdrantClient;
  private readonly collection: string;
  private readonly dim: number;
  private ensured: Promise<void> | undefined;

  constructor(config: QdrantVectorStoreConfig) {
    this.client = new QdrantClient({ url: config.url });
    this.collection = config.collection;
    this.dim = config.dim;
  }

  /**
   * Deletes the collection if it exists (no-op otherwise) and resets the
   * `ensureCollection` cache, so the next `upsert`/`ensureCollection` call
   * recreates it from scratch. A full drop-and-recreate is how a caller
   * makes the collection an exact "derived copy" of a rebuilt index bundle
   * — a plain re-`upsert()` only adds/updates points for the ids it's given
   * and never removes points for ids that dropped out of the source (e.g. a
   * deleted or renamed file).
   */
  async dropCollection(): Promise<void> {
    const { exists } = await this.client.collectionExists(this.collection);
    if (exists) await this.client.deleteCollection(this.collection);
    this.ensured = undefined;
  }

  /** Creates the collection (cosine distance, `dim`-sized vectors) if it doesn't exist yet. Idempotent. */
  async ensureCollection(): Promise<void> {
    this.ensured ??= (async () => {
      const { exists } = await this.client.collectionExists(this.collection);
      if (!exists) {
        await this.client.createCollection(this.collection, {
          vectors: { size: this.dim, distance: "Cosine" },
        });
      }
    })();
    return this.ensured;
  }

  async upsert(items: VectorStoreItem[]): Promise<void> {
    if (items.length === 0) return;
    await this.ensureCollection();
    // Bounded batches: one giant upsert of a whole index can exceed Qdrant/proxy
    // request-size limits and spike memory (each vector serializes to a JSON array).
    for (let i = 0; i < items.length; i += QDRANT_UPSERT_BATCH_SIZE) {
      const batch = items.slice(i, i + QDRANT_UPSERT_BATCH_SIZE);
      await this.client.upsert(this.collection, {
        wait: true,
        points: batch.map((item) => ({
          id: toQdrantPointId(item.id),
          vector: Array.from(item.vector),
          payload: { ...item.payload, [QDRANT_SOURCE_ID_PAYLOAD_KEY]: item.id },
        })),
      });
    }
  }

  async search(
    vector: Vector,
    k: number,
    filter?: (payload: Record<string, unknown> | undefined) => boolean,
  ): Promise<SearchHit[]> {
    if (k <= 0) return [];
    await this.ensureCollection();
    const limit = filter ? Math.max(k * 10, FILTERED_SEARCH_MIN_CANDIDATES) : k;

    const response = await this.client.query(this.collection, {
      query: Array.from(vector),
      limit,
      with_payload: true,
    });

    const hits: SearchHit[] = response.points.map((point) => {
      const payload = point.payload as Record<string, unknown> | undefined;
      const sourceId = payload?.[QDRANT_SOURCE_ID_PAYLOAD_KEY];
      return {
        id: typeof sourceId === "string" ? sourceId : String(point.id),
        score: point.score,
        payload,
      };
    });

    const filtered = filter ? hits.filter((hit) => filter(hit.payload)) : hits;
    return filtered.slice(0, k);
  }

  async get(ids: string[]): Promise<VectorStoreItem[]> {
    if (ids.length === 0) return [];
    await this.ensureCollection();
    const points = await this.client.retrieve(this.collection, {
      ids: ids.map(toQdrantPointId),
      with_payload: true,
      with_vector: true,
    });

    const items: VectorStoreItem[] = [];
    for (const point of points) {
      // Only the plain unnamed-vector shape is handled (matches the single
      // unnamed vector config `ensureCollection` creates) — mirrors the
      // unnamed-vector assumption already made by upsert()/search() above.
      if (!Array.isArray(point.vector)) continue;
      const payload = point.payload as Record<string, unknown> | undefined;
      const sourceId = payload?.[QDRANT_SOURCE_ID_PAYLOAD_KEY];
      const { [QDRANT_SOURCE_ID_PAYLOAD_KEY]: _sourceId, ...restPayload } = payload ?? {};
      items.push({
        id: typeof sourceId === "string" ? sourceId : String(point.id),
        vector: Float32Array.from(point.vector as number[]),
        payload: restPayload,
      });
    }

    // Preserve the caller's requested order (retrieve()'s response order is
    // not documented as matching request order).
    const byId = new Map(items.map((item) => [item.id, item]));
    return ids.map((id) => byId.get(id)).filter((item): item is VectorStoreItem => item != null);
  }

  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.ensureCollection();
    // wait: true (as with upsert above) so the deletion is applied before
    // this resolves — otherwise an immediately-following search()/count()
    // could still observe the deleted points.
    await this.client.delete(this.collection, { wait: true, points: ids.map(toQdrantPointId) });
  }

  async count(): Promise<number> {
    await this.ensureCollection();
    const info = await this.client.getCollection(this.collection);
    return info.points_count ?? 0;
  }
}
