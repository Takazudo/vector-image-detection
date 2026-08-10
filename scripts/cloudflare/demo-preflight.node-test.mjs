import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EXPECTED_MODELS,
  REQUIRED_ACKNOWLEDGEMENTS,
  REQUIRED_READINESS_CHECKS,
  demoPreflight,
  transportErrorCode,
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

// --- bootstrap tolerance -----------------------------------------------------
// The pre-deploy gate interrogates the already-deployed Worker, so before the
// first-ever deploy there is nothing to interrogate. These tests pin the line
// between "no Worker is routed here yet" and "a Worker answered and is broken".

const bootstrapEnvironment = {
  ...acknowledged,
  DEMO_PREFLIGHT_URL: "https://demo.example.test",
  DEMO_PREFLIGHT_TOKEN: "secret-value",
  DEMO_PREFLIGHT_ALLOW_BOOTSTRAP: "true",
};

function transportFailure(code) {
  return async () => {
    throw Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("connect"), { code }),
    });
  };
}

const silent = { log: () => {}, warn: () => {} };

test("a transport error code is read off the wrapped cause", () => {
  assert.equal(
    transportErrorCode(new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } })),
    "ENOTFOUND",
  );
  assert.equal(transportErrorCode(new Error("plain")), undefined);
});

test("a cyclic cause chain cannot hang the classifier", () => {
  const error = new Error("outer");
  error.cause = error;
  assert.equal(transportErrorCode(error), undefined);
});

for (const code of ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"]) {
  test(`${code} counts as "not deployed yet" and only warns under bootstrap`, async () => {
    const warnings = [];
    const result = await demoPreflight({
      environment: bootstrapEnvironment,
      fetchImpl: transportFailure(code),
      log: () => {},
      warn: (message) => warnings.push(message),
    });
    assert.equal(result.status, "bootstrap");
    assert.match(warnings[0], /^::warning::Bootstrap deployment/);
    assert.match(warnings[0], new RegExp(code));
  });
}

test("the same unreachable target hard-fails once bootstrap tolerance is off", async () => {
  await assert.rejects(
    demoPreflight({
      environment: { ...bootstrapEnvironment, DEMO_PREFLIGHT_ALLOW_BOOTSTRAP: "false" },
      fetchImpl: transportFailure("ENOTFOUND"),
      ...silent,
    }),
    /readiness is unreachable/,
  );
});

test("a Cloudflare 1000-series edge error counts as not deployed yet", async () => {
  const result = await demoPreflight({
    environment: bootstrapEnvironment,
    fetchImpl: async () => new Response("<h1>Error 1016</h1>", { status: 523 }),
    ...silent,
  });
  assert.equal(result.status, "bootstrap");
});

test("a bare Cloudflare 530 counts as not deployed yet", async () => {
  const result = await demoPreflight({
    environment: bootstrapEnvironment,
    fetchImpl: async () => new Response("origin unreachable", { status: 530 }),
    ...silent,
  });
  assert.equal(result.status, "bootstrap");
});

test("bootstrap tolerance never excuses a Worker that answered", async () => {
  // 401: the Worker exists and rejected the token. 404/500: it is deployed and
  // broken. A timeout is deliberately ambiguous, so it is not tolerated either.
  for (const status of [401, 403, 404, 500, 502]) {
    await assert.rejects(
      demoPreflight({
        environment: bootstrapEnvironment,
        fetchImpl: async () => new Response("nope", { status }),
        ...silent,
      }),
      new RegExp(`readiness request failed \\(${status}\\)`),
      `HTTP ${status} must not be treated as a bootstrap signal`,
    );
  }
  await assert.rejects(
    demoPreflight({
      environment: bootstrapEnvironment,
      fetchImpl: transportFailure("ETIMEDOUT"),
      ...silent,
    }),
    /could not complete \(ETIMEDOUT\)/,
  );
});

test("bootstrap tolerance never excuses a failing readiness body", async () => {
  await assert.rejects(
    demoPreflight({
      environment: bootstrapEnvironment,
      fetchImpl: async () =>
        Response.json({
          status: "ready",
          environment: "production",
          publicWritesEnabled: false,
          models: EXPECTED_MODELS,
          checks: REQUIRED_READINESS_CHECKS.map((name) => ({ name, status: "pass" })),
        }),
      ...silent,
    }),
    /public writes are not explicitly enabled/,
  );
});

test("a 200 that is not JSON is a deployed-but-broken Worker", async () => {
  await assert.rejects(
    demoPreflight({
      environment: bootstrapEnvironment,
      fetchImpl: async () => new Response("<html>maintenance</html>", { status: 200 }),
      ...silent,
    }),
    /did not return a JSON body/,
  );
});

test("missing preflight configuration is never tolerated as a bootstrap run", async () => {
  await assert.rejects(
    demoPreflight({
      environment: { ...bootstrapEnvironment, DEMO_PREFLIGHT_TOKEN: "" },
      ...silent,
    }),
    /DEMO_PREFLIGHT_URL and DEMO_PREFLIGHT_TOKEN are required/,
  );
});

test("the strict post-deploy gate retries an unresolved target before failing", async () => {
  const delays = [];
  let attempts = 0;
  await demoPreflight({
    environment: {
      ...acknowledged,
      DEMO_PREFLIGHT_URL: "https://demo.example.test",
      DEMO_PREFLIGHT_TOKEN: "secret-value",
      DEMO_PREFLIGHT_ATTEMPTS: "3",
      DEMO_PREFLIGHT_RETRY_DELAY_MS: "40",
    },
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) return new Response("<h1>Error 1001</h1>", { status: 530 });
      return Response.json({
        status: "ready",
        environment: "production",
        publicWritesEnabled: true,
        models: EXPECTED_MODELS,
        checks: REQUIRED_READINESS_CHECKS.map((name) => ({ name, status: "pass" })),
      });
    },
    sleep: async (ms) => delays.push(ms),
    ...silent,
  });
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [40, 40]);
});

test("retries do not wait out a Worker that answered with a bad readiness body", async () => {
  let attempts = 0;
  await assert.rejects(
    demoPreflight({
      environment: {
        ...acknowledged,
        DEMO_PREFLIGHT_URL: "https://demo.example.test",
        DEMO_PREFLIGHT_TOKEN: "secret-value",
        DEMO_PREFLIGHT_ATTEMPTS: "5",
      },
      fetchImpl: async () => {
        attempts += 1;
        return new Response("nope", { status: 500 });
      },
      ...silent,
    }),
    /readiness request failed \(500\)/,
  );
  assert.equal(attempts, 1);
});
