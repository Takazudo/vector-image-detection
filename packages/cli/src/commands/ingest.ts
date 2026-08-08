import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { IndexItem, IndexMeta, Vector } from "@vector-image-detection/core";
import { store } from "@vector-image-detection/core";
import type { Command } from "commander";
import { CliUsageError } from "../errors.js";
import { findManifest } from "../lib/manifest.js";
import { makeThumbnail, toThumbRelPath } from "../lib/thumbs.js";
import { toPosixRelative, walkImageFiles } from "../lib/walk-images.js";
import { DEFAULT_INDEX_NAME, resolveIndexDir, resolveThumbsDir } from "../paths.js";
import type { CliDeps } from "../types.js";

// How many images are embedded per embedImages() call — bounds peak memory
// on a large photo dump while still giving periodic progress output.
const INGEST_BATCH_SIZE = 16;

interface IngestOptions {
  index: string;
}

export function registerIngestCommand(program: Command, deps: CliDeps): void {
  program
    .command("ingest <dir>")
    .description("Walk <dir> for jpg/png/webp images, embed them, and write an index bundle")
    .option("--index <name>", "index name", DEFAULT_INDEX_NAME)
    .action(async (dirArg: string, opts: IngestOptions) => {
      const sourceDir = path.resolve(deps.rootDir, dirArg);
      const stat = await fs.stat(sourceDir).catch(() => null);
      if (!stat || !stat.isDirectory()) {
        throw new CliUsageError(`ingest: "${dirArg}" is not a directory`);
      }

      const images = await walkImageFiles(sourceDir);
      if (images.length === 0) {
        deps.logger.log(`ingest: no jpg/png/webp images found under ${dirArg}`);
        return;
      }

      const manifest = await findManifest(sourceDir);
      const embedder = deps.createEmbedder();
      deps.logger.log(
        `ingest: embedding ${images.length} image(s) with ${embedder.modelId} ` +
          `(first run downloads ~200MB model)...`,
      );

      const indexDir = resolveIndexDir(deps.rootDir, opts.index);
      const thumbsDir = resolveThumbsDir(indexDir);
      // Thumbnails are generated into a staging dir and published only after
      // the new bundle saves successfully — otherwise a failed re-ingest would
      // leave old meta/vectors alongside already-overwritten thumbnails.
      const thumbsStagingDir = `${thumbsDir}.staging`;
      await fs.rm(thumbsStagingDir, { recursive: true, force: true });

      // Re-ingesting an index that already has confirmed tags (from `tag
      // vocab`/`propagate`/`vlm`) must not silently discard them — carry
      // forward by item id from any existing bundle at this indexDir.
      const existingTagsById = new Map<string, string[]>();
      const existing = await store.loadIndex(indexDir).catch(() => null);
      if (existing) {
        for (const item of existing.meta.items) existingTagsById.set(item.id, item.tags);
      }

      const items: IndexItem[] = [];
      const vectors: Vector[] = [];

      for (let i = 0; i < images.length; i += INGEST_BATCH_SIZE) {
        const batch = images.slice(i, i + INGEST_BATCH_SIZE);
        const batchVectors = await embedder.embedImages(batch.map((image) => image.absPath));

        for (let j = 0; j < batch.length; j++) {
          const image = batch[j]!;
          const vector = batchVectors[j]!;
          const manifestEntry = manifest?.byFile.get(
            toPosixRelative(manifest.manifestDir, image.absPath),
          );
          const thumbRelPath = toThumbRelPath(image.relPath);
          await makeThumbnail(
            image.absPath,
            path.join(thumbsStagingDir, ...thumbRelPath.split("/")),
          );

          items.push({
            id: image.relPath,
            file: image.relPath,
            thumb: `thumbs/${thumbRelPath}`,
            tags: existingTagsById.get(image.relPath) ?? [],
            ...(manifestEntry?.knownLabel ? { knownLabel: manifestEntry.knownLabel } : {}),
            ...(manifestEntry?.source ? { source: manifestEntry.source } : {}),
            ...(manifestEntry?.license ? { license: manifestEntry.license } : {}),
            ...(manifestEntry?.author ? { author: manifestEntry.author } : {}),
          });
          vectors.push(vector);
        }

        deps.logger.log(
          `ingest: ${Math.min(i + INGEST_BATCH_SIZE, images.length)}/${images.length}`,
        );
      }

      const meta: IndexMeta = {
        formatVersion: 1,
        modelId: embedder.modelId,
        dim: embedder.dim,
        createdAt: deps.now().toISOString(),
        items,
      };

      await store.saveIndex(indexDir, meta, vectors);
      await fs.rm(thumbsDir, { recursive: true, force: true });
      await fs.rename(thumbsStagingDir, thumbsDir);
      deps.logger.log(
        `ingest: wrote ${items.length} item(s) to ${path.relative(deps.rootDir, indexDir)}`,
      );
    });
}
