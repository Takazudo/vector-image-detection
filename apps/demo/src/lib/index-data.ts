import type { IndexItem, IndexMeta, Vector } from "@vector-image-detection/core/browser";
import {
  InMemoryVectorStore,
  loadIndexFromUrl,
  storeFromIndex,
} from "@vector-image-detection/core/browser";

/** Where `vis export-demo` (and `pnpm demo:fixture`) write the bundle, relative to the deployed base path. */
export const DATA_BASE_URL = `${import.meta.env.BASE_URL}data`;

export interface DemoIndex {
  meta: IndexMeta;
  items: IndexItem[];
  vectors: Vector[];
  store: InMemoryVectorStore;
  itemById: Map<string, IndexItem>;
  vectorById: Map<string, Vector>;
  /** Resolves an item's `thumb`/`file` path against the bundle's base URL. */
  thumbUrl: (item: IndexItem) => string;
}

/**
 * Percent-encodes each segment of a bundle-relative path so filenames with
 * URL-reserved characters (`#`, `?`, spaces…) fetch correctly, while `/`
 * separators stay intact.
 */
export function encodeBundlePath(relPath: string): string {
  return relPath.split("/").map(encodeURIComponent).join("/");
}

export async function loadDemoIndex(baseUrl = DATA_BASE_URL): Promise<DemoIndex> {
  const { meta, vectors } = await loadIndexFromUrl(baseUrl);
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

  return {
    meta,
    items: meta.items,
    vectors,
    store: storeFromIndex(meta, vectors),
    itemById: new Map(meta.items.map((item) => [item.id, item])),
    vectorById: new Map(meta.items.map((item, i) => [item.id, vectors[i] as Vector])),
    thumbUrl: (item) => `${base}${encodeBundlePath(item.thumb ?? item.file)}`,
  };
}
