import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results/playwright",
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "mobile-light", use: { ...devices["Pixel 7"], colorScheme: "light" } },
    { name: "mobile-dark", use: { ...devices["Pixel 7"], colorScheme: "dark" } },
    { name: "desktop-light", use: { ...devices["Desktop Chrome"], colorScheme: "light" } },
    { name: "desktop-dark", use: { ...devices["Desktop Chrome"], colorScheme: "dark" } },
  ],
  webServer: {
    command: "pnpm run preview --host 127.0.0.1 --port 4173",
    wait: { stdout: /ready on http:\/\/127\.0\.0\.1:4173/ },
    stdout: "pipe",
  },
});
