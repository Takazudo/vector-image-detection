import type { Vector } from "../types.js";
import { dot } from "./vector-math.js";

/**
 * Groups near-duplicate vectors by greedy linking: any pair with cosine
 * similarity `>= threshold` is unioned (union-find), so a group can chain
 * transitively — a~b and b~c links a and c into one group even if a and c
 * alone fall under `threshold`. Only groups of size >= 2 are returned;
 * singletons (no near-duplicate found) are dropped.
 *
 * Exploratory grouping (see `kmeans` JSDoc): "near duplicate" here means
 * vector-similar, which can include genuinely distinct photos of a
 * visually similar subject, not just re-encodes of the same image.
 *
 * O(n^2) pairwise comparisons — no seeded randomness is involved, so this
 * has no `seed` option and is deterministic by construction.
 */
export function nearDuplicateGroups(vectors: Vector[], threshold = 0.95): number[][] {
  const n = vectors.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  }

  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (dot(vectors[i]!, vectors[j]!) >= threshold) union(i, j);
    }
  }

  const groupsByRoot = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const group = groupsByRoot.get(root);
    if (group) group.push(i);
    else groupsByRoot.set(root, [i]);
  }

  return [...groupsByRoot.values()]
    .filter((group) => group.length >= 2)
    .sort((a, b) => a[0]! - b[0]!);
}
