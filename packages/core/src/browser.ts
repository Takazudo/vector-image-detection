// Browser-safe entry point (`@vector-image-detection/core/browser`).
//
// Everything re-exported here is reachable without touching a Node built-in,
// `@huggingface/transformers`, or `@qdrant/js-client-rest` — so a web bundler
// pulls in only pure code. The package root (`.`) intentionally re-exports the
// Node index-bundle loader and the Qdrant store too, which would force a
// bundler to stub `node:fs` and ship the model runtime in the main chunk.
//
// The real (transformers.js) embedder lives behind its own subpath,
// `@vector-image-detection/core/transformers-embedder`, so a consumer can
// dynamic-import it and keep the ~100MB model runtime out of the initial load.

export * from "./types.js";

export { FakeEmbedder } from "./embedding/fake-embedder.js";
export type {
  FakeEmbedderConfig,
  FakeEmbedderExplicitInput,
  FakeEmbedderImageInput,
  FakeEmbedderTextInput,
} from "./embedding/fake-embedder.js";

export { InMemoryVectorStore } from "./store/in-memory-vector-store.js";

export { loadIndexFromUrl } from "./store/browser-index-bundle.js";
export type { FetchLike } from "./store/browser-index-bundle.js";

export {
  IndexModelMismatchError,
  assertModelMatch,
  decodeVectors,
  encodeVectors,
  storeFromIndex,
} from "./store/index-bundle-codec.js";

export * as clustering from "./clustering/index.js";
export * as labeling from "./labeling/index.js";
