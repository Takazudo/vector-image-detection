import type { IndexItem } from "../generated/core-browser.mjs";
import { useEffect, useRef, useState } from "react";
import { itemLabel } from "../lib/format";

/**
 * Credits an image from the `source`/`license`/`author` fields the index bundle
 * carries verbatim. Fields are optional per the `IndexItem` contract, so each is
 * rendered only when present rather than as an empty row.
 */
export function AttributionPopover({
  item,
  placement = "overlay",
}: {
  item: IndexItem;
  placement?: "overlay" | "inline";
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const label = itemLabel(item);

  return (
    <div
      className={placement === "overlay" ? "absolute top-3xs right-3xs" : "relative"}
      ref={containerRef}
    >
      <button
        type="button"
        className="grid min-h-control min-w-control cursor-pointer place-items-center rounded-pill border border-line bg-surface text-muted hover-safe:border-line-strong hover-safe:text-ink active:bg-sunken [&_svg]:size-icon"
        aria-expanded={open}
        aria-label={`Attribution for ${label}`}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="8" cy="4.6" r="1" fill="currentColor" />
          <path d="M8 7v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div
          className="popover-panel z-popover absolute right-0 w-max rounded-md border border-line-strong bg-surface p-sm shadow-popover"
          role="dialog"
          aria-label={`Attribution for ${label}`}
        >
          <dl className="grid-attribution m-0 grid gap-x-xs gap-y-3xs text-xs [&_dd]:m-0 [&_dd]:wrap-anywhere [&_dt]:text-subtle">
            <dt>File</dt>
            <dd>{item.file}</dd>
            {item.author && (
              <>
                <dt>Author</dt>
                <dd>{item.author}</dd>
              </>
            )}
            {item.license && (
              <>
                <dt>License</dt>
                <dd>{item.license}</dd>
              </>
            )}
            {item.source && (
              <>
                <dt>Source</dt>
                <dd>
                  <a href={item.source} target="_blank" rel="noreferrer noopener">
                    {item.source}
                  </a>
                </dd>
              </>
            )}
          </dl>
          {!item.author && !item.license && !item.source && (
            <p className="mt-xs mb-0 text-xs text-subtle">
              This item carries no credit fields. The ingest manifest supplies them.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
