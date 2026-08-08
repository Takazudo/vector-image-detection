import { describe, expect, it } from "vitest";
import { FakeEmbedder } from "../embedding/fake-embedder.js";
import type { Vector } from "../types.js";
import { classifyByVocab } from "./classify-by-vocab.js";
import { embedVocab } from "./embed-vocab.js";

function vec(...values: number[]): Vector {
  return Float32Array.from(values);
}

describe("classifyByVocab", () => {
  it("argmax-classifies aligned fake-space images to their matching vocab label", async () => {
    const embedder = new FakeEmbedder({ dim: 32 });
    const vocabVectors = await embedVocab(embedder, ["cat", "dog"]);

    const images = await embedder.embedImages(["photos/cat-01.jpg", "photos/dog-02.jpg", "photos/cat-03.jpg"]);
    const results = classifyByVocab(images, vocabVectors);

    expect(results.map((r) => r.label)).toEqual(["cat", "dog", "cat"]);
    for (const r of results) expect(r.score).toBeGreaterThan(0.5);
  });

  it("picks the single highest-scoring label, ignoring lower scorers", () => {
    const vocabVectors = new Map<string, Vector>([
      ["cat", vec(1, 0)],
      ["dog", vec(0.7071068, 0.7071068)],
    ]);
    const [result] = classifyByVocab([vec(1, 0)], vocabVectors);
    expect(result).toEqual({ label: "cat", score: 1 });
  });

  it("breaks ties by label ascending", () => {
    const vocabVectors = new Map<string, Vector>([
      ["zebra", vec(1, 0)],
      ["ant", vec(1, 0)],
    ]);
    const [result] = classifyByVocab([vec(1, 0)], vocabVectors);
    expect(result!.label).toBe("ant");
  });

  it("rejects an empty vocabulary", () => {
    expect(() => classifyByVocab([vec(1, 0)], new Map())).toThrow();
  });
});
