import type { Command } from "commander";
import { CliUsageError } from "../errors.js";
import type { CliDeps } from "../types.js";
import { registerTagPropagateCommand } from "./tag-propagate.js";
import { registerTagVlmCommand } from "./tag-vlm.js";
import { registerTagVocabCommand } from "./tag-vocab.js";

export function registerTagCommands(program: Command, deps: CliDeps): void {
  const tagCmd = program
    .command("tag")
    .description("Tagging commands: vocab, propagate, vlm")
    .action(() => {
      throw new CliUsageError("tag: choose a subcommand (vocab, propagate, vlm) — see `vis tag --help`");
    });

  registerTagVocabCommand(tagCmd, deps);
  registerTagPropagateCommand(tagCmd, deps);
  registerTagVlmCommand(tagCmd, deps);
}
