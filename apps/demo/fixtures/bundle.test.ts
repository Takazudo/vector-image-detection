import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { FetchLike, IndexMeta, Vector } from "@vector-image-detection/core/browser";
import { loadIndexFromUrl } from "@vector-image-detection/core/browser";
import { beforeAll, describe, expect, it } from "vitest";

const BUNDLE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "bundle");

const fetchFromDisk: FetchLike = async (input) => {
  const relative = String(input).replace(/^fixture:\//, "");
  return new Response(await fs.readFile(path.join(BUNDLE_DIR, relative)));
};

let meta: IndexMeta;
let vectors: Vector[];

beforeAll(async () => {
  ({ meta, vectors } = await loadIndexFromUrl("fixture:/", fetchFromDisk));
});

describe("published real-photo bundle", () => {
  it("contains the expected real-model corpus", () => {
    expect(meta.formatVersion).toBe(1);
    expect(meta.modelId).toBe("Xenova/siglip-base-patch16-224");
    expect(meta.dim).toBe(768);
    expect(meta.items).toHaveLength(100);
    expect(new Set(meta.items.map((item) => item.id)).size).toBe(100);
  });

  it("decodes one unit-length vector per photo", () => {
    expect(vectors).toHaveLength(meta.items.length);
    for (const vector of vectors) {
      expect(vector).toHaveLength(meta.dim);
      const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
      expect(norm).toBeCloseTo(1, 5);
    }
  });

  it("ships a readable thumbnail and source/license attribution for every photo", async () => {
    for (const item of meta.items) {
      expect(item.thumb).toBeDefined();
      expect(item.source).toMatch(/^https:\/\//);
      expect(item.license).toBeTruthy();
      const stat = await fs.stat(path.join(BUNDLE_DIR, ...item.thumb!.split("/")));
      expect(stat.size).toBeGreaterThan(1_000);
    }
    expect(meta.items.filter((item) => item.author).length).toBe(40);
  });

  it("includes public source and license records next to the served photos", async () => {
    const [manifest, credits] = await Promise.all([
      fs.readFile(path.join(BUNDLE_DIR, "manifest.json"), "utf8"),
      fs.readFile(path.join(BUNDLE_DIR, "CREDITS.md"), "utf8"),
    ]);
    const parsed = JSON.parse(manifest) as { items: unknown[] };
    expect(parsed.items).toHaveLength(100);
    expect(credits).toContain("Oxford-IIIT Pet dataset");
    expect(credits).toContain("Wikimedia Commons");
  });
});
