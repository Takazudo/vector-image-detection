export const API_VERSION = "v1" as const;

export type PhotoId = string;
export type UploadOperationId = string;
export type QueueOperationId = string;
export type IsoTimestamp = string;

export type PhotoState =
  "pending" | "enqueue_failed" | "processing" | "ready" | "failed" | "tombstoned";

export type SupportedImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export interface SourceAttribution {
  sourceUrl: string | null;
  licenseName: string | null;
  licenseUrl: string | null;
  authorName: string | null;
  authorUrl: string | null;
}

export interface AiWord {
  kind: "ai-word";
  word: string;
  normalizedWord: string;
  confidence: number | null;
  modelRunId: string;
}

export interface HumanTag {
  kind: "human-tag";
  id: string;
  name: string;
  normalizedName: string;
  createdAt: IsoTimestamp;
}

export interface PhotoSummary {
  id: PhotoId;
  state: PhotoState;
  width: number;
  height: number;
  mimeType: SupportedImageMimeType;
  mediaUrl: string;
  createdAt: IsoTimestamp;
  readyAt: IsoTimestamp | null;
  documentRevision: number;
  aiWords: AiWord[];
  humanTags: HumanTag[];
  attribution: SourceAttribution | null;
}

export interface PhotoDetail extends PhotoSummary {
  byteSize: number;
  sha256: string;
  aiCaption: string | null;
  canonicalIndexedRevision: number | null;
  reindexRequiredRevision: number | null;
}

/**
 * A vector ID is immutable for one document generation. D1 selects the
 * canonical indexed revision; workers must never reuse an older generation's
 * ID, even when Queue delivery is reordered.
 */
export function vectorIdFor(photoId: PhotoId, documentRevision: number): string {
  if (!Number.isSafeInteger(documentRevision) || documentRevision < 1) {
    throw new RangeError("documentRevision must be a positive safe integer");
  }
  const vectorId = `${photoId}:${documentRevision}`;
  if (new TextEncoder().encode(vectorId).byteLength > 64) {
    throw new RangeError("Vectorize IDs must not exceed 64 UTF-8 bytes");
  }
  return vectorId;
}

export function parseVectorId(value: string): {
  photoId: PhotoId;
  documentRevision: number;
} | null {
  if (new TextEncoder().encode(value).byteLength > 64) return null;
  const separator = value.lastIndexOf(":");
  if (separator <= 0) return null;
  const documentRevision = Number(value.slice(separator + 1));
  if (!Number.isSafeInteger(documentRevision) || documentRevision < 1) return null;
  return { photoId: value.slice(0, separator), documentRevision };
}
