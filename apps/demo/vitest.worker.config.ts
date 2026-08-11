import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

import { WORKER_TEST_TIMEOUT_MS } from "./test-support/worker-timeouts.ts";

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
    // each file waits on that isolate's module import, worst observed 1.9s on CI. This
    // ceiling covers that, not the integration tests — `*.integration.worker.test.ts`
    // set their own, far longer timeout at the call site. See test-support/worker-timeouts.ts
    // for the CI measurements both numbers come from.
    testTimeout: WORKER_TEST_TIMEOUT_MS,
    hookTimeout: WORKER_TEST_TIMEOUT_MS,
  },
});
