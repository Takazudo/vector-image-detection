// Qdrant point ids must be an unsigned integer or a UUID string — our own
// `IndexItem.id`/`VectorStoreItem.id` values are arbitrary strings (e.g.
// filenames or slugs), so they can't be used as Qdrant point ids directly.
// This module deterministically maps an arbitrary id string to a UUID-shaped
// string: same input always maps to the same point id, so re-syncing an
// index (`upsert`) updates the existing Qdrant point instead of creating a
// duplicate. The mapping is one-way (not a cryptographic hash — collisions
// are astronomically unlikely for realistic dataset sizes but not proven
// impossible), so `QdrantVectorStore` also stores the original id in the
// point's payload and reads it back on search rather than trying to invert
// the hash.

/** Payload key `QdrantVectorStore` uses to round-trip the original (our-side) item id. */
export const QDRANT_SOURCE_ID_PAYLOAD_KEY = "__vecStoreId";

// FNV-1a — cheap, dependency-free, stable across platforms/Node versions
// (same algorithm already used by embedding/fake-embedder.ts).
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function writeUint32BE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function toHex(bytes: Uint8Array, start: number, end: number): string {
  let hex = "";
  for (let i = start; i < end; i++) hex += bytes[i]!.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Deterministically derives a syntactically-valid UUID string from an
 * arbitrary id, for use as a Qdrant point id. Not a cryptographic hash —
 * derived from four independently-salted FNV-1a hashes — but stable and
 * effectively collision-free for dataset sizes this project targets.
 */
export function toQdrantPointId(id: string): string {
  const bytes = new Uint8Array(16);
  writeUint32BE(bytes, 0, fnv1a(`qdrant-id:0:${id}`));
  writeUint32BE(bytes, 4, fnv1a(`qdrant-id:1:${id}`));
  writeUint32BE(bytes, 8, fnv1a(`qdrant-id:2:${id}`));
  writeUint32BE(bytes, 12, fnv1a(`qdrant-id:3:${id}`));

  // RFC 4122 version/variant nibbles, so the result reads as a "real" UUID
  // (version 5 = name-based, matching the spirit of this derivation).
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  return [
    toHex(bytes, 0, 4),
    toHex(bytes, 4, 6),
    toHex(bytes, 6, 8),
    toHex(bytes, 8, 10),
    toHex(bytes, 10, 16),
  ].join("-");
}
