import { useEffect, useRef, useState } from "react";
import {
  ApiClientError,
  fetchPhotoDetail,
  type PhotoLibraryClient,
} from "../lib/photo-library-client";
import type { RelatedPhotoResult, RelatedPhotosResponse } from "../worker/contracts/api";
import type { PhotoSummary } from "../worker/contracts/domain";
import { StatusBanner } from "./StatusBanner";

/**
 * `not_indexed` mirrors the contract's `vector_pending` degradation and is
 * transient (Vectorize is eventually consistent), so it must never be styled
 * or worded as an outage — `provider_unavailable` is the outage.
 */
type RelatedListStatus = "loading" | "ready" | "not_indexed" | "provider_unavailable" | "error";

interface RelatedListState {
  status: RelatedListStatus;
  items: RelatedPhotoResult[];
  message: string | null;
}

const loadingState: RelatedListState = { status: "loading", items: [], message: null };

/** Mirrors `--breakpoint-wide` in `styles/global.css`, where this panel stops
 * stacking under the gallery and becomes a sticky aside beside it. */
const WIDE_BREAKPOINT = "68rem";

/** The source photo's AI caption, which explains what the neighbours matched on. */
type CaptionState =
  { status: "loading" } | { status: "ready"; caption: string | null } | { status: "unavailable" };

