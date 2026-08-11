import { defineConfig, devices } from "@playwright/test";

// Runs against the real Worker (wrangler dev, wrangler.e2e.jsonc) instead of the
// `zfb preview` static server + route-mocked API used by playwright.config.ts. Kept as
// a separate config, NOT merged into a single config with two `webServer` entries:
// Playwright boots every `webServer` entry on any invocation regardless of which
// projects are selected, so a combined config would start `wrangler dev` and apply D1
// migrations even for a mocked-only run.
//
// Fixed by default (distinct from the mocked suite's 4173 and wrangler dev's own default
// 8787), but reads the same E2E_WORKER_PORT override scripts/e2e-worker.mjs supports, so
// the two never drift out of sync.
// https, not http: the demo's session cookie is `Secure`, so a spec-compliant
// cookie jar drops it over plain http and every post-login assertion fails with
// a 401 that looks like a broken auth gate. scripts/e2e-worker.mjs runs wrangler
// with --local-protocol https for the same reason; the cert it generates is
// self-signed, hence ignoreHTTPSErrors below.
const port = process.env.E2E_WORKER_PORT ?? "8799";
const baseURL = `https://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e-worker",
  outputDir: "./test-results/playwright-worker",
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    // wrangler dev mints a self-signed cert for --local-protocol https.
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "worker", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/e2e-worker.mjs",
    // Every route (including "/") is auth-gated and returns 401 unauthenticated.
    // Playwright's URL readiness check accepts any status in [200, 404), so this
    // still detects "server is up" without needing a cookie.
    url: `${baseURL}/`,
    ignoreHTTPSErrors: true,
    stdout: "pipe",
  },
});
