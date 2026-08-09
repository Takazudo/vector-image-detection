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
  const failed = body.checks?.filter(({ status }) => status !== "pass") ?? ["missing checks"];
  if (failed.length > 0) {
    throw new Error("Production readiness contains failed or deferred binding checks.");
  }
}

export async function demoPreflight({ environment = process.env, fetchImpl = fetch } = {}) {
  validateAcknowledgements(environment);
  const url = environment.DEMO_PREFLIGHT_URL;
  const token = environment.DEMO_PREFLIGHT_TOKEN;
  if (!url || !token) {
    throw new Error("DEMO_PREFLIGHT_URL and DEMO_PREFLIGHT_TOKEN are required.");
  }

  const endpoint = new URL("/api/v1/operator/readiness", url);
  const response = await fetchImpl(endpoint, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Production Worker readiness request failed (${response.status}).`);
  }
  validateReadiness(await response.json());
  console.log("Cloudflare demo deployment preflight passed.");
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  demoPreflight().catch((error) => {
    console.error(`Cloudflare demo deployment preflight failed: ${error.message}`);
    process.exitCode = 1;
  });
}
