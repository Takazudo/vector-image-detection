import { MODEL_CONFIG } from "../../config";
import type { PlatformProviders } from "../../providers";

export interface EnrichmentProviders {
  describe(image: Uint8Array, prompt: string): Promise<unknown>;
  embed(document: string): Promise<unknown>;
  upsertVector(
    id: string,
    values: number[],
    metadata: Record<string, string | number>,
  ): Promise<void>;
  deleteVectors(ids: string[]): Promise<void>;
}

export function createEnrichmentProviders(platform: PlatformProviders): EnrichmentProviders {
  return {
    describe: async (image, prompt) =>
      platform.ai.run(MODEL_CONFIG.vision, {
        task: "query",
        image: imageDataUri(image),
        question: prompt,
        reasoning: false,
        max_tokens: 512,
        temperature: 0,
        stream: false,
      }),
    embed: async (document) => platform.ai.run(MODEL_CONFIG.embedding, { text: [document] }),
    upsertVector: async (id, values, metadata) => {
      await platform.vectorize.upsert([{ id, values, metadata }]);
    },
    deleteVectors: async (ids) => {
      if (ids.length > 0) await platform.vectorize.deleteByIds(ids);
    },
  };
}

function imageDataUri(image: Uint8Array): string {
  const mimeType = detectImageMimeType(image);
  const chunks: string[] = [];
  const chunkSize = 24_576;
  for (let offset = 0; offset < image.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...image.subarray(offset, offset + chunkSize)));
  }
  return `data:${mimeType};base64,${btoa(chunks.join(""))}`;
}

function detectImageMimeType(image: Uint8Array): "image/jpeg" | "image/png" | "image/webp" {
  if (image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff) return "image/jpeg";
  if (
    image[0] === 0x89 &&
    image[1] === 0x50 &&
    image[2] === 0x4e &&
    image[3] === 0x47 &&
    image[4] === 0x0d &&
    image[5] === 0x0a &&
    image[6] === 0x1a &&
    image[7] === 0x0a
  )
    return "image/png";
  if (
    image[0] === 0x52 &&
    image[1] === 0x49 &&
    image[2] === 0x46 &&
    image[3] === 0x46 &&
    image[8] === 0x57 &&
    image[9] === 0x45 &&
    image[10] === 0x42 &&
    image[11] === 0x50
  )
    return "image/webp";
  throw new Error("Validated image bytes did not contain a supported image signature.");
}

export class FakeEnrichmentProviders implements EnrichmentProviders {
  readonly vectors = new Map<
    string,
    { values: number[]; metadata: Record<string, string | number> }
  >();
  deleted: string[] = [];
  describeResult: unknown = { caption: "A test image", words: ["test", "image"] };
  embedResult: unknown = { data: [Array.from({ length: MODEL_CONFIG.vectorDimensions }, () => 0)] };
  describeError: Error | null = null;
  embedError: Error | null = null;
  upsertError: Error | null = null;

  async describe(_image: Uint8Array, _prompt: string): Promise<unknown> {
    if (this.describeError) throw this.describeError;
    return this.describeResult;
  }

  async embed(_document: string): Promise<unknown> {
    if (this.embedError) throw this.embedError;
    return this.embedResult;
  }

  async upsertVector(
    id: string,
    values: number[],
    metadata: Record<string, string | number>,
  ): Promise<void> {
    if (this.upsertError) throw this.upsertError;
    this.vectors.set(id, { values: [...values], metadata: { ...metadata } });
  }

  async deleteVectors(ids: string[]): Promise<void> {
    this.deleted.push(...ids);
    for (const id of ids) this.vectors.delete(id);
  }
}
