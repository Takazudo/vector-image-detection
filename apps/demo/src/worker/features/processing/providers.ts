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
        image: [...image],
        prompt,
        max_tokens: 512,
        temperature: 0,
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
