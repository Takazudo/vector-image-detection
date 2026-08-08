import { describe, expect, it } from "vitest";
import { main } from "./index.js";

describe("@vector-image-detection/cli", () => {
  it("exports a main entry point", () => {
    expect(typeof main).toBe("function");
  });
});
