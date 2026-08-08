import type { IndexMeta } from "@vector-image-detection/core/browser";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { EmbedderClient, type EmbedderStatus } from "../lib/embedder-client";
import { embedderModeFor } from "../lib/embedder-protocol";

export interface EmbedderHandle {
  status: EmbedderStatus;
  embedTexts: (texts: string[]) => Promise<Float32Array[]>;
  /** Starts the model load without embedding anything — e.g. an explicit "load now" affordance. */
  preload: () => void;
}

export function useEmbedder(meta: Pick<IndexMeta, "modelId" | "dim">): EmbedderHandle {
  const [client, setClient] = useState<EmbedderClient | null>(null);

  useEffect(() => {
    const instance = new EmbedderClient(meta.modelId, meta.dim);
    setClient(instance);
    return () => instance.terminate();
  }, [meta.modelId, meta.dim]);

  // Covers the first render, before the effect has created the client. Mirrors
  // EmbedderClient's own constructor: mock starts loading immediately (it's
  // free), a real model stays idle until something asks for it.
  const pendingStatus = useMemo<EmbedderStatus>(() => {
    const mode = embedderModeFor(meta.modelId);
    return mode === "mock" ? { phase: "loading", mode, downloads: [] } : { phase: "idle", mode };
  }, [meta.modelId]);

  const subscribe = useMemo(
    () => (onChange: () => void) => client?.subscribe(onChange) ?? (() => {}),
    [client],
  );

  const status = useSyncExternalStore(subscribe, () => client?.getStatus() ?? pendingStatus);

  return useMemo(
    () => ({
      status,
      embedTexts: (texts: string[]) =>
        client
          ? client.embedTexts(texts)
          : Promise.reject(new Error("the embedder is not ready yet")),
      preload: () => client?.preload(),
    }),
    [client, status],
  );
}
