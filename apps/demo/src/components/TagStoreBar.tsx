import type { TagOverlayHandle } from "../hooks/use-tag-overlay";
import { buttonClass } from "./ui";

function downloadJson(contents: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  // Revoking in the same task cancels the download in some browsers, which have
  // not yet read the blob when click() returns.
  setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 0);
}

/** Persistence controls plus the note that this storage is demo-scoped, not the real write-back path. */
export function TagStoreBar({ tags }: { tags: TagOverlayHandle }) {
  const { confirmedCount } = tags;

  return (
    <div className="mt-xs flex flex-wrap items-center justify-between gap-sm rounded-md border border-line bg-surface px-md py-sm">
      <p className="m-0 min-w-0 basis-store grow text-sm text-muted">
        <strong>
          {confirmedCount} confirmed {confirmedCount === 1 ? "tag" : "tags"}
        </strong>{" "}
        kept in this browser&rsquo;s <code>localStorage</code>, keyed to this index. Demo-scoped
        only — a real deployment writes confirmed tags back into the index bundle or a database.
      </p>
      <div className="flex gap-xs">
        <button
          type="button"
          className={buttonClass("quiet")}
          disabled={confirmedCount === 0}
          onClick={() => downloadJson(tags.exportJson(), "vis-demo-tags.json")}
        >
          Export tags (JSON)
        </button>
        <button
          type="button"
          className={buttonClass("quiet")}
          disabled={confirmedCount === 0}
          onClick={() => tags.reset()}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
