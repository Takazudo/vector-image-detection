import type { Embedder, Vector } from "../types.js";

const DEFAULT_TEMPLATE = "a photo of a {}";

export interface EmbedVocabOptions {
  /** Applied to each label via a literal `{}` substitution before embedding. */
  template?: string;
}

/**
 * Embeds a vocabulary of labels (via `template`, e.g. `"a photo of a cat"`)
 * into the embedder's text tower, for use as candidate vectors in
 * `zeroShotTag`/`classifyByVocab`.
 *
 * The result is keyed by plain label — cached (deduped) within this call by
 * (embedder.modelId, template, label): a repeated label in `vocab` is only
 * embedded once. A Vector's meaning depends on all three of those — the
 * returned map is only valid for this exact embedder + template pair, so
 * regenerate it (don't reuse it) if either changes. Within that scope,
 * callers should reuse the returned map across multiple `zeroShotTag`/
 * `classifyByVocab` calls rather than re-embedding the same vocabulary.
 */
export async function embedVocab(
  embedder: Embedder,
  vocab: string[],
  { template = DEFAULT_TEMPLATE }: EmbedVocabOptions = {},
): Promise<Map<string, Vector>> {
  const uniqueLabels = [...new Set(vocab)];
  const texts = uniqueLabels.map((label) => template.replace("{}", label));
  const vectors = await embedder.embedTexts(texts);

  const result = new Map<string, Vector>();
  uniqueLabels.forEach((label, i) => {
    result.set(label, vectors[i] as Vector);
  });
  return result;
}
