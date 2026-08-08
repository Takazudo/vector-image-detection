// Acceptance test for the committed fixture bundle: every demo view is backed
// by a core call, so exercising those calls against the real bundle on disk is
// what "all six views work in mock mode with no network" means in a test.
//
// It also guards the bundle itself. `fixtures/generate.mjs` is run by hand and
// its output is committed, so a half-finished regeneration (missing thumbs,
// embeddings.bin out of sync with meta.json, a colour change that silently
// rendered every image black) would otherwise only surface in a browser.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { FetchLike, IndexItem, IndexMeta, Vector } from "@vector-image-detection/core/browser";
import {
  FakeEmbedder,
  labeling,
  loadIndexFromUrl,
  storeFromIndex,
} from "@vector-image-detection/core/browser";
import { beforeAll, describe, expect, it } from "vitest";

const BUNDLE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "bundle");
const KEYWORDS = ["cat", "dog", "capacitor", "resistor", "led", "connector"];

const fetchFromDisk: FetchLike = async (input) => {
  const relative = String(input).replace(/^fixture:\//, "");
  return new Response(await fs.readFile(path.join(BUNDLE_DIR, relative)));
};

const embedder = new FakeEmbedder();

let meta: IndexMeta;
let vectors: Vector[];
let store: ReturnType<typeof storeFromIndex>;
let itemById: Map<string, IndexItem>;

beforeAll(async () => {
  ({ meta, vectors } = await loadIndexFromUrl("fixture:/", fetchFromDisk));
  store = storeFromIndex(meta, vectors);
  itemById = new Map(meta.items.map((item) => [item.id, item]));
});

const idsFor = (keyword: string) =>
  KEYWORDS.includes(keyword)
    ? meta.items.filter((item) => item.knownLabel === keyword).map((item) => item.id)
    : [];

describe("bundle integrity", () => {
  it("is a v1 bundle built by the fake embedder", () => {
    expect(meta.formatVersion).toBe(1);
    expect(meta.modelId).toBe("fake-embedder-v1");
    expect(meta.dim).toBe(embedder.dim);
  });

  it("holds four images per keyword, each with a distinct id", () => {
    expect(meta.items).toHaveLength(KEYWORDS.length * 4);
    expect(new Set(meta.items.map((item) => item.id)).size).toBe(meta.items.length);
    for (const keyword of KEYWORDS) expect(idsFor(keyword)).toHaveLength(4);
  });

  it("decodes one unit-length vector per item", () => {
    expect(vectors).toHaveLength(meta.items.length);
    for (const vector of vectors) {
      expect(vector).toHaveLength(meta.dim);
      const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
      expect(norm).toBeCloseTo(1, 5);
    }
  });

  it("ships a readable thumbnail for every item", async () => {
    for (const item of meta.items) {
      expect(item.thumb).toBeDefined();
      const stat = await fs.stat(path.join(BUNDLE_DIR, ...item.thumb!.split("/")));
      // A blank render (the failure mode when the SVG colour syntax is not
      // supported) compresses to a few hundred bytes.
      expect(stat.size).toBeGreaterThan(1000);
    }
  });

  it("carries attribution on most items and deliberately omits it on some", () => {
    const credited = meta.items.filter((item) => item.license && item.author && item.source);
    const uncredited = meta.items.filter((item) => !item.license && !item.author && !item.source);
    expect(credited).toHaveLength(18);
    expect(uncredited).toHaveLength(6);
  });

  it("seeds a couple of index-owned tags for the merge path to merge over", () => {
    expect(meta.items.filter((item) => item.tags.length > 0).map((item) => item.tags)).toEqual([
      ["through-hole"],
      ["through-hole"],
    ]);
  });
});

describe("search view", () => {
  it("ranks the described keyword's photos above everything else", async () => {
    for (const keyword of KEYWORDS) {
      const [query] = await embedder.embedTexts([`a photo of a ${keyword}`]);
      const hits = await store.search(query!, 4);
      expect(hits.map((hit) => hit.id).sort()).toEqual(idsFor(keyword).sort());
      expect(hits.at(-1)!.score).toBeGreaterThan(0.9);
    }
  });
});

describe("similar view", () => {
  it("puts an image's same-keyword siblings closest to it", async () => {
    const [self, ...siblings] = idsFor("capacitor");
    const index = meta.items.findIndex((item) => item.id === self);
    const hits = await store.search(vectors[index]!, 4);

    expect(hits[0]!.id).toBe(self);
    expect(
      hits
        .slice(1)
        .map((hit) => hit.id)
        .sort(),
    ).toEqual(siblings.sort());
  });
});

describe("auto-categorize view", () => {
  it("assigns every cat and dog photo to the matching word", async () => {
    const vocab = await labeling.embedVocab(embedder, ["cat", "dog"]);
    const winners = labeling.classifyByVocab(vectors, vocab);

    for (const keyword of ["cat", "dog"]) {
      const assigned = meta.items
        .filter((_item, i) => winners[i]!.label === keyword)
        .map((item) => item.id);
      expect(assigned).toEqual(expect.arrayContaining(idsFor(keyword)));
    }
  });

  it("splits into keyword-pure exploratory clusters at k = 6", async () => {
    const { clustering } = await import("@vector-image-detection/core/browser");
    const { assignments } = clustering.kmeans(vectors, KEYWORDS.length);

    const labelsPerCluster = new Map<number, Set<string>>();
    assignments.forEach((cluster, i) => {
      const labels = labelsPerCluster.get(cluster) ?? new Set<string>();
      labels.add(meta.items[i]!.knownLabel ?? "");
      labelsPerCluster.set(cluster, labels);
    });

    expect(labelsPerCluster.size).toBe(KEYWORDS.length);
    for (const labels of labelsPerCluster.values()) expect(labels.size).toBe(1);
  });
});

describe("vocabulary tags view", () => {
  it("gives each photo exactly its own keyword at a mid threshold", async () => {
    const vocab = await labeling.embedVocab(embedder, KEYWORDS);
    const tagged = labeling.zeroShotTag(vectors, vocab, { threshold: 0.5 });

    tagged.forEach((scores, i) => {
      expect(scores.map((score) => score.label)).toEqual([meta.items[i]!.knownLabel]);
    });
  });

  it("trades coverage for precision as the threshold moves", async () => {
    const vocab = await labeling.embedVocab(embedder, KEYWORDS);
    const count = (threshold: number) =>
      labeling
        .zeroShotTag(vectors, vocab, { threshold })
        .reduce((total, scores) => total + scores.length, 0);

    // The fake space separates cleanly — a photo scores ~0.99 against its own
    // keyword and below ~0.34 against every other — so the whole plateau from
    // just above the noise floor to just below the signal is exactly one tag
    // per photo, and the slider shows noise creeping in below it.
    expect(count(0)).toBeGreaterThan(count(0.2));
    expect(count(0.2)).toBeGreaterThan(count(0.35));
    expect(count(0.35)).toBe(meta.items.length);
    expect(count(0.9)).toBe(meta.items.length);
    expect(count(1)).toBe(0);
  });
});

describe("attach-a-word view", () => {
  it("proposes the remaining same-keyword photos from a single exemplar", async () => {
    const [exemplar, ...rest] = idsFor("led");
    const proposals = await labeling.proposeTagPropagation(store, [exemplar!], "keeper", {
      threshold: 0.75,
      limit: 12,
    });

    expect(proposals.map((proposal) => proposal.id).sort()).toEqual(rest.sort());
    for (const proposal of proposals) expect(proposal.score).toBeGreaterThanOrEqual(0.75);
  });

  it("skips photos that already carry the tag", async () => {
    const [exemplar, second, ...rest] = idsFor("connector");
    const tagged = storeFromIndex(
      {
        items: meta.items.map((item) =>
          item.id === second ? { ...item, tags: [...item.tags, "keeper"] } : item,
        ),
      },
      vectors,
    );

    const proposals = await labeling.proposeTagPropagation(tagged, [exemplar!], "keeper", {
      threshold: 0.75,
      limit: 12,
    });
    expect(proposals.map((proposal) => proposal.id).sort()).toEqual(rest.sort());
  });
});

describe("gallery view", () => {
  it("resolves every item id back to an item, as the ranked views require", async () => {
    const [query] = await embedder.embedTexts(["a photo of a resistor"]);
    const hits = await store.search(query!, meta.items.length);
    for (const hit of hits) expect(itemById.get(hit.id)).toBeDefined();
  });
});
