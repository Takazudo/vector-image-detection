import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { AUTH_COOKIE_NAME } from "./auth-gate";
import { MODEL_CONFIG, type RuntimeSettings } from "./config";
import type { ReadinessCheck, ReadinessCheckName, ReadinessResponse } from "./contracts/api";
import type { PlatformProviders } from "./providers";
import { configurationReadiness, deepReadiness } from "./readiness";

/** From wrangler.test.jsonc's OPERATOR_PREFLIGHT_TOKEN var. */
const OPERATOR_TOKEN = "worker-test-only";
/** AUTH_PASS_COOKIE is resolved from vitest.worker.config.ts, which sets this literal. */
const GATE_COOKIE = `${AUTH_COOKIE_NAME}=worker-test-only`;

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

  // Vectorize V2's describe() reports `dimensions` at the top level and returns
  // no `config` object at all. Every fake in this file used to return only the
  // V1 shape, so reaching into `.config` typechecked, passed the suite, and threw
  // a TypeError against the real production binding — surfacing as an opaque
  // "vectorize binding check failed" that took a live debugging session to find.
  // `healthyBindings()` now returns the V2 shape by default; this test pins the
  // shape explicitly so the regression stays covered even if the default drifts.
  it("accepts the Vectorize V2 describe() shape, which has no config object", async () => {
    const v2 = {
      ...healthyBindings(),
      vectorize: {
        describe: async () => ({
          dimensions: MODEL_CONFIG.vectorDimensions,
          vectorCount: 0,
          processedUpToDatetime: 0,
          processedUpToMutation: 0,
        }),
      },
    };

    const response = await deepReadiness(providers(enabledProduction, v2));

    expect(failedChecks(response)).toEqual([]);
    expect(checkOf(response, "vectorize").status).toBe("pass");
  });

  it("fails a V2 index whose dimensions drift, even without a config object", async () => {
    const v2Drifted = {
      ...healthyBindings(),
      vectorize: {
        describe: async () => ({ dimensions: 1_024, vectorCount: 0 }),
      },
    };

    const response = await deepReadiness(providers(enabledProduction, v2Drifted));

    expect(failedChecks(response)).toEqual(["vectorize"]);
  });

  it("reports the thrown cause when a binding check throws", async () => {
    const exploding = {
      ...healthyBindings(),
      vectorize: {
        describe: async () => {
          throw new TypeError("Cannot use 'in' operator to search for 'dimensions' in undefined");
        },
      },
    };

    const response = await deepReadiness(providers(enabledProduction, exploding));

    expect(failedChecks(response)).toEqual(["vectorize"]);
    // The cause must reach the operator — a bare "binding check failed" is what
    // made the original failure undiagnosable from the CI log alone.
    expect(checkOf(response, "vectorize").detail).toContain("in' operator");
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
        dimensions: MODEL_CONFIG.vectorDimensions,
        vectorCount: 0,
        processedUpToDatetime: 0,
        processedUpToMutation: 0,
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
