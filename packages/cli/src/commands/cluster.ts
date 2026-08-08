import { clustering, store } from "@vector-image-detection/core";
import type { Command } from "commander";
import { CliUsageError } from "../errors.js";
import { parsePositiveInt } from "../lib/parse.js";
import { DEFAULT_INDEX_NAME, resolveIndexDir } from "../paths.js";
import type { CliDeps } from "../types.js";

const SUGGEST_K_CANDIDATES = [2, 3, 4, 5, 6, 7, 8];

interface ClusterOptions {
  k?: string;
  auto?: boolean;
  index: string;
  json?: boolean;
}

export function registerClusterCommand(program: Command, deps: CliDeps): void {
  program
    .command("cluster")
    .description("Group images into exploratory clusters via spherical k-means")
    .option("--k <n>", "number of clusters")
    .option("--auto", "auto-select k via silhouette score (default when --k is omitted)")
    .option("--index <name>", "index name", DEFAULT_INDEX_NAME)
    .option("--json", "machine-readable JSON output")
    .action(async (opts: ClusterOptions) => {
      if (opts.k !== undefined && opts.auto) {
        throw new CliUsageError("cluster: pass either --k or --auto, not both");
      }

      const indexDir = resolveIndexDir(deps.rootDir, opts.index);
      const { meta, vectors } = await store.loadIndex(indexDir);
      if (vectors.length < 2) {
        throw new CliUsageError(
          `cluster: index has ${vectors.length} item(s); need at least 2 to cluster`,
        );
      }

      let k: number;
      if (opts.k !== undefined) {
        k = parsePositiveInt(opts.k, "--k");
        if (k > vectors.length) {
          throw new CliUsageError(`cluster: --k (${k}) cannot exceed item count (${vectors.length})`);
        }
      } else {
        // --auto (or the default, when neither flag is given): silhouette-select
        // k from the candidates that fit this dataset size. Too small a dataset
        // for any candidate falls back to the largest valid k (2, if >= 2 items).
        const candidates = SUGGEST_K_CANDIDATES.filter((candidate) => candidate <= vectors.length - 1);
        k = candidates.length === 0 ? Math.min(2, vectors.length) : clustering.suggestK(vectors, candidates).k;
      }

      const { assignments } = clustering.kmeans(vectors, k);
      const groups = new Map<number, string[]>();
      assignments.forEach((clusterId, i) => {
        const files = groups.get(clusterId) ?? [];
        files.push(meta.items[i]!.file);
        groups.set(clusterId, files);
      });
      const sortedGroups = [...groups.entries()].sort((a, b) => a[0] - b[0]);

      if (opts.json) {
        deps.logger.log(
          JSON.stringify(
            sortedGroups.map(([clusterId, files]) => ({ cluster: clusterId, files })),
            null,
            2,
          ),
        );
        return;
      }

      deps.logger.log(`cluster: ${sortedGroups.length} exploratory group(s) (k=${k})`);
      for (const [clusterId, files] of sortedGroups) {
        deps.logger.log(`\nGroup ${clusterId} (${files.length} item(s)):`);
        for (const file of files) deps.logger.log(`  - ${file}`);
      }
    });
}
