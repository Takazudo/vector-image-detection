import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { PhotoSummary } from "../../contracts/domain";
import { MODEL_CONFIG } from "../../config";
import type { PlatformProviders } from "../../providers";
import { applyMigration } from "../../../../test-support/apply-migration";
import {
  filterCanonicalSemanticCandidates,
  flattenTierPage,
  degradeRelatedTier,
  rankTierBuckets,
  searchPhotoLibrary,
  type SearchTierBuckets,
} from "./search";
import migration from "../../../../migrations/0001_public_photo_library.sql?raw";

describe("related tier provider call", () => {
  it("asks Vectorize for metadata in the string form the V2 API accepts", async () => {
    await applyMigration(env.DB, migration);
    const options: Record<string, unknown>[] = [];
    const response = await searchPhotoLibrary(
      { version: "v1", query: "cat", limit: 24 },
      fakeProviders(options),
    );

    // The binding's own types still allow `returnMetadata: false`, but the V2
    // API answers `40026 … returnMetadata: expected value` for the boolean and
    // the whole related tier silently degrades.
    expect(options).toHaveLength(1);
    expect(options[0]?.returnMetadata).toBe("none");
    expect(typeof options[0]?.returnMetadata).not.toBe("boolean");
    expect(response.degraded).toBe(false);
    expect(response.degradedReason).toBeNull();
  });
});

function fakeProviders(options: Record<string, unknown>[]): PlatformProviders {
  return {
    database: env.DB,
    ai: {
      run: async () => ({
        data: [Array.from({ length: MODEL_CONFIG.vectorDimensions }, () => 0.125)],
      }),
    },
    vectorize: {
      query: async (_values: number[], queryOptions: Record<string, unknown>) => {
        options.push(queryOptions);
        return { count: 0, matches: [] };
      },
    },
  } as unknown as PlatformProviders;
}

describe("deterministic tiered search", () => {
  it("keeps exact-human over exact-AI over related and deduplicates across sources", () => {
    const photos = new Map(["human", "ai", "semantic"].map((id) => [id, photo(id)]));
    const tiers = rankTierBuckets(
      "cat",
      [{ photo_id: "human" }],
      [
        { photo_id: "human", model_run_id: "run-human" },
        { photo_id: "ai", model_run_id: "run-ai" },
      ],
      [semantic("human", 0.99), semantic("ai", 0.98), semantic("semantic", 0.97)],
      photos,
    );

    expect(tiers.exactHumanTag.map((item) => item.photo.id)).toEqual(["human"]);
    expect(tiers.exactAiWord.map((item) => item.photo.id)).toEqual(["ai"]);
    expect(tiers.related.map((item) => item.photo.id)).toEqual(["semantic"]);
    expect([
      tiers.exactHumanTag[0]?.reason.tier,
      tiers.exactAiWord[0]?.reason.tier,
      tiers.related[0]?.reason.tier,
    ]).toEqual(["exact_human_tag", "exact_ai_word", "semantic"]);
  });

  it("rejects missing, stale, and noncanonical vectors and ignores provider ordering", () => {
    const accepted = filterCanonicalSemanticCandidates(
      [
        semanticWithoutCreated("stale", 1, 1),
        semanticWithoutCreated("canonical-b", 0.7, 2),
        semanticWithoutCreated("missing", 0.99, 1),
        semanticWithoutCreated("canonical-a", 0.7, 3),
        { ...semanticWithoutCreated("canonical-b", 0.6, 1), vectorId: "canonical-b:wrong" },
      ],
      [
        canonical("stale", 2, "stale:2", "2026-01-01T00:00:00.000Z"),
        canonical("canonical-a", 3, "canonical-a:3", "2026-01-02T00:00:00.000Z"),
        canonical("canonical-b", 2, "canonical-b:2", "2026-01-01T00:00:00.000Z"),
      ],
    );

    expect(accepted.map((item) => item.photoId)).toEqual(["canonical-a", "canonical-b"]);
  });

  it("paginates only after fixed tier ordering", () => {
    const tiers: SearchTierBuckets = {
      exactHumanTag: [result("human", "exact_human_tag")],
      exactAiWord: [result("ai", "exact_ai_word")],
      related: [result("semantic", "semantic")],
    };
    expect(flattenTierPage(tiers, 0, 2)).toMatchObject({
      items: [{ photo: { id: "human" } }, { photo: { id: "ai" } }],
      nextCursor: "v1:2",
    });
    expect(flattenTierPage(tiers, 2, 2)).toMatchObject({
      items: [{ photo: { id: "semantic" } }],
      nextCursor: null,
    });
  });

  it("turns related-provider failure into an explicit degradation instead of rejecting exact tiers", async () => {
    await expect(
      degradeRelatedTier(() => Promise.reject(new Error("vector_query_timeout"))),
    ).resolves.toEqual({
      candidates: [],
      degradedReason: "related_unavailable: vector_query_timeout",
    });
  });
});

function photo(id: string): PhotoSummary {
  return {
    id,
    state: "ready",
    width: 100,
    height: 100,
    mimeType: "image/jpeg",
    mediaUrl: `/media/${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    readyAt: "2026-01-01T00:00:00.000Z",
    documentRevision: 1,
    aiWords: [],
    humanTags: [],
    attribution: null,
  };
}

function semantic(photoId: string, score: number) {
  return { ...semanticWithoutCreated(photoId, score, 1), createdAt: "2026-01-01T00:00:00.000Z" };
}

function semanticWithoutCreated(photoId: string, score: number, revision: number) {
  return { photoId, score, vectorId: `${photoId}:${revision}`, indexedDocumentRevision: revision };
}

function canonical(id: string, revision: number, vectorId: string, createdAt: string) {
  return {
    id,
    created_at: createdAt,
    canonical_indexed_revision: revision,
    canonical_vector_id: vectorId,
  };
}

function result(id: string, tier: "exact_human_tag" | "exact_ai_word" | "semantic") {
  const reason =
    tier === "exact_human_tag"
      ? ({ tier, normalizedTag: "cat" } as const)
      : tier === "exact_ai_word"
        ? ({ tier, normalizedWord: "cat", modelRunId: "run" } as const)
        : ({ tier, score: 0.5, vectorId: `${id}:1`, indexedDocumentRevision: 1 } as const);
  return { photo: photo(id), reason };
}
