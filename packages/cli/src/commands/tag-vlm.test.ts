import { promises as fs } from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../run.js";
import { createTmpPhotoFixture, fakeDeps, type TmpPhotoFixture } from "../test-support/fixture.js";

describe("vis tag vlm", () => {
  let fixture: TmpPhotoFixture;
  let metaPath: string;

  beforeEach(async () => {
    fixture = await createTmpPhotoFixture({ catCount: 2, dogCount: 1 });
    metaPath = path.join(fixture.rootDir, "data", "indexes", "demo", "meta.json");
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("refuses without --confirm-upload, but still prints the cost estimate and privacy warning first", async () => {
    const vlmTag = vi.fn();
    const { deps, logger } = fakeDeps({
      rootDir: fixture.rootDir,
      vlmTag,
      estimateCost: (imageCount) => ({ perImageUsd: [0.002, 0.004], totalUsd: [0.002 * imageCount, 0.004 * imageCount] }),
    });
    await runCli(["ingest", "photos", "--index", "demo"], deps);
    logger.logLines.length = 0;

    const code = await runCli(["tag", "vlm", "cat-1.jpg", "--index", "demo"], deps);
    expect(code).toBe(1);
    expect(vlmTag).not.toHaveBeenCalled();
    expect(logger.logLines.some((line) => line.includes("estimated cost"))).toBe(true);
    expect(logger.logLines.some((line) => /privacy warning/i.test(line))).toBe(true);
  });

  it("rejects an unsupported --language before ever calling vlmTag", async () => {
    const vlmTag = vi.fn();
    const { deps } = fakeDeps({ rootDir: fixture.rootDir, vlmTag });
    await runCli(["ingest", "photos", "--index", "demo"], deps);
    const code = await runCli(
      ["tag", "vlm", "cat-1.jpg", "--index", "demo", "--language", "fr", "--confirm-upload"],
      deps,
    );
    expect(code).toBe(1);
    expect(vlmTag).not.toHaveBeenCalled();
  });

  it("with --confirm-upload, uploads thumbnails and persists only confirmed proposals", async () => {
    const vlmTag = vi.fn(async (imagePaths: string[]) =>
      imagePaths.map((imagePath) => ({
        imagePath,
        ok: true as const,
        tags: ["whiskers", "indoor"],
        caption: "A cat.",
      })),
    );
    const confirm = vi.fn(async () => true);
    const { deps } = fakeDeps({ rootDir: fixture.rootDir, vlmTag, confirm });
    await runCli(["ingest", "photos", "--index", "demo"], deps);

    const code = await runCli(
      ["tag", "vlm", "cat-1.jpg", "--index", "demo", "--confirm-upload"],
      deps,
    );
    expect(code).toBe(0);
    expect(vlmTag).toHaveBeenCalledTimes(1);
    const [imagePaths] = vlmTag.mock.calls[0]!;
    expect(imagePaths[0]).toContain(path.join("thumbs", "cat-1.jpg"));

    const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
    const cat1 = meta.items.find((item: { file: string }) => item.file === "cat-1.jpg");
    expect(cat1.tags).toEqual(expect.arrayContaining(["whiskers", "indoor"]));
  });

  it("does not persist a proposal the confirm callback rejects", async () => {
    const vlmTag = vi.fn(async (imagePaths: string[]) =>
      imagePaths.map((imagePath) => ({ imagePath, ok: true as const, tags: ["x"], caption: "c" })),
    );
    const { deps } = fakeDeps({ rootDir: fixture.rootDir, vlmTag, confirm: async () => false });
    await runCli(["ingest", "photos", "--index", "demo"], deps);

    const code = await runCli(
      ["tag", "vlm", "cat-1.jpg", "--index", "demo", "--confirm-upload"],
      deps,
    );
    expect(code).toBe(0);
    const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
    const cat1 = meta.items.find((item: { file: string }) => item.file === "cat-1.jpg");
    expect(cat1.tags).toEqual([]);
  });

  it("rejects an unknown item id as a usage error", async () => {
    const { deps } = fakeDeps({ rootDir: fixture.rootDir, vlmTag: vi.fn() });
    await runCli(["ingest", "photos", "--index", "demo"], deps);
    const code = await runCli(
      ["tag", "vlm", "no-such.jpg", "--index", "demo", "--confirm-upload"],
      deps,
    );
    expect(code).toBe(1);
  });
});
