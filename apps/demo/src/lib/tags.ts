import type { IndexItem, IndexMeta } from "../generated/core-browser.mjs";

/**
 * Confirmed, user-added tags keyed by item id — the demo's stand-in for
 * writing back to the index bundle. Proposals never live here: a proposal
 * becomes an entry only once a human has confirmed it, mirroring the
 * `IndexItem.tags` contract in core.
 */
export type TagOverlay = Readonly<Record<string, readonly string[]>>;

const STORAGE_PREFIX = "vis-demo:tags:";

/**
 * Keys persistence by index identity, so switching to a bundle built from a
 * different model or a later ingest never resurrects tags that were attached
 * to item ids from the old one.
 */
export function overlayStorageKey(meta: Pick<IndexMeta, "modelId" | "createdAt">): string {
  return `${STORAGE_PREFIX}${meta.modelId}:${meta.createdAt}`;
}

export function normalizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The index bundle is the source of truth for tags, so its entries come first
 * and in their original order; overlay entries append after, and anything
 * already present (compared case-insensitively) is dropped.
 */
export function mergeTags(
  metaTags: readonly string[],
  overlayTags: readonly string[] | undefined,
): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const tag of [...metaTags, ...(overlayTags ?? [])]) {
    const key = normalizeTag(tag);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    merged.push(tag);
  }
  return merged;
}

/** Reads and sanitizes the stored overlay; anything unparseable yields an empty overlay rather than throwing. */
export function readOverlay(storage: Pick<Storage, "getItem">, key: string): TagOverlay {
  let parsed: unknown;
  try {
    const raw = storage.getItem(key);
    if (raw === null) return {};
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};

  const overlay: Record<string, string[]> = {};
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const tags = mergeTags(
      [],
      value.filter((tag): tag is string => typeof tag === "string"),
    );
    if (tags.length > 0) overlay[id] = tags;
  }
  return overlay;
}

export function writeOverlay(
  storage: Pick<Storage, "setItem">,
  key: string,
  overlay: TagOverlay,
): void {
  storage.setItem(key, JSON.stringify(overlay));
}

/** Adds `tag` to every id in `ids`, dropping ids that already carry it. Returns the original overlay when nothing changed. */
export function addTag(overlay: TagOverlay, ids: readonly string[], tag: string): TagOverlay {
  const normalized = normalizeTag(tag);
  if (normalized.length === 0 || ids.length === 0) return overlay;

  let changed = false;
  const next: Record<string, readonly string[]> = { ...overlay };
  for (const id of ids) {
    const current = overlay[id] ?? [];
    if (current.some((existing) => normalizeTag(existing) === normalized)) continue;
    next[id] = [...current, tag.trim()];
    changed = true;
  }
  return changed ? next : overlay;
}

export function removeTag(overlay: TagOverlay, id: string, tag: string): TagOverlay {
  const current = overlay[id];
  if (!current) return overlay;

  const normalized = normalizeTag(tag);
  const remaining = current.filter((existing) => normalizeTag(existing) !== normalized);
  if (remaining.length === current.length) return overlay;

  const next = { ...overlay };
  if (remaining.length === 0) delete next[id];
  else next[id] = remaining;
  return next;
}

/** Ids whose overlay tag list differs between two overlays — the exact set whose store payload needs re-upserting. */
export function changedOverlayIds(previous: TagOverlay, next: TagOverlay): string[] {
  const ids = new Set([...Object.keys(previous), ...Object.keys(next)]);
  const changed: string[] = [];
  for (const id of ids) {
    const before = previous[id] ?? [];
    const after = next[id] ?? [];
    if (before.length !== after.length || before.some((tag, i) => tag !== after[i])) {
      changed.push(id);
    }
  }
  return changed.sort();
}

export function overlayTagCount(overlay: TagOverlay): number {
  return Object.values(overlay).reduce((total, tags) => total + tags.length, 0);
}

/**
 * Serializes the merged (index + confirmed) tags in the shape a `vis tag`
 * write-back would consume: one entry per still-tagged item, full tag array.
 */
export function exportTagsJson(
  meta: Pick<IndexMeta, "modelId" | "createdAt" | "items">,
  overlay: TagOverlay,
  exportedAt: string,
): string {
  const items = meta.items
    .map((item: IndexItem) => ({ id: item.id, tags: mergeTags(item.tags, overlay[item.id]) }))
    .filter((entry) => entry.tags.length > 0);

  return `${JSON.stringify(
    { index: { modelId: meta.modelId, createdAt: meta.createdAt }, exportedAt, items },
    null,
    2,
  )}\n`;
}
