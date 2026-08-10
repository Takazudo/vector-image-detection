import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { AUTH_COOKIE_NAME } from "./auth-gate";

// wrangler.test.jsonc resolves the AUTH_PASSWORD / AUTH_PASS_COOKIE secrets
// from vitest.worker.config.ts, which sets both to this literal for tests.
const GATE_COOKIE = `${AUTH_COOKIE_NAME}=worker-test-only`;
const GATE_PASSWORD = "worker-test-only";
const OPERATOR_TOKEN = "worker-test-only";

function gated(url: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("cookie", GATE_COOKIE);
  return new Request(url, { ...init, headers });
}

function submitAuthForm(password: string, next: string): Request {
  return new Request("https://example.test/__auth", {
    method: "POST",
    // exports.default.fetch auto-follows redirects like a normal fetch() call;
    // without "manual" a 302 gets silently followed to a fresh, now-unauthenticated
    // GET, and the caller's assertions would see that response instead.
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password, next }).toString(),
  });
}

describe("Worker routing", () => {
  it("serves a non-secret health contract through /api", async () => {
    const response = await exports.default.fetch(gated("https://example.test/api/v1/health"));
    const body = await response.json<{ status: string; service: string }>();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      status: "ok",
      service: "vector-image-detection-demo",
    });
  });

  it("registers photo and tag/search route collections in the hosted registry", async () => {
    const response = await exports.default.fetch(
      gated("https://example.test/api/v1/search?query=cat"),
    );

    // A missing search binding may fail at execution, but a registered route
    // must never regress to the central router's generic 404 response.
    expect(response.status).not.toBe(404);
  });

  it("keeps the operator purge route bearer protected", async () => {
    const response = await exports.default.fetch(
      new Request("https://example.test/api/v1/operator/photos/photo-1/purge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "operator request" }),
      }),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "unauthorized" } });
  });
});

describe("auth gate wiring", () => {
  it("challenges an unauthenticated non-API request with the login form", async () => {
    // wrangler.test.jsonc has no run_worker_first, so a non-/api/ request
    // still enters the Worker in the test environment and reaches the gate.
    const response = await exports.default.fetch("https://example.test/");
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain(`action="/__auth"`);
  });

  it("challenges an unauthenticated API request", async () => {
    const response = await exports.default.fetch("https://example.test/api/v1/health");
    expect(response.status).toBe(401);
  });

  it("passes an API request through once the bypass cookie is present", async () => {
    const response = await exports.default.fetch(gated("https://example.test/api/v1/health"));
    expect(response.status).toBe(200);
  });

  it("grants the session cookie on a correct password submission", async () => {
    const response = await exports.default.fetch(submitAuthForm(GATE_PASSWORD, "/"));
    expect(response.status).toBe(302);
    expect(response.headers.get("set-cookie")).toContain(GATE_COOKIE);
  });

  it("rejects a wrong password submission with 401", async () => {
    const response = await exports.default.fetch(submitAuthForm("wrong-password", "/"));
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("reaches the operator bearer check with no gate cookie, never the login page", async () => {
    const response = await exports.default.fetch(
      new Request("https://example.test/api/v1/operator/readiness"),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "unauthorized" } });
  });

  it("lets a valid operator bearer token through with no gate cookie at all", async () => {
    const response = await exports.default.fetch(
      new Request("https://example.test/api/v1/operator/readiness", {
        headers: { authorization: `Bearer ${OPERATOR_TOKEN}` },
      }),
    );
    expect(response.status).not.toBe(401);
  });
});
