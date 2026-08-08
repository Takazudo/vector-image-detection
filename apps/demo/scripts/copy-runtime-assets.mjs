#!/usr/bin/env node

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const packageEntry = require.resolve("onnxruntime-web");
const packageDist = path.dirname(packageEntry);
const destination = path.join(HERE, "..", "public", "onnxruntime");
const files = [
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
  "ort-wasm-simd-threaded.asyncify.mjs",
];

await fs.mkdir(destination, { recursive: true });
await Promise.all(
  files.map((file) => fs.copyFile(path.join(packageDist, file), path.join(destination, file))),
);

console.log(`demo:runtime-assets: copied ${files.length} ONNX runtime files -> public/onnxruntime`);
