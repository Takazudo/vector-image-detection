import { describe, expect, it } from "vitest";
import { estimateCost } from "./cost.js";

describe("estimateCost", () => {
  it("returns the per-image ballpark range for a single image", () => {
    const { perImageUsd, totalUsd } = estimateCost(1);
    expect(perImageUsd[0]).toBeGreaterThan(0);
    expect(perImageUsd[1]).toBeGreaterThan(perImageUsd[0]);
    expect(totalUsd).toEqual(perImageUsd);
  });

  it("scales the total linearly with image count", () => {
    const one = estimateCost(1);
    const ten = estimateCost(10);
    expect(ten.totalUsd[0]).toBeCloseTo(one.perImageUsd[0] * 10, 10);
    expect(ten.totalUsd[1]).toBeCloseTo(one.perImageUsd[1] * 10, 10);
    // per-image range is a constant, independent of batch size
    expect(ten.perImageUsd).toEqual(one.perImageUsd);
  });

  it("returns zero total for zero images", () => {
    const { totalUsd } = estimateCost(0);
    expect(totalUsd).toEqual([0, 0]);
  });

  it("rejects a negative image count", () => {
    expect(() => estimateCost(-1)).toThrow(/non-negative/);
  });

  it("rejects a non-finite image count", () => {
    expect(() => estimateCost(Number.NaN)).toThrow(/non-negative/);
  });

  it("accepts an explicit model id", () => {
    const explicit = estimateCost(5, "claude-haiku-4-5");
    const defaulted = estimateCost(5);
    expect(explicit).toEqual(defaulted);
  });

  it("falls back to the Haiku ballpark for an unrecognized model rather than throwing", () => {
    expect(() => estimateCost(5, "some-future-model")).not.toThrow();
    const result = estimateCost(5, "some-future-model");
    expect(result.perImageUsd[0]).toBeGreaterThan(0);
  });
});
