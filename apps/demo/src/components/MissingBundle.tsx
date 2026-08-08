import { buttonClass } from "./ui";

export interface MissingBundleProps {
  message: string;
  onRetry: () => void;
}

/** Shown when `public/data/` holds no readable index bundle — the state a fresh clone starts in. */
export function MissingBundle({ message, onRetry }: MissingBundleProps) {
  return (
    <div className="max-w-2xl rounded-lg border border-line bg-surface p-xl">
      <h2 className="mt-0 mb-xs text-title font-semibold">No index bundle loaded</h2>
      <p className="m-0 text-ui text-muted">
        This app reads a precomputed index from <code>public/data/</code>. Nothing usable is there
        yet.
      </p>

      <h3 className="mt-xl mb-xs text-ui font-semibold">
        Use the committed fixture (no downloads)
      </h3>
      <pre className="mb-xs overflow-x-auto rounded-md bg-sunken px-md py-sm text-sm [&_code]:bg-transparent [&_code]:p-0">
        <code>pnpm demo:fixture{"\n"}pnpm demo:dev</code>
      </pre>
      <p className="m-0 text-ui text-muted">
        24 synthetic images with vectors from <code>fake-embedder-v1</code>. Every view works
        offline because the fake embedding space aligns text with images.
      </p>

      <h3 className="mt-xl mb-xs text-ui font-semibold">Or export a real index</h3>
      <pre className="mb-xs overflow-x-auto rounded-md bg-sunken px-md py-sm text-sm [&_code]:bg-transparent [&_code]:p-0">
        <code>vis ingest ./photos{"\n"}vis export-demo</code>
      </pre>
      <p className="m-0 text-ui text-muted">
        That writes <code>meta.json</code>, <code>embeddings.bin</code>, and <code>thumbs/</code> to
        the same place, and the app switches to the real text tower automatically.
      </p>

      <p className="mt-xl mb-md wrap-anywhere text-xs text-subtle">
        Loader reported: <code>{message}</code>
      </p>
      <button type="button" className={buttonClass("primary")} onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
