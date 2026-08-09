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

  it("registers photo and tag/search route collections in the hosted registry", async () => {
    const response = await exports.default.fetch("https://example.test/api/v1/search?query=cat");

    // A missing search binding may fail at execution, but a registered route
    // must never regress to the central router's generic 404 response.
    expect(response.status).not.toBe(404);
  });
});
