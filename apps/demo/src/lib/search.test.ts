import type { IndexItem, Vector } from "@vector-image-detection/core/browser";
import { FakeEmbedder, InMemoryVectorStore } from "@vector-image-detection/core/browser";
import { beforeEach, describe, expect, it } from "vitest";
import { rankByVector, syncStoreTags } from "./search";

const FILES = ["cat/cat-01.png", "cat/cat-02.png", "dog/dog-01.png", "led/led-01.png"];

const embedder = new FakeEmbedder();

async function buildFixture() {
  const vectors = await embedder.embedImages(FILES);
  const items: IndexItem[] = FILES.map((file) => ({ id: file, file, tags: [] }));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const vectorById = new Map<string, Vector>(FILES.map((file, i) => [file, vectors[i]!]));
  const store = new InMemoryVectorStore(
    items.map((item, i) => {
      const { id, ...payload } = item;
      return { id, vector: vectors[i]!, payload };
    }),
  );
  return { items, itemById, vectorById, store };
}

describe("rankByVector", () => {
  let fixture: Awaited<ReturnType<typeof buildFixture>>;

  beforeEach(async () => {
    fixture = await buildFixture();
  });

  it("ranks the matching keyword's images above every other category", async () => {
    const [query] = await embedder.embedTexts(["a photo of a cat"]);
    const ranked = await rankByVector(fixture.store, fixture.itemById, query!, 4);

    expect(
      ranked
        .map((hit) => hit.item.id)
        .slice(0, 2)
        .sort(),
    ).toEqual(["cat/cat-01.png", "cat/cat-02.png"]);
    expect(ranked[0]!.score).toBeGreaterThan(ranked[2]!.score);
  });

  it("honors the limit", async () => {
    const [query] = await embedder.embedTexts(["a photo of a dog"]);
    expect(await rankByVector(fixture.store, fixture.itemById, query!, 2)).toHaveLength(2);
  });

  it("returns nothing for a non-positive limit", async () => {
    const [query] = await embedder.embedTexts(["a photo of a dog"]);
    expect(await rankByVector(fixture.store, fixture.itemById, query!, 0)).toEqual([]);
  });

  it("excludes the query item itself and still fills the limit", async () => {
    const self = "cat/cat-01.png";
    const ranked = await rankByVector(
      fixture.store,
      fixture.itemById,
      fixture.vectorById.get(self)!,
      3,
      { excludeId: self },
    );

    expect(ranked.map((hit) => hit.item.id)).not.toContain(self);
    expect(ranked).toHaveLength(3);
    expect(ranked[0]!.item.id).toBe("cat/cat-02.png");
  });

  it("drops hits whose id is missing from the item map", async () => {
    const partial = new Map(fixture.itemById);
    partial.delete("cat/cat-01.png");
    const [query] = await embedder.embedTexts(["a photo of a cat"]);

    const ranked = await rankByVector(fixture.store, partial, query!, 4);
    expect(ranked.map((hit) => hit.item.id)).not.toContain("cat/cat-01.png");
    expect(ranked).toHaveLength(3);
  });
});

describe("syncStoreTags", () => {
  it("writes merged tags into the store payload for the given ids only", async () => {
    const { store, itemById, vectorById } = await buildFixture();
    await syncStoreTags(store, itemById, vectorById, { "cat/cat-01.png": ["kitten"] }, [
      "cat/cat-01.png",
    ]);

    const [updated, untouched] = await store.get(["cat/cat-01.png", "cat/cat-02.png"]);
    expect(updated!.payload?.tags).toEqual(["kitten"]);
    expect(untouched!.payload?.tags).toEqual([]);
  });

  it("restores the index tags when an overlay entry is removed", async () => {
    const { store, itemById, vectorById } = await buildFixture();
    const id = "dog/dog-01.png";

    await syncStoreTags(store, itemById, vectorById, { [id]: ["puppy"] }, [id]);
    await syncStoreTags(store, itemById, vectorById, {}, [id]);

    const [item] = await store.get([id]);
    expect(item!.payload?.tags).toEqual([]);
  });

  it("preserves the non-tag payload fields", async () => {
    const vectors = await embedder.embedImages(["cat/cat-01.png"]);
    const item: IndexItem = {
      id: "cat/cat-01.png",
      file: "cat/cat-01.png",
      thumb: "thumbs/cat/cat-01.png.jpg",
      knownLabel: "cat",
      author: "someone",
      tags: ["through-hole"],
    };
    const store = new InMemoryVectorStore([
      { id: item.id, vector: vectors[0]!, payload: { ...item } },
    ]);

    await syncStoreTags(
      store,
      new Map([[item.id, item]]),
      new Map([[item.id, vectors[0]!]]),
      { [item.id]: ["favorite"] },
      [item.id],
    );

    const [updated] = await store.get([item.id]);
    expect(updated!.payload).toMatchObject({
      file: "cat/cat-01.png",
      thumb: "thumbs/cat/cat-01.png.jpg",
      knownLabel: "cat",
      author: "someone",
      tags: ["through-hole", "favorite"],
    });
    expect(updated!.payload).not.toHaveProperty("id");
  });

  it("ignores ids that are not in the index", async () => {
    const { store, itemById, vectorById } = await buildFixture();
    await expect(
      syncStoreTags(store, itemById, vectorById, { ghost: ["cat"] }, ["ghost"]),
    ).resolves.toBeUndefined();
    expect(await store.count()).toBe(FILES.length);
  });
});
