import type {
  AiWord,
  HumanTag,
  IsoTimestamp,
  PhotoDetail,
  PhotoId,
  PhotoSummary,
  SourceAttribution,
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

export interface CreateUploadRequest extends VersionedDto {
  filename: string;
  declaredMimeType: SupportedImageMimeType;
  byteSize: number;
  sha256: string;
  attribution?: SourceAttribution;
}

export interface CreateUploadResponse extends VersionedDto {
  operationId: UploadOperationId;
  photoId: PhotoId;
  state: Extract<UploadOperationState, "pending">;
  uploadUrl: string;
  expiresAt: IsoTimestamp;
}

export interface UploadStatusResponse extends VersionedDto {
  operationId: UploadOperationId;
  photoId: PhotoId | null;
  state: UploadOperationState;
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
  | "operator_acknowledgements";

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
}

export const API_ROUTES = {
  health: "/api/v1/health",
  readiness: "/api/v1/readiness",
  operatorReadiness: "/api/v1/operator/readiness",
  photos: "/api/v1/photos",
  photo: "/api/v1/photos/:photoId",
  uploads: "/api/v1/uploads",
  upload: "/api/v1/uploads/:operationId",
  media: "/api/v1/photos/:photoId/media",
  aiWords: "/api/v1/photos/:photoId/ai-words",
  humanTags: "/api/v1/photos/:photoId/human-tags",
  bulkHumanTags: "/api/v1/human-tags/bulk",
  search: "/api/v1/search",
} as const;
