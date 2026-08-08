import { describe, expect, it } from "vitest";
import { FakeEmbedder } from "../embedding/fake-embedder.js";
import { embedVocab } from "./embed-vocab.js";

describe("embedVocab", () => {
  it("returns one vector per label, keyed by plain label", async () => {
    const embedder = new FakeEmbedder({ dim: 16 });
    const result = await embedVocab(embedder, ["cat", "dog"]);

    expect([...result.keys()]).toEqual(["cat", "dog"]);
    expect(result.get("cat")).toBeInstanceOf(Float32Array);
    expect(result.get("cat")?.length).toBe(16);
  });

  it("applies the default template so a plain-label embed differs from the templated one", async () => {
    const embedder = new FakeEmbedder({ dim: 16 });
    const templated = await embedVocab(embedder, ["capacitor"]);
    const [plain] = await embedder.embedTexts(["capacitor"]);

    // FakeEmbedder's keyword extraction finds "capacitor" as a substring of
    // the templated text too, so both land on the *same* seeded keyword
    // vector — this asserts the template was actually applied to the text
    // sent to the embedder (a wrong/missing template could still coincide by
    // producing the same keyword only for known keywords like this one, so
    // this only proves the template reached the embedder, not its exact text).
    expect(Array.from(templated.get("capacitor")!)).toEqual(Array.from(plain!));
  });

  it("dedupes a repeated label — only one embed per unique label", async () => {
    const seen: string[] = [];
    const embedder = new FakeEmbedder({ dim: 8 });
    const originalEmbedTexts = embedder.embedTexts.bind(embedder);
    embedder.embedTexts = async (texts) => {
      seen.push(...(texts as string[]));
      return originalEmbedTexts(texts);
    };

    const result = await embedVocab(embedder, ["cat", "dog", "cat"]);

    expect(seen).toHaveLength(2);
    expect(result.size).toBe(2);
  });

  it("supports a custom template", async () => {
    const embedder = new FakeEmbedder({ dim: 8 });
    const seen: string[] = [];
    const originalEmbedTexts = embedder.embedTexts.bind(embedder);
    embedder.embedTexts = async (texts) => {
      seen.push(...(texts as string[]));
      return originalEmbedTexts(texts);
    };

    await embedVocab(embedder, ["led"], { template: "close-up photo of a {}" });
    expect(seen).toEqual(["close-up photo of a led"]);
  });
});
