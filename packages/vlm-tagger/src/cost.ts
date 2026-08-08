export interface CostEstimate {
  perImageUsd: [number, number];
  totalUsd: [number, number];
}

// Ballpark [low, high] USD per image for a single ≤1024px-long-edge photo
// tagged with this package's short system+user prompt and small JSON
// response, at Haiku 4.5's $1/$5-per-MTok list price. Verify current
// pricing at https://platform.claude.com/docs/en/about-claude/pricing
// before relying on this for real budgeting — it's a demo-grade ballpark,
// not a quote, and Anthropic pricing changes over time.
const HAIKU_COST_PER_IMAGE_USD: [number, number] = [0.002, 0.004];

const MODEL_COST_PER_IMAGE_USD: Record<string, [number, number]> = {
  "claude-haiku-4-5": HAIKU_COST_PER_IMAGE_USD,
};

/**
 * Ballpark [low, high] USD cost for tagging `imageCount` images. Unknown
 * models fall back to the Haiku ballpark (the documented default model for
 * this package) rather than throwing.
 */
export function estimateCost(imageCount: number, model = "claude-haiku-4-5"): CostEstimate {
  if (!Number.isFinite(imageCount) || imageCount < 0) {
    throw new Error(
      `estimateCost: imageCount must be a non-negative finite number, got ${imageCount}`,
    );
  }

  const perImageUsd = MODEL_COST_PER_IMAGE_USD[model] ?? HAIKU_COST_PER_IMAGE_USD;
  return {
    perImageUsd,
    totalUsd: [perImageUsd[0] * imageCount, perImageUsd[1] * imageCount],
  };
}
