import type { Embedder, VectorStore } from "@vector-image-detection/core";
import type { CostEstimate, VlmLanguage, VlmTagResult } from "@vector-image-detection/vlm-tagger";

export interface Logger {
  log(message: string): void;
  error(message: string): void;
}

export interface EmbedderFactoryConfig {
  modelId?: string;
  dim?: number;
}

export interface QdrantStoreConfig {
  url: string;
  collection: string;
  dim: number;
}

export interface VlmTagFn {
  (imagePaths: string[], opts: { language?: VlmLanguage }): Promise<VlmTagResult[]>;
}

export interface EstimateCostFn {
  (imageCount: number, model?: string): CostEstimate;
}

/**
 * Everything a command needs that would otherwise reach the network, a
 * filesystem root outside of tests, or a TTY — injected so command-level
 * tests can run fully offline (FakeEmbedder, a tmp-dir root, a scripted
 * confirm answer, a mocked vlm-tagger/Qdrant client) without ever touching a
 * real model download, the real repo `data/` dir, or stdin.
 */
export interface CliDeps {
  /** Repo worktree root that `data/indexes/<name>/` and `apps/demo/public/data/` are resolved against. Defaults to `process.cwd()`. */
  rootDir: string;
  createEmbedder: (config?: EmbedderFactoryConfig) => Embedder;
  createQdrantStore: (config: QdrantStoreConfig) => VectorStore;
  vlmTag: VlmTagFn;
  estimateCost: EstimateCostFn;
  /** y/n prompt for interactive tag confirmation flows. Resolves to the user's answer. */
  confirm: (question: string) => Promise<boolean>;
  logger: Logger;
  now: () => Date;
}
