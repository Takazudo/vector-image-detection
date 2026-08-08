import type { SearchHit, VectorStore } from "../types.js";
import { normalizeVector } from "./vector-math.js";

export interface TagProposal {
  id: string;
  /**
   * Cosine similarity between this item and the (re-normalized) mean of the
   * exemplar vectors — not a calibrated confidence, just a ranking score.
   */
  score: number;
}

export interface ProposeTagPropagationOptions {
  threshold?: number;
  limit?: number;
}

/**
 * Proposes propagating `tag` from a set of human-picked exemplar items to
 * their nearest neighbors in embedding space: means the exemplar vectors
 * (re-normalized), kNN-searches the store with that mean, and returns
 * `{id, score}` for neighbors at or above `threshold` — excluding the
 * exemplars themselves and any item that already carries `tag` (payload
 * check on `payload.tags`).
 *
 * **Proposals only** — this never writes tags anywhere. A human confirming
 * or rejecting each proposal is the calibration mechanism (there's no
 * universal "correct" threshold); once confirmed, persistence goes through
 * the store's `updateTags`, not this function.
 */
export async function proposeTagPropagation(
  store: VectorStore,
  exemplarIds: string[],
  tag: string,
  { threshold = 0.75, limit = 50 }: ProposeTagPropagationOptions = {},
): Promise<TagProposal[]> {
  if (exemplarIds.length === 0) {
    throw new Error("proposeTagPropagation: exemplarIds must not be empty");
  }

  const exemplars = await store.get(exemplarIds);
  if (exemplars.length !== exemplarIds.length) {
    const found = new Set(exemplars.map((item) => item.id));
    const missing = exemplarIds.filter((id) => !found.has(id));
    throw new Error(`proposeTagPropagation: exemplar id(s) not found in store: ${missing.join(", ")}`);
  }

  const dim = exemplars[0]!.vector.length;
  const sum = new Float32Array(dim);
  for (const { vector } of exemplars) {
    for (let i = 0; i < dim; i++) sum[i] = (sum[i] ?? 0) + (vector[i] ?? 0);
  }
  const meanVector = normalizeVector(sum);

  const alreadyTagged = (payload: Record<string, unknown> | undefined): boolean =>
    Array.isArray(payload?.tags) && (payload.tags as unknown[]).includes(tag);

  const exemplarIdSet = new Set(exemplarIds);
  const collectProposals = (hits: SearchHit[]): TagProposal[] => {
    const proposals: TagProposal[] = [];
    for (const hit of hits) {
      if (exemplarIdSet.has(hit.id)) continue;
      // `search` returns hits sorted by score descending (both VectorStore
      // implementations guarantee this), so the first below-threshold hit
      // means everything after it is too.
      if (hit.score < threshold) break;
      proposals.push({ id: hit.id, score: hit.score });
      if (proposals.length >= limit) break;
    }
    return proposals;
  };

  // Over-fetch by exemplarIds.length: at most that many of the top hits can
  // be exemplars, so this window alone is enough for an exact VectorStore
  // (e.g. InMemoryVectorStore). QdrantVectorStore, though, applies this
  // filter client-side after its own internal over-fetch cap (see
  // `search()` in qdrant-vector-store.ts) — a very selective filter (many
  // already-tagged neighbors ranked above the real candidates) can then
  // yield fewer results than actually exist above `threshold`. Widen the
  // request a bounded number of times when that happens, to reduce (it
  // cannot fully eliminate, short of an unbounded scan) that risk.
  //
  // `hits.length` alone can't tell us whether the store is genuinely
  // exhausted or just truncated `k` raw candidates down to fewer post-filter
  // hits (this scenario is indistinguishable from the outside — that's the
  // bug being worked around) — `count()` is the only honest exhaustion
  // signal available through the `VectorStore` interface.
  const total = await store.count();
  let k = Math.min(limit + exemplarIds.length, total);
  let hits = await store.search(meanVector, k, (payload) => !alreadyTagged(payload));
  let proposals = collectProposals(hits);

  const MAX_WIDEN_ATTEMPTS = 3;
  const WIDEN_FACTOR = 4;
  for (let attempt = 0; proposals.length < limit && k < total && attempt < MAX_WIDEN_ATTEMPTS; attempt++) {
    k = Math.min(k * WIDEN_FACTOR, total);
    hits = await store.search(meanVector, k, (payload) => !alreadyTagged(payload));
    proposals = collectProposals(hits);
  }

  return proposals;
}
