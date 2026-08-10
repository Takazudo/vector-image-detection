import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { MODEL_CONFIG, type RuntimeSettings } from "./config";
import type { ReadinessCheck, ReadinessCheckName, ReadinessResponse } from "./contracts/api";
import type { PlatformProviders } from "./providers";
import { configurationReadiness, deepReadiness } from "./readiness";

// wrangler.test.jsonc resolves the AUTH_PASSWORD / AUTH_PASS_COOKIE secrets from
// vitest.worker.config.ts, which sets both to this literal for tests.
const OPERATOR_TOKEN = "worker-test-only";
const GATE_COOKIE = "vid_demo_pass=worker-test-only";

/** Kept in sync with EXPECTED_MIGRATION in readiness.ts. */
const APPLIED_MIGRATION = "0001_public_photo_library.sql";

const acknowledged = {
  acknowledgeAnonymousPublicWrites: true,
  acknowledgeRetainedImageMetadata: true,
  acknowledgeReactivePurgeOnlyModeration: true,
};

const enabledProduction: Partial<RuntimeSettings> = {
  environment: "production",
  publicWritesEnabled: true,
  ...acknowledged,
  authGateConfigured: true,
};

describe("public configuration readiness", () => {
  it("reports ready for a correctly configured read-only production deployment", () => {
    const response = configurationReadiness(providers({ environment: "production" }));

    expect(response.status).toBe("ready");
    expect(failedChecks(response)).toEqual([]);
    expect(checkOf(response, "auth_gate").status).toBe("pass");
  });

  it("returns not_ready when public writes are live without the acknowledgements", () => {
    // The documented footgun: writes are already accepted at the API while the
    // router turns this body into a 503 and App.tsx's catch branch forces the
    // SPA to render read-only.
    const response = configurationReadiness(
      providers({ environment: "ci", publicWritesEnabled: true }),
    );

    expect(response.status).toBe("not_ready");
    expect(failedChecks(response)).toEqual(["operator_acknowledgements"]);
  });

  it("fails production with public writes on and no access gate configured", () => {
    const response = configurationReadiness(
      providers({ ...enabledProduction, authGateConfigured: false }),
    );

    expect(response.status).toBe("not_ready");
    expect(failedChecks(response)).toEqual(["auth_gate"]);
  });

  it("passes the same production deployment once the access gate is configured", () => {
    const response = configurationReadiness(providers(enabledProduction));

    expect(response.status).toBe("ready");
    expect(checkOf(response, "auth_gate").status).toBe("pass");
  });

  it("tolerates an inert access gate outside production", () => {
    const response = configurationReadiness(
      providers({ ...enabledProduction, environment: "ci", authGateConfigured: false }),
    );

    expect(response.status).toBe("ready");
    expect(checkOf(response, "auth_gate").status).toBe("pass");
  });

  it("never discloses which access-gate secret is missing", () => {
    const configured = checkOf(configurationReadiness(providers(enabledProduction)), "auth_gate");
    const missing = checkOf(
      configurationReadiness(providers({ ...enabledProduction, authGateConfigured: false })),
      "auth_gate",
    );

    // Only `status` may differ: this endpoint is unauthenticated, so a detail
    // that varied with the gate's internals would leak the deployment's setup.
    expect(missing.detail).toBe(configured.detail);
    expect(missing.detail).not.toMatch(/auth_|password|cookie|secret/i);
  });
});

