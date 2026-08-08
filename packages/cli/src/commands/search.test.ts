import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../run.js";
import { createTmpPhotoFixture, fakeDeps, type TmpPhotoFixture } from "../test-support/fixture.js";

describe("vis search", () => {
  let fixture: TmpPhotoFixture;

  beforeEach(async () => {
    fixture = await createTmpPhotoFixture({ catCount: 2, dogCount: 2 });
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("exits 1 on an invalid --backend", async () => {
    const { deps } = fakeDeps({ rootDir: fixture.rootDir });
    await runCli(["ingest", "photos", "--index", "demo"], deps);
    const code = await runCli(["search", "cats", "--index", "demo", "--backend", "postgres"], deps);
    expect(code).toBe(1);
  });

  it("exits 1 on a non-positive-integer -k", async () => {
    const { deps } = fakeDeps({ rootDir: fixture.rootDir });
    await runCli(["ingest", "photos", "--index", "demo"], deps);
    const code = await runCli(["search", "cats", "--index", "demo", "-k", "0"], deps);
    expect(code).toBe(1);
  });

  it("ranks cat images above dog images for a cat-text query", async () => {
    const { deps, logger } = fakeDeps({ rootDir: fixture.rootDir });
    await runCli(["ingest", "photos", "--index", "demo"], deps);
    logger.logLines.length = 0;
    const code = await runCli(["search", "a photo of a cat", "--index", "demo", "-k", "4"], deps);
    expect(code).toBe(0);
    const lines = logger.logLines.join("\n").split("\n").filter((line) => line.includes(".jpg"));
    const firstCatRank = lines.findIndex((line) => line.includes("cat-"));
    const firstDogRank = lines.findIndex((line) => line.includes("dog-"));
    expect(firstCatRank).toBeGreaterThanOrEqual(0);
    expect(firstCatRank).toBeLessThan(firstDogRank);
  });
});
