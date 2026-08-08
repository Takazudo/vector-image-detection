import { store } from "@vector-image-detection/core";
import type { Command } from "commander";
import { CliUsageError } from "../errors.js";
import { parsePositiveInt } from "../lib/parse.js";
import { printHits } from "../lib/print-hits.js";
import { DEFAULT_INDEX_NAME, qdrantCollectionName, resolveIndexDir } from "../paths.js";
import type { CliDeps } from "../types.js";

interface SearchOptions {
  k: string;
  index: string;
  backend: string;
  qdrantUrl: string;
}

export function registerSearchCommand(program: Command, deps: CliDeps): void {
  program
    .command("search <text>")
    .description("Embed <text> and print the top-k nearest images")
    .option("-k, --k <n>", "number of results", "5")
    .option("--index <name>", "index name", DEFAULT_INDEX_NAME)
    .option("--backend <backend>", "memory or qdrant", "memory")
    .option(
      "--qdrant-url <url>",
      "Qdrant server URL (used with --backend qdrant)",
      "http://localhost:6333",
    )
    .action(async (text: string, opts: SearchOptions) => {
      const k = parsePositiveInt(opts.k, "-k/--k");
      if (opts.backend !== "memory" && opts.backend !== "qdrant") {
        throw new CliUsageError(
          `search: --backend must be "memory" or "qdrant", got "${opts.backend}"`,
        );
      }

      const indexDir = resolveIndexDir(deps.rootDir, opts.index);
      const { meta, vectors } = await store.loadIndex(indexDir);
      const embedder = deps.createEmbedder({ modelId: meta.modelId, dim: meta.dim });
      const [queryVector] = await embedder.embedTexts([text]);

      const vectorStore =
        opts.backend === "qdrant"
          ? deps.createQdrantStore({
              url: opts.qdrantUrl,
              collection: qdrantCollectionName(opts.index),
              dim: meta.dim,
            })
          : store.storeFromIndex(meta, vectors);

      const hits = await vectorStore.search(queryVector!, k);
      printHits(deps.logger, hits);
    });
}
