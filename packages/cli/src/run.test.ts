import { describe, expect, it } from "vitest";
import { runCli } from "./run.js";
import { fakeDeps } from "./test-support/fixture.js";

// Exercises commander's exitOverride() wiring: a real process.exit() call
// here would kill the whole test runner, so these assertions are also a
// regression guard on that wiring, not just on exit codes.
describe("runCli exit codes", () => {
  it("exits 0 on --help without printing an error", async () => {
    const { deps, logger } = fakeDeps();
    const code = await runCli(["--help"], deps);
    expect(code).toBe(0);
    expect(logger.errorLines).toEqual([]);
  });

  it("exits 1 on an unknown top-level command", async () => {
    const { deps } = fakeDeps();
    const code = await runCli(["not-a-real-command"], deps);
    expect(code).toBe(1);
  });

  it("exits 1 on an unknown flag", async () => {
    const { deps } = fakeDeps();
    const code = await runCli(["cluster", "--not-a-real-flag"], deps);
    expect(code).toBe(1);
  });

  it("exits 1 when a command throws CliUsageError (e.g. missing --confirm-upload)", async () => {
    const { deps } = fakeDeps({ rootDir: "/does/not/matter/for/this/one" });
    const code = await runCli(["tag", "vlm", "some-id", "--index", "demo"], deps);
    expect(code).toBe(1);
  });

  it("exits 2 on an unexpected runtime failure (e.g. missing index)", async () => {
    const { deps } = fakeDeps({ rootDir: "/tmp/definitely-does-not-exist-vis-cli-test" });
    const code = await runCli(["search", "cats", "--index", "missing"], deps);
    expect(code).toBe(2);
  });
});
