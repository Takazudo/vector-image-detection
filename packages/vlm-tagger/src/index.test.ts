import { describe, expect, it } from "vitest";
import { tagImage } from "./index.js";

describe("@vector-image-detection/vlm-tagger", () => {
  it("exports a tagImage entry point", () => {
    expect(typeof tagImage).toBe("function");
  });
});
