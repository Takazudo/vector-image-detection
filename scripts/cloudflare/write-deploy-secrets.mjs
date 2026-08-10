#!/usr/bin/env node

import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The payload for `wrangler deploy --secrets-file`, which uploads secrets with
 * the version itself. `wrangler secret put` cannot be used here: it mutates an
 * already-live Worker, so it fails outright on a first-ever deploy and
 * otherwise leaves a window in which the Worker serves without its gate.
 *
 * `OPERATOR_PREFLIGHT_TOKEN` is the deployed-side name for the same value CI
 * holds as `DEMO_PREFLIGHT_TOKEN`; the Worker reads it in `router.ts`.
 */
export function buildDeploySecrets(environment) {
  const password = environment.AUTH_PASSWORD ?? "";
  const cookieValue = environment.AUTH_PASS_COOKIE ?? "";
  if (password.length === 0 || cookieValue.length === 0) {
    throw new Error(
      "AUTH_PASSWORD and AUTH_PASS_COOKIE are both required; a production Worker without them refuses to serve.",
    );
  }
  const secrets = { AUTH_PASSWORD: password, AUTH_PASS_COOKIE: cookieValue };
  const operatorToken = environment.OPERATOR_PREFLIGHT_TOKEN ?? "";
  if (operatorToken.length > 0) secrets.OPERATOR_PREFLIGHT_TOKEN = operatorToken;
  return secrets;
}

/**
 * Refuses any destination inside the checkout, so a secrets file can never be
 * committed, archived as an artifact, or swept up by a build glob.
 */
export function resolveSecretsTarget(target) {
  if (!target) throw new Error("A secrets file path argument is required.");
  const resolved = path.resolve(target);
  const relative = path.relative(REPOSITORY_ROOT, resolved);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    throw new Error("The deployment secrets file must be written outside the repository.");
  }
  return resolved;
}

/** Logs only secret *names* and a count — never a value. */
export async function writeDeploySecrets({
  environment = process.env,
  target,
  log = console.log,
  warn = console.warn,
} = {}) {
  const resolved = resolveSecretsTarget(target);
  const secrets = buildDeploySecrets(environment);
  const names = Object.keys(secrets);
  if (!names.includes("OPERATOR_PREFLIGHT_TOKEN")) {
    warn(
      "::warning::OPERATOR_PREFLIGHT_TOKEN was not supplied, so it is omitted from this deployment. The readiness preflight answers 401 unless the deployed Worker already carries it.",
    );
  }
  await writeFile(resolved, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
  await chmod(resolved, 0o600);
  log(`Staged ${names.length} deployment secrets (${names.join(", ")}) at ${resolved}.`);
  return names;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  writeDeploySecrets({ target: process.argv[2] }).catch((error) => {
    console.error(`Staging Cloudflare deployment secrets failed: ${error.message}`);
    process.exitCode = 1;
  });
}
