import { MODEL_CONFIG } from "../../config";
import { vectorIdFor } from "../../contracts/domain";
import type { ReindexQueueMessage } from "../../contracts/queue";
import type { PlatformProviders } from "../../providers";

interface ReindexPhotoRow {
  id: string;
  state: string;
  ai_caption: string | null;
  document_revision: number;
  reindex_required_revision: number | null;
}

interface WordRow {
  normalized_word: string;
}

interface TagRow {
  normalized_name: string;
}

export type ReindexOutcome = "indexed" | "superseded" | "unavailable";

export async function handleReindexMessage(
  message: ReindexQueueMessage,
  providers: PlatformProviders,
): Promise<ReindexOutcome> {
  const photo = await providers.database
    .prepare(
      `SELECT id, state, ai_caption, document_revision, reindex_required_revision
       FROM photos WHERE id = ?`,
    )
    .bind(message.photoId)
    .first<ReindexPhotoRow>();
  if (!photo || photo.state !== "ready") return "unavailable";
  if (
    photo.document_revision !== message.requestedDocumentRevision ||
    photo.reindex_required_revision !== message.requestedDocumentRevision
  ) {
    return "superseded";
  }

  const [words, tags] = await Promise.all([
    providers.database
      .prepare(
        `SELECT normalized_word FROM photo_ai_words
         WHERE photo_id = ? AND document_revision = (
           SELECT MAX(document_revision) FROM photo_ai_words WHERE photo_id = ?
         ) ORDER BY position ASC, normalized_word ASC`,
      )
      .bind(photo.id, photo.id)
      .all<WordRow>(),
    providers.database
      .prepare(
        `SELECT ht.normalized_name FROM photo_human_tags pht
         JOIN human_tags ht ON ht.id = pht.tag_id
         WHERE pht.photo_id = ? ORDER BY ht.normalized_name ASC, ht.id ASC`,
      )
      .bind(photo.id)
      .all<TagRow>(),
  ]);
  const document = canonicalTextDocument(
    photo.ai_caption,
    words.results.map((item) => item.normalized_word),
    tags.results.map((item) => item.normalized_name),
  );
  const embedding = await providers.ai.run(MODEL_CONFIG.embedding, { text: document });
  const values = embedding.data[0];
  validateEmbedding(values);
  const vectorId = vectorIdFor(photo.id, photo.document_revision);
  await providers.vectorize.upsert([{ id: vectorId, values }]);

  const nowIso = providers.clock.now().toISOString();
  const update = await providers.database
    .prepare(
      `UPDATE photos SET
         canonical_indexed_revision = ?, canonical_vector_id = ?,
         reindex_required_revision = NULL, updated_at = ?
       WHERE id = ? AND state = 'ready' AND document_revision = ?
         AND reindex_required_revision = ?`,
    )
    .bind(
      photo.document_revision,
      vectorId,
      nowIso,
      photo.id,
      photo.document_revision,
      photo.document_revision,
    )
    .run();
  return (update.meta.changes ?? 0) === 1 ? "indexed" : "superseded";
}

export function canonicalTextDocument(
  caption: string | null,
  aiWords: readonly string[],
  humanTags: readonly string[],
): string {
  return [
    `caption: ${caption?.normalize("NFKC").trim() ?? ""}`,
    `ai words: ${[...new Set(aiWords)].join(", ")}`,
    `human tags: ${[...new Set(humanTags)].join(", ")}`,
  ].join("\n");
}

function validateEmbedding(values: number[] | undefined): asserts values is number[] {
  if (
    !values ||
    values.length !== MODEL_CONFIG.vectorDimensions ||
    values.some((value) => !Number.isFinite(value))
  ) {
    throw new Error(
      `Embedding provider returned an invalid ${MODEL_CONFIG.vectorDimensions}-value vector.`,
    );
  }
}
