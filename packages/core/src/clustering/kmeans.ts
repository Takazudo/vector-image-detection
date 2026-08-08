import type { Vector } from "../types.js";
import { mulberry32 } from "./prng.js";
import { dot, normalizeVector } from "./vector-math.js";

export interface KMeansOptions {
  seed?: number;
  maxIter?: number;
}

export interface KMeansResult {
  /** `assignments[i]` is the cluster index (0..k-1) for `vectors[i]`. */
  assignments: number[];
  /** Unit-length cluster centroids, one per cluster. */
  centroids: Float32Array[];
  /** Sum over all points of `1 - cosine similarity` to their assigned centroid (lower is tighter). */
  inertia: number;
}

function kmeansPlusPlusInit(vectors: Vector[], k: number, rand: () => number): Float32Array[] {
  const n = vectors.length;
  const centroids: Float32Array[] = [Float32Array.from(vectors[Math.floor(rand() * n)]!)];

  // Squared cosine distance from each point to its nearest chosen centroid
  // so far — updated incrementally as centroids are added.
  const minDistSq = new Float64Array(n).fill(Infinity);

  while (centroids.length < k) {
    const last = centroids[centroids.length - 1]!;
    let total = 0;
    for (let i = 0; i < n; i++) {
      const d = 1 - dot(vectors[i]!, last);
      const d2 = d * d;
      if (d2 < minDistSq[i]!) minDistSq[i] = d2;
      total += minDistSq[i]!;
    }

    if (total <= 0) {
      // Every remaining point coincides with an already-chosen centroid;
      // fall back to a uniform random pick so we still reach k centroids.
      centroids.push(Float32Array.from(vectors[Math.floor(rand() * n)]!));
      continue;
    }

    // Weighted pick proportional to minDistSq (standard kmeans++ sampling).
    let r = rand() * total;
    let chosen = n - 1;
    for (let i = 0; i < n; i++) {
      r -= minDistSq[i]!;
      if (r <= 0) {
        chosen = i;
        break;
      }
    }
    centroids.push(Float32Array.from(vectors[chosen]!));
  }

  return centroids;
}

/** Assigns each vector to the index of its nearest (highest cosine similarity) centroid. */
function assignNearest(vectors: Vector[], centroids: Float32Array[]): number[] {
  const assignments = new Array<number>(vectors.length);
  for (let i = 0; i < vectors.length; i++) {
    let best = 0;
    let bestSim = -Infinity;
    for (let c = 0; c < centroids.length; c++) {
      const sim = dot(vectors[i]!, centroids[c]!);
      if (sim > bestSim) {
        bestSim = sim;
        best = c;
      }
    }
    assignments[i] = best;
  }
  return assignments;
}

/**
 * Spherical k-means over L2-normalized vectors: cosine similarity is the
 * affinity (a plain dot product, since inputs are normalized), centroids
 * are kmeans++-initialized and re-normalized to unit length after every
 * update so they stay directly comparable to the input vectors.
 *
 * **Exploratory grouping, not classification.** With real embeddings the
 * clusters this produces may track breed, color, pose, lighting, or
 * background rather than the species/category a human would expect —
 * there is no purity guarantee against any ground-truth label. Treat a
 * cluster id as "these vectors are relatively similar to each other," not
 * "these are confirmed to be the same kind of thing."
 *
 * Deterministic: kmeans++ init and empty-cluster reseeding are both driven
 * by a seeded PRNG (`opts.seed`, default 42) — the same inputs always
 * produce the same output, and no non-deterministic RNG is ever used.
 */
export function kmeans(vectors: Vector[], k: number, opts: KMeansOptions = {}): KMeansResult {
  const { seed = 42, maxIter = 100 } = opts;
  const n = vectors.length;

  if (n === 0) throw new Error("kmeans: vectors must be non-empty");
  if (!Number.isInteger(k) || k < 1) {
    throw new Error(`kmeans: k must be a positive integer, got ${k}`);
  }
  if (k > n) throw new Error(`kmeans: k (${k}) cannot exceed the number of vectors (${n})`);
  if (!Number.isInteger(maxIter) || maxIter < 1) {
    throw new Error(`kmeans: maxIter must be a positive integer, got ${maxIter}`);
  }

  const dim = vectors[0]!.length;
  const rand = mulberry32(seed);

  let centroids = kmeansPlusPlusInit(vectors, k, rand);
  // Start with an assignment no real cluster index can match, so the first
  // iteration always registers as "changed" and runs at least one update.
  let assignments = new Array<number>(n).fill(-1);

  for (let iter = 0; iter < maxIter; iter++) {
    const newAssignments = assignNearest(vectors, centroids);
    const changed = newAssignments.some((c, i) => c !== assignments[i]);
    assignments = newAssignments;
    if (!changed) break;

    const sums = Array.from({ length: k }, () => new Float64Array(dim));
    const counts = new Array<number>(k).fill(0);
    for (let i = 0; i < n; i++) {
      const c = assignments[i]!;
      counts[c] = (counts[c] ?? 0) + 1;
      const vec = vectors[i]!;
      const sum = sums[c]!;
      for (let d = 0; d < dim; d++) sum[d] = (sum[d] ?? 0) + (vec[d] ?? 0);
    }

    centroids = centroids.map((_prev, c) => {
      const count = counts[c] ?? 0;
      const sum = sums[c]!;
      // A cluster reseeds deterministically from a random input vector,
      // rather than keeping a degenerate centroid, when it is either empty
      // or its members sum to (near) the zero vector — e.g. exactly
      // antipodal points — which `normalizeVector` cannot turn into a
      // meaningful unit vector (standard Lloyd's remedy, extended to cover
      // the zero-sum case).
      let sumNormSq = 0;
      for (const value of sum) sumNormSq += value * value;
      if (count === 0 || sumNormSq === 0) {
        return normalizeVector(Float32Array.from(vectors[Math.floor(rand() * n)]!));
      }
      const avg = new Float32Array(dim);
      for (let d = 0; d < dim; d++) avg[d] = (sum[d] ?? 0) / count;
      return normalizeVector(avg);
    });
  }

  // If maxIter was reached before convergence, `assignments` reflects the
  // second-to-last centroids while `centroids` was already advanced one
  // more update — resync so the returned assignments always match the
  // returned centroids exactly.
  assignments = assignNearest(vectors, centroids);

  let inertia = 0;
  for (let i = 0; i < n; i++) {
    inertia += 1 - dot(vectors[i]!, centroids[assignments[i]!]!);
  }

  return { assignments, centroids, inertia };
}
