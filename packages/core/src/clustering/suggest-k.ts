import type { Vector } from "../types.js";
import { kmeans } from "./kmeans.js";
import { mulberry32, sampleIndices } from "./prng.js";
import { cosineDistance } from "./vector-math.js";

export interface SuggestKOptions {
  seed?: number;
  maxIter?: number;
  /** Above this many vectors, silhouette scoring runs on a seeded subsample instead. Default 2000. */
  maxSampleSize?: number;
}

export interface SuggestKScore {
  k: number;
  score: number;
}

export interface SuggestKResult {
  /** The candidate k with the highest mean silhouette score. */
  k: number;
  /** Mean silhouette score for every candidate k that was evaluable, in `kRange` order. */
  scores: SuggestKScore[];
}

const DEFAULT_K_RANGE = [2, 3, 4, 5, 6, 7, 8];
const DEFAULT_MAX_SAMPLE_SIZE = 2000;

/**
 * Suggests a cluster count `k` by mean silhouette score (cosine distance)
 * over a set of candidate `k` values — a heuristic for "how many
 * exploratory groups does this data support," not an estimate of how many
 * real-world categories exist (see `kmeans` JSDoc on exploratory grouping).
 *
 * Silhouette scoring is O(n^2) per candidate k (every point is compared
 * against every other point to find its within/nearest-other cluster mean
 * distance). Above `maxSampleSize` (default 2000) vectors, this
 * seeded-subsamples before scoring so runtime stays bounded on large
 * datasets; the returned `k` still applies to the full input.
 */
export function suggestK(
  vectors: Vector[],
  kRange: number[] = DEFAULT_K_RANGE,
  opts: SuggestKOptions = {},
): SuggestKResult {
  const { seed = 42, maxIter = 100, maxSampleSize = DEFAULT_MAX_SAMPLE_SIZE } = opts;
  const n = vectors.length;
  if (n < 2) throw new Error("suggestK: need at least 2 vectors");

  const rand = mulberry32(seed);
  const sampled: Vector[] =
    n > maxSampleSize ? sampleIndices(rand, n, maxSampleSize).map((i) => vectors[i]!) : vectors;
  const sampleSize = sampled.length;

  // Silhouette needs at least 2 clusters and at least one point outside the
  // chosen cluster, so valid k is bounded to [2, sampleSize - 1].
  const candidates = kRange.filter((k) => Number.isInteger(k) && k >= 2 && k <= sampleSize - 1);
  if (candidates.length === 0) {
    throw new Error(
      `suggestK: no candidate k in [${kRange.join(", ")}] fits the sample size (${sampleSize}); need 2 <= k <= n-1`,
    );
  }

  const scores: SuggestKScore[] = candidates.map((k) => ({
    k,
    score: meanSilhouette(sampled, k, seed, maxIter),
  }));

  let best = scores[0]!;
  for (const s of scores) if (s.score > best.score) best = s;

  return { k: best.k, scores };
}

function meanSilhouette(vectors: Vector[], k: number, seed: number, maxIter: number): number {
  const { assignments } = kmeans(vectors, k, { seed, maxIter });
  const n = vectors.length;

  let total = 0;
  for (let i = 0; i < n; i++) {
    const own = assignments[i]!;
    const distSumByCluster = new Array<number>(k).fill(0);
    const countByCluster = new Array<number>(k).fill(0);

    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const c = assignments[j]!;
      distSumByCluster[c] = (distSumByCluster[c] ?? 0) + cosineDistance(vectors[i]!, vectors[j]!);
      countByCluster[c] = (countByCluster[c] ?? 0) + 1;
    }

    const ownCount = countByCluster[own] ?? 0;
    const a = ownCount > 0 ? (distSumByCluster[own] ?? 0) / ownCount : 0;

    let b = Infinity;
    for (let c = 0; c < k; c++) {
      if (c === own) continue;
      const count = countByCluster[c] ?? 0;
      if (count === 0) continue;
      const mean = (distSumByCluster[c] ?? 0) / count;
      if (mean < b) b = mean;
    }

    // Silhouette is conventionally 0 for a point whose own cluster is a
    // singleton (no "a" term) or when every other cluster is also empty.
    const silhouette = ownCount === 0 || !Number.isFinite(b) ? 0 : (b - a) / Math.max(a, b);
    total += silhouette;
  }

  return total / n;
}
