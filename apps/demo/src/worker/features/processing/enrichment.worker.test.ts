import { describe, expect, it } from "vitest";

import { MODEL_CONFIG } from "../../config";
import {
  canonicalDocument,
  parseEmbedding,
  parseVisionOutput,
  ProcessingError,
} from "./enrichment";
import type { PlatformProviders } from "../../providers";
import { createEnrichmentProviders, FakeEnrichmentProviders } from "./providers";

describe("untrusted enrichment output", () => {
  it("normalizes and bounds words while preserving a concise caption", () => {
    expect(
      parseVisionOutput({
        description: '```json\n{"caption":" A  cat ","words":["Cat"," cat ",42,"Pet"]}\n```',
      }),
    ).toEqual({ caption: "A cat", words: ["cat", "pet"] });
  });

  it("parses the documented non-streaming Moondream answer shape", () => {
    expect(parseVisionOutput({ answer: '{"caption":"A cat","words":["cat","pet"]}' })).toEqual({
      caption: "A cat",
      words: ["cat", "pet"],
    });
  });

  it("peels the Workers AI envelope the pinned Moondream binding actually returns", () => {
    expect(
      parseVisionOutput({
        result: {
          answer: '{"caption":"A cat","words":["cat","pet"]}',
          caption: null,
          finish_reason: "stop",
          objects: null,
          points: null,
          reasoning: null,
        },
        usage: { prompt_tokens: 735, completion_tokens: 42, total_tokens: 777 },
      }),
    ).toEqual({ caption: "A cat", words: ["cat", "pet"] });
  });

  it("salvages an answer truncated by a repetition loop hitting max_tokens", () => {
    const truncated = `{\n  "caption": "Capacitors",\n  "words": [\n    "electrolytic",\n    "electrolytic",\n    "electro`;
    expect(parseVisionOutput({ result: { answer: truncated, finish_reason: "length" } })).toEqual({
      caption: "Capacitors",
      words: ["electrolytic"],
    });
  });

  it("salvages a truncation that lands on a key with no value yet", () => {
    const truncated = `{"caption":"A cat","words":["cat","pet"],"note`;
    expect(parseVisionOutput({ answer: truncated })).toEqual({
      caption: "A cat",
      words: ["cat", "pet"],
    });
  });

  it("rejects malformed output and no usable suggested words", () => {
    expect(() => parseVisionOutput("not json")).toThrowError(ProcessingError);
    expect(() => parseVisionOutput({ caption: "caption", words: [42] })).toThrow(/no usable words/);
  });

  it("does not salvage prose that merely contains a JSON fragment", () => {
    expect(() => parseVisionOutput({ answer: 'Here is the JSON: {"caption":"A cat"' })).toThrow(
      /not valid JSON/,
    );
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

  it("sends Moondream a non-streaming query with a base64 image data URI", async () => {
    let input: unknown;
    const platform = {
      ai: {
        run: async (_model: string, value: unknown) => {
          input = value;
          return { answer: '{"caption":"A test image","words":["test"]}' };
        },
      },
    } as unknown as PlatformProviders;
    const providers = createEnrichmentProviders(platform);
    await providers.describe(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      "Return JSON",
    );
    expect(input).toMatchObject({
      task: "query",
      image: "data:image/png;base64,iVBORw0KGgo=",
      question: "Return JSON",
      reasoning: false,
      max_tokens: 512,
      temperature: 0,
      stream: false,
    });
  });
});