export function RelatedPhotosPanel({
  photo,
  client,
  onClose,
  onOpenRelated,
}: {
  photo: PhotoSummary;
  client: PhotoLibraryClient;
  onClose(): void;
  onOpenRelated(photo: PhotoSummary): void;
}) {
  const [state, setState] = useState<RelatedListState>(loadingState);
  const [caption, setCaption] = useState<CaptionState>({ status: "loading" });
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    // Request token as well as the abort: a superseded response must be
    // discarded even when the client ignores the signal.
    let current = true;
    setState(loadingState);
    setCaption({ status: "loading" });

    void client.relatedPhotos(photo.id, controller.signal).then(
      (response) => {
        if (current) setState(listStateFor(response));
      },
      (error: unknown) => {
        if (current && !isAbort(error))
          setState({ status: "error", items: [], message: errorMessageFor(error) });
      },
    );

    // No signal: `fetchPhotoDetail` shares one in-flight request across every
    // caller for this photo, so aborting here would cancel the gallery card's
    // read too. The `current` token above is what discards a superseded response.
    void fetchPhotoDetail(client, photo.id).then(
      (photoDetail) => {
        if (current) setCaption({ status: "ready", caption: photoDetail.aiCaption });
      },
      (error: unknown) => {
        // The AI description is context, not the payload — a failure must leave
        // a terminal note rather than an endless placeholder, and must never
        // hide the neighbours that did load.
        if (current && !isAbort(error)) setCaption({ status: "unavailable" });
      },
    );

    return () => {
      current = false;
      controller.abort();
    };
  }, [client, photo.id]);

  useEffect(() => {
    // Below the `wide` breakpoint the panel stacks after the whole gallery, so
    // opening it without moving focus and the viewport reads as a dead click.
    const panel = panelRef.current;
    panel?.focus({ preventScroll: true });
    // Only scroll in the stacked layout — at `wide` and up the panel is a
    // sticky aside already beside the gallery, so scrolling to it just yanks
    // the page. `block: "start"` rather than `"nearest"`: nearest is the
    // *minimum* scroll, and the minimum leaves the panel under the sticky
    // BulkTagBar, which is exactly the dead-click this effect exists to avoid.
    if (!window.matchMedia?.(`(min-width: ${WIDE_BREAKPOINT})`).matches) {
      panel?.scrollIntoView?.({ block: "start" });
    }
  }, [photo.id]);

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      className="flex flex-col gap-md rounded-lg border border-line bg-surface p-md wide:sticky wide:top-md wide:max-h-panel-viewport wide:overflow-y-auto wide:overscroll-contain"
      aria-labelledby="related-heading"
      aria-busy={state.status === "loading"}
      data-related-state={state.status}
    >
      <header className="flex items-start justify-between gap-xs">
        <div>
          <h2 id="related-heading" className="m-0 text-body font-semibold">
            Related by AI description
          </h2>
          <p className="mt-3xs mb-0 text-xs text-muted">
            Photos whose AI caption, AI words, and human tags read closest to this one. The library
            never compares the images themselves.
          </p>
        </div>
        <button
          type="button"
          className="grid min-h-control min-w-control shrink-0 cursor-pointer place-items-center rounded-md border border-line bg-surface text-muted hover-safe:bg-sunken active:translate-y-px [&_svg]:size-ui"
          aria-label="Close the related photos panel"
          onClick={onClose}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      <div className="flex items-start gap-sm border-b border-line pb-md">
        <img
          className="aspect-square h-auto w-thumb-lg rounded-sm bg-sunken object-cover"
          src={photo.mediaUrl}
          alt=""
          width={photo.width}
          height={photo.height}
          decoding="async"
        />
        <p className="m-0 min-w-0 text-xs text-muted">
          <span className="block font-semibold text-ink">This photo&rsquo;s AI description</span>
          {captionText(caption)}
        </p>
      </div>

      <div className="grid gap-sm" aria-live="polite">
        {state.status === "loading" && (
          <p className="m-0 text-sm text-muted">Finding photos with related descriptions&hellip;</p>
        )}
        {state.status === "not_indexed" && (
          <StatusBanner tone="info">
            <strong>Not indexed yet.</strong> This photo&rsquo;s AI description has not reached the
            search index. That normally takes a few seconds after processing — reopen this panel
            shortly.
          </StatusBanner>
        )}
        {state.status === "provider_unavailable" && (
          <StatusBanner tone="warning">
            <strong>Related photos are unavailable right now.</strong> The vector index could not be
            reached, so this list is incomplete. Nothing is wrong with this photo.
          </StatusBanner>
        )}
        {state.status === "error" && <StatusBanner tone="error">{state.message}</StatusBanner>}
        {state.status === "ready" && state.items.length === 0 && (
          <p className="m-0 rounded-md border border-dashed border-line-strong bg-sunken p-md text-center text-sm text-muted">
            No related photos. Nothing else in the library has a close enough AI description.
          </p>
        )}
        {state.items.length > 0 && (
          <ol className="m-0 flex list-none flex-col gap-xs p-0">
            {state.items.map((result) => (
              <RelatedRow key={result.photo.id} result={result} onOpenRelated={onOpenRelated} />
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}

function RelatedRow({
  result,
  onOpenRelated,
}: {
  result: RelatedPhotoResult;
  onOpenRelated(photo: PhotoSummary): void;
}) {
  const label = photoLabel(result.photo);
  return (
    <li>
      <button
        type="button"
        className="grid-related-row grid min-h-control w-full cursor-pointer items-center gap-xs rounded-sm border-0 bg-transparent p-3xs text-start hover-safe:bg-sunken active:bg-sunken"
        aria-label={`Show photos related to ${label}`}
        onClick={() => onOpenRelated(result.photo)}
      >
        <img
          className="aspect-square h-auto w-thumb-sm rounded-sm bg-sunken object-cover"
          src={result.photo.mediaUrl}
          alt=""
          width={result.photo.width}
          height={result.photo.height}
          loading="lazy"
          decoding="async"
        />
        <span className="min-w-0 truncate text-xs">{label}</span>
        <span className="text-end text-xs text-muted tabular-nums" title="Description match score">
          {result.reason.score.toFixed(2)}
        </span>
      </button>
    </li>
  );
}

function listStateFor(response: RelatedPhotosResponse): RelatedListState {
  // A degraded response with an unrecognised reason is treated as an outage,
  // never as the transient "not indexed yet" — overstating recoverability is
  // the worse failure.
  const status: RelatedListStatus = !response.degraded
    ? "ready"
    : response.degradedReason === "vector_pending"
      ? "not_indexed"
      : "provider_unavailable";
  return { status, items: response.items, message: null };
}

function captionText(caption: CaptionState): string {
  if (caption.status === "loading") return "Loading the AI description…";
  if (caption.status === "unavailable") return "The AI description could not be loaded.";
  return caption.caption ?? "No AI description stored yet.";
}

function photoLabel(photo: PhotoSummary): string {
  const words = photo.aiWords.slice(0, 3).map((word) => word.word);
  if (words.length > 0) return words.join(", ");
  const tags = photo.humanTags.slice(0, 3).map((tag) => tag.name);
  if (tags.length > 0) return tags.join(", ");
  return `photo ${photo.id}`;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function errorMessageFor(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 404)
    return "This photo is no longer available, so it has no related photos.";
  const detail = error instanceof Error ? error.message : "Unexpected request error";
  return `Related photos could not be loaded: ${detail}`;
}
