import { describe, expect, it } from "vitest";
import { FakeEmbedder } from "../embedding/fake-embedder.js";
import { InMemoryVectorStore } from "../store/in-memory-vector-store.js";
import type { Vector, VectorStoreItem } from "../types.js";
import { proposeTagPropagation } from "./propose-tag-propagation.js";

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
});
