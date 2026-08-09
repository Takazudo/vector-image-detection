import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("production output contains the hosted app without legacy browser models or fixture data", async () => {
  const html = await fs.readFile(path.join(ROOT, "dist", "index.html"), "utf8");
  assert.match(html, /data-zfb-island-skip-ssr="App"/);
  assert.match(html, /<script type="module" src="\/assets\/islands-[^"]+\.js"><\/script>/);
  assert.match(html, /href="\/favicon\.svg"/);

  const entries = await fs.readdir(path.join(ROOT, "dist"), { recursive: true });
  const joined = entries.join("\n");
  assert.doesNotMatch(joined, /onnxruntime|embeddings\.bin|(?:^|\/)data(?:\/|$)/);
  const assetSources = await Promise.all(
    (await fs.readdir(path.join(ROOT, "dist", "assets"))).map((asset) =>
      fs.readFile(path.join(ROOT, "dist", "assets", asset), "utf8"),
    ),
  );
  assert.doesNotMatch(assetSources.join("\n"), /huggingface|onnxruntime|siglip|embeddings\.bin/i);
});
