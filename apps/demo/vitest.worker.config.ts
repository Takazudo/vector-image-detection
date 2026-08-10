import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// wrangler.test.jsonc declares AUTH_PASSWORD/AUTH_PASS_COOKIE under `secrets.required`.
// Wrangler only ever resolves secret binding values from .dev.vars, .env, or process.env
// (never from a literal config key), so worker-test-only defaults are set here to let
// worker tests exercise the auth gate without requiring a local .dev.vars file.
process.env.AUTH_PASSWORD ??= "worker-test-only";
process.env.AUTH_PASS_COOKIE ??= "worker-test-only";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.test.jsonc" },
    }),
  ],
  test: {
    include: ["src/worker/**/*.worker.test.ts"],
    // Vitest's 5s default is measured against a cold workerd isolate: the first test in
    // each file waits on module import, which dominates this suite (~50s of import time
    // across 16 files starting in parallel). At 5s the first test in a file failed on
    // roughly half of full-suite runs while passing in isolation.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
