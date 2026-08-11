import { expect, test } from "@playwright/test";
import { OPERATOR_TOKEN } from "./support.ts";

// `/api/v1/operator/*` is exempt from the password gate (router.ts's `isOperatorPath`
// check runs before `handleAuthGate`, see issue #48) and authenticates on its own bearer
// token instead. This is the guard against that exemption regressing: without it, this
// request would 401 with the *password* wall rather than the operator's own 401, and
// the bearer-authenticated call below would get the login page instead of readiness JSON.
test("operator readiness without a bearer token is rejected, not password-walled", async ({
  request,
}) => {
  const response = await request.get("/api/v1/operator/readiness");
  expect(response.status()).toBe(401);
  const body = await response.json();
  expect(body.error.code).toBe("unauthorized");
});

test("operator readiness with the bearer token returns the readiness contract", async ({
  request,
}) => {
  const response = await request.get("/api/v1/operator/readiness", {
    headers: { authorization: `Bearer ${OPERATOR_TOKEN}` },
  });
  // This e2e config has no `ai`/`vectorize` bindings by construction (wrangler.e2e.jsonc
  // has no local Vectorize emulation, and a remote AI proxy would need credentials this
  // harness doesn't have), so deep readiness can never report "ready" here. Assert the
  // *contract shape* — the response is genuinely the operator readiness body, not the
  // password wall — never that every check passes.
  expect(response.status()).toBe(503);
  const body = await response.json();
  expect(body.version).toBe("v1");
  expect(body.status).toBe("not_ready");
  expect(body.environment).toBe("ci");
  expect(body.publicWritesEnabled).toBe(true);
  expect(Array.isArray(body.checks)).toBe(true);
  const statusByCheck: Record<string, string> = Object.fromEntries(
    body.checks.map((entry: { name: string; status: string }) => [entry.name, entry.status]),
  );
  expect(statusByCheck.workers_ai).toBe("fail");
  expect(statusByCheck.vectorize).toBe("fail");
  // D1 is bound and migrated by scripts/e2e-worker.mjs, so this one genuinely passes —
  // it's the tell that the response is live, not a stubbed shape.
  expect(statusByCheck.d1).toBe("pass");
});
