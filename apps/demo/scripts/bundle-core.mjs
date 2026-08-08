#!/usr/bin/env node

import { build } from "esbuild";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEMO_ROOT = path.join(HERE, "..");
const CORE_ROOT = path.resolve(DEMO_ROOT, "..", "..", "packages", "core", "src");
const OUT_DIR = path.join(DEMO_ROOT, "src", "generated");
const browserNodeBuiltinStubs = {
  name: "browser-node-builtin-stubs",
  setup(buildContext) {
    buildContext.onResolve({ filter: /^node:(os|path)$/ }, (args) => ({
      path: args.path,
      namespace: "browser-node-stub",
    }));
    buildContext.onLoad({ filter: /.*/, namespace: "browser-node-stub" }, () => ({
      contents:
        'const unavailable = () => { throw new Error("Node cache helpers are unavailable in browsers"); }; export default { homedir: unavailable, join: unavailable };',
      loader: "js",
    }));
  },
};

await fs.mkdir(OUT_DIR, { recursive: true });
await Promise.all([
  build({
    entryPoints: [path.join(CORE_ROOT, "browser.ts")],
    outfile: path.join(OUT_DIR, "core-browser.mjs"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
  }),
  build({
    entryPoints: [path.join(CORE_ROOT, "embedding", "create-embedder.ts")],
    outfile: path.join(OUT_DIR, "core-transformers.mjs"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    external: ["@huggingface/transformers"],
    plugins: [browserNodeBuiltinStubs],
  }),
]);

await Promise.all([
  fs.writeFile(
    path.join(OUT_DIR, "core-browser.d.mts"),
    'export * from "../../../../packages/core/src/browser";\n',
  ),
  fs.writeFile(
    path.join(OUT_DIR, "core-transformers.d.mts"),
    'export * from "../../../../packages/core/src/embedding/create-embedder";\n',
  ),
]);

console.log("demo:core-bridge: bundled browser-safe workspace sources -> src/generated");
