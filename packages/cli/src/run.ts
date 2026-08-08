import { CommanderError } from "commander";
import { buildProgram } from "./cli.js";
import { createDefaultDeps } from "./context.js";
import { CliUsageError } from "./errors.js";
import type { CliDeps } from "./types.js";

/**
 * Parses and runs `argv` (no `node`/script prefix — just user args, e.g.
 * `["ingest", "photos", "--index", "demo"]`) against a `vis` command tree
 * built from `createDefaultDeps(overrides)`, and resolves to the process
 * exit code (0 ok, 1 usage, 2 runtime) rather than calling `process.exit`
 * itself — callers decide what to do with the code (the real `bin.ts`
 * entrypoint sets `process.exitCode`; tests just assert on it).
 */
export async function runCli(argv: string[], overrides: Partial<CliDeps> = {}): Promise<number> {
  const deps = createDefaultDeps(overrides);
  const program = buildProgram(deps);

  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (err) {
    if (err instanceof CommanderError) {
      // commander already wrote its own message via configureOutput's
      // writeErr before throwing; help/version are a clean exit, everything
      // else (bad flag, missing arg, unknown (sub)command) is a usage error.
      return err.code === "commander.helpDisplayed" || err.code === "commander.version" ? 0 : 1;
    }
    if (err instanceof CliUsageError) {
      deps.logger.error(err.message);
      return 1;
    }
    deps.logger.error(`vis: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}
