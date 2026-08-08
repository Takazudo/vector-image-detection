import { store } from "@vector-image-detection/core";
import type { Command } from "commander";
import { CliUsageError } from "../errors.js";
import { DEFAULT_INDEX_NAME, qdrantCollectionName, resolveIndexDir } from "../paths.js";
import type { CliDeps } from "../types.js";

interface QdrantSyncOptions {
  index: string;
  url: string;
}

// Printed verbatim so a user hitting an unreachable server has a copy-pasteable fix.
const QDRANT_DOCKER_HINT =
  'docker run -p 6333:6333 -p 6334:6334 -v "$(pwd)/qdrant_storage:/qdrant/storage:z" qdrant/qdrant';

function isConnectionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const causeMessage = err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
  return /ECONNREFUSED|ENOTFOUND|ECONNRESET|fetch failed/i.test(`${message} ${causeMessage}`);
}

export function registerQdrantCommands(program: Command, deps: CliDeps): void {
  const qdrantCmd = program
    .command("qdrant")
    .description("Qdrant vector database commands")
    .action(() => {
      throw new CliUsageError("qdrant: choose a subcommand (sync) — see `vis qdrant --help`");
    });

  qdrantCmd
    .command("sync")
    .description(
      "Push the index into a Qdrant collection (overwrites; the index bundle stays the source of truth)",
    )
    .option("--index <name>", "index name", DEFAULT_INDEX_NAME)
    .option("--url <url>", "Qdrant server URL", "http://localhost:6333")
    .action(async (opts: QdrantSyncOptions) => {
      const indexDir = resolveIndexDir(deps.rootDir, opts.index);
      const { meta, vectors } = await store.loadIndex(indexDir);
      const collection = qdrantCollectionName(opts.index);
      const qdrantStore = deps.createQdrantStore({ url: opts.url, collection, dim: meta.dim });

      const items = meta.items.map((item, i) => {
        const { id, ...payload } = item;
        return { id, vector: vectors[i]!, payload };
      });

      try {
        // Drop + recreate so the collection is an exact derived copy of the
        // current bundle — a plain upsert would leave stale points behind
        // for any id that was deleted or renamed since the last sync.
        await qdrantStore.dropCollection();
        await qdrantStore.upsert(items);
      } catch (err) {
        if (isConnectionError(err)) {
          throw new Error(
            `qdrant sync: could not reach Qdrant at ${opts.url}.\n` +
              `Start a local Qdrant server with:\n  ${QDRANT_DOCKER_HINT}`,
          );
        }
        throw err;
      }

      deps.logger.log(
        `qdrant sync: pushed ${items.length} item(s) to collection "${collection}" at ${opts.url}`,
      );
    });
}
