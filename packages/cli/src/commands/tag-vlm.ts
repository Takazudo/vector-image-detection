import * as path from "node:path";
import { store } from "@vector-image-detection/core";
import type { VlmLanguage } from "@vector-image-detection/vlm-tagger";
import type { Command } from "commander";
import { CliUsageError } from "../errors.js";
import { DEFAULT_INDEX_NAME, resolveIndexDir } from "../paths.js";
import type { CliDeps } from "../types.js";

interface TagVlmOptions {
  index: string;
  language: string;
  confirmUpload?: boolean;
}

export function registerTagVlmCommand(tagCmd: Command, deps: CliDeps): void {
  tagCmd
    .command("vlm <ids...>")
    .description(
      "Tag images via the Claude API (packages/vlm-tagger) — uploads image bytes to Anthropic",
    )
    .option("--index <name>", "index name", DEFAULT_INDEX_NAME)
    .option("--language <lang>", "en or ja", "en")
    .option(
      "--confirm-upload",
      "required: confirms you accept uploading these images to the Claude API",
    )
    .action(async (ids: string[], opts: TagVlmOptions) => {
      if (opts.language !== "en" && opts.language !== "ja") {
        throw new CliUsageError(`tag vlm: --language must be "en" or "ja", got "${opts.language}"`);
      }

      const cost = deps.estimateCost(ids.length);
      deps.logger.log(
        `tag vlm: estimated cost for ${ids.length} image(s): ` +
          `$${cost.totalUsd[0].toFixed(3)}-$${cost.totalUsd[1].toFixed(3)} USD`,
      );
      deps.logger.log(
        "tag vlm: PRIVACY WARNING — each image's bytes are uploaded to the Anthropic API for tagging.",
      );

      if (!opts.confirmUpload) {
        throw new CliUsageError(
          "tag vlm: refusing to upload images without --confirm-upload (see the cost/privacy notice above)",
        );
      }

      const indexDir = resolveIndexDir(deps.rootDir, opts.index);
      const { meta } = await store.loadIndex(indexDir);
      const itemsById = new Map(meta.items.map((item) => [item.id, item]));

      const missing = ids.filter((id) => !itemsById.has(id));
      if (missing.length > 0) {
        throw new CliUsageError(`tag vlm: unknown item id(s): ${missing.join(", ")}`);
      }

      // Uploads the locally-generated 256px thumbnail, not the original
      // source file — the index bundle doesn't retain the original ingest
      // directory, and a smaller upload is a strict privacy/cost win anyway.
      const imagePaths = ids.map((id) => {
        const item = itemsById.get(id)!;
        if (!item.thumb)
          throw new CliUsageError(`tag vlm: item "${id}" has no thumbnail — re-run ingest`);
        return path.join(indexDir, ...item.thumb.split("/"));
      });

      const results = await deps.vlmTag(imagePaths, { language: opts.language as VlmLanguage });

      const confirmed: { id: string; tags: string[] }[] = [];
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]!;
        const result = results[i]!;
        if (!result.ok) {
          deps.logger.error(`tag vlm: ${id}: FAILED — ${result.error}`);
          continue;
        }
        deps.logger.log(
          `tag vlm: ${id}: ${result.caption} — proposed tags: ${result.tags.join(", ")}`,
        );
        const accepted = await deps.confirm(
          `Apply proposed tags [${result.tags.join(", ")}] to ${id}?`,
        );
        if (accepted) confirmed.push({ id, tags: result.tags });
      }

      if (confirmed.length === 0) {
        deps.logger.log("tag vlm: nothing confirmed");
        return;
      }

      const changes = confirmed.map(({ id, tags }) => {
        const item = itemsById.get(id)!;
        return { id, tags: Array.from(new Set([...item.tags, ...tags])) };
      });
      await store.updateTags(indexDir, changes);
      deps.logger.log(`tag vlm: applied tags to ${changes.length} item(s)`);
    });
}
