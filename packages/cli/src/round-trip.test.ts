import { promises as fs } from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "./run.js";
import { createTmpPhotoFixture, fakeDeps, type TmpPhotoFixture } from "./test-support/fixture.js";

// Acceptance-criteria round trip (issue #10): ingest -> search -> similar ->
// tag vocab -> propagate(--yes) -> cluster -> export-demo, all against a
// FakeEmbedder (never touches a real model) and a tmp-dir fixture index.
describe("vis CLI round trip", () => {
  let fixture: TmpPhotoFixture;

  beforeEach(async () => {
    fixture = await createTmpPhotoFixture({ catCount: 3, dogCount: 3 });
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("ingests, searches, finds similar, tags, propagates, clusters, and exports", async () => {
    const { deps, logger } = fakeDeps({ rootDir: fixture.rootDir });
    const indexDir = path.join(fixture.rootDir, "data", "indexes", "demo");

    // 1. ingest
    const ingestCode = await runCli(["ingest", "photos", "--index", "demo"], deps);
    expect(ingestCode).toBe(0);

    const metaRaw = JSON.parse(await fs.readFile(path.join(indexDir, "meta.json"), "utf8"));
    expect(metaRaw.items).toHaveLength(6);
    await expect(fs.stat(path.join(indexDir, "embeddings.bin"))).resolves.toBeDefined();
    for (const item of metaRaw.items as { file: string; thumb: string; tags: string[]; knownLabel: string; source: string; license: string; author: string }[]) {
      expect(item.tags).toEqual([]);
      expect(item.knownLabel).toBe(item.file.startsWith("cat") ? "cat" : "dog");
      expect(item.source).toBe(item.file.startsWith("cat") ? "https://example.test/cat-source" : "https://example.test/dog-source");
      expect(item.license).toBe("CC0 1.0");
      expect(item.author).toBe("Fixture Author");
      await expect(fs.stat(path.join(indexDir, item.thumb))).resolves.toBeDefined();
    }

    // 2. search
    logger.logLines.length = 0;
    const searchCode = await runCli(["search", "a photo of a cat", "--index", "demo", "-k", "3"], deps);
    expect(searchCode).toBe(0);
    const searchTable = logger.logLines.join("\n");
    for (let i = 1; i <= 3; i++) expect(searchTable).toContain(`cat-${i}.jpg`);
    expect(searchTable).not.toContain("dog-");

    // 3. similar (by known item id — excludes itself from results). -k 2
    // exactly matches the number of other cat items, so both slots are cats.
    logger.logLines.length = 0;
    const similarCode = await runCli(["similar", "cat-1.jpg", "--index", "demo", "-k", "2"], deps);
    expect(similarCode).toBe(0);
    const similarTable = logger.logLines.join("\n");
    expect(similarTable).not.toContain("cat-1.jpg");
    expect(similarTable).toContain("cat-2.jpg");
    expect(similarTable).toContain("cat-3.jpg");
    expect(similarTable).not.toContain("dog-");

    // 4. tag vocab --apply
    logger.logLines.length = 0;
    const tagVocabCode = await runCli(
      ["tag", "vocab", "cat", "dog", "--index", "demo", "--apply"],
      deps,
    );
    expect(tagVocabCode).toBe(0);
    expect(logger.logLines.some((line) => line.startsWith("cat: 3 match"))).toBe(true);
    expect(logger.logLines.some((line) => line.startsWith("dog: 3 match"))).toBe(true);

    const afterVocab = JSON.parse(await fs.readFile(path.join(indexDir, "meta.json"), "utf8"));
    for (const item of afterVocab.items as { file: string; tags: string[] }[]) {
      expect(item.tags).toEqual([item.file.startsWith("cat") ? "cat" : "dog"]);
    }

    // 5. tag propagate --yes (a tag that isn't already applied, so the
    // already-tagged filter in proposeTagPropagation doesn't drop everything)
    logger.logLines.length = 0;
    const propagateCode = await runCli(
      ["tag", "propagate", "cat-1.jpg", "favorite", "--threshold", "0.5", "--index", "demo", "--yes"],
      deps,
    );
    expect(propagateCode).toBe(0);
    expect(logger.logLines.some((line) => line.includes('applied "favorite"'))).toBe(true);

    const afterPropagate = JSON.parse(await fs.readFile(path.join(indexDir, "meta.json"), "utf8"));
    const cat2 = afterPropagate.items.find((item: { file: string }) => item.file === "cat-2.jpg");
    const cat3 = afterPropagate.items.find((item: { file: string }) => item.file === "cat-3.jpg");
    expect(cat2.tags).toContain("favorite");
    expect(cat3.tags).toContain("favorite");
    const dog1 = afterPropagate.items.find((item: { file: string }) => item.file === "dog-1.jpg");
    expect(dog1.tags).not.toContain("favorite");

    // 6. cluster --k 2 --json
    logger.logLines.length = 0;
    const clusterCode = await runCli(["cluster", "--k", "2", "--index", "demo", "--json"], deps);
    expect(clusterCode).toBe(0);
    const clusterOutput = JSON.parse(logger.logLines.join("\n")) as { cluster: number; files: string[] }[];
    expect(clusterOutput).toHaveLength(2);
    const allFiles = clusterOutput.flatMap((group) => group.files);
    expect(allFiles).toHaveLength(6);
    for (const group of clusterOutput) {
      const allCat = group.files.every((file) => file.startsWith("cat"));
      const allDog = group.files.every((file) => file.startsWith("dog"));
      expect(allCat || allDog).toBe(true);
    }

    // 7. export-demo
    logger.logLines.length = 0;
    const exportCode = await runCli(["export-demo", "--index", "demo"], deps);
    expect(exportCode).toBe(0);
    const demoDataDir = path.join(fixture.rootDir, "apps", "demo", "public", "data");
    const exportedMeta = JSON.parse(await fs.readFile(path.join(demoDataDir, "meta.json"), "utf8"));
    expect(exportedMeta.items).toHaveLength(6);
    for (const item of exportedMeta.items as { file: string; license: string; author: string; thumb: string }[]) {
      expect(item.license).toBe("CC0 1.0");
      expect(item.author).toBe("Fixture Author");
      await expect(fs.stat(path.join(demoDataDir, item.thumb))).resolves.toBeDefined();
    }
    await expect(fs.stat(path.join(demoDataDir, "embeddings.bin"))).resolves.toBeDefined();
  });
});
