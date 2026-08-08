# @vector-image-detection/vlm-tagger

Optional "true auto-word-generation" rung: VLM-based photo tagging via the
Claude API (Claude Haiku 4.5 by default). **Node-only** — this package is
isolated from `@vector-image-detection/core` and the demo app so that
`@anthropic-ai/sdk` and Node file-system/image handling never reach
browser-safe code.

## What it does

For each image path, `vlmTag` downscales the photo, sends it to Claude with a
strict JSON-output prompt, and returns tags, an optional readable-text field
(printed part numbers / markings), and a one-line caption. Per-image failures
are collected in the result array rather than thrown, so one bad photo
doesn't abort a batch.

```ts
import { vlmTag, estimateCost } from "@vector-image-detection/vlm-tagger";

const results = await vlmTag(["./photos/box-1.jpg", "./photos/box-2.jpg"], {
  language: "en", // or "ja" — Claude writes tags/captions directly in Japanese
});

for (const result of results) {
  if (result.ok) {
    console.log(result.imagePath, result.tags, result.caption);
  } else {
    console.warn(result.imagePath, "failed:", result.error);
  }
}

console.log(estimateCost(results.length));
// { perImageUsd: [0.002, 0.004], totalUsd: [0.004, 0.008] } for 2 images (ballpark)
```

## Setup

Requires `ANTHROPIC_API_KEY` in the environment, or pass `{ apiKey }`
explicitly. `vlmTag` throws a clear error up front if neither is set — it
never silently skips tagging or falls back to a mock.

## Privacy warning

**Every image passed to `vlmTag` is uploaded to Anthropic's API.** Do not run
this on confidential, proprietary, or personally identifiable photos without
explicit approval — the images leave your machine and are subject to
Anthropic's API data-handling terms, not this repo's.

## Cost

Ballpark, not a quote — verify current pricing before budgeting a real run.

| Model                      |        Input |       Output | Per-image (approx, Aug 2026) |
| -------------------------- | -----------: | -----------: | ---------------------------: |
| Claude Haiku 4.5 (default) | $1.00 / MTok | $5.00 / MTok |              $0.002 – $0.004 |

A downscaled (≤1024px long edge) photo plus this package's short tagging
prompt and small JSON response is cheap relative to Haiku's per-token price,
which is why Haiku is the default — this package is as much a cost demo as a
tagging demo. `estimateCost(imageCount, model?)` returns a `[low, high]` USD
range for a batch, using the same ballpark constants.

For a **real production workload** (not a one-off demo run), switch to the
[Message Batches API](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
— same requests, same model, **50% off list price**, at the cost of
asynchronous (up to 24h) turnaround. This package calls the synchronous
Messages API for the interactive demo case; batching is not implemented here.

## Behavior notes

- Images are downscaled to a ≤1024px long edge (via `sharp`) and re-encoded
  as JPEG before upload — keeps token cost predictable, roughly proportional
  to `(width * height) / 750`.
- The JSON contract is enforced by prompting, not the API's structured-output
  feature: malformed responses are parsed defensively and retried **once**
  before that image is recorded as a failure.
- Requests run sequentially with a small delay between images; a 429
  (rate limited) or 5xx (server error) is retried once.
- `packages/core` and `apps/demo` do not import this package — its
  dependencies (`@anthropic-ai/sdk`, `sharp`) are Node-only and never reach
  browser code.

## Testing

Unit tests mock the Anthropic SDK entirely — no network calls, no API key
required. A separate live test (`vlm-tag.live.test.ts`) makes one real API
call and is skipped unless both `RUN_VLM_LIVE=1` and `ANTHROPIC_API_KEY` are
set:

```sh
RUN_VLM_LIVE=1 ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @vector-image-detection/vlm-tagger exec vitest run
```
