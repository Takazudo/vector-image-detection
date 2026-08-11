import { MODEL_CONFIG, VALIDATION_LIMITS } from "../../config";
import type { SearchRequest, SearchResponse, SearchResult } from "../../contracts/api";
import { parseVectorId } from "../../contracts/domain";
import type { PlatformProviders } from "../../providers";
import { normalizeTagWord } from "../tags/normalization";
import { hydratePhotoSummaries } from "./photo-hydration";

const EXACT_TIER_LIMIT = 100;
const SEMANTIC_CANDIDATE_LIMIT = 100;
const PROVIDER_TIMEOUT_MS = 2_000;

export interface HumanExactRow {
  photo_id: string;
}

export interface AiExactRow {
  photo_id: string;
  model_run_id: string;
}

export interface CanonicalVectorRow {
  id: string;
  created_at: string;
  canonical_indexed_revision: number;
  canonical_vector_id: string;
}

export interface SemanticCandidate {
  photoId: string;
  score: number;
  vectorId: string;
  indexedDocumentRevision: number;
  createdAt: string;
}

export interface SearchTierBuckets {
  exactHumanTag: SearchResult[];
  exactAiWord: SearchResult[];
  related: SearchResult[];
}

export interface TieredSearchResult {
  query: string;
  tiers: SearchTierBuckets;
  degradedReason: string | null;
}

export async function searchPhotoLibrary(
  request: SearchRequest,
  providers: PlatformProviders,
): Promise<SearchResponse> {
  const tiered = await searchPhotoLibraryTiers(request.query, providers);
  const offset = parseCursor(request.cursor);
  const limit = Math.max(
    1,
    Math.min(VALIDATION_LIMITS.maximumPageSize, request.limit ?? VALIDATION_LIMITS.defaultPageSize),
  );
  const page = flattenTierPage(tiered.tiers, offset, limit);
  return {
    version: "v1",
    query: tiered.query,
    items: page.items,
    nextCursor: page.nextCursor,
    degraded: tiered.degradedReason !== null,
    degradedReason: tiered.degradedReason,
  };
}

export function flattenTierPage(
  tiers: SearchTierBuckets,
  offset: number,
  limit: number,
): { items: SearchResult[]; nextCursor: string | null } {
  const allItems = [...tiers.exactHumanTag, ...tiers.exactAiWord, ...tiers.related];
  const items = allItems.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  return { items, nextCursor: nextOffset < allItems.length ? `v1:${nextOffset}` : null };
}

export async function searchPhotoLibraryTiers(
  query: string,
  providers: PlatformProviders,
): Promise<TieredSearchResult> {
  const normalizedQuery = normalizeTagWord(query);
  const [humanRows, aiRows] = await Promise.all([
    exactHumanRows(providers.database, normalizedQuery),
    exactAiRows(providers.database, normalizedQuery),
  ]);
  const relatedOutcome = await degradeRelatedTier(() =>
    relatedCandidates(normalizedQuery, providers),
  );
  const semanticCandidates = relatedOutcome.candidates;
  const degradedReason = relatedOutcome.degradedReason;

  const ids = [
    ...humanRows.map((row) => row.photo_id),
    ...aiRows.map((row) => row.photo_id),
    ...semanticCandidates.map((row) => row.photoId),
  ];
  const photos = await hydratePhotoSummaries(providers.database, ids);
  const tiers = rankTierBuckets(normalizedQuery, humanRows, aiRows, semanticCandidates, photos);
  return { query: normalizedQuery, tiers, degradedReason };
}

export async function degradeRelatedTier(
  operation: () => Promise<SemanticCandidate[]>,
): Promise<{ candidates: SemanticCandidate[]; degradedReason: string | null }> {
  try {
    return { candidates: await operation(), degradedReason: null };
  } catch (error) {
    return { candidates: [], degradedReason: `related_unavailable: ${providerErrorCode(error)}` };
  }
}

export function rankTierBuckets(
  normalizedQuery: string,
  humanRows: readonly HumanExactRow[],
  aiRows: readonly AiExactRow[],
  semanticCandidates: readonly SemanticCandidate[],
  photos: ReadonlyMap<string, SearchResult["photo"]>,
): SearchTierBuckets {
  const seen = new Set<string>();
  const exactHumanTag: SearchResult[] = [];
  const exactAiWord: SearchResult[] = [];
  const related: SearchResult[] = [];

  for (const row of humanRows) {
    const photo = photos.get(row.photo_id);
    if (!photo || seen.has(photo.id)) continue;
    seen.add(photo.id);
    exactHumanTag.push({
      photo,
      reason: { tier: "exact_human_tag", normalizedTag: normalizedQuery },
    });
  }
  for (const row of aiRows) {
    const photo = photos.get(row.photo_id);
    if (!photo || seen.has(photo.id)) continue;
    seen.add(photo.id);
    exactAiWord.push({
      photo,
      reason: {
        tier: "exact_ai_word",
        normalizedWord: normalizedQuery,
        modelRunId: row.model_run_id,
      },
    });
  }
  for (const row of semanticCandidates) {
    const photo = photos.get(row.photoId);
    if (!photo || seen.has(photo.id)) continue;
    seen.add(photo.id);
    related.push({
      photo,
      reason: {
        tier: "semantic",
        score: row.score,
        vectorId: row.vectorId,
        indexedDocumentRevision: row.indexedDocumentRevision,
      },
    });
  }
  return { exactHumanTag, exactAiWord, related };
}

