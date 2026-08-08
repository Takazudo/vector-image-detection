import { promises as fs } from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../run.js";
import { createTmpPhotoFixture, fakeDeps, type TmpPhotoFixture } from "../test-support/fixture.js";

describe("vis tag vocab", () => {
  let fixture: TmpPhotoFixture;
  let metaPath: string;

  beforeEach(async () => {
    fixture = await createTmpPhotoFixture({ catCount: 2, dogCount: 2 });
    metaPath = path.join(fixture.rootDir, "data", "indexes", "demo", "meta.json");
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("without --apply, only prints the summary and leaves tags untouched", async () => {
    const { deps, logger } = fakeDeps({ rootDir: fixture.rootDir });
    await runCli(["ingest", "photos", "--index", "demo"], deps);
    logger.logLines.length = 0;

    const code = await runCli(["tag", "vocab", "cat", "dog", "--index", "demo"], deps);
    expect(code).toBe(0);
    expect(logger.logLines.some((line) => line.startsWith("cat: 2 match"))).toBe(true);

    const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
    for (const item of meta.items) expect(item.tags).toEqual([]);
  });

  it("--apply merges proposed tags without duplicating on a repeat run", async () => {
    const { deps } = fakeDeps({ rootDir: fixture.rootDir });
    await runCli(["ingest", "photos", "--index", "demo"], deps);

    await runCli(["tag", "vocab", "cat", "dog", "--index", "demo", "--apply"], deps);
    const firstPass = JSON.parse(await fs.readFile(metaPath, "utf8"));
    const catItem = firstPass.items.find((item: { file: string }) => item.file === "cat-1.jpg");
    expect(catItem.tags).toEqual(["cat"]);

    await runCli(["tag", "vocab", "cat", "dog", "--index", "demo", "--apply"], deps);
    const secondPass = JSON.parse(await fs.readFile(metaPath, "utf8"));
    const catItemAgain = secondPass.items.find((item: { file: string }) => item.file === "cat-1.jpg");
    expect(catItemAgain.tags).toEqual(["cat"]); // no duplicate "cat" entries
  });

  it("a threshold above every score proposes nothing to apply", async () => {
    const { deps, logger } = fakeDeps({ rootDir: fixture.rootDir });
    await runCli(["ingest", "photos", "--index", "demo"], deps);
    logger.logLines.length = 0;

    const code = await runCli(
      ["tag", "vocab", "cat", "--threshold", "0.999", "--index", "demo", "--apply"],
      deps,
    );
    expect(code).toBe(0);
    expect(logger.logLines.some((line) => line.includes("nothing to apply"))).toBe(true);
  });
});
