#!/usr/bin/env node
// Copies the committed fixture bundle into public/data/ — the same destination
// `vis export-demo` writes to, so the app cannot tell the two apart. public/data
// is gitignored; this is what makes `pnpm demo:fixture && pnpm dev` work on a
// fresh clone with no model download.

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
  console.error(
    `demo:fixture: no bundle at ${SOURCE_DIR} — run \`pnpm --filter @vector-image-detection/demo fixture:generate\` first`,
  );
  process.exit(1);
}

await fs.rm(DEST_DIR, { recursive: true, force: true });
await fs.mkdir(path.dirname(DEST_DIR), { recursive: true });
await fs.cp(SOURCE_DIR, DEST_DIR, { recursive: true });

console.log("demo:fixture: copied fixtures/bundle -> public/data");
