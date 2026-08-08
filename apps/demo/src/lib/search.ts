import type {
  IndexItem,
  Vector,
  VectorStore,
  VectorStoreItem,
} from "@vector-image-detection/core/browser";
import { mergeTags, type TagOverlay } from "./tags";

export interface RankedItem {
  item: IndexItem;
  score: number;
}

export interface RankOptions {
  /** Dropped from the results — used by "similar to this", where the query item would otherwise rank first at score 1. */
  excludeId?: string;
}

/**
 * Turns a store's `SearchHit`s back into gallery items. Hits whose id is not in
 * `itemById` are dropped rather than rendered as blanks: a store can outlive the
 * meta it was built from (a reload races an index swap), and a hit with no item
 * has no thumbnail, label, or attribution to show.
 */
export async function rankByVector(
  store: VectorStore,
  itemById: ReadonlyMap<string, IndexItem>,
  vector: Vector,
  limit: number,
  { excludeId }: RankOptions = {},
): Promise<RankedItem[]> {
  if (limit <= 0) return [];

  const hits = await store.search(vector, excludeId === undefined ? limit : limit + 1);
  const ranked: RankedItem[] = [];
  for (const hit of hits) {
    if (hit.id === excludeId) continue;
    const item = itemById.get(hit.id);
    if (!item) continue;
    ranked.push({ item, score: hit.score });
    if (ranked.length >= limit) break;
  }
  return ranked;
}

/**
 * Re-upserts the store payloads for `ids` so their `tags` reflect the confirmed
 * overlay. `proposeTagPropagation` reads `payload.tags` to skip items that
 * already carry the tag being propagated, so a store left un-synced would keep
 * re-proposing photos the user already accepted.
 */
export async function syncStoreTags(
  store: VectorStore,
  itemById: ReadonlyMap<string, IndexItem>,
  vectorById: ReadonlyMap<string, Vector>,
  overlay: TagOverlay,
  ids: readonly string[],
): Promise<void> {
  const updates: VectorStoreItem[] = [];
  for (const id of ids) {
    const item = itemById.get(id);
    const vector = vectorById.get(id);
    if (!item || !vector) continue;
    const { id: _id, ...payload } = item;
    updates.push({ id, vector, payload: { ...payload, tags: mergeTags(item.tags, overlay[id]) } });
  }
  if (updates.length > 0) await store.upsert(updates);
}
