import { VALIDATION_LIMITS } from "../../config";
import type {
  RelatedPhotoResult,
  RelatedPhotosRequest,
  RelatedPhotosResponse,
} from "../../contracts/api";
import { parseVectorId } from "../../contracts/domain";
import type { PlatformProviders } from "../../providers";
import { hydratePhotoSummaries } from "./photo-hydration";
import {
  canonicalRowsFor,
  filterCanonicalSemanticCandidates,
  parseCursor,
  withTimeout,
  type SemanticCandidate,
} from "./search";

// Vectorize's own hard cap for topK when `returnMetadata` is "none"/"indexed"
// (50 once metadata/values are requested) — see the note on the provider call
// below. This is already the most "comfortably above page size" this
// endpoint can over-fetch, matching search.ts's SEMANTIC_CANDIDATE_LIMIT.
const RELATED_CANDIDATE_LIMIT = 100;
const PROVIDER_TIMEOUT_MS = 2_000;

interface SourcePhotoRow {
  canonical_indexed_revision: number | null;
  canonical_vector_id: string | null;
}

/**
 * The Vectorize-only phase of a lookup, kept separate from D1 candidate
 * canonicalization below so a D1 failure can never be reported as
 * `provider_unavailable` — that reason is reserved for the Vectorize lookup
 * itself (see `RelatedPhotosDegradedReason`'s doc comment in contracts/api.ts).
 */
type VectorizeLookupOutcome =
  | { kind: "matches"; candidates: Omit<SemanticCandidate, "createdAt">[] }
  | { kind: "vector_pending" }
  | { kind: "provider_unavailable" };

export async function getRelatedPhotos(
  photoId: string,
  request: RelatedPhotosRequest,
  providers: PlatformProviders,
): Promise<RelatedPhotosResponse | "not_found"> {
  const source = await providers.database
    .prepare(
      `SELECT p.canonical_indexed_revision, p.canonical_vector_id
       FROM photos p WHERE p.id = ? AND p.state = 'ready'
         AND NOT EXISTS (SELECT 1 FROM tombstones t WHERE t.photo_id = p.id)`,
    )
    .bind(photoId)
    .first<SourcePhotoRow>();
  if (!source) return "not_found";

  const limit = Math.max(
    1,
    Math.min(VALIDATION_LIMITS.maximumPageSize, request.limit ?? VALIDATION_LIMITS.defaultPageSize),
  );
  const offset = parseCursor(request.cursor, RELATED_CANDIDATE_LIMIT);

  // Eventual consistency, case 1: a photo can finish enrichment (D1 committed)
  // before its vector is queryable in Vectorize. That is "not indexed yet",
  // never "no related photos" — the two must not collapse into one response.
  if (source.canonical_indexed_revision === null || source.canonical_vector_id === null) {
    return degradedResponse(photoId, "vector_pending");
  }

  const lookup = await queryRelatedVectorMatches(
    source.canonical_vector_id,
    photoId,
    providers.vectorize,
  );
  if (lookup.kind !== "matches") {
    return degradedResponse(photoId, lookup.kind);
  }

  // Only D1 decides which vector generation is canonical, so a real D1
  // failure here must surface as the normal 500 the router already produces
  // for unhandled errors — never swallowed into a related-photos degradation.
  const candidates =
    lookup.candidates.length === 0
      ? []
      : filterCanonicalSemanticCandidates(
          lookup.candidates,
          await canonicalRowsFor(
            providers.database,
            [...new Set(lookup.candidates.map((candidate) => candidate.photoId))],
          ),
        );

  const page = candidates.slice(offset, offset + limit);
  const photos = await hydratePhotoSummaries(
    providers.database,
    page.map((candidate) => candidate.photoId),
  );
  const items: RelatedPhotoResult[] = [];
  for (const candidate of page) {
    const photo = photos.get(candidate.photoId);
    if (!photo) continue;
    items.push({
      photo,
      reason: {
        tier: "semantic",
        score: candidate.score,
        vectorId: candidate.vectorId,
        indexedDocumentRevision: candidate.indexedDocumentRevision,
      },
    });
  }
  const nextOffset = offset + page.length;
  return {
    version: "v1",
    photoId,
    items,
    nextCursor: nextOffset < candidates.length ? `v1:${nextOffset}` : null,
    degraded: false,
    degradedReason: null,
  };
}

async function queryRelatedVectorMatches(
  canonicalVectorId: string,
  sourcePhotoId: string,
  vectorize: PlatformProviders["vectorize"],
): Promise<VectorizeLookupOutcome> {
  let matches: Awaited<ReturnType<PlatformProviders["vectorize"]["queryById"]>>;
  try {
    matches = await withTimeout(
      vectorize.queryById(canonicalVectorId, {
        topK: RELATED_CANDIDATE_LIMIT,
        // The V2 API rejects the boolean form its own binding types still allow
        // (`40026 … returnMetadata: expected value`), so this must stay the
        // string enum — see the identical note in search.ts. This exact bug
        // shipped to production once already.
        returnMetadata: "none",
        returnValues: false,
      }),
      PROVIDER_TIMEOUT_MS,
      "related_query_timeout",
    );
  } catch {
    return { kind: "provider_unavailable" };
  }

  // Eventual consistency, case 2: `enrichment.ts` awaits Vectorize's async
  // upsert *acknowledgment* (a mutation id) before promoting the canonical
  // fields in D1 — not confirmation that the vector is actually indexed. So
  // even with a non-null D1 canonical vector, `queryById` can still resolve
  // against a not-yet-indexed reference. A resolvable reference always
  // includes itself among its own nearest neighbours (self-similarity is
  // maximal), so its absence here — not a thrown error — is the signal that
  // this is still the "not indexed yet" state, and a genuine zero-matches
  // answer must not be reported as "no related photos".
  const sourceIndexed = matches.matches.some((match) => match.id === canonicalVectorId);
  if (!sourceIndexed) return { kind: "vector_pending" };

  const candidates: Omit<SemanticCandidate, "createdAt">[] = matches.matches.flatMap((match) => {
    if (match.id === canonicalVectorId) return [];
    const vector = parseVectorId(match.id);
    return vector && vector.photoId !== sourcePhotoId && Number.isFinite(match.score)
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
  return { kind: "matches", candidates };
}

function degradedResponse(
  photoId: string,
  reason: "vector_pending" | "provider_unavailable",
): RelatedPhotosResponse {
  return {
    version: "v1",
    photoId,
    items: [],
    nextCursor: null,
    degraded: true,
    degradedReason: reason,
  };
}
