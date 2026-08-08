import * as readline from "node:readline/promises";
import { embedding, store } from "@vector-image-detection/core";
import { estimateCost, vlmTag } from "@vector-image-detection/vlm-tagger";
import type { CliDeps } from "./types.js";

async function defaultConfirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

const defaultLogger = {
  log: (message: string) => console.log(message),
  error: (message: string) => console.error(message),
};

/** Builds a real `CliDeps` (network-capable, filesystem-rooted at `process.cwd()`), with any field overridable — tests override the network/TTY-touching fields with fakes. */
export function createDefaultDeps(overrides: Partial<CliDeps> = {}): CliDeps {
  return {
    rootDir: process.cwd(),
    createEmbedder: (config) => embedding.createEmbedder(config),
    createQdrantStore: (config) => new store.QdrantVectorStore(config),
    vlmTag: (imagePaths, opts) => vlmTag(imagePaths, opts),
    estimateCost: (imageCount, model) => estimateCost(imageCount, model),
    confirm: defaultConfirm,
    logger: defaultLogger,
    now: () => new Date(),
    ...overrides,
  };
}
