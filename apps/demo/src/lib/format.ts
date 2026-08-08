import type { IndexItem } from "@vector-image-detection/core/browser";

/** Similarity scores are cosine similarities in [-1, 1]; three decimals is enough to rank by eye. */
export function formatScore(score: number): string {
  return score.toFixed(3);
}

/** Bar width for a similarity score. Negative similarity reads as "no match", so it clamps to zero rather than flipping direction. */
export function scoreBarPercent(score: number): number {
  return Math.round(Math.min(1, Math.max(0, score)) * 100);
}

/** Short display label — the filename, since `file` is a path relative to the ingested directory. */
export function itemLabel(item: IndexItem): string {
  return item.file.split("/").at(-1) ?? item.file;
}

export function hasAttribution(item: IndexItem): boolean {
  return Boolean(item.author || item.license || item.source);
}
