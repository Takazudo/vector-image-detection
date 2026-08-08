import { describe, expect, it } from "vitest";
import { buildProgram, createDefaultDeps, DEFAULT_INDEX_NAME, runCli } from "./index.js";

describe("@vector-image-detection/cli package exports", () => {
  it("exposes runCli, buildProgram, createDefaultDeps, and DEFAULT_INDEX_NAME", () => {
    expect(typeof runCli).toBe("function");
    expect(typeof buildProgram).toBe("function");
    expect(typeof createDefaultDeps).toBe("function");
    expect(DEFAULT_INDEX_NAME).toBe("default");
  });

  it("builds a program named vis with every top-level command registered", () => {
    const program = buildProgram(createDefaultDeps());
    expect(program.name()).toBe("vis");
    const names = program.commands.map((cmd) => cmd.name());
    expect(names).toEqual(
      expect.arrayContaining(["ingest", "search", "similar", "tag", "cluster", "qdrant", "export-demo"]),
    );
  });
});
