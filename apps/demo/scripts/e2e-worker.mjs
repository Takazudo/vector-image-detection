#!/usr/bin/env node

// Boots the real `wrangler dev` Worker for the credential-free e2e harness
// (wrangler.e2e.jsonc has no `ai`/`vectorize`, so this needs no Cloudflare
// token). Modeled on dev-worker.mjs, but with fixed test secrets instead of a
// root-.env load, and a dedicated local state directory that is wiped before
// every run — stale D1/R2 state from a previous run must never make a later
// upload assertion pass or fail spuriously.
//
// wrangler.e2e.jsonc declares AUTH_PASSWORD/AUTH_PASS_COOKIE under
// `secrets.required`. Wrangler only ever resolves secret binding values from
// .dev.vars, .env, or process.env (never from a literal config key), so fixed
// test values are set here.

import { rmSync } from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const persistDir = path.resolve(appDir, ".wrangler-e2e-state");

// Distinct from the mocked suite's baseURL (4173) and wrangler dev's own
// default (8787), so neither collides with this harness.
const port = process.env.E2E_WORKER_PORT ?? "8799";

const env = {
  ...process.env,
  AUTH_PASSWORD: process.env.AUTH_PASSWORD ?? "e2e-worker-test-password",
  AUTH_PASS_COOKIE: process.env.AUTH_PASS_COOKIE ?? "e2e-worker-test-cookie",
};

rmSync(persistDir, { recursive: true, force: true });

const migrate = spawnSync(
  "wrangler",
  [
    "d1",
    "migrations",
    "apply",
    "vector-image-detection-demo-e2e",
    "--local",
    "--config",
    "wrangler.e2e.jsonc",
    "--persist-to",
    persistDir,
  ],
  { cwd: appDir, env, stdio: "inherit" },
);

if (migrate.status !== 0) {
  console.error("Failed to apply D1 migrations for the e2e Worker.");
  process.exit(migrate.status ?? 1);
}

const child = spawn(
  "wrangler",
  [
    "dev",
    "--config",
    "wrangler.e2e.jsonc",
    // HTTPS, not HTTP. The demo's session cookie carries `Secure`, so any
    // spec-compliant client refuses to send it back over plain http — the
    // gate would appear to reject a correct login. curl only papers over this
    // when the Cookie header is set by hand; a real cookie jar (Playwright's,
    // or `curl -c/-b`) does not. Wrangler generates a self-signed cert here,
    // which is why the Playwright config sets `ignoreHTTPSErrors`.
    "--local-protocol",
    "https",
    "--port",
    port,
    "--persist-to",
    persistDir,
    ...process.argv.slice(2),
  ],
  {
    cwd: appDir,
    env,
    stdio: "inherit",
  },
);

child.on("error", (error) => {
  console.error(`Failed to start wrangler dev: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code ?? 0;
  }
});
