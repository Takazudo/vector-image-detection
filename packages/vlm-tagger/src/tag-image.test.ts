import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tagOneImage } from "./tag-image.js";

vi.mock("./downscale.js", () => ({
  downscaleImage: vi
    .fn()
    .mockResolvedValue({ base64: "ZmFrZS1pbWFnZQ==", mediaType: "image/jpeg" }),
}));
vi.mock("./sleep.js", () => ({ sleep: vi.fn().mockResolvedValue(undefined) }));

import { downscaleImage } from "./downscale.js";
import { sleep } from "./sleep.js";

const VALID_JSON = '{"tags": ["box", "cardboard"], "caption": "A cardboard box."}';

function textResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

function fakeClient() {
  return { messages: { create: vi.fn() } } as unknown as Anthropic;
}

const OPTS = { model: "claude-haiku-4-5", language: "en" as const, retryDelayMs: 50 };

describe("tagOneImage", () => {
  beforeEach(() => {
    vi.mocked(downscaleImage).mockClear();
    vi.mocked(sleep).mockClear();
  });

  it("downscales the source image before sending it", async () => {
    const client = fakeClient();
    vi.mocked(client.messages.create).mockResolvedValue(textResponse(VALID_JSON) as never);

    await tagOneImage(client, "/photos/box.jpg", OPTS);

    expect(downscaleImage).toHaveBeenCalledWith("/photos/box.jpg");
  });

  it("sends the downscaled image data and the system prompt in the request", async () => {
    const client = fakeClient();
    vi.mocked(client.messages.create).mockResolvedValue(textResponse(VALID_JSON) as never);

    await tagOneImage(client, "/photos/box.jpg", OPTS);

    expect(client.messages.create).toHaveBeenCalledTimes(1);
    const call = vi.mocked(client.messages.create).mock
      .calls[0]![0] as Anthropic.MessageCreateParams;
    expect(call.model).toBe("claude-haiku-4-5");
    expect(typeof call.system).toBe("string");
    expect(call.system as string).toMatch(/JSON object/);

    const userMessage = call.messages[0]!;
    const content = userMessage.content as Anthropic.ContentBlockParam[];
    const imageBlock = content.find((block) => block.type === "image") as Anthropic.ImageBlockParam;
    expect(imageBlock.source).toEqual({
      type: "base64",
      media_type: "image/jpeg",
      data: "ZmFrZS1pbWFnZQ==",
    });
  });

  it("returns a successful result parsed from a well-formed response", async () => {
    const client = fakeClient();
    vi.mocked(client.messages.create).mockResolvedValue(textResponse(VALID_JSON) as never);

    const result = await tagOneImage(client, "/photos/box.jpg", OPTS);

    expect(result).toEqual({
      imagePath: "/photos/box.jpg",
      ok: true,
      tags: ["box", "cardboard"],
      caption: "A cardboard box.",
    });
  });

  it("writes tags/caption/readableText in Japanese when language is 'ja'", async () => {
    const client = fakeClient();
    vi.mocked(client.messages.create).mockResolvedValue(textResponse(VALID_JSON) as never);

    await tagOneImage(client, "/photos/box.jpg", { ...OPTS, language: "ja" });

    const call = vi.mocked(client.messages.create).mock
      .calls[0]![0] as Anthropic.MessageCreateParams;
    expect(call.system as string).toMatch(/Japanese/);
  });

  it("retries once on malformed JSON and succeeds on the second attempt", async () => {
    const client = fakeClient();
    vi.mocked(client.messages.create)
      .mockResolvedValueOnce(textResponse("Sorry, I can't format that as JSON.") as never)
      .mockResolvedValueOnce(textResponse(VALID_JSON) as never);

    const result = await tagOneImage(client, "/photos/box.jpg", OPTS);

    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
  });

  it("collects a failure (not throws) when JSON is malformed on both attempts", async () => {
    const client = fakeClient();
    vi.mocked(client.messages.create).mockResolvedValue(textResponse("still not json") as never);

    const result = await tagOneImage(client, "/photos/box.jpg", OPTS);

    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      imagePath: "/photos/box.jpg",
      ok: false,
      error: expect.stringContaining("no JSON object found"),
    });
  });

  it("retries once on a 429 rate-limit error and succeeds on the second attempt", async () => {
    const client = fakeClient();
    const rateLimitError = new Anthropic.RateLimitError(
      429,
      { error: { type: "rate_limit_error", message: "rate limited" } },
      "rate limited",
      new Headers(),
    );
    vi.mocked(client.messages.create)
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce(textResponse(VALID_JSON) as never);

    const result = await tagOneImage(client, "/photos/box.jpg", OPTS);

    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(OPTS.retryDelayMs);
    expect(result.ok).toBe(true);
  });

  it("retries once on a 5xx server error and succeeds on the second attempt", async () => {
    const client = fakeClient();
    const serverError = new Anthropic.InternalServerError(
      500,
      { error: { type: "api_error", message: "internal error" } },
      "internal error",
      new Headers(),
    );
    vi.mocked(client.messages.create)
      .mockRejectedValueOnce(serverError)
      .mockResolvedValueOnce(textResponse(VALID_JSON) as never);

    const result = await tagOneImage(client, "/photos/box.jpg", OPTS);

    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
  });

  it("collects a failure when the retryable error persists after the one retry", async () => {
    const client = fakeClient();
    const rateLimitError = new Anthropic.RateLimitError(
      429,
      { error: { type: "rate_limit_error", message: "rate limited" } },
      "rate limited",
      new Headers(),
    );
    vi.mocked(client.messages.create).mockRejectedValue(rateLimitError);

    const result = await tagOneImage(client, "/photos/box.jpg", OPTS);

    // Exactly one retry — not an unbounded retry loop.
    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
  });

  it("does not retry a non-retryable API error (e.g. 401 authentication)", async () => {
    const client = fakeClient();
    const authError = new Anthropic.AuthenticationError(
      401,
      { error: { type: "authentication_error", message: "invalid key" } },
      "invalid key",
      new Headers(),
    );
    vi.mocked(client.messages.create).mockRejectedValue(authError);

    const result = await tagOneImage(client, "/photos/box.jpg", OPTS);

    expect(client.messages.create).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      imagePath: "/photos/box.jpg",
      ok: false,
      error: expect.stringContaining("invalid key"),
    });
  });

  it("collects a failure when the response has no text content block", async () => {
    const client = fakeClient();
    vi.mocked(client.messages.create).mockResolvedValue({ content: [] } as never);

    const result = await tagOneImage(client, "/photos/box.jpg", OPTS);

    expect(result.ok).toBe(false);
  });
});
