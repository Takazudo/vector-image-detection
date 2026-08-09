import { describe, expect, it } from "vitest";

import { parseVectorId, vectorIdFor } from "./domain";
import { photoQueueMessageSchema } from "./queue";

describe("generation-stamped vector identity", () => {
  it("keeps reordered document revisions on distinct Vectorize IDs", () => {
    expect(vectorIdFor("photo-1", 7)).toBe("photo-1:7");
    expect(vectorIdFor("photo-1", 8)).toBe("photo-1:8");
    expect(parseVectorId("photo:with:colon:8")).toEqual({
      photoId: "photo:with:colon",
      documentRevision: 8,
    });
  });

  it("rejects invalid revisions", () => {
    expect(() => vectorIdFor("photo-1", 0)).toThrow(RangeError);
    expect(() => vectorIdFor("x".repeat(64), 1)).toThrow(/64 UTF-8 bytes/);
    expect(parseVectorId("photo-1:0")).toBeNull();
  });
});

describe("Queue contract", () => {
  it("requires a unique operation and requested revision for enrichment", () => {
    expect(
      photoQueueMessageSchema.safeParse({
        version: 1,
        type: "enrich",
        operationId: "operation-1",
        photoId: "photo-1",
        requestedDocumentRevision: 2,
        enqueuedAt: "2026-08-10T00:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      photoQueueMessageSchema.safeParse({
        version: 1,
        type: "enrich",
        operationId: "operation-1",
        photoId: "photo-1",
        enqueuedAt: "2026-08-10T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      photoQueueMessageSchema.safeParse({
        version: 1,
        type: "enrich",
        operationId: "operation-1",
        photoId: "photo-1",
        requestedDocumentRevision: 2,
        enqueuedAt: "2026-08-10T00:00:00.000Z",
        unversionedExtraField: true,
      }).success,
    ).toBe(false);
  });
});
