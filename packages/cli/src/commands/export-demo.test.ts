import { promises as fs } from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../run.js";
import { createTmpPhotoFixture, fakeDeps, type TmpPhotoFixture } from "../test-support/fixture.js";

describe("vis export-demo", () => {
  let fixture: TmpPhotoFixture;
  let demoDataDir: string;

  beforeEach(async () => {
    fixture = await createTmpPhotoFixture({ catCount: 1, dogCount: 1 });
    demoDataDir = path.join(fixture.rootDir, "apps", "demo", "public", "data");
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("exits 1 (usage error) when the index doesn't exist", async () => {
    const { deps } = fakeDeps({ rootDir: fixture.rootDir });
    const code = await runCli(["export-demo", "--index", "missing"], deps);
    expect(code).toBe(1);
  });

  it("overwrites a stale destination rather than merging into it", async () => {
    const { deps } = fakeDeps({ rootDir: fixture.rootDir });
    await runCli(["ingest", "photos", "--index", "demo"], deps);

    await fs.mkdir(demoDataDir, { recursive: true });
    await fs.writeFile(path.join(demoDataDir, "stale-leftover.txt"), "should be removed");

    const code = await runCli(["export-demo", "--index", "demo"], deps);
    expect(code).toBe(0);

    await expect(fs.stat(path.join(demoDataDir, "stale-leftover.txt"))).rejects.toThrow();
    const meta = JSON.parse(await fs.readFile(path.join(demoDataDir, "meta.json"), "utf8"));
    expect(meta.items).toHaveLength(2);
    const cat1 = meta.items.find((item: { file: string }) => item.file === "cat-1.jpg");
    await expect(fs.stat(path.join(demoDataDir, cat1.thumb))).resolves.toBeDefined();
  });
});
