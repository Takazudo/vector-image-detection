import path from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRequestContext } from "@playwright/test";

// Mirrors scripts/e2e-worker.mjs's own fallback: it passes AUTH_PASSWORD straight through
// when the environment already sets one, and only falls back to this fixed test-only value
// otherwise. Reading the same override here keeps this helper working if a developer or CI
// job runs the harness with its own AUTH_PASSWORD.
export const AUTH_PASSWORD = process.env.AUTH_PASSWORD ?? "e2e-worker-test-password";

// Matches wrangler.e2e.jsonc's vars.OPERATOR_PREFLIGHT_TOKEN.
export const OPERATOR_TOKEN = "e2e-worker-test-only";

// Small (6 KB, 256x170), deterministic, already-committed JPEG from the demo's seed
// thumbnail bundle — reused here instead of adding a new binary fixture.
export const JPEG_FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/bundle/thumbs/pets/cat-ragdoll-1.jpg.jpg",
);

/**
 * Logs in through the real `/__auth` form and leaves the session cookie on `request`'s
 * cookie jar for subsequent calls in the same test. Goes through the actual endpoint
 * rather than setting the cookie directly, so a login-flow regression would fail here
 * too instead of only in auth-gate.spec.ts.
 *
 * `maxRedirects: 0` stops short of following the 302 to `/` — the redirected request
 * would resend the original POST verb (per fetch redirect semantics) straight into the
 * static-asset handler, which doesn't accept POST. The context still records the
 * `Set-Cookie` from this response regardless of whether the redirect is followed, which
 * is all a login helper needs.
 */
export async function login(request: APIRequestContext): Promise<void> {
  const response = await request.post("/__auth", {
    form: { password: AUTH_PASSWORD },
    maxRedirects: 0,
  });
  if (response.status() !== 302) {
    throw new Error(`e2e-worker login failed unexpectedly: ${response.status()}`);
  }
}
