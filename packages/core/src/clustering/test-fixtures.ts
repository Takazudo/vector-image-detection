import type { Vector } from "../types.js";
import { mulberry32 } from "./prng.js";
import { normalizeVector } from "./vector-math.js";

/**
 * Generates `countPerBlob` seeded-jittered, L2-normalized vectors around
 * each of `centers`. Test-only fixture: synthetic blobs with known planted
 * structure, used to assert kmeans/suggestK recover that structure.
 */
export function makeBlobs(
  centers: number[][],
  countPerBlob: number,
  opts: { seed?: number; jitter?: number } = {},
): { vectors: Vector[]; labels: number[] } {
  const { seed = 1, jitter = 0.05 } = opts;
  const rand = mulberry32(seed);
  const dim = centers[0]!.length;
  const vectors: Vector[] = [];
  const labels: number[] = [];

  for (let c = 0; c < centers.length; c++) {
    const center = centers[c]!;
    for (let i = 0; i < countPerBlob; i++) {
      const vec = new Float32Array(dim);
      for (let d = 0; d < dim; d++) {
        vec[d] = (center[d] ?? 0) + (rand() * 2 - 1) * jitter;
      }
      vectors.push(normalizeVector(vec));
      labels.push(c);
    }
  }

  return { vectors, labels };
}
