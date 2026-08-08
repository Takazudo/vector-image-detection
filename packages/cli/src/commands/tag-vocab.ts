import { labeling, store } from "@vector-image-detection/core";
import type { Command } from "commander";
import { parseThreshold } from "../lib/parse.js";
import { DEFAULT_INDEX_NAME, resolveIndexDir } from "../paths.js";
import type { CliDeps } from "../types.js";

interface TagVocabOptions {
  threshold: string;
  index: string;
  apply?: boolean;
}

export function registerTagVocabCommand(tagCmd: Command, deps: CliDeps): void {
  tagCmd
    .command("vocab <words...>")
    .description("Zero-shot vocabulary tagging over every image in the index")
    .option("--threshold <n>", "similarity threshold", "0.2")
    .option("--index <name>", "index name", DEFAULT_INDEX_NAME)
    .option("--apply", "persist proposals >= threshold as confirmed tags (merged, atomic)")
    .action(async (words: string[], opts: TagVocabOptions) => {
      const threshold = parseThreshold(opts.threshold);
      const indexDir = resolveIndexDir(deps.rootDir, opts.index);
      const { meta, vectors } = await store.loadIndex(indexDir);

      const embedder = deps.createEmbedder({ modelId: meta.modelId, dim: meta.dim });
      const vocabVectors = await labeling.embedVocab(embedder, words);
      const perImage = labeling.zeroShotTag(vectors, vocabVectors, { threshold });

      const filesByLabel = new Map<string, string[]>();
      perImage.forEach((scores, i) => {
        const file = meta.items[i]!.file;
        for (const score of scores) {
          const files = filesByLabel.get(score.label) ?? [];
          files.push(file);
          filesByLabel.set(score.label, files);
        }
      });

      for (const word of words) {
        const files = filesByLabel.get(word) ?? [];
        const examples = files.slice(0, 3).join(", ");
        deps.logger.log(`${word}: ${files.length} match(es)${examples ? ` (e.g. ${examples})` : ""}`);
      }

      if (!opts.apply) return;

      const changes = meta.items
        .map((item, i) => {
          const proposedLabels = perImage[i]!.map((score) => score.label);
          const merged = Array.from(new Set([...item.tags, ...proposedLabels]));
          const isUnchanged =
            merged.length === item.tags.length && merged.every((tag) => item.tags.includes(tag));
          return isUnchanged ? null : { id: item.id, tags: merged };
        })
        .filter((change): change is { id: string; tags: string[] } => change !== null);

      if (changes.length === 0) {
        deps.logger.log("tag vocab: nothing to apply");
        return;
      }
      await store.updateTags(indexDir, changes);
      deps.logger.log(`tag vocab: applied tags to ${changes.length} item(s)`);
    });
}
