import type { Embedder, ImageInput, Vector } from "../types.js";

/** Explicit seeding input, for tests that want direct control over the keyword/id. */
export interface FakeEmbedderExplicitInput {
  keyword: string;
  id: string;
}

export type FakeEmbedderImageInput = ImageInput | FakeEmbedderExplicitInput;
export type FakeEmbedderTextInput = string | FakeEmbedderExplicitInput;

export interface FakeEmbedderConfig {
  dim?: number;
}

const DEFAULT_DIM = 32;

// Ground-truth labels used across both sample datasets (see
// scripts/fetch-samples.mjs's PET_CAT_DOG_NAMES / COMPONENT_CATEGORIES
// knownLabel values). A text input is matched against this list to find its
// seeding keyword; anything not on the list falls back to using the whole
// (lowercased) string as its own keyword.
const KNOWN_KEYWORDS = ["cat", "dog", "capacitor", "resistor", "connector", "led"];

// Small relative to the unit-length base vector, so a jittered image vector
// stays much closer to its own keyword's base vector (and to other images of
// the same keyword) than to any other keyword's base vector.
const IMAGE_JITTER_MAGNITUDE = 0.15;

function isExplicitInput(value: unknown): value is FakeEmbedderExplicitInput {
  return (
    typeof value === "object" &&
    value !== null &&
    !(value instanceof Blob) &&
    !(value instanceof URL) &&
    "keyword" in value &&
    "id" in value
  );
}

function basenameOf(pathish: string): string {
  const segments = pathish.split(/[\\/]/);
  return segments.at(-1) ?? pathish;
}

function firstTokenOf(basename: string): string {
  const stem = basename.replace(/\.[a-zA-Z0-9]+$/, "");
  const token = stem.split(/[^a-zA-Z0-9]+/)[0];
  return token && token.length > 0 ? token : stem;
}

/** Best-effort stable key for a Blob input, which carries no filename of its own. */
function blobFallbackKey(blob: Blob): string {
  const name = (blob as { name?: unknown }).name;
  if (typeof name === "string" && name.length > 0) return name;
  return `blob:${blob.type || "unknown"}:${blob.size}`;
}

function extractImageSeed(input: FakeEmbedderImageInput): { keyword: string; itemKey: string } {
  if (isExplicitInput(input)) {
    return { keyword: input.keyword.toLowerCase(), itemKey: input.id };
  }
  const pathish =
    input instanceof URL
      ? input.pathname
      : typeof input === "string"
        ? input
        : blobFallbackKey(input);
  const keyword = firstTokenOf(basenameOf(pathish)).toLowerCase();
  return { keyword: keyword.length > 0 ? keyword : "unknown", itemKey: pathish };
}

function extractTextSeed(input: FakeEmbedderTextInput): { keyword: string; itemKey: string } {
  if (isExplicitInput(input)) {
    return { keyword: input.keyword.toLowerCase(), itemKey: input.id };
  }
  const lower = input.toLowerCase();
  const known = KNOWN_KEYWORDS.find((keyword) => lower.includes(keyword));
  const keyword = known ?? lower.trim();
  return { keyword: keyword.length > 0 ? keyword : "unknown", itemKey: input };
}

// FNV-1a — cheap, dependency-free, stable across platforms/Node versions.
function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// mulberry32 — small, fast, deterministic PRNG seeded from the hash above.
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalize(vec: Float32Array): Vector {
  let sumSquares = 0;
  for (const value of vec) sumSquares += value * value;
  const norm = Math.sqrt(sumSquares) || 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = (vec[i] ?? 0) / norm;
  return out;
}

function seededUnitVector(seed: string, dim: number): Float32Array {
  const rand = mulberry32(hashString(seed));
  const vec = new Float32Array(dim);
  for (let i = 0; i < dim; i++) vec[i] = rand() * 2 - 1;
  return normalize(vec);
}

/**
 * Deterministic, network-free stand-in for a real `Embedder`. Every
 * downstream module's tests depend on its alignment property: text and
 * images that share a "keyword" land close together in the fake space, so
 * e.g. `embedTexts(['a photo of a cat'])` is genuinely closest to any image
 * seeded from `cat-*.jpg`.
 *
 * Seeding rule:
 * - Image inputs given as a path (`.../cat-abc.jpg`) derive their keyword
 *   from the filename's first `[-_.]`-delimited token (`cat`), then apply a
 *   small deterministic per-item jitter so same-keyword images are close but
 *   not identical (mirrors real embeddings of distinct photos of one class).
 * - Text inputs derive their keyword from the first known keyword
 *   (see `KNOWN_KEYWORDS`) they contain, else fall back to the whole
 *   (lowercased) string. No jitter — same keyword, same text vector.
 * - Both also accept an explicit `{ keyword, id }` input, bypassing
 *   filename/substring parsing entirely.
 * - Unknown keywords still get a deterministic seeded vector (hash of the
 *   keyword string); with dim=32 these land distinct/orthogonal-ish from
 *   every other keyword's vector with overwhelming probability.
 */
export class FakeEmbedder implements Embedder {
  readonly modelId = "fake-embedder-v1";
  readonly dim: number;

  constructor(config: FakeEmbedderConfig = {}) {
    this.dim = config.dim ?? DEFAULT_DIM;
  }

  async embedImages(images: FakeEmbedderImageInput[]): Promise<Vector[]> {
    return images.map((image) => {
      const { keyword, itemKey } = extractImageSeed(image);
      const base = seededUnitVector(keyword, this.dim);
      const jitter = seededUnitVector(`jitter:${itemKey}`, this.dim);
      const jittered = new Float32Array(this.dim);
      for (let i = 0; i < this.dim; i++) {
        jittered[i] = (base[i] ?? 0) + (jitter[i] ?? 0) * IMAGE_JITTER_MAGNITUDE;
      }
      return normalize(jittered);
    });
  }

  async embedTexts(texts: FakeEmbedderTextInput[]): Promise<Vector[]> {
    return texts.map((text) => {
      const { keyword } = extractTextSeed(text);
      return seededUnitVector(keyword, this.dim);
    });
  }
}
