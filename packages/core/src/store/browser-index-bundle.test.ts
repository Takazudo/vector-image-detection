import { describe, expect, it } from "vitest";
import type { IndexMeta } from "../types.js";
import { loadIndexFromUrl } from "./browser-index-bundle.js";
import { IndexModelMismatchError, encodeVectors } from "./index-bundle-codec.js";

function sampleMeta(): IndexMeta {
  return {
    formatVersion: 1,
    modelId: "fake-embedder-v1",
    dim: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    items: [
      { id: "a", file: "a.jpg", tags: ["cat"] },
      { id: "b", file: "b.jpg", tags: [] },
    ],
  };
}

const sampleVectors = () => [Float32Array.from([1, 0]), Float32Array.from([0, 1])];

/** Minimal `fetch`-shaped stand-in serving meta.json/embeddings.bin ArrayBuffer fixtures. */
function fakeFetch(meta: IndexMeta, vectors: Float32Array[]) {
  const embeddingsBuffer = encodeVectors(vectors, meta.dim);
  const calls: string[] = [];

  const impl = async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("meta.json")) {
      return {
        ok: true,
        status: 200,
        json: async () => meta,
        arrayBuffer: async () => {
          throw new Error("not used");
        },
      } as unknown as Response;
    }
    if (url.endsWith("embeddings.bin")) {
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("not used");
        },
        arrayBuffer: async () => embeddingsBuffer,
      } as unknown as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  return { impl, calls };
}

describe("loadIndexFromUrl", () => {
  it("fetches meta.json + embeddings.bin and decodes bit-exact vectors", async () => {
    const meta = sampleMeta();
    const vectors = sampleVectors();
    const { impl } = fakeFetch(meta, vectors);

    const loaded = await loadIndexFromUrl("https://example.com/index", impl);
    expect(loaded.meta).toEqual(meta);
    expect(loaded.vectors).toHaveLength(2);
    expect(loaded.vectors[0]).toEqual(vectors[0]);
    expect(loaded.vectors[1]).toEqual(vectors[1]);
  });

  it("normalizes baseUrl with or without a trailing slash to the same requests", async () => {
    const meta = sampleMeta();
    const { impl: implA, calls: callsA } = fakeFetch(meta, sampleVectors());
    const { impl: implB, calls: callsB } = fakeFetch(meta, sampleVectors());

    await loadIndexFromUrl("https://example.com/index", implA);
    await loadIndexFromUrl("https://example.com/index/", implB);

    expect(callsA).toEqual(callsB);
    expect(callsA).toEqual([
      "https://example.com/index/meta.json",
      "https://example.com/index/embeddings.bin",
    ]);
  });

  it("accepts a site-relative baseUrl (not just absolute URLs)", async () => {
    // `new URL(file, base)` would throw "Invalid URL" for a relative base
    // like this — plain string concatenation must be used instead.
    const meta = sampleMeta();
    const { impl, calls } = fakeFetch(meta, sampleVectors());

    const loaded = await loadIndexFromUrl("/data/index", impl);
    expect(loaded.meta).toEqual(meta);
    expect(calls).toEqual(["/data/index/meta.json", "/data/index/embeddings.bin"]);
  });

  it("throws IndexModelMismatchError when expected modelId/dim disagrees", async () => {
    const { impl } = fakeFetch(sampleMeta(), sampleVectors());
    await expect(
      loadIndexFromUrl("https://example.com/index", impl, { modelId: "other", dim: 2 }),
    ).rejects.toThrow(IndexModelMismatchError);
  });

  it("throws a descriptive error when meta.json fetch fails", async () => {
    const impl = async () => ({ ok: false, status: 404 }) as unknown as Response;
    await expect(loadIndexFromUrl("https://example.com/index", impl)).rejects.toThrow(/404/);
  });
});
