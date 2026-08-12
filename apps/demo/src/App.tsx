"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { PhotoCard } from "./components/PhotoCard";
import { RelatedPhotosPanel } from "./components/RelatedPhotosPanel";
import { StatusBanner } from "./components/StatusBanner";
import {
  ApiClientError,
  browserPhotoLibraryClient,
  type PhotoLibraryClient,
} from "./lib/photo-library-client";
import { validateUploadFile } from "./lib/upload-validation";
import type { BulkHumanTagMutationResult, SearchResult, SearchTier } from "./worker/contracts/api";
import type { PhotoSummary } from "./worker/contracts/domain";

type UploadPhase = "queued" | "uploading" | "processing" | "ready" | "retryable" | "failed";
interface UploadItem {
  key: string;
  file: File;
  phase: UploadPhase;
  message: string;
  generation: number;
}

const phaseLabel: Record<UploadPhase, string> = {
  queued: "Queued",
  uploading: "Uploading",
  processing: "Processing AI words",
  ready: "Ready",
  retryable: "Upload interrupted — retry available",
  failed: "Upload failed",
};

const sleep = (milliseconds: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });

export function App({ client = browserPhotoLibraryClient }: { client?: PhotoLibraryClient }) {
  const [photos, setPhotos] = useState<PhotoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [readinessWarning, setReadinessWarning] = useState<string | null>(null);
  const [writesEnabled, setWritesEnabled] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [mutationMessage, setMutationMessage] = useState<string | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [degradedReason, setDegradedReason] = useState<string | null>(null);
  const [relatedPhoto, setRelatedPhoto] = useState<PhotoSummary | null>(null);
  const [dragging, setDragging] = useState(false);
  const uploadGenerations = useRef(new Map<string, number>());
  const uploadControllers = useRef(new Map<string, AbortController>());
  const mounted = useRef(true);
  const searchGeneration = useRef(0);

  useEffect(
    () => () => {
      mounted.current = false;
      for (const controller of uploadControllers.current.values()) controller.abort();
      uploadControllers.current.clear();
    },
    [],
  );

  const reloadPhotos = useCallback(
    async (signal?: AbortSignal) => {
      const response = await client.listPhotos(signal);
      setPhotos(response.items.filter((photo) => photo.state !== "tombstoned"));
    },
    [client],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void client
      .readiness(controller.signal)
      .then((readiness) => {
        if (controller.signal.aborted) return;
        setWritesEnabled(readiness.publicWritesEnabled);
        setReadinessWarning(null);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setWritesEnabled(false);
          setReadinessWarning(`Write availability could not be confirmed: ${messageFor(error)}`);
        }
      });
    void client
      .listPhotos(controller.signal)
      .then((gallery) => {
        if (controller.signal.aborted) return;
        setPhotos(gallery.items.filter((photo) => photo.state !== "tombstoned"));
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(messageFor(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [client]);

  const updateUpload = useCallback(
    (key: string, generation: number, patch: Partial<UploadItem>) => {
      if (!mounted.current || uploadGenerations.current.get(key) !== generation) return;
      setUploads((current) =>
        current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
      );
    },
    [],
  );

  const runUpload = useCallback(
    async (key: string, file: File, generation: number) => {
      const controller = new AbortController();
      uploadControllers.current.get(key)?.abort();
      uploadControllers.current.set(key, controller);
      try {
        updateUpload(key, generation, { phase: "uploading", message: "Uploading securely" });
        const created = await client.uploadPhoto(file, controller.signal);
        if (uploadGenerations.current.get(key) !== generation) return;
        updateUpload(key, generation, {
          phase: "processing",
          message: "Upload stored; waiting for processing",
        });

        let status = await client.uploadStatus(created.operationId, controller.signal);
        while (
          status.photoState !== "ready" &&
          !["failed", "expired", "purge_pending"].includes(status.state) &&
          !["failed", "enqueue_failed"].includes(status.photoState ?? "")
        ) {
          await sleep(1_000, controller.signal);
          if (uploadGenerations.current.get(key) !== generation) return;
          status = await client.uploadStatus(created.operationId, controller.signal);
        }
        if (
          ["enqueue_failed", "failed", "expired", "purge_pending"].includes(status.state) ||
          ["failed", "enqueue_failed"].includes(status.photoState ?? "")
        ) {
          updateUpload(key, generation, {
            phase: status.retryable ? "retryable" : "failed",
            message: status.errorCode ?? phaseLabel[status.retryable ? "retryable" : "failed"],
          });
          return;
        }

        updateUpload(key, generation, { phase: "ready", message: "Added to the public library" });
        await reloadPhotos(controller.signal);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        const retryable = !(error instanceof ApiClientError) || error.retryable;
        updateUpload(key, generation, {
          phase: retryable ? "retryable" : "failed",
          message: messageFor(error),
        });
      } finally {
        if (uploadControllers.current.get(key) === controller)
          uploadControllers.current.delete(key);
      }
    },
    [client, reloadPhotos, updateUpload],
  );

  const queueFiles = useCallback(
    (files: FileList | File[]) => {
      const candidates = Array.from(files);
      const additions = candidates.map((file, index): UploadItem => {
        const key = `${file.name}:${file.size}:${file.lastModified}:${index}:${Date.now()}`;
        const error = validateUploadFile(file);
        uploadGenerations.current.set(key, 1);
        return {
          key,
          file,
          generation: 1,
          phase: error ? "failed" : "queued",
          message: error ?? "Waiting to upload",
        };
      });
      setUploads((current) => [...additions, ...current]);
      for (const item of additions)
        if (item.phase === "queued") void runUpload(item.key, item.file, 1);
    },
    [runUpload],
  );

  const retryUpload = useCallback(
    (item: UploadItem) => {
      const generation = (uploadGenerations.current.get(item.key) ?? item.generation) + 1;
      uploadGenerations.current.set(item.key, generation);
      setUploads((current) =>
        current.map((candidate) =>
          candidate.key === item.key
            ? { ...candidate, generation, phase: "queued", message: "Retry queued" }
            : candidate,
        ),
      );
      void runUpload(item.key, item.file, generation);
    },
    [runUpload],
  );

  const toggleSelection = useCallback((photoId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }, []);

  const mutateTags = useCallback(
    async (action: "attach" | "remove", tag: string, photoIds: string[]) => {
      const normalized = tag.trim();
      if (!normalized || photoIds.length === 0) return;
      setMutationBusy(true);
      setMutationMessage(null);
      try {
        const response = await client.mutateTags({
          version: "v1",
          action,
          photoIds,
          humanTagNames: [normalized],
          expectedRevisions: Object.fromEntries(
            photos
              .filter((photo) => photoIds.includes(photo.id))
              .map((photo) => [photo.id, photo.documentRevision]),
          ),
        });
        applyMutationResults(response.results, setPhotos);
        setSearchResults(
          (current) =>
            current &&
            current.map((result) => ({
              ...result,
              photo: applyMutationResult(result.photo, response.results),
            })),
        );
        const updated = response.results.filter((result) => result.status === "updated").length;
        const unchanged = response.results.filter((result) => result.status === "unchanged").length;
        const failed = response.results.length - updated - unchanged;
        setMutationMessage(
          `${action === "attach" ? "Attached" : "Removed"} “${normalized}”: ${updated} updated, ${unchanged} unchanged, ${failed} failed.`,
        );
      } catch (error) {
        setMutationMessage(messageFor(error));
      } finally {
        setMutationBusy(false);
      }
    },
    [client, photos],
  );

  const submitSearch = useCallback(
    async (query: string) => {
      const normalized = query.trim();
      const generation = ++searchGeneration.current;
      setSearchQuery(normalized);
      setSearchError(null);
      if (!normalized) {
        setSearchBusy(false);
        setSearchResults(null);
        setDegradedReason(null);
        return;
      }
      setSearchBusy(true);
      try {
        const response = await client.search(normalized);
        if (generation !== searchGeneration.current) return;
        setSearchResults(response.items);
        setDegradedReason(
          response.degraded
            ? (response.degradedReason ?? "Related search is temporarily unavailable.")
            : null,
        );
      } catch (error) {
        if (generation === searchGeneration.current) setSearchError(messageFor(error));
      } finally {
        if (generation === searchGeneration.current) setSearchBusy(false);
      }
    },
    [client],
  );

  const visiblePhotos = searchResults === null ? photos : [];
  const selectedCount = selected.size;

  return (
    <div className="mx-auto max-w-screen-2xl px-[clamp(1rem,4vw,2rem)] py-lg">
      <header className="grid gap-sm border-b border-line pb-lg">
        <p className="m-0 text-xs font-semibold uppercase tracking-wide text-accent">
          Public AI photo library
        </p>
        <h1 className="m-0 text-[clamp(1.75rem,5vw,3rem)] leading-tight tracking-tight">
          Upload, describe, and find photos together.
        </h1>
        <p className="m-0 max-w-prose text-muted">
          This anonymous public demo keeps original image files, including metadata. AI suggestions
          are automatic; moderation is reactive operator purge only.
        </p>
      </header>

      <main className="mt-xl grid gap-xl">
        {!writesEnabled && !loading && (
          <StatusBanner tone="warning">
            <strong>Gallery is read-only.</strong> Public uploads and tag changes are currently
            disabled; search remains available.
          </StatusBanner>
        )}
        {readinessWarning && (
          <StatusBanner tone="warning">
            {readinessWarning} Gallery and search can still be used.
          </StatusBanner>
        )}
        {loadError && (
          <StatusBanner tone="error">Could not load the library: {loadError}</StatusBanner>
        )}

        <section
          aria-labelledby="upload-heading"
          className="grid gap-md rounded-lg border border-line bg-surface p-[clamp(1rem,4vw,1.5rem)]"
        >
          <div>
            <h2 id="upload-heading" className="m-0 text-title">
              Add photos
            </h2>
            <p className="mt-3xs mb-0 text-sm text-muted">
              JPEG, PNG, or WebP · up to 5 MiB each · originals may retain metadata
            </p>
          </div>
          <label
            className={`grid min-h-32 cursor-pointer place-items-center rounded-lg border-2 border-dashed px-md py-xl text-center has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-sunken"} ${!writesEnabled ? "cursor-not-allowed opacity-60" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              if (writesEnabled) setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (writesEnabled) queueFiles(event.dataTransfer.files);
            }}
          >
            <span>
              <strong>Choose photos</strong> or drag and drop them here
            </span>
            <input
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              disabled={!writesEnabled}
              onChange={(event) => {
                if (event.currentTarget.files) queueFiles(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
          </label>
          {uploads.length > 0 && (
            <ul
              className="m-0 grid list-none gap-xs p-0"
              aria-label="Upload status"
              aria-live="polite"
            >
              {uploads.map((item) => (
                <li
                  key={item.key}
                  className="flex min-w-0 flex-wrap items-center justify-between gap-xs rounded-md bg-sunken px-sm py-xs text-sm"
                >
                  <span className="min-w-0">
                    <strong className="break-words">{item.file.name}</strong> —{" "}
                    {phaseLabel[item.phase]}
                    {item.message ? `: ${item.message}` : ""}
                  </span>
                  {item.phase === "retryable" && (
                    <button
                      className="min-h-control rounded-md border border-line-strong px-sm font-semibold hover-safe:bg-surface"
                      type="button"
                      onClick={() => retryUpload(item)}
                    >
                      Retry upload
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="search-heading" className="grid gap-md">
          <h2 id="search-heading" className="m-0 text-title">
            Search the library
          </h2>
          <form
            className="flex flex-wrap gap-xs"
            aria-busy={searchBusy}
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void submitSearch(String(data.get("query") ?? ""));
            }}
          >
            <label className="grid min-w-[min(100%,20rem)] flex-1 gap-3xs text-sm font-semibold">
              Words or description
              <input
                className="min-h-control min-w-0 rounded-md border border-line-strong bg-surface px-sm text-ink"
                name="query"
                type="search"
                placeholder="Try cat, flowers, or sunset"
              />
            </label>
            <button
              className="min-h-control self-end rounded-md bg-accent px-lg font-semibold text-accent-ink hover-safe:bg-accent-hover"
              type="submit"
            >
              Search
            </button>
            {searchResults !== null && (
              <button
                className="min-h-control self-end rounded-md border border-line-strong px-lg font-semibold hover-safe:bg-surface"
                type="button"
                onClick={() => void submitSearch("")}
              >
                Clear search
              </button>
            )}
          </form>
          {searchError && <StatusBanner tone="error">Search failed: {searchError}</StatusBanner>}
          <div className="sr-only" aria-live="polite">
            {searchBusy ? "Searching the photo library" : ""}
          </div>
        </section>

        <div
          className={
            relatedPhoto ? "grid items-start gap-xl wide:grid-workspace-panel" : "grid gap-xl"
          }
        >
          {searchResults !== null ? (
            <SearchResults
              query={searchQuery}
              results={searchResults}
              degradedReason={degradedReason}
              selected={selected}
              writesEnabled={writesEnabled}
              onSelect={toggleSelection}
              onRemoveTag={(id, tag) => void mutateTags("remove", tag, [id])}
              onShowRelated={setRelatedPhoto}
            />
          ) : (
            <section aria-labelledby="gallery-heading" className="grid gap-md">
              <div className="flex flex-wrap items-center justify-between gap-sm">
                <div>
                  <h2 id="gallery-heading" className="m-0 text-title">
                    Latest photos
                  </h2>
                  <p className="mt-3xs mb-0 text-sm text-muted">
                    {loading ? "Loading…" : `${photos.length} photos`}
                  </p>
                </div>
                {photos.length > 0 && (
                  <div className="flex flex-wrap gap-xs">
                    <button
                      type="button"
                      className="min-h-control rounded-md border border-line-strong px-sm font-semibold hover-safe:bg-surface"
                      onClick={() => setSelected(new Set(photos.map((photo) => photo.id)))}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="min-h-control rounded-md border border-line-strong px-sm font-semibold hover-safe:bg-surface"
                      onClick={() => setSelected(new Set())}
                    >
                      Clear selection
                    </button>
                  </div>
                )}
              </div>
              {!loading && visiblePhotos.length === 0 ? (
                <EmptyState>No photos are available yet.</EmptyState>
              ) : (
                <PhotoGrid
                  photos={visiblePhotos}
                  selected={selected}
                  writesEnabled={writesEnabled}
                  onSelect={toggleSelection}
                  onRemoveTag={(id, tag) => void mutateTags("remove", tag, [id])}
                  onShowRelated={setRelatedPhoto}
                />
              )}
            </section>
          )}
          {relatedPhoto && (
            <RelatedPhotosPanel
              photo={relatedPhoto}
              client={client}
              onClose={() => setRelatedPhoto(null)}
              onOpenRelated={setRelatedPhoto}
            />
          )}
        </div>

        <BulkTagBar
          selectedCount={selectedCount}
          disabled={!writesEnabled || mutationBusy}
          onMutate={(action, tag) => void mutateTags(action, tag, Array.from(selected))}
        />
        <div aria-live="polite">
          {mutationMessage && (
            <StatusBanner
              tone={
                mutationMessage.includes("failed") && !mutationMessage.includes("0 failed")
                  ? "warning"
                  : "success"
              }
            >
              {mutationMessage}
            </StatusBanner>
          )}
        </div>
      </main>
    </div>
  );
}

function PhotoGrid({
  photos,
  selected,
  writesEnabled,
  onSelect,
  onRemoveTag,
  onShowRelated,
}: {
  photos: PhotoSummary[];
  selected: Set<string>;
  writesEnabled: boolean;
  onSelect(id: string): void;
  onRemoveTag(id: string, tag: string): void;
  onShowRelated(photo: PhotoSummary): void;
}) {
  return (
    <div
      className="grid grid-cols-[repeat(auto-fill,minmax(min(16rem,100%),20rem))] justify-start gap-md"
      data-layout="bounded-responsive-grid"
    >
      {photos.map((photo) => (
        <PhotoCard
          key={photo.id}
          photo={photo}
          selected={selected.has(photo.id)}
          disabled={!writesEnabled}
          onSelect={onSelect}
          onRemoveTag={onRemoveTag}
          onShowRelated={onShowRelated}
        />
      ))}
    </div>
  );
}

function BulkTagBar({
  selectedCount,
  disabled,
  onMutate,
}: {
  selectedCount: number;
  disabled: boolean;
  onMutate(action: "attach" | "remove", tag: string): void;
}) {
  return (
    <section
      aria-labelledby="bulk-heading"
      className="sticky bottom-sm grid gap-sm rounded-lg border border-line bg-surface/95 p-md shadow-popover backdrop-blur"
    >
      <div>
        <h2 id="bulk-heading" className="m-0 text-body">
          Edit selected photos
        </h2>
        <p className="m-0 text-sm text-muted">{selectedCount} selected</p>
      </div>
      <form
        className="flex flex-wrap gap-xs"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const tag = String(new FormData(form).get("tag") ?? "");
          const submitter = (event.nativeEvent as SubmitEvent)
            .submitter as HTMLButtonElement | null;
          onMutate(submitter?.value === "remove" ? "remove" : "attach", tag);
        }}
      >
        <label className="grid min-w-[min(100%,16rem)] flex-1 gap-3xs text-sm font-semibold">
          Human tag
          <input
            className="min-h-control rounded-md border border-line-strong bg-surface px-sm"
            name="tag"
            required
            maxLength={64}
          />
        </label>
        <button
          className="min-h-control self-end rounded-md bg-accent px-md font-semibold text-accent-ink disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled || selectedCount === 0}
          name="action"
          value="attach"
        >
          Attach human tag
        </button>
        <button
          className="min-h-control self-end rounded-md border border-line-strong px-md font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled || selectedCount === 0}
          name="action"
          value="remove"
        >
          Remove human tag
        </button>
      </form>
    </section>
  );
}

function SearchResults({
  query,
  results,
  degradedReason,
  selected,
  writesEnabled,
  onSelect,
  onRemoveTag,
  onShowRelated,
}: {
  query: string;
  results: SearchResult[];
  degradedReason: string | null;
  selected: Set<string>;
  writesEnabled: boolean;
  onSelect(id: string): void;
  onRemoveTag(id: string, tag: string): void;
  onShowRelated(photo: PhotoSummary): void;
}) {
  const sections: { tier: SearchTier; heading: string; empty: string }[] = [
    { tier: "exact_human_tag", heading: "Human tag", empty: "No exact human-tag matches." },
    { tier: "exact_ai_word", heading: "AI word", empty: "No exact AI-word matches." },
    { tier: "semantic", heading: "Related", empty: "No related matches." },
  ];
  return (
    <section aria-label={`Search results for ${query}`} className="grid gap-xl">
      {sections.map((section) => {
        const tierResults = results.filter((result) => result.reason.tier === section.tier);
        return (
          <section
            key={section.tier}
            aria-labelledby={`results-${section.tier}`}
            className="grid gap-sm"
          >
            <h2 id={`results-${section.tier}`} className="m-0 text-title">
              {section.heading}
            </h2>
            {section.tier === "semantic" && degradedReason && (
              <StatusBanner tone="warning">
                Related results are incomplete: {degradedReason}
              </StatusBanner>
            )}
            {tierResults.length === 0 ? (
              <EmptyState>{section.empty}</EmptyState>
            ) : (
              <>
                <p className="m-0 text-sm text-muted">{reasonText(tierResults[0]!)}</p>
                <PhotoGrid
                  photos={tierResults.map((result) => result.photo)}
                  selected={selected}
                  writesEnabled={writesEnabled}
                  onSelect={onSelect}
                  onRemoveTag={onRemoveTag}
                  onShowRelated={onShowRelated}
                />
              </>
            )}
          </section>
        );
      })}
    </section>
  );
}

function EmptyState({ children }: { children: string }) {
  return (
    <p className="m-0 rounded-lg border border-dashed border-line-strong bg-sunken p-lg text-center text-muted">
      {children}
    </p>
  );
}

function reasonText(result: SearchResult): string {
  if (result.reason.tier === "exact_human_tag")
    return `Matched human tag “${result.reason.normalizedTag}”.`;
  if (result.reason.tier === "exact_ai_word")
    return `Matched AI suggested word “${result.reason.normalizedWord}”.`;
  return `Related by description · score ${result.reason.score.toFixed(2)}.`;
}

function applyMutationResults(
  results: BulkHumanTagMutationResult[],
  setPhotos: Dispatch<SetStateAction<PhotoSummary[]>>,
) {
  setPhotos((current) => current.map((photo) => applyMutationResult(photo, results)));
}

function applyMutationResult(
  photo: PhotoSummary,
  results: BulkHumanTagMutationResult[],
): PhotoSummary {
  const result = results.find((candidate) => candidate.photoId === photo.id);
  return result?.humanTags && result.documentRevision
    ? { ...photo, humanTags: result.humanTags, documentRevision: result.documentRevision }
    : photo;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected request error";
}
