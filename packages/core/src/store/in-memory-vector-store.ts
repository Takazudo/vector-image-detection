import type { SearchHit, Vector, VectorStore, VectorStoreItem } from "../types.js";

function dot(a: Vector, b: Vector): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

/**
 * Exact (brute-force) in-memory `VectorStore`. Vectors are assumed
 * L2-normalized (per the `Vector` contract), so cosine similarity reduces to
 * a plain dot product — no per-search normalization work.
 */
export class InMemoryVectorStore implements VectorStore {
  private readonly items = new Map<string, VectorStoreItem>();

  constructor(initialItems: VectorStoreItem[] = []) {
    for (const item of initialItems) this.items.set(item.id, item);
  }

  async upsert(items: VectorStoreItem[]): Promise<void> {
    for (const item of items) this.items.set(item.id, item);
  }

  async search(
    vector: Vector,
    k: number,
    filter?: (payload: Record<string, unknown> | undefined) => boolean,
  ): Promise<SearchHit[]> {
    if (k <= 0) return [];
    const candidates = filter
      ? [...this.items.values()].filter((item) => filter(item.payload))
      : [...this.items.values()];

    const scored: SearchHit[] = candidates.map((item) => ({
      id: item.id,
      score: dot(vector, item.vector),
      payload: item.payload,
    }));

    // Exact top-k: sort by score desc, tie-break by id asc for a
    // deterministic order across runs/platforms.
    scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    return scored.slice(0, k);
  }

  async delete(ids: string[]): Promise<void> {
    for (const id of ids) this.items.delete(id);
  }

  async get(ids: string[]): Promise<VectorStoreItem[]> {
    const found: VectorStoreItem[] = [];
    for (const id of ids) {
      const item = this.items.get(id);
      if (item) found.push(item);
    }
    return found;
  }

  async count(): Promise<number> {
    return this.items.size;
  }
}
