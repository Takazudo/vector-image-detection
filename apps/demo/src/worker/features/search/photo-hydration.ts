import type {
  AiWord,
  HumanTag,
  PhotoSummary,
  SupportedImageMimeType,
} from "../../contracts/domain";

interface PhotoRow {
  id: string;
  state: PhotoSummary["state"];
  width: number;
  height: number;
  mime_type: SupportedImageMimeType;
  created_at: string;
  ready_at: string | null;
  document_revision: number;
  source_url: string | null;
  license_name: string | null;
  license_url: string | null;
  author_name: string | null;
  author_url: string | null;
}

interface AiWordRow {
  photo_id: string;
  word: string;
  normalized_word: string;
  confidence: number | null;
  model_run_id: string;
  document_revision: number;
}

interface HumanTagRow {
  photo_id: string;
  id: string;
  name: string;
  normalized_name: string;
  created_at: string;
}

export async function hydratePhotoSummaries(
  database: D1Database,
  photoIds: readonly string[],
): Promise<Map<string, PhotoSummary>> {
  if (photoIds.length === 0) return new Map();
  const uniqueIds = [...new Set(photoIds)];
  const placeholders = uniqueIds.map(() => "?").join(", ");
  const [photos, aiWords, humanTags] = await Promise.all([
    database
      .prepare(
        `SELECT id, state, width, height, mime_type, created_at, ready_at, document_revision,
                source_url, license_name, license_url, author_name, author_url
         FROM photos WHERE id IN (${placeholders}) AND state = 'ready'
           AND NOT EXISTS (SELECT 1 FROM tombstones WHERE tombstones.photo_id = photos.id)`,
      )
      .bind(...uniqueIds)
      .all<PhotoRow>(),
    database
      .prepare(
        `SELECT paw.photo_id, paw.word, paw.normalized_word, paw.confidence,
                paw.model_run_id, paw.document_revision
         FROM photo_ai_words paw
         WHERE paw.photo_id IN (${placeholders})
           AND paw.document_revision = (
             SELECT MAX(latest.document_revision) FROM photo_ai_words latest
             WHERE latest.photo_id = paw.photo_id
           )
         ORDER BY paw.photo_id ASC, paw.position ASC, paw.normalized_word ASC`,
      )
      .bind(...uniqueIds)
      .all<AiWordRow>(),
    database
      .prepare(
        `SELECT pht.photo_id, ht.id, ht.name, ht.normalized_name, ht.created_at
         FROM photo_human_tags pht JOIN human_tags ht ON ht.id = pht.tag_id
         WHERE pht.photo_id IN (${placeholders})
         ORDER BY pht.photo_id ASC, ht.normalized_name ASC, ht.id ASC`,
      )
      .bind(...uniqueIds)
      .all<HumanTagRow>(),
  ]);
  return new Map(
    photos.results.map((photo) => [
      photo.id,
      {
        id: photo.id,
        state: photo.state,
        width: photo.width,
        height: photo.height,
        mimeType: photo.mime_type,
        mediaUrl: `/api/v1/photos/${encodeURIComponent(photo.id)}/media`,
        createdAt: photo.created_at,
        readyAt: photo.ready_at,
        documentRevision: photo.document_revision,
        aiWords: aiWords.results.filter((word) => word.photo_id === photo.id).map(mapAiWord),
        humanTags: humanTags.results.filter((tag) => tag.photo_id === photo.id).map(mapHumanTag),
        attribution: attribution(photo),
      } satisfies PhotoSummary,
    ]),
  );
}

function mapAiWord(row: AiWordRow): AiWord {
  return {
    kind: "ai-word",
    word: row.word,
    normalizedWord: row.normalized_word,
    confidence: row.confidence,
    modelRunId: row.model_run_id,
    documentRevision: row.document_revision,
  };
}

function mapHumanTag(row: HumanTagRow): HumanTag {
  return {
    kind: "human-tag",
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    createdAt: row.created_at,
  };
}

function attribution(photo: PhotoRow): PhotoSummary["attribution"] {
  if (
    photo.source_url === null &&
    photo.license_name === null &&
    photo.license_url === null &&
    photo.author_name === null &&
    photo.author_url === null
  ) {
    return null;
  }
  return {
    sourceUrl: photo.source_url,
    licenseName: photo.license_name,
    licenseUrl: photo.license_url,
    authorName: photo.author_name,
    authorUrl: photo.author_url,
  };
}
