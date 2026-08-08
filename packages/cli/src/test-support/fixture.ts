// Test-only helpers shared across command test files. Not itself a *.test.ts
// file, so vitest never runs it as a suite (mirrors
// packages/core/src/clustering/test-fixtures.ts).
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { embedding } from "@vector-image-detection/core";
import type { CliDeps, Logger } from "../types.js";

const CORE_FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "core",
  "fixtures",
);

export interface RecordingLogger extends Logger {
  logLines: string[];
  errorLines: string[];
}

/** A `Logger` that records every line instead of printing, for assertions. */
export function createRecordingLogger(): RecordingLogger {
  const logLines: string[] = [];
  const errorLines: string[] = [];
  return {
    logLines,
    errorLines,
    log: (message) => logLines.push(message),
    error: (message) => errorLines.push(message),
  };
}

/** `CliDeps` overrides wired to a 32-dim `FakeEmbedder` (network-free) plus a recording logger. */
export function fakeDeps(overrides: Partial<CliDeps> = {}): {
  deps: Partial<CliDeps>;
  logger: RecordingLogger;
} {
  const logger = createRecordingLogger();
  return {
    logger,
    deps: {
      createEmbedder: () => new embedding.FakeEmbedder({ dim: 32 }),
      logger,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      ...overrides,
    },
  };
}

export interface TmpPhotoFixture {
  rootDir: string;
  photosDir: string;
  cleanup: () => Promise<void>;
}

/**
 * Creates a tmp `rootDir` with `<rootDir>/photos/{cat,dog}-N.jpg` (real,
 * tiny, decodable JPEGs — reused from packages/core/fixtures/{cat,dog}.jpg
 * so `sharp` thumbnailing has real bytes to work with) plus a
 * `manifest.json` matching `scripts/fetch-samples.mjs`'s shape, so ingest
 * exercises manifest-metadata matching too. `FakeEmbedder` seeds purely off
 * filename, so reusing identical source bytes under different names is fine.
 */
export async function createTmpPhotoFixture(
  opts: { catCount?: number; dogCount?: number } = {},
): Promise<TmpPhotoFixture> {
  const { catCount = 3, dogCount = 3 } = opts;
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "vis-cli-test-"));
  const photosDir = path.join(rootDir, "photos");
  await fs.mkdir(photosDir, { recursive: true });

  const catBytes = await fs.readFile(path.join(CORE_FIXTURES_DIR, "cat.jpg"));
  const dogBytes = await fs.readFile(path.join(CORE_FIXTURES_DIR, "dog.jpg"));

  const manifestItems: {
    file: string;
    knownLabel: string;
    source: string;
    license: string;
    author: string;
  }[] = [];

  for (let i = 1; i <= catCount; i++) {
    const file = `cat-${i}.jpg`;
    await fs.writeFile(path.join(photosDir, file), catBytes);
    manifestItems.push({
      file,
      knownLabel: "cat",
      source: "https://example.test/cat-source",
      license: "CC0 1.0",
      author: "Fixture Author",
    });
  }
  for (let i = 1; i <= dogCount; i++) {
    const file = `dog-${i}.jpg`;
    await fs.writeFile(path.join(photosDir, file), dogBytes);
    manifestItems.push({
      file,
      knownLabel: "dog",
      source: "https://example.test/dog-source",
      license: "CC0 1.0",
      author: "Fixture Author",
    });
  }

  await fs.writeFile(
    path.join(photosDir, "manifest.json"),
    JSON.stringify({ generatedAt: "2026-01-01T00:00:00.000Z", items: manifestItems }, null, 2),
  );

  return {
    rootDir,
    photosDir,
    cleanup: () => fs.rm(rootDir, { recursive: true, force: true }),
  };
}
