import type { IndexMeta } from "@vector-image-detection/core/browser";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { EmbedderClient, type EmbedderStatus } from "../lib/embedder-client";
import { embedderModeFor } from "../lib/embedder-protocol";

export interface EmbedderHandle {
  status: EmbedderStatus;
  embedTexts: (texts: string[]) => Promise<Float32Array[]>;
}

export function useEmbedder(meta: Pick<IndexMeta, "modelId" | "dim">): EmbedderHandle {
  const [client, setClient] = useState<EmbedderClient | null>(null);

  useEffect(() => {
    const instance = new EmbedderClient(meta.modelId, meta.dim);
    setClient(instance);
    return () => instance.terminate();
  }, [meta.modelId, meta.dim]);

  // Covers the first render, before the effect has created the client.
  const pendingStatus = useMemo<EmbedderStatus>(
    () => ({ phase: "loading", mode: embedderModeFor(meta.modelId), downloads: [] }),
    [meta.modelId],
  );

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
    }),
    [client, status],
  );
}
