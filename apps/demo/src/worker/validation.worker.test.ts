import { describe, expect, it } from "vitest";

import { bulkHumanTagMutationSchema, createUploadRequestSchema } from "./validation";

describe("frozen write validation", () => {
  it("accepts only supported bounded upload metadata", () => {
    expect(
      createUploadRequestSchema.safeParse({
        version: "v1",
        filename: "photo.webp",
        declaredMimeType: "image/webp",
        byteSize: 1024,
        sha256: "a".repeat(64),
      }).success,
    ).toBe(true);
    expect(
      createUploadRequestSchema.safeParse({
        version: "v1",
        filename: "photo.gif",
        declaredMimeType: "image/gif",
        byteSize: 1024,
        sha256: "a".repeat(64),
      }).success,
    ).toBe(false);
  });

  it("keeps human tag mutations separate from AI words and rejects duplicates", () => {
    const request = {
      version: "v1",
      action: "attach",
      photoIds: ["photo-1"],
      humanTagNames: ["Cat"],
    };
    expect(bulkHumanTagMutationSchema.parse(request).humanTagNames).toEqual(["cat"]);
    expect(bulkHumanTagMutationSchema.safeParse({ ...request, aiWords: ["cat"] }).success).toBe(
      false,
    );
    expect(
      bulkHumanTagMutationSchema.safeParse({ ...request, humanTagNames: ["Cat", "cat"] }).success,
    ).toBe(false);
  });
});
