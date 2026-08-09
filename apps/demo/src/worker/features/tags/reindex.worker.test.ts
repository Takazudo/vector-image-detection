import { describe, expect, it } from "vitest";

import { canonicalTextDocument } from "./reindex";

describe("canonical reindex document", () => {
  it("is stable, source-aware, and deduplicated", () => {
    expect(canonicalTextDocument("  A café  ", ["cat", "cat", "pet"], ["cute", "pet"])).toBe(
      "caption: A café\nai words: cat, pet\nhuman tags: cute, pet",
    );
  });

  it("represents missing provider caption explicitly", () => {
    expect(canonicalTextDocument(null, [], [])).toBe("caption: \nai words: \nhuman tags: ");
  });
});
