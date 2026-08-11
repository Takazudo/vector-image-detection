#!/usr/bin/env node

import { EXPECTED_MODELS } from "./demo-preflight.mjs";

const API_BASE = "https://api.cloudflare.com/client/v4";
const DEFAULT_TIMEOUT_MS = 10_000;

// The exact permission name in Cloudflare's custom-token permission picker
// (Account resources -> Vectorize -> Read). Verified against Cloudflare's API
// reference for `GET /accounts/{account_id}/vectorize/v2/indexes/{index_name}`
// while this script was written; NOT verified against the deploy token itself
// — see docs/enable-public-uploads-runbook.md for why.
export const REQUIRED_TOKEN_PERMISSION = "Vectorize Read";

/** Missing/invalid credentials, or a token that lacks the required permission. */
export class VectorizeIndexCredentialError extends Error {}

/** A Cloudflare API incident or transport failure — safe to retry. */
export class VectorizeIndexTransportError extends Error {}

/** The index is reachable and answered, but its dimensions or metric drifted. Never retry. */
export class VectorizeIndexMismatchError extends Error {}

function requiredEnvironment(environment) {
  const accountId = environment.CLOUDFLARE_ACCOUNT_ID;
  const token = environment.CLOUDFLARE_API_TOKEN;
  const indexName = environment.DEMO_VECTORIZE_INDEX_NAME;
  const missing = [
    ["CLOUDFLARE_ACCOUNT_ID", accountId],
    ["CLOUDFLARE_API_TOKEN", token],
    ["DEMO_VECTORIZE_INDEX_NAME", indexName],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new VectorizeIndexCredentialError(
      `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required to verify the ` +
        `Vectorize index. If CLOUDFLARE_API_TOKEN is set but this still fails, the token is ` +
        `missing the "${REQUIRED_TOKEN_PERMISSION}" permission.`,
    );
  }
  return { accountId, token, indexName };
}

/**
 * Verifies the deployed Vectorize index still matches the pinned embedding
 * model's dimensions and metric. `DEMO_VECTORIZE_INDEX_NAME` is mutable
 * repository configuration — unlike the index itself, which cannot drift once
 * created — so this is the only check that catches an operator re-pointing it
 * at the wrong index. See docs/enable-public-uploads-runbook.md.
 *
 * Throws one of three distinguishable error classes so a CI log (and an
 * operator reading it) never has to guess what kind of failure this was:
 * `VectorizeIndexCredentialError` (fix the token, do not retry),
 * `VectorizeIndexTransportError` (a Cloudflare incident, safe to retry), or
 * `VectorizeIndexMismatchError` (real drift — never retry or downgrade).
 */
export async function assertVectorizeIndex({
  environment = process.env,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  log = console.log,
} = {}) {
  const { accountId, token, indexName } = requiredEnvironment(environment);

  const endpoint = `${API_BASE}/accounts/${accountId}/vectorize/v2/indexes/${encodeURIComponent(indexName)}`;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new VectorizeIndexTransportError(
      `Vectorize index lookup for "${indexName}" could not complete (${error.message}). This ` +
        `looks like a Cloudflare API or network incident, not a configuration problem — safe to retry.`,
    );
  }

  // Checked ahead of body parsing: Cloudflare returns these for a missing or
  // under-scoped token, and that must never be confused with a real mismatch.
  if (response.status === 401 || response.status === 403) {
    throw new VectorizeIndexCredentialError(
      `Vectorize index lookup for "${indexName}" was rejected (HTTP ${response.status}). ` +
        `CLOUDFLARE_API_TOKEN is missing or lacks the "${REQUIRED_TOKEN_PERMISSION}" permission — ` +
        `grant it and re-run. Do not retry as-is.`,
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new VectorizeIndexTransportError(
      `Vectorize index lookup for "${indexName}" returned a non-JSON response (HTTP ` +
        `${response.status}). This looks like a Cloudflare API incident — safe to retry.`,
    );
  }

  if (!response.ok || payload?.success !== true) {
    const errors = Array.isArray(payload?.errors)
      ? payload.errors.map((entry) => `${entry.code}: ${entry.message}`).join("; ")
      : "";
    throw new VectorizeIndexTransportError(
      `Vectorize index lookup for "${indexName}" failed (HTTP ${response.status})` +
        `${errors ? `: ${errors}` : "."} This looks like a Cloudflare API incident — safe to retry.`,
    );
  }

  const config = payload.result?.config;
  const dimensions = config?.dimensions;
  const metric = config?.metric;
  if (dimensions === undefined || metric === undefined) {
    throw new VectorizeIndexTransportError(
      `Vectorize index lookup for "${indexName}" succeeded but the response did not include ` +
        `result.config.dimensions/result.config.metric — an unexpected Cloudflare API shape, not a ` +
        `proven dimensions/metric mismatch. Treat as an incident: investigate before retrying blindly.`,
    );
  }

  const mismatches = [];
  if (dimensions !== EXPECTED_MODELS.vectorDimensions) {
    mismatches.push(`dimensions ${dimensions} (expected ${EXPECTED_MODELS.vectorDimensions})`);
  }
  if (metric !== EXPECTED_MODELS.vectorMetric) {
    mismatches.push(`metric "${metric}" (expected "${EXPECTED_MODELS.vectorMetric}")`);
  }
  if (mismatches.length > 0) {
    throw new VectorizeIndexMismatchError(
      `Vectorize index "${indexName}" does not match the pinned embedding model: ` +
        `${mismatches.join(", ")}. This is real configuration drift, not a transport problem — ` +
        `fix DEMO_VECTORIZE_INDEX_NAME or the index; do not retry or downgrade to a warning.`,
    );
  }

  log(
    `Vectorize index "${indexName}" matches the pinned model: ${dimensions} dimensions, ${metric} metric.`,
  );
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  assertVectorizeIndex().catch((error) => {
    console.error(`Vectorize index assertion failed: ${error.message}`);
    process.exitCode = 1;
  });
}
