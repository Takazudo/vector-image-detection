import { labeling, store } from "@vector-image-detection/core";
import type { Command } from "commander";
import { parseThreshold } from "../lib/parse.js";
import { DEFAULT_INDEX_NAME, resolveIndexDir } from "../paths.js";
import type { CliDeps } from "../types.js";

interface TagPropagateOptions {
  threshold: string;
  index: string;
  yes?: boolean;
}

export function registerTagPropagateCommand(tagCmd: Command, deps: CliDeps): void {
  tagCmd
    .command("propagate <id> <tag>")
    .description("Propose propagating <tag> from exemplar <id> to its nearest neighbors")
    .option("--threshold <n>", "similarity threshold", "0.75")
    .option("--index <name>", "index name", DEFAULT_INDEX_NAME)
    .option("--yes", "accept all proposals without prompting")
    .action(async (id: string, tag: string, opts: TagPropagateOptions) => {
      const threshold = parseThreshold(opts.threshold);
      const indexDir = resolveIndexDir(deps.rootDir, opts.index);
      const { meta, vectors } = await store.loadIndex(indexDir);
      const vectorStore = store.storeFromIndex(meta, vectors);

      const proposals = await labeling.proposeTagPropagation(vectorStore, [id], tag, { threshold });
      if (proposals.length === 0) {
        deps.logger.log(`tag propagate: no proposals >= ${threshold}`);
        return;
      }

      const itemsById = new Map(meta.items.map((item) => [item.id, item]));
      const confirmedIds: string[] = [];
      for (const proposal of proposals) {
        const file = itemsById.get(proposal.id)?.file ?? proposal.id;
        const question = `Apply tag "${tag}" to ${file} (score ${proposal.score.toFixed(3)})?`;
        const accepted = opts.yes ? true : await deps.confirm(question);
        if (accepted) confirmedIds.push(proposal.id);
      }

      if (confirmedIds.length === 0) {
        deps.logger.log("tag propagate: nothing confirmed");
        return;
      }

      const changes = confirmedIds.map((confirmedId) => {
        const item = itemsById.get(confirmedId)!;
        const tags = item.tags.includes(tag) ? item.tags : [...item.tags, tag];
        return { id: confirmedId, tags };
      });
      await store.updateTags(indexDir, changes);
      deps.logger.log(`tag propagate: applied "${tag}" to ${confirmedIds.length} item(s)`);
    });
}
