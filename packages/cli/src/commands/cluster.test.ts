import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../run.js";
import { createTmpPhotoFixture, fakeDeps, type TmpPhotoFixture } from "../test-support/fixture.js";

describe("vis cluster", () => {
  let fixture: TmpPhotoFixture;

  beforeEach(async () => {
    fixture = await createTmpPhotoFixture({ catCount: 3, dogCount: 3 });
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("exits 1 when both --k and --auto are passed", async () => {
    const { deps } = fakeDeps({ rootDir: fixture.rootDir });
    await runCli(["ingest", "photos", "--index", "demo"], deps);
    const code = await runCli(["cluster", "--k", "2", "--auto", "--index", "demo"], deps);
    expect(code).toBe(1);
  });

  it("exits 1 when --k exceeds the item count", async () => {
    const { deps } = fakeDeps({ rootDir: fixture.rootDir });
    await runCli(["ingest", "photos", "--index", "demo"], deps);
    const code = await runCli(["cluster", "--k", "50", "--index", "demo"], deps);
    expect(code).toBe(1);
  });

  it("--auto separates cats from dogs into two clean groups", async () => {
    const { deps, logger } = fakeDeps({ rootDir: fixture.rootDir });
    await runCli(["ingest", "photos", "--index", "demo"], deps);
    logger.logLines.length = 0;
    const code = await runCli(["cluster", "--auto", "--index", "demo", "--json"], deps);
    expect(code).toBe(0);
    const groups = JSON.parse(logger.logLines.join("\n")) as { cluster: number; files: string[] }[];
    const allFiles = groups.flatMap((g) => g.files);
    expect(allFiles).toHaveLength(6);
    for (const group of groups) {
      const allCat = group.files.every((f) => f.startsWith("cat"));
      const allDog = group.files.every((f) => f.startsWith("dog"));
      expect(allCat || allDog).toBe(true);
    }
  });

  it("human-readable output lists group headers and member files", async () => {
    const { deps, logger } = fakeDeps({ rootDir: fixture.rootDir });
    await runCli(["ingest", "photos", "--index", "demo"], deps);
    logger.logLines.length = 0;
    const code = await runCli(["cluster", "--k", "2", "--index", "demo"], deps);
    expect(code).toBe(0);
    const output = logger.logLines.join("\n");
    expect(output).toMatch(/2 exploratory group/);
    expect(output).toMatch(/Group \d+/);
  });
});