describe("deep operator readiness", () => {
  it("reports ready for a fully enabled production deployment", async () => {
    const response = await deepReadiness(providers(enabledProduction));

    expect(response.status).toBe("ready");
    expect(failedChecks(response)).toEqual([]);
  });

  it("fails the access gate when public writes are live but the gate is unconfigured", async () => {
    const response = await deepReadiness(
      providers({ ...enabledProduction, authGateConfigured: false }),
    );

    expect(response.status).toBe("not_ready");
    expect(failedChecks(response)).toEqual(["auth_gate"]);
  });

  it("holds the release gate shut on the very settings the public checks accept", async () => {
    // Same-named checks, deliberately non-equivalent predicates: the public set
    // is green for a correct read-only deployment, while the deep set is green
    // only in the fully-enabled production end state.
    const readOnlyCi = providers({ environment: "ci" });

    const publicResponse = configurationReadiness(readOnlyCi);
    expect(publicResponse.status).toBe("ready");
    expect(checkOf(publicResponse, "configuration").status).toBe("pass");
    expect(checkOf(publicResponse, "operator_acknowledgements").status).toBe("pass");
    expect(checkOf(publicResponse, "auth_gate").status).toBe("pass");

    const deepResponse = await deepReadiness(readOnlyCi);
    expect(deepResponse.status).toBe("not_ready");
    expect(checkOf(deepResponse, "configuration").status).toBe("fail");
    expect(checkOf(deepResponse, "operator_acknowledgements").status).toBe("fail");
    expect(checkOf(deepResponse, "auth_gate").status).toBe("fail");
  });

  it("fails a binding whose configuration drifts from the pinned model contract", async () => {
    const drifted = {
      ...healthyBindings(),
      vectorize: {
        describe: async () => ({ config: { dimensions: 1_024, metric: "euclidean" } }),
      },
    };

    const response = await deepReadiness(providers(enabledProduction, drifted));

    expect(failedChecks(response)).toEqual(["vectorize"]);
  });
});

describe("readiness wiring", () => {
  it("derives the access-gate boolean from the real Env on the public endpoint", async () => {
    const response = await exports.default.fetch(
      new Request("https://example.test/api/v1/readiness", { headers: { cookie: GATE_COOKIE } }),
    );
    const body = await response.json<ReadinessResponse>();

    // The test environment supplies both gate secrets, so the plumbing from
    // readRuntimeSettings through to the response must report a pass.
    expect(response.status).toBe(200);
    expect(checkOf(body, "auth_gate").status).toBe("pass");
  });

  it("answers 503 whenever the readiness body is not_ready", async () => {
    const response = await exports.default.fetch(
      new Request("https://example.test/api/v1/operator/readiness", {
        headers: { authorization: `Bearer ${OPERATOR_TOKEN}` },
      }),
    );
    const body = await response.json<ReadinessResponse>();

    // The test environment is ci with public writes off, so the deep gate stays shut.
    expect(response.status).toBe(503);
    expect(body.status).toBe("not_ready");
    expect(checkOf(body, "auth_gate").status).toBe("fail");
  });
});

function providers(
  overrides: Partial<RuntimeSettings> = {},
  bindings: object = healthyBindings(),
): PlatformProviders {
  const settings: RuntimeSettings = {
    environment: "local",
    publicWritesEnabled: false,
    acknowledgeAnonymousPublicWrites: false,
    acknowledgeRetainedImageMetadata: false,
    acknowledgeReactivePurgeOnlyModeration: false,
    authGateConfigured: false,
    ...overrides,
  };
  return {
    ...bindings,
    operator: { settings: () => settings },
  } as unknown as PlatformProviders;
}

/** Every binding answering exactly what deepReadiness expects, so a test can spoil one. */
function healthyBindings() {
  return {
    database: {
      prepare: (statement: string) => ({
        first: async () =>
          statement.includes("d1_migrations") ? { name: APPLIED_MIGRATION } : { ok: 1 },
        all: async () => ({
          results: [
            { key: "schema_version", value: "1" },
            { key: "vision_model_id", value: MODEL_CONFIG.vision },
            { key: "embedding_model_id", value: MODEL_CONFIG.embedding },
            { key: "vector_dimensions", value: String(MODEL_CONFIG.vectorDimensions) },
            { key: "vector_metric", value: MODEL_CONFIG.vectorMetric },
          ],
        }),
      }),
    },
    photos: { head: async () => null },
    queue: { metrics: async () => ({ messages: 0 }) },
    deadLetterQueue: { metrics: async () => ({ messages: 0 }) },
    ai: { run: async () => ({}) },
    vectorize: {
      describe: async () => ({
        config: {
          dimensions: MODEL_CONFIG.vectorDimensions,
          metric: MODEL_CONFIG.vectorMetric,
        },
      }),
    },
    rateLimit: { limit: async () => ({ success: true }) },
  };
}

function checkOf(response: ReadinessResponse, name: ReadinessCheckName): ReadinessCheck {
  const found = response.checks.find((entry) => entry.name === name);
  if (!found) throw new Error(`readiness response is missing the ${name} check`);
  return found;
}

function failedChecks(response: ReadinessResponse): ReadinessCheckName[] {
  return response.checks.filter(({ status }) => status === "fail").map(({ name }) => name);
}
