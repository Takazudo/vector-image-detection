#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateAcknowledgements } from "../../../scripts/cloudflare/demo-preflight.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "wrangler.production.jsonc");
const OUTPUT = path.join(ROOT, ".wrangler.production.generated.json");

/** The only place the real Cloudflare resource names enter a config. */
export const REQUIRED_RESOURCE_VARIABLES = [
  "DEMO_D1_DATABASE_NAME",
  "DEMO_D1_DATABASE_ID",
  "DEMO_R2_BUCKET_NAME",
  "DEMO_QUEUE_NAME",
  "DEMO_DLQ_NAME",
  "DEMO_VECTORIZE_INDEX_NAME",
  "DEMO_RATE_LIMIT_NAMESPACE_ID",
];

export function parseJsonc(source) {
  // These committed configs intentionally use JSON plus trailing commas only.
  // Regex-based comment stripping corrupts string values such as "/api/*".
  return JSON.parse(source.replace(/,\s*([}\]])/g, "$1"));
}

/**
 * Turns the inert committed template into the artifact that is actually
 * deployed: the four runtime gates flip together, and every placeholder
 * resource name is replaced. Both happen here or not at all — a partially
 * rendered config would deploy writes-on against placeholder bindings.
 */
export function renderProductionConfig({ environment = process.env, source }) {
  validateAcknowledgements(environment);
  for (const name of REQUIRED_RESOURCE_VARIABLES) {
    if (!environment[name]) throw new Error(`${name} is required to render production config.`);
  }

  const config = parseJsonc(source);
  config.vars.PUBLIC_WRITES_ENABLED = "true";
  config.vars.ACK_ANONYMOUS_PUBLIC_WRITES = "true";
  config.vars.ACK_RETAINED_IMAGE_METADATA = "true";
  config.vars.ACK_REACTIVE_PURGE_ONLY = "true";
  config.d1_databases[0].database_name = environment.DEMO_D1_DATABASE_NAME;
  config.d1_databases[0].database_id = environment.DEMO_D1_DATABASE_ID;
  config.r2_buckets[0].bucket_name = environment.DEMO_R2_BUCKET_NAME;
  config.queues.producers[0].queue = environment.DEMO_QUEUE_NAME;
  config.queues.producers[1].queue = environment.DEMO_DLQ_NAME;
  config.queues.consumers[0].queue = environment.DEMO_QUEUE_NAME;
  config.queues.consumers[0].dead_letter_queue = environment.DEMO_DLQ_NAME;
  config.vectorize[0].index_name = environment.DEMO_VECTORIZE_INDEX_NAME;
  config.ratelimits[0].namespace_id = environment.DEMO_RATE_LIMIT_NAMESPACE_ID;
  return config;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  const config = renderProductionConfig({ source: await readFile(SOURCE, "utf8") });
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  console.log("Rendered production Wrangler config from deployment environment.");
}
