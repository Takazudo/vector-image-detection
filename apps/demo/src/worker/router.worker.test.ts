import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("Worker routing", () => {
  it("serves a non-secret health contract through /api", async () => {
    const response = await exports.default.fetch("https://example.test/api/v1/health");
    const body = await response.json<{ status: string; service: string }>();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      status: "ok",
      service: "vector-image-detection-demo",
    });
  });
});
