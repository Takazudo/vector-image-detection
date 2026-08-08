/// <reference lib="webworker" />
// Text embedding runs here so a ~100MB model load and every query inference
// stay off the UI thread. Image vectors are never computed in the browser —
// they arrive precomputed in the index bundle.

import { FakeEmbedder, type Embedder } from "@vector-image-detection/core/browser";
import {
  MOCK_MODEL_ID,
  embedderModeFor,
  type WorkerRequest,
  type WorkerResponse,
} from "./lib/embedder-protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;

function post(message: WorkerResponse): void {
  scope.postMessage(message);
}

function reportProgress(info: unknown): void {
  // transformers.js emits several event shapes through one callback; only the
  // per-file byte progress is useful here, and it is structurally narrowed
  // because the library's ProgressInfo union is not worth importing into the
  // main bundle just to type a callback argument.
  if (typeof info !== "object" || info === null) return;
  const event = info as { status?: unknown; file?: unknown; loaded?: unknown; total?: unknown };
  if (event.status !== "progress" || typeof event.file !== "string") return;
  post({
    type: "progress",
    file: event.file,
    loaded: typeof event.loaded === "number" ? event.loaded : 0,
    total: typeof event.total === "number" ? event.total : 0,
  });
}

async function createEmbedderFor(modelId: string, dim: number): Promise<Embedder> {
  if (modelId === MOCK_MODEL_ID) return new FakeEmbedder({ dim });

  // Dynamic import so the transformers.js runtime is fetched only when the
  // bundle actually needs a real model — a fixture visit downloads none of it.
  const { createEmbedder } = await import("@vector-image-detection/core/transformers-embedder");
  return createEmbedder({ modelId, dim, onProgress: reportProgress });
}

let embedderPromise: Promise<Embedder> | undefined;

async function init(modelId: string, dim: number): Promise<void> {
  embedderPromise = (async () => {
    const embedder = await createEmbedderFor(modelId, dim);
    // Embed a throwaway string so the text tower's weights are resolved before
    // we announce readiness — otherwise the download would surface as a stall
    // on the user's first real query instead of under the loading UI.
    await embedder.embedTexts(["warm up"]);
    return embedder;
  })();

  try {
    await embedderPromise;
    post({ type: "ready", mode: embedderModeFor(modelId), modelId });
  } catch (error) {
    embedderPromise = undefined;
    post({ type: "error", message: messageOf(error) });
  }
}

async function embed(requestId: number, texts: string[]): Promise<void> {
  try {
    if (!embedderPromise) throw new Error("embedder is not initialized");
    const embedder = await embedderPromise;
    post({ type: "vectors", requestId, vectors: await embedder.embedTexts(texts) });
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
