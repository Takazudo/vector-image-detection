import { describe, expect, it } from "vitest";
import { nearDuplicateGroups } from "./near-duplicate-groups.js";
import { normalizeVector } from "./vector-math.js";

function vec(...values: number[]): Float32Array {
  return normalizeVector(Float32Array.from(values));
}

describe("nearDuplicateGroups", () => {
  it("groups vectors at or above the threshold, transitively", () => {
    // a-b and b-c are each near-identical, chaining a-b-c into one group
    // even though a and c alone are somewhat less similar.
    const a = vec(1, 0.001, 0);
    const b = vec(1, 0, 0.001);
    const c = vec(1, 0, 0.002);
    const outlier = vec(0, 1, 0);

    const groups = nearDuplicateGroups([a, b, c, outlier], 0.999);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual([0, 1, 2]);
  });

  it("drops singleton groups (no near-duplicate found)", () => {
    const a = vec(1, 0, 0);
    const b = vec(0, 1, 0);
    const c = vec(0, 0, 1);
    expect(nearDuplicateGroups([a, b, c], 0.95)).toEqual([]);
  });

  it("treats the threshold as inclusive (>=), not exclusive (<)", () => {
    const a = vec(1, 0);
    const b = vec(0, 1); // orthogonal: cosine similarity exactly 0
    expect(nearDuplicateGroups([a, b], 0)).toEqual([[0, 1]]); // 0 >= 0 -> grouped
    expect(nearDuplicateGroups([a, b], 0.01)).toEqual([]); // 0 < 0.01 -> not grouped
  });

  it("returns an empty array for fewer than 2 vectors", () => {
    expect(nearDuplicateGroups([], 0.95)).toEqual([]);
    expect(nearDuplicateGroups([vec(1, 0)], 0.95)).toEqual([]);
  });
});
