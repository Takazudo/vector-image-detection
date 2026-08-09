import assert from "node:assert/strict";
import test from "node:test";

import { demoPurge, readPurgeInput } from "./demo-purge.mjs";

const environment = {
  DEMO_PURGE_URL: "https://demo.example.test",
  DEMO_PURGE_TOKEN: "secret-value",
  DEMO_PURGE_PHOTO_ID: "photo-1",
  DEMO_PURGE_REASON: "operator request",
};

test("operator purge requires an explicit HTTPS target and identifiers", () => {
  assert.throws(() => readPurgeInput({}), /DEMO_PURGE_URL/);
  assert.throws(
    () => readPurgeInput({ ...environment, DEMO_PURGE_REASON: "   " }),
    /DEMO_PURGE_URL/,
  );
  assert.throws(
    () => readPurgeInput({ ...environment, DEMO_PURGE_URL: "http://demo.example.test" }),
    /must use HTTPS/,
  );
});

test("operator purge sends one authenticated, reasoned request", async () => {
  let observedUrl;
  let observedInit;
  const result = await demoPurge({
    environment,
    log: () => {},
    fetchImpl: async (url, init) => {
      observedUrl = String(url);
      observedInit = init;
      return Response.json(
        {
          version: "v1",
          operationId: "operation-1",
          photoId: "photo-1",
          tombstoneRevision: 2,
          state: "pending",
        },
        { status: 202 },
      );
    },
  });
  assert.equal(observedUrl, "https://demo.example.test/api/v1/operator/photos/photo-1/purge");
  assert.equal(observedInit.headers.authorization, "Bearer secret-value");
  assert.deepEqual(JSON.parse(observedInit.body), { reason: "operator request" });
  assert.equal(result.operationId, "operation-1");
});

test("operator purge rejects failed or malformed responses", async () => {
  await assert.rejects(
    demoPurge({
      environment,
      log: () => {},
      fetchImpl: async () => new Response(null, { status: 401 }),
    }),
    /failed \(401\)/,
  );
  await assert.rejects(
    demoPurge({
      environment,
      log: () => {},
      fetchImpl: async () => Response.json({ state: "complete" }),
    }),
    /unexpected response/,
  );
});
