import { describe, expect, it } from "vitest";
import { FakeEmbedder } from "../embedding/fake-embedder.js";
import { InMemoryVectorStore } from "../store/in-memory-vector-store.js";
import type { SearchHit, Vector, VectorStore, VectorStoreItem } from "../types.js";
import { proposeTagPropagation } from "./propose-tag-propagation.js";

function vec(...values: number[]): Vector {
  return Float32Array.from(values);
}

function dot(a: Vector, b: Vector): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

/**
 * A `VectorStore` that reproduces `QdrantVectorStore`'s search()
 * truncate-then-filter ordering: it ranks all items, takes only the first
 * `k` (raw, *before* applying `filter`), and filters that fixed-size
 * window — same shape of bug as Qdrant's real "filter is client-side after
 * an internal over-fetch cap" behavior, just with a tighter (unscaled) raw
 * window so the failure is trivial to trigger deterministically in a unit
 * test. Used to prove `proposeTagPropagation`'s widen-retry loop actually
 * recovers candidates a naive single-shot `search()` call would miss.
 */
class TruncateThenFilterStore implements VectorStore {
  private readonly items = new Map<string, VectorStoreItem>();

  constructor(items: VectorStoreItem[]) {
    for (const item of items) this.items.set(item.id, item);
  }

  async upsert(items: VectorStoreItem[]): Promise<void> {
    for (const item of items) this.items.set(item.id, item);
  }

  async search(
    vector: Vector,
    k: number,
    filter?: (payload: Record<string, unknown> | undefined) => boolean,
  ): Promise<SearchHit[]> {
    const ranked = [...this.items.values()]
      .map((item) => ({ id: item.id, score: dot(vector, item.vector), payload: item.payload }))
      .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
    const rawWindow = ranked.slice(0, k);
    return filter ? rawWindow.filter((hit) => filter(hit.payload)) : rawWindow;
  }

  async delete(ids: string[]): Promise<void> {
    for (const id of ids) this.items.delete(id);
  }

  async count(): Promise<number> {
    return this.items.size;
  }

  async get(ids: string[]): Promise<VectorStoreItem[]> {
    const found: VectorStoreItem[] = [];
    for (const id of ids) {
      const item = this.items.get(id);
      if (item) found.push(item);
    }
    return found;
  }
}

const CAT_IDS = ["cat-1", "cat-2", "cat-3", "cat-4", "cat-5"];
const DOG_IDS = ["dog-1", "dog-2"];

/** cat-1..cat-5 as jittered-but-close cat vectors, dog-1/dog-2 as unrelated. `taggedCatIds` pre-marks those items with the "cat" tag. */
async function buildStore(taggedCatIds: string[] = []): Promise<InMemoryVectorStore> {
  const embedder = new FakeEmbedder({ dim: 16 });
  const catVectors = await embedder.embedImages(CAT_IDS.map((id) => ({ keyword: "cat", id })));
  const dogVectors = await embedder.embedImages(DOG_IDS.map((id) => ({ keyword: "dog", id })));

  const items: VectorStoreItem[] = [
    ...CAT_IDS.map((id, i) => ({
      id,
      vector: catVectors[i] as Vector,
      payload: { tags: taggedCatIds.includes(id) ? ["cat"] : [] },
    })),
    ...DOG_IDS.map((id, i) => ({ id, vector: dogVectors[i] as Vector, payload: { tags: [] as string[] } })),
  ];
  return new InMemoryVectorStore(items);
}

describe("proposeTagPropagation", () => {
  it("proposes untagged near neighbors of a single exemplar, excluding the exemplar itself and unrelated items", async () => {
    const store = await buildStore(["cat-1"]);

    const proposals = await proposeTagPropagation(store, ["cat-1"], "cat");
    const ids = proposals.map((p) => p.id).sort();

    expect(ids).toEqual(["cat-2", "cat-3", "cat-4", "cat-5"]);
    for (const p of proposals) expect(p.score).toBeGreaterThanOrEqual(0.75);
  });

  it("excludes items that already carry the tag, even if they'd otherwise qualify", async () => {
    const store = await buildStore(["cat-1", "cat-2"]);

    const proposals = await proposeTagPropagation(store, ["cat-1"], "cat");
    const ids = proposals.map((p) => p.id).sort();

    expect(ids).toEqual(["cat-3", "cat-4", "cat-5"]);
  });

  it("means multiple exemplars and excludes every exemplar from the results", async () => {
    const store = await buildStore();

    const proposals = await proposeTagPropagation(store, ["cat-1", "cat-2"], "cat");
    const ids = proposals.map((p) => p.id).sort();

    expect(ids).toEqual(["cat-3", "cat-4", "cat-5"]);
  });

  it("respects the threshold — a strict threshold can exclude everything", async () => {
    const store = await buildStore(["cat-1"]);

    const proposals = await proposeTagPropagation(store, ["cat-1"], "cat", { threshold: 0.999 });
    expect(proposals).toEqual([]);
  });

  it("respects the limit, keeping the highest-scoring proposals", async () => {
    const store = await buildStore(["cat-1"]);

    const proposals = await proposeTagPropagation(store, ["cat-1"], "cat", { limit: 2 });
    expect(proposals).toHaveLength(2);
    // Sorted by score descending.
    expect(proposals[0]!.score).toBeGreaterThanOrEqual(proposals[1]!.score);
  });

  it("throws when an exemplar id is not found in the store", async () => {
    const store = await buildStore(["cat-1"]);
    await expect(proposeTagPropagation(store, ["cat-1", "missing-id"], "cat")).rejects.toThrow(/missing-id/);
  });

  it("throws when exemplarIds is empty", async () => {
    const store = await buildStore();
    await expect(proposeTagPropagation(store, [], "cat")).rejects.toThrow();
  });

  it("never mutates any item's tags — proposals only", async () => {
    const store = await buildStore(["cat-1"]);
    await proposeTagPropagation(store, ["cat-1"], "cat");

    const [cat3] = await store.get(["cat-3"]);
    expect(cat3!.payload).toEqual({ tags: [] });
  });

  it("widens the search when a store's filter truncates before excluding already-tagged items", async () => {
    // 20 items score 1.0 but are already tagged "x" (they'd fill up any
    // small raw window and get filtered out entirely); 3 real untagged
    // candidates score slightly lower, just behind them in rank.
    const distractors: VectorStoreItem[] = Array.from({ length: 20 }, (_, i) => ({
      id: `distractor-${i}`,
      vector: vec(1, 0),
      payload: { tags: ["x"] },
    }));
    const candidates: VectorStoreItem[] = Array.from({ length: 3 }, (_, i) => ({
      id: `candidate-${i}`,
      vector: vec(0.99, Math.sqrt(1 - 0.99 * 0.99)),
      payload: { tags: [] as string[] },
    }));
    const exemplar: VectorStoreItem = { id: "exemplar-1", vector: vec(1, 0), payload: { tags: ["x"] } };
    const store = new TruncateThenFilterStore([exemplar, ...distractors, ...candidates]);

    // A single search(meanVector, limit + exemplarIds.length=4) against this
    // store would return zero hits — its raw top-4 window is entirely
    // already-tagged distractors, filtered down to nothing.
    const proposals = await proposeTagPropagation(store, ["exemplar-1"], "x", { limit: 3, threshold: 0.9 });

    expect(proposals.map((p) => p.id).sort()).toEqual(["candidate-0", "candidate-1", "candidate-2"]);
  });
});
