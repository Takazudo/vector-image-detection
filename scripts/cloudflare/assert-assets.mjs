#!/usr/bin/env node

import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function parseJsonc(source) {
  return JSON.parse(
    source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/,\s*([}\]])/g, "$1"),
  );
}

const sites = {
  docs: {
    directory: "apps/docs",
    expectedConfig: {
      name: "doc-vector-image-detection",
      hostname: "doc-vector-image-detection.takazudomodular.com",
      htmlHandling: "auto-trailing-slash",
      notFoundHandling: "404-page",
    },
    files: [
      "dist/index.html",
      "dist/404.html",
      "dist/__zfb/routes.json",
      "dist/docs/overview/index.html",
      "dist/robots.txt",
      "dist/sitemap.xml",
    ],
  },
  demo: {
    directory: "apps/demo",
    expectedConfig: {
      name: "vector-image-detection-demo",
      hostname: "vector-image-detection.takazudomodular.com",
      htmlHandling: "none",
      notFoundHandling: "single-page-application",
    },
    files: [
      "dist/index.html",
      "dist/__zfb/routes.json",
      "dist/assets/worker-src-s-embed-h-worker-d-ts.js",
      "dist/assets/worker-src-s-real-h-embed-h-worker-d-ts.js",
      "dist/onnxruntime/ort-wasm-simd-threaded.wasm",
      "dist/data/meta.json",
      "dist/data/embeddings.bin",
      "dist/data/thumbs/cat/cat-01.png.jpg",
    ],
  },
};

function assertConfig(siteName, config, expected) {
  assert.equal(config.name, expected.name, `${siteName}: Worker name must be explicit`);
  assert.equal(config.workers_dev, false, `${siteName}: workers.dev must be disabled`);
  assert.deepEqual(config.routes, [{ pattern: expected.hostname, custom_domain: true }]);
  assert.equal(config.assets?.directory, "./dist", `${siteName}: assets must deploy the app dist/`);
  assert.equal(config.assets?.html_handling, expected.htmlHandling);
  assert.equal(config.assets?.not_found_handling, expected.notFoundHandling);
}

async function assertSite(siteName) {
  const site = sites[siteName];
  const root = path.join(ROOT, site.directory);
  const config = parseJsonc(await readFile(path.join(root, "wrangler.jsonc"), "utf8"));
  assertConfig(siteName, config, site.expectedConfig);

  for (const relativePath of site.files) {
    const target = path.join(root, relativePath);
    await access(target);
    const details = await stat(target);
    assert.ok(details.size > 0, `${siteName}: ${relativePath} must not be empty`);
  }

  console.log(`Cloudflare assets ready: ${siteName}`);
}

const requested = process.argv.slice(2);
const selected = requested.length === 0 ? Object.keys(sites) : requested;

for (const siteName of selected) {
  if (!(siteName in sites)) {
    throw new Error(`Unknown site ${JSON.stringify(siteName)}; use docs or demo.`);
  }
  await assertSite(siteName);
}
