import { describe, expect, it } from "vitest";
import { formatScore, hasAttribution, itemLabel, scoreBarPercent } from "./format";

describe("formatScore", () => {
  it("renders three decimals", () => {
    expect(formatScore(0.9876)).toBe("0.988");
    expect(formatScore(1)).toBe("1.000");
  });
});

describe("scoreBarPercent", () => {
  it("maps a similarity to a percentage", () => {
    expect(scoreBarPercent(0.5)).toBe(50);
    expect(scoreBarPercent(1)).toBe(100);
  });

  it("clamps out-of-range and negative similarities to the ends", () => {
    expect(scoreBarPercent(-0.4)).toBe(0);
    expect(scoreBarPercent(1.2)).toBe(100);
  });
});

describe("itemLabel", () => {
  it("uses the filename from the relative path", () => {
    expect(itemLabel({ id: "a", file: "cat/cat-01.png", tags: [] })).toBe("cat-01.png");
  });

  it("falls back to the whole value when there is no directory", () => {
    expect(itemLabel({ id: "a", file: "cat-01.png", tags: [] })).toBe("cat-01.png");
  });
});

describe("hasAttribution", () => {
  it("is true when any credit field is present", () => {
    expect(hasAttribution({ id: "a", file: "a", tags: [], license: "CC0-1.0" })).toBe(true);
    expect(hasAttribution({ id: "a", file: "a", tags: [], author: "someone" })).toBe(true);
  });

  it("is false when the item carries no credit at all", () => {
    expect(hasAttribution({ id: "a", file: "a", tags: [] })).toBe(false);
  });
});
