import { promises as fs } from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../run.js";
import { createTmpPhotoFixture, fakeDeps, type TmpPhotoFixture } from "../test-support/fixture.js";

describe("vis ingest", () => {
  let fixture: TmpPhotoFixture;

  beforeEach(async () => {
    fixture = await createTmpPhotoFixture({ catCount: 1, dogCount: 1 });
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("exits 1 (usage error) when <dir> is not a directory", async () => {
    const { deps } = fakeDeps({ rootDir: fixture.rootDir });
    const code = await runCli(["ingest", "photos/cat-1.jpg", "--index", "demo"], deps);
    expect(code).toBe(1);
  });

  it("exits 0 with a message and writes nothing when <dir> has no images", async () => {
    const { deps, logger } = fakeDeps({ rootDir: fixture.rootDir });
    await fs.mkdir(path.join(fixture.rootDir, "empty"));
    const code = await runCli(["ingest", "empty", "--index", "demo"], deps);
    expect(code).toBe(0);
    expect(logger.logLines.some((line) => line.includes("no jpg/png/webp images"))).toBe(true);
    await expect(fs.stat(path.join(fixture.rootDir, "data", "indexes", "demo"))).rejects.toThrow();
  });

  it("matches manifest metadata by path relative to the manifest's directory, not <dir>", async () => {
    // Ingest photos/ *itself* (where manifest.json lives) so file keys equal item ids;
    // this is the baseline the "ingest a subdirectory" case below is contrasted against.
    const { deps } = fakeDeps({ rootDir: fixture.rootDir });
    const code = await runCli(["ingest", "photos", "--index", "demo"], deps);
    expect(code).toBe(0);
    const meta = JSON.parse(
      await fs.readFile(path.join(fixture.rootDir, "data", "indexes", "demo", "meta.json"), "utf8"),
    );
    const cat = meta.items.find((item: { file: string }) => item.file === "cat-1.jpg");
    expect(cat.knownLabel).toBe("cat");
  });

  it("still matches manifest metadata when ingesting a subdirectory nested under the manifest", async () => {
    // Move the fixture photos under photos/pets/ so manifest.json (still at
    // photos/) is a *parent* of the ingested dir, matching the issue's "or a
    // parent" clause.
    const nestedDir = path.join(fixture.photosDir, "pets");
    await fs.mkdir(nestedDir);
    for (const file of ["cat-1.jpg", "dog-1.jpg"]) {
      await fs.rename(path.join(fixture.photosDir, file), path.join(nestedDir, file));
    }
    const manifestPath = path.join(fixture.photosDir, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.items = manifest.items.map((item: { file: string }) => ({
      ...item,
      file: `pets/${item.file}`,
    }));
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    const { deps } = fakeDeps({ rootDir: fixture.rootDir });
    const code = await runCli(["ingest", "photos/pets", "--index", "demo"], deps);
    expect(code).toBe(0);

    const meta = JSON.parse(
      await fs.readFile(path.join(fixture.rootDir, "data", "indexes", "demo", "meta.json"), "utf8"),
    );
    const cat = meta.items.find((item: { file: string }) => item.file === "cat-1.jpg");
    expect(cat.knownLabel).toBe("cat");
    expect(cat.id).toBe("cat-1.jpg"); // id/file stay relative to the ingested dir itself
  });
});
