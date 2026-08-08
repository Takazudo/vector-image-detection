import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { vlmTag } from "./vlm-tag.js";

// Real Claude API call — costs money and needs network. Never runs just
// because ANTHROPIC_API_KEY happens to be set in the environment: opt in
// explicitly with RUN_VLM_LIVE=1 as well.
const RUN_LIVE = process.env.RUN_VLM_LIVE === "1" && Boolean(process.env.ANTHROPIC_API_KEY);

describe.skipIf(!RUN_LIVE)("vlmTag (live Claude API)", () => {
  let tempDir: string;
  let imagePath: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "vlm-tagger-live-"));
    imagePath = path.join(tempDir, "swatch.jpg");
    const jpeg = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 180, g: 60, b: 60 } },
    })
      .jpeg()
      .toBuffer();
    await writeFile(imagePath, jpeg);
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("tags a real image via the Claude API and returns a well-formed result", async () => {
    const [result] = await vlmTag([imagePath]);
    expect(result).toBeDefined();
    if (!result || !result.ok) {
      throw new Error(`expected a successful tag result, got: ${JSON.stringify(result)}`);
    }
    expect(result.tags.length).toBeGreaterThan(0);
    expect(typeof result.caption).toBe("string");
    expect(result.caption.length).toBeGreaterThan(0);
  }, 60_000);
});
