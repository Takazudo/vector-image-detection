import { defineConfig, devices } from "@playwright/test";

// Runs against the real Worker (wrangler dev, wrangler.e2e.jsonc) instead of the
// `zfb preview` static server + route-mocked API used by playwright.config.ts. Kept as
// a separate config, NOT merged into a single config with two `webServer` entries:
// Playwright boots every `webServer` entry on any invocation regardless of which
// projects are selected, so a combined config would start `wrangler dev` and apply D1
// migrations even for a mocked-only run.
export default defineConfig({
  testDir: "./e2e-worker",
  outputDir: "./test-results/playwright-worker",
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:8799",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "worker", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/e2e-worker.mjs",
    // Every route (including "/") is auth-gated and returns 401 unauthenticated.
    // Playwright's URL readiness check accepts any status in [200, 404), so this
    // still detects "server is up" without needing a cookie.
    url: "http://127.0.0.1:8799/",
    stdout: "pipe",
  },
});
