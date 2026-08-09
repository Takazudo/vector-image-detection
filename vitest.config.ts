import { defineConfig } from "vitest/config";

// Workspace-wide test runner: only packages/** and apps/** own test files.
// scripts/** is explicitly excluded — it belongs to a separate, parallel
// setup (scripts/fetch-samples.mjs + node:test) and must never be picked up
// here to avoid collisions.
export default defineConfig({
  test: {
    include: ["packages/**/*.{test,spec}.{ts,tsx}", "apps/**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "scripts/**",
      "apps/demo/src/**/*.worker.test.ts",
      "apps/demo/src/**/*.dom.test.{ts,tsx}",
    ],
  },
});
