import { describe, expect, it } from "vitest";
import { parseVocabulary } from "./vocabulary";

describe("parseVocabulary", () => {
  it("splits on commas and newlines", () => {
    expect(parseVocabulary("cat, dog\nled")).toEqual(["cat", "dog", "led"]);
  });

  it("keeps multi-word labels intact and collapses inner whitespace", () => {
    expect(parseVocabulary("circuit   board, cat")).toEqual(["circuit board", "cat"]);
  });

  it("drops blank entries and trailing separators", () => {
    expect(parseVocabulary("cat, , dog,\n")).toEqual(["cat", "dog"]);
  });

  it("drops case-insensitive duplicates, keeping the first spelling", () => {
    expect(parseVocabulary("Cat, cat, CAT")).toEqual(["Cat"]);
  });

  it("returns nothing for an empty field", () => {
    expect(parseVocabulary("   ")).toEqual([]);
  });
});
