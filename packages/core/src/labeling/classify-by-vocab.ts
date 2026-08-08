import type { Vector } from "../types.js";
import type { TagScore } from "./zero-shot-tag.js";
import { dot } from "./vector-math.js";

/**
 * Argmax classification against a fixed vocabulary: for each image, the
 * single vocab label with the highest cosine similarity (ties broken by
 * label ascending, for deterministic output). This is the *reliable*
 * auto-categorize path (e.g. the cat/dog demo) — unlike `zeroShotTag`'s
 * multi-label threshold proposals, picking a single best-of-set winner
 * degrades far less on a small, well-separated vocabulary.
 */
export function classifyByVocab(imageVectors: Vector[], vocabVectors: Map<string, Vector>): TagScore[] {
  if (vocabVectors.size === 0) {
    throw new Error("classifyByVocab: vocabVectors must not be empty");
  }
  const vocabEntries = [...vocabVectors.entries()];

  return imageVectors.map((imageVector) => {
    let bestLabel = vocabEntries[0]![0];
    let bestScore = dot(imageVector, vocabEntries[0]![1]);
    for (let i = 1; i < vocabEntries.length; i++) {
      const [label, vocabVector] = vocabEntries[i]!;
      const score = dot(imageVector, vocabVector);
      if (score > bestScore || (score === bestScore && label < bestLabel)) {
        bestLabel = label;
        bestScore = score;
      }
    }
    return { label: bestLabel, score: bestScore };
  });
}
