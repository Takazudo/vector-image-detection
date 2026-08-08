import { describe, expect, it } from "vitest";
import {
  addTag,
  changedOverlayIds,
  exportTagsJson,
  mergeTags,
  overlayStorageKey,
  overlayTagCount,
  readOverlay,
  removeTag,
  writeOverlay,
} from "./tags";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    snapshot: () => Object.fromEntries(map),
  };
}

describe("overlayStorageKey", () => {
  it("distinguishes indexes built by a different model or at a different time", () => {
    const base = { modelId: "fake-embedder-v1", createdAt: "2026-01-01T00:00:00.000Z" };
    expect(overlayStorageKey(base)).toBe("vis-demo:tags:fake-embedder-v1:2026-01-01T00:00:00.000Z");
    expect(overlayStorageKey({ ...base, modelId: "Xenova/siglip-base-patch16-224" })).not.toBe(
      overlayStorageKey(base),
    );
    expect(overlayStorageKey({ ...base, createdAt: "2026-02-02T00:00:00.000Z" })).not.toBe(
      overlayStorageKey(base),
    );
  });
});

describe("mergeTags", () => {
  it("keeps index tags first and appends overlay tags after", () => {
    expect(mergeTags(["through-hole"], ["favorite"])).toEqual(["through-hole", "favorite"]);
  });

  it("drops overlay duplicates case-insensitively, keeping the index spelling", () => {
    expect(mergeTags(["Through-Hole"], ["through-hole", "favorite"])).toEqual([
      "Through-Hole",
      "favorite",
    ]);
  });

  it("returns index tags unchanged when there is no overlay entry", () => {
    expect(mergeTags(["a", "b"], undefined)).toEqual(["a", "b"]);
  });

  it("drops blank entries", () => {
    expect(mergeTags([], ["  ", "kitten"])).toEqual(["kitten"]);
  });
});

describe("readOverlay", () => {
  it("returns an empty overlay for a missing key", () => {
    expect(readOverlay(fakeStorage(), "absent")).toEqual({});
  });

  it("returns an empty overlay for unparseable JSON", () => {
    expect(readOverlay(fakeStorage({ k: "{not json" }), "k")).toEqual({});
  });

  it("returns an empty overlay when the stored value is not an object map", () => {
    expect(readOverlay(fakeStorage({ k: '["a"]' }), "k")).toEqual({});
    expect(readOverlay(fakeStorage({ k: "42" }), "k")).toEqual({});
  });

  it("keeps only string tags and drops entries left empty", () => {
    const storage = fakeStorage({ k: '{"a":["cat",7,null,"cat"],"b":[],"c":"nope"}' });
    expect(readOverlay(storage, "k")).toEqual({ a: ["cat"] });
  });

  it("round-trips through writeOverlay", () => {
    const storage = fakeStorage();
    writeOverlay(storage, "k", { a: ["cat"], b: ["dog", "puppy"] });
    expect(readOverlay(storage, "k")).toEqual({ a: ["cat"], b: ["dog", "puppy"] });
  });
});

describe("addTag", () => {
  it("adds the tag to every listed id", () => {
    expect(addTag({}, ["a", "b"], "cat")).toEqual({ a: ["cat"], b: ["cat"] });
  });

  it("skips ids that already carry the tag, comparing case-insensitively", () => {
    const overlay = { a: ["Cat"] };
    expect(addTag(overlay, ["a"], "cat")).toBe(overlay);
  });

  it("returns the same overlay reference for a blank tag or an empty id list", () => {
    const overlay = { a: ["cat"] };
    expect(addTag(overlay, ["a"], "   ")).toBe(overlay);
    expect(addTag(overlay, [], "dog")).toBe(overlay);
  });

  it("does not mutate the input overlay", () => {
    const overlay = { a: ["cat"] };
    addTag(overlay, ["a", "b"], "dog");
    expect(overlay).toEqual({ a: ["cat"] });
  });
});

describe("removeTag", () => {
  it("drops the id entirely once its last tag is removed", () => {
    expect(removeTag({ a: ["cat"], b: ["dog"] }, "a", "cat")).toEqual({ b: ["dog"] });
  });

  it("returns the same overlay reference when the tag is not present", () => {
    const overlay = { a: ["cat"] };
    expect(removeTag(overlay, "a", "dog")).toBe(overlay);
    expect(removeTag(overlay, "zz", "cat")).toBe(overlay);
  });
});

describe("changedOverlayIds", () => {
  it("reports added, removed, and edited ids, sorted", () => {
    const previous = { keep: ["cat"], edit: ["cat"], drop: ["dog"] };
    const next = { keep: ["cat"], edit: ["cat", "kitten"], add: ["led"] };
    expect(changedOverlayIds(previous, next)).toEqual(["add", "drop", "edit"]);
  });

  it("reports nothing for an identical overlay", () => {
    expect(changedOverlayIds({ a: ["cat"] }, { a: ["cat"] })).toEqual([]);
  });
});

describe("overlayTagCount", () => {
  it("counts every tag across every item", () => {
    expect(overlayTagCount({ a: ["cat", "kitten"], b: ["dog"] })).toBe(3);
    expect(overlayTagCount({})).toBe(0);
  });
});

describe("exportTagsJson", () => {
  const meta = {
    modelId: "fake-embedder-v1",
    createdAt: "2026-01-01T00:00:00.000Z",
    items: [
      { id: "a", file: "a", tags: ["through-hole"] },
      { id: "b", file: "b", tags: [] },
      { id: "c", file: "c", tags: [] },
    ],
  };

  it("exports merged tags and omits items left untagged", () => {
    const json = JSON.parse(exportTagsJson(meta, { b: ["cat"] }, "2026-08-08T00:00:00.000Z"));
    expect(json.items).toEqual([
      { id: "a", tags: ["through-hole"] },
      { id: "b", tags: ["cat"] },
    ]);
    expect(json.index).toEqual({
      modelId: "fake-embedder-v1",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(json.exportedAt).toBe("2026-08-08T00:00:00.000Z");
  });

  it("emits the full tag array per item, index tags first", () => {
    const json = JSON.parse(exportTagsJson(meta, { a: ["favorite"] }, "2026-08-08T00:00:00.000Z"));
    expect(json.items[0]).toEqual({ id: "a", tags: ["through-hole", "favorite"] });
  });
});
