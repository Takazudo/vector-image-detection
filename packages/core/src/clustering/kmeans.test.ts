import { describe, expect, it } from "vitest";
import { kmeans } from "./kmeans.js";
import { makeBlobs } from "./test-fixtures.js";

const CENTERS = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

describe("kmeans", () => {
  it("recovers 3 well-separated planted clusters", () => {
    const { vectors, labels } = makeBlobs(CENTERS, 20, { seed: 7, jitter: 0.05 });
    const { assignments, centroids, inertia } = kmeans(vectors, 3, { seed: 42 });

    expect(assignments).toHaveLength(vectors.length);
    expect(centroids).toHaveLength(3);
    expect(inertia).toBeGreaterThanOrEqual(0);

    // kmeans's own cluster ids are an arbitrary permutation of 0..k-1, so
    // compare via the induced partition rather than raw ids: every point
    // sharing a planted label must share a cluster assignment, and
    // distinct labels must map to distinct clusters.
    const labelToAssignment = new Map<number, number>();
    for (let i = 0; i < vectors.length; i++) {
      const label = labels[i]!;
      const assignment = assignments[i]!;
      const expected = labelToAssignment.get(label);
      if (expected === undefined) labelToAssignment.set(label, assignment);
      else expect(assignment).toBe(expected);
    }
    expect(new Set(labelToAssignment.values()).size).toBe(3);
  });

  it("is deterministic — same seed produces identical output twice", () => {
    const { vectors } = makeBlobs(CENTERS, 15, { seed: 3 });
    const first = kmeans(vectors, 3, { seed: 42 });
    const second = kmeans(vectors, 3, { seed: 42 });

    expect(second.assignments).toEqual(first.assignments);
    expect(second.inertia).toBe(first.inertia);
    for (let c = 0; c < 3; c++) {
      expect(Array.from(second.centroids[c]!)).toEqual(Array.from(first.centroids[c]!));
    }
  });

  it("produces unit-length centroids", () => {
    const { vectors } = makeBlobs(CENTERS, 10, { seed: 5 });
    const { centroids } = kmeans(vectors, 3, { seed: 42 });
    for (const centroid of centroids) {
      let sumSquares = 0;
      for (const value of centroid) sumSquares += value * value;
      expect(Math.sqrt(sumSquares)).toBeCloseTo(1, 5);
    }
  });

  it("rejects invalid k", () => {
    const { vectors } = makeBlobs(CENTERS, 5, { seed: 1 });
    expect(() => kmeans(vectors, 0)).toThrow();
    expect(() => kmeans(vectors, vectors.length + 1)).toThrow();
  });

  it("rejects empty input", () => {
    expect(() => kmeans([], 2)).toThrow();
  });
});
