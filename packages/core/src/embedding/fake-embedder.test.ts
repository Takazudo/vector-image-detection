import { describe, expect, it } from "vitest";
import type { Vector } from "../types.js";
import { FakeEmbedder } from "./fake-embedder.js";

function dot(a: Vector, b: Vector): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

function magnitude(v: Vector): number {
  return Math.sqrt(dot(v, v));
}

describe("FakeEmbedder", () => {
  it("reports the frozen modelId and configured dim", () => {
    const embedder = new FakeEmbedder();
    expect(embedder.modelId).toBe("fake-embedder-v1");
    expect(embedder.dim).toBe(32);

    const custom = new FakeEmbedder({ dim: 16 });
    expect(custom.dim).toBe(16);
  });

  it("returns L2-normalized vectors of the configured dim", async () => {
    const embedder = new FakeEmbedder({ dim: 16 });
    const [imageVec] = await embedder.embedImages(["data/samples/pets/cat-maine_coon-1.jpg"]);
    const [textVec] = await embedder.embedTexts(["a photo of a cat"]);

    for (const v of [imageVec, textVec]) {
      expect(v).toBeDefined();
      expect(v).toBeInstanceOf(Float32Array);
      expect(v?.length).toBe(16);
      expect(magnitude(v as Vector)).toBeCloseTo(1, 5);
    }
  });

  it("returns empty arrays for empty input", async () => {
    const embedder = new FakeEmbedder();
    expect(await embedder.embedImages([])).toEqual([]);
    expect(await embedder.embedTexts([])).toEqual([]);
  });

  it("is deterministic — same input, same vector", async () => {
    const embedder = new FakeEmbedder();
    const [a] = await embedder.embedTexts(["a photo of a cat"]);
    const [b] = await embedder.embedTexts(["a photo of a cat"]);
    expect(a).toEqual(b);

    const [imgA] = await embedder.embedImages(["data/samples/pets/cat-maine_coon-1.jpg"]);
    const [imgB] = await embedder.embedImages(["data/samples/pets/cat-maine_coon-1.jpg"]);
    expect(imgA).toEqual(imgB);
  });

  it("aligns text and image embeddings by keyword (cat text closest to cat images)", async () => {
    const embedder = new FakeEmbedder();
    const [catText, dogText] = await embedder.embedTexts(["a photo of a cat", "a photo of a dog"]);
    const [catImage1, catImage2, dogImage] = await embedder.embedImages([
      "data/samples/pets/cat-maine_coon-1.jpg",
      "data/samples/pets/cat-tabby-2.jpg",
      "data/samples/pets/dog-labrador-1.jpg",
    ]);

    expect(dot(catText as Vector, catImage1 as Vector)).toBeGreaterThan(
      dot(catText as Vector, dogImage as Vector),
    );
    expect(dot(catText as Vector, catImage2 as Vector)).toBeGreaterThan(
      dot(catText as Vector, dogImage as Vector),
    );
    expect(dot(dogText as Vector, dogImage as Vector)).toBeGreaterThan(
      dot(dogText as Vector, catImage1 as Vector),
    );

    // Same-keyword images cluster tightly but are not identical (jitter).
    expect(catImage1).not.toEqual(catImage2);
    expect(dot(catImage1 as Vector, catImage2 as Vector)).toBeGreaterThan(0.9);
  });

  it("aligns across all known keywords, including the electronics vocabulary", async () => {
    const embedder = new FakeEmbedder();
    const [capacitorText, resistorText, connectorText, ledText] = await embedder.embedTexts([
      "a photo of a capacitor",
      "a photo of a resistor",
      "a photo of a connector",
      "a photo of a led",
    ]);
    const [capacitorImage, resistorImage, connectorImage, ledImage] = await embedder.embedImages([
      "data/samples/components/capacitor-1.jpg",
      "data/samples/components/resistor-1.jpg",
      "data/samples/components/connector-1.jpg",
      "data/samples/components/led-1.jpg",
    ]);

    const pairs: [Vector, Vector][] = [
      [capacitorText as Vector, capacitorImage as Vector],
      [resistorText as Vector, resistorImage as Vector],
      [connectorText as Vector, connectorImage as Vector],
      [ledText as Vector, ledImage as Vector],
    ];
    const images = [capacitorImage, resistorImage, connectorImage, ledImage] as Vector[];

    for (const [text, matchingImage] of pairs) {
      const selfScore = dot(text, matchingImage);
      for (const other of images) {
        if (other === matchingImage) continue;
        expect(selfScore).toBeGreaterThan(dot(text, other));
      }
    }
  });

  it("resolves unknown keywords to distinct, roughly orthogonal vectors", async () => {
    const embedder = new FakeEmbedder();
    const [a, b] = await embedder.embedTexts([
      "totally-unseen-keyword-one",
      "totally-unseen-keyword-two",
    ]);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a).not.toEqual(b);
    expect(Math.abs(dot(a as Vector, b as Vector))).toBeLessThan(0.5);
  });

  it("supports explicit { keyword, id } inputs for both images and texts", async () => {
    const embedder = new FakeEmbedder();
    const [imageVec] = await embedder.embedImages([{ keyword: "cat", id: "explicit-1" }]);
    const [textVec] = await embedder.embedTexts([{ keyword: "cat", id: "explicit-text-1" }]);
    const [pathVec] = await embedder.embedTexts(["a photo of a cat"]);

    expect(dot(imageVec as Vector, textVec as Vector)).toBeGreaterThan(0.9);
    expect(dot(textVec as Vector, pathVec as Vector)).toBeCloseTo(1, 5);
  });

  it("falls back to the whole string as keyword when no known keyword is present", async () => {
    const embedder = new FakeEmbedder();
    const [a] = await embedder.embedTexts(["xylophone"]);
    const [b] = await embedder.embedTexts(["xylophone"]);
    expect(a).toEqual(b);
  });
});
