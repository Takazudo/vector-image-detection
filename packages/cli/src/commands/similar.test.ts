import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../run.js";
import { createTmpPhotoFixture, fakeDeps, type TmpPhotoFixture } from "../test-support/fixture.js";

describe("vis similar", () => {
  let fixture: TmpPhotoFixture;

  beforeEach(async () => {
    fixture = await createTmpPhotoFixture({ catCount: 2, dogCount: 2 });
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("excludes the exemplar itself when given a known item id", async () => {
    const { deps, logger } = fakeDeps({ rootDir: fixture.rootDir });
    await runCli(["ingest", "photos", "--index", "demo"], deps);
    logger.logLines.length = 0;
    const code = await runCli(["similar", "cat-1.jpg", "--index", "demo", "-k", "3"], deps);
    expect(code).toBe(0);
    const output = logger.logLines.join("\n");
    expect(output).not.toContain("cat-1.jpg");
    expect(output).toContain("cat-2.jpg");
  });

  it("embeds an external image path fresh when the argument isn't a known item id", async () => {
    const { deps, logger } = fakeDeps({ rootDir: fixture.rootDir });
    await runCli(["ingest", "photos", "--index", "demo"], deps);
    logger.logLines.length = 0;
    // "cat-external.jpg" is not in the index; FakeEmbedder still seeds it to
    // the "cat" keyword off its filename, so it should rank the cat items highest.
    const externalPath = path.join(fixture.photosDir, "cat-1.jpg"); // reuse real bytes under a name outside the index
    const code = await runCli(["similar", externalPath, "--index", "demo", "-k", "2"], deps);
    expect(code).toBe(0);
    const output = logger.logLines.join("\n");
    expect(output).toContain("cat-1.jpg");
    expect(output).not.toContain("dog-");
  });
});
