import type { Vector } from "../types.js";

/** Dot product. For L2-normalized vectors (the `Vector` contract) this equals cosine similarity. */
export function dot(a: Vector, b: Vector): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

/** Returns a new L2-normalized copy of `vec` (zero vector maps to itself, guarding div-by-zero). */
export function normalizeVector(vec: Float32Array): Float32Array {
  let sumSquares = 0;
  for (const value of vec) sumSquares += value * value;
  const norm = Math.sqrt(sumSquares) || 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = (vec[i] ?? 0) / norm;
  return out;
}

/** Cosine similarity, assuming both inputs are already L2-normalized (reduces to a dot product). */
export function cosineSimilarity(a: Vector, b: Vector): number {
  return dot(a, b);
}

/** Cosine distance (1 - cosine similarity), assuming both inputs are already L2-normalized. */
export function cosineDistance(a: Vector, b: Vector): number {
  return 1 - dot(a, b);
}
