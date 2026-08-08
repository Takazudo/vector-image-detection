import { describe, expect, it } from "vitest";
import { runCli } from "../run.js";
import { fakeDeps } from "../test-support/fixture.js";

describe("vis tag (no subcommand)", () => {
  it("is a usage error pointing at the available subcommands", async () => {
    const { deps, logger } = fakeDeps();
    const code = await runCli(["tag"], deps);
    expect(code).toBe(1);
    expect(logger.errorLines.some((line) => /vocab, propagate, vlm/.test(line))).toBe(true);
  });
});
