import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, estimateCost, vlmTag } from "./index.js";

describe("@vector-image-detection/vlm-tagger", () => {
  it("exports vlmTag as the tagging entry point", () => {
    expect(typeof vlmTag).toBe("function");
  });

  it("exports estimateCost as a function", () => {
    expect(typeof estimateCost).toBe("function");
  });

  it("exports DEFAULT_MODEL as claude-haiku-4-5 — the cheap tier is the point", () => {
    expect(DEFAULT_MODEL).toBe("claude-haiku-4-5");
  });
});
