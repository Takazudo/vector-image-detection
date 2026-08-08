import type { Vector } from "../types.js";
import { dot } from "./vector-math.js";

export interface TagScore {
  label: string;
  /**
   * Cosine similarity between an image vector and this label's vocab text
   * vector (dot product of L2-normalized vectors, from `embedVocab`).
   * Similarity relative to this vocabulary/candidate set — not a calibrated
   * confidence, and not comparable across a different vocabulary or
   * threshold. Threshold choice is a per-domain knob, not a universal
   * constant.
   */
  score: number;
}

export interface ZeroShotTagOptions {
  threshold?: number;
}

/**
 * Zero-shot vocabulary tagging: for each image, every vocab label whose
 * cosine similarity to the image is `>= threshold` is proposed as a tag,
 * sorted by score descending (ties broken by label ascending, for
 * deterministic output). An image can end up with zero, one, or many labels
 * — this is the "propose several candidate tags" path; see `classifyByVocab`
 * for single-best-label argmax classification.
 */
export function zeroShotTag(
  imageVectors: Vector[],
  vocabVectors: Map<string, Vector>,
  { threshold = 0.2 }: ZeroShotTagOptions = {},
): TagScore[][] {
  const vocabEntries = [...vocabVectors.entries()];

  return imageVectors.map((imageVector) => {
    const scores: TagScore[] = [];
    for (const [label, vocabVector] of vocabEntries) {
      const score = dot(imageVector, vocabVector);
      if (score >= threshold) scores.push({ label, score });
    }
    scores.sort((a, b) => b.score - a.score || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    return scores;
  });
}

/**
 * Display-only normalization: rescales a set of `TagScore` cosine
 * similarities (softmax, optionally temperature-scaled) so they sum to 1,
 * for rendering something like a relative-favorite bar next to a photo. This
 * is **NOT a probability** — softmax over cosine similarities has no
 * statistical calibration; it is purely a UI presentation transform over
 * already-computed similarity scores. Never label its output "probability"
 * or "confidence" in downstream code or copy.
 */
export function softmaxOverVocab(scores: TagScore[], temperature = 1): TagScore[] {
  if (scores.length === 0) return [];
  const t = temperature > 0 ? temperature : 1;

  // Subtract the max before exponentiating (standard softmax stabilization)
  // — result is unaffected, only avoids overflow for large scores/small t.
  const maxScore = Math.max(...scores.map((s) => s.score));
  const weights = scores.map((s) => Math.exp((s.score - maxScore) / t));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;

  return scores.map((s, i) => ({ label: s.label, score: weights[i]! / sum }));
}
