import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { REQUIRED_ACKNOWLEDGEMENTS } from "../../../scripts/cloudflare/demo-preflight.mjs";
import {
  REQUIRED_RESOURCE_VARIABLES,
  renderProductionConfig,
} from "./render-production-config.mjs";

const TEMPLATE_URL = new URL("../wrangler.production.jsonc", import.meta.url);

const resources = {
  DEMO_D1_DATABASE_NAME: "demo-d1",
  DEMO_D1_DATABASE_ID: "11111111-2222-3333-4444-555555555555",
  DEMO_R2_BUCKET_NAME: "demo-photos",
  DEMO_QUEUE_NAME: "demo-photo-queue",
  DEMO_DLQ_NAME: "demo-photo-dlq",
  DEMO_VECTORIZE_INDEX_NAME: "demo-photo-vectors",
  DEMO_RATE_LIMIT_NAMESPACE_ID: "2000007",
};

const environment = { ...REQUIRED_ACKNOWLEDGEMENTS, ...resources };

// The committed template is the real input, so a structural edit that drops a
// binding this renderer writes into fails here rather than during a deployment.
const template = await readFile(TEMPLATE_URL, "utf8");

function render(overrides = {}) {
  return renderProductionConfig({
    environment: { ...environment, ...overrides },
    source: template,
  });
}

test("rendering flips all four runtime gates together", () => {
  const config = render();
  assert.deepEqual(config.vars, {
    APP_ENV: "production",
    PUBLIC_WRITES_ENABLED: "true",
    ACK_ANONYMOUS_PUBLIC_WRITES: "true",
    ACK_RETAINED_IMAGE_METADATA: "true",
    ACK_REACTIVE_PURGE_ONLY: "true",
  });
});

test("the committed template keeps every gate off", () => {
  const committed = JSON.parse(template.replace(/,\s*([}\]])/g, "$1"));
  assert.equal(committed.vars.PUBLIC_WRITES_ENABLED, "false");
  assert.equal(committed.vars.ACK_ANONYMOUS_PUBLIC_WRITES, "false");
  assert.equal(committed.vars.ACK_RETAINED_IMAGE_METADATA, "false");
  assert.equal(committed.vars.ACK_REACTIVE_PURGE_ONLY, "false");
});

test("rendering substitutes every provisioned resource name", () => {
  const config = render();
  assert.equal(config.d1_databases[0].database_name, resources.DEMO_D1_DATABASE_NAME);
  assert.equal(config.d1_databases[0].database_id, resources.DEMO_D1_DATABASE_ID);
  assert.equal(config.r2_buckets[0].bucket_name, resources.DEMO_R2_BUCKET_NAME);
  assert.equal(config.queues.producers[0].queue, resources.DEMO_QUEUE_NAME);
  assert.equal(config.queues.producers[1].queue, resources.DEMO_DLQ_NAME);
  assert.equal(config.queues.consumers[0].queue, resources.DEMO_QUEUE_NAME);
  assert.equal(config.queues.consumers[0].dead_letter_queue, resources.DEMO_DLQ_NAME);
  assert.equal(config.vectorize[0].index_name, resources.DEMO_VECTORIZE_INDEX_NAME);
  assert.equal(config.ratelimits[0].namespace_id, resources.DEMO_RATE_LIMIT_NAMESPACE_ID);
});

test("no placeholder resource name survives rendering", () => {
  const serialised = JSON.stringify(render());
  assert.doesNotMatch(serialised, /REPLACE_WITH|replace-with|00000000-0000-0000/);
});

test("every resource variable is individually required", () => {
  for (const name of REQUIRED_RESOURCE_VARIABLES) {
    assert.throws(() => render({ [name]: "" }), new RegExp(`${name} is required`), name);
  }
});

test("rendering refuses to run without every risk acknowledgement", () => {
  assert.throws(
    () => render({ ACK_REACTIVE_PURGE_ONLY: "" }),
    /ACK_REACTIVE_PURGE_ONLY must be explicitly acknowledged/,
  );
});

test("rendering rejects an approximate acknowledgement value", () => {
  assert.throws(
    () => render({ ACK_ANONYMOUS_PUBLIC_WRITES: "true" }),
    /ACK_ANONYMOUS_PUBLIC_WRITES/,
  );
});
