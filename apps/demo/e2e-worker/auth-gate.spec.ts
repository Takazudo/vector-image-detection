import { expect, test } from "@playwright/test";
import { AUTH_PASSWORD, login } from "./support.ts";

// Runs against the real Worker (see playwright.worker.config.ts), not the mocked static
// server. This is the guard against wrangler.e2e.jsonc silently regressing to an inert
// auth gate: without `secrets.required`, AUTH_PASSWORD/AUTH_PASS_COOKIE would never be
// wired by wrangler, `resolveAuthGateConfig` would return "inert", and every route below
// would 200 with the real SPA instead of challenging for a password. If this test starts
// passing for the wrong reason, it would go green while testing nothing — so it asserts
// the password form is actually present in the 401 body, not just the status code.
test("unauthenticated GET / is gated behind the password form", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(401);
  await expect(page.locator("form[action='/__auth']")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enter" })).toBeVisible();
});

// The gate wraps every route ahead of the `/api/` dispatch (router.ts), not just the
// SPA shell — this is what stops an unauthenticated caller from reaching the public API
// directly while the browser-facing "/" is challenged.
test("unauthenticated GET /api/v1/readiness is gated too", async ({ request }) => {
  const response = await request.get("/api/v1/readiness");
  expect(response.status()).toBe(401);
});

test("POST /__auth with the wrong password is rejected", async ({ request }) => {
  const response = await request.post("/__auth", {
    form: { password: "definitely-not-it" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(401);
});

test("POST /__auth with the correct password redirects and sets the session cookie", async ({
  request,
}) => {
  const response = await request.post("/__auth", {
    form: { password: AUTH_PASSWORD },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(302);
  expect(response.headers().location).toBe("/");
  // Exact attribute set and order mirrors `grantAccess` in auth-gate.ts: HttpOnly/Secure/
  // SameSite=Lax are the actual security posture, not incidental formatting, so this
  // pattern intentionally pins them rather than only checking the cookie name.
  expect(response.headers()["set-cookie"]).toMatch(
    /^vid_demo_pass=[^;]+; Path=\/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax$/,
  );
});

test("GET / passes the gate once the session cookie is set", async ({ request }) => {
  await login(request);
  const response = await request.get("/");
  expect(response.status()).toBe(200);
});
