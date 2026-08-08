import type { Vector } from "../generated/core-browser.mjs";
import { labeling } from "../generated/core-browser.mjs";

/**
 * `embedVocab` takes an `Embedder`, but in the browser the towers live in a Web
 * Worker and only the text side is reachable. This adapts the worker's
 * text-only channel to that interface. `modelId` and `dim` are never read by
 * `embedVocab`, and `embedImages` is unreachable — image vectors arrive
 * precomputed in the index bundle and are never produced client-side.
 */
export function embedVocabInWorker(
  labels: string[],
  embedTexts: (texts: string[]) => Promise<Vector[]>,
): Promise<Map<string, Vector>> {
  return labeling.embedVocab(
    {
      modelId: "worker",
      dim: 0,
      embedTexts,
      embedImages: () => Promise.reject(new Error("images are never embedded in the browser")),
    },
    labels,
  );
}
