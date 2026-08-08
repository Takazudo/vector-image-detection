import Anthropic from "@anthropic-ai/sdk";
import { downscaleImage } from "./downscale.js";
import { VlmParseError, parseVlmResponse } from "./parse.js";
import { buildSystemPrompt } from "./prompt.js";
import { sleep } from "./sleep.js";
import type { VlmLanguage, VlmTagResult } from "./types.js";

export interface TagOneImageOptions {
  model: string;
  language: VlmLanguage;
  retryDelayMs: number;
}

function isRetryableApiError(error: unknown): boolean {
  return (
    error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError
  );
}

async function requestTagText(
  client: Anthropic,
  model: string,
  systemPrompt: string,
  image: { base64: string; mediaType: "image/jpeg" },
): Promise<string> {
  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: image.mediaType, data: image.base64 },
          },
          { type: "text", text: "Tag this item photo." },
        ],
      },
    ],
  });

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  if (!textBlock) {
    throw new VlmParseError("model response contained no text content block");
  }
  return textBlock.text;
}

// Retries exactly once on 429/5xx, per spec — this is a "collect failures,
// don't throw" pipeline, so a lone transient blip shouldn't sink an image,
// but an agent-style backoff loop would be overkill for a demo package.
async function requestTagTextWithApiRetry(
  client: Anthropic,
  model: string,
  systemPrompt: string,
  image: { base64: string; mediaType: "image/jpeg" },
  retryDelayMs: number,
): Promise<string> {
  try {
    return await requestTagText(client, model, systemPrompt, image);
  } catch (error) {
    if (!isRetryableApiError(error)) throw error;
    await sleep(retryDelayMs);
    return await requestTagText(client, model, systemPrompt, image);
  }
}

export async function tagOneImage(
  client: Anthropic,
  imagePath: string,
  opts: TagOneImageOptions,
): Promise<VlmTagResult> {
  try {
    const image = await downscaleImage(imagePath);
    const systemPrompt = buildSystemPrompt({ language: opts.language });

    const text = await requestTagTextWithApiRetry(
      client,
      opts.model,
      systemPrompt,
      image,
      opts.retryDelayMs,
    );

    let parsed;
    try {
      parsed = parseVlmResponse(text);
    } catch (parseError) {
      if (!(parseError instanceof VlmParseError)) throw parseError;
      // One retry on malformed JSON: re-ask from scratch rather than trying
      // to repair the broken text ourselves.
      const retryText = await requestTagTextWithApiRetry(
        client,
        opts.model,
        systemPrompt,
        image,
        opts.retryDelayMs,
      );
      parsed = parseVlmResponse(retryText);
    }

    return {
      imagePath,
      ok: true,
      tags: parsed.tags,
      caption: parsed.caption,
      ...(parsed.readableText !== undefined ? { readableText: parsed.readableText } : {}),
    };
  } catch (error) {
    return {
      imagePath,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
