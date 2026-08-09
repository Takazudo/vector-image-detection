import { describe, expect, it } from "vitest";

import { MODEL_CONFIG } from "../../config";
import {
  canonicalDocument,
  parseEmbedding,
  parseVisionOutput,
  ProcessingError,
} from "./enrichment";
import { FakeEnrichmentProviders } from "./providers";

describe("untrusted enrichment output", () => {
  it("normalizes and bounds words while preserving a concise caption", () => {
    expect(
      parseVisionOutput({
        description: '```json\n{"caption":" A  cat ","words":["Cat"," cat ",42,"Pet"]}\n```',
      }),
    ).toEqual({ caption: "A cat", words: ["cat", "pet"] });
  });

  it("rejects malformed output and no usable suggested words", () => {
    expect(() => parseVisionOutput("not json")).toThrowError(ProcessingError);
    expect(() => parseVisionOutput({ caption: "caption", words: [42] })).toThrow(/no usable words/);
  });

  it("requires exactly 768 finite embedding values", () => {
    const vector = Array.from({ length: MODEL_CONFIG.vectorDimensions }, () => 0.25);
    expect(parseEmbedding({ data: [vector] })).toEqual(vector);
    expect(() => parseEmbedding({ data: [vector.slice(1)] })).toThrow(/exactly 768/);
    vector[1] = Number.NaN;
    expect(() => parseEmbedding({ data: [vector] })).toThrow(/finite/);
  });

  it("builds one deterministic canonical document from separate provenance", () => {
    expect(canonicalDocument("A dog", ["pet", "dog", "pet"], ["friendly", "dog"])).toBe(
      "caption: A dog\nai words: dog, pet\nhuman tags: dog, friendly",
    );
  });

  it("provides credential-free AI and Vectorize fakes", async () => {
    const fake = new FakeEnrichmentProviders();
    await fake.upsertVector("photo:1", [1, 2], { photoId: "photo" });
    expect(fake.vectors.has("photo:1")).toBe(true);
    await fake.deleteVectors(["photo:1"]);
    expect(fake.vectors.has("photo:1")).toBe(false);
  });
});
