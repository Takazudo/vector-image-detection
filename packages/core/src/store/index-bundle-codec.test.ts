import { describe, expect, it } from "vitest";
import type { IndexMeta } from "../types.js";
import {
  IndexModelMismatchError,
  assertModelMatch,
  decodeVectors,
  encodeVectors,
  storeFromIndex,
} from "./index-bundle-codec.js";

describe("encodeVectors / decodeVectors", () => {
  it("round-trips bit-exact through an ArrayBuffer", () => {
    const vectors = [Float32Array.from([1, 0, -0.5]), Float32Array.from([0.25, 0.125, -1])];
    const buffer = encodeVectors(vectors, 3);
    expect(buffer.byteLength).toBe(vectors.length * 3 * 4);

    const decoded = decodeVectors(buffer, vectors.length, 3);
    expect(decoded).toHaveLength(2);
    for (let i = 0; i < vectors.length; i++) {
      expect(decoded[i]).toEqual(vectors[i]);
    }
  });

  it("throws when a vector's length doesn't match dim", () => {
    expect(() => encodeVectors([Float32Array.from([1, 2])], 3)).toThrow(/dim/);
  });

  it("throws when the buffer size doesn't match itemCount x dim", () => {
    const buffer = encodeVectors([Float32Array.from([1, 2])], 2);
    expect(() => decodeVectors(buffer, 2, 2)).toThrow(/corrupt|out of sync/);
  });

  it("encodes explicitly little-endian, independent of host endianness", () => {
    const [vector] = [Float32Array.from([1])];
    const buffer = encodeVectors([vector as Float32Array], 1);
    const view = new DataView(buffer);
    expect(view.getFloat32(0, true)).toBe(1);
  });
});

describe("assertModelMatch / IndexModelMismatchError", () => {
  it("does not throw when no expectation is given", () => {
    expect(() => assertModelMatch({ modelId: "a", dim: 4 })).not.toThrow();
  });

  it("does not throw when modelId and dim match", () => {
    expect(() =>
      assertModelMatch({ modelId: "a", dim: 4 }, { modelId: "a", dim: 4 }),
    ).not.toThrow();
  });

  it("throws IndexModelMismatchError with a 're-run ingest' message on mismatch", () => {
    let caught: unknown;
    try {
      assertModelMatch({ modelId: "model-b", dim: 8 }, { modelId: "model-a", dim: 4 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(IndexModelMismatchError);
    const mismatch = caught as IndexModelMismatchError;
    expect(mismatch.expected).toEqual({ modelId: "model-a", dim: 4 });
    expect(mismatch.actual).toEqual({ modelId: "model-b", dim: 8 });
    expect(mismatch.message).toMatch(/re-run ingest/);
  });
});

describe("storeFromIndex", () => {
  it("builds a store with payload carrying every non-id IndexItem field", async () => {
    const meta: Pick<IndexMeta, "items"> = {
      items: [
        {
          id: "a",
          file: "a.jpg",
          tags: ["cat"],
          knownLabel: "cat",
          source: "sample-set",
          license: "CC0",
          author: "someone",
        },
        { id: "b", file: "b.jpg", tags: [] },
      ],
    };
    const vectors = [Float32Array.from([1, 0]), Float32Array.from([0, 1])];

    const store = storeFromIndex(meta, vectors);
    expect(await store.count()).toBe(2);

    const [hit] = await store.search(Float32Array.from([1, 0]), 1);
    expect(hit?.id).toBe("a");
    expect(hit?.payload).toEqual({
      file: "a.jpg",
      tags: ["cat"],
      knownLabel: "cat",
      source: "sample-set",
      license: "CC0",
      author: "someone",
    });
  });

  it("throws when items and vectors counts disagree", () => {
    const meta: Pick<IndexMeta, "items"> = { items: [{ id: "a", file: "a.jpg", tags: [] }] };
    expect(() => storeFromIndex(meta, [])).toThrow(/vectors/);
  });
});
