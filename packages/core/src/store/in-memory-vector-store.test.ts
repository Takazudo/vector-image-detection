import { describe, expect, it } from "vitest";
import type { Vector, VectorStoreItem } from "../types.js";
import { InMemoryVectorStore } from "./in-memory-vector-store.js";

function vec(...values: number[]): Vector {
  return Float32Array.from(values);
}

function item(id: string, vector: Vector, payload?: Record<string, unknown>): VectorStoreItem {
  return { id, vector, payload };
}

describe("InMemoryVectorStore", () => {
  it("upserts and reports count", async () => {
    const store = new InMemoryVectorStore();
    expect(await store.count()).toBe(0);

    await store.upsert([item("a", vec(1, 0)), item("b", vec(0, 1))]);
    expect(await store.count()).toBe(2);

    // Upsert with an existing id replaces, not duplicates.
    await store.upsert([item("a", vec(0, 1))]);
    expect(await store.count()).toBe(2);
  });

  it("returns exact top-k by cosine similarity (dot product on normalized vectors)", async () => {
    const store = new InMemoryVectorStore();
    await store.upsert([
      item("close", vec(1, 0)),
      item("mid", vec(0.7071068, 0.7071068)),
      item("far", vec(0, 1)),
    ]);

    const hits = await store.search(vec(1, 0), 2);
    expect(hits.map((h) => h.id)).toEqual(["close", "mid"]);
    expect(hits[0]?.score).toBeCloseTo(1, 5);
    expect(hits[1]?.score).toBeCloseTo(0.7071068, 5);
  });

  it("breaks score ties deterministically by ascending id", async () => {
    const store = new InMemoryVectorStore();
    await store.upsert([item("c", vec(1, 0)), item("a", vec(1, 0)), item("b", vec(1, 0))]);

    const hits = await store.search(vec(1, 0), 3);
    expect(hits.map((h) => h.id)).toEqual(["a", "b", "c"]);
  });

  it("returns all items when k exceeds the candidate count", async () => {
    const store = new InMemoryVectorStore();
    await store.upsert([item("a", vec(1, 0)), item("b", vec(0, 1))]);

    const hits = await store.search(vec(1, 0), 50);
    expect(hits).toHaveLength(2);
  });

  it("returns an empty array for k <= 0 and for an empty store", async () => {
    const store = new InMemoryVectorStore();
    await store.upsert([item("a", vec(1, 0))]);
    expect(await store.search(vec(1, 0), 0)).toEqual([]);
    expect(await store.search(vec(1, 0), -1)).toEqual([]);

    const empty = new InMemoryVectorStore();
    expect(await empty.search(vec(1, 0), 5)).toEqual([]);
  });

  it("applies the optional payload filter before ranking", async () => {
    const store = new InMemoryVectorStore();
    await store.upsert([
      item("a", vec(1, 0), { tags: ["cat"] }),
      item("b", vec(0.9, 0.1), { tags: ["dog"] }),
      item("c", vec(0.8, 0.2), { tags: ["cat"] }),
    ]);

    const hits = await store.search(
      vec(1, 0),
      5,
      (payload) => Array.isArray(payload?.tags) && (payload.tags as string[]).includes("cat"),
    );
    expect(hits.map((h) => h.id)).toEqual(["a", "c"]);
  });

  it("deletes items by id", async () => {
    const store = new InMemoryVectorStore();
    await store.upsert([item("a", vec(1, 0)), item("b", vec(0, 1))]);
    await store.delete(["a"]);
    expect(await store.count()).toBe(1);
    const hits = await store.search(vec(1, 0), 5);
    expect(hits.map((h) => h.id)).toEqual(["b"]);
  });

  it("accepts an initial item set via the constructor", async () => {
    const store = new InMemoryVectorStore([item("seed", vec(1, 0))]);
    expect(await store.count()).toBe(1);
  });

  it("carries payload through to search hits", async () => {
    const store = new InMemoryVectorStore();
    await store.upsert([item("a", vec(1, 0), { file: "a.jpg", tags: [] })]);
    const [hit] = await store.search(vec(1, 0), 1);
    expect(hit?.payload).toEqual({ file: "a.jpg", tags: [] });
  });
});
