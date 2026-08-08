import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchHit, VectorStoreItem } from "@vector-image-detection/core";
import { runCli } from "../run.js";
import { createTmpPhotoFixture, fakeDeps, type TmpPhotoFixture } from "../test-support/fixture.js";
import type { QdrantSyncStore } from "../types.js";

function fakeVectorStore(overrides: Partial<QdrantSyncStore> = {}): QdrantSyncStore {
  return {
    upsert: vi.fn(async () => {}),
    search: vi.fn(async () => [] as SearchHit[]),
    delete: vi.fn(async () => {}),
    count: vi.fn(async () => 0),
    get: vi.fn(async () => [] as VectorStoreItem[]),
    dropCollection: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("vis qdrant sync", () => {
  let fixture: TmpPhotoFixture;

  beforeEach(async () => {
    fixture = await createTmpPhotoFixture({ catCount: 2, dogCount: 1 });
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("bare `qdrant` (no subcommand) is a usage error", async () => {
    const { deps } = fakeDeps({ rootDir: fixture.rootDir });
    const code = await runCli(["qdrant"], deps);
    expect(code).toBe(1);
  });

  it("pushes every index item, keyed correctly, to the given collection/url/dim", async () => {
    const store = fakeVectorStore();
    const createQdrantStore = vi.fn(() => store);
    const { deps, logger } = fakeDeps({ rootDir: fixture.rootDir, createQdrantStore });
    await runCli(["ingest", "photos", "--index", "demo"], deps);
    logger.logLines.length = 0;

    const code = await runCli(
      ["qdrant", "sync", "--index", "demo", "--url", "http://localhost:9999"],
      deps,
    );
    expect(code).toBe(0);
    expect(createQdrantStore).toHaveBeenCalledWith({
      url: "http://localhost:9999",
      collection: "vis-demo",
      dim: 32,
    });
    expect(store.dropCollection).toHaveBeenCalledTimes(1);
    expect(store.upsert).toHaveBeenCalledTimes(1);
    const [items] = vi.mocked(store.upsert).mock.calls[0]!;
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.id).sort()).toEqual(["cat-1.jpg", "cat-2.jpg", "dog-1.jpg"]);
    expect(logger.logLines.some((line) => line.includes('collection "vis-demo"'))).toBe(true);

    const dropOrder = vi.mocked(store.dropCollection).mock.invocationCallOrder[0]!;
    const upsertOrder = vi.mocked(store.upsert).mock.invocationCallOrder[0]!;
    expect(dropOrder).toBeLessThan(upsertOrder); // recreate before pushing, so stale points can't survive a sync
  });

  it("gives an actionable docker hint and exits 2 when dropCollection can't reach the server", async () => {
    const connectionError = Object.assign(new Error("fetch failed"), {
      cause: new Error("connect ECONNREFUSED 127.0.0.1:6333"),
    });
    const store = fakeVectorStore({
      dropCollection: vi.fn(async () => Promise.reject(connectionError)),
    });
    const { deps, logger } = fakeDeps({ rootDir: fixture.rootDir, createQdrantStore: () => store });
    await runCli(["ingest", "photos", "--index", "demo"], deps);

    const code = await runCli(["qdrant", "sync", "--index", "demo"], deps);
    expect(code).toBe(2);
    expect(logger.errorLines.some((line) => line.includes("docker run"))).toBe(true);
    expect(store.upsert).not.toHaveBeenCalled();
  });

  it("gives an actionable docker hint and exits 2 when the server is unreachable", async () => {
    const connectionError = Object.assign(new Error("fetch failed"), {
      cause: new Error("connect ECONNREFUSED 127.0.0.1:6333"),
    });
    const store = fakeVectorStore({ upsert: vi.fn(async () => Promise.reject(connectionError)) });
    const { deps, logger } = fakeDeps({ rootDir: fixture.rootDir, createQdrantStore: () => store });
    await runCli(["ingest", "photos", "--index", "demo"], deps);

    const code = await runCli(["qdrant", "sync", "--index", "demo"], deps);
    expect(code).toBe(2);
    expect(logger.errorLines.some((line) => line.includes("docker run"))).toBe(true);
  });

  it("a non-connection upsert failure still surfaces the original error message", async () => {
    const store = fakeVectorStore({
      upsert: vi.fn(async () => Promise.reject(new Error("dim mismatch"))),
    });
    const { deps, logger } = fakeDeps({ rootDir: fixture.rootDir, createQdrantStore: () => store });
    await runCli(["ingest", "photos", "--index", "demo"], deps);

    const code = await runCli(["qdrant", "sync", "--index", "demo"], deps);
    expect(code).toBe(2);
    expect(logger.errorLines.some((line) => line.includes("dim mismatch"))).toBe(true);
  });
});

describe("vis search --backend qdrant", () => {
  let fixture: TmpPhotoFixture;

  beforeEach(async () => {
    fixture = await createTmpPhotoFixture({ catCount: 1, dogCount: 1 });
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("queries the Qdrant adapter instead of the in-memory store", async () => {
    const hits: SearchHit[] = [
      { id: "cat-1.jpg", score: 0.9, payload: { file: "cat-1.jpg", tags: [] } },
    ];
    const store = fakeVectorStore({ search: vi.fn(async () => hits) });
    const createQdrantStore = vi.fn(() => store);
    const { deps, logger } = fakeDeps({ rootDir: fixture.rootDir, createQdrantStore });
    await runCli(["ingest", "photos", "--index", "demo"], deps);
    logger.logLines.length = 0;

    const code = await runCli(
      ["search", "a cat", "--index", "demo", "--backend", "qdrant", "--qdrant-url", "http://q:1"],
      deps,
    );
    expect(code).toBe(0);
    expect(createQdrantStore).toHaveBeenCalledWith({
      url: "http://q:1",
      collection: "vis-demo",
      dim: 32,
    });
    expect(store.search).toHaveBeenCalledTimes(1);
    expect(logger.logLines.join("\n")).toContain("cat-1.jpg");
  });
});
