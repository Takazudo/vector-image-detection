#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateAcknowledgements } from "../../../scripts/cloudflare/demo-preflight.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, ".wrangler.production.generated.json");

validateAcknowledgements(process.env);

const required = [
  "DEMO_D1_DATABASE_NAME",
  "DEMO_D1_DATABASE_ID",
  "DEMO_R2_BUCKET_NAME",
  "DEMO_QUEUE_NAME",
  "DEMO_DLQ_NAME",
  "DEMO_VECTORIZE_INDEX_NAME",
  "DEMO_RATE_LIMIT_NAMESPACE_ID",
];

for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required to render production config.`);
}

function parseJsonc(source) {
  return JSON.parse(
    source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/,\s*([}\]])/g, "$1"),
  );
}

const config = parseJsonc(await readFile(path.join(ROOT, "wrangler.production.jsonc"), "utf8"));
config.vars.PUBLIC_WRITES_ENABLED = "true";
config.vars.ACK_ANONYMOUS_PUBLIC_WRITES = "true";
config.vars.ACK_RETAINED_IMAGE_METADATA = "true";
config.vars.ACK_REACTIVE_PURGE_ONLY = "true";
config.d1_databases[0].database_name = process.env.DEMO_D1_DATABASE_NAME;
config.d1_databases[0].database_id = process.env.DEMO_D1_DATABASE_ID;
config.r2_buckets[0].bucket_name = process.env.DEMO_R2_BUCKET_NAME;
config.queues.producers[0].queue = process.env.DEMO_QUEUE_NAME;
config.queues.producers[1].queue = process.env.DEMO_DLQ_NAME;
config.queues.consumers[0].queue = process.env.DEMO_QUEUE_NAME;
config.queues.consumers[0].dead_letter_queue = process.env.DEMO_DLQ_NAME;
config.vectorize[0].index_name = process.env.DEMO_VECTORIZE_INDEX_NAME;
config.ratelimits[0].namespace_id = process.env.DEMO_RATE_LIMIT_NAMESPACE_ID;

await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
console.log("Rendered production Wrangler config from deployment environment.");
