/**
 * mulberry32 — small, fast, deterministic PRNG (same construction used
 * elsewhere in this codebase, e.g. embedding/fake-embedder.ts). Every
 * stochastic step in this module (kmeans++ init, empty-cluster reseeding,
 * suggestK subsampling) is driven by this seeded generator — the platform's
 * non-deterministic RNG is never used, so identical inputs always produce
 * identical output.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seeded partial Fisher-Yates shuffle: returns `count` distinct indices
 * from `[0, n)`, in random order, without replacement (clamped to `n` if
 * `count` exceeds it).
 */
export function sampleIndices(rand: () => number, n: number, count: number): number[] {
  const pool = Array.from({ length: n }, (_, i) => i);
  const take = Math.min(count, n);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rand() * (n - i));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  return pool.slice(0, take);
}
