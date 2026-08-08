// Frozen shared contracts — wave-2/3 tasks implement against these exactly.
// Do not change shapes here without re-syncing every consumer.

export type Vector = Float32Array; // always L2-normalized

// Referenced by Embedder but not spelled out in the source spec beyond
// "file path (Node) or Blob/URL (browser)" — declared here so the contract compiles.
export type ImageInput = string | Blob | URL;

export interface Embedder {
  readonly modelId: string;
  readonly dim: number;
  embedImages(images: ImageInput[]): Promise<Vector[]>;
  embedTexts(texts: string[]): Promise<Vector[]>;
}

export interface VectorStoreItem {
  id: string;
  vector: Vector;
  payload?: Record<string, unknown>;
}

export interface SearchHit {
  id: string;
  score: number;
  payload?: Record<string, unknown>;
}

export interface VectorStore {
  upsert(items: VectorStoreItem[]): Promise<void>;
  search(
    vector: Vector,
    k: number,
    filter?: (payload: Record<string, unknown> | undefined) => boolean,
  ): Promise<SearchHit[]>;
  delete(ids: string[]): Promise<void>;
  count(): Promise<number>;
  /**
   * Fetches full items (vector + payload) by id — e.g. needed to compute an
   * exemplar-set mean vector for tag propagation (see
   * labeling/propose-tag-propagation.ts), where a list of ids is the only
   * handle available on the vectors to average. Ids not present in the store
   * are simply omitted from the result (no error); result order follows
   * `ids`, not insertion order.
   */
  get(ids: string[]): Promise<VectorStoreItem[]>;
}

export interface IndexItem {
  id: string;
  file: string;
  thumb?: string;
  knownLabel?: string; // ground-truth label from sample manifest (e.g. 'cat', 'dog', 'capacitor')
  /**
   * CONFIRMED tags only (FROZEN semantics). Proposals — e.g. model
   * suggestions or in-progress edits a user hasn't accepted yet — are
   * ephemeral and must never be written here or persisted anywhere in the
   * index bundle; only `updateTags` (see store/node-index-bundle.ts) may
   * rewrite this field, and it always replaces the full array for an id.
   * The index bundle (meta.json + embeddings.bin) is the source of truth for
   * tags; any Qdrant collection is a derived cache and re-syncing overwrites
   * it from here, never the reverse.
   */
  tags: string[];
  source?: string;
  license?: string;
  author?: string; // attribution passthrough
}

export interface IndexMeta {
  formatVersion: 1;
  modelId: string;
  dim: number;
  createdAt: string;
  items: IndexItem[]; // row i of embeddings.bin corresponds to items[i]
}
