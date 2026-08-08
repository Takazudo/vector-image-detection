import { promises as fs } from "node:fs";
import * as path from "node:path";

export interface ManifestEntry {
  file: string;
  knownLabel?: string;
  source?: string;
  license?: string;
  author?: string;
}

export interface ManifestLookup {
  manifestDir: string;
  byFile: Map<string, ManifestEntry>;
}

// Safety cap on how many parent directories to check, so a missing
// manifest.json can't walk all the way up to the filesystem root forever.
const MAX_WALK_UP = 16;

/**
 * Walks upward from `startDir` (inclusive) looking for a `manifest.json` in
 * the shape `scripts/fetch-samples.mjs` writes: `{ items: [{ file,
 * knownLabel?, source?, license?, author? }] }`, `file` being POSIX-relative
 * to the manifest's own directory. Returns `null` if none is found.
 */
export async function findManifest(startDir: string): Promise<ManifestLookup | null> {
  let dir = path.resolve(startDir);
  for (let i = 0; i < MAX_WALK_UP; i++) {
    const manifestPath = path.join(dir, "manifest.json");
    try {
      const raw = await fs.readFile(manifestPath, "utf8");
      const parsed = JSON.parse(raw) as { items?: ManifestEntry[] };
      const byFile = new Map<string, ManifestEntry>();
      for (const item of parsed.items ?? []) {
        if (item && typeof item.file === "string") byFile.set(item.file, item);
      }
      return { manifestDir: dir, byFile };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return null;
}
