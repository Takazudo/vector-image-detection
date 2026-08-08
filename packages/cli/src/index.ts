export { buildProgram } from "./cli.js";
export { createDefaultDeps } from "./context.js";
export { CliUsageError } from "./errors.js";
export {
  DEFAULT_INDEX_NAME,
  qdrantCollectionName,
  resolveDemoDataDir,
  resolveIndexDir,
  resolveThumbsDir,
} from "./paths.js";
export { runCli } from "./run.js";
export type { CliDeps, Logger } from "./types.js";
