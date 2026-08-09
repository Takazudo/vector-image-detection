import { describe, expect, it } from "vitest";

import { normalizeTagWord } from "./normalization";

describe("human-tag normalization", () => {
  it("normalizes case, compatibility Unicode, and whitespace deterministically", () => {
    expect(normalizeTagWord("  Ｃａｆé\t  Photo  ")).toBe("café photo");
    expect(normalizeTagWord("Straße")).toBe("straße");
    expect(normalizeTagWord("हिन्दी")).toBe("हिन्दी");
  });

  it("rejects empty, overlong, and disallowed tag words", () => {
    expect(() => normalizeTagWord(" \n ")).toThrow();
    expect(() => normalizeTagWord("a".repeat(65))).toThrow();
    expect(() => normalizeTagWord("cat/photo")).toThrow();
    expect(() => normalizeTagWord("cat🐈")).toThrow();
  });
});
