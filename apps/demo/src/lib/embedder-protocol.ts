/** Message contract between the UI thread and `src/embed-worker.ts`. Imported by both sides. */

/** The FakeEmbedder's modelId — a bundle stamped with it was built by the deterministic stand-in, not a real model. */
export const MOCK_MODEL_ID = "fake-embedder-v1";

export type EmbedderMode = "mock" | "model";

/**
 * Mock mode is chosen by the bundle, never by a UI toggle: the query vector has
 * to come from the same space as the stored vectors, so an index built by
 * FakeEmbedder can only be searched by FakeEmbedder.
 */
export function embedderModeFor(modelId: string): EmbedderMode {
  return modelId === MOCK_MODEL_ID ? "mock" : "model";
}

export interface InitRequest {
  type: "init";
  modelId: string;
  dim: number;
}

export interface EmbedRequest {
  type: "embed";
  requestId: number;
  texts: string[];
}

export type WorkerRequest = InitRequest | EmbedRequest;

export interface ReadyMessage {
  type: "ready";
  mode: EmbedderMode;
  modelId: string;
}

/** One in-flight model file. `total` is 0 until the server reports a content length. */
export interface ProgressMessage {
  type: "progress";
  file: string;
  loaded: number;
  total: number;
}

export interface VectorsMessage {
  type: "vectors";
  requestId: number;
  vectors: Float32Array[];
}

export interface ErrorMessage {
  type: "error";
  /** Absent when the failure happened during init rather than while serving a request. */
  requestId?: number;
  message: string;
}

export type WorkerResponse = ReadyMessage | ProgressMessage | VectorsMessage | ErrorMessage;
