import { readFile } from "node:fs/promises";
import sharp from "sharp";

/**
 * Long-edge cap in pixels. Keeps VLM token cost predictable — roughly
 * (width * height) / 750 tokens per the Claude API vision docs — and avoids
 * surprise bills on large source photos.
 */
export const MAX_LONG_EDGE = 1024;

export interface DownscaledImage {
  base64: string;
  mediaType: "image/jpeg";
}

/**
 * Resizes so the long edge is <=1024px (never upscales) and re-encodes as
 * JPEG, so every downstream caller deals with one predictable media type
 * regardless of the source format.
 */
export async function downscaleImageBuffer(buffer: Buffer): Promise<DownscaledImage> {
  const jpegBuffer = await sharp(buffer)
    .resize({
      width: MAX_LONG_EDGE,
      height: MAX_LONG_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();

  return { base64: jpegBuffer.toString("base64"), mediaType: "image/jpeg" };
}

export async function downscaleImage(imagePath: string): Promise<DownscaledImage> {
  const buffer = await readFile(imagePath);
  return downscaleImageBuffer(buffer);
}
