// Browser-side loader for the index bundle format. Uses only `fetch` and
// `ArrayBuffer` — no Node built-ins — so it's safe to import from any
// bundler target, unlike ./node-index-bundle.ts.
import type { IndexMeta, Vector } from "../types.js";
import { assertModelMatch, decodeVectors } from "./index-bundle-codec.js";

export type FetchLike = typeof fetch;

/**
 * Fetches an index bundle (`${baseUrl}/meta.json` + `${baseUrl}/embeddings.bin`)
 * over HTTP. If `expected` is given, throws `IndexModelMismatchError` when the
 * bundle's `{modelId, dim}` disagrees. Pass `fetchImpl` to use a fetch
 * implementation other than the ambient global (e.g. in tests, or Node
 * before 18).
 */
export async function loadIndexFromUrl(
  baseUrl: string,
  fetchImpl: FetchLike = fetch,
  expected?: { modelId: string; dim: number },
): Promise<{ meta: IndexMeta; vectors: Vector[] }> {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

  const metaResponse = await fetchImpl(new URL("meta.json", base));
  if (!metaResponse.ok) {
    throw new Error(`loadIndexFromUrl: failed to fetch meta.json (${metaResponse.status})`);
  }
  const meta = (await metaResponse.json()) as IndexMeta;
  assertModelMatch(meta, expected);

  const embeddingsResponse = await fetchImpl(new URL("embeddings.bin", base));
  if (!embeddingsResponse.ok) {
    throw new Error(
      `loadIndexFromUrl: failed to fetch embeddings.bin (${embeddingsResponse.status})`,
    );
  }
  const embeddingsBuffer = await embeddingsResponse.arrayBuffer();
  const vectors = decodeVectors(embeddingsBuffer, meta.items.length, meta.dim);

  return { meta, vectors };
}
