import assert from "node:assert/strict";
import test from "node:test";

import { SITES, inspectExistingConfiguration } from "./preflight.mjs";

const accountId = "account-id";
const zone = {
  id: "zone-id",
  name: "takazudomodular.com",
  status: "active",
  account: { id: accountId },
};
const docs = SITES[0];

function inspect(overrides = {}) {
  return inspectExistingConfiguration({
    zone,
    domains: [],
    dnsRecords: [],
    routes: [],
    site: docs,
    accountId,
    ...overrides,
  });
}

test("preflight accepts a clean hostname", () => {
  assert.doesNotThrow(() => inspect());
});

test("preflight rejects a hostname owned by another Worker", () => {
  assert.throws(
    () => inspect({ domains: [{ hostname: docs.hostname, service: "other-worker" }] }),
    /another Worker custom domain/,
  );
});

test("preflight rejects unrelated matching Worker routes", () => {
  assert.throws(
    () =>
      inspect({
        routes: [
          { pattern: `*.${docs.hostname.split(".").slice(1).join(".")}/*`, script: "other-worker" },
        ],
      }),
    /unrelated Worker route/,
  );
});

test("preflight rejects an existing DNS target unless it is this Worker custom domain", () => {
  assert.throws(
    () => inspect({ dnsRecords: [{ type: "CNAME" }] }),
    /already has an A, AAAA, or CNAME record/,
  );
  assert.doesNotThrow(() =>
    inspect({
      domains: [{ hostname: docs.hostname, service: docs.service }],
      dnsRecords: [{ type: "CNAME" }],
    }),
  );
});
