#!/usr/bin/env node

export const EXPECTED_MODELS = {
  vision: "@cf/moondream/moondream3.1-9B-A2B",
  embedding: "@cf/google/embeddinggemma-300m",
  vectorDimensions: 768,
  vectorMetric: "cosine",
};

export const REQUIRED_ACKNOWLEDGEMENTS = {
  ACK_ANONYMOUS_PUBLIC_WRITES: "I_ACKNOWLEDGE_ANONYMOUS_PUBLIC_WRITES",
  ACK_RETAINED_IMAGE_METADATA: "I_ACKNOWLEDGE_RETAINED_IMAGE_METADATA",
  ACK_REACTIVE_PURGE_ONLY: "I_ACKNOWLEDGE_REACTIVE_PURGE_ONLY_MODERATION",
};

export const REQUIRED_READINESS_CHECKS = [
  "configuration",
  "d1",
  "migrations",
  "r2",
  "queue",
  "dlq",
  "workers_ai",
  "vectorize",
  "rate_limit",
  "operator_acknowledgements",
  "auth_gate",
];

export function validateAcknowledgements(environment) {
  for (const [name, expected] of Object.entries(REQUIRED_ACKNOWLEDGEMENTS)) {
    if (environment[name] !== expected) {
      throw new Error(`${name} must be explicitly acknowledged for demo deployment.`);
    }
  }
}

export function validateReadiness(body) {
  if (body?.status !== "ready" || body?.environment !== "production") {
    throw new Error("Production Worker readiness did not pass.");
  }
  if (body.publicWritesEnabled !== true) {
    throw new Error("Production public writes are not explicitly enabled.");
  }
  for (const [key, expected] of Object.entries(EXPECTED_MODELS)) {
    if (body.models?.[key] !== expected) {
      throw new Error(`Production readiness reported an unexpected ${key}.`);
    }
  }
  if (!Array.isArray(body.checks)) {
    throw new Error("Production readiness is missing binding checks.");
  }
  const checksByName = new Map(body.checks.map((check) => [check.name, check]));
  const missing = REQUIRED_READINESS_CHECKS.filter((name) => !checksByName.has(name));
  if (missing.length > 0) {
    throw new Error(`Production readiness is missing required checks: ${missing.join(", ")}.`);
  }
  const failed = body.checks.filter(({ status }) => status !== "pass");
  if (failed.length > 0) {
    throw new Error("Production readiness contains failed or deferred binding checks.");
  }
}

/**
 * Transport failures that mean "nothing is deployed at the target yet" rather
 * than "the deployed Worker is unhealthy". Node reports all of them as an
 * opaque `TypeError: fetch failed`; the discriminating code lives on `cause`.
 * A timeout is deliberately absent — a deployed but hung Worker looks the same.
 */
const BOOTSTRAP_NETWORK_CODES = new Set([
  "ENOTFOUND", // the hostname has no DNS record, so no route exists yet
  "EAI_AGAIN", // the resolver could not answer; a new custom domain may still be propagating
  "ECONNREFUSED", // the address resolves but nothing accepts the connection
]);

/**
 * Cloudflare's 1000-series edge errors are produced before any Worker runs, so
 * they also mean "nothing is routed here". 530 is the status Cloudflare pairs
 * with 1001/1016; the numeric code itself only appears in the error page body.
 */
const CLOUDFLARE_EDGE_ERROR_PATTERN = /\bError 10\d\d\b/;

const MAXIMUM_CAUSE_DEPTH = 8;

/** Walks the `cause` chain that `undici` wraps around the real syscall error. */
export function transportErrorCode(error) {
  let current = error;
  for (let depth = 0; current && depth < MAXIMUM_CAUSE_DEPTH; depth += 1) {
    if (typeof current.code === "string") return current.code;
    current = current.cause;
  }
  return undefined;
}

/**
 * Returns why the target counts as "not deployed yet", or `undefined` when the
 * response proves a Worker is answering. A 401, a 404, or any 2xx belongs to
 * the second group: something is deployed and it is misbehaving.
 */
export function bootstrapResponseReason(status, body) {
  if (status === 530) {
    return "Cloudflare answered 530, so no Worker is routed to the target yet";
  }
  if (status >= 500 && CLOUDFLARE_EDGE_ERROR_PATTERN.test(body)) {
    return `Cloudflare answered a 1000-series edge error (HTTP ${status}), so no Worker is routed to the target yet`;
  }
  return undefined;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

async function readReadinessBody(response) {
  try {
    return await response.json();
  } catch {
    throw new Error("Production readiness did not return a JSON body.");
  }
}

/**
 * Resolves to `{ status: "passed" }`, or `{ status: "bootstrap" }` when the
 * target is provably not deployed yet and `DEMO_PREFLIGHT_ALLOW_BOOTSTRAP` lets
 * that pass. Every other failure still throws.
 *
 * Retries cover only the not-deployed-yet class, so a failing readiness body is
 * reported on the first attempt and never waited out.
 */
export async function demoPreflight({
  environment = process.env,
  fetchImpl = fetch,
  log = console.log,
  warn = console.warn,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  validateAcknowledgements(environment);
  const url = environment.DEMO_PREFLIGHT_URL;
  const token = environment.DEMO_PREFLIGHT_TOKEN;
  if (!url || !token) {
    throw new Error("DEMO_PREFLIGHT_URL and DEMO_PREFLIGHT_TOKEN are required.");
  }
  const allowBootstrap = environment.DEMO_PREFLIGHT_ALLOW_BOOTSTRAP === "true";
  const attempts = positiveInteger(environment.DEMO_PREFLIGHT_ATTEMPTS, 1);
  const retryDelayMs = nonNegativeInteger(environment.DEMO_PREFLIGHT_RETRY_DELAY_MS, 15_000);

  const endpoint = new URL("/api/v1/operator/readiness", url);
  let unreachableReason;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(endpoint, { headers: { authorization: `Bearer ${token}` } });
    } catch (error) {
      const code = transportErrorCode(error);
      if (!BOOTSTRAP_NETWORK_CODES.has(code)) {
        throw new Error(
          `Production Worker readiness request could not complete (${code ?? error.message}).`,
        );
      }
      unreachableReason = `the target did not resolve or refused the connection (${code})`;
    }

    if (response) {
      if (response.ok) {
        validateReadiness(await readReadinessBody(response));
        log("Cloudflare demo deployment preflight passed.");
        return { status: "passed" };
      }
      unreachableReason = bootstrapResponseReason(response.status, await response.text());
      if (!unreachableReason) {
        throw new Error(`Production Worker readiness request failed (${response.status}).`);
      }
    }

    if (attempt < attempts) await sleep(retryDelayMs);
  }

  if (allowBootstrap) {
    warn(
      `::warning::Bootstrap deployment: ${unreachableReason}. The pre-deploy readiness gate is being skipped; the mandatory post-deploy gate still has to pass.`,
    );
    return { status: "bootstrap", reason: unreachableReason };
  }
  throw new Error(`Production Worker readiness is unreachable: ${unreachableReason}.`);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  demoPreflight().catch((error) => {
    console.error(`Cloudflare demo deployment preflight failed: ${error.message}`);
    process.exitCode = 1;
  });
}
