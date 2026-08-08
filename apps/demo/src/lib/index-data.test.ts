import { describe, expect, it } from "vitest";
import { encodeBundlePath } from "./index-data";

describe("encodeBundlePath", () => {
  it("keeps plain nested paths unchanged", () => {
    expect(encodeBundlePath("thumbs/cat/cat-01.png.jpg")).toBe("thumbs/cat/cat-01.png.jpg");
  });

  it("percent-encodes URL-reserved characters inside segments while keeping separators", () => {
    expect(encodeBundlePath("thumbs/photo#1.jpg")).toBe("thumbs/photo%231.jpg");
    expect(encodeBundlePath("thumbs/what?.jpg")).toBe("thumbs/what%3F.jpg");
    expect(encodeBundlePath("thumbs/two words.jpg")).toBe("thumbs/two%20words.jpg");
  });
});
