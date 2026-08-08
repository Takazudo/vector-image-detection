import Anthropic from "@anthropic-ai/sdk";
import { sleep } from "./sleep.js";
import { tagOneImage } from "./tag-image.js";
import type { VlmTagOptions, VlmTagResult } from "./types.js";

export const DEFAULT_MODEL = "claude-haiku-4-5";

// Small courtesy delay between sequential requests to the same API key —
// not a rate-limit fix (that's the 429 retry below), just spacing bursts out.
const REQUEST_DELAY_MS = 300;
// Backoff before the one retry on a transient 429/5xx.
const RETRY_DELAY_MS = 1000;

/**
 * Tags each image in `imagePaths` via the Claude API (Haiku 4.5 by default —
 * the cheap tier is the point). Requests run sequentially with a small delay
 * between them; a 429/5xx is retried once, and malformed JSON is retried
 * once. Per-image failures are collected in the returned array rather than
 * thrown, so one bad photo doesn't abort the batch.
 */
export async function vlmTag(
  imagePaths: string[],
  opts: VlmTagOptions = {},
): Promise<VlmTagResult[]> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "vlmTag: no Anthropic API key found. Pass { apiKey } or set ANTHROPIC_API_KEY in the environment — vlm-tagger calls the Claude API and images are uploaded to it, so this is required.",
    );
  }

  const client = new Anthropic({ apiKey });
  const model = opts.model ?? DEFAULT_MODEL;
  const language = opts.language ?? "en";

  const results: VlmTagResult[] = [];
  for (let i = 0; i < imagePaths.length; i++) {
    if (i > 0) await sleep(REQUEST_DELAY_MS);
    const imagePath = imagePaths[i]!;
    results.push(
      await tagOneImage(client, imagePath, { model, language, retryDelayMs: RETRY_DELAY_MS }),
    );
  }
  return results;
}
