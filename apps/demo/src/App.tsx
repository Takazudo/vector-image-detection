"use client";

import { useCallback, useMemo, useState } from "react";
import { EmbedderStatusBar } from "./components/EmbedderStatusBar";
import { MissingBundle } from "./components/MissingBundle";
import { SimilarPanel } from "./components/SimilarPanel";
import { TagStoreBar } from "./components/TagStoreBar";
import { tabClass } from "./components/ui";
import { useDemoIndex } from "./hooks/use-demo-index";
import { useEmbedder } from "./hooks/use-embedder";
import { useStoreTagSync } from "./hooks/use-store-tag-sync";
import { useTagOverlay } from "./hooks/use-tag-overlay";
import type { DemoIndex } from "./lib/index-data";
import { VIEWS, type DemoContext, type ViewId } from "./types";
import { AttachWordView } from "./views/AttachWordView";
import { CategorizeView } from "./views/CategorizeView";
import { GalleryView } from "./views/GalleryView";
import { SearchView } from "./views/SearchView";
import { VocabTagsView } from "./views/VocabTagsView";

export function App() {
  const state = useDemoIndex();

  if (state.phase === "loading") {
    return (
      <main className="grid min-h-screen place-items-center px-md py-lg">
        <p className="text-muted">Loading the index bundle&hellip;</p>
      </main>
    );
  }

  if (state.phase === "missing") {
    return (
      <main className="grid min-h-screen place-items-center px-md py-lg">
        <MissingBundle message={state.message} onRetry={state.reload} />
      </main>
    );
  }

  // Keyed on index identity — the same pair the tag storage key uses — so every
  // hook below rebuilds from scratch after a reload rather than carrying state
  // that belonged to the previous bundle.
  const { modelId, createdAt } = state.index.meta;
  return <Workspace key={`${modelId}:${createdAt}`} index={state.index} />;
}

function Workspace({ index }: { index: DemoIndex }) {
  const [view, setView] = useState<ViewId>("gallery");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const tags = useTagOverlay(index.meta);
  const embedder = useEmbedder(index.meta);
  useStoreTagSync(index, tags.overlay);

  const onSelect = useCallback(
    (id: string) => setSelectedId((current) => (current === id ? null : id)),
    [],
  );

  const ctx = useMemo<DemoContext>(
    () => ({ index, tags, embedder, selectedId, onSelect }),
    [index, tags, embedder, selectedId, onSelect],
  );

  const showPanel = selectedId !== null && view !== "attach";

  return (
    <div className="mx-auto max-w-screen-2xl px-md pt-lg pb-2xl">
      <header className="flex flex-wrap items-end justify-between gap-md border-b border-line pb-md">
        <div>
          <h1 className="m-0 text-title font-semibold tracking-tight">Photo vector search</h1>
          <p className="mt-3xs mb-0 text-sm text-muted">
            {index.items.length} photos &middot; {index.meta.dim}-dimensional vectors &middot;{" "}
            <code>{index.meta.modelId}</code>
          </p>
        </div>
        <nav className="flex flex-wrap gap-3xs" aria-label="Views">
          {VIEWS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={tabClass(view === entry.id)}
              aria-current={view === entry.id ? "page" : undefined}
              onClick={() => setView(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </nav>
      </header>

      <EmbedderStatusBar status={embedder.status} onPreload={embedder.preload} />
      <TagStoreBar tags={tags} />

      {/* In "attach" a photo click picks an exemplar rather than a neighbour query,
          so that view owns its own selection and gets no side panel. */}
      <div
        className={`mt-xl grid items-start gap-xl ${showPanel ? "wide:grid-workspace-panel" : ""}`}
      >
        <main className="min-w-0">
          {view === "gallery" && <GalleryView ctx={ctx} />}
          {view === "categorize" && <CategorizeView ctx={ctx} />}
          {view === "search" && <SearchView ctx={ctx} />}
          {view === "vocab-tags" && <VocabTagsView ctx={ctx} />}
          {view === "attach" && <AttachWordView ctx={ctx} />}
        </main>

        {showPanel && <SimilarPanel ctx={ctx} onClose={() => setSelectedId(null)} />}
      </div>
    </div>
  );
}
