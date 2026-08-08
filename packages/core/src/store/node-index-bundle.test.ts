import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IndexMeta } from "../types.js";
import { IndexModelMismatchError } from "./index-bundle-codec.js";
import { loadIndex, saveIndex, updateTags } from "./node-index-bundle.js";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "vec-store-test-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function sampleMeta(): IndexMeta {
  return {
    formatVersion: 1,
    modelId: "fake-embedder-v1",
    dim: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    items: [
      { id: "a", file: "a.jpg", tags: ["cat"] },
      { id: "b", file: "b.jpg", tags: [] },
    ],
  };
}

function sampleVectors(): Float32Array[] {
  return [Float32Array.from([1, 0, 0]), Float32Array.from([0.6, 0.8, 0])];
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

describe("saveIndex / loadIndex", () => {
  it("round-trips meta and vectors bit-exact", async () => {
    const meta = sampleMeta();
    const vectors = sampleVectors();
    await saveIndex(dir, meta, vectors);

    const loaded = await loadIndex(dir);
    expect(loaded.meta).toEqual(meta);
    expect(loaded.vectors).toHaveLength(vectors.length);
    for (let i = 0; i < vectors.length; i++) {
      expect(loaded.vectors[i]).toEqual(vectors[i]);
    }
  });

  it("leaves no .tmp files behind after a successful save", async () => {
    await saveIndex(dir, sampleMeta(), sampleVectors());
    expect(await exists(path.join(dir, "meta.json.tmp"))).toBe(false);
    expect(await exists(path.join(dir, "embeddings.bin.tmp"))).toBe(false);
    expect(await exists(path.join(dir, "meta.json"))).toBe(true);
    expect(await exists(path.join(dir, "embeddings.bin"))).toBe(true);
  });

  it("creates the target directory if it doesn't exist yet", async () => {
    const nested = path.join(dir, "nested", "index");
    await saveIndex(nested, sampleMeta(), sampleVectors());
    expect(await exists(path.join(nested, "meta.json"))).toBe(true);
  });

  it("rejects when items and vectors counts disagree, without touching disk", async () => {
    await expect(saveIndex(dir, sampleMeta(), [Float32Array.from([1, 0, 0])])).rejects.toThrow(
      /vectors/,
    );
    expect(await exists(path.join(dir, "meta.json"))).toBe(false);
  });

  it("throws IndexModelMismatchError on a modelId/dim mismatch, mentioning re-run ingest", async () => {
    await saveIndex(dir, sampleMeta(), sampleVectors());
    await expect(loadIndex(dir, { modelId: "other-model", dim: 3 })).rejects.toThrow(
      IndexModelMismatchError,
    );
    await expect(loadIndex(dir, { modelId: "other-model", dim: 3 })).rejects.toThrow(
      /re-run ingest/,
    );
  });

  it("succeeds when the expected modelId/dim matches", async () => {
    await saveIndex(dir, sampleMeta(), sampleVectors());
    await expect(loadIndex(dir, { modelId: "fake-embedder-v1", dim: 3 })).resolves.toBeDefined();
  });

  it("simulates a failed write and leaves no partial state or leftover tmp files", async () => {
    // Obstruct the embeddings tmp path with a pre-existing directory so
    // fs.writeFile(embeddingsTmp, ...) fails deterministically (EISDIR),
    // regardless of platform/permission bits.
    await fs.mkdir(path.join(dir, "embeddings.bin.tmp"));

    await expect(saveIndex(dir, sampleMeta(), sampleVectors())).rejects.toThrow();

    // The meta tmp file (a real file saveIndex created) must be cleaned up.
    expect(await exists(path.join(dir, "meta.json.tmp"))).toBe(false);
    // Neither final file was ever renamed into place.
    expect(await exists(path.join(dir, "meta.json"))).toBe(false);
    expect(await exists(path.join(dir, "embeddings.bin"))).toBe(false);
  });

  it("a failed save does not clobber a previously-saved valid bundle", async () => {
    const original = sampleMeta();
    await saveIndex(dir, original, sampleVectors());

    await fs.mkdir(path.join(dir, "embeddings.bin.tmp"));
    await expect(
      saveIndex(dir, { ...original, modelId: "different-model" }, sampleVectors()),
    ).rejects.toThrow();

    const loaded = await loadIndex(dir);
    expect(loaded.meta.modelId).toBe("fake-embedder-v1");
  });
});

describe("updateTags", () => {
  it("rewrites tags for matching ids and leaves embeddings.bin untouched", async () => {
    await saveIndex(dir, sampleMeta(), sampleVectors());
    const embeddingsBefore = await fs.readFile(path.join(dir, "embeddings.bin"));

    await updateTags(dir, [{ id: "a", tags: ["cat", "confirmed"] }]);

    const loaded = await loadIndex(dir);
    expect(loaded.meta.items.find((i) => i.id === "a")?.tags).toEqual(["cat", "confirmed"]);
    expect(loaded.meta.items.find((i) => i.id === "b")?.tags).toEqual([]);

    const embeddingsAfter = await fs.readFile(path.join(dir, "embeddings.bin"));
    expect(embeddingsAfter).toEqual(embeddingsBefore);
  });

  it("ignores changes for ids not present in the index", async () => {
    await saveIndex(dir, sampleMeta(), sampleVectors());
    await updateTags(dir, [{ id: "does-not-exist", tags: ["x"] }]);
    const loaded = await loadIndex(dir);
    expect(loaded.meta.items).toEqual(sampleMeta().items);
  });

  it("leaves no meta.json.tmp behind after a successful update", async () => {
    await saveIndex(dir, sampleMeta(), sampleVectors());
    await updateTags(dir, [{ id: "a", tags: ["updated"] }]);
    expect(await exists(path.join(dir, "meta.json.tmp"))).toBe(false);
  });
});
