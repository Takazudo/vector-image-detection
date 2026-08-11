import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { WORKER_INTEGRATION_TIMEOUT_MS, WORKER_TEST_TIMEOUT_MS } from "./worker-timeouts.ts";

// This suite exists so the worker timeouts cannot drift upward quietly. Issue #54
// was raised because a ceiling was raised to make a red suite green, with no
// measurement behind the number and nothing to stop the next raise. Failing here
// is the intended way to find out you are about to do that again: re-measure
// against CI, update the table in worker-timeouts.ts, then update these numbers.

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("worker test timeout ceilings", () => {
  it("keeps the fast tier at the measured 10s", () => {
    expect(WORKER_TEST_TIMEOUT_MS).toBe(10_000);
  });

  it("keeps the integration tier at the measured 60s", () => {
    expect(WORKER_INTEGRATION_TIMEOUT_MS).toBe(60_000);
  });

  it("keeps the two tiers distinct", () => {
    expect(WORKER_TEST_TIMEOUT_MS).toBeLessThan(WORKER_INTEGRATION_TIMEOUT_MS);
  });
});

// Pinning the values only helps while the suite still reads them, so these check
// the wiring rather than the formatting: a hardcoded literal in any of the three
// call sites would sail past the assertions above.
describe("worker test timeout wiring", () => {
  it("drives the vitest config from the shared constant", () => {
    const config = read("../vitest.worker.config.ts");
    expect(config).toMatch(/testTimeout:\s*WORKER_TEST_TIMEOUT_MS/);
    expect(config).toMatch(/hookTimeout:\s*WORKER_TEST_TIMEOUT_MS/);
    expect(config).not.toMatch(/(?:test|hook)Timeout:\s*[\d_]+/);
  });

  it.each([
    "../src/worker/features/photos/seed.integration.worker.test.ts",
    "../src/worker/features/maintenance/purge.integration.worker.test.ts",
  ])("gives %s the integration tier", (path) => {
    const source = read(path);
    expect(source).toContain("WORKER_INTEGRATION_TIMEOUT_MS");
    expect(source).toMatch(/\}, WORKER_INTEGRATION_TIMEOUT_MS\);/);
  });
});
