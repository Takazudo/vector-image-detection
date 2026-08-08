import type { Vector } from "@vector-image-detection/core/browser";
import {
  embedderModeFor,
  type EmbedderMode,
  type WorkerRequest,
  type WorkerResponse,
} from "./embedder-protocol";

export interface DownloadProgress {
  file: string;
  loaded: number;
  total: number;
}

export type EmbedderStatus =
  | { phase: "idle"; mode: EmbedderMode }
  | { phase: "loading"; mode: EmbedderMode; downloads: DownloadProgress[] }
  | { phase: "ready"; mode: EmbedderMode }
  | { phase: "error"; mode: EmbedderMode; message: string };

/**
 * True when an embed request can be issued right now — either immediately
 * (loading will start lazily on the first call) or because the model already
 * finished loading. False mid-load or on error, so callers don't pile up
 * duplicate requests behind an in-flight or failed load.
 */
export function canRequestEmbedding(status: EmbedderStatus): boolean {
  return status.phase === "idle" || status.phase === "ready";
}

type Listener = (status: EmbedderStatus) => void;

interface PendingRequest {
  resolve: (vectors: Vector[]) => void;
  reject: (error: Error) => void;
}

/**
 * UI-thread handle on the embedding worker. Owns the worker's lifetime, turns
 * its messages into a subscribable status, and exposes text embedding as a
 * promise.
 */
export class EmbedderClient {
  readonly mode: EmbedderMode;

  private readonly modelId: string;
  private readonly dim: number;
  private readonly worker: Worker;
  private readonly listeners = new Set<Listener>();
  private readonly pending = new Map<number, PendingRequest>();
  private readonly downloads = new Map<string, DownloadProgress>();
  private nextRequestId = 1;
  private status: EmbedderStatus;
  private initSent = false;

  constructor(modelId: string, dim: number) {
    this.mode = embedderModeFor(modelId);
    this.modelId = modelId;
    this.dim = dim;
    // Mock mode has nothing to download, so there's no reason to defer it —
    // deferring only matters for the real model's ~100MB network fetch, which
    // starts lazily via `preload()`/`embedTexts()` instead of on construction.
    this.status =
      this.mode === "mock"
        ? { phase: "loading", mode: this.mode, downloads: [] }
        : { phase: "idle", mode: this.mode };

    this.worker = new Worker(new URL("../embed-worker.ts", import.meta.url), { type: "module" });
    this.worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      this.handle(event.data);
    });
    this.worker.addEventListener("error", (event) => {
      this.setStatus({
        phase: "error",
        mode: this.mode,
        message: event.message || "the embedding worker failed to start",
      });
    });

    if (this.mode === "mock") this.preload();
  }

  getStatus(): EmbedderStatus {
    return this.status;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /**
   * Starts the worker's model load if it hasn't started yet. Idempotent and
   * safe to call speculatively (e.g. from a "load model now" affordance) —
   * `embedTexts` also calls this itself, so most callers never need to.
   */
  preload(): void {
    if (this.initSent) return;
    this.initSent = true;
    this.setStatus({ phase: "loading", mode: this.mode, downloads: [] });
    this.send({ type: "init", modelId: this.modelId, dim: this.dim });
  }

  embedTexts(texts: string[]): Promise<Vector[]> {
    if (texts.length === 0) return Promise.resolve([]);
    this.preload();
    const requestId = this.nextRequestId++;
    return new Promise<Vector[]>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.send({ type: "embed", requestId, texts });
    });
  }

  terminate(): void {
    for (const request of this.pending.values()) {
      request.reject(new Error("the embedding worker was shut down"));
    }
    this.pending.clear();
    this.listeners.clear();
    this.worker.terminate();
  }

  private send(request: WorkerRequest): void {
    this.worker.postMessage(request);
  }

  private handle(message: WorkerResponse): void {
    switch (message.type) {
      case "progress":
        this.downloads.set(message.file, message);
        this.setStatus({
          phase: "loading",
          mode: this.mode,
          downloads: [...this.downloads.values()],
        });
        return;
      case "ready":
        this.downloads.clear();
        this.setStatus({ phase: "ready", mode: this.mode });
        return;
      case "vectors": {
        this.pending.get(message.requestId)?.resolve(message.vectors);
        this.pending.delete(message.requestId);
        return;
      }
      case "error": {
        const error = new Error(message.message);
        if (message.requestId === undefined) {
          this.setStatus({ phase: "error", mode: this.mode, message: message.message });
          for (const request of this.pending.values()) request.reject(error);
          this.pending.clear();
          return;
        }
        this.pending.get(message.requestId)?.reject(error);
        this.pending.delete(message.requestId);
      }
    }
  }

  private setStatus(status: EmbedderStatus): void {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }
}
