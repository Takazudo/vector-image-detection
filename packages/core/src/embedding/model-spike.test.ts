import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Vector } from "../types.js";
import { createEmbedder } from "./create-embedder.js";

// Real-model spike — gated behind RUN_MODEL_TESTS=1 so `pnpm test` stays
// network-free by default. First run downloads the SigLIP q8 weights
// (~200MB) into ~/.cache/vector-image-detection/models; expect it to take
// several minutes. Run once locally with:
//   RUN_MODEL_TESTS=1 pnpm test
const RUN_MODEL_TESTS = process.env.RUN_MODEL_TESTS === "1";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");

function dot(a: Vector, b: Vector): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

function magnitude(v: Vector): number {
  return Math.sqrt(dot(v, v));
}

describe.skipIf(!RUN_MODEL_TESTS)(
  "real-model spike: SigLIP (Xenova/siglip-base-patch16-224)",
  () => {
    it("embeds the cat/dog fixtures and matching texts into one aligned, L2-normalized 768-dim space", async () => {
      const embedder = createEmbedder();
      expect(embedder.modelId).toBe("Xenova/siglip-base-patch16-224");
      expect(embedder.dim).toBe(768);

      const [catImage, dogImage] = await embedder.embedImages([
        path.join(fixturesDir, "cat.jpg"),
        path.join(fixturesDir, "dog.jpg"),
      ]);
      const [catText, dogText] = await embedder.embedTexts([
        "a photo of a cat",
        "a photo of a dog",
      ]);

      for (const v of [catImage, dogImage, catText, dogText]) {
        expect(v).toBeDefined();
        expect(v?.length).toBe(768);
        expect(magnitude(v as Vector)).toBeCloseTo(1, 4);
      }

      expect(dot(catText as Vector, catImage as Vector)).toBeGreaterThan(
        dot(catText as Vector, dogImage as Vector),
      );
      expect(dot(dogText as Vector, dogImage as Vector)).toBeGreaterThan(
        dot(dogText as Vector, catImage as Vector),
      );
    }, 900_000); // model download + CPU inference; generous timeout for a once-off local run
  },
);
