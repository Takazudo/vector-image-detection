import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EXPECTED_MODELS,
  REQUIRED_ACKNOWLEDGEMENTS,
  REQUIRED_READINESS_CHECKS,
  demoPreflight,
  validateAcknowledgements,
} from "./demo-preflight.mjs";

const acknowledged = { ...REQUIRED_ACKNOWLEDGEMENTS };

test("demo deployment remains an explicit repository-variable opt-in", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/deploy-cloudflare.yml", import.meta.url),
    "utf8",
  );
  assert.match(
    workflow,
    /deploy-demo:\n\s+#[^\n]+\n\s+#[^\n]+\n\s+if: \$\{\{ vars\.DEMO_DEPLOYMENT_ENABLED == 'true' \}\}/,
  );
});

test("demo preflight requires every explicit risk acknowledgement", () => {
  assert.throws(() => validateAcknowledgements({}), /ACK_ANONYMOUS_PUBLIC_WRITES/);
  assert.doesNotThrow(() => validateAcknowledgements(acknowledged));
});

test("demo preflight accepts only fully passing production readiness", async () => {
  let authorization;
  await demoPreflight({
    environment: {
      ...acknowledged,
      DEMO_PREFLIGHT_URL: "https://demo.example.test",
      DEMO_PREFLIGHT_TOKEN: "secret-value",
    },
    fetchImpl: async (_url, init) => {
      authorization = init.headers.authorization;
      return Response.json({
        status: "ready",
        environment: "production",
        publicWritesEnabled: true,
        models: EXPECTED_MODELS,
        checks: REQUIRED_READINESS_CHECKS.map((name) => ({ name, status: "pass", detail: "ok" })),
      });
    },
  });
  assert.equal(authorization, "Bearer secret-value");
});

test("demo preflight rejects a readiness response without every required binding check", async () => {
  await assert.rejects(
    demoPreflight({
      environment: {
        ...acknowledged,
        DEMO_PREFLIGHT_URL: "https://demo.example.test",
        DEMO_PREFLIGHT_TOKEN: "secret-value",
      },
      fetchImpl: async () =>
        Response.json({
          status: "ready",
          environment: "production",
          publicWritesEnabled: true,
          models: EXPECTED_MODELS,
          checks: [{ name: "configuration", status: "pass", detail: "ok" }],
        }),
    }),
    // `d1` is the first entry after `configuration` in REQUIRED_READINESS_CHECKS;
    // a new required check must be appended rather than inserted ahead of it.
    /missing required checks: d1/,
  );
});

test("demo preflight refuses a production deployment with no auth gate check", async () => {
  await assert.rejects(
    demoPreflight({
      environment: {
        ...acknowledged,
        DEMO_PREFLIGHT_URL: "https://demo.example.test",
        DEMO_PREFLIGHT_TOKEN: "secret-value",
      },
      fetchImpl: async () =>
        Response.json({
          status: "ready",
          environment: "production",
          publicWritesEnabled: true,
          models: EXPECTED_MODELS,
          checks: REQUIRED_READINESS_CHECKS.filter((name) => name !== "auth_gate").map((name) => ({
            name,
            status: "pass",
            detail: "ok",
          })),
        }),
    }),
    /missing required checks: auth_gate/,
  );
});

test("demo preflight refuses a production deployment whose auth gate check failed", async () => {
  await assert.rejects(
    demoPreflight({
      environment: {
        ...acknowledged,
        DEMO_PREFLIGHT_URL: "https://demo.example.test",
        DEMO_PREFLIGHT_TOKEN: "secret-value",
      },
      // Top-level "ready" with a failing check cannot come from the Worker, whose
      // status is derived — the fixture proves preflight re-checks it regardless.
      fetchImpl: async () =>
        Response.json({
          status: "ready",
          environment: "production",
          publicWritesEnabled: true,
          models: EXPECTED_MODELS,
          checks: REQUIRED_READINESS_CHECKS.map((name) => ({
            name,
            status: name === "auth_gate" ? "fail" : "pass",
            detail: "ok",
          })),
        }),
    }),
    /failed or deferred/,
  );
});

test("demo preflight rejects deferred checks", async () => {
  await assert.rejects(
    demoPreflight({
      environment: {
        ...acknowledged,
        DEMO_PREFLIGHT_URL: "https://demo.example.test",
        DEMO_PREFLIGHT_TOKEN: "secret-value",
      },
      fetchImpl: async () =>
        Response.json({
          status: "ready",
          environment: "production",
          publicWritesEnabled: true,
          models: EXPECTED_MODELS,
          checks: REQUIRED_READINESS_CHECKS.map((name) => ({
            name,
            status: name === "d1" ? "deferred" : "pass",
            detail: "not checked",
          })),
        }),
    }),
    /failed or deferred/,
  );
});
