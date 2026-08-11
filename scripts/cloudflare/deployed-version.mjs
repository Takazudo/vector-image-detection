#!/usr/bin/env node

import { readFile } from "node:fs/promises";

/**
 * `wrangler deploy` has no `--json` flag, but setting `WRANGLER_OUTPUT_FILE_PATH`
 * makes it append one NDJSON record per command, and the `deploy` record carries
 * `version_id`. That file is the machine-readable source and is preferred over
 * scraping the human log.
 *
 * The last `deploy` record wins: the file is append-only and may already hold
 * records from earlier wrangler invocations in the same job.
 */
export function versionIdFromOutputFile(contents) {
  let found;
  for (const line of contents.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type === "deploy" && typeof entry.version_id === "string" && entry.version_id) {
      found = entry.version_id;
    }
  }
  return found;
}

/** Strips the SGR sequences wrangler emits when it thinks it is on a terminal. */
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

/**
 * Fallback for a wrangler that does not write the NDJSON record: the
 * `Current Version ID:` line it prints on a successful deploy. The id is a
 * UUID, so matching that shape keeps stray decoration out of the capture.
 */
export function versionIdFromDeployLog(contents) {
  const matches = [
    ...contents
      .replace(ANSI_PATTERN, "")
      .matchAll(/Current Version ID:\s*([0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})/g),
  ];
  return matches.at(-1)?.[1];
}

async function readIfPresent(path, read) {
  if (!path) return undefined;
  try {
    return await read(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Resolves the version id `wrangler deploy` just produced, or `undefined`. The
 * caller must treat `undefined` as a failure: handing the post-deploy gate an
 * empty expected version silently restores the propagation race it exists to
 * close, with nothing in the log to say it happened.
 */
export async function readDeployedVersionId({ outputFilePath, logPath, read = readFile } = {}) {
  const outputFile = await readIfPresent(outputFilePath, read);
  const fromOutputFile = outputFile === undefined ? undefined : versionIdFromOutputFile(outputFile);
  if (fromOutputFile) return fromOutputFile;

  const log = await readIfPresent(logPath, read);
  return log === undefined ? undefined : versionIdFromDeployLog(log);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  const [outputFilePath, logPath] = process.argv.slice(2);
  const versionId = await readDeployedVersionId({ outputFilePath, logPath });
  if (!versionId) {
    console.error(
      `Could not determine the deployed Worker version id from ${outputFilePath} or ${logPath}. The post-deploy gate cannot verify that it is interrogating the version this run deployed, so the deploy is being failed rather than verified against an unknown version.`,
    );
    process.exitCode = 1;
  } else {
    // Consumed by the workflow as `>> "$GITHUB_OUTPUT"`, so stdout carries the
    // key=value pair and nothing else.
    console.log(`version-id=${versionId}`);
  }
}
