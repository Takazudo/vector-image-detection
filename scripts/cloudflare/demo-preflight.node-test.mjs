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

test("pre-deploy deploys over a deployment that fails the readiness contract", async () => {
  // Pre-deploy interrogates the version being REPLACED. A writes-off deployment
  // is precisely what the release turning writes on has to replace, so blocking
  // here would make the gate refuse the deploy it exists to authorize.
  const warnings = [];
  const result = await demoPreflight({
    environment: bootstrapEnvironment,
    fetchImpl: async () =>
      Response.json({
        status: "ready",
        environment: "production",
        publicWritesEnabled: false,
        models: EXPECTED_MODELS,
        checks: REQUIRED_READINESS_CHECKS.map((name) => ({ name, status: "pass" })),
      }),
    log: () => {},
    warn: (message) => warnings.push(message),
  });

  assert.equal(result.status, "passed");
  assert.equal(result.replacedUnhealthy, true);
  assert.match(warnings.join("\n"), /public writes are not explicitly enabled/);
});

test("the strict post-deploy gate still rejects a failing readiness body", async () => {
  await assert.rejects(
    demoPreflight({
      environment: { ...bootstrapEnvironment, DEMO_PREFLIGHT_ALLOW_BOOTSTRAP: "false" },
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

test("a 200 that is not JSON is bootstrap-tolerated before deploy", async () => {
  // The production hostname can be serving something that predates this JSON
  // API — a stale build whose asset layer answers every /api/* path with the
  // SPA shell. That is "this Worker is not live here yet", not "this Worker is
  // broken", so the pre-deploy gate rolls over it.
  const result = await demoPreflight({
    environment: bootstrapEnvironment,
    fetchImpl: async () => new Response("<html>stale build</html>", { status: 200 }),
    ...silent,
  });

  assert.equal(result.status, "bootstrap");
  assert.match(result.reason, /non-JSON body/);
});

test("a 200 that is not JSON still fails the strict post-deploy gate", async () => {
  await assert.rejects(
    demoPreflight({
      environment: { ...bootstrapEnvironment, DEMO_PREFLIGHT_ALLOW_BOOTSTRAP: "false" },
      fetchImpl: async () => new Response("<html>stale build</html>", { status: 200 }),
      ...silent,
    }),
    /non-JSON body/,
  );
});

test("a failing readiness response explains itself in the error message", async () => {
  // A 503 readiness body carries the check list that explains it. Discarding it
  // is what turned a single failing check into a live debugging session.
  await assert.rejects(
    demoPreflight({
      environment: { ...bootstrapEnvironment, DEMO_PREFLIGHT_ALLOW_BOOTSTRAP: "false" },
      fetchImpl: async () =>
        Response.json(
          {
            status: "not_ready",
            environment: "production",
            publicWritesEnabled: true,
            models: EXPECTED_MODELS,
            checks: [
              { name: "d1", status: "pass" },
              { name: "vectorize", status: "fail", detail: "vectorize binding check failed: boom" },
            ],
          },
          { status: 503 },
        ),
      ...silent,
    }),
    (error) => {
      assert.match(error.message, /readiness request failed \(503\)/);
      assert.match(error.message, /vectorize \(fail\)/);
      assert.match(error.message, /boom/);
      assert.doesNotMatch(error.message, /d1/); // passing checks are not noise
      return true;
    },
  );
});

test("pre-deploy warns with the same detail instead of blocking the remedy", async () => {
  // The exact failure that deadlocked the first real rollout: production was
  // unhealthy, the fix was on main, and the gate refused to ship it *because*
  // production was unhealthy. Pre-deploy must report and continue.
  const warnings = [];
  const result = await demoPreflight({
    environment: bootstrapEnvironment,
    fetchImpl: async () =>
      Response.json(
        {
          status: "not_ready",
          environment: "production",
          publicWritesEnabled: true,
          models: EXPECTED_MODELS,
          checks: [
            { name: "d1", status: "pass" },
            { name: "vectorize", status: "fail", detail: "vectorize binding check failed: boom" },
          ],
        },
        { status: 503 },
      ),
    log: () => {},
    warn: (message) => warnings.push(message),
  });

  assert.equal(result.status, "passed");
  assert.equal(result.replacedUnhealthy, true);
  assert.match(warnings.join("\n"), /vectorize \(fail\)/);
  assert.match(warnings.join("\n"), /boom/);
});

test("a non-readiness error body does not break the error message", async () => {
  await assert.rejects(
    demoPreflight({
      environment: { ...bootstrapEnvironment, DEMO_PREFLIGHT_ALLOW_BOOTSTRAP: "false" },
      fetchImpl: async () => new Response("upstream exploded", { status: 502 }),
      ...silent,
    }),
    /readiness request failed \(502\)\.$/,
  );
});

test("pre-deploy accepts a deployed Worker that predates a newly required check", async () => {
  // The gate interrogates the Worker already running, which cannot report a
  // check the release being shipped introduces. Validating the old version
  // against the new list would stop every check-adding release deploying itself.
  const previousSchema = REQUIRED_READINESS_CHECKS.filter((name) => name !== "auth_gate");
  const warnings = [];

  const result = await demoPreflight({
    environment: bootstrapEnvironment,
    fetchImpl: async () =>
      Response.json({
        status: "ready",
        environment: "production",
        publicWritesEnabled: true,
        models: EXPECTED_MODELS,
        checks: previousSchema.map((name) => ({ name, status: "pass" })),
      }),
    log: () => {},
    warn: (message) => warnings.push(message),
  });

  assert.equal(result.status, "passed");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /auth_gate/);
  assert.match(warnings[0], /predates this release/);
});

test("the strict post-deploy gate rejects a check reported as failing", async () => {
  // Post-deploy this is the new version reporting itself broken — always fatal.
  // Pre-deploy the same body describes the version being replaced, which the
  // "deploys over" tests above cover.
  await assert.rejects(
    demoPreflight({
      environment: { ...bootstrapEnvironment, DEMO_PREFLIGHT_ALLOW_BOOTSTRAP: "false" },
      fetchImpl: async () =>
        Response.json({
          status: "ready",
          environment: "production",
          publicWritesEnabled: true,
          models: EXPECTED_MODELS,
          checks: REQUIRED_READINESS_CHECKS.map((name) => ({
            name,
            status: name === "d1" ? "fail" : "pass",
          })),
        }),
      ...silent,
    }),
    /failed or deferred/,
  );
});

test("the strict post-deploy gate rejects a 200 whose JSON reports not_ready", async () => {
  await assert.rejects(
    demoPreflight({
      environment: { ...bootstrapEnvironment, DEMO_PREFLIGHT_ALLOW_BOOTSTRAP: "false" },
      fetchImpl: async () =>
        Response.json({
          status: "not_ready",
          environment: "production",
          publicWritesEnabled: true,
          models: EXPECTED_MODELS,
          checks: REQUIRED_READINESS_CHECKS.map((name) => ({ name, status: "pass" })),
        }),
      ...silent,
    }),
    /readiness did not pass/,
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

// --- version propagation ------------------------------------------------------
// The post-deploy gate used to interrogate whatever answered 11 seconds after
// `wrangler deploy` returned, which was routinely the version being replaced —
// a false red on a healthy release, and a false green whenever a healthy old
// version answered for a broken new one. Passing the just-deployed version id
// closes both directions. These tests pin the asymmetry that keeps it safe:
// a *different* id is proof and outranks readiness, an *absent* id proves
// nothing and readiness still decides.

const strictVersionedEnvironment = {
  ...acknowledged,
  DEMO_PREFLIGHT_URL: "https://demo.example.test",
  DEMO_PREFLIGHT_TOKEN: "secret-value",
  DEMO_PREFLIGHT_ATTEMPTS: "5",
  DEMO_PREFLIGHT_RETRY_DELAY_MS: "40",
  DEMO_PREFLIGHT_EXPECTED_VERSION_ID: "new-version",
};

function readinessBody({ workerVersionId, healthy = true, status = 200 } = {}) {
  return Response.json(
    {
      status: "ready",
      environment: "production",
      publicWritesEnabled: healthy,
      models: EXPECTED_MODELS,
      checks: REQUIRED_READINESS_CHECKS.map((name) => ({ name, status: "pass" })),
      ...(workerVersionId ? { workerVersionId } : {}),
    },
    { status },
  );
}

test("a body from the expected version is graded immediately, bad or good", async () => {
  let attempts = 0;
  await assert.rejects(
    demoPreflight({
      environment: strictVersionedEnvironment,
      fetchImpl: async () => {
        attempts += 1;
        return readinessBody({ workerVersionId: "new-version", healthy: false });
      },
      ...silent,
    }),
    /public writes are not explicitly enabled/,
  );
  assert.equal(attempts, 1, "the expected version's own verdict is never waited out");
});

test("a body from a different version is retried until the expected version answers", async () => {
  let attempts = 0;
  const result = await demoPreflight({
    environment: strictVersionedEnvironment,
    fetchImpl: async () => {
      attempts += 1;
      // The old version is answering, and answering *unhealthily*. Without the
      // version id this is indistinguishable from the new version being broken,
      // which is exactly the false red this design removes.
      if (attempts < 3) return readinessBody({ workerVersionId: "old-version", healthy: false });
      return readinessBody({ workerVersionId: "new-version" });
    },
    sleep: async () => {},
    ...silent,
  });

  assert.equal(result.status, "passed");
  assert.equal(attempts, 3);
});

test("a stale version that never rolls over fails rather than passing on a timeout", async () => {
  await assert.rejects(
    demoPreflight({
      environment: { ...strictVersionedEnvironment, DEMO_PREFLIGHT_ATTEMPTS: "2" },
      fetchImpl: async () => readinessBody({ workerVersionId: "old-version" }),
      sleep: async () => {},
      ...silent,
    }),
    /still serving version old-version .* not the just-deployed new-version/,
  );
});

test("a Worker reporting no version id still fails on attempt 1 for a bad body", async () => {
  // The anti-subversion test. If "no version id" alone meant "retry", a deploy
  // broken badly enough to drop the version_metadata binding would be waited
  // out instead of failed — subverting the pinned rule that a Worker which
  // answered with a bad readiness body is never retried.
  let attempts = 0;
  await assert.rejects(
    demoPreflight({
      environment: strictVersionedEnvironment,
      fetchImpl: async () => {
        attempts += 1;
        return readinessBody({ healthy: false });
      },
      ...silent,
    }),
    /public writes are not explicitly enabled/,
  );
  assert.equal(attempts, 1);
});

test("a Worker reporting no version id fails on attempt 1 for a non-ok body too", async () => {
  let attempts = 0;
  await assert.rejects(
    demoPreflight({
      environment: strictVersionedEnvironment,
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

test("a healthy body with no version id settles for a bounded number of polls, then passes", async () => {
  // An older Worker cannot report a field this release adds, so a fully passing
  // body is the strongest evidence available once the settle budget is spent.
  const delays = [];
  const warnings = [];
  let attempts = 0;
  const result = await demoPreflight({
    environment: strictVersionedEnvironment,
    fetchImpl: async () => {
      attempts += 1;
      return readinessBody();
    },
    sleep: async (ms) => delays.push(ms),
    log: () => {},
    warn: (message) => warnings.push(message),
  });

  assert.equal(result.status, "passed");
  assert.equal(result.versionUnreported, true);
  // Two settles, so three fetches — bounded well inside the five allowed attempts.
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [40, 40]);
  assert.match(warnings.join("\n"), /reports no version id/);
});

test("the settle ends the moment the expected version identifies itself", async () => {
  let attempts = 0;
  const warnings = [];
  const result = await demoPreflight({
    environment: strictVersionedEnvironment,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) return readinessBody();
      return readinessBody({ workerVersionId: "new-version" });
    },
    sleep: async () => {},
    log: () => {},
    warn: (message) => warnings.push(message),
  });

  assert.equal(result.status, "passed");
  assert.equal(result.versionUnreported, undefined);
  assert.equal(attempts, 2);
  assert.deepEqual(warnings, []);
});

test("an expected version id does not change how an undeployed target is treated", async () => {
  // The "malformed / not-deployed-yet" row: existing rules only, no benign wait.
  await assert.rejects(
    demoPreflight({
      environment: { ...strictVersionedEnvironment, DEMO_PREFLIGHT_ATTEMPTS: "2" },
      fetchImpl: async () => new Response("<html>stale build</html>", { status: 200 }),
      sleep: async () => {},
      ...silent,
    }),
    /non-JSON body/,
  );
});

test("the pre-deploy gate is untouched when no expected version is set", async () => {
  // Nothing has been deployed yet at that point, so there is no version to
  // expect; the gate must behave exactly as it did before this was added.
  const warnings = [];
  const result = await demoPreflight({
    environment: bootstrapEnvironment,
    fetchImpl: async () => readinessBody({ workerVersionId: "whatever-is-live", healthy: false }),
    log: () => {},
    warn: (message) => warnings.push(message),
  });

  assert.equal(result.status, "passed");
  assert.equal(result.replacedUnhealthy, true);
  assert.match(warnings.join("\n"), /public writes are not explicitly enabled/);
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
