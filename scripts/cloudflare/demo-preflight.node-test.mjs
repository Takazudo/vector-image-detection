import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPECTED_MODELS,
  REQUIRED_ACKNOWLEDGEMENTS,
  REQUIRED_READINESS_CHECKS,
  demoPreflight,
  validateAcknowledgements,
} from "./demo-preflight.mjs";

const acknowledged = { ...REQUIRED_ACKNOWLEDGEMENTS };

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
    /missing required checks: d1/,
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
