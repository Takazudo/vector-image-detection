import * as path from "node:path";
import { store } from "@vector-image-detection/core";
import type { Command } from "commander";
import { parsePositiveInt } from "../lib/parse.js";
import { printHits } from "../lib/print-hits.js";
import { DEFAULT_INDEX_NAME, resolveIndexDir } from "../paths.js";
import type { CliDeps } from "../types.js";

interface SimilarOptions {
  k: string;
  index: string;
}

export function registerSimilarCommand(program: Command, deps: CliDeps): void {
  program
    .command("similar <idOrPath>")
    .description("Find images similar to an indexed item id, or to an external image path")
    .option("-k, --k <n>", "number of results", "5")
    .option("--index <name>", "index name", DEFAULT_INDEX_NAME)
    .action(async (idOrPath: string, opts: SimilarOptions) => {
      const k = parsePositiveInt(opts.k, "-k/--k");
      const indexDir = resolveIndexDir(deps.rootDir, opts.index);
      const { meta, vectors } = await store.loadIndex(indexDir);
      const vectorStore = store.storeFromIndex(meta, vectors);

      const existing = await vectorStore.get([idOrPath]);
      if (existing.length > 0) {
        // Known item id: search with its own vector and drop itself from the
        // results (it would otherwise always be its own top hit).
        const hits = await vectorStore.search(existing[0]!.vector, k + 1);
        printHits(deps.logger, hits.filter((hit) => hit.id !== idOrPath).slice(0, k));
        return;
      }

      // Not a known id — treat the argument as an external image path and embed it fresh.
      const embedder = deps.createEmbedder({ modelId: meta.modelId, dim: meta.dim });
      const [queryVector] = await embedder.embedImages([path.resolve(deps.rootDir, idOrPath)]);
      const hits = await vectorStore.search(queryVector!, k);
      printHits(deps.logger, hits);
    });
}
