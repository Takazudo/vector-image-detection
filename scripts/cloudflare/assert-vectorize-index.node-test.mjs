import assert from "node:assert/strict";
import test from "node:test";

import { EXPECTED_MODELS } from "./demo-preflight.mjs";
import {
  VectorizeIndexCredentialError,
  VectorizeIndexMismatchError,
  VectorizeIndexTransportError,
  assertVectorizeIndex,
} from "./assert-vectorize-index.mjs";

const environment = {
  CLOUDFLARE_ACCOUNT_ID: "account-id",
  CLOUDFLARE_API_TOKEN: "token-value",
  DEMO_VECTORIZE_INDEX_NAME: "production-index",
};

const silent = { log: () => {} };

function indexResponse({
  dimensions = EXPECTED_MODELS.vectorDimensions,
  metric = EXPECTED_MODELS.vectorMetric,
} = {}) {
  return Response.json({
    result: {
      name: "production-index",
      config: { dimensions, metric },
    },
    success: true,
    errors: [],
    messages: [],
  });
}

test("accepts a matching index and requests the V2 index-details endpoint", async () => {
  let requestedUrl;
  let authorization;
  await assertVectorizeIndex({
    environment,
    fetchImpl: async (url, init) => {
      requestedUrl = url;
      authorization = init.headers.Authorization;
      return indexResponse();
    },
    ...silent,
  });
  assert.equal(
    requestedUrl,
    "https://api.cloudflare.com/client/v4/accounts/account-id/vectorize/v2/indexes/production-index",
  );
  assert.equal(authorization, "Bearer token-value");
});

test("rejects drifted dimensions as a mismatch, never retryable", async () => {
  await assert.rejects(
    assertVectorizeIndex({
      environment,
      fetchImpl: async () => indexResponse({ dimensions: 384 }),
      ...silent,
    }),
    (error) => {
      assert.ok(error instanceof VectorizeIndexMismatchError);
      assert.match(error.message, /dimensions 384 \(expected 768\)/);
      assert.match(error.message, /do not retry/);
      return true;
    },
  );
});

test("rejects a drifted metric as a mismatch, never retryable", async () => {
  await assert.rejects(
    assertVectorizeIndex({
      environment,
      fetchImpl: async () => indexResponse({ metric: "euclidean" }),
      ...silent,
    }),
    (error) => {
      assert.ok(error instanceof VectorizeIndexMismatchError);
      assert.match(error.message, /metric "euclidean" \(expected "cosine"\)/);
      return true;
    },
  );
});

test("treats a response missing dimensions/metric as an incident, not a mismatch", async () => {
  await assert.rejects(
    assertVectorizeIndex({
      environment,
      fetchImpl: async () =>
        Response.json({
          result: { name: "production-index" },
          success: true,
          errors: [],
          messages: [],
        }),
      ...silent,
    }),
    (error) => {
      assert.ok(error instanceof VectorizeIndexTransportError);
      assert.match(error.message, /unexpected Cloudflare API shape/);
      return true;
    },
  );
});

test("requires every credential before attempting a request", async () => {
  let called = false;
  await assert.rejects(
    assertVectorizeIndex({
      environment: {},
      fetchImpl: async () => {
        called = true;
        return indexResponse();
      },
      ...silent,
    }),
    (error) => {
      assert.ok(error instanceof VectorizeIndexCredentialError);
      assert.match(
        error.message,
        /CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, DEMO_VECTORIZE_INDEX_NAME/,
      );
      assert.match(error.message, /Vectorize Read/);
      return true;
    },
  );
  assert.equal(called, false);
});

test("401/403 are classified as a credential/permission failure, not a mismatch", async () => {
  for (const status of [401, 403]) {
    await assert.rejects(
      assertVectorizeIndex({
        environment,
        fetchImpl: async () =>
          Response.json(
            {
              result: null,
              success: false,
              errors: [{ code: 10000, message: "Authentication error" }],
              messages: [],
            },
            { status },
          ),
        ...silent,
      }),
      (error) => {
        assert.ok(error instanceof VectorizeIndexCredentialError);
        assert.match(error.message, new RegExp(`HTTP ${status}`));
        assert.match(error.message, /Vectorize Read/);
        return true;
      },
    );
  }
});

test("a non-auth API error response is classified as a retryable incident", async () => {
  await assert.rejects(
    assertVectorizeIndex({
      environment,
      fetchImpl: async () =>
        Response.json(
          {
            result: null,
            success: false,
            errors: [{ code: 7003, message: "Not found" }],
            messages: [],
          },
          { status: 404 },
        ),
      ...silent,
    }),
    (error) => {
      assert.ok(error instanceof VectorizeIndexTransportError);
      assert.match(error.message, /HTTP 404/);
      assert.match(error.message, /7003: Not found/);
      assert.match(error.message, /safe to retry/);
      return true;
    },
  );
});

test("a transport failure (network error) is classified as a retryable incident", async () => {
  await assert.rejects(
    assertVectorizeIndex({
      environment,
      fetchImpl: async () => {
        throw new TypeError("fetch failed", { cause: { code: "ETIMEDOUT" } });
      },
      ...silent,
    }),
    (error) => {
      assert.ok(error instanceof VectorizeIndexTransportError);
      assert.match(error.message, /fetch failed/);
      assert.match(error.message, /safe to retry/);
      return true;
    },
  );
});

test("the API token is never present in a thrown error message", async () => {
  const secret = "super-secret-token-value";
  await assert.rejects(
    assertVectorizeIndex({
      environment: { ...environment, CLOUDFLARE_API_TOKEN: secret },
      fetchImpl: async () =>
        Response.json(
          {
            result: null,
            success: false,
            errors: [{ code: 10000, message: "Authentication error" }],
            messages: [],
          },
          { status: 401 },
        ),
      ...silent,
    }),
    (error) => {
      assert.ok(!error.message.includes(secret));
      return true;
    },
  );
});
