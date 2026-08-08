import { describe, expect, it } from "vitest";
import { createEmbedder } from "./create-embedder.js";

// Network-free: only exercises config resolution / validation, never
// triggers a model load (that only happens lazily inside embedImages /
// embedTexts, exercised by the gated real-model spike in model-spike.test.ts).
describe("createEmbedder (config, network-free)", () => {
  it("defaults to SigLIP with dim=768", () => {
    const embedder = createEmbedder();
    expect(embedder.modelId).toBe("Xenova/siglip-base-patch16-224");
    expect(embedder.dim).toBe(768);
  });

  it("accepts a CLIP modelId as a config-swappable A/B alternative", () => {
    const embedder = createEmbedder({ modelId: "Xenova/clip-vit-base-patch32", dim: 512 });
    expect(embedder.modelId).toBe("Xenova/clip-vit-base-patch32");
    expect(embedder.dim).toBe(512);
  });

  it("preserves an explicit dim override for the default SigLIP model", () => {
    const embedder = createEmbedder({ dim: 768, dtype: "fp32" });
    expect(embedder.dim).toBe(768);
  });

  it("rejects a modelId that isn't recognizably SigLIP or CLIP", () => {
    expect(() => createEmbedder({ modelId: "Xenova/vit-gpt2-image-captioning" })).toThrow(
      /unrecognized modelId/i,
    );
  });
});
