import { Command } from "commander";
import { registerClusterCommand } from "./commands/cluster.js";
import { registerExportDemoCommand } from "./commands/export-demo.js";
import { registerIngestCommand } from "./commands/ingest.js";
import { registerQdrantCommands } from "./commands/qdrant.js";
import { registerSearchCommand } from "./commands/search.js";
import { registerSimilarCommand } from "./commands/similar.js";
import { registerTagCommands } from "./commands/tag.js";
import type { CliDeps } from "./types.js";

/**
 * Builds the `vis` command tree wired against `deps`.
 *
 * `.exitOverride()` + `.configureOutput()` are set on `program` *before* any
 * subcommand is registered — commander copies a parent's exit/output
 * settings onto every subcommand created afterward via `.command()`
 * (including subcommands-of-subcommands, e.g. `tag vocab`), so this one call
 * covers the whole tree. Without it, a commander-level parse error (bad
 * flag, missing arg, `--help`) would call `process.exit()` directly and take
 * the test runner down with it; with it, commander throws a `CommanderError`
 * that `run.ts` catches and maps to an exit code instead.
 */
export function buildProgram(deps: CliDeps): Command {
  const program = new Command();
  program
    .name("vis")
    .description("Photo vector search CLI — ingest, search, tag, cluster, and sync a photo index")
    .exitOverride()
    .configureOutput({
      writeOut: (str) => deps.logger.log(str.replace(/\n$/, "")),
      writeErr: (str) => deps.logger.error(str.replace(/\n$/, "")),
    });

  registerIngestCommand(program, deps);
  registerSearchCommand(program, deps);
  registerSimilarCommand(program, deps);
  registerTagCommands(program, deps);
  registerClusterCommand(program, deps);
  registerQdrantCommands(program, deps);
  registerExportDemoCommand(program, deps);

  return program;
}
