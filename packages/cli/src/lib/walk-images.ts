import { promises as fs } from "node:fs";
import * as path from "node:path";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
// Directories a recursive ingest walk should never descend into: dotdirs
// (.git, ...), node_modules, and a prior run's own `thumbs/` output (so
// re-ingesting a directory that already contains a generated index bundle
// doesn't fold thumbnails back in as source images).
const SKIP_DIR_NAMES = new Set(["node_modules", "thumbs"]);

export interface WalkedImage {
  /** Absolute filesystem path. */
  absPath: string;
  /** POSIX-style path relative to the walked root — used as the item id. */
  relPath: string;
}

/** Converts an absolute path to a POSIX-style (`/`-separated) path relative to `from`, stable across platforms. */
export function toPosixRelative(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join("/");
}

/** Recursively walks `rootDir` for `.jpg`/`.jpeg`/`.png`/`.webp` files, in deterministic (sorted) order. */
export async function walkImageFiles(rootDir: string): Promise<WalkedImage[]> {
  const results: WalkedImage[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(entry.name)) continue;
        await walk(absPath);
      } else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        results.push({ absPath, relPath: toPosixRelative(rootDir, absPath) });
      }
    }
  }

  await walk(rootDir);
  results.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  return results;
}
