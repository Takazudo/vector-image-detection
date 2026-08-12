import type {
  AiWord,
  HumanTag,
  IsoTimestamp,
  PhotoDetail,
  PhotoId,
  PhotoState,
  PhotoSummary,
  SupportedImageMimeType,
  UploadOperationId,
  UploadOperationState,
} from "./domain";

export interface VersionedDto {
  version: "v1";
}

export interface CursorPage<T> extends VersionedDto {
  items: T[];
  nextCursor: string | null;
}

export interface ApiErrorDetail {
  path: string;
  code: string;
  message: string;
}

export interface ApiErrorResponse {
  version: "v1";
  error: {
    code: string;
    message: string;
    requestId: string;
    retryable: boolean;
    details?: ApiErrorDetail[];
  };
}

export interface ListPhotosRequest extends VersionedDto {
  cursor?: string;
  limit?: number;
}

export type ListPhotosResponse = CursorPage<PhotoSummary>;
export interface GetPhotoResponse extends VersionedDto {
  photo: PhotoDetail;
}

/** Result from the multipart `POST /photos` endpoint. */
export interface CreateUploadResponse extends VersionedDto {
  operationId: UploadOperationId;
  photoId: PhotoId;
  state: UploadOperationState;
  retryable: boolean;
  errorCode: string | null;
  updatedAt: IsoTimestamp;
}

export interface UploadStatusResponse extends VersionedDto {
  operationId: UploadOperationId;
  photoId: PhotoId | null;
  state: UploadOperationState;
  photoState: PhotoState | null;
  retryable: boolean;
  errorCode: string | null;
  updatedAt: IsoTimestamp;
}

export interface MediaDescriptorResponse extends VersionedDto {
  photoId: PhotoId;
  mimeType: SupportedImageMimeType;
  byteSize: number;
  width: number;
  height: number;
  etag: string;
  mediaUrl: string;
}

export interface PhotoWordsResponse extends VersionedDto {
  photoId: PhotoId;
  aiWords: AiWord[];
  documentRevision: number;
}

export interface PhotoTagsResponse extends VersionedDto {
  photoId: PhotoId;
  humanTags: HumanTag[];
  documentRevision: number;
  reindexRequiredRevision: number;
}

export type HumanTagMutationAction = "attach" | "remove";

export interface BulkHumanTagMutationRequest extends VersionedDto {
  action: HumanTagMutationAction;
  photoIds: PhotoId[];
  humanTagNames: string[];
  expectedRevisions?: Record<PhotoId, number>;
}

export interface BulkHumanTagMutationResult {
  photoId: PhotoId;
  status: "updated" | "unchanged" | "conflict" | "not_found";
  documentRevision: number | null;
  humanTags: HumanTag[] | null;
}

export interface BulkHumanTagMutationResponse extends VersionedDto {
  results: BulkHumanTagMutationResult[];
}

export type SearchTier = "exact_human_tag" | "exact_ai_word" | "semantic";

export const SEARCH_TIER_ORDER: readonly SearchTier[] = [
  "exact_human_tag",
  "exact_ai_word",
  "semantic",
];

export type SearchReason =
  | { tier: "exact_human_tag"; normalizedTag: string }
  | { tier: "exact_ai_word"; normalizedWord: string; modelRunId: string }
  | {
      tier: "semantic";
      score: number;
      vectorId: string;
      indexedDocumentRevision: number;
    };

export interface SearchResult {
  photo: PhotoSummary;
  reason: SearchReason;
}

export interface SearchRequest extends VersionedDto {
  query: string;
  cursor?: string;
  limit?: number;
}

export interface SearchResponse extends CursorPage<SearchResult> {
  query: string;
  degraded: boolean;
  degradedReason: string | null;
}

/**
 * A photo related to `:photoId` by canonical-vector similarity. Deliberately
 * reuses `SearchResult`'s `photo`/`reason` shape rather than redeclaring it,
 * so hydration stays shared with `GET /search` — narrowed to the `semantic`
 * variant of `SearchReason` because a related photo is only ever reached via
 * vector similarity, never an exact tag/word match.
 */
export interface RelatedPhotoResult {
  photo: SearchResult["photo"];
  reason: Extract<SearchResult["reason"], { tier: "semantic" }>;
}

export interface RelatedPhotosRequest extends VersionedDto {
  cursor?: string;
  limit?: number;
}

/**
 * The two non-success states a related-photos lookup can report, kept as
 * distinct literals (not collapsed into one flag) per issue #70:
 *  - "vector_pending": `:photoId` has no canonical vector yet. Normal for a
 *    few seconds after enrichment finishes — Vectorize is eventually
 *    consistent — so the UI should read this as "not indexed yet", not as
 *    an error.
 *  - "provider_unavailable": the vector query itself failed (embedding or
 *    Vectorize outage/timeout), mirroring how `GET /search` reports a failed
 *    related-tier lookup via `degradedReason`.
 * An unknown, not-ready, or tombstoned `:photoId` is a 404 (`ApiErrorResponse`)
 * and never reaches this type.
 */
export type RelatedPhotosDegradedReason = "vector_pending" | "provider_unavailable";

export interface RelatedPhotosResponse extends CursorPage<RelatedPhotoResult> {
  photoId: PhotoId;
  degraded: boolean;
  degradedReason: RelatedPhotosDegradedReason | null;
}

export interface HealthResponse {
  version: "v1";
  status: "ok";
  service: "vector-image-detection-demo";
  now: IsoTimestamp;
}

export type ReadinessCheckName =
  | "configuration"
  | "d1"
  | "r2"
  | "queue"
  | "dlq"
  | "workers_ai"
  | "vectorize"
  | "rate_limit"
  | "migrations"
  | "operator_acknowledgements"
  | "auth_gate";

export interface ReadinessCheck {
  name: ReadinessCheckName;
  status: "pass" | "fail" | "deferred";
  detail: string;
}

export interface ReadinessResponse {
  version: "v1";
  status: "ready" | "not_ready";
  environment: "local" | "ci" | "production";
  publicWritesEnabled: boolean;
  models: {
    vision: string;
    embedding: string;
    vectorDimensions: number;
    vectorMetric: "cosine";
  };
  checks: ReadinessCheck[];
  /**
   * The Worker version that produced this response, from the `version_metadata`
   * binding. Deliberately absent from the unauthenticated `/api/v1/readiness`
   * body — only the operator-authenticated deep readiness reports it, because
   * only the deployment gate needs it. Optional because a deployment may not
   * configure the binding at all.
   */
  workerVersionId?: string;
}

export interface OperatorPurgeResponse {
  version: "v1";
  operationId: string;
  photoId: PhotoId;
  tombstoneRevision: number;
  state: "pending";
}

export const API_ROUTES = {
  health: "/api/v1/health",
  readiness: "/api/v1/readiness",
  operatorReadiness: "/api/v1/operator/readiness",
  operatorPurge: "/api/v1/operator/photos/:photoId/purge",
  photos: "/api/v1/photos",
  photo: "/api/v1/photos/:photoId",
  upload: "/api/v1/uploads/:operationId",
  media: "/api/v1/photos/:photoId/media",
  aiWords: "/api/v1/photos/:photoId/ai-words",
  humanTags: "/api/v1/photos/:photoId/human-tags",
  relatedPhotos: "/api/v1/photos/:photoId/related",
  bulkHumanTags: "/api/v1/human-tags/bulk",
  search: "/api/v1/search",
} as const;
