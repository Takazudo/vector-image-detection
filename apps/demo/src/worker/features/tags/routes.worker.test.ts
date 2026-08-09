import { describe, expect, it } from "vitest";

import type { PlatformProviders } from "../../providers";
import type { ApiRequestContext } from "../../router";
import { humanTagRoutes } from "./routes";

describe("human-tag write guards", () => {
  it("rejects writes while the public switch is off", async () => {
    const response = await humanTagRoutes[0].handle(request(), context(false, { success: true }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "public_writes_disabled" },
    });
  });

  it("rejects cross-origin and rate-limited writes before D1 mutation", async () => {
    const crossOrigin = await humanTagRoutes[0].handle(request("https://attacker.test"), context());
    expect(crossOrigin.status).toBe(403);
    await expect(crossOrigin.json()).resolves.toMatchObject({
      error: { code: "cross_origin_write" },
    });

    const rateLimited = await humanTagRoutes[0].handle(
      request("https://example.test"),
      context(true, { success: false }),
    );
    expect(rateLimited.status).toBe(429);
    await expect(rateLimited.json()).resolves.toMatchObject({ error: { code: "rate_limited" } });
  });
});

function request(origin = "https://example.test"): Request {
  return new Request("https://example.test/api/v1/human-tags/bulk", {
    method: "POST",
    headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify({
      version: "v1",
      action: "attach",
      photoIds: ["photo-1"],
      humanTagNames: ["cat"],
    }),
  });
}

function context(
  writesEnabled = true,
  rateLimitOutcome: { success: boolean } = { success: true },
): ApiRequestContext {
  const providers: PlatformProviders = {
    assets: Object.create(null),
    database: Object.create(null),
    photos: Object.create(null),
    queue: Object.create(null),
    deadLetterQueue: Object.create(null),
    ai: Object.create(null),
    vectorize: Object.create(null),
    rateLimit: { limit: () => Promise.resolve(rateLimitOutcome) },
    clock: { now: () => new Date("2026-01-01T00:00:00.000Z") },
    ids: { generate: () => "request-1" },
    operator: {
      settings: () => ({
        environment: "ci",
        publicWritesEnabled: writesEnabled,
        acknowledgeAnonymousPublicWrites: false,
        acknowledgeRetainedImageMetadata: false,
        acknowledgeReactivePurgeOnlyModeration: false,
      }),
    },
  };
  return {
    env: Object.create(null),
    execution: Object.create(null),
    providers,
    params: {},
  };
}
