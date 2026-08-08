import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./prompt.js";

describe("buildSystemPrompt", () => {
  it("describes the strict JSON contract (tags, readableText, caption)", () => {
    const prompt = buildSystemPrompt({ language: "en" });
    expect(prompt).toMatch(/"tags"/);
    expect(prompt).toMatch(/"readableText"/);
    expect(prompt).toMatch(/"caption"/);
    expect(prompt).toMatch(/ONLY one JSON object/);
  });

  it("instructs English output by default", () => {
    const prompt = buildSystemPrompt({ language: "en" });
    expect(prompt).toMatch(/English/);
    expect(prompt).not.toMatch(/Japanese/);
  });

  it("instructs Japanese output when language is 'ja'", () => {
    const prompt = buildSystemPrompt({ language: "ja" });
    expect(prompt).toMatch(/Japanese/);
    expect(prompt).not.toMatch(/English/);
  });
});