async function exactHumanRows(database: D1Database, query: string): Promise<HumanExactRow[]> {
  const result = await database
    .prepare(
      `SELECT p.id AS photo_id FROM human_tags ht
       JOIN photo_human_tags pht ON pht.tag_id = ht.id
       JOIN photos p ON p.id = pht.photo_id
       WHERE ht.normalized_name = ? AND p.state = 'ready'
         AND NOT EXISTS (SELECT 1 FROM tombstones t WHERE t.photo_id = p.id)
       ORDER BY p.created_at DESC, p.id ASC LIMIT ?`,
    )
    .bind(query, EXACT_TIER_LIMIT)
    .all<HumanExactRow>();
  return result.results;
}

async function exactAiRows(database: D1Database, query: string): Promise<AiExactRow[]> {
  const result = await database
    .prepare(
      `SELECT p.id AS photo_id, paw.model_run_id FROM photo_ai_words paw
       JOIN photos p ON p.id = paw.photo_id
       WHERE paw.normalized_word = ? AND p.state = 'ready'
         AND paw.document_revision = (
           SELECT MAX(latest.document_revision) FROM photo_ai_words latest
           WHERE latest.photo_id = paw.photo_id
         )
         AND NOT EXISTS (SELECT 1 FROM tombstones t WHERE t.photo_id = p.id)
       ORDER BY p.created_at DESC, p.id ASC LIMIT ?`,
    )
    .bind(query, EXACT_TIER_LIMIT)
    .all<AiExactRow>();
  return result.results;
}

async function relatedCandidates(
  query: string,
  providers: PlatformProviders,
): Promise<SemanticCandidate[]> {
  const embedding = await withTimeout(
    providers.ai.run(MODEL_CONFIG.embedding, { text: query }),
    PROVIDER_TIMEOUT_MS,
    "query_embedding_timeout",
  );
  const values = embedding.data[0];
  if (
    !values ||
    values.length !== MODEL_CONFIG.vectorDimensions ||
    values.some((value) => !Number.isFinite(value))
  ) {
    throw new Error("query_embedding_invalid");
  }
  const matches = await withTimeout(
    providers.vectorize.query(values, {
      topK: SEMANTIC_CANDIDATE_LIMIT,
      // The V2 API rejects the boolean form its own binding types still allow
      // (`40026 … returnMetadata: expected value`), so this must stay the
      // string enum. Only D1 decides which revision is canonical, so no match
      // metadata is read back here.
      returnMetadata: "none",
      returnValues: false,
    }),
    PROVIDER_TIMEOUT_MS,
    "vector_query_timeout",
  );
  const parsed: Omit<SemanticCandidate, "createdAt">[] = matches.matches.flatMap((match) => {
    const vector = parseVectorId(match.id);
    return vector && Number.isFinite(match.score)
      ? [
          {
            photoId: vector.photoId,
            score: match.score,
            vectorId: match.id,
            indexedDocumentRevision: vector.documentRevision,
          },
        ]
      : [];
  });
  if (parsed.length === 0) return [];
  const ids = [...new Set(parsed.map((candidate) => candidate.photoId))];
  const placeholders = ids.map(() => "?").join(", ");
  const canonical = await providers.database
    .prepare(
      `SELECT p.id, p.created_at, p.canonical_indexed_revision, p.canonical_vector_id
       FROM photos p WHERE p.id IN (${placeholders}) AND p.state = 'ready'
         AND p.canonical_indexed_revision IS NOT NULL AND p.canonical_vector_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM tombstones t WHERE t.photo_id = p.id)`,
    )
    .bind(...ids)
    .all<CanonicalVectorRow>();
  return filterCanonicalSemanticCandidates(parsed, canonical.results);
}

export function filterCanonicalSemanticCandidates(
  parsed: readonly Omit<SemanticCandidate, "createdAt">[],
  canonicalRows: readonly CanonicalVectorRow[],
): SemanticCandidate[] {
  const canonicalById = new Map(canonicalRows.map((row) => [row.id, row]));
  const accepted = new Map<string, SemanticCandidate>();
  for (const candidate of parsed) {
    const row = canonicalById.get(candidate.photoId);
    if (
      !row ||
      row.canonical_indexed_revision !== candidate.indexedDocumentRevision ||
      row.canonical_vector_id !== candidate.vectorId
    ) {
      continue;
    }
    const current = accepted.get(candidate.photoId);
    if (!current || candidate.score > current.score) {
      accepted.set(candidate.photoId, { ...candidate, createdAt: row.created_at });
    }
  }
  return [...accepted.values()].sort(
    (left, right) =>
      right.score - left.score ||
      right.createdAt.localeCompare(left.createdAt) ||
      left.photoId.localeCompare(right.photoId),
  );
}

function parseCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const match = /^v1:(\d+)$/.exec(cursor);
  if (!match) throw new RangeError("Invalid search cursor.");
  const offset = Number(match[1]);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 300) {
    throw new RangeError("Invalid search cursor.");
  }
  return offset;
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, code: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(code)), milliseconds);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function providerErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "provider_failure";
  if (error.message.startsWith("query_embedding_")) return error.message;
  if (error.message.startsWith("vector_query_")) return error.message;
  return "provider_failure";
}
