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
}

export interface IndexItem {
  id: string;
  file: string;
  thumb?: string;
  knownLabel?: string; // ground-truth label from sample manifest (e.g. 'cat', 'dog', 'capacitor')
  tags: string[]; // CONFIRMED tags only — proposals are never persisted
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
