import { describe, expect, it } from "vitest";
import type { IndexMeta } from "./types.js";

describe("@vector-image-detection/core", () => {
  it("exposes the frozen IndexMeta contract", () => {
    const meta: IndexMeta = {
      formatVersion: 1,
      modelId: "test-model",
      dim: 3,
      createdAt: new Date(0).toISOString(),
      items: [],
    };

    expect(meta.formatVersion).toBe(1);
    expect(meta.items).toHaveLength(0);
  });
});
