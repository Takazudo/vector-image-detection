import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import { CliUsageError } from "../errors.js";
import { DEFAULT_INDEX_NAME, resolveDemoDataDir, resolveIndexDir } from "../paths.js";
import type { CliDeps } from "../types.js";

interface ExportDemoOptions {
  index: string;
}

async function pathExists(target: string): Promise<boolean> {
  return fs
    .access(target)
    .then(() => true)
    .catch(() => false);
}

export function registerExportDemoCommand(program: Command, deps: CliDeps): void {
  program
    .command("export-demo")
    .description("Copy the index bundle + thumbs into apps/demo/public/data/ for the demo app")
    .option("--index <name>", "index name", DEFAULT_INDEX_NAME)
    .action(async (opts: ExportDemoOptions) => {
      const indexDir = resolveIndexDir(deps.rootDir, opts.index);
      if (!(await pathExists(path.join(indexDir, "meta.json")))) {
        throw new CliUsageError(
          `export-demo: index "${opts.index}" not found at ${indexDir} — run ingest first`,
        );
      }

      const destDir = resolveDemoDataDir(deps.rootDir);
      await fs.rm(destDir, { recursive: true, force: true });
      await fs.mkdir(destDir, { recursive: true });

      // meta.json already carries source/license/author verbatim (frozen
      // IndexItem contract) — a plain file copy is enough to bring
      // attribution along for the demo to display credits.
      await fs.cp(path.join(indexDir, "meta.json"), path.join(destDir, "meta.json"));
      await fs.cp(path.join(indexDir, "embeddings.bin"), path.join(destDir, "embeddings.bin"));

      const thumbsDir = path.join(indexDir, "thumbs");
      if (await pathExists(thumbsDir)) {
        await fs.cp(thumbsDir, path.join(destDir, "thumbs"), { recursive: true });
      }

      deps.logger.log(
        `export-demo: copied index "${opts.index}" (with attribution metadata) to ` +
          path.relative(deps.rootDir, destDir),
      );
    });
}
