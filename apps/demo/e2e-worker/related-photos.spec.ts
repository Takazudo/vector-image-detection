import { expect, test } from "@playwright/test";
import { login } from "./support.ts";

// This credential-free e2e config deliberately omits the AI/Vectorize bindings
// (see wrangler.e2e.jsonc), so a photo uploaded here can never reach `ready` —
// enrichment never runs, and getRelatedPhotos only serves `state = 'ready'`
// photos. A real neighbours list therefore cannot be exercised against this
// Worker; it is verified instead by the worker-pool service tests (V2-shaped
// Vectorize fake) and the documented operator smoke check against the real
// deployed index (see apps/docs). This spec covers only what this environment
// *can* prove for real: the route's auth gate and its response envelope shape.

test("unauthenticated GET .../related is gated behind the same password wall as every other route", async ({
  request,
}) => {
  const response = await request.get("/api/v1/photos/does-not-exist/related");
  expect(response.status()).toBe(401);
});

test.describe("authenticated", () => {
  test.beforeEach(async ({ request }) => {
    await login(request);
  });

  test("reports not_found in the standard error envelope for an unknown photo id", async ({
    request,
  }) => {
    const response = await request.get("/api/v1/photos/does-not-exist/related");
    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: "not_found" } });
    expect(typeof body.error.message).toBe("string");
  });

  test("rejects a limit outside the documented page-size bound before touching Vectorize", async ({
    request,
  }) => {
    // maximumPageSize is 100 (config.ts) — 101 must fail validation rather than
    // ever reach getRelatedPhotos, so this proves the guard runs even against a
    // photo id that does not exist.
    const response = await request.get("/api/v1/photos/does-not-exist/related?limit=101");
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: "invalid_related_photos_request" } });
  });
});
