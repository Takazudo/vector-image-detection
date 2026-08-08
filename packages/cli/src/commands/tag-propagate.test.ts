import { promises as fs } from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../run.js";
import { createTmpPhotoFixture, fakeDeps, type TmpPhotoFixture } from "../test-support/fixture.js";

describe("vis tag propagate", () => {
  let fixture: TmpPhotoFixture;
  let metaPath: string;

  beforeEach(async () => {
    fixture = await createTmpPhotoFixture({ catCount: 3, dogCount: 2 });
    metaPath = path.join(fixture.rootDir, "data", "indexes", "demo", "meta.json");
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("exits 2 (runtime error) for an unknown exemplar id", async () => {
    const { deps } = fakeDeps({ rootDir: fixture.rootDir });
    await runCli(["ingest", "photos", "--index", "demo"], deps);
    const code = await runCli(
      ["tag", "propagate", "no-such-item.jpg", "favorite", "--index", "demo", "--yes"],
      deps,
    );
    expect(code).toBe(2);
  });

  it("--yes accepts every proposal without prompting", async () => {
    const { deps } = fakeDeps({ rootDir: fixture.rootDir, confirm: async () => false });
    await runCli(["ingest", "photos", "--index", "demo"], deps);
    const code = await runCli(
      [
        "tag",
        "propagate",
        "cat-1.jpg",
        "favorite",
        "--threshold",
        "0.5",
        "--index",
        "demo",
        "--yes",
      ],
      deps,
    );
    expect(code).toBe(0);
    const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
    const cat2 = meta.items.find((item: { file: string }) => item.file === "cat-2.jpg");
    expect(cat2.tags).toContain("favorite");
  });

  it("without --yes, only proposals the confirm callback accepts get persisted", async () => {
    const asked: string[] = [];
    const { deps } = fakeDeps({
      rootDir: fixture.rootDir,
      confirm: async (question) => {
        asked.push(question);
        return question.includes("cat-2.jpg");
      },
    });
    await runCli(["ingest", "photos", "--index", "demo"], deps);
    const code = await runCli(
      ["tag", "propagate", "cat-1.jpg", "favorite", "--threshold", "0.5", "--index", "demo"],
      deps,
    );
    expect(code).toBe(0);
    expect(asked.length).toBeGreaterThan(0);

    const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
    const cat2 = meta.items.find((item: { file: string }) => item.file === "cat-2.jpg");
    const cat3 = meta.items.find((item: { file: string }) => item.file === "cat-3.jpg");
    expect(cat2.tags).toContain("favorite");
    expect(cat3.tags).not.toContain("favorite");
  });

  it("prints a message and writes nothing when no proposal clears the threshold", async () => {
    const { deps, logger } = fakeDeps({ rootDir: fixture.rootDir });
    await runCli(["ingest", "photos", "--index", "demo"], deps);
    logger.logLines.length = 0;
    const code = await runCli(
      [
        "tag",
        "propagate",
        "cat-1.jpg",
        "favorite",
        "--threshold",
        "0.999",
        "--index",
        "demo",
        "--yes",
      ],
      deps,
    );
    expect(code).toBe(0);
    expect(logger.logLines.some((line) => line.includes("no proposals"))).toBe(true);
  });
});
