import { useCallback, useEffect, useState } from "react";
import { loadDemoIndex, type DemoIndex } from "../lib/index-data";

export type DemoIndexState =
  | { phase: "loading" }
  | { phase: "ready"; index: DemoIndex }
  | { phase: "missing"; message: string };

export function useDemoIndex(): DemoIndexState & { reload: () => void } {
  const [state, setState] = useState<DemoIndexState>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ phase: "loading" });

    loadDemoIndex().then(
      (index) => {
        if (!cancelled) setState({ phase: "ready", index });
      },
      (error: unknown) => {
        // Any failure here — 404, a dev server answering with index.html, a
        // truncated embeddings.bin — means the same thing to the user: there is
        // no usable bundle yet. The underlying message is surfaced rather than
        // swallowed so a corrupt bundle is distinguishable from a missing one.
        if (!cancelled) {
          setState({
            phase: "missing",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  return { ...state, reload };
}
