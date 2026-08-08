import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@anthropic-ai/sdk", () => {
  const AnthropicMock = vi.fn().mockImplementation(function (
    this: unknown,
    config: { apiKey: string },
  ) {
    Object.assign(this as object, { __apiKey: config.apiKey });
  });
  return { default: AnthropicMock };
});
vi.mock("./tag-image.js", () => ({ tagOneImage: vi.fn() }));
vi.mock("./sleep.js", () => ({ sleep: vi.fn().mockResolvedValue(undefined) }));

import { tagOneImage } from "./tag-image.js";
import { sleep } from "./sleep.js";
import { DEFAULT_MODEL, vlmTag } from "./vlm-tag.js";
import type { VlmTagResult } from "./types.js";

function ok(imagePath: string): VlmTagResult {
  return { imagePath, ok: true, tags: ["box"], caption: "A box." };
}
function fail(imagePath: string): VlmTagResult {
  return { imagePath, ok: false, error: "boom" };
}

const ORIGINAL_ENV = process.env.ANTHROPIC_API_KEY;

describe("vlmTag", () => {
  beforeEach(() => {
    vi.mocked(Anthropic).mockClear();
    vi.mocked(tagOneImage).mockClear();
    vi.mocked(sleep).mockClear();
    vi.mocked(tagOneImage).mockImplementation(async (_client, imagePath) => ok(imagePath));
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = ORIGINAL_ENV;
  });

  it("throws a clear error when no API key is available (opts or env)", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(vlmTag(["/a.jpg"])).rejects.toThrow(/ANTHROPIC_API_KEY/);
    expect(tagOneImage).not.toHaveBeenCalled();
  });

  it("uses opts.apiKey over the environment variable", async () => {
    process.env.ANTHROPIC_API_KEY = "env-key";
    await vlmTag(["/a.jpg"], { apiKey: "explicit-key" });
    expect(Anthropic).toHaveBeenCalledWith({ apiKey: "explicit-key" });
  });

  it("falls back to process.env.ANTHROPIC_API_KEY when opts.apiKey is absent", async () => {
    process.env.ANTHROPIC_API_KEY = "env-key";
    await vlmTag(["/a.jpg"]);
    expect(Anthropic).toHaveBeenCalledWith({ apiKey: "env-key" });
  });

  it("defaults to claude-haiku-4-5 and English, passed through to each tag call", async () => {
    process.env.ANTHROPIC_API_KEY = "env-key";
    await vlmTag(["/a.jpg"]);
    expect(tagOneImage).toHaveBeenCalledWith(
      expect.anything(),
      "/a.jpg",
      expect.objectContaining({ model: DEFAULT_MODEL, language: "en" }),
    );
  });

  it("passes an explicit model and language through to each tag call", async () => {
    process.env.ANTHROPIC_API_KEY = "env-key";
    await vlmTag(["/a.jpg"], { model: "claude-opus-5", language: "ja" });
    expect(tagOneImage).toHaveBeenCalledWith(
      expect.anything(),
      "/a.jpg",
      expect.objectContaining({ model: "claude-opus-5", language: "ja" }),
    );
  });

  it("tags images sequentially with a small delay between requests, not before the first", async () => {
    process.env.ANTHROPIC_API_KEY = "env-key";
    await vlmTag(["/a.jpg", "/b.jpg", "/c.jpg"]);

    expect(tagOneImage).toHaveBeenCalledTimes(3);
    // 3 images -> 2 gaps between them, no delay before the first request
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("returns results in input order, in a single tag call per image", async () => {
    process.env.ANTHROPIC_API_KEY = "env-key";
    const results = await vlmTag(["/a.jpg", "/b.jpg"]);
    expect(results.map((r) => r.imagePath)).toEqual(["/a.jpg", "/b.jpg"]);
  });

  it("collects a per-image failure without aborting the rest of the batch", async () => {
    process.env.ANTHROPIC_API_KEY = "env-key";
    vi.mocked(tagOneImage).mockImplementation(async (_client, imagePath) =>
      imagePath === "/b.jpg" ? fail(imagePath) : ok(imagePath),
    );

    const results = await vlmTag(["/a.jpg", "/b.jpg", "/c.jpg"]);

    expect(results).toEqual([
      { imagePath: "/a.jpg", ok: true, tags: ["box"], caption: "A box." },
      { imagePath: "/b.jpg", ok: false, error: "boom" },
      { imagePath: "/c.jpg", ok: true, tags: ["box"], caption: "A box." },
    ]);
    expect(tagOneImage).toHaveBeenCalledTimes(3);
  });

  it("returns an empty array for an empty input without calling the API", async () => {
    process.env.ANTHROPIC_API_KEY = "env-key";
    const results = await vlmTag([]);
    expect(results).toEqual([]);
    expect(tagOneImage).not.toHaveBeenCalled();
  });
});
