import assert from "node:assert/strict";
import test from "node:test";

import { loadSeedManifest, parseSeedTarget } from "./seed-manifest.mjs";

test("seed manifest loads all 100 credited thumbnails without labels or embeddings", async () => {
  const entries = await loadSeedManifest();
  assert.equal(entries.length, 100);
  assert.ok(entries.every((entry) => entry.sourcePath.startsWith("thumbs/")));
  assert.ok(entries.every((entry) => entry.checksum.length === 64));
  assert.ok(entries.every((entry) => !("knownLabel" in entry) && !("tags" in entry)));
});

test("remote seeding is never selected implicitly", () => {
  assert.deepEqual(parseSeedTarget([]), { mode: "local", target: "local" });
  assert.throws(() => parseSeedTarget(["--remote"]), /explicit --target/);
  assert.deepEqual(parseSeedTarget(["--remote", "--target", "production"]), {
    mode: "remote",
    target: "production",
  });
});
