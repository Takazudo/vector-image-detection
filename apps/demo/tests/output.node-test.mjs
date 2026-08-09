import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function buildFixture() {
  await execFileAsync("pnpm", ["run", "fixture"], { cwd: ROOT });
  await execFileAsync("pnpm", ["run", "build"], { cwd: ROOT, maxBuffer: 16 * 1024 * 1024 });
}

test("zfb production output preserves the island and root asset contract", async () => {
  await buildFixture();

  const html = await fs.readFile(path.join(ROOT, "dist", "index.html"), "utf8");
  assert.match(html, /data-zfb-island-skip-ssr="App"/);
  assert.match(html, /<script type="module" src="\/assets\/islands-[^"]+\.js"><\/script>/);
  assert.match(html, /href="\/favicon\.svg"/);

  const assets = await fs.readdir(path.join(ROOT, "dist", "assets"));
  const mockWorker = assets.find((name) => /^worker-src-s-embed-h-worker-d-ts\.js$/.test(name));
  const realWorker = assets.find((name) =>
    /^worker-src-s-real-h-embed-h-worker-d-ts\.js$/.test(name),
  );
  assert.ok(mockWorker, `expected the mock-safe coordinator worker, got: ${assets.join(", ")}`);
  assert.ok(realWorker, `expected the lazy real-model worker, got: ${assets.join(", ")}`);
  const mockWorkerSource = await fs.readFile(path.join(ROOT, "dist", "assets", mockWorker), "utf8");
  const realWorkerSource = await fs.readFile(path.join(ROOT, "dist", "assets", realWorker), "utf8");
  assert.doesNotMatch(mockWorkerSource, /huggingface|onnxruntime|ort-wasm/);
  assert.match(realWorkerSource, /\/onnxruntime\/ort-wasm-simd-threaded\.wasm/);
  assert.match(realWorkerSource, /Xenova\/siglip-base-patch16-224/);

  for (const file of [
    "ort-wasm-simd-threaded.wasm",
    "ort-wasm-simd-threaded.mjs",
    "ort-wasm-simd-threaded.asyncify.wasm",
    "ort-wasm-simd-threaded.asyncify.mjs",
  ]) {
    const stat = await fs.stat(path.join(ROOT, "dist", "onnxruntime", file));
    assert.ok(stat.size > 0, `${file} must be emitted at /onnxruntime/${file}`);
  }

  await fs.access(path.join(ROOT, "dist", "data", "meta.json"));
  await fs.access(path.join(ROOT, "dist", "data", "embeddings.bin"));
  await fs.access(path.join(ROOT, "dist", "data", "manifest.json"));
  await fs.access(path.join(ROOT, "dist", "data", "CREDITS.md"));
  await fs.access(path.join(ROOT, "dist", "data", "thumbs", "pets", "cat-abyssinian-1.jpg.jpg"));
});
