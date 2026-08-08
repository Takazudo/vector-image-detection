import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MAX_LONG_EDGE, downscaleImageBuffer } from "./downscale.js";

async function makeJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 120, g: 40, b: 200 } },
  })
    .jpeg()
    .toBuffer();
}

describe("downscaleImageBuffer", () => {
  it("shrinks an oversized image so the long edge is <= MAX_LONG_EDGE", async () => {
    const source = await makeJpeg(2000, 1000);
    const result = await downscaleImageBuffer(source);

    expect(result.mediaType).toBe("image/jpeg");
    const metadata = await sharp(Buffer.from(result.base64, "base64")).metadata();
    expect(metadata.width).toBeLessThanOrEqual(MAX_LONG_EDGE);
    expect(metadata.height).toBeLessThanOrEqual(MAX_LONG_EDGE);
    // fit: "inside" preserves aspect ratio — 2000x1000 is 2:1
    expect(metadata.width).toBe(MAX_LONG_EDGE);
    expect(metadata.height).toBe(MAX_LONG_EDGE / 2);
  });

  it("does not upscale an image already under the cap", async () => {
    const source = await makeJpeg(200, 100);
    const result = await downscaleImageBuffer(source);

    const metadata = await sharp(Buffer.from(result.base64, "base64")).metadata();
    expect(metadata.width).toBe(200);
    expect(metadata.height).toBe(100);
  });

  it("re-encodes as JPEG regardless of source format", async () => {
    const png = await sharp({
      create: { width: 50, height: 50, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 1 } },
    })
      .png()
      .toBuffer();

    const result = await downscaleImageBuffer(png);

    expect(result.mediaType).toBe("image/jpeg");
    const metadata = await sharp(Buffer.from(result.base64, "base64")).metadata();
    expect(metadata.format).toBe("jpeg");
  });

  it("returns valid base64 that round-trips to a decodable image", async () => {
    const source = await makeJpeg(300, 300);
    const result = await downscaleImageBuffer(source);

    expect(() => Buffer.from(result.base64, "base64")).not.toThrow();
    const metadata = await sharp(Buffer.from(result.base64, "base64")).metadata();
    expect(metadata.width).toBe(300);
  });
});
