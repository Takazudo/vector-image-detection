import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkerRequest, WorkerResponse } from "./embedder-protocol";
import { canRequestEmbedding, EmbedderClient } from "./embedder-client";

type Listener = (event: { data: WorkerResponse } | { message: string }) => void;

/**
 * Stands in for the real embed-worker.ts Worker: records every posted message
 * instead of running transformers.js, so these tests can assert on *when*
 * `init` is sent without a browser or a real model download.
 */
class FakeWorker {
  static instances: FakeWorker[] = [];
  readonly posted: WorkerRequest[] = [];
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: WorkerRequest): void {
    this.posted.push(message);
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  terminate(): void {}

  /** Test-only: simulate the worker posting a response back to the client. */
  emitMessage(data: WorkerResponse): void {
    for (const listener of this.listeners.get("message") ?? []) listener({ data });
  }
}

let originalWorker: typeof Worker | undefined;

beforeEach(() => {
  originalWorker = globalThis.Worker;
  FakeWorker.instances = [];
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
});

afterEach(() => {
  globalThis.Worker = originalWorker as typeof Worker;
});

const REAL_MODEL_ID = "Xenova/siglip-base-patch16-224";
const REAL_DIM = 768;

describe("EmbedderClient — deferred model init (real model)", () => {
  it("posts nothing to the worker on construction", () => {
    const client = new EmbedderClient(REAL_MODEL_ID, REAL_DIM);
    const worker = FakeWorker.instances[0]!;

    expect(worker.posted).toEqual([]);
    expect(client.getStatus()).toEqual({ phase: "idle", mode: "model" });
  });

  it("sends init only once embedTexts is first called, then the embed request", () => {
    const client = new EmbedderClient(REAL_MODEL_ID, REAL_DIM);
    const worker = FakeWorker.instances[0]!;

    void client.embedTexts(["a photo of a cat"]);

    expect(worker.posted).toEqual([
      { type: "init", modelId: REAL_MODEL_ID, dim: REAL_DIM },
      { type: "embed", requestId: expect.any(Number), texts: ["a photo of a cat"] },
    ]);
    expect(client.getStatus()).toEqual({ phase: "loading", mode: "model", downloads: [] });
  });

  it("does not send init for an empty text list", () => {
    const client = new EmbedderClient(REAL_MODEL_ID, REAL_DIM);
    const worker = FakeWorker.instances[0]!;

    void client.embedTexts([]);

    expect(worker.posted).toEqual([]);
    expect(client.getStatus()).toEqual({ phase: "idle", mode: "model" });
  });

  it("preload() starts the load without embedding anything", () => {
    const client = new EmbedderClient(REAL_MODEL_ID, REAL_DIM);
    const worker = FakeWorker.instances[0]!;

    client.preload();

    expect(worker.posted).toEqual([{ type: "init", modelId: REAL_MODEL_ID, dim: REAL_DIM }]);
    expect(client.getStatus().phase).toBe("loading");
  });

  it("is idempotent — repeated preload()/embedTexts() calls send init only once", () => {
    const client = new EmbedderClient(REAL_MODEL_ID, REAL_DIM);
    const worker = FakeWorker.instances[0]!;

    client.preload();
    client.preload();
    void client.embedTexts(["dog"]);

    const initMessages = worker.posted.filter((message) => message.type === "init");
    expect(initMessages).toHaveLength(1);
  });

  it("reaches ready once the worker confirms, unblocking canRequestEmbedding", () => {
    const client = new EmbedderClient(REAL_MODEL_ID, REAL_DIM);
    const worker = FakeWorker.instances[0]!;

    void client.embedTexts(["cat"]);
    worker.emitMessage({ type: "ready", mode: "model", modelId: REAL_MODEL_ID });

    expect(client.getStatus()).toEqual({ phase: "ready", mode: "model" });
    expect(canRequestEmbedding(client.getStatus())).toBe(true);
  });
});

describe("EmbedderClient — mock mode stays eager", () => {
  it("sends init immediately on construction — nothing to download, so no reason to defer", () => {
    const client = new EmbedderClient("fake-embedder-v1", 8);
    const worker = FakeWorker.instances[0]!;

    expect(worker.posted).toEqual([{ type: "init", modelId: "fake-embedder-v1", dim: 8 }]);
    expect(client.getStatus()).toEqual({ phase: "loading", mode: "mock", downloads: [] });
  });
});

describe("canRequestEmbedding", () => {
  it("allows idle and ready", () => {
    expect(canRequestEmbedding({ phase: "idle", mode: "model" })).toBe(true);
    expect(canRequestEmbedding({ phase: "ready", mode: "model" })).toBe(true);
  });

  it("blocks mid-load and error, so callers don't pile up duplicate requests", () => {
    expect(canRequestEmbedding({ phase: "loading", mode: "model", downloads: [] })).toBe(false);
    expect(canRequestEmbedding({ phase: "error", mode: "model", message: "boom" })).toBe(false);
  });
});
