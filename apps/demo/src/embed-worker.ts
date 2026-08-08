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

// transformers.js's onnx backend defaults `env.backends.onnx.wasm.wasmPaths` to
// cdn.jsdelivr.net (see its backends/onnx.js) unless something sets it first.
// Re-host the same onnxruntime-web build it depends on internally so the WASM
// runtime is served from this origin instead — these are `?url` imports (just
// resolved URL strings), so importing them here doesn't fetch any bytes.
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import ortWasmMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import ortWasmAsyncifyUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import ortWasmAsyncifyMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";

const scope = self as unknown as DedicatedWorkerGlobalScope;

// Mirrors transformers.js's own (unexported) Safari check: Safari gets the
// plain build, every other browser gets the asyncify build — matching which
// variant its cdn.jsdelivr.net fallback would otherwise have picked.
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
  // `env` comes from this same lazy module (re-exported by create-embedder.ts)
  // so importing it here doesn't pull transformers.js in any earlier than
  // `createEmbedder` already does.
  const { createEmbedder, env } =
    await import("@vector-image-detection/core/transformers-embedder");

  // `env.backends.onnx.wasm` is populated by transformers.js's own onnx backend
  // as an import-time side effect (which is also what sets the cdn.jsdelivr.net
  // default we're overriding here), so it's already a real object by this point.
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
