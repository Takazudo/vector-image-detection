import type { IndexItem, IndexMeta, Vector } from "../types.js";
import { InMemoryVectorStore } from "./in-memory-vector-store.js";

/**
 * Thrown by index loaders when the caller's expected `{modelId, dim}` does
 * not match the index bundle's `meta.json`. A mismatch means the on-disk
 * vectors were produced by a different embedding model and are not
 * comparable to freshly-embedded query vectors.
 */
export class IndexModelMismatchError extends Error {
  readonly expected: { modelId: string; dim: number };
  readonly actual: { modelId: string; dim: number };

  constructor(
    expected: { modelId: string; dim: number },
    actual: { modelId: string; dim: number },
  ) {
    super(
      `Index was built with model "${actual.modelId}" (dim=${actual.dim}) but expected ` +
        `"${expected.modelId}" (dim=${expected.dim}) — re-run ingest.`,
    );
    this.name = "IndexModelMismatchError";
    this.expected = expected;
    this.actual = actual;
  }
}

/** Throws `IndexModelMismatchError` when `expected` is given and disagrees with `meta`. */
export function assertModelMatch(
  meta: Pick<IndexMeta, "modelId" | "dim">,
  expected?: { modelId: string; dim: number },
): void {
  if (!expected) return;
  if (meta.modelId !== expected.modelId || meta.dim !== expected.dim) {
    throw new IndexModelMismatchError(expected, { modelId: meta.modelId, dim: meta.dim });
  }
}

/**
 * Encodes `vectors` into the `embeddings.bin` wire format: raw Float32,
 * row-major (`vectors.length x dim` floats), explicit little-endian — the
 * frozen on-disk/wire contract, independent of host byte order.
 */
export function encodeVectors(vectors: Vector[], dim: number): ArrayBuffer {
  const buffer = new ArrayBuffer(vectors.length * dim * 4);
  const view = new DataView(buffer);
  let offset = 0;
  for (const vector of vectors) {
    if (vector.length !== dim) {
      throw new Error(`encodeVectors: expected ${dim}-dim vector, got ${vector.length}`);
    }
    for (let i = 0; i < dim; i++) {
      view.setFloat32(offset, vector[i] ?? 0, true);
      offset += 4;
    }
  }
  return buffer;
}

/** Inverse of `encodeVectors` — slices `buffer` into `itemCount` row vectors of `dim` floats each. */
export function decodeVectors(buffer: ArrayBuffer, itemCount: number, dim: number): Vector[] {
  const expectedBytes = itemCount * dim * 4;
  if (buffer.byteLength !== expectedBytes) {
    throw new Error(
      `decodeVectors: embeddings.bin is ${buffer.byteLength} bytes, expected ${expectedBytes} ` +
        `for ${itemCount} items x dim ${dim} — index bundle is corrupt or meta.json/embeddings.bin are out of sync.`,
    );
  }
  const view = new DataView(buffer);
  const vectors: Vector[] = [];
  let offset = 0;
  for (let row = 0; row < itemCount; row++) {
    const vector = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      vector[i] = view.getFloat32(offset, true);
      offset += 4;
    }
    vectors.push(vector);
  }
  return vectors;
}

/**
 * Builds an `InMemoryVectorStore` from a loaded index bundle: `items[i]`
 * pairs with `vectors[i]`, and every non-id `IndexItem` field (`file`,
 * `tags`, `knownLabel`, `thumb`, `source`, `license`, `author`, ...) flows
 * through unchanged into the store item's `payload`.
 */
export function storeFromIndex(
  meta: Pick<IndexMeta, "items">,
  vectors: Vector[],
): InMemoryVectorStore {
  if (meta.items.length !== vectors.length) {
    throw new Error(
      `storeFromIndex: meta.items has ${meta.items.length} entries but got ${vectors.length} vectors`,
    );
  }
  const storeItems = meta.items.map((item: IndexItem, i: number) => {
    const { id, ...payload } = item;
    return { id, vector: vectors[i] as Vector, payload };
  });
  return new InMemoryVectorStore(storeItems);
}
