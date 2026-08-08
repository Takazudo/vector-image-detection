import { promises as fs } from "node:fs";
import * as path from "node:path";
import sharp from "sharp";

export const THUMB_SIZE = 256;

/**
 * Thumbnails are always re-encoded as `.jpg`, regardless of source format —
 * same rule `packages/vlm-tagger`'s downscaler uses. Appends `.jpg` rather
 * than replacing the source extension, so e.g. `photo.jpg` and `photo.png`
 * sitting side by side (distinct source files) get distinct thumb paths
 * instead of colliding on the same `photo.jpg` output file.
 */
export function toThumbRelPath(relPath: string): string {
  return `${relPath}.jpg`;
}

/** Writes a `<=256px`-long-edge JPEG thumbnail of `srcPath` to `destPath`, creating parent directories as needed. Never upscales. */
export async function makeThumbnail(srcPath: string, destPath: string): Promise<void> {
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await sharp(srcPath)
    .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toFile(destPath);
}
