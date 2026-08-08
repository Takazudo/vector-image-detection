import assert from "node:assert/strict";
import test from "node:test";

import { SITES, apiGetAllPages, inspectExistingConfiguration } from "./preflight.mjs";

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

test("paginated lookups inspect every Worker custom-domain page", async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    const page = new URL(url).searchParams.get("page");
    return {
      ok: true,
      async json() {
        return {
          success: true,
          result: [{ hostname: `page-${page}.example.com` }],
          result_info: { total_pages: 2 },
        };
      },
    };
  };

  const results = await apiGetAllPages(
    fetchImpl,
    "token",
    "/accounts/account-id/workers/domains",
    "Worker-domain lookup",
  );

  assert.deepEqual(
    results.map(({ hostname }) => hostname),
    ["page-1.example.com", "page-2.example.com"],
  );
  assert.equal(requested.length, 2);
  assert.match(requested[0], /per_page=100&page=1$/);
  assert.match(requested[1], /per_page=100&page=2$/);
});
