import { expect, test } from "@playwright/test";

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
