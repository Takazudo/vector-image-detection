#!/usr/bin/env node
// Copies the committed, license-attributed real-photo bundle into public/data/.
// `vis export-demo` writes to the same destination, so local experiments can
// still replace the demo corpus without changing application code.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = path.join(HERE, "..", "fixtures", "bundle");
const DEST_DIR = path.join(HERE, "..", "public", "data");

const metaPath = path.join(SOURCE_DIR, "meta.json");
if (
  !(await fs.access(metaPath).then(
    () => true,
    () => false,
  ))
) {
  console.error(`demo:fixture: no committed bundle at ${SOURCE_DIR}`);
  process.exit(1);
}

await fs.rm(DEST_DIR, { recursive: true, force: true });
await fs.mkdir(path.dirname(DEST_DIR), { recursive: true });
await fs.cp(SOURCE_DIR, DEST_DIR, { recursive: true });

console.log("demo:fixture: copied committed real-photo bundle -> public/data");
