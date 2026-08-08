import { describe, expect, it } from "vitest";
import { suggestK } from "./suggest-k.js";
import { makeBlobs } from "./test-fixtures.js";

const CENTERS = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
];

describe("suggestK", () => {
  it("finds the planted k on well-separated blobs", () => {
    const { vectors } = makeBlobs(CENTERS, 15, { seed: 11, jitter: 0.04 });
    const { k, scores } = suggestK(vectors, [2, 3, 4, 5], { seed: 42 });

    expect(k).toBe(3);
    expect(scores.map((s) => s.k)).toEqual([2, 3, 4, 5]);
    const scoreFor3 = scores.find((s) => s.k === 3)!;
    expect(scoreFor3.score).toBeGreaterThan(0.5);
  });

  it("is deterministic — same seed produces identical scores twice", () => {
    const { vectors } = makeBlobs(CENTERS, 10, { seed: 2 });
    const first = suggestK(vectors, [2, 3, 4], { seed: 42 });
    const second = suggestK(vectors, [2, 3, 4], { seed: 42 });
    expect(second).toEqual(first);
  });

  it("subsamples above maxSampleSize and still finds the planted k", () => {
    const { vectors } = makeBlobs(CENTERS, 200, { seed: 9, jitter: 0.05 }); // 600 vectors
    const { k } = suggestK(vectors, [2, 3, 4], { seed: 42, maxSampleSize: 60 });
    expect(k).toBe(3);
  });

  it("rejects fewer than 2 vectors", () => {
    expect(() => suggestK([new Float32Array([1, 0])])).toThrow();
  });
});
