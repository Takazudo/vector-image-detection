import { describe, expect, it } from "vitest";
import type { Vector } from "../types.js";
import { softmaxOverVocab, zeroShotTag } from "./zero-shot-tag.js";

function vec(...values: number[]): Vector {
  return Float32Array.from(values);
}

describe("zeroShotTag", () => {
  const vocab = new Map<string, Vector>([
    ["cat", vec(1, 0)],
    ["dog", vec(0.7071068, 0.7071068)],
    ["led", vec(0, 1)],
  ]);

  it("keeps labels at or above threshold, drops labels below it", () => {
    const [scores] = zeroShotTag([vec(1, 0)], vocab, { threshold: 0.5 });

    expect(scores!.map((s) => s.label)).toEqual(["cat", "dog"]);
    expect(scores![0]!.score).toBeCloseTo(1, 5);
    expect(scores![1]!.score).toBeCloseTo(0.7071068, 5);
  });

  it("returns only the exact match at a high threshold, and nothing when none qualify", () => {
    const [scores] = zeroShotTag([vec(0, 1)], vocab, { threshold: 0.9 });
    // vec(0,1) matches "led" exactly (score 1) but nothing else clears 0.9.
    expect(scores!.map((s) => s.label)).toEqual(["led"]);

    const [none] = zeroShotTag([vec(-1, 0)], vocab, { threshold: 0.9 });
    expect(none).toEqual([]);
  });

  it("sorts by score descending, ties broken by label ascending", () => {
    const tiedVocab = new Map<string, Vector>([
      ["zebra", vec(1, 0)],
      ["ant", vec(1, 0)],
    ]);
    const [scores] = zeroShotTag([vec(1, 0)], tiedVocab, { threshold: 0 });
    expect(scores!.map((s) => s.label)).toEqual(["ant", "zebra"]);
  });

  it("uses the default threshold of 0.2 when unset", () => {
    // "led"'s score here is 0.15 (below the 0.2 default), "cat" and "dog"
    // score above it — exercises the default without passing `threshold`.
    const [scores] = zeroShotTag([vec(Math.sqrt(1 - 0.15 * 0.15), 0.15)], vocab);
    expect(scores!.map((s) => s.label)).toEqual(["cat", "dog"]);
  });

  it("scores every image independently, in input order", () => {
    const results = zeroShotTag([vec(1, 0), vec(0, 1)], vocab, { threshold: 0.5 });
    expect(results).toHaveLength(2);
    expect(results[0]!.map((s) => s.label)).toEqual(["cat", "dog"]);
    expect(results[1]!.map((s) => s.label)).toEqual(["led", "dog"]);
  });
});

describe("softmaxOverVocab", () => {
  it("normalizes scores to sum to 1 while preserving rank order", () => {
    const scores = [
      { label: "cat", score: 0.9 },
      { label: "dog", score: 0.4 },
      { label: "led", score: 0.1 },
    ];
    const normalized = softmaxOverVocab(scores);

    const total = normalized.reduce((sum, s) => sum + s.score, 0);
    expect(total).toBeCloseTo(1, 6);
    expect(normalized.map((s) => s.label)).toEqual(["cat", "dog", "led"]);
    expect(normalized[0]!.score).toBeGreaterThan(normalized[1]!.score);
    expect(normalized[1]!.score).toBeGreaterThan(normalized[2]!.score);
  });

  it("returns an empty array for an empty input", () => {
    expect(softmaxOverVocab([])).toEqual([]);
  });

  it("a lower temperature sharpens the distribution toward the top score", () => {
    const scores = [
      { label: "a", score: 0.9 },
      { label: "b", score: 0.4 },
    ];
    const sharp = softmaxOverVocab(scores, 0.1);
    const soft = softmaxOverVocab(scores, 5);

    expect(sharp[0]!.score).toBeGreaterThan(soft[0]!.score);
  });
});
