import * as path from "node:path";

/** `--index` name used by every command when the flag is omitted. */
export const DEFAULT_INDEX_NAME = "default";

/** `data/indexes/<name>/`, relative to the repo worktree root (`deps.rootDir`), per the CLI's frozen index layout. */
export function resolveIndexDir(rootDir: string, indexName: string): string {
  return path.join(rootDir, "data", "indexes", indexName);
}

/** `thumbs/` sits next to `meta.json`/`embeddings.bin` inside an index bundle directory. */
export function resolveThumbsDir(indexDir: string): string {
  return path.join(indexDir, "thumbs");
}

/** `export-demo`'s copy target — picked up by `apps/demo` at dev/build time. */
export function resolveDemoDataDir(rootDir: string): string {
  return path.join(rootDir, "apps", "demo", "public", "data");
}

/** Deterministic Qdrant collection name for a given index name, so `search --backend qdrant` and `qdrant sync` always agree. */
export function qdrantCollectionName(indexName: string): string {
  return `vis-${indexName}`;
}
