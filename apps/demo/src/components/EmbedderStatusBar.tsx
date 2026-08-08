import type { EmbedderStatus } from "../lib/embedder-client";

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/**
 * Explains where the query vectors come from. In mock mode this is the whole
 * story — no download happens at all — so the bar states that plainly instead of
 * showing a progress UI that would never move.
 */
export function EmbedderStatusBar({
  status,
  onPreload,
}: {
  status: EmbedderStatus;
  onPreload?: () => void;
}) {
  if (status.phase === "error") {
    return (
      <p className="embedder-status embedder-status--error" role="status">
        <strong>Text embedding unavailable.</strong> {status.message}
      </p>
    );
  }

  if (status.mode === "mock") {
    return (
      <p className="embedder-status" role="status">
        <span className="embedder-status__badge">Mock mode</span>
        This index was built by <code>fake-embedder-v1</code>, so queries are embedded by the same
        deterministic stand-in — nothing is downloaded and everything runs offline.
      </p>
    );
  }

  if (status.phase === "idle") {
    return (
      <p className="embedder-status" role="status">
        <span className="embedder-status__badge">Model not loaded</span>
        The text tower (about 100 MB) downloads the first time you search, categorize, or score
        vocabulary — nothing is fetched until then, or{" "}
        <button type="button" className="embedder-status__load" onClick={onPreload}>
          load it now
        </button>
        .
      </p>
    );
  }

  if (status.phase === "loading") {
    const loaded = status.downloads.reduce((total, file) => total + file.loaded, 0);
    const expected = status.downloads.reduce((total, file) => total + file.total, 0);

    return (
      <p className="embedder-status" role="status">
        <span className="embedder-status__badge">Loading model</span>
        Fetching the text tower (about 100 MB on a first visit; the browser caches it afterwards)
        {expected > 0 && ` — ${formatMegabytes(loaded)} of ${formatMegabytes(expected)}`}.
      </p>
    );
  }

  return (
    <p className="embedder-status" role="status">
      <span className="embedder-status__badge">Model ready</span>
      Queries are embedded in a Web Worker by the real text tower.
    </p>
  );
}
