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
  },
});
