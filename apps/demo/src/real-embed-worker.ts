/// <reference lib="webworker" />

import type { Embedder } from "./generated/core-browser.mjs";
import { embedderModeFor, type WorkerRequest, type WorkerResponse } from "./lib/embedder-protocol";

const ortWasmUrl = "/onnxruntime/ort-wasm-simd-threaded.wasm";
const ortWasmMjsUrl = "/onnxruntime/ort-wasm-simd-threaded.mjs";
const ortWasmAsyncifyUrl = "/onnxruntime/ort-wasm-simd-threaded.asyncify.wasm";
const ortWasmAsyncifyMjsUrl = "/onnxruntime/ort-wasm-simd-threaded.asyncify.mjs";
const scope = self as unknown as DedicatedWorkerGlobalScope;

function isSafari(): boolean {
  const vendor = navigator.vendor ?? "";
  return (
    vendor.includes("Apple") &&
    !/CriOS|FxiOS|EdgiOS|OPiOS|mercury|brave|Chrome|Android/i.test(navigator.userAgent)
  );
}

function post(message: WorkerResponse): void {
  scope.postMessage(message);
}

function reportProgress(info: unknown): void {
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

async function createRealEmbedder(modelId: string, dim: number): Promise<Embedder> {
  const { createEmbedder, env } = await import("./generated/core-transformers.mjs");
  if (env.backends.onnx.wasm) {
    env.backends.onnx.wasm.wasmPaths = isSafari()
      ? { wasm: ortWasmUrl, mjs: ortWasmMjsUrl }
      : { wasm: ortWasmAsyncifyUrl, mjs: ortWasmAsyncifyMjsUrl };
  }
  return createEmbedder({ modelId, dim, onProgress: reportProgress });
}

let embedderPromise: Promise<Embedder> | undefined;

async function init(modelId: string, dim: number): Promise<void> {
  embedderPromise = (async () => {
    const embedder = await createRealEmbedder(modelId, dim);
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
