#!/usr/bin/env node

// Boots `wrangler dev` for the demo Worker. Wrangler resolves .dev.vars/.env
// only against its config directory (apps/demo/), never the repo root, so
// this loads the repo-root .env into the child process's environment first.
// Existing process.env values always win. Values are never logged.

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootEnvPath = path.resolve(appDir, "../../.env");

async function loadRootEnv() {
  try {
    const contents = await readFile(rootEnvPath, "utf8");
    return parseEnv(contents);
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

const rootEnv = await loadRootEnv();
const env = { ...process.env };
for (const [key, value] of Object.entries(rootEnv)) {
  if (env[key] === undefined) env[key] = value;
}

const child = spawn("wrangler", ["dev", "--config", "wrangler.jsonc", ...process.argv.slice(2)], {
  cwd: appDir,
  env,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`Failed to start wrangler dev: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code ?? 0;
  }
});
