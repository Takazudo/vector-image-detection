/// <reference lib="webworker" />

import { FakeEmbedder, type Embedder } from "./generated/core-browser.mjs";
import { MOCK_MODEL_ID, type WorkerRequest, type WorkerResponse } from "./lib/embedder-protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;
let mockEmbedder: Embedder | undefined;
let realWorker: Worker | undefined;

function post(message: WorkerResponse): void {
  scope.postMessage(message);
}

async function init(modelId: string, dim: number): Promise<void> {
  if (modelId !== MOCK_MODEL_ID) {
    // zfb emits this nested module worker independently. It is not requested in
    // fixture mode, so transformers.js stays genuinely lazy.
    realWorker = new Worker(new URL("./real-embed-worker.ts", import.meta.url), {
      type: "module",
    });
    realWorker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      post(event.data);
    });
    realWorker.postMessage({ type: "init", modelId, dim } satisfies WorkerRequest);
    return;
  }

  try {
    mockEmbedder = new FakeEmbedder({ dim });
    await mockEmbedder.embedTexts(["warm up"]);
    post({ type: "ready", mode: "mock", modelId });
  } catch (error) {
    mockEmbedder = undefined;
    post({ type: "error", message: messageOf(error) });
  }
}

async function embed(requestId: number, texts: string[]): Promise<void> {
  if (realWorker) {
    realWorker.postMessage({ type: "embed", requestId, texts } satisfies WorkerRequest);
    return;
  }

  try {
    if (!mockEmbedder) throw new Error("embedder is not initialized");
    post({ type: "vectors", requestId, vectors: await mockEmbedder.embedTexts(texts) });
  } catch (error) {
    post({ type: "error", requestId, message: messageOf(error) });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

scope.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === "init") void init(request.modelId, request.dim);
  else void embed(request.requestId, request.texts);
});
