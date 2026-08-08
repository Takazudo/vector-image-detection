export interface MissingBundleProps {
  message: string;
  onRetry: () => void;
}

/** Shown when `public/data/` holds no readable index bundle — the state a fresh clone starts in. */
export function MissingBundle({ message, onRetry }: MissingBundleProps) {
  return (
    <div className="missing">
      <h2 className="missing__title">No index bundle loaded</h2>
      <p className="missing__body">
        This app reads a precomputed index from <code>public/data/</code>. Nothing usable is there
        yet.
      </p>

      <h3 className="missing__subtitle">Use the committed fixture (no downloads)</h3>
      <pre className="missing__code">
        <code>pnpm demo:fixture{"\n"}pnpm demo:dev</code>
      </pre>
      <p className="missing__body">
        24 synthetic images with vectors from <code>fake-embedder-v1</code>. Every view works
        offline because the fake embedding space aligns text with images.
      </p>

      <h3 className="missing__subtitle">Or export a real index</h3>
      <pre className="missing__code">
        <code>vis ingest ./photos{"\n"}vis export-demo</code>
      </pre>
      <p className="missing__body">
        That writes <code>meta.json</code>, <code>embeddings.bin</code>, and <code>thumbs/</code> to
        the same place, and the app switches to the real text tower automatically.
      </p>

      <p className="missing__detail">
        Loader reported: <code>{message}</code>
      </p>
      <button type="button" className="button button--primary" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
